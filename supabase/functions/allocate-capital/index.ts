import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  getMarginFromFeedMetadata,
  getMarginFromFinancialMetadata,
  parseNumber,
} from "../_shared/deal-feed.ts";

type RequestPayload = {
  capital_pool?: number;
  max_deals?: number;
  allocation_status?: "proposed" | "committed" | "deployed";
  minimum_priority_score?: number;
};

const AGENT_NAME = "allocate-capital";
const DEFAULT_MAX_DEALS = 5;
const MAX_DEALS = 25;
const ALLOWED_STATUSES = new Set(["proposed", "committed", "deployed"]);

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

function clampMaxDeals(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_DEALS;
  return Math.min(Math.trunc(parsed), MAX_DEALS);
}

function normalizeStatus(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ALLOWED_STATUSES.has(normalized) ? normalized : "proposed";
}

serve(
  createAgentHandler(
    {
      agentName: AGENT_NAME,
      requiredFields: [{ name: "capital_pool", type: "number" }],
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
        const capitalPool = typeof payload.capital_pool === "number" &&
            Number.isFinite(payload.capital_pool)
          ? payload.capital_pool
          : Number.NaN;
        const maxDeals = clampMaxDeals(payload.max_deals);
        const allocationStatus = normalizeStatus(payload.allocation_status);
        const minimumPriorityScore = parseNumber(payload.minimum_priority_score);

        if (!Number.isFinite(capitalPool) || capitalPool <= 0) {
          return jsonResponse(
            { error: "capital_pool must be a positive number" },
            400,
          );
        }

        const supabase = createClient(supabaseUrl, serviceKey);
        const [feedResult, allocationResult] = await Promise.all([
          supabase
            .from("deal_feed")
            .select(
              "deal_id, score, priority_score, summary, metadata, created_at, updated_at, status",
            )
            .neq("status", "archived")
            .order("priority_score", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(250),
          supabase
            .from("capital_allocations")
            .select("deal_id"),
        ]);

        if (feedResult.error) throw new Error(feedResult.error.message);
        if (allocationResult.error) throw new Error(allocationResult.error.message);

        const allocatedDealIds = new Set(
          (allocationResult.data ?? [])
            .map((row) => (typeof row.deal_id === "string" ? row.deal_id : null))
            .filter((value): value is string => value !== null),
        );

        const topFeedByDeal = new Map<string, Record<string, unknown>>();
        for (const row of feedResult.data ?? []) {
          const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
          if (!dealId || allocatedDealIds.has(dealId) || topFeedByDeal.has(dealId)) {
            continue;
          }

          const priorityScore = parseNumber(row.priority_score) ??
            parseNumber(row.score);
          if (
            minimumPriorityScore !== null &&
            (priorityScore ?? Number.NEGATIVE_INFINITY) < minimumPriorityScore
          ) {
            continue;
          }

          topFeedByDeal.set(dealId, row as Record<string, unknown>);
        }

        const selectedFeedRows = Array.from(topFeedByDeal.values()).slice(0, maxDeals);

        if (selectedFeedRows.length === 0) {
          return jsonResponse({
            success: true,
            skipped: true,
            reason: "No eligible deals available for allocation",
            capital_pool: capitalPool,
            allocation_status: allocationStatus,
            allocations: [],
          });
        }

        const dealIds = selectedFeedRows
          .map((row) => (typeof row.deal_id === "string" ? row.deal_id : null))
          .filter((value): value is string => value !== null);

        const { data: financialRows, error: financialError } = await supabase
          .from("financial_snapshots")
          .select("deal_id, metadata, created_at")
          .in("deal_id", dealIds)
          .order("created_at", { ascending: false });

        if (financialError) throw new Error(financialError.message);

        const financialByDeal = new Map<string, Record<string, unknown>>();
        for (const row of financialRows ?? []) {
          if (typeof row.deal_id === "string" && !financialByDeal.has(row.deal_id)) {
            financialByDeal.set(row.deal_id, row as Record<string, unknown>);
          }
        }

        const selectedDeals = selectedFeedRows.map((row) => {
          const dealId = String(row.deal_id);
          const priorityScore = Math.max(
            parseNumber(row.priority_score) ?? parseNumber(row.score) ?? 0,
            0,
          );
          const financialRow = financialByDeal.get(dealId) ?? null;
          const expectedReturn = getMarginFromFeedMetadata(row.metadata ?? null) ??
            getMarginFromFinancialMetadata(financialRow?.metadata ?? null);

          return {
            deal_id: dealId,
            priority_score: priorityScore,
            score: parseNumber(row.score) ?? null,
            expected_return: expectedReturn,
            summary: typeof row.summary === "string" ? row.summary : null,
          };
        });

        const totalPriority = selectedDeals.reduce(
          (sum, deal) => sum + Math.max(deal.priority_score, 0),
          0,
        );
        const equalShare = capitalPool / selectedDeals.length;
        let allocatedRunningTotal = 0;

        const allocationRows = selectedDeals.map((deal, index) => {
          const weightedAmount = totalPriority > 0
            ? (capitalPool * deal.priority_score) / totalPriority
            : equalShare;
          const roundedAmount = index === selectedDeals.length - 1
            ? Number((capitalPool - allocatedRunningTotal).toFixed(2))
            : Number(weightedAmount.toFixed(2));
          allocatedRunningTotal = Number(
            (allocatedRunningTotal + roundedAmount).toFixed(2),
          );

          return {
            deal_id: deal.deal_id,
            allocated_amount: roundedAmount,
            allocation_status: allocationStatus,
            expected_return: deal.expected_return,
          };
        });

        const { data: insertedRows, error: insertError } = await supabase
          .from("capital_allocations")
          .insert(allocationRows)
          .select(
            "id, deal_id, allocated_amount, allocation_status, expected_return, created_at, updated_at",
          );

        if (insertError) throw new Error(insertError.message);

        const { error: actionError } = await supabase.from("ai_actions").insert({
          agent: AGENT_NAME,
          action: "capital_allocated",
          payload: {
            capital_pool: capitalPool,
            allocation_status: allocationStatus,
            minimum_priority_score: minimumPriorityScore,
            allocated_count: insertedRows?.length ?? 0,
            allocations: allocationRows.map((row) => ({
              deal_id: row.deal_id,
              allocated_amount: row.allocated_amount,
              expected_return: row.expected_return,
            })),
          },
        });

        if (actionError) throw new Error(actionError.message);

        return jsonResponse({
          success: true,
          capital_pool: capitalPool,
          allocation_status: allocationStatus,
          allocated_count: insertedRows?.length ?? 0,
          allocations: (insertedRows ?? []).map((row) => ({
            id: row.id,
            deal_id: row.deal_id,
            allocated_amount: row.allocated_amount,
            allocation_status: row.allocation_status,
            expected_return: row.expected_return,
            created_at: row.created_at,
            updated_at: row.updated_at,
          })),
        });
      } catch (error) {
        return jsonResponse({ error: getErrorMessage(error) }, 500);
      }
    },
  ),
);
