import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  adjustScoringWeights,
  getMarginFromFeedMetadata,
  getMarginFromFinancialMetadata,
  parseMargin,
  parseNumber,
} from "../_shared/deal-feed.ts";

type RequestPayload = {
  deal_id?: string;
  outcome_type?: "won" | "lost" | "in_progress";
  actual_return?: number | null;
  duration_days?: number | null;
  notes?: string | null;
};

const AGENT_NAME = "update-deal-outcome";
const ALLOWED_OUTCOMES = new Set(["won", "lost", "in_progress"]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOutcome(value: unknown) {
  const normalized = normalizeString(value).toLowerCase();
  return ALLOWED_OUTCOMES.has(normalized) ? normalized : null;
}

serve(
  createAgentHandler(
    {
      agentName: AGENT_NAME,
      requiredFields: [
        { name: "deal_id", type: "string", uuid: true },
        { name: "outcome_type", type: "string" },
      ],
    },
    async (req) => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceKey) {
        return jsonResponse(
          { error: "Supabase environment variables not set" },
          500,
        );
      }

      try {
        const payload = await req.json() as RequestPayload;
        const dealId = normalizeString(payload.deal_id);
        const outcomeType = normalizeOutcome(payload.outcome_type);
        const actualReturn = payload.actual_return === null ||
            payload.actual_return === undefined
          ? null
          : parseMargin(payload.actual_return);
        const durationDays = payload.duration_days === null ||
            payload.duration_days === undefined
          ? null
          : Math.max(0, Math.trunc(Number(payload.duration_days)));
        const notes = normalizeString(payload.notes) || null;

        if (!outcomeType) {
          return jsonResponse({
            error: "outcome_type must be one of won, lost, in_progress",
          }, 400);
        }

        if (payload.duration_days !== undefined && durationDays === null) {
          return jsonResponse({ error: "duration_days must be a number" }, 400);
        }

        const supabase = createClient(supabaseUrl, serviceKey);
        const [dealResult, feedResult, financialResult, allocationResult, feedbackResult] =
          await Promise.all([
            supabase.from("deals").select("id").eq("id", dealId).maybeSingle(),
            supabase
              .from("deal_feed")
              .select(
                "deal_id, score, priority_score, metadata, created_at, updated_at",
              )
              .eq("deal_id", dealId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("financial_snapshots")
              .select("deal_id, metadata, created_at")
              .eq("deal_id", dealId)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase
              .from("capital_allocations")
              .select("expected_return, allocation_status, updated_at")
              .eq("deal_id", dealId)
              .limit(1)
              .maybeSingle(),
            supabase
              .from("scoring_feedback")
              .select("adjusted_weights, created_at")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ]);

        if (dealResult.error) throw new Error(dealResult.error.message);
        if (!dealResult.data) return jsonResponse({ error: "Deal not found" }, 404);
        if (feedResult.error) throw new Error(feedResult.error.message);
        if (financialResult.error) throw new Error(financialResult.error.message);
        if (allocationResult.error) throw new Error(allocationResult.error.message);
        if (feedbackResult.error) throw new Error(feedbackResult.error.message);

        const predictedPriorityScore = parseNumber(feedResult.data?.priority_score) ??
          parseNumber(feedResult.data?.score);
        const predictedReturn = parseMargin(allocationResult.data?.expected_return) ??
          getMarginFromFinancialMetadata(financialResult.data?.metadata ?? null) ??
          getMarginFromFeedMetadata(feedResult.data?.metadata ?? null);

        const { data: outcomeRow, error: outcomeError } = await supabase
          .from("deal_outcomes")
          .insert({
            deal_id: dealId,
            outcome_type: outcomeType,
            actual_return: actualReturn,
            duration_days: durationDays,
            notes,
          })
          .select(
            "id, deal_id, outcome_type, actual_return, duration_days, notes, created_at",
          )
          .single();

        if (outcomeError) throw new Error(outcomeError.message);

        const { data: performanceRow, error: performanceError } = await supabase
          .rpc("sync_deal_performance_outcome_metrics", { p_deal_id: dealId })
          .single();

        if (performanceError) throw new Error(performanceError.message);

        let scoringFeedback: Record<string, unknown> | null = null;
        if (actualReturn !== null) {
          const nextFeedback = adjustScoringWeights({
            previousWeights: feedbackResult.data?.adjusted_weights ?? null,
            outcomeType,
            predictedReturn,
            actualReturn,
            predictedPriorityScore,
          });

          const feedbackNotes = [
            `Outcome ${outcomeType}`,
            predictedReturn !== null
              ? `predicted return ${(predictedReturn * 100).toFixed(2)}%`
              : "predicted return unavailable",
            `actual return ${(actualReturn * 100).toFixed(2)}%`,
            `delta ${(nextFeedback.returnDelta * 100).toFixed(2)}%`,
          ].join("; ");

          const { data: feedbackRow, error: insertFeedbackError } = await supabase
            .from("scoring_feedback")
            .insert({
              deal_id: dealId,
              outcome_type: outcomeType,
              predicted_priority_score: predictedPriorityScore,
              predicted_return: predictedReturn,
              actual_return: actualReturn,
              adjustment_factor: nextFeedback.adjustmentFactor,
              previous_weights: nextFeedback.previousWeights,
              adjusted_weights: nextFeedback.adjustedWeights,
              notes: feedbackNotes,
            })
            .select(
              "id, deal_id, outcome_type, predicted_priority_score, predicted_return, actual_return, adjustment_factor, previous_weights, adjusted_weights, notes, created_at, updated_at",
            )
            .single();

          if (insertFeedbackError) throw new Error(insertFeedbackError.message);
          scoringFeedback = feedbackRow as Record<string, unknown>;
        }

        const { error: actionError } = await supabase.from("ai_actions").insert({
          deal_id: dealId,
          agent: AGENT_NAME,
          action: "deal_outcome_updated",
          payload: {
            outcome_id: outcomeRow.id,
            outcome_type: outcomeType,
            actual_return: actualReturn,
            duration_days: durationDays,
            predicted_priority_score: predictedPriorityScore,
            predicted_return: predictedReturn,
            scoring_feedback_id: scoringFeedback?.id ?? null,
          },
        });

        if (actionError) throw new Error(actionError.message);

        return jsonResponse({
          success: true,
          outcome: outcomeRow,
          deal_performance: performanceRow,
          scoring_feedback: scoringFeedback,
        });
      } catch (error) {
        return jsonResponse({ error: getErrorMessage(error) }, 500);
      }
    },
  ),
);
