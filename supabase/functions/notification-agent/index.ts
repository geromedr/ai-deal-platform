import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import {
  classifyNotificationType,
  computePriorityScore,
  getMarginFromFeedMetadata,
  getMarginFromFinancialMetadata,
  getStrategyFromDeal,
  incrementDealPerformanceMetrics,
  matchesUserPreferences,
  normalizeNotificationLevel,
  notificationLevelAllows,
  parseNumber,
} from "../_shared/deal-feed.ts";

type NotificationAgentRequest = {
  deal_feed_id?: string;
  deal_id?: string;
  score?: number | null;
  priority_score?: number | null;
  trigger_event?: string;
  summary?: string;
};

type UserPreferenceRow = {
  id: string;
  user_id: string;
  min_score?: number | null;
  preferred_strategy?: string | null;
  notification_level?: string | null;
};

const DEFAULT_AGENT_NAME = "notification-agent";
const NOTIFICATION_ACTION = "deal_alert";
const DECISION_ACTION = "notification_decision";
const DEFAULT_THROTTLE_MINUTES = 1440;

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function resolvePriorityContext(
  supabase: any,
  deal_feed_id: string,
  deal_id: string,
) {
  const { data: feedRow, error: feedError } = await supabase
    .from("deal_feed")
    .select("id, deal_id, score, priority_score, metadata")
    .eq("id", deal_feed_id)
    .maybeSingle();

  if (feedError) {
    throw new Error(feedError.message);
  }

  const feed = (feedRow ?? null) as Record<string, unknown> | null;

  if (feed && feed.deal_id !== deal_id) {
    throw new Error("deal_feed_id does not belong to deal_id");
  }

  const [financialsResult, siteResult, risksResult, dealResult] = await Promise
    .all([
      supabase
        .from("financial_snapshots")
        .select("metadata, created_at")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("site_intelligence")
        .select("flood_risk, updated_at")
        .eq("deal_id", deal_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("risks")
        .select("severity, status")
        .eq("deal_id", deal_id),
      supabase
        .from("deals")
        .select("metadata")
        .eq("id", deal_id)
        .maybeSingle(),
    ]);

  if (financialsResult.error) {
    throw new Error(financialsResult.error.message);
  }

  if (siteResult.error) {
    throw new Error(siteResult.error.message);
  }

  if (risksResult.error) {
    throw new Error(risksResult.error.message);
  }

  if (dealResult.error) {
    throw new Error(dealResult.error.message);
  }

  const latestFinancial = (financialsResult.data ?? null) as
    | Record<string, unknown>
    | null;
  const latestSite = (siteResult.data ?? null) as
    | Record<string, unknown>
    | null;
  const riskRows = (risksResult.data ?? []) as Array<Record<string, unknown>>;

  const feedMargin = getMarginFromFeedMetadata(feed?.metadata ?? null);
  const latestFinancialMargin = getMarginFromFinancialMetadata(
    latestFinancial?.metadata ?? null,
  );
  const score = parseNumber(feed?.score ?? null);
  const priorityScore = parseNumber(feed?.priority_score ?? null) ??
    computePriorityScore({
      score,
      margin: feedMargin ?? latestFinancialMargin,
      floodRisk: typeof latestSite?.flood_risk === "string"
        ? latestSite.flood_risk
        : null,
      risks: riskRows.map((row) => ({
        severity: typeof row.severity === "string" ? row.severity : null,
        status: typeof row.status === "string" ? row.status : null,
      })),
    });

  return {
    score,
    priority_score: priorityScore,
    strategy: getStrategyFromDeal(
      (dealResult.data ?? null) as Record<string, unknown> | null,
    ),
  };
}

function getEnvNumber(name: string, fallback: number) {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchUserPreferences(
  supabase: any,
): Promise<UserPreferenceRow[]> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("id, user_id, min_score, preferred_strategy, notification_level");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).filter(
    (row): row is UserPreferenceRow =>
      typeof row.id === "string" && typeof row.user_id === "string",
  );
}

