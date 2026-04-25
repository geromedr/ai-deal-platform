import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from "../_shared/debug-supabase.ts";
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
import { isUuid } from "../_shared/utils.ts";

type GetDealFeedRequest = {
  limit?: number;
  score?: number;
  status?: string;
  sort_by?: "created_at" | "priority_score";
  user_id?: string;
  stageFilter?: string | null;
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
  return (
    message.includes(`Could not find the '${column}' column`) ||
    message.includes(`.${column} does not exist`) ||
    message.includes(`column ${column} does not exist`) ||
    message.includes(`column "${column}"`)
  );
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


async function queryDeals(
  supabase: ReturnType<typeof createClient>,
  status: string | null,
  stageFilter: string | null,
): Promise<Record<string, unknown>[]> {
  // select("*") avoids column-not-found errors for columns added outside migrations
  let query = supabase
    .from("deals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAX_LIMIT);

  if (status) query = query.eq("status", status);
  if (stageFilter) query = query.eq("stage", stageFilter);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Record<string, unknown>[];
}

async function handleRequest(payload: GetDealFeedRequest = {}) {
  const limit = clampLimit(payload.limit);
  const minScore = parseMinScore(payload.score);
  const status =
    typeof payload.status === "string" && payload.status.trim().length > 0
      ? payload.status.trim()
      : null;
  const sortBy = payload.sort_by === "created_at" ? "created_at" : "priority_score";
  const userId = parseString(payload.user_id);
  const stageFilter = parseString(payload.stageFilter);

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
    if (preferenceError) throw new Error(preferenceError.message);
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
      warnings.push("scoring_feedback table not available; default weights used.");
    } else {
      throw new Error(feedbackError.message);
    }
  }

  if (isRecord(latestFeedback?.adjusted_weights)) {
    scoringWeights = latestFeedback.adjusted_weights;
  }

  const effectiveMinScore = userPreferences?.min_score ?? minScore;

  // ── Step 1: Query deals table directly ──────────────────────────────────────
  const dealsRows = await queryDeals(supabase, status, stageFilter);

  const dealIds = dealsRows
    .map((d) => (typeof d.id === "string" ? d.id : null))
    .filter((id): id is string => id !== null);

  console.log("get-deal-feed: queried deals", {
    total: dealsRows.length,
    stageFilter,
    status,
  });

  if (dealIds.length === 0) {
    return {
      success: true,
      limit,
      filters: { score: effectiveMinScore, status, user_id: userId },
      applied_preferences: userPreferences,
      sort_by: sortBy,
      items: [],
      warnings,
    };
  }

  // ── Step 2: Fetch deal_feed + enrichment in parallel ────────────────────────
  const [feedResult, financialsResult, siteIntelligenceResult, risksResult] =
    await Promise.all([
      supabase
        .from("deal_feed")
        .select("deal_id, score, priority_score, summary, trigger_event, status, metadata, created_at")
        .in("deal_id", dealIds),
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
    ]);

  if (feedResult.error) {
    warnings.push(`deal_feed lookup: ${feedResult.error.message}`);
  }
  if (financialsResult.error) {
    warnings.push(`financial_snapshots lookup: ${financialsResult.error.message}`);
  }
  if (siteIntelligenceResult.error) {
    warnings.push(`site_intelligence lookup: ${siteIntelligenceResult.error.message}`);
  }

  let resolvedRisks = risksResult;
  if (risksResult.error) {
    if (isMissingColumnError(risksResult.error, "status")) {
      const { data: legacyData, error: legacyError } = await supabase
        .from("risks")
        .select("deal_id, severity")
        .in("deal_id", dealIds);
      if (legacyError) throw new Error(legacyError.message);
      resolvedRisks = { data: legacyData, error: null } as typeof risksResult;
    } else {
      throw new Error(risksResult.error.message);
    }
  }

  // ── Step 3: Build lookup maps ────────────────────────────────────────────────
  const feedByDeal = new Map<string, Record<string, unknown>>();
  for (const row of feedResult.data ?? []) {
    if (typeof row.deal_id === "string" && !feedByDeal.has(row.deal_id)) {
      feedByDeal.set(row.deal_id, row as Record<string, unknown>);
    }
  }

  const financialsByDeal = new Map<string, number | null>();
  for (const row of financialsResult.data ?? []) {
    if (typeof row.deal_id !== "string" || financialsByDeal.has(row.deal_id)) continue;
    financialsByDeal.set(row.deal_id, getMarginFromFinancialMetadata(row.metadata));
  }

  const siteIntelligenceByDeal = new Map<string, string | null>();
  for (const row of siteIntelligenceResult.data ?? []) {
    if (typeof row.deal_id !== "string" || siteIntelligenceByDeal.has(row.deal_id)) continue;
    siteIntelligenceByDeal.set(
      row.deal_id,
      typeof row.flood_risk === "string" ? row.flood_risk : null,
    );
  }

  const risksByDeal = new Map<string, Array<{ severity?: string | null; status?: string | null }>>();
  for (const row of resolvedRisks.data ?? []) {
    if (typeof row.deal_id !== "string") continue;
    const existing = risksByDeal.get(row.deal_id) ?? [];
    existing.push({
      severity: typeof row.severity === "string" ? row.severity : null,
      status: typeof row.status === "string" ? row.status : null,
    });
    risksByDeal.set(row.deal_id, existing);
  }

  // ── Step 4: Map to feed items ────────────────────────────────────────────────
  let items = dealsRows.map((deal) => {
    const dealId = typeof deal.id === "string" ? deal.id : "";
    const feed = feedByDeal.get(dealId) ?? null;

    const feedMargin = getMarginFromFeedMetadata(feed?.metadata);
    const margin = feedMargin ?? financialsByDeal.get(dealId) ?? null;
    const floodRisk = siteIntelligenceByDeal.get(dealId) ?? null;
    const risks = risksByDeal.get(dealId) ?? [];

    const score = feed ? parseNumber(feed.score) : null;
    const computedPriorityScore = computePriorityScore({ score, margin, floodRisk, risks, weights: scoringWeights });
    const priorityScore = (feed ? parseNumber(feed.priority_score) : null) ?? computedPriorityScore;
    const strategy = getStrategyFromDeal(deal);

    // Use deal_name or address as the display label when no feed summary exists
    const dealName = typeof deal.deal_name === "string" && deal.deal_name.trim()
      ? deal.deal_name.trim()
      : null;
    const summary = typeof feed?.summary === "string" && feed.summary.trim()
      ? feed.summary.trim()
      : dealName ?? (typeof deal.address === "string" ? deal.address : null);

    return {
      deal_id: dealId,
      score: feed?.score ?? null,
      priority_score: priorityScore,
      trigger_event: feed?.trigger_event ?? null,
      summary,
      created_at: deal.created_at,
      status: deal.status,
      address: typeof deal.address === "string" ? deal.address : null,
      suburb: typeof deal.suburb === "string" ? deal.suburb : null,
      state: typeof deal.state === "string" ? deal.state : null,
      strategy,
      stage: typeof deal.stage === "string" ? deal.stage : null,
      deal_name: dealName,
    };
  });

  // Apply min-score filter — pass through deals with no score so they remain visible
  if (effectiveMinScore !== null) {
    items = items.filter((item) => {
      const s = parseNumber(item.score);
      return s === null || s >= effectiveMinScore;
    });
  }

  // Apply user preference filter
  items = items.filter((item) =>
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
      return parseCreatedAt(right.created_at) - parseCreatedAt(left.created_at);
    });
  }

  const visibleItems = items.slice(0, limit);

  console.log("get-deal-feed: returning items", {
    total: items.length,
    visible: visibleItems.length,
    withFeedRow: visibleItems.filter((i) => feedByDeal.has(i.deal_id)).length,
    withoutFeedRow: visibleItems.filter((i) => !feedByDeal.has(i.deal_id)).length,
  });

  for (const item of visibleItems) {
    if (!item.deal_id) continue;
    try {
      await incrementDealPerformanceMetrics(supabase, { deal_id: item.deal_id, views: 1, mark_viewed: true });
    } catch (error) {
      warnings.push(getErrorMessage(error));
    }
  }

  return {
    success: true,
    limit,
    filters: { score: effectiveMinScore, status, user_id: userId },
    applied_preferences: userPreferences,
    sort_by: sortBy,
    items: visibleItems,
    warnings,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const rawBody = await req.clone().text();
    console.log("[get-deal-feed] incoming request body", rawBody);
    let body: GetDealFeedRequest = {};
    try { body = await req.json(); } catch { body = {}; }
    console.log("[get-deal-feed] normalized parameters", body);
    const result = await handleRequest(body);
    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("get-deal-feed failed", err);
    return new Response(JSON.stringify({ error: getErrorMessage(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
