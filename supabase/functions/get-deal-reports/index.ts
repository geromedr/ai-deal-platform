import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type RequestPayload = {
  deal_id?: string;
  report_type?: string;
  created_at?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSummary(reportType: string, payload: Record<string, unknown>) {
  if (reportType === "deal_report") {
    const report = isRecord(payload.report) ? payload.report : null;
    const address = typeof report?.address === "string" ? report.address : null;
    const recommendation = typeof report?.recommendation === "string"
      ? report.recommendation
      : null;
    return [address, recommendation].filter(Boolean).join(" | ") || null;
  }

  if (reportType === "deal_pack") {
    const dealPack = isRecord(payload.deal_pack) ? payload.deal_pack : payload;
    const summary = isRecord(dealPack.deal_summary) ? dealPack.deal_summary : null;
    const address = typeof summary?.address === "string" ? summary.address : null;
    return address ?? null;
  }

  if (reportType === "weekly_report") {
    const summary = isRecord(payload.summary) ? payload.summary : payload;
    const totalNewDeals = summary.total_new_deals;
    return typeof totalNewDeals === "number"
      ? `${totalNewDeals} new deals`
      : null;
  }

  return null;
}

function mapLegacyActionToReportType(agent: string, action: string) {
  if (agent === "deal-report-agent" && action === "investment_report_generated") {
    return "deal_report";
  }
  if (agent === "generate-deal-pack" && action === "deal_pack_generated") {
    return "deal_pack";
  }
  if (
    agent === "generate-deal-report" &&
    action === "weekly_deal_report_generated"
  ) {
    return "weekly_report";
  }
  return null;
}

serve(createAgentHandler({ agentName: "get-deal-reports" }, async (req) => {
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

    const dealId = typeof payload.deal_id === "string"
      ? payload.deal_id.trim()
      : null;
    const reportType = typeof payload.report_type === "string"
      ? payload.report_type.trim()
      : null;
    const createdAt = typeof payload.created_at === "string"
      ? payload.created_at.trim()
      : null;
    const limit = clampLimit(payload.limit);

    if (dealId && !isUuid(dealId)) {
      return jsonResponse({ error: "deal_id must be a valid UUID" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    let query = supabase
      .from("report_index")
      .select("id, deal_id, report_type, source_agent, source_action, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (dealId) {
      query = query.eq("deal_id", dealId);
    }

    if (reportType) {
      query = query.eq("report_type", reportType);
    }

    if (createdAt) {
      query = query.lte("created_at", createdAt);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const items = (data ?? []).map((row) => {
      const content = isRecord(row.payload) ? row.payload : {};
      return {
        id: row.id,
        deal_id: row.deal_id ?? null,
        report_type: row.report_type,
        source_agent: row.source_agent,
        source_action: row.source_action,
        created_at: row.created_at,
        summary: buildSummary(row.report_type, content),
        content,
      };
    });

    if (items.length < limit) {
      let legacyQuery = supabase
        .from("ai_actions")
        .select("id, deal_id, agent, action, payload, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (dealId) {
        legacyQuery = legacyQuery.eq("deal_id", dealId);
      }

      if (createdAt) {
        legacyQuery = legacyQuery.lte("created_at", createdAt);
      }

      const { data: legacyRows, error: legacyError } = await legacyQuery;
      if (legacyError) throw new Error(legacyError.message);

      for (const row of legacyRows ?? []) {
        const legacyReportType = mapLegacyActionToReportType(
          typeof row.agent === "string" ? row.agent : "",
          typeof row.action === "string" ? row.action : "",
        );

        if (!legacyReportType) continue;
        if (reportType && reportType !== legacyReportType) continue;
        if (items.some((item) => item.id === row.id)) continue;

        const content = isRecord(row.payload) ? row.payload : {};
        items.push({
          id: row.id,
          deal_id: row.deal_id ?? null,
          report_type: legacyReportType,
          source_agent: row.agent,
          source_action: row.action,
          created_at: row.created_at,
          summary: buildSummary(legacyReportType, content),
          content,
        });
      }
    }

    return jsonResponse({
      success: true,
      limit,
      filters: {
        deal_id: dealId,
        report_type: reportType,
        created_at: createdAt,
      },
      items: items
        .sort((left, right) =>
          String(right.created_at ?? "").localeCompare(String(left.created_at ?? ""))
        )
        .slice(0, limit),
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
