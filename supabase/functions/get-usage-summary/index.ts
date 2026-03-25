import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type UsageRow = {
  agent_name?: string | null;
  calls?: number | null;
  estimated_cost?: number | null;
  timestamp?: string | null;
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

function summarizeUsage(rows: UsageRow[], cutoffIso: string) {
  const summary = new Map<string, { agent_name: string; calls: number; estimated_cost: number }>();

  for (const row of rows) {
    const agentName = typeof row.agent_name === "string" && row.agent_name.trim().length > 0
      ? row.agent_name.trim()
      : null;
    if (!agentName) continue;
    if (typeof row.timestamp === "string" && row.timestamp < cutoffIso) continue;

    const current = summary.get(agentName) ?? {
      agent_name: agentName,
      calls: 0,
      estimated_cost: 0,
    };
    const calls = typeof row.calls === "number" ? row.calls : Number(row.calls ?? 0);
    const estimatedCost = typeof row.estimated_cost === "number"
      ? row.estimated_cost
      : Number(row.estimated_cost ?? 0);

    current.calls += Number.isFinite(calls) ? calls : 0;
    current.estimated_cost += Number.isFinite(estimatedCost) ? estimatedCost : 0;
    summary.set(agentName, current);
  }

  return Array.from(summary.values())
    .sort((left, right) => {
      if (right.calls !== left.calls) return right.calls - left.calls;
      return right.estimated_cost - left.estimated_cost;
    })
    .map((row) => ({
      ...row,
      estimated_cost: Number(row.estimated_cost.toFixed(4)),
    }));
}

serve(createAgentHandler({
  agentName: "get-usage-summary",
  allowWhenDisabled: true,
  skipRateLimit: true,
}, async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const now = new Date();
    const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from("usage_metrics")
      .select("agent_name, calls, estimated_cost, timestamp")
      .gte("timestamp", cutoff7d)
      .order("timestamp", { ascending: false });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as UsageRow[];

    return jsonResponse({
      success: true,
      generated_at: now.toISOString(),
      windows: {
        last_24_hours: summarizeUsage(rows, cutoff24h),
        last_7_days: summarizeUsage(rows, cutoff7d),
      },
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
