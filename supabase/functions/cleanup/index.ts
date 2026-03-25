import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type CleanupPayload = {
  usage_metrics_retention_days?: number;
  realtime_retention_days?: number;
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

serve(createAgentHandler({
  agentName: "cleanup",
  allowWhenDisabled: true,
  skipRateLimit: true,
}, async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  try {
    let payload: CleanupPayload = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const usageRetentionDays = typeof payload.usage_metrics_retention_days === "number" &&
        Number.isFinite(payload.usage_metrics_retention_days)
      ? Math.max(1, Math.trunc(payload.usage_metrics_retention_days))
      : 30;
    const realtimeRetentionDays = typeof payload.realtime_retention_days === "number" &&
        Number.isFinite(payload.realtime_retention_days)
      ? Math.max(1, Math.trunc(payload.realtime_retention_days))
      : 7;

    const supabase = createClient(supabaseUrl, serviceKey);
    const usageCutoff = new Date(Date.now() - usageRetentionDays * 24 * 60 * 60 * 1000).toISOString();
    const realtimeCutoff = new Date(Date.now() - realtimeRetentionDays * 24 * 60 * 60 * 1000).toISOString();

    const [usageDelete, realtimeDelete, retryUpdate] = await Promise.all([
      supabase.from("usage_metrics").delete().lt("timestamp", usageCutoff).select("id"),
      supabase.from("deal_feed_realtime_fallback").delete().lt("created_at", realtimeCutoff).select("deal_id"),
      supabase
        .from("agent_retry_queue")
        .update({
          status: "failed",
          last_error: "Marked failed during cleanup after reaching max retries",
        })
        .gte("retry_count", 3)
        .in("status", ["queued", "retrying"])
        .select("id"),
    ]);

    if (usageDelete.error) throw new Error(usageDelete.error.message);
    if (realtimeDelete.error) throw new Error(realtimeDelete.error.message);
    if (retryUpdate.error) throw new Error(retryUpdate.error.message);

    const result = {
      usage_metrics_deleted: usageDelete.data?.length ?? 0,
      realtime_events_deleted: realtimeDelete.data?.length ?? 0,
      retry_rows_failed: retryUpdate.data?.length ?? 0,
    };

    const { error: logError } = await supabase.from("ai_actions").insert({
      agent: "cleanup",
      action: "cleanup_completed",
      payload: {
        usage_metrics_retention_days: usageRetentionDays,
        realtime_retention_days: realtimeRetentionDays,
        result,
      },
    });

    if (logError) throw new Error(logError.message);

    return jsonResponse({
      success: true,
      cleaned_at: new Date().toISOString(),
      result,
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
