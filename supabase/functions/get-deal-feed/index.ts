import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import {
  computePriorityScore,
  getMarginFromFeedMetadata,
  getMarginFromFinancialMetadata,
  getStrategyFromDeal,
  incrementDealPerformanceMetrics,
  isRecord,
  matchesUserPreferences,
  parseNumber,
  parseString,
} from "../_shared/deal-feed.ts";

type GetDealFeedRequest = {
  limit?: number;
  score?: number;
  status?: string;
  sort_by?: "created_at" | "priority_score";
  user_id?: string;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function isMissingHostedTable(
  error: { code?: string | null; message?: string | null },
  tableName: string,
) {
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";

  return code === "PGRST205" && message.includes(`public.${tableName}`);
}

function isMissingColumnError(
  error: { message?: string | null } | null | undefined,
  column: string,
) {
  const message = typeof error?.message === "string" ? error.message : "";
  return message.includes(`Could not find the '${column}' column`) ||
    message.includes(`.${column} does not exist`) ||
    message.includes(`column ${column} does not exist`) ||
    message.includes(`column "${column}`) ||
    message.includes(`column "${column}" does not exist`);
}

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function parseMinScore(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCreatedAt(value: unknown) {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function handleRequest(payload: GetDealFeedRequest = {}) {
  const limit = clampLimit(payload.limit);
  const minScore = parseMinScore(payload.score);
  const status =
    typeof payload.status === "string" && payload.status.trim().length > 0
      ? payload.status.trim()
      : null;
  const sortBy = payload.sort_by === "created_at"
    ? "created_at"
    : "priority_score";
  const userId = parseString(payload.user_id);

  if (userId && !isUuid(userId)) {
    throw new Error("user_id must be a valid UUID");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) throw new Error("SUPABASE_URL not set");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

  const supabase = createClient(supabaseUrl, serviceKey);

  let userPreferences: {
    user_id?: string | null;
    min_score?: number | null;
    preferred_strategy?: string | null;
    notification_level?: string | null;
  } | null = null;
  let scoringWeights: Record<string, unknown> | null = null;
  const warnings: string[] = [];

  if (userId) {
    const { data: preferenceRow, error: preferenceError } = await supabase
      .from("user_preferences")
      .select("user_id, min_score, preferred_strategy, notification_level")
      .eq("user_id", userId)
      .maybeSingle();

    if (preferenceError) {
      throw new Error(preferenceError.message);
    }

    userPreferences = preferenceRow ?? null;
  }

  const { data: latestFeedback, error: feedbackError } = await supabase
    .from("scoring_feedback")
    .select("adjusted_weights, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (feedbackError) {
    if (isMissingHostedTable(feedbackError, "scoring_feedback")) {
      warnings.push(
        "scoring_feedback table is not available in the hosted schema yet; default priority weights were used.",
      );
    } else {
      throw new Error(feedbackError.message);
    }
  }

  if (isRecord(latestFeedback?.adjusted_weights)) {
    scoringWeights = latestFeedback.adjusted_weights;
  }

  const effectiveMinScore = userPreferences?.min_score ?? minScore;

  let query = supabase
    .from("deal_feed")
    .select(
      "deal_id, score, priority_score, trigger_event, summary, created_at, status, metadata, deals!inner(stage)",
    )
    .limit(sortBy === "priority_score" ? MAX_LIMIT : limit);

  if (effectiveMinScore !== null) {
    query = query.gte("score", effectiveMinScore);
  }

  if (status) {
    query = query.eq("status", status);
  } else {
    query = query.neq("status", "archived");
  }

  query = query.neq("deals.stage", "archived");

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const dealIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => (typeof row.deal_id === "string" ? row.deal_id : null))
        .filter((value): value is string => value !== null),
    ),
  );

  const financialsByDeal = new Map<string, number | null>();
  const siteIntelligenceByDeal = new Map<string, string | null>();
  const risksByDeal = new Map<
    string,
    Array<{ severity?: string | null; status?: string | null }>
  >();
  const dealsById = new Map<string, Record<string, unknown>>();

  if (dealIds.length > 0) {
    const [
      financialsResult,
      siteIntelligenceResult,
      risksResult,
      dealsResult,
    ] = await Promise.all([
      supabase
        .from("financial_snapshots")
        .select("deal_id, metadata, created_at")
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("site_intelligence")
        .select("deal_id, flood_risk, updated_at")
        .in("deal_id", dealIds)
        .order("updated_at", { ascending: false }),
      supabase
        .from("risks")
        .select("deal_id, severity, status")
        .in("deal_id", dealIds),
      supabase
        .from("deals")
        .select("id, address, suburb, stage, metadata")
        .in("id", dealIds),
    ]);

    if (financialsResult.error) {
      throw new Error(financialsResult.error.message);
    }

    if (siteIntelligenceResult.error) {
      throw new Error(siteIntelligenceResult.error.message);
    }

    let resolvedRisks = risksResult;
    if (risksResult.error) {
      if (isMissingColumnError(risksResult.error, "status")) {
        const legacyRisksResult = await supabase
          .from("risks")
          .select("deal_id, severity")
          .in("deal_id", dealIds);

        if (legacyRisksResult.error) {
          throw new Error(legacyRisksResult.error.message);
        }

        resolvedRisks = legacyRisksResult;
      } else {
        throw new Error(risksResult.error.message);
      }
    }

    let resolvedDeals = dealsResult;
    if (dealsResult.error) {
      if (isMissingColumnError(dealsResult.error, "metadata")) {
        const legacyDealsResult = await supabase
          .from("deals")
          .select("id, address, suburb, stage, strategy")
          .in("id", dealIds);

        if (legacyDealsResult.error) {
          throw new Error(legacyDealsResult.error.message);
        }

        resolvedDeals = legacyDealsResult;
      } else {
        throw new Error(dealsResult.error.message);
      }
    }

    for (const row of financialsResult.data ?? []) {
      if (
        typeof row.deal_id !== "string" || financialsByDeal.has(row.deal_id)
      ) {
        continue;
      }

      financialsByDeal.set(
        row.deal_id,
        getMarginFromFinancialMetadata(row.metadata),
      );
    }

    for (const row of siteIntelligenceResult.data ?? []) {
      if (
        typeof row.deal_id !== "string" ||
        siteIntelligenceByDeal.has(row.deal_id)
      ) {
        continue;
      }

      siteIntelligenceByDeal.set(
        row.deal_id,
        typeof row.flood_risk === "string" ? row.flood_risk : null,
      );
    }

    for (const row of resolvedRisks.data ?? []) {
      if (typeof row.deal_id !== "string") continue;
      const existing = risksByDeal.get(row.deal_id) ?? [];
      existing.push({
        severity: typeof row.severity === "string" ? row.severity : null,
        status: typeof row.status === "string" ? row.status : null,
      });
      risksByDeal.set(row.deal_id, existing);
    }

    for (const row of resolvedDeals.data ?? []) {
      if (typeof row.id !== "string") continue;
      dealsById.set(row.id, row as Record<string, unknown>);
    }
  }

  const items = (data ?? []).map((row) => {
    const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
    const deal = dealId !== null ? dealsById.get(dealId) ?? null : null;
    const feedMargin = getMarginFromFeedMetadata(row.metadata);
    const margin = dealId !== null
      ? feedMargin ?? financialsByDeal.get(dealId) ?? null
      : feedMargin;
    const floodRisk = dealId !== null
      ? siteIntelligenceByDeal.get(dealId) ?? null
      : null;
    const risks = dealId !== null ? risksByDeal.get(dealId) ?? [] : [];
    const score = parseNumber(row.score);
    const computedPriorityScore = computePriorityScore({
      score,
      margin,
      floodRisk,
      risks,
      weights: scoringWeights,
    });
    const priorityScore = parseNumber(row.priority_score) ??
      computedPriorityScore;
    const strategy = getStrategyFromDeal(deal);

    return {
      deal_id: row.deal_id,
      score: row.score,
      priority_score: priorityScore,
      trigger_event: row.trigger_event,
      summary: row.summary,
      created_at: row.created_at,
      status: row.status,
      address: typeof deal?.address === "string" ? deal.address : null,
      suburb: typeof deal?.suburb === "string" ? deal.suburb : null,
      strategy,
      stage: typeof deal?.stage === "string" ? deal.stage : null,
    };
  }).filter((item) =>
    matchesUserPreferences({
      score: parseNumber(item.score),
      strategy: item.strategy,
      preferences: userPreferences,
    })
  );

  if (sortBy === "priority_score") {
    items.sort((left, right) => {
      if (right.priority_score !== left.priority_score) {
        return right.priority_score - left.priority_score;
      }

      return parseCreatedAt(right.created_at) -
        parseCreatedAt(left.created_at);
    });
  }

  const visibleItems = items.slice(0, limit);

  for (const item of visibleItems) {
    if (typeof item.deal_id !== "string") continue;

    try {
      await incrementDealPerformanceMetrics(supabase, {
        deal_id: item.deal_id,
        views: 1,
        mark_viewed: true,
      });
    } catch (error) {
      warnings.push(getErrorMessage(error));
    }
  }

  return {
    success: true,
    limit,
    filters: {
      score: effectiveMinScore,
      status,
      user_id: userId,
    },
    applied_preferences: userPreferences,
    sort_by: sortBy,
    items: visibleItems,
    warnings,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {

    let body: GetDealFeedRequest = {};

    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const result = await handleRequest(body);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    })
  } catch (err) {
    console.error("get-deal-feed failed", err);
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
    })
  }
})
