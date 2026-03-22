import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type FinancialEngineRequest = {
  deal_id?: string
  refresh_yield?: boolean
  use_comparable_sales?: boolean
  assumptions?: {
    build_cost_per_sqm?: number
    contingency_rate?: number
    professional_fees_rate?: number
    marketing_rate?: number
    finance_rate?: number
    developer_margin_target_rate?: number
  }
}

type SiteIntelligenceRow = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  site_area?: number | string | null
  estimated_gfa?: number | string | null
  estimated_units?: number | null
  estimated_revenue?: number | string | null
  estimated_build_cost?: number | string | null
  estimated_profit?: number | string | null
}

type ComparableSalesEstimateRow = {
  id?: string
  estimated_sale_price_per_sqm?: number | string | null
  currency?: string | null
  rationale?: string | null
  created_at?: string | null
}

type FinancialSnapshotInsert = {
  deal_id: string
  category: string
  amount: number
  gdv: number
  tdc: number
  notes: string
  metadata: Record<string, unknown>
}

type CalculationAssumptions = {
  build_cost_per_sqm: number
  contingency_rate: number
  professional_fees_rate: number
  marketing_rate: number
  finance_rate: number
  developer_margin_target_rate: number
}

type FeasibilityInputs = {
  gfa: number
  revenue: number
  build_cost_per_sqm: number
  planning_risk_multiplier: number
}

type FeasibilityOutput = {
  revenue: number
  cost: number
  profit: number
  margin: number
  residual_land_value: number
  build_cost_per_sqm: number
  sale_price_per_sqm: number | null
  planning_risk_multiplier: number
  cost_breakdown: {
    hard_cost: number
    contingency_cost: number
    professional_fees: number
    marketing_cost: number
    finance_cost: number
  }
  formulas: {
    revenue: string
    cost: string
    profit: string
    margin: string
    residual_land_value: string
  }
}

const DEFAULT_BUILD_COST_PER_SQM = 4200
const DEFAULT_CONTINGENCY_RATE = 0.07
const DEFAULT_PROFESSIONAL_FEES_RATE = 0.09
const DEFAULT_MARKETING_RATE = 0.035
const DEFAULT_FINANCE_RATE = 0.05
const DEFAULT_DEVELOPER_MARGIN_TARGET_RATE = 0.18

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function parseNumberLoose(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const direct = Number(value)
    if (Number.isFinite(direct)) {
      return direct
    }

    const matched = value.match(/-?\d+(\.\d+)?/)
    if (matched) {
      const parsed = Number(matched[0])
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return null
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2))
}

function roundRatio(value: number) {
  return Number(value.toFixed(4))
}

function getEnvNumber(name: string, fallback: number) {
  const value = Deno.env.get(name)
  const parsed = parseNumberLoose(value)
  return parsed ?? fallback
}

function validateAssumptionRange(name: string, value: number, min: number, max: number) {
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
}

function resolveAssumptions(overrides?: FinancialEngineRequest["assumptions"]): CalculationAssumptions {
  const assumptions = {
    build_cost_per_sqm:
      overrides?.build_cost_per_sqm === undefined
        ? getEnvNumber("DEFAULT_BUILD_COST_PER_SQM", DEFAULT_BUILD_COST_PER_SQM)
        : parseNumberLoose(overrides.build_cost_per_sqm),
    contingency_rate:
      overrides?.contingency_rate === undefined
        ? getEnvNumber("DEFAULT_CONTINGENCY_RATE", DEFAULT_CONTINGENCY_RATE)
        : parseNumberLoose(overrides.contingency_rate),
    professional_fees_rate:
      overrides?.professional_fees_rate === undefined
        ? getEnvNumber("DEFAULT_PROFESSIONAL_FEES_RATE", DEFAULT_PROFESSIONAL_FEES_RATE)
        : parseNumberLoose(overrides.professional_fees_rate),
    marketing_rate:
      overrides?.marketing_rate === undefined
        ? getEnvNumber("DEFAULT_MARKETING_RATE", DEFAULT_MARKETING_RATE)
        : parseNumberLoose(overrides.marketing_rate),
    finance_rate:
      overrides?.finance_rate === undefined
        ? getEnvNumber("DEFAULT_FINANCE_RATE", DEFAULT_FINANCE_RATE)
        : parseNumberLoose(overrides.finance_rate),
    developer_margin_target_rate:
      overrides?.developer_margin_target_rate === undefined
        ? getEnvNumber(
            "DEFAULT_DEVELOPER_MARGIN_TARGET_RATE",
            DEFAULT_DEVELOPER_MARGIN_TARGET_RATE
          )
        : parseNumberLoose(overrides.developer_margin_target_rate)
  }

  if (assumptions.build_cost_per_sqm === null || assumptions.build_cost_per_sqm <= 0) {
    throw new Error("build_cost_per_sqm must be a positive number")
  }

  const rates = [
    ["contingency_rate", assumptions.contingency_rate],
    ["professional_fees_rate", assumptions.professional_fees_rate],
    ["marketing_rate", assumptions.marketing_rate],
    ["finance_rate", assumptions.finance_rate],
    ["developer_margin_target_rate", assumptions.developer_margin_target_rate]
  ] as const

  for (const [name, value] of rates) {
    if (value === null) {
      throw new Error(`${name} must be a number`)
    }

    validateAssumptionRange(name, value, 0, 1)
  }

  return assumptions as CalculationAssumptions
}

