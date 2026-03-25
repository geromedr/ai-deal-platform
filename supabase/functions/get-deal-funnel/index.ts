import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

const AGENT_NAME = "get-deal-funnel";
const STAGES = ["active", "reviewing", "approved", "funded", "completed"] as const;

type StageName = (typeof STAGES)[number];

type DealRow = {
  id: string;
  status?: string | null;
  created_at?: string | null;
};

type TransitionRow = {
  deal_id?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown): StageName | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return STAGES.includes(normalized as StageName) ? normalized as StageName : null;
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function toDays(start: number, end: number) {
  return Number((((end - start) / (1000 * 60 * 60 * 24))).toFixed(2));
}

serve(
  createAgentHandler(
    {
      agentName: AGENT_NAME,
      allowWhenDisabled: true,
      skipRateLimit: true,
    },
    async () => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceKey) {
        return jsonResponse(
          { error: "Supabase environment variables not set" },
          500,
        );
      }

      try {
        const supabase = createClient(supabaseUrl, serviceKey);
        const [dealsResult, transitionsResult] = await Promise.all([
          supabase
            .from("deals")
            .select("id, status, created_at")
            .in("status", [...STAGES]),
          supabase
            .from("ai_actions")
            .select("deal_id, created_at, payload")
            .eq("action", "status_transition")
            .order("created_at", { ascending: true }),
        ]);

        if (dealsResult.error) throw new Error(dealsResult.error.message);
        if (transitionsResult.error) throw new Error(transitionsResult.error.message);

        const deals = (dealsResult.data ?? []) as DealRow[];
        const transitionsByDeal = new Map<string, Array<{
          to_status: StageName;
          created_at: string;
        }>>();

        for (const row of (transitionsResult.data ?? []) as TransitionRow[]) {
          const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
          const payload = isRecord(row.payload) ? row.payload : null;
          const toStatus = normalizeStatus(payload?.to_status);
          const createdAt = typeof row.created_at === "string" ? row.created_at : null;

          if (!dealId || !toStatus || !createdAt) continue;
          const existing = transitionsByDeal.get(dealId) ?? [];
          existing.push({ to_status: toStatus, created_at: createdAt });
          transitionsByDeal.set(dealId, existing);
        }

        const counts = Object.fromEntries(
          STAGES.map((stage) => [stage, 0]),
        ) as Record<StageName, number>;
        const durations = Object.fromEntries(
          STAGES.map((stage) => [stage, [] as number[]]),
        ) as Record<StageName, number[]>;
        const now = Date.now();

        for (const deal of deals) {
          const currentStatus = normalizeStatus(deal.status) ?? "active";
          counts[currentStatus] += 1;

          const createdAt = parseTimestamp(deal.created_at);
          if (createdAt === null) continue;

          const transitions = (transitionsByDeal.get(deal.id) ?? [])
            .filter((entry) => parseTimestamp(entry.created_at) !== null)
            .sort((left, right) =>
              Number(parseTimestamp(left.created_at)) -
              Number(parseTimestamp(right.created_at))
            );

          for (let index = 0; index < STAGES.length; index++) {
            const stage = STAGES[index];
            const nextStage = STAGES[index + 1] ?? null;
            const entryAt = stage === "active"
              ? createdAt
              : parseTimestamp(
                transitions.find((entry) => entry.to_status === stage)?.created_at,
              );

            if (entryAt === null) continue;

            const exitAt = nextStage
              ? parseTimestamp(
                transitions.find((entry) =>
                  entry.to_status === nextStage &&
                  Number(parseTimestamp(entry.created_at)) > entryAt
                )?.created_at,
              )
              : null;

            if (exitAt !== null) {
              durations[stage].push(toDays(entryAt, exitAt));
              continue;
            }

            if (currentStatus === stage) {
              durations[stage].push(toDays(entryAt, now));
            }
          }
        }

        const stages = STAGES.map((stage, index) => {
          const previousStage = index > 0 ? STAGES[index - 1] : null;
          const previousCount = previousStage ? counts[previousStage] : null;
          const conversionRate = previousCount && previousCount > 0
            ? Number(((counts[stage] / previousCount) * 100).toFixed(2))
            : null;
          const averageTime = durations[stage].length > 0
            ? Number(
              (
                durations[stage].reduce((sum, value) => sum + value, 0) /
                durations[stage].length
              ).toFixed(2),
            )
            : null;

          return {
            stage,
            count: counts[stage],
            conversion_rate_from_previous: conversionRate,
            average_time_days: averageTime,
          };
        });

        return jsonResponse({
          success: true,
          generated_at: new Date(now).toISOString(),
          total_deals: deals.length,
          stages,
          conversion_rates: stages
            .filter((stage) => stage.conversion_rate_from_previous !== null)
            .map((stage) => ({
              from_stage: STAGES[Math.max(STAGES.indexOf(stage.stage as StageName) - 1, 0)],
              to_stage: stage.stage,
              conversion_rate: stage.conversion_rate_from_previous,
            })),
        });
      } catch (error) {
        return jsonResponse({ error: getErrorMessage(error) }, 500);
      }
    },
  ),
);
