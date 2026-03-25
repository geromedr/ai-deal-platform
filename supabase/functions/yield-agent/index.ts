import { serve } from "https://deno.land/std/http/server.ts"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type YieldRequest = {
  deal_id?: string
  use_comparable_sales?: boolean
}

type SiteIntelligenceRow = {
  deal_id: string
  site_area?: number | string | null
  fsr?: number | string | null
}

type ComparableSalesEstimateRow = {
  estimated_sale_price_per_sqm?: number | string | null
  currency?: string | null
  rationale?: string | null
  created_at?: string | null
}

const DEFAULT_AVG_UNIT_SIZE = 90
const DEFAULT_SALE_PRICE_PER_SQM = 11000
const DEFAULT_BUILD_COST_PER_SQM = 4200

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function parseNumeric(value: number | string | null | undefined, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const directParsed = Number(value)
    if (Number.isFinite(directParsed)) {
      return directParsed
    }

    const matchedNumber = value.match(/-?\d+(\.\d+)?/)
    if (matchedNumber) {
      const extracted = Number(matchedNumber[0])
      if (Number.isFinite(extracted)) {
        return extracted
      }
    }
  }

  return fallback
}

function isBooleanOrUndefined(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean"
}

function buildHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`
  }
}

serve(createAgentHandler({ agentName: "yield-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500)
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500)

  try {
    const payload = await req.json() as YieldRequest
    const deal_id =
      typeof payload.deal_id === "string" && payload.deal_id.trim().length > 0
        ? payload.deal_id.trim()
        : ""

    if (!isBooleanOrUndefined(payload.use_comparable_sales)) {
      return jsonResponse({ error: "use_comparable_sales must be a boolean" }, 400)
    }

    const useComparableSales = payload.use_comparable_sales !== false

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400)
    }

    console.log("yield-agent started", {
      deal_id,
      use_comparable_sales: useComparableSales
    })

    const siteResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=deal_id,site_area,fsr&limit=1`,
      {
        headers: buildHeaders(serviceKey)
      }
    )

    if (!siteResponse.ok) {
      throw new Error(`Failed to load site intelligence: ${await siteResponse.text()}`)
    }

    const siteRows = await siteResponse.json() as SiteIntelligenceRow[]

    if (!siteRows.length) {
      return jsonResponse({ error: "No site intelligence found" }, 400)
    }

    const site = siteRows[0]
    const siteArea = parseNumeric(site.site_area, 1000)
    const fsr = parseNumeric(site.fsr, 1)

    let salePricePerSqm = DEFAULT_SALE_PRICE_PER_SQM
    let salePriceSource = "fallback-default"
    let comparableSalesEstimate: ComparableSalesEstimateRow | null = null

    if (useComparableSales) {
      const comparableResponse = await fetch(
        `${supabaseUrl}/rest/v1/comparable_sales_estimates?deal_id=eq.${deal_id}&status=eq.completed&select=estimated_sale_price_per_sqm,currency,rationale,created_at&order=created_at.desc&limit=1`,
        {
          headers: buildHeaders(serviceKey)
        }
      )

      if (!comparableResponse.ok) {
        throw new Error(`Failed to load comparable sales estimate: ${await comparableResponse.text()}`)
      }

      const comparableRows = await comparableResponse.json() as ComparableSalesEstimateRow[]
      const latestComparable = comparableRows[0] ?? null
      const comparablePrice = Number(latestComparable?.estimated_sale_price_per_sqm)

      if (latestComparable && Number.isFinite(comparablePrice) && comparablePrice > 0) {
        comparableSalesEstimate = latestComparable
        salePricePerSqm = comparablePrice
        salePriceSource = "comparable-sales-agent"
      }
    }

    const maxGfa = siteArea * fsr
    const estimatedUnits = Math.floor(maxGfa / DEFAULT_AVG_UNIT_SIZE)
    const estimatedRevenue = maxGfa * salePricePerSqm
    const estimatedBuildCost = maxGfa * DEFAULT_BUILD_COST_PER_SQM
    const estimatedProfit = estimatedRevenue - estimatedBuildCost

    const patchResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}`,
      {
        method: "PATCH",
        headers: buildHeaders(serviceKey),
        body: JSON.stringify({
          estimated_gfa: maxGfa,
          estimated_units: estimatedUnits,
          estimated_revenue: estimatedRevenue,
          estimated_build_cost: estimatedBuildCost,
          estimated_profit: estimatedProfit
        })
      }
    )

    if (!patchResponse.ok) {
      throw new Error(`Failed to save yield output: ${await patchResponse.text()}`)
    }

    const actionResponse = await fetch(
      `${supabaseUrl}/rest/v1/ai_actions`,
      {
        method: "POST",
        headers: buildHeaders(serviceKey),
        body: JSON.stringify({
          deal_id,
          agent: "yield-agent",
          action: "yield_estimated",
          payload: {
            site_area: siteArea,
            fsr,
            max_gfa: maxGfa,
            estimated_units: estimatedUnits,
            sale_price_per_sqm: salePricePerSqm,
            sale_price_source: salePriceSource,
            comparable_sales_estimate: comparableSalesEstimate,
            estimated_revenue: estimatedRevenue,
            estimated_build_cost: estimatedBuildCost,
            estimated_profit: estimatedProfit
          }
        })
      }
    )

    if (!actionResponse.ok) {
      throw new Error(`Failed to log yield action: ${await actionResponse.text()}`)
    }

    console.log("yield-agent completed", {
      deal_id,
      sale_price_per_sqm: salePricePerSqm,
      sale_price_source: salePriceSource,
      estimated_revenue: estimatedRevenue,
      estimated_profit: estimatedProfit
    })

    return jsonResponse({
      success: true,
      deal_id,
      site_area: siteArea,
      fsr,
      max_gfa: maxGfa,
      estimated_units: estimatedUnits,
      sale_price_per_sqm: salePricePerSqm,
      sale_price_source: salePriceSource,
      comparable_sales_estimate: comparableSalesEstimate,
      estimated_revenue: estimatedRevenue,
      estimated_build_cost: estimatedBuildCost,
      estimated_profit: estimatedProfit
    })
  } catch (error) {
    console.error("yield-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
}));