function getPlanningRiskMultiplier(site: SiteIntelligenceRow) {
  let multiplier = 1
  const notes: string[] = []

  const floodRisk = (site.flood_risk || "").toLowerCase()
  if (floodRisk.includes("high")) {
    multiplier += 0.12
    notes.push("high flood risk")
  } else if (floodRisk.includes("medium")) {
    multiplier += 0.06
    notes.push("medium flood risk")
  }

  const heritageStatus = (site.heritage_status || "").toLowerCase()
  if (heritageStatus && !heritageStatus.includes("no")) {
    multiplier += 0.08
    notes.push("heritage controls")
  }

  const zoning = (site.zoning || "").toUpperCase()
  if (zoning.startsWith("R4") || zoning.startsWith("MU")) {
    multiplier += 0.03
    notes.push("higher-density delivery complexity")
  }

  const heightLimit = parseNumberLoose(site.height_limit)
  if (heightLimit !== null && heightLimit >= 18) {
    multiplier += 0.04
    notes.push("taller building form")
  }

  return {
    multiplier: roundRatio(multiplier),
    notes
  }
}

function calculateFeasibility(
  inputs: FeasibilityInputs,
  assumptions: CalculationAssumptions
): FeasibilityOutput {
  const hardCost =
    inputs.gfa * assumptions.build_cost_per_sqm * inputs.planning_risk_multiplier
  const contingencyCost = hardCost * assumptions.contingency_rate
  const professionalFees = hardCost * assumptions.professional_fees_rate
  const marketingCost = inputs.revenue * assumptions.marketing_rate
  const financeCost = (hardCost + contingencyCost + professionalFees) * assumptions.finance_rate
  const totalCost =
    hardCost + contingencyCost + professionalFees + marketingCost + financeCost
  const profit = inputs.revenue - totalCost
  const margin = inputs.revenue > 0 ? profit / inputs.revenue : 0
  const residualLandValue =
    inputs.revenue - totalCost - inputs.revenue * assumptions.developer_margin_target_rate

  return {
    revenue: roundCurrency(inputs.revenue),
    cost: roundCurrency(totalCost),
    profit: roundCurrency(profit),
    margin: roundRatio(margin),
    residual_land_value: roundCurrency(residualLandValue),
    build_cost_per_sqm: roundCurrency(
      assumptions.build_cost_per_sqm * inputs.planning_risk_multiplier
    ),
    sale_price_per_sqm:
      inputs.gfa > 0 ? roundCurrency(inputs.revenue / inputs.gfa) : null,
    planning_risk_multiplier: inputs.planning_risk_multiplier,
    cost_breakdown: {
      hard_cost: roundCurrency(hardCost),
      contingency_cost: roundCurrency(contingencyCost),
      professional_fees: roundCurrency(professionalFees),
      marketing_cost: roundCurrency(marketingCost),
      finance_cost: roundCurrency(financeCost)
    },
    formulas: {
      revenue: "estimated_gfa * sale_price_per_sqm",
      cost:
        "(gfa * build_cost_per_sqm * planning_risk_multiplier) + contingency + professional_fees + marketing + finance",
      profit: "revenue - cost",
      margin: "profit / revenue",
      residual_land_value:
        "revenue - cost - (revenue * developer_margin_target_rate)"
    }
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500)
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500)

  try {
    let payload: FinancialEngineRequest

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const deal_id =
      typeof payload.deal_id === "string" && payload.deal_id.trim().length > 0
        ? payload.deal_id.trim()
        : ""

    if (payload.refresh_yield !== undefined && typeof payload.refresh_yield !== "boolean") {
      return jsonResponse({ error: "refresh_yield must be a boolean" }, 400)
    }

    if (
      payload.use_comparable_sales !== undefined &&
      typeof payload.use_comparable_sales !== "boolean"
    ) {
      return jsonResponse({ error: "use_comparable_sales must be a boolean" }, 400)
    }

    const refreshYield = payload.refresh_yield !== false
    const useComparableSales = payload.use_comparable_sales !== false

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400)
    }

    console.log("financial-engine-agent request received", {
      deal_id,
      refresh_yield: refreshYield,
      use_comparable_sales: useComparableSales
    })

    const supabase = createClient(supabaseUrl, serviceKey)

    if (refreshYield) {
      const yieldResponse = await fetch(`${supabaseUrl}/functions/v1/yield-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey
        },
        body: JSON.stringify({
          deal_id,
          use_comparable_sales: useComparableSales
        })
      })

      if (!yieldResponse.ok) {
        const errorText = await yieldResponse.text()
        throw new Error(`yield-agent failed: ${errorText}`)
      }
    }

    const { data: siteData, error: siteError } = await supabase
      .from("site_intelligence")
      .select(
        "deal_id, address, zoning, fsr, height_limit, flood_risk, heritage_status, site_area, estimated_gfa, estimated_units, estimated_revenue, estimated_build_cost, estimated_profit"
      )
      .eq("deal_id", deal_id)
      .maybeSingle()

    if (siteError) throw siteError
    const site = siteData as SiteIntelligenceRow | null

    if (!site) {
      return jsonResponse({ error: "No site intelligence found" }, 400)
    }

    let assumptions: CalculationAssumptions

    try {
      assumptions = resolveAssumptions(payload.assumptions)
    } catch (validationError) {
      return jsonResponse({
        error: validationError instanceof Error ? validationError.message : "Invalid assumptions"
      }, 400)
    }
    const estimatedGfa = parseNumberLoose(site.estimated_gfa)
    const estimatedRevenue = parseNumberLoose(site.estimated_revenue)

    if (estimatedGfa === null || estimatedGfa <= 0) {
      return jsonResponse({ error: "Estimated GFA is required before financial modelling" }, 400)
    }

    if (estimatedRevenue === null || estimatedRevenue <= 0) {
      return jsonResponse({ error: "Estimated revenue is required before financial modelling" }, 400)
    }

    const { data: comparableData, error: comparableError } = await supabase
      .from("comparable_sales_estimates")
      .select("id, estimated_sale_price_per_sqm, currency, rationale, created_at")
      .eq("deal_id", deal_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (comparableError) throw comparableError
    const latestComparable = comparableData as ComparableSalesEstimateRow | null

    const planningRisk = getPlanningRiskMultiplier(site)
    const feasibility = calculateFeasibility(
      {
        gfa: estimatedGfa,
        revenue: estimatedRevenue,
        build_cost_per_sqm: assumptions.build_cost_per_sqm,
        planning_risk_multiplier: planningRisk.multiplier
      },
      assumptions
    )

    const snapshotPayload: FinancialSnapshotInsert = {
      deal_id,
      category: "financial-engine",
      amount: feasibility.profit,
      gdv: feasibility.revenue,
      tdc: feasibility.cost,
      notes: "Generated by financial-engine-agent.",
      metadata: {
        source_agent: "financial-engine-agent",
        address: site.address || null,
        estimated_units: site.estimated_units ?? null,
        planning_constraints: {
          zoning: site.zoning || null,
          fsr: site.fsr || null,
          height_limit: site.height_limit || null,
          flood_risk: site.flood_risk || null,
          heritage_status: site.heritage_status || null
        },
        comparable_sales: latestComparable,
        assumptions,
        planning_risk_notes: planningRisk.notes,
        feasibility
      }
    }

    const { data: snapshotData, error: snapshotError } = await supabase
      .from("financial_snapshots")
      .insert(snapshotPayload)
      .select()
      .single()

    if (snapshotError) throw snapshotError

    const { error: actionError } = await supabase
      .from("ai_actions")
      .insert({
        deal_id,
        agent: "financial-engine-agent",
        action: "financial_feasibility_calculated",
        payload: {
          snapshot_id: snapshotData.id,
          assumptions,
          planning_risk_multiplier: planningRisk.multiplier,
          revenue: feasibility.revenue,
          cost: feasibility.cost,
          profit: feasibility.profit,
          margin: feasibility.margin,
          residual_land_value: feasibility.residual_land_value
        }
      })

    if (actionError) throw actionError

    console.log("financial-engine-agent processing complete", {
      deal_id,
      revenue: feasibility.revenue,
      cost: feasibility.cost,
      profit: feasibility.profit,
      margin: feasibility.margin
    })

    return jsonResponse({
      success: true,
      deal_id,
      address: site.address || null,
      planning_constraints: {
        zoning: site.zoning || null,
        fsr: site.fsr || null,
        height_limit: site.height_limit || null,
        flood_risk: site.flood_risk || null,
        heritage_status: site.heritage_status || null
      },
      estimated_units: site.estimated_units ?? null,
      comparable_sales: latestComparable,
      assumptions,
      ...feasibility,
      snapshot_id: snapshotData.id
    })
  } catch (error) {
    console.error("financial-engine-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
