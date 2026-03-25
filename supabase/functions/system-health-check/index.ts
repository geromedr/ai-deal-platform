import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type HealthStatus = "healthy" | "warning" | "error";

const AGENT_NAME = "system-health-check";
const KEY_AGENTS = [
  "rule-engine-agent",
  "notification-agent",
  "site-intelligence-agent",
  "site-discovery-agent",
  "get-deal-feed",
];

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

function classifyStatus(value: unknown): HealthStatus {
  if (value === "healthy" || value === "warning" || value === "error") {
    return value;
  }
  return "warning";
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
        const now = new Date();
        const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
          .toISOString();
        const recentCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000)
          .toISOString();
        const checks: Array<Record<string, unknown>> = [];

        const { error: dbError } = await supabase
          .from("agent_registry")
          .select("id")
          .limit(1);

        checks.push({
          component: "database",
          status: dbError ? "error" : "healthy",
          error_message: dbError?.message ?? null,
        });

        const { data: agentRows, error: agentError } = await supabase
          .from("agent_registry")
          .select("agent_name, status, last_run, last_error")
          .in("agent_name", KEY_AGENTS);

        if (agentError) {
          checks.push({
            component: "agent_registry",
            status: "error",
            error_message: agentError.message,
          });
        } else {
          for (const agentName of KEY_AGENTS) {
            const row = (agentRows ?? []).find((entry) =>
              entry.agent_name === agentName
            );

            let status: HealthStatus = "healthy";
            let errorMessage: string | null = null;

            if (!row) {
              status = "error";
              errorMessage = "Agent not found in registry";
            } else if (row.status === "error") {
              status = "error";
              errorMessage = row.last_error ?? "Agent registry status is error";
            } else if (
              typeof row.last_run === "string" &&
              row.last_run < staleCutoff
            ) {
              status = "warning";
              errorMessage = "No recent execution recorded in the last 24 hours";
            }

            checks.push({
              component: agentName,
              status,
              error_message: errorMessage,
            });
          }
        }

        const { count: recentActionCount, error: actionError } = await supabase
          .from("ai_actions")
          .select("id", { count: "exact", head: true })
          .gte("created_at", recentCutoff);

        checks.push({
          component: "recent_activity",
          status: actionError
            ? "error"
            : (recentActionCount ?? 0) > 0
            ? "healthy"
            : "warning",
          error_message: actionError?.message ??
            ((recentActionCount ?? 0) > 0
              ? null
              : "No ai_actions rows recorded in the last 6 hours"),
        });

        const { count: recentFeedCount, error: feedError } = await supabase
          .from("deal_feed")
          .select("id", { count: "exact", head: true })
          .gte("updated_at", recentCutoff);

        checks.push({
          component: "deal_feed",
          status: feedError
            ? "error"
            : (recentFeedCount ?? 0) > 0
            ? "healthy"
            : "warning",
          error_message: feedError?.message ??
            ((recentFeedCount ?? 0) > 0
              ? null
              : "No deal_feed activity recorded in the last 6 hours"),
        });

        for (const check of checks) {
          await supabase.from("system_health").upsert(
            {
              component: String(check.component),
              status: classifyStatus(check.status),
              last_checked: now.toISOString(),
              error_message: typeof check.error_message === "string"
                ? check.error_message
                : null,
            },
            { onConflict: "component" },
          );
        }

        const overallStatus: HealthStatus = checks.some((check) =>
            check.status === "error"
          )
          ? "error"
          : checks.some((check) => check.status === "warning")
          ? "warning"
          : "healthy";

        return jsonResponse({
          success: true,
          status: overallStatus,
          checked_at: now.toISOString(),
          checks,
        });
      } catch (error) {
        return jsonResponse({ error: getErrorMessage(error) }, 500);
      }
    },
  ),
);

