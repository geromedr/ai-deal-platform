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

type ComparableSalesEvidenceRow = {
  project_name?: string | null
  location?: string | null
  dwelling_type?: string | null
  estimated_sale_price_per_sqm?: number | string | null
  similarity_reason?: string | null
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

type WarningEntry = {
  agent: string
  issue: string
  message: string
}

const DEFAULT_BUILD_COST_PER_SQM = 4200
const DEFAULT_CONTINGENCY_RATE = 0.07
const DEFAULT_PROFESSIONAL_FEES_RATE = 0.09
const DEFAULT_MARKETING_RATE = 0.035
const DEFAULT_FINANCE_RATE = 0.05
const DEFAULT_DEVELOPER_MARGIN_TARGET_RATE = 0.18
const DEFAULT_FALLBACK_SITE_AREA = 1000
const DEFAULT_FALLBACK_FSR = 1
const DEFAULT_AVG_UNIT_SIZE = 90

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error"
  }
}

function buildRestHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey
  }
}

async function callAgent(
  supabaseUrl: string,
  serviceRoleKey: string,
  authorizationHeader: string | null,
  agent: string,
  payload: Record<string, unknown>
) {
  const normalizedRequestAuthorization =
    typeof authorizationHeader === "string" && authorizationHeader.trim().length > 0
      ? authorizationHeader.trim()
      : null
  const bearerToken = normalizedRequestAuthorization?.toLowerCase().startsWith("bearer ")
    ? normalizedRequestAuthorization
    : serviceRoleKey.includes(".")
      ? `Bearer ${serviceRoleKey}`
      : normalizedRequestAuthorization
        ? `Bearer ${normalizedRequestAuthorization.replace(/^Bearer\s+/i, "")}`
        : null
  const authorizationSource = normalizedRequestAuthorization?.toLowerCase().startsWith("bearer ")
    ? "request"
    : serviceRoleKey.includes(".")
      ? "service-role"
      : normalizedRequestAuthorization
        ? "request-normalized"
        : "none"

  console.log("financial-engine-agent calling downstream agent", {
    agent,
    authorization_source: authorizationSource
  })

  const response = await fetch(`${supabaseUrl}/functions/v1/${agent}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearerToken ? { "Authorization": bearerToken } : {}),
      "apikey": serviceRoleKey
    },
    body: JSON.stringify(payload)
  })

  console.log("financial-engine-agent downstream agent completed", {
    agent,
    status: response.status,
    ok: response.ok
  })

  return response
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

  let deal_id = ""
  const warnings: WarningEntry[] = []

  const addWarning = (agent: string, issue: string, message: string) => {
    console.warn("financial-engine-agent warning", { deal_id, agent, issue, message })
    warnings.push({ agent, issue, message })
  }

  try {
    let payload: FinancialEngineRequest
    const requestAuthorizationHeader = req.headers.get("Authorization")

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    if (payload.deal_id !== undefined && typeof payload.deal_id !== "string") {
      return jsonResponse({ error: "deal_id must be a string" }, 400)
    }

    deal_id = typeof payload.deal_id === "string" ? payload.deal_id.trim() : ""

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

    if (!isUuid(deal_id)) {
      return jsonResponse({ error: "deal_id must be a valid UUID" }, 400)
    }

    console.log("financial-engine-agent request received", {
      deal_id,
      refresh_yield: refreshYield,
      use_comparable_sales: useComparableSales
    })

    const supabase = createClient(supabaseUrl, serviceKey)

    if (refreshYield) {
      try {
        console.log("financial-engine-agent downstream call", {
          deal_id,
          agent: "yield-agent"
        })
        const yieldResponse = await callAgent(
          supabaseUrl,
          serviceKey,
          requestAuthorizationHeader,
          "yield-agent",
          {
            deal_id,
            use_comparable_sales: useComparableSales
          }
        )

        if (!yieldResponse.ok) {
          const errorText = await yieldResponse.text()
          addWarning("yield-agent", "Failed to fetch data", errorText)
        }
      } catch (error) {
        addWarning("yield-agent", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
      }
    }

    const siteResponse = await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=deal_id,address,zoning,fsr,height_limit,flood_risk,heritage_status,site_area,estimated_gfa,estimated_units,estimated_revenue,estimated_build_cost,estimated_profit&order=updated_at.desc&limit=1`,
      {
        headers: buildRestHeaders(serviceKey)
      }
    )

    if (!siteResponse.ok) {
      throw new Error(`Failed to load site intelligence: ${await siteResponse.text()}`)
    }

    const siteRows = await siteResponse.json() as SiteIntelligenceRow[]
    const site = siteRows[0] ?? null

    if (!site) {
      addWarning("financial-engine-agent", "Fallback used", "No site intelligence found")
      return jsonResponse({
        success: true,
        deal_id,
        address: null,
        planning_constraints: {
          zoning: null,
          fsr: null,
          height_limit: null,
          flood_risk: null,
          heritage_status: null
        },
        estimated_units: null,
        comparable_sales: null,
        assumptions: null,
        revenue_estimate: null,
        cost_estimate: null,
        revenue: null,
        cost: null,
        profit: null,
        margin: null,
        residual_land_value: null,
        build_cost_per_sqm: null,
        sale_price_per_sqm: null,
        planning_risk_multiplier: null,
        cost_breakdown: null,
        formulas: null,
        snapshot_id: null,
        warnings,
        warning_messages: warnings.map((warning) => `${warning.agent}: ${warning.message}`),
        data: {
          deal_id,
          revenue: null,
          cost: null,
          profit: null,
          margin: null,
          residual_land_value: null
        }
      })
    }

    let assumptions: CalculationAssumptions

    try {
      assumptions = resolveAssumptions(payload.assumptions)
    } catch (validationError) {
      return jsonResponse({
        error: validationError instanceof Error ? validationError.message : "Invalid assumptions"
      }, 400)
    }
    const fallbackSiteArea = parseNumberLoose(site.site_area) ?? DEFAULT_FALLBACK_SITE_AREA
    const fallbackFsr = parseNumberLoose(site.fsr) ?? DEFAULT_FALLBACK_FSR
    const estimatedGfa =
      parseNumberLoose(site.estimated_gfa) ??
      roundCurrency(fallbackSiteArea * fallbackFsr)
    const existingRevenue = parseNumberLoose(site.estimated_revenue)
    const resolvedEstimatedUnits =
      site.estimated_units ??
      Math.max(1, Math.floor(estimatedGfa / DEFAULT_AVG_UNIT_SIZE))

    if (estimatedGfa === null || estimatedGfa <= 0) {
      addWarning("financial-engine-agent", "Fallback used", "Estimated GFA is unavailable for financial modelling")
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
        comparable_sales: null,
        assumptions,
        revenue_estimate: null,
        cost_estimate: null,
        revenue: null,
        cost: null,
        profit: null,
        margin: null,
        residual_land_value: null,
        build_cost_per_sqm: null,
        sale_price_per_sqm: null,
        planning_risk_multiplier: null,
        cost_breakdown: null,
        formulas: null,
        snapshot_id: null,
        warnings,
        warning_messages: warnings.map((warning) => `${warning.agent}: ${warning.message}`),
        data: {
          deal_id,
          revenue: null,
          cost: null,
          profit: null,
          margin: null,
          residual_land_value: null
        }
      })
    }

    const { data: comparableData, error: comparableError } = await supabase
      .from("comparable_sales_estimates")
      .select("id, estimated_sale_price_per_sqm, currency, rationale, created_at")
      .eq("deal_id", deal_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (comparableError) {
      addWarning("comparable-sales-agent", "Failed to fetch data", comparableError.message)
    }
    const latestComparable = comparableData as ComparableSalesEstimateRow | null
    const comparablePricePerSqm = parseNumberLoose(
      latestComparable?.estimated_sale_price_per_sqm
    )

    const { data: comparableEvidenceData, error: comparableEvidenceError } = latestComparable?.id
      ? await supabase
          .from("comparable_sales_evidence")
          .select(
            "project_name, location, dwelling_type, estimated_sale_price_per_sqm, similarity_reason"
          )
          .eq("estimate_id", latestComparable.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : { data: [], error: null }

    if (comparableEvidenceError) {
      addWarning("comparable-sales-agent", "Failed to fetch data", comparableEvidenceError.message)
    }
    const nearbyDevelopments = (comparableEvidenceData ||
      []) as ComparableSalesEvidenceRow[]

    const fallbackPricePerSqm =
      existingRevenue !== null && existingRevenue > 0 ? existingRevenue / estimatedGfa : null
    const resolvedPricePerSqm =
      useComparableSales && comparablePricePerSqm !== null && comparablePricePerSqm > 0
        ? comparablePricePerSqm
        : fallbackPricePerSqm

    if (resolvedPricePerSqm === null || resolvedPricePerSqm <= 0) {
      addWarning(
        "financial-engine-agent",
        "Fallback used",
        "No comparable price or fallback revenue is available"
      )
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
        estimated_units: resolvedEstimatedUnits,
        comparable_sales: {
          ...(latestComparable || {}),
          nearby_developments: nearbyDevelopments
        },
        assumptions,
        revenue_estimate: null,
        cost_estimate: null,
        revenue: null,
        cost: null,
        profit: null,
        margin: null,
        residual_land_value: null,
        build_cost_per_sqm: null,
        sale_price_per_sqm: null,
        planning_risk_multiplier: null,
        cost_breakdown: null,
        formulas: null,
        snapshot_id: null,
        warnings,
        warning_messages: warnings.map((warning) => `${warning.agent}: ${warning.message}`),
        data: {
          deal_id,
          revenue: null,
          cost: null,
          profit: null,
          margin: null,
          residual_land_value: null
        }
      })
    }

    const revenueSource =
      useComparableSales && comparablePricePerSqm !== null && comparablePricePerSqm > 0
        ? "comparable-sales-agent"
        : "yield-agent-fallback"
    const revenueEstimate = roundCurrency(resolvedPricePerSqm * estimatedGfa)

    const planningRisk = getPlanningRiskMultiplier(site)
    const feasibility = calculateFeasibility(
      {
        gfa: estimatedGfa,
        revenue: revenueEstimate,
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
        estimated_units: resolvedEstimatedUnits,
        planning_constraints: {
          zoning: site.zoning || null,
          fsr: site.fsr || null,
          height_limit: site.height_limit || null,
          flood_risk: site.flood_risk || null,
          heritage_status: site.heritage_status || null
        },
        comparable_sales: {
          ...(latestComparable || {}),
          nearby_developments: nearbyDevelopments
        },
        assumptions,
        revenue_assumptions: {
          gfa: estimatedGfa,
          price_per_sqm: roundCurrency(resolvedPricePerSqm),
          source: revenueSource
        },
        planning_risk_notes: planningRisk.notes,
        feasibility
      }
    }

    let snapshotId: string | null = null

    try {
      const { data: snapshotData, error: snapshotError } = await supabase
        .from("financial_snapshots")
        .insert(snapshotPayload)
        .select()
        .single()

      if (snapshotError) {
        addWarning("financial-engine-agent", "Failed to persist data", snapshotError.message)
      } else {
        snapshotId = snapshotData.id
      }
    } catch (error) {
      addWarning("financial-engine-agent", "Failed to persist data", error instanceof Error ? error.message : "unknown error")
    }

    try {
      const { error: actionError } = await supabase
        .from("ai_actions")
        .insert({
          deal_id,
          agent: "financial-engine-agent",
          action: "financial_feasibility_calculated",
          payload: {
            snapshot_id: snapshotId,
            assumptions,
            revenue_assumptions: {
              gfa: estimatedGfa,
              price_per_sqm: roundCurrency(resolvedPricePerSqm),
              source: revenueSource
            },
            planning_risk_multiplier: planningRisk.multiplier,
            revenue: feasibility.revenue,
            cost: feasibility.cost,
            profit: feasibility.profit,
            margin: feasibility.margin,
            residual_land_value: feasibility.residual_land_value
          }
        })

      if (actionError) {
        addWarning("financial-engine-agent", "Failed to persist data", actionError.message)
      }
    } catch (error) {
      addWarning("financial-engine-agent", "Failed to persist data", error instanceof Error ? error.message : "unknown error")
    }

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
      estimated_units: resolvedEstimatedUnits,
      comparable_sales: {
        ...(latestComparable || {}),
        nearby_developments: nearbyDevelopments
      },
      assumptions: {
        ...assumptions,
        price_per_sqm: roundCurrency(resolvedPricePerSqm),
        source: revenueSource
      },
      revenue_estimate: feasibility.revenue,
      cost_estimate: feasibility.cost,
      ...feasibility,
      snapshot_id: snapshotId,
      warnings,
      warning_messages: warnings.map((warning) => `${warning.agent}: ${warning.message}`),
      data: {
        deal_id,
        revenue: feasibility.revenue,
        cost: feasibility.cost,
        profit: feasibility.profit,
        margin: feasibility.margin,
        residual_land_value: feasibility.residual_land_value
      }
    })
  } catch (error) {
    console.error("financial-engine-agent failed", error)

    return jsonResponse({
      success: true,
      deal_id,
      address: null,
      planning_constraints: {
        zoning: null,
        fsr: null,
        height_limit: null,
        flood_risk: null,
        heritage_status: null
      },
      estimated_units: null,
      comparable_sales: null,
      assumptions: null,
      revenue_estimate: null,
      cost_estimate: null,
      revenue: null,
      cost: null,
      profit: null,
      margin: null,
      residual_land_value: null,
      build_cost_per_sqm: null,
      sale_price_per_sqm: null,
      planning_risk_multiplier: null,
      cost_breakdown: null,
      formulas: null,
      snapshot_id: null,
      warnings: [
        ...warnings,
        {
          agent: "financial-engine-agent",
          issue: "Unhandled processing error",
          message: getErrorMessage(error)
        }
      ],
      warning_messages: [
        ...warnings.map((warning) => `${warning.agent}: ${warning.message}`),
        `financial-engine-agent: ${getErrorMessage(error)}`
      ],
      data: {
        deal_id,
        revenue: null,
        cost: null,
        profit: null,
        margin: null,
        residual_land_value: null
      }
    })
  }
})
