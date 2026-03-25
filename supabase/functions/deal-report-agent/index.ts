import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type DealRecord = {
  id: string
  address?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  stage?: string | null
  status?: string | null
}

type FinancialSnapshotRecord = {
  id: string
  category?: string | null
  amount?: number | null
  gdv?: number | null
  tdc?: number | null
  notes?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

type FinancialEngineResponse = {
  success: boolean
  revenue?: number | null
  cost?: number | null
  profit?: number | null
  margin?: number | null
  residual_land_value?: number | null
  snapshot_id?: string | null
}

type ContextPayload = {
  deal?: DealRecord | null
  tasks?: Array<Record<string, unknown>>
  communications?: Array<Record<string, unknown>>
  financials?: FinancialSnapshotRecord[]
  risks?: Array<Record<string, unknown>>
}

type SiteIntelligenceRecord = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  estimated_gfa?: number | null
  estimated_units?: number | null
  estimated_revenue?: number | null
  estimated_build_cost?: number | null
  estimated_profit?: number | null
}

type ComparableEstimateRecord = {
  id?: string | null
  estimated_sale_price_per_sqm?: number | null
  currency?: string | null
  rationale?: string | null
  created_at?: string | null
}

type RankingCandidateRecord = {
  address?: string | null
  ranking_score?: number | null
  ranking_tier?: "A" | "B" | "C" | null
  ranking_reasons?: Array<{ summary?: string | null }> | null
}

type StageOutcome = {
  success: boolean
  skipped?: boolean
  reason?: string
  data?: unknown
  error?: string
}

type WarningEntry = {
  agent: string
  issue: string
  message: string
}

