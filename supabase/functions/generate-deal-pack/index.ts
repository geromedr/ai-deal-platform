import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type RequestPayload = {
  deal_id?: string;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function buildAddress(deal: Record<string, unknown> | null) {
  const parts = [
    typeof deal?.address === "string" ? deal.address : null,
    typeof deal?.suburb === "string" ? deal.suburb : null,
    typeof deal?.state === "string" ? deal.state : null,
    typeof deal?.postcode === "string" ? deal.postcode : null,
  ].filter((value): value is string => Boolean(value && value.trim()));

  return parts.join(", ");
}

serve(createAgentHandler({ agentName: "generate-deal-pack", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {
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
    const payload = await req.json() as RequestPayload;
    const deal_id = typeof payload.deal_id === "string"
      ? payload.deal_id.trim()
      : "";

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id", received: payload }, 400);
    }

    if (!isUuid(deal_id)) {
      return jsonResponse(
        { error: "deal_id must be a valid UUID", received: payload },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const [
      dealResult,
      siteResult,
      financialResult,
      risksResult,
      comparablesResult,
    ] = await Promise.all([
      supabase
        .from("deals")
        .select(
          "id, address, suburb, state, postcode, status, stage, source, metadata, created_at, updated_at",
        )
        .eq("id", deal_id)
        .maybeSingle(),
      supabase
        .from("site_intelligence")
        .select(
          "zoning, lep, height_limit, fsr, heritage_status, site_area, flood_risk, estimated_gfa, estimated_units, estimated_revenue, estimated_build_cost, estimated_profit, source_attributes, raw_data, updated_at",
        )
        .eq("deal_id", deal_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("financial_snapshots")
        .select(
          "id, category, amount, gdv, tdc, notes, metadata, created_at, updated_at",
        )
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("risks")
        .select(
          "id, title, description, severity, status, metadata, created_at, updated_at",
        )
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("comparable_sales_estimates")
        .select(
          "id, subject_address, suburb, state, postcode, radius_km, dwelling_type, estimated_sale_price_per_sqm, currency, rationale, model_name, knowledge_context, raw_output, status, created_at, updated_at, comparable_sales_evidence(id, project_name, location, dwelling_type, estimated_sale_price_per_sqm, similarity_reason, source_metadata, created_at)",
        )
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    if (dealResult.error) throw new Error(dealResult.error.message);
    if (siteResult.error) throw new Error(siteResult.error.message);
    if (financialResult.error) throw new Error(financialResult.error.message);
    if (risksResult.error) throw new Error(risksResult.error.message);
    if (comparablesResult.error) {
      throw new Error(comparablesResult.error.message);
    }

    const deal = (dealResult.data ?? null) as Record<string, unknown> | null;
    if (!deal) {
      return jsonResponse({ error: "Deal not found", deal_id }, 404);
    }

    const site = (siteResult.data ?? null) as Record<string, unknown> | null;
    const financials = (financialResult.data ?? []) as Array<
      Record<string, unknown>
    >;
    const latestFinancial = financials[0] ?? null;
    const financialMetadata = isRecord(latestFinancial?.metadata)
      ? latestFinancial.metadata
      : null;
    const feasibility = isRecord(financialMetadata?.feasibility)
      ? financialMetadata.feasibility
      : null;
    const comparables = (comparablesResult.data ?? []) as Array<
      Record<string, unknown>
    >;

    const dealPack = {
      generated_at: new Date().toISOString(),
      format: "deal-pack.v1",
      pdf_ready: true,
      deal_id,
      deal_summary: {
        address: buildAddress(deal),
        source: deal.source ?? null,
        status: deal.status ?? null,
        stage: deal.stage ?? null,
        overview: {
          zoning: site?.zoning ?? null,
          flood_risk: site?.flood_risk ?? null,
          site_area: parseNumber(site?.site_area ?? null),
          estimated_units: parseNumber(site?.estimated_units ?? null),
          estimated_gfa: parseNumber(site?.estimated_gfa ?? null),
        },
        planning_controls: {
          zoning: site?.zoning ?? null,
          lep: site?.lep ?? null,
          fsr: site?.fsr ?? null,
          height_limit: site?.height_limit ?? null,
          heritage_status: site?.heritage_status ?? null,
        },
      },
      financials: {
        latest_snapshot: latestFinancial
          ? {
            id: latestFinancial.id ?? null,
            category: latestFinancial.category ?? null,
            amount: parseNumber(latestFinancial.amount ?? null),
            gdv: parseNumber(latestFinancial.gdv ?? null),
            tdc: parseNumber(latestFinancial.tdc ?? null),
            notes: latestFinancial.notes ?? null,
            created_at: latestFinancial.created_at ?? null,
          }
          : null,
        feasibility: {
          revenue: parseNumber(
            feasibility?.revenue ?? site?.estimated_revenue ?? null,
          ),
          cost: parseNumber(
            feasibility?.cost ?? site?.estimated_build_cost ?? null,
          ),
          profit: parseNumber(
            feasibility?.profit ?? site?.estimated_profit ?? null,
          ),
          margin: parseNumber(feasibility?.margin ?? null),
          residual_land_value: parseNumber(
            feasibility?.residual_land_value ?? null,
          ),
        },
        snapshots: financials.map((row) => ({
          id: row.id ?? null,
          category: row.category ?? null,
          amount: parseNumber(row.amount ?? null),
          gdv: parseNumber(row.gdv ?? null),
          tdc: parseNumber(row.tdc ?? null),
          notes: row.notes ?? null,
          created_at: row.created_at ?? null,
        })),
      },
      risks: (risksResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id ?? null,
        title: row.title ?? null,
        description: row.description ?? null,
        severity: row.severity ?? null,
        status: row.status ?? null,
        metadata: isRecord(row.metadata) ? row.metadata : null,
        created_at: row.created_at ?? null,
      })),
      comparable_context: comparables.map((row) => ({
        id: row.id ?? null,
        subject_address: row.subject_address ?? null,
        radius_km: parseNumber(row.radius_km ?? null),
        dwelling_type: row.dwelling_type ?? null,
        estimated_sale_price_per_sqm: parseNumber(
          row.estimated_sale_price_per_sqm ?? null,
        ),
        currency: row.currency ?? null,
        rationale: row.rationale ?? null,
        model_name: row.model_name ?? null,
        status: row.status ?? null,
        created_at: row.created_at ?? null,
        evidence: Array.isArray(row.comparable_sales_evidence)
          ? row.comparable_sales_evidence.map((
            evidence: Record<string, unknown>,
          ) => ({
            id: evidence.id ?? null,
            project_name: evidence.project_name ?? null,
            location: evidence.location ?? null,
            dwelling_type: evidence.dwelling_type ?? null,
            estimated_sale_price_per_sqm: parseNumber(
              evidence.estimated_sale_price_per_sqm ?? null,
            ),
            similarity_reason: evidence.similarity_reason ?? null,
            source_metadata: isRecord(evidence.source_metadata)
              ? evidence.source_metadata
              : null,
            created_at: evidence.created_at ?? null,
          }))
          : [],
      })),
      render_hints: {
        document_title: `Deal Pack - ${buildAddress(deal) || deal_id}`,
        sections: [
          "deal_summary",
          "financials",
          "risks",
          "comparable_context",
        ],
      },
    };

    const { error: logError } = await supabase.from("ai_actions").insert({
      deal_id,
      agent: "generate-deal-pack",
      action: "deal_pack_generated",
      source: "deal_pack",
      payload: {
        generated_at: dealPack.generated_at,
        format: dealPack.format,
        pdf_ready: dealPack.pdf_ready,
        section_counts: {
          financial_snapshots: dealPack.financials.snapshots.length,
          risks: dealPack.risks.length,
          comparable_context: dealPack.comparable_context.length,
        },
      },
    });

    if (logError) {
      throw new Error(logError.message);
    }

    const { error: indexError } = await supabase.from("report_index").insert({
      deal_id,
      report_type: "deal_pack",
      source_agent: "generate-deal-pack",
      source_action: "deal_pack_generated",
      payload: {
        deal_pack: dealPack,
      },
    });

    if (indexError) {
      throw new Error(indexError.message);
    }

    return jsonResponse({
      success: true,
      deal_pack: dealPack,
    });
  } catch (error) {
    console.error("generate-deal-pack failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));

