import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

const HIGH_PRIORITY_SCORE_THRESHOLD = 85;
const HIGH_PRIORITY_DEAL_SCORE_THRESHOLD = 80;
const RECENT_WINDOW_HOURS = 24;
const REPORT_WINDOW_DAYS = 7;

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
  agentName: "get-operator-summary",
  allowWhenDisabled: true,
  skipRateLimit: true,
}, async () => {
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
    const recentNotificationCutoff = new Date(
      Date.now() - RECENT_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();
    const recentReportCutoff = new Date(
      Date.now() - REPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [
      activeDealsResult,
      highPriorityFeedResult,
      recentNotificationsResult,
      pendingRetriesResult,
      latestHealthResult,
      recentReportsResult,
    ] = await Promise.all([
      supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("deal_feed")
        .select("deal_id, score, priority_score")
        .neq("status", "archived"),
      supabase
        .from("ai_actions")
        .select("id", { count: "exact", head: true })
        .eq("agent", "notification-agent")
        .eq("action", "deal_alert")
        .gte("created_at", recentNotificationCutoff),
      supabase
        .from("agent_retry_queue")
        .select("id", { count: "exact", head: true })
        .in("status", ["queued", "retrying"]),
      supabase
        .from("system_health")
        .select("component, status, error_message, last_checked")
        .order("last_checked", { ascending: false })
        .limit(25),
      supabase
        .from("report_index")
        .select("id", { count: "exact", head: true })
        .gte("created_at", recentReportCutoff),
    ]);

    if (activeDealsResult.error) throw new Error(activeDealsResult.error.message);
    if (highPriorityFeedResult.error) {
      throw new Error(highPriorityFeedResult.error.message);
    }
    if (recentNotificationsResult.error) {
      throw new Error(recentNotificationsResult.error.message);
    }
    if (pendingRetriesResult.error) {
      throw new Error(pendingRetriesResult.error.message);
    }
    if (latestHealthResult.error) {
      throw new Error(latestHealthResult.error.message);
    }
    if (recentReportsResult.error) {
      throw new Error(recentReportsResult.error.message);
    }

    const highPriorityDealIds = new Set<string>();
    for (const row of highPriorityFeedResult.data ?? []) {
      const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
      const priorityScore = typeof row.priority_score === "number"
        ? row.priority_score
        : Number(row.priority_score ?? NaN);
      const score = typeof row.score === "number" ? row.score : Number(row.score ?? NaN);

      if (!dealId) continue;
      if (
        (Number.isFinite(priorityScore) &&
          priorityScore >= HIGH_PRIORITY_SCORE_THRESHOLD) ||
        (Number.isFinite(score) && score >= HIGH_PRIORITY_DEAL_SCORE_THRESHOLD)
      ) {
        highPriorityDealIds.add(dealId);
      }
    }

    const latestHealthRows = latestHealthResult.data ?? [];
    const latestHealthTimestamp = typeof latestHealthRows[0]?.last_checked === "string"
      ? latestHealthRows[0].last_checked
      : null;
    const latestHealthSnapshot = latestHealthTimestamp
      ? latestHealthRows.filter((row) => row.last_checked === latestHealthTimestamp)
      : [];
    const latestHealthStatus = latestHealthSnapshot.some((row) =>
        row.status === "error"
      )
      ? "error"
      : latestHealthSnapshot.some((row) => row.status === "warning")
      ? "warning"
      : latestHealthSnapshot.length > 0
      ? "healthy"
      : null;

    return jsonResponse({
      success: true,
      total_active_deals: activeDealsResult.count ?? 0,
      total_high_priority_deals: highPriorityDealIds.size,
      recent_notifications_count: recentNotificationsResult.count ?? 0,
      pending_retries_count: pendingRetriesResult.count ?? 0,
      latest_system_health_status: latestHealthStatus,
      latest_generated_reports_count: recentReportsResult.count ?? 0,
      latest_system_health_checked_at: latestHealthTimestamp,
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
