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

type DeliveryChannel = "email" | "webhook";

type DealRow = {
  id?: string;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  status?: string | null;
  stage?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ResolvedPriorityContext = {
  score: number | null;
  priority_score: number | null;
  strategy: string | null;
  deal: DealRow | null;
};

type DeliveryAttemptResult = {
  channel: DeliveryChannel;
  status: "delivered" | "failed" | "skipped";
  reason: string;
  attempts: number;
  request_payload?: Record<string, unknown>;
  response_status?: number | null;
  response_body?: string | null;
};

const DEFAULT_AGENT_NAME = "notification-agent";
const NOTIFICATION_ACTION = "deal_alert";
const DECISION_ACTION = "notification_decision";
const EMAIL_DELIVERY_ACTION = "email_delivery";
const WEBHOOK_DELIVERY_ACTION = "webhook_delivery";
const DEFAULT_THROTTLE_MINUTES = 1440;
const DEFAULT_WEBHOOK_MAX_RETRIES = 3;
const DEFAULT_WEBHOOK_RETRY_DELAY_MS = 500;

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

function getEnvNumber(name: string, fallback: number) {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvBoolean(name: string, fallback = false) {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function getOptionalEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function joinAddressParts(deal: DealRow | null) {
  const parts = [
    typeof deal?.address === "string" ? deal.address.trim() : null,
    typeof deal?.suburb === "string" ? deal.suburb.trim() : null,
    typeof deal?.state === "string" ? deal.state.trim() : null,
    typeof deal?.postcode === "string" ? deal.postcode.trim() : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(", ") : null;
}

function buildDealLink(deal_id: string) {
  const directBaseUrl = getOptionalEnv("DEAL_LINK_BASE_URL");
  if (directBaseUrl) {
    return `${directBaseUrl.replace(/\/+$/, "")}/${deal_id}`;
  }

  const appBaseUrl = getOptionalEnv("APP_BASE_URL");
  if (appBaseUrl) {
    return `${appBaseUrl.replace(/\/+$/, "")}/deals/${deal_id}`;
  }

  return `deal://${deal_id}`;
}

async function resolvePriorityContext(
  supabase: any,
  deal_feed_id: string,
  deal_id: string,
): Promise<ResolvedPriorityContext> {
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
        .select("id, address, suburb, state, postcode, status, stage, metadata")
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
  const deal = (dealResult.data ?? null) as DealRow | null;

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
    strategy: getStrategyFromDeal(deal as Record<string, unknown> | null),
    deal,
  };
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

async function logDeliveryAttempt(
  supabase: any,
  deal_id: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase.from("ai_actions").insert({
    deal_id,
    agent: DEFAULT_AGENT_NAME,
    action,
    source: "deal_feed",
    payload,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function hasDeliveredChannel(
  supabase: any,
  deal_id: string,
  deal_feed_id: string,
  action: string,
) {
  const { data, error } = await supabase
    .from("ai_actions")
    .select("id")
    .eq("deal_id", deal_id)
    .eq("agent", DEFAULT_AGENT_NAME)
    .eq("action", action)
    .contains("payload", {
      deal_feed_id,
      status: "delivered",
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

function buildHighPriorityPayload(input: {
  deal_feed_id: string;
  deal_id: string;
  score: number | null;
  priorityScore: number | null;
  trigger_event: string;
  summary: string;
  deal: DealRow | null;
}) {
  const address = joinAddressParts(input.deal);
  const dealLink = buildDealLink(input.deal_id);

  return {
    type: "high_priority_deal_notification",
    deal_feed_id: input.deal_feed_id,
    deal_id: input.deal_id,
    trigger_event: input.trigger_event,
    score: input.score,
    priority_score: input.priorityScore,
    summary: input.summary,
    deal_reference: {
      deal_id: input.deal_id,
      link: dealLink,
      address,
      status: input.deal?.status ?? null,
      stage: input.deal?.stage ?? null,
    },
    occurred_at: new Date().toISOString(),
  };
}

function buildEmailContent(
  payload: ReturnType<typeof buildHighPriorityPayload>,
) {
  const address = payload.deal_reference.address ?? "Unknown address";
  const subjectPrefix = getOptionalEnv("NOTIFICATION_EMAIL_SUBJECT_PREFIX") ??
    "[AI Deal Platform]";
  const subject = `${subjectPrefix} High-priority deal alert: ${address}`;
  const lines = [
    "High-priority deal alert",
    "",
    `Deal: ${address}`,
    `Summary: ${payload.summary}`,
    `Score: ${payload.score ?? "n/a"}`,
    `Priority score: ${payload.priority_score ?? "n/a"}`,
    `Trigger event: ${payload.trigger_event}`,
    `Reference: ${payload.deal_reference.link}`,
  ];

  const html =
    `<h1>High-priority deal alert</h1><p><strong>Deal:</strong> ${address}</p><p><strong>Summary:</strong> ${payload.summary}</p><p><strong>Score:</strong> ${
      payload.score ?? "n/a"
    }</p><p><strong>Priority score:</strong> ${
      payload.priority_score ?? "n/a"
    }</p><p><strong>Trigger event:</strong> ${payload.trigger_event}</p><p><a href="${payload.deal_reference.link}">Open deal reference</a></p>`;

  return {
    subject,
    text: lines.join("\n"),
    html,
  };
}

async function sendEmailAlert(
  supabase: any,
  payload: ReturnType<typeof buildHighPriorityPayload>,
): Promise<DeliveryAttemptResult> {
  const enabled = getEnvBoolean("NOTIFICATION_EMAIL_ENABLED", true);
  const endpoint = getOptionalEnv("NOTIFICATION_EMAIL_API_URL");
  const apiKey = getOptionalEnv("NOTIFICATION_EMAIL_API_KEY");
  const authHeader = getOptionalEnv("NOTIFICATION_EMAIL_AUTH_HEADER") ??
    "Authorization";
  const from = getOptionalEnv("NOTIFICATION_EMAIL_FROM");
  const to = (getOptionalEnv("NOTIFICATION_EMAIL_TO") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!enabled) {
    return {
      channel: "email",
      status: "skipped",
      reason: "Email delivery disabled by NOTIFICATION_EMAIL_ENABLED",
      attempts: 0,
    };
  }

  if (!endpoint || !from || to.length === 0) {
    return {
      channel: "email",
      status: "skipped",
      reason:
        "Email delivery skipped because NOTIFICATION_EMAIL_API_URL, NOTIFICATION_EMAIL_FROM, or NOTIFICATION_EMAIL_TO is not configured",
      attempts: 0,
    };
  }

  if (
    await hasDeliveredChannel(
      supabase,
      payload.deal_id,
      payload.deal_feed_id,
      EMAIL_DELIVERY_ACTION,
    )
  ) {
    return {
      channel: "email",
      status: "skipped",
      reason: "Email alert already delivered for this deal_feed_id",
      attempts: 0,
    };
  }

  const content = buildEmailContent(payload);
  const requestPayload = {
    from,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers[authHeader] = authHeader.toLowerCase() === "authorization"
      ? `Bearer ${apiKey}`
      : apiKey;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestPayload),
    });
    const responseBody = await response.text();

    if (!response.ok) {
      return {
        channel: "email",
        status: "failed",
        reason: `Email provider returned ${response.status}`,
        attempts: 1,
        request_payload: requestPayload,
        response_status: response.status,
        response_body: responseBody,
      };
    }

    return {
      channel: "email",
      status: "delivered",
      reason: "Email alert sent",
      attempts: 1,
      request_payload: requestPayload,
      response_status: response.status,
      response_body: responseBody,
    };
  } catch (error) {
    return {
      channel: "email",
      status: "failed",
      reason: getErrorMessage(error),
      attempts: 1,
      request_payload: requestPayload,
    };
  }
}

function buildWebhookRequestBody(
  payload: ReturnType<typeof buildHighPriorityPayload>,
) {
  const format = (getOptionalEnv("NOTIFICATION_WEBHOOK_FORMAT") ??
    "structured").toLowerCase();

  if (format === "slack") {
    return {
      text:
        `High-priority deal alert: ${payload.summary} (${payload.deal_reference.link})`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*High-priority deal alert*\n*Deal:* ${
              payload.deal_reference.address ?? payload.deal_id
            }\n*Summary:* ${payload.summary}\n*Score:* ${
              payload.score ?? "n/a"
            }\n*Priority score:* ${payload.priority_score ?? "n/a"}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `<${payload.deal_reference.link}|Open deal reference>`,
          },
        },
      ],
      metadata: payload,
    };
  }

  return payload;
}

async function delay(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendWebhookAlert(
  supabase: any,
  payload: ReturnType<typeof buildHighPriorityPayload>,
): Promise<DeliveryAttemptResult> {
  const endpoint = getOptionalEnv("NOTIFICATION_WEBHOOK_URL");
  const authHeader = getOptionalEnv("NOTIFICATION_WEBHOOK_AUTH_HEADER");
  const authToken = getOptionalEnv("NOTIFICATION_WEBHOOK_AUTH_TOKEN");
  const maxRetries = Math.max(
    1,
    getEnvNumber(
      "NOTIFICATION_WEBHOOK_MAX_RETRIES",
      DEFAULT_WEBHOOK_MAX_RETRIES,
    ),
  );
  const retryDelayMs = Math.max(
    0,
    getEnvNumber(
      "NOTIFICATION_WEBHOOK_RETRY_DELAY_MS",
      DEFAULT_WEBHOOK_RETRY_DELAY_MS,
    ),
  );

  if (!endpoint) {
    return {
      channel: "webhook",
      status: "skipped",
      reason:
        "Webhook delivery skipped because NOTIFICATION_WEBHOOK_URL is not configured",
      attempts: 0,
    };
  }

  if (
    await hasDeliveredChannel(
      supabase,
      payload.deal_id,
      payload.deal_feed_id,
      WEBHOOK_DELIVERY_ACTION,
    )
  ) {
    return {
      channel: "webhook",
      status: "skipped",
      reason: "Webhook alert already delivered for this deal_feed_id",
      attempts: 0,
    };
  }

  const requestPayload = buildWebhookRequestBody(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (authHeader && authToken) {
    headers[authHeader] = authToken;
  }

  let lastStatus: number | null = null;
  let lastBody: string | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestPayload),
      });
      lastStatus = response.status;
      lastBody = await response.text();

      if (response.ok) {
        return {
          channel: "webhook",
          status: "delivered",
          reason: "Webhook alert sent",
          attempts: attempt,
          request_payload: requestPayload,
          response_status: response.status,
          response_body: lastBody,
        };
      }
    } catch (error) {
      lastBody = getErrorMessage(error);
    }

    if (attempt < maxRetries) {
      await delay(retryDelayMs * attempt);
    }
  }

  return {
    channel: "webhook",
    status: "failed",
    reason: `Webhook delivery failed after ${maxRetries} attempts`,
    attempts: maxRetries,
    request_payload: requestPayload,
    response_status: lastStatus,
    response_body: lastBody,
  };
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
    let resolvedDeal: DealRow | null = null;

    if (
      priorityScore === null || resolvedScore === null ||
      resolvedStrategy === null || resolvedDeal === null
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
      resolvedDeal = resolved.deal;
    }

    const notificationType = classifyNotificationType({
      score: resolvedScore,
      priorityScore,
    });
    const userPreferences = await fetchUserPreferences(supabase);
    const decisionResults: Array<Record<string, unknown>> = [];
    const notifications: Array<Record<string, unknown>> = [];
    const warnings: string[] = [];
    const deliveries: DeliveryAttemptResult[] = [];

    if (userPreferences.length === 0) {
      warnings.push("No user preferences configured");
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

    if (notificationType === "high_priority") {
      const externalPayload = buildHighPriorityPayload({
        deal_feed_id,
        deal_id,
        score: resolvedScore,
        priorityScore,
        trigger_event,
        summary,
        deal: resolvedDeal,
      });

      const channelResults = await Promise.all([
        sendEmailAlert(supabase, externalPayload),
        sendWebhookAlert(supabase, externalPayload),
      ]);

      for (const result of channelResults) {
        deliveries.push(result);

        try {
          await logDeliveryAttempt(
            supabase,
            deal_id,
            result.channel === "email"
              ? EMAIL_DELIVERY_ACTION
              : WEBHOOK_DELIVERY_ACTION,
            {
              deal_feed_id,
              notification_type: notificationType,
              score: resolvedScore,
              priority_score: priorityScore,
              trigger_event,
              summary,
              channel: result.channel,
              status: result.status,
              reason: result.reason,
              attempts: result.attempts,
              deal_reference: externalPayload.deal_reference,
              request_payload: result.request_payload ?? null,
              response_status: result.response_status ?? null,
              response_body: result.response_body ?? null,
            },
          );
        } catch (error) {
          warnings.push(
            `Failed to log ${result.channel} delivery status: ${
              getErrorMessage(error)
            }`,
          );
        }

        if (result.status === "failed") {
          warnings.push(`${result.channel} delivery failed: ${result.reason}`);
        }
      }
    } else {
      deliveries.push({
        channel: "email",
        status: "skipped",
        reason:
          "External delivery disabled for non-high_priority notifications",
        attempts: 0,
      });
      deliveries.push({
        channel: "webhook",
        status: "skipped",
        reason:
          "External delivery disabled for non-high_priority notifications",
        attempts: 0,
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
      delivery_count: deliveries.length,
    });

    return jsonResponse({
      success: true,
      skipped: notifications.length === 0 &&
        notificationType !== "high_priority",
      notification_type: notificationType,
      notifications,
      decisions: decisionResults,
      deliveries,
      warnings,
    });
  } catch (error) {
    console.error("notification-agent failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
