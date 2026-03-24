import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import {
  computeCompositeDealScore,
  parseNumber,
} from "../_shared/deal-feed.ts";

type RequestPayload = {
  days?: number;
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

    const days = typeof payload.days === "number" && payload.days > 0
      ? Math.min(Math.trunc(payload.days), 30)
      : 7;
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - days * 24 * 60 * 60 * 1000,
    );
    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();
    const supabase = createClient(supabaseUrl, serviceKey);

    const [feedResult, performanceResult, improvedTasksResult] = await Promise
      .all([
        supabase
          .from("deal_feed")
          .select(
            "deal_id, score, priority_score, trigger_event, summary, created_at, status",
          )
          .gte("created_at", periodStartIso)
          .neq("status", "archived")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("deal_performance")
          .select("deal_id, views, actions_taken"),
        supabase
          .from("tasks")
          .select("id, deal_id, title, description, created_at, status")
          .eq("title", "Re-evaluate feasibility")
          .gte("created_at", periodStartIso)
          .order("created_at", { ascending: false }),
      ]);

    if (feedResult.error) throw new Error(feedResult.error.message);
    if (performanceResult.error) {
      throw new Error(performanceResult.error.message);
    }
    if (improvedTasksResult.error) {
      throw new Error(improvedTasksResult.error.message);
    }

    const performanceByDeal = new Map<string, Record<string, unknown>>();
    for (const row of performanceResult.data ?? []) {
      if (typeof row.deal_id === "string") {
        performanceByDeal.set(row.deal_id, row as Record<string, unknown>);
      }
    }

    const firstSeenByDeal = new Map<string, Record<string, unknown>>();
    const latestByDeal = new Map<string, Record<string, unknown>>();

    for (const row of feedResult.data ?? []) {
      const dealId = typeof row.deal_id === "string" ? row.deal_id : null;
      if (!dealId) continue;

      const existingFirst = firstSeenByDeal.get(dealId);
      if (
        !existingFirst ||
        parseCreatedAt(row.created_at) <
          parseCreatedAt(existingFirst.created_at)
      ) {
        firstSeenByDeal.set(dealId, row as Record<string, unknown>);
      }

      const existingLatest = latestByDeal.get(dealId);
      if (
        !existingLatest ||
        parseCreatedAt(row.created_at) >
          parseCreatedAt(existingLatest.created_at)
      ) {
        latestByDeal.set(dealId, row as Record<string, unknown>);
      }
    }

    const newDeals = Array.from(firstSeenByDeal.entries())
      .map(([dealId, row]) => ({
        deal_id: dealId,
        score: parseNumber(row.score ?? null),
        priority_score: parseNumber(row.priority_score ?? null),
        trigger_event: row.trigger_event ?? null,
        summary: row.summary ?? null,
        created_at: row.created_at ?? null,
      }))
      .sort((left, right) =>
        parseCreatedAt(right.created_at) - parseCreatedAt(left.created_at)
      );

    const improvedDeals = (improvedTasksResult.data ?? []).map((row) => ({
      deal_id: row.deal_id,
      task_id: row.id,
      title: row.title,
      reason: row.description ?? null,
      created_at: row.created_at,
      status: row.status ?? null,
    }));

    const topDeals = Array.from(latestByDeal.entries())
      .map(([dealId, row]) => {
        const performance = performanceByDeal.get(dealId) ?? {};
        const priorityScore = parseNumber(row.priority_score ?? null) ??
          parseNumber(row.score ?? null) ?? 0;
        const views = parseNumber(performance.views ?? null) ?? 0;
        const actionsTaken = parseNumber(performance.actions_taken ?? null) ??
          0;

        return {
          deal_id: dealId,
          score: computeCompositeDealScore({
            priorityScore,
            views,
            actionsTaken,
          }),
          priority_score: priorityScore,
          views,
          actions_taken: actionsTaken,
        };
      })
      .sort((left, right) => right.score - left.score)
      .slice(0, 10);

    const report = {
      generated_at: new Date().toISOString(),
      period_start: periodStartIso,
      period_end: periodEndIso,
      new_deals: {
        count: newDeals.length,
        items: newDeals,
      },
      improved_deals: {
        count: improvedDeals.length,
        items: improvedDeals,
      },
      top_deals: {
        count: topDeals.length,
        items: topDeals,
      },
      summary: {
        total_new_deals: newDeals.length,
        total_improved_deals: improvedDeals.length,
        top_deal_ids: topDeals.map((deal) => deal.deal_id),
      },
    };

    const { error: logError } = await supabase.from("ai_actions").insert({
      agent: "generate-deal-report",
      action: "weekly_deal_report_generated",
      payload: report,
      source: "deal_feed",
    });

    if (logError) {
      throw new Error(logError.message);
    }

    return jsonResponse({
      success: true,
      report,
    });
  } catch (error) {
    console.error("generate-deal-report failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