async function wasRecentlyNotified(
  supabase: any,
  deal_id: string,
  user_id: string,
  throttleMinutes: number,
) {
  const cutoff = new Date(Date.now() - throttleMinutes * 60_000).toISOString();
  const { data, error } = await supabase
    .from("ai_actions")
    .select("id, created_at")
    .eq("deal_id", deal_id)
    .eq("agent", DEFAULT_AGENT_NAME)
    .eq("action", NOTIFICATION_ACTION)
    .contains("payload", { user_id })
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

async function logDecision(
  supabase: any,
  input: {
    deal_id: string;
    deal_feed_id: string;
    user_id: string;
    decision: "sent" | "suppressed";
    reason: string;
    notification_type: string;
    priority_score: number | null;
    score: number | null;
    trigger_event: string;
    summary: string;
  },
) {
  const { error } = await supabase.from("ai_actions").insert({
    deal_id: input.deal_id,
    agent: DEFAULT_AGENT_NAME,
    action: DECISION_ACTION,
    source: "deal_feed",
    payload: input,
  });

  if (error) {
    throw new Error(error.message);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500);
  if (!serviceKey) {
    return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500);
  }

  try {
    const payload = await req.json() as NotificationAgentRequest;
    const deal_feed_id = typeof payload.deal_feed_id === "string"
      ? payload.deal_feed_id.trim()
      : "";
    const deal_id = typeof payload.deal_id === "string"
      ? payload.deal_id.trim()
      : "";
    const trigger_event = typeof payload.trigger_event === "string"
      ? payload.trigger_event.trim()
      : "";
    const summary = typeof payload.summary === "string"
      ? payload.summary.trim()
      : "";
    const score =
      typeof payload.score === "number" && Number.isFinite(payload.score)
        ? payload.score
        : null;
    let priorityScore = typeof payload.priority_score === "number" &&
        Number.isFinite(payload.priority_score)
      ? payload.priority_score
      : null;

    if (!deal_feed_id || !deal_id || !trigger_event || !summary) {
      return jsonResponse({
        error: "Missing required notification fields",
        received: payload,
      }, 400);
    }

    if (!isUuid(deal_feed_id) || !isUuid(deal_id)) {
      return jsonResponse(
        {
          error: "deal_feed_id and deal_id must be valid UUIDs",
          received: payload,
        },
        400,
      );
    }

    console.log("notification-agent request received", {
      deal_feed_id,
      deal_id,
      trigger_event,
    });

    const supabase = createClient(supabaseUrl, serviceKey);
    const throttleMinutes = getEnvNumber(
      "NOTIFICATION_THROTTLE_MINUTES",
      DEFAULT_THROTTLE_MINUTES,
    );

    let resolvedScore = score;
    let resolvedStrategy: string | null = null;

    if (
      priorityScore === null || resolvedScore === null ||
      resolvedStrategy === null
    ) {
      const resolved = await resolvePriorityContext(
        supabase,
        deal_feed_id,
        deal_id,
      );
      if (resolvedScore === null) {
        resolvedScore = resolved.score;
      }
      if (priorityScore === null) {
        priorityScore = resolved.priority_score;
      }
      resolvedStrategy = resolved.strategy;
    }

    const notificationType = classifyNotificationType({
      score: resolvedScore,
      priorityScore,
    });
    const userPreferences = await fetchUserPreferences(supabase);
    const decisionResults: Array<Record<string, unknown>> = [];
    const notifications: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];

    if (userPreferences.length === 0) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: "No user preferences configured",
      });
    }

    for (const preference of userPreferences) {
      const normalizedLevel = normalizeNotificationLevel(
        preference.notification_level,
      );
      let decision = "sent";
      let reason = "Preference matched";

      if (
        !matchesUserPreferences({
          score: resolvedScore,
          strategy: resolvedStrategy,
          preferences: preference,
        })
      ) {
        decision = "suppressed";
        reason = "Deal did not match user preferences";
      } else if (!notificationLevelAllows(normalizedLevel, notificationType)) {
        decision = "suppressed";
        reason = "Suppressed by notification_level";
      } else {
        const throttledAction = await wasRecentlyNotified(
          supabase,
          deal_id,
          preference.user_id,
          throttleMinutes,
        );

        if (throttledAction) {
          decision = "suppressed";
          reason = `Suppressed by ${throttleMinutes}-minute throttle window`;
        }
      }

      await logDecision(supabase, {
        deal_id,
        deal_feed_id,
        user_id: preference.user_id,
        decision: decision as "sent" | "suppressed",
        reason,
        notification_type: notificationType,
        priority_score: priorityScore,
        score: resolvedScore,
        trigger_event,
        summary,
      });

      if (decision === "suppressed") {
        decisionResults.push({
          user_id: preference.user_id,
          decision,
          reason,
          notification_level: normalizedLevel,
        });
        continue;
      }

      const notificationPayload = {
        type: NOTIFICATION_ACTION,
        user_id: preference.user_id,
        notification_type: notificationType,
        deal_feed_id,
        deal_id,
        score: resolvedScore,
        priority_score: priorityScore,
        trigger_event,
        summary,
        throttle_minutes: throttleMinutes,
      };

      const { data: notification, error: insertError } = await supabase
        .from("ai_actions")
        .insert({
          deal_id,
          agent: DEFAULT_AGENT_NAME,
          action: NOTIFICATION_ACTION,
          source: "deal_feed",
          payload: notificationPayload,
        })
        .select("id, deal_id, agent, action, source, payload, created_at")
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      notifications.push(notification);
      decisionResults.push({
        user_id: preference.user_id,
        decision,
        reason,
        notification_level: normalizedLevel,
        notification_id: notification.id,
      });
    }

    if (notifications.length > 0) {
      try {
        await incrementDealPerformanceMetrics(supabase, {
          deal_id,
          notifications_sent: notifications.length,
        });
      } catch (error) {
        warnings.push(getErrorMessage(error));
      }
    }

    console.log("notification-agent decisions logged", {
      deal_feed_id,
      deal_id,
      notification_type: notificationType,
      sent_count: notifications.length,
      decision_count: decisionResults.length,
    });

    return jsonResponse({
      success: true,
      skipped: notifications.length === 0,
      notification_type: notificationType,
      notifications,
      decisions: decisionResults,
      warnings,
    });
  } catch (error) {
    console.error("notification-agent failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