type StructuredReport = {
  address: string
  planning_controls: {
    zoning: string
    fsr: string
    height_limit: string
    flood_risk: string
    heritage_status: string
  }
  development_potential: {
    gfa: number | null
    units: number | null
  }
  feasibility: {
    estimated_revenue: number | null
    estimated_costs: number | null
    projected_profit: number | null
    margin: number | null
    residual_land_value: number | null
  }
  comparable_sales_summary: {
    available: boolean
    estimated_sale_price_per_sqm: number | null
    currency: string
    rationale: string
    source: string
  }
  opportunity_score: {
    score: number | null
    tier: string
    reason: string
  }
  recommendation: "Strong" | "Moderate" | "Weak"
  reasoning: string[]
  context: {
    stage: string
    status: string
    open_task_count: number
    risk_count: number
    latest_communication_summary: string
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function cleanJsonBlock(text: string) {
  return text.replace("```json", "").replace("```", "").trim()
}

function asString(value: unknown, fallback = "Unknown") {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
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

  console.log("deal-report-agent calling downstream agent", {
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

  console.log("deal-report-agent downstream agent completed", {
    agent,
    status: response.status,
    ok: response.ok
  })

  return response
}

async function invokeFunction(
  supabaseUrl: string,
  serviceRoleKey: string,
  authorizationHeader: string | null,
  agent: string,
  payload: Record<string, unknown>
): Promise<StageOutcome> {
  try {
    const response = await callAgent(
      supabaseUrl,
      serviceRoleKey,
      authorizationHeader,
      agent,
      payload
    )

    const responseText = await response.text()
    let data: unknown = null

    try {
      data = JSON.parse(responseText)
    } catch {
      data = responseText
    }

    if (!response.ok) {
      return {
        success: false,
        error:
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : responseText,
        data
      }
    }

    return {
      success: true,
      data
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}

async function getLatestComparableEstimate(
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const { data, error } = await supabase
    .from("comparable_sales_estimates")
    .select("id, estimated_sale_price_per_sqm, currency, rationale, created_at")
    .eq("deal_id", deal_id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as ComparableEstimateRecord | null
}

async function loadDealDirect(
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const { data, error } = await supabase
    .from("deals")
    .select("id, address, suburb, state, postcode, stage, status")
    .eq("id", deal_id)
    .maybeSingle()

  if (error) throw error
  return data as DealRecord | null
}

async function loadContextDirect(
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const [tasksResult, communicationsResult, financialsResult, risksResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("deal_id", deal_id),
    supabase
      .from("communications")
      .select("*")
      .eq("deal_id", deal_id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("financial_snapshots")
      .select("id, category, amount, gdv, tdc, notes, metadata, created_at")
      .eq("deal_id", deal_id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("risks").select("*").eq("deal_id", deal_id)
  ])

  return {
    tasks: tasksResult.data || [],
    communications: communicationsResult.data || [],
    financials: financialsResult.data || [],
    risks: risksResult.data || []
  } satisfies Omit<ContextPayload, "deal">
}

function extractMargin(financialSnapshot: FinancialSnapshotRecord | null, profit: number | null, revenue: number | null) {
  const feasibility = financialSnapshot?.metadata?.feasibility as Record<string, unknown> | undefined
  const metadataMargin = asNumber(feasibility?.margin)
  if (metadataMargin !== null) return metadataMargin
  if (profit !== null && revenue && revenue > 0) return Number((profit / revenue).toFixed(4))
  return null
}

function extractResidualLandValue(financialSnapshot: FinancialSnapshotRecord | null) {
  const feasibility = financialSnapshot?.metadata?.feasibility as Record<string, unknown> | undefined
  return asNumber(feasibility?.residual_land_value)
}

function buildRecommendation(
  score: number | null,
  margin: number | null,
  units: number | null,
  floodRisk: string
): StructuredReport["recommendation"] {
  const safeScore = score ?? 0
  const safeMargin = margin ?? 0
  const safeUnits = units ?? 0
  const flood = floodRisk.toLowerCase()

  if (safeScore >= 70 && safeMargin >= 0.2 && safeUnits >= 12 && !flood.includes("high")) {
    return "Strong"
  }

  if (safeScore >= 45 && safeMargin > 0 && !flood.includes("high")) {
    return "Moderate"
  }

  return "Weak"
}

function buildFallbackSummary(report: StructuredReport) {
  return [
    `Site: ${report.address}.`,
    `Planning controls: zoning ${report.planning_controls.zoning}, FSR ${report.planning_controls.fsr}, height ${report.planning_controls.height_limit}, flood ${report.planning_controls.flood_risk}, heritage ${report.planning_controls.heritage_status}.`,
    `Development potential: GFA ${report.development_potential.gfa ?? "unknown"} and ${report.development_potential.units ?? "unknown"} units.`,
    `Feasibility: revenue ${report.feasibility.estimated_revenue ?? "unknown"}, costs ${report.feasibility.estimated_costs ?? "unknown"}, profit ${report.feasibility.projected_profit ?? "unknown"}, margin ${report.feasibility.margin ?? "unknown"}.`,
    `Comparable sales: ${report.comparable_sales_summary.available ? `${report.comparable_sales_summary.estimated_sale_price_per_sqm} ${report.comparable_sales_summary.currency}/sqm` : "not available"}.`,
    `Opportunity score: ${report.opportunity_score.score ?? "unscored"} (${report.opportunity_score.tier}).`,
    `Recommendation: ${report.recommendation}.`
  ].join(" ")
}

serve(createAgentHandler({ agentName: "deal-report-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  let deal_id = ""
  let summarySource = "fallback"
  let stage_results: Record<string, StageOutcome> = {}
  const warnings: WarningEntry[] = []

  const addWarning = (agent: string, issue: string, message: string) => {
    console.warn("deal-report-agent warning", { deal_id, agent, issue, message })
    warnings.push({ agent, issue, message })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const requestAuthorizationHeader = req.headers.get("Authorization")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    let payload: { deal_id?: string; use_comparable_sales?: boolean }

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    if (payload.deal_id !== undefined && typeof payload.deal_id !== "string") {
      return jsonResponse({ error: "deal_id must be a string" }, 400)
    }

    if (
      payload.use_comparable_sales !== undefined &&
      typeof payload.use_comparable_sales !== "boolean"
    ) {
      return jsonResponse({ error: "use_comparable_sales must be a boolean" }, 400)
    }

    deal_id = typeof payload.deal_id === "string" ? payload.deal_id.trim() : ""
    const useComparableSales = payload.use_comparable_sales !== false

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400)
    }

    if (!isUuid(deal_id)) {
      return jsonResponse({ error: "deal_id must be a valid UUID" }, 400)
    }

    console.log("deal-report-agent request received", { deal_id })

    const supabase = createClient(supabaseUrl, serviceKey)

    let deal: DealRecord | null = null
    let contextPayload: ContextPayload | null = null

    try {
      const getDealResult = await invokeFunction(
        supabaseUrl,
        serviceKey,
        requestAuthorizationHeader,
        "get-deal",
        { deal_id }
      )
      stage_results["get-deal"] = getDealResult
      if (getDealResult.success) {
        const dealPayload = (getDealResult.data as ContextPayload | null) || null
        deal = (dealPayload?.deal || getDealResult.data) as DealRecord | null
      } else {
        addWarning("get-deal", "Failed to fetch data", getDealResult.error || "unknown error")
      }
    } catch (error) {
      addWarning("get-deal", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
    }

    try {
      const getDealContextResult = await invokeFunction(
        supabaseUrl,
        serviceKey,
        requestAuthorizationHeader,
        "get-deal-context",
        { deal_id }
      )
      stage_results["get-deal-context"] = getDealContextResult
      if (getDealContextResult.success) {
        contextPayload = (getDealContextResult.data as ContextPayload | null) || null
        deal = deal || (contextPayload?.deal as DealRecord | null) || null
      } else {
        addWarning("get-deal-context", "Failed to fetch data", getDealContextResult.error || "unknown error")
      }
    } catch (error) {
      addWarning("get-deal-context", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
    }

    if (!deal) {
      try {
        deal = await loadDealDirect(supabase, deal_id)
        if (deal) {
          console.log("deal-report-agent fallback used", { deal_id, source: "direct-deal-query" })
        } else {
          addWarning("deal-report-agent", "Fallback used", "Deal record not available from direct query")
        }
      } catch (error) {
        addWarning("deal-report-agent", "Fallback used", error instanceof Error ? error.message : "direct deal query failed")
      }
    }

    if (!contextPayload) {
      try {
        const directContext = await loadContextDirect(supabase, deal_id)
        contextPayload = {
          deal,
          ...directContext
        }
        console.log("deal-report-agent fallback used", { deal_id, source: "direct-context-query" })
      } catch (error) {
        addWarning("deal-report-agent", "Fallback used", error instanceof Error ? error.message : "direct context query failed")
        contextPayload = {
          deal,
          tasks: [],
          communications: [],
          financials: [],
          risks: []
        }
      }
    }

    if (!deal) {
      return jsonResponse({ error: "Deal not found" }, 404)
    }

    const address = asString(deal.address, "Address unavailable")
    const planningAgents = ["zoning-agent", "fsr-agent", "height-agent", "flood-agent", "heritage-agent"]

    for (const agent of planningAgents) {
      try {
        console.log("deal-report-agent downstream call", { deal_id, agent })
        const result = await invokeFunction(
          supabaseUrl,
          serviceKey,
          requestAuthorizationHeader,
          agent,
          { deal_id, address }
        )
        stage_results[agent] = result
        if (!result.success) {
          addWarning(agent, "Failed to fetch data", result.error || "unknown error")
        }
      } catch (error) {
        stage_results[agent] = {
          success: false,
          error: error instanceof Error ? error.message : "unknown error"
        }
        addWarning(agent, "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
      }
    }

    if (!useComparableSales) {
      stage_results["comparable-sales-agent"] = {
        success: true,
        skipped: true,
        reason: "Skipped because use_comparable_sales was disabled"
      }
    } else {
      try {
        console.log("deal-report-agent downstream call", { deal_id, agent: "comparable-sales-agent" })
        const comparableRefreshResult = await invokeFunction(
          supabaseUrl,
          serviceKey,
          requestAuthorizationHeader,
          "comparable-sales-agent",
          {
            deal_id,
            radius_km: 5,
            dwelling_type: "apartment"
          }
        )

        stage_results["comparable-sales-agent"] = comparableRefreshResult
        if (!comparableRefreshResult.success) {
          addWarning("comparable-sales-agent", "Failed to fetch data", comparableRefreshResult.error || "unknown error")
        }
      } catch (error) {
        stage_results["comparable-sales-agent"] = {
          success: false,
          error: error instanceof Error ? error.message : "unknown error"
        }
        addWarning("comparable-sales-agent", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
      }
    }

    let financialEngineData: FinancialEngineResponse | null = null

    try {
      console.log("deal-report-agent downstream call", { deal_id, agent: "yield-agent" })
      const yieldResult = await invokeFunction(
        supabaseUrl,
        serviceKey,
        requestAuthorizationHeader,
        "yield-agent",
        {
          deal_id,
          use_comparable_sales: useComparableSales
        }
      )
      stage_results["yield-agent"] = yieldResult
      if (!yieldResult.success) {
        addWarning("yield-agent", "Failed to fetch data", yieldResult.error || "unknown error")
      }
    } catch (error) {
      stage_results["yield-agent"] = {
        success: false,
        error: error instanceof Error ? error.message : "unknown error"
      }
      addWarning("yield-agent", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
    }

    try {
      console.log("deal-report-agent downstream call", { deal_id, agent: "financial-engine-agent" })
      const financialEngineResult = await invokeFunction(
        supabaseUrl,
        serviceKey,
        requestAuthorizationHeader,
        "financial-engine-agent",
        {
          deal_id,
          refresh_yield: false,
          use_comparable_sales: useComparableSales
        }
      )
      stage_results["financial-engine-agent"] = financialEngineResult
      if (!financialEngineResult.success) {
        addWarning("financial-engine-agent", "Failed to fetch data", financialEngineResult.error || "unknown error")
      } else {
        financialEngineData = financialEngineResult.data as FinancialEngineResponse
      }
    } catch (error) {
      stage_results["financial-engine-agent"] = {
        success: false,
        error: error instanceof Error ? error.message : "unknown error"
      }
      addWarning("financial-engine-agent", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
    }

    try {
      console.log("deal-report-agent downstream call", { deal_id, agent: "parcel-ranking-agent" })
      const rankingRefreshResult = await invokeFunction(
        supabaseUrl,
        serviceKey,
        requestAuthorizationHeader,
        "parcel-ranking-agent",
        {
          deal_id
        }
      )
      stage_results["parcel-ranking-agent"] = rankingRefreshResult
      if (!rankingRefreshResult.success) {
        addWarning("parcel-ranking-agent", "Failed to fetch data", rankingRefreshResult.error || "unknown error")
      }
    } catch (error) {
      stage_results["parcel-ranking-agent"] = {
        success: false,
        error: error instanceof Error ? error.message : "unknown error"
      }
      addWarning("parcel-ranking-agent", "Failed to fetch data", error instanceof Error ? error.message : "unknown error")
    }

    let site: SiteIntelligenceRecord | null = null
    try {
      const { data: siteRows, error: siteError } = await supabase
        .from("site_intelligence")
        .select("deal_id, address, zoning, fsr, height_limit, flood_risk, heritage_status, estimated_gfa, estimated_units, estimated_revenue, estimated_build_cost, estimated_profit")
        .eq("deal_id", deal_id)
        .order("updated_at", { ascending: false })
        .limit(1)
      const siteData = siteRows?.[0] ?? null

      if (siteError) {
        addWarning("deal-report-agent", "Fallback used", getErrorMessage(siteError))
      } else {
        site = siteData as SiteIntelligenceRecord | null
      }
    } catch (error) {
      addWarning("deal-report-agent", "Fallback used", getErrorMessage(error))
    }

    const contextFinancials = Array.isArray(contextPayload?.financials)
      ? contextPayload?.financials
      : []

    let latestFinancial =
      contextFinancials.find((snapshot) => snapshot.category === "financial-engine") ||
      contextFinancials[0] ||
      null

    if (financialEngineData?.snapshot_id) {
      try {
        const { data: refreshedFinancialSnapshot, error: refreshedFinancialError } = await supabase
          .from("financial_snapshots")
          .select("id, category, amount, gdv, tdc, notes, metadata, created_at")
          .eq("id", financialEngineData.snapshot_id)
          .maybeSingle()

        if (refreshedFinancialError) {
          addWarning("financial-engine-agent", "Fallback used", getErrorMessage(refreshedFinancialError))
        } else {
          latestFinancial =
            (refreshedFinancialSnapshot as FinancialSnapshotRecord | null) || latestFinancial
        }
      } catch (error) {
        addWarning("financial-engine-agent", "Fallback used", getErrorMessage(error))
      }
    }

    let latestComparable: ComparableEstimateRecord | null = null
    try {
      latestComparable = await getLatestComparableEstimate(supabase, deal_id)
    } catch (error) {
      addWarning("comparable-sales-agent", "Fallback used", getErrorMessage(error))
    }

    let ranking: RankingCandidateRecord | null = null
    try {
      const { data: rankingData, error: rankingError } = await supabase
        .from("site_candidates")
        .select("address, ranking_score, ranking_tier, ranking_reasons")
        .eq("address", site?.address || address)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (rankingError) {
        addWarning("parcel-ranking-agent", "Fallback used", getErrorMessage(rankingError))
      } else {
        ranking = rankingData as RankingCandidateRecord | null
      }
    } catch (error) {
      addWarning("parcel-ranking-agent", "Fallback used", getErrorMessage(error))
    }

    if (!ranking) {
      const rankingStageData =
        stage_results["parcel-ranking-agent"]?.success &&
        stage_results["parcel-ranking-agent"]?.data &&
        typeof stage_results["parcel-ranking-agent"]?.data === "object"
          ? stage_results["parcel-ranking-agent"]?.data as Record<string, unknown>
          : null

      if (rankingStageData) {
        ranking = {
          address,
          ranking_score:
            typeof rankingStageData.score === "number"
              ? rankingStageData.score
              : typeof rankingStageData.ranking_score === "number"
                ? rankingStageData.ranking_score
                : null,
          ranking_tier:
            typeof rankingStageData.tier === "string"
              ? rankingStageData.tier as "A" | "B" | "C"
              : typeof rankingStageData.ranking_tier === "string"
                ? rankingStageData.ranking_tier as "A" | "B" | "C"
                : null,
          ranking_reasons:
            typeof rankingStageData.reasoning === "string"
              ? [{ summary: rankingStageData.reasoning }]
              : typeof rankingStageData.reason === "string"
                ? [{ summary: rankingStageData.reason }]
                : null
        }
      }
    }

    const feasibilityMetadata = latestFinancial?.metadata?.feasibility as Record<string, unknown> | undefined

    const estimatedRevenue =
      financialEngineData?.revenue ??
      latestFinancial?.gdv ??
      asNumber(feasibilityMetadata?.revenue) ??
      site?.estimated_revenue ??
      null
    const estimatedCosts =
      financialEngineData?.cost ??
      latestFinancial?.tdc ??
      asNumber(feasibilityMetadata?.cost) ??
      site?.estimated_build_cost ??
      null
    const projectedProfit =
      financialEngineData?.profit ??
      latestFinancial?.amount ??
      asNumber(feasibilityMetadata?.profit) ??
      site?.estimated_profit ??
      null
    const margin = extractMargin(latestFinancial, projectedProfit, estimatedRevenue)
    const residualLandValue =
      financialEngineData?.residual_land_value ??
      extractResidualLandValue(latestFinancial)

    const report: StructuredReport = {
      address: site?.address || address,
      planning_controls: {
        zoning: asString(site?.zoning, "Unknown"),
        fsr: asString(site?.fsr, "Unknown"),
        height_limit: asString(site?.height_limit, "Unknown"),
        flood_risk: asString(site?.flood_risk, "Unknown"),
        heritage_status: asString(site?.heritage_status, "Unknown")
      },
      development_potential: {
        gfa: site?.estimated_gfa ?? null,
        units: site?.estimated_units ?? null
      },
      feasibility: {
        estimated_revenue: estimatedRevenue,
        estimated_costs: estimatedCosts,
        projected_profit: projectedProfit,
        margin,
        residual_land_value: residualLandValue
      },
      comparable_sales_summary: {
        available: Boolean(latestComparable?.estimated_sale_price_per_sqm),
        estimated_sale_price_per_sqm: latestComparable?.estimated_sale_price_per_sqm ?? null,
        currency: asString(latestComparable?.currency, "AUD"),
        rationale: asString(latestComparable?.rationale, "No comparable sales rationale available"),
        source: latestComparable ? "comparable-sales-agent" : "unavailable"
      },
      opportunity_score: {
        score: ranking?.ranking_score ?? null,
        tier: asString(ranking?.ranking_tier, "Unrated"),
        reason:
          ranking?.ranking_reasons?.map((item) => item.summary).filter(Boolean).slice(0, 3).join("; ") ||
          "Ranking rationale unavailable"
      },
      recommendation: "Weak",
      reasoning: [],
      context: {
        stage: asString(deal.stage, "Unknown"),
        status: asString(deal.status, "Unknown"),
        open_task_count: Array.isArray(contextPayload?.tasks)
          ? contextPayload.tasks.filter((task) => task?.status === "open").length
          : 0,
        risk_count: Array.isArray(contextPayload?.risks) ? contextPayload.risks.length : 0,
        latest_communication_summary:
          Array.isArray(contextPayload?.communications) && contextPayload.communications.length > 0
            ? asString(contextPayload.communications[0]?.message_summary, "No communication summary available")
            : "No communication summary available"
      }
    }

    report.recommendation = buildRecommendation(
      report.opportunity_score.score,
      report.feasibility.margin,
      report.development_potential.units,
      report.planning_controls.flood_risk
    )

    report.reasoning = [
      `Planning controls show zoning ${report.planning_controls.zoning} with FSR ${report.planning_controls.fsr} and height ${report.planning_controls.height_limit}.`,
      `Development potential is ${report.development_potential.gfa ?? "unknown"}sqm GFA and ${report.development_potential.units ?? "unknown"} units.`,
      `Feasibility indicates revenue ${report.feasibility.estimated_revenue ?? "unknown"}, costs ${report.feasibility.estimated_costs ?? "unknown"}, and profit ${report.feasibility.projected_profit ?? "unknown"}.`,
      report.comparable_sales_summary.available
        ? `Comparable sales indicate ${report.comparable_sales_summary.estimated_sale_price_per_sqm} ${report.comparable_sales_summary.currency}/sqm.`
        : "Comparable sales data is not currently available.",
      `Opportunity score is ${report.opportunity_score.score ?? "unscored"} (${report.opportunity_score.tier}).`
    ]

    let humanReadableSummary = buildFallbackSummary(report)
    let summarySource = "fallback"

    const aiResponse = await invokeFunction(supabaseUrl, serviceKey, requestAuthorizationHeader, "ai-agent", {
      deal_id,
      prompt: `
Generate a concise human-readable investment summary for a development opportunity.

Return ONLY valid JSON in this exact format:
{
  "human_readable_summary": "string"
}

Deal report data:
${JSON.stringify(report, null, 2)}
`
    })

    if (aiResponse.success) {
      try {
        const aiData = aiResponse.data as Record<string, unknown>
        const responseText = (
          aiData?.ai_result as { output?: Array<{ content?: Array<{ text?: string }> }> } | undefined
        )?.output?.[0]?.content?.[0]?.text

        if (typeof responseText === "string" && responseText.trim()) {
          const parsed = JSON.parse(cleanJsonBlock(responseText))
          if (typeof parsed.human_readable_summary === "string" && parsed.human_readable_summary.trim()) {
            humanReadableSummary = parsed.human_readable_summary.trim()
            summarySource = "ai-agent"
          }
        }
      } catch (error) {
        addWarning("ai-agent", "Failed to parse summary", error instanceof Error ? error.message : "unknown error")
      }
    } else {
      addWarning("ai-agent", "Failed to fetch data", aiResponse.error || "unknown error")
    }

    try {
      const { error: actionLogError } = await supabase.from("ai_actions").insert({
        deal_id,
        agent: "deal-report-agent",
        action: "investment_report_generated",
        payload: {
          summary_source: summarySource,
          warnings,
          stage_results,
          report
        }
      })

      if (actionLogError) {
        addWarning("deal-report-agent", "Failed to persist action log", getErrorMessage(actionLogError))
      }
    } catch (error) {
      addWarning("deal-report-agent", "Failed to persist action log", getErrorMessage(error))
    }

    try {
      const { error: reportIndexError } = await supabase.from("report_index").insert({
        deal_id,
        report_type: "deal_report",
        source_agent: "deal-report-agent",
        source_action: "investment_report_generated",
        payload: {
          report,
          human_readable_summary: humanReadableSummary,
          summary_source: summarySource,
          warnings
        }
      })

      if (reportIndexError) {
        addWarning("deal-report-agent", "Failed to persist report index", getErrorMessage(reportIndexError))
      }
    } catch (error) {
      addWarning("deal-report-agent", "Failed to persist report index", getErrorMessage(error))
    }

    console.log("deal-report-agent processing complete", {
      deal_id,
      recommendation: report.recommendation,
      summary_source: summarySource,
      ranking_score: report.opportunity_score.score
    })

    return jsonResponse({
      success: true,
      deal_id,
      report,
      human_readable_summary: humanReadableSummary,
      summary_source: summarySource,
      warnings,
      warning_messages: warnings.map((warning) => `${warning.agent}: ${warning.message}`),
      stage_results
      ,
      data: {
        deal_id,
        report,
        human_readable_summary: humanReadableSummary,
        summary_source: summarySource,
        stage_results
      }
    })
  } catch (error) {
    console.error("deal-report-agent failed", error)

    return jsonResponse({
      success: true,
      deal_id,
      report: null,
      human_readable_summary: "Report generation completed with errors and limited data.",
      summary_source: summarySource,
      warnings: [
        ...warnings,
        {
          agent: "deal-report-agent",
          issue: "Unhandled processing error",
          message: error instanceof Error ? error.message : "Unknown error"
        }
      ],
      warning_messages: [
        ...warnings.map((warning) => `${warning.agent}: ${warning.message}`),
        `deal-report-agent: ${error instanceof Error ? error.message : "Unknown error"}`
      ],
      stage_results,
      data: {
        deal_id,
        report: null,
        human_readable_summary: "Report generation completed with errors and limited data.",
        summary_source: summarySource,
        stage_results
      }
    })
  }
}));

