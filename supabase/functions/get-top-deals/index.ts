import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import {
  computeCompositeDealScore,
  parseNumber,
} from "../_shared/deal-feed.ts";

type RequestPayload = {
  limit?: number;
  sort_by?: "composite_score" | "priority_score" | "created_at";
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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

function clampLimit(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

function parseCreatedAt(value: unknown) {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Supabase environment variables not set" },
      500,
    );
  }

  try {
    let payload: RequestPayload = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const limit = clampLimit(payload.limit);
    const sortBy = payload.sort_by === "priority_score" ||
        payload.sort_by === "created_at"
      ? payload.sort_by
      : "composite_score";

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: feedRows, error: feedError } = await supabase
      .from("deal_feed")
      .select("deal_id, score, priority_score, status, created_at")
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(500);

    if (feedError) {
      throw new Error(feedError.message);
    }

    const latestByDeal = new Map<string, Record<string, unknown>>();

    for (const row of feedRows ?? []) {
      const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
      if (!dealId) continue;

      const existing = latestByDeal.get(dealId);
      const nextPriority = parseNumber(row.priority_score) ??
        parseNumber(row.score) ?? 0;
      const existingPriority = parseNumber(existing?.priority_score ?? null) ??
        parseNumber(existing?.score ?? null) ?? 0;
      const nextCreatedAt = parseCreatedAt(row.created_at);
      const existingCreatedAt = parseCreatedAt(existing?.created_at);

      if (
        !existing || nextPriority > existingPriority ||
        (nextPriority === existingPriority && nextCreatedAt > existingCreatedAt)
      ) {
        latestByDeal.set(dealId, row as Record<string, unknown>);
      }
    }

    const dealIds = Array.from(latestByDeal.keys());
    const performanceByDeal = new Map<string, Record<string, unknown>>();

    if (dealIds.length > 0) {
      const { data: performanceRows, error: performanceError } = await supabase
        .from("deal_performance")
        .select("deal_id, views, actions_taken")
        .in("deal_id", dealIds);

      if (performanceError) {
        throw new Error(performanceError.message);
      }

      for (const row of performanceRows ?? []) {
        if (typeof row.deal_id === "string") {
          performanceByDeal.set(row.deal_id, row as Record<string, unknown>);
        }
      }
    }

    const items = dealIds.map((dealId) => {
      const feed = latestByDeal.get(dealId) ?? {};
      const performance = performanceByDeal.get(dealId) ?? {};
      const score = parseNumber(feed.score ?? null);
      const priorityScore = parseNumber(feed.priority_score ?? null) ?? score ??
        0;
      const views = parseNumber(performance.views ?? null) ?? 0;
      const actionsTaken = parseNumber(performance.actions_taken ?? null) ?? 0;
      const compositeScore = computeCompositeDealScore({
        priorityScore,
        views,
        actionsTaken,
      });

      return {
        deal_id: dealId,
        score,
        priority_score: priorityScore,
        views,
        actions_taken: actionsTaken,
        composite_score: compositeScore,
        created_at: feed.created_at ?? null,
      };
    });

    items.sort((left, right) => {
      if (sortBy === "created_at") {
        return parseCreatedAt(right.created_at) -
          parseCreatedAt(left.created_at);
      }

      if (sortBy === "priority_score") {
        if (right.priority_score !== left.priority_score) {
          return right.priority_score - left.priority_score;
        }

        return parseCreatedAt(right.created_at) -
          parseCreatedAt(left.created_at);
      }

      if (right.composite_score !== left.composite_score) {
        return right.composite_score - left.composite_score;
      }

      return parseCreatedAt(right.created_at) - parseCreatedAt(left.created_at);
    });

    return jsonResponse({
      success: true,
      sort_by: sortBy,
      limit,
      items: items.slice(0, limit).map((item) => ({
        deal_id: item.deal_id,
        score: item.composite_score,
        priority_score: item.priority_score,
        views: item.views,
        actions_taken: item.actions_taken,
      })),
    });
  } catch (error) {
    console.error("get-top-deals failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
