import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type SiteIntelligenceRequest = {
  deal_id?: string
  address?: string
  force_refresh?: boolean
  use_comparable_sales?: boolean
}

type RankingAgentResponse = {
  success?: boolean
  score?: number
  tier?: "A" | "B" | "C"
  reasoning?: string
  reason?: string
}

type StageResult = {
  success: boolean
  skipped?: boolean
  reason?: string
  data?: unknown
  error?: string
}

type SiteRow = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  site_area?: number | null
  estimated_units?: number | null
  estimated_profit?: number | null
}

type WarningEntry = {
  agent: string
  issue: string
  message: string
}

type PipelineRun = {
  results: Record<string, StageResult>
  completed_stages: string[]
  failed_stages: string[]
  skipped_stages: string[]
  warnings: string[]
}

const PIPELINE_ACTION = "site_pipeline_completed"
const PIPELINE_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_REPORT_TRIGGER_SCORE_THRESHOLD = 50
const CRITICAL_STAGES = new Set([
  "zoning-agent",
  "flood-agent",
  "height-agent",
  "fsr-agent",
  "heritage-agent",
  "yield-agent",
  "financial-engine-agent",
  "parcel-ranking-agent",
  "deal-report-agent"
])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function getEnvNumber(name: string, fallback: number) {
  const value = Deno.env.get(name)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return String((error as { message?: unknown }).message)
    }

    try {
      return JSON.stringify(error)
    } catch {
      return "Unknown error"
    }
  }

  return "Unknown error"
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function buildFunctionHeaders(serviceKey: string, authorizationHeader: string | null) {
  const normalizedRequestAuthorization =
    typeof authorizationHeader === "string" && authorizationHeader.trim().length > 0
      ? authorizationHeader.trim()
      : null
  const bearerToken = normalizedRequestAuthorization?.toLowerCase().startsWith("bearer ")
    ? normalizedRequestAuthorization
    : serviceKey.includes(".")
      ? `Bearer ${serviceKey}`
      : normalizedRequestAuthorization
        ? `Bearer ${normalizedRequestAuthorization.replace(/^Bearer\s+/i, "")}`
        : null

  return {
    "Content-Type": "application/json",
    ...(bearerToken ? { "Authorization": bearerToken } : {}),
    "apikey": serviceKey
  }
}

function buildRestHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey
  }
}

async function fetchLatestSiteRow(
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string,
  selectClause =
    "deal_id,address,zoning,fsr,height_limit,flood_risk,heritage_status,site_area,estimated_units,estimated_profit"
) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=${encodeURIComponent(selectClause)}&order=updated_at.desc&limit=1`,
    {
      headers: buildRestHeaders(serviceKey)
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to load site intelligence: ${await response.text()}`)
  }

  const rows = await response.json() as SiteRow[]
  return rows[0] ?? null
}

async function ensureDealAndSite(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string,
  address: string
) {
  const { error: dealError } = await supabase
    .from("deals")
    .upsert(
      {
        id: deal_id,
        address,
        status: "active",
        stage: "opportunity",
        source: "site-intelligence-agent"
      },
      { onConflict: "id" }
    )

  if (dealError) throw new Error(`Failed to upsert deal: ${getErrorMessage(dealError)}`)

  const existingSite = await fetchLatestSiteRow(
    supabaseUrl,
    serviceKey,
    deal_id,
    "deal_id,address"
  )

  if (existingSite?.deal_id) {
    const { error: updateError } = await supabase
      .from("site_intelligence")
      .update({ address })
      .eq("deal_id", deal_id)

    if (updateError) {
      throw new Error(`Failed to update site intelligence: ${getErrorMessage(updateError)}`)
    }
    return
  }

  const { error: insertError } = await supabase
    .from("site_intelligence")
    .insert({
      deal_id,
      address
    })

  if (insertError) {
    throw new Error(`Failed to insert site intelligence: ${getErrorMessage(insertError)}`)
  }
}

async function shouldSkipPipeline(
  supabase: ReturnType<typeof createClient>,
  deal_id: string,
  forceRefresh: boolean
) {
  if (forceRefresh) {
    return false
  }

  const cutoff = new Date(Date.now() - PIPELINE_COOLDOWN_MS).toISOString()
  const { data, error } = await supabase
    .from("ai_actions")
    .select("created_at")
    .eq("deal_id", deal_id)
    .eq("agent", "site-intelligence-agent")
    .eq("action", PIPELINE_ACTION)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.created_at)
}

async function invokeAgent(
  supabaseUrl: string,
  serviceKey: string,
  authorizationHeader: string | null,
  agent: string,
  payload: Record<string, unknown>
): Promise<StageResult> {
  try {
    console.log("site-intelligence-agent stage starting", { agent, payload })

    const response = await fetch(`${supabaseUrl}/functions/v1/${agent}`, {
      method: "POST",
      headers: buildFunctionHeaders(serviceKey, authorizationHeader),
      body: JSON.stringify(payload)
    })

    let data: unknown = null
    try {
      data = await response.json()
    } catch {
      data = await response.text()
    }

    if (!response.ok) {
      const errorMessage =
        typeof data === "object" && data !== null && "error" in data
          ? String((data as { error?: unknown }).error)
          : typeof data === "string"
            ? data
            : `Agent ${agent} failed`

      console.log("site-intelligence-agent stage failed", {
        agent,
        error: errorMessage
      })

      return {
        success: false,
        error: errorMessage,
        data
      }
    }

    console.log("site-intelligence-agent stage completed", { agent })

    return {
      success: true,
      data
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)

    console.log("site-intelligence-agent stage exception", {
      agent,
      error: errorMessage
    })

    return {
      success: false,
      error: errorMessage
    }
  }
}

async function getSiteRow(
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string
) {
  return await fetchLatestSiteRow(supabaseUrl, serviceKey, deal_id)
}

async function dealExists(
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const { data, error } = await supabase
    .from("deals")
    .select("id")
    .eq("id", deal_id)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.id)
}

async function upsertSiteCandidate(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string,
  address: string
) {
  const site = await getSiteRow(supabaseUrl, serviceKey, deal_id)

  const { error } = await supabase
    .from("site_candidates")
    .upsert(
      {
        source: "site-intelligence-agent",
        external_id: deal_id,
        address,
        property_type: "development-site",
        land_area: site?.site_area ?? null,
        raw_data: {
          deal_id,
          source_agent: "site-intelligence-agent"
        },
        zoning: site?.zoning ?? null,
        height_limit: site?.height_limit ?? null,
        fsr: site?.fsr ?? null,
        flood_risk: site?.flood_risk ?? null,
        heritage_status: site?.heritage_status ?? null,
        estimated_units: site?.estimated_units ?? null,
        estimated_profit: site?.estimated_profit ?? null
      },
      { onConflict: "source,external_id" }
    )

  if (error) throw new Error(`Failed to upsert site candidate: ${getErrorMessage(error)}`)
}

async function hasComparableEstimate(
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const { data, error } = await supabase
    .from("comparable_sales_estimates")
    .select("id")
    .eq("deal_id", deal_id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Boolean(data?.id)
}

function hasUsableCachedPlanningValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

async function logPipeline(
  supabase: ReturnType<typeof createClient>,
  deal_id: string,
  run: PipelineRun,
  decision?: {
    ranking_score: number | null
    report_trigger_threshold: number
    report_triggered: boolean
    report_trigger_reason: string
  }
) {
  const { error } = await supabase
    .from("ai_actions")
    .insert({
      deal_id,
      agent: "site-intelligence-agent",
      action: PIPELINE_ACTION,
      payload: {
        completed_stages: run.completed_stages,
        failed_stages: run.failed_stages,
        skipped_stages: run.skipped_stages,
        warnings: run.warnings,
        results: run.results,
        decision
      }
    })

  if (error) throw new Error(`Failed to log pipeline: ${getErrorMessage(error)}`)
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const reportTriggerThreshold = getEnvNumber(
    "REPORT_TRIGGER_SCORE_THRESHOLD",
    DEFAULT_REPORT_TRIGGER_SCORE_THRESHOLD
  )

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500)
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500)

  try {
    const requestAuthorizationHeader = req.headers.get("Authorization")
    let payload: SiteIntelligenceRequest

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const deal_id =
      typeof payload.deal_id === "string" && payload.deal_id.trim().length > 0
        ? payload.deal_id.trim()
        : ""
    const address =
      typeof payload.address === "string" && payload.address.trim().length > 0
        ? payload.address.trim()
        : ""

    if (payload.force_refresh !== undefined && typeof payload.force_refresh !== "boolean") {
      return jsonResponse({ error: "force_refresh must be a boolean" }, 400)
    }

    if (
      payload.use_comparable_sales !== undefined &&
      typeof payload.use_comparable_sales !== "boolean"
    ) {
      return jsonResponse({ error: "use_comparable_sales must be a boolean" }, 400)
    }

    const forceRefresh = payload.force_refresh === true
    const useComparableSales = payload.use_comparable_sales !== false

    if (!deal_id || !address) {
      return jsonResponse({
        error: "Missing deal_id or address",
        received: payload
      }, 400)
    }

    if (!isUuid(deal_id)) {
      return jsonResponse({
        error: "deal_id must be a valid UUID",
        received: payload
      }, 400)
    }

    console.log("site-intelligence-agent request received", {
      deal_id,
      address,
      force_refresh: forceRefresh,
      use_comparable_sales: useComparableSales,
      report_trigger_score_threshold: reportTriggerThreshold
    })

    const supabase = createClient(supabaseUrl, serviceKey)

    const run: PipelineRun = {
      results: {},
      completed_stages: [],
      failed_stages: [],
      skipped_stages: [],
      warnings: []
    }

    const addWarning = (warning: WarningEntry) => {
      console.warn("site-intelligence-agent warning", { deal_id, ...warning })
      run.warnings.push(`${warning.agent}: ${warning.message}`)
    }

    let bootstrapReady = true
    try {
      await ensureDealAndSite(supabase, supabaseUrl, serviceKey, deal_id, address)
      run.results["bootstrap"] = {
        success: true,
        data: {
          deal_id,
          address
        }
      }
      run.completed_stages.push("bootstrap")
    } catch (error) {
      bootstrapReady = false
      const message = getErrorMessage(error)
      run.results["bootstrap"] = {
        success: false,
        error: message
      }
      run.failed_stages.push("bootstrap")
      addWarning({
        agent: "bootstrap",
        issue: "Failed to ensure deal and site",
        message
      })

      try {
        const [existingDeal, existingSite] = await Promise.all([
          dealExists(supabase, deal_id),
          getSiteRow(supabaseUrl, serviceKey, deal_id).catch(() => null)
        ])

        if (existingDeal || existingSite) {
          bootstrapReady = true
          run.results["bootstrap"] = {
            success: true,
            skipped: true,
            reason: "Continuing with existing persisted deal/site data after bootstrap failure",
            data: {
              existing_deal: existingDeal,
              existing_site: Boolean(existingSite)
            }
          }
          run.completed_stages.push("bootstrap")
          run.skipped_stages.push("bootstrap")
          run.failed_stages = run.failed_stages.filter((stage) => stage !== "bootstrap")
        }
      } catch (bootstrapFallbackError) {
        addWarning({
          agent: "bootstrap",
          issue: "Fallback check failed",
          message: getErrorMessage(bootstrapFallbackError)
        })
      }
    }

    if (bootstrapReady) {
      try {
        if (await shouldSkipPipeline(supabase, deal_id, forceRefresh)) {
          const skippedResults: Record<string, StageResult> = {
            ...run.results,
            pipeline: {
              success: true,
              skipped: true,
              reason: "Recent pipeline run detected; skipping duplicate execution"
            }
          }

          return jsonResponse({
            success: true,
            deal_id,
            address,
            skipped: true,
            reason: "Recent pipeline run detected; skipping duplicate execution",
            ranking_score: null,
            report_trigger_threshold: reportTriggerThreshold,
            report_triggered: false,
            report_trigger_reason: "Skipped duplicate pipeline run",
            warnings: run.warnings,
            results: skippedResults
          })
        }
      } catch (error) {
        addWarning({
          agent: "pipeline-deduplication",
          issue: "Failed to evaluate duplicate execution window",
          message: getErrorMessage(error)
        })
        run.results["pipeline-deduplication"] = {
          success: false,
          error: getErrorMessage(error)
        }
      }
    }

    const planningAgents = [
      "zoning-agent",
      "flood-agent",
      "height-agent",
      "fsr-agent",
      "heritage-agent"
    ]

    const planningResults = await Promise.all(
      planningAgents.map((agent) =>
        invokeAgent(supabaseUrl, serviceKey, requestAuthorizationHeader, agent, {
          deal_id,
          address
        })
          .then((result) => ({ agent, result }))
      )
    )

    for (const { agent, result } of planningResults) {
      let normalizedResult = result

      if (!result.success) {
        let cachedSite: SiteRow | null = null
        try {
          cachedSite = await getSiteRow(supabaseUrl, serviceKey, deal_id)
        } catch (error) {
          addWarning({
            agent,
            issue: "Failed to load cached planning data",
            message: getErrorMessage(error)
          })
        }
        const cachedValueByAgent: Record<string, unknown> = {
          "zoning-agent": cachedSite?.zoning,
          "flood-agent": cachedSite?.flood_risk,
          "height-agent": cachedSite?.height_limit,
          "fsr-agent": cachedSite?.fsr,
          "heritage-agent": cachedSite?.heritage_status
        }

        if (hasUsableCachedPlanningValue(cachedValueByAgent[agent])) {
          normalizedResult = {
            success: true,
            skipped: true,
            reason: "Using cached planning data after refresh attempt failed",
            data: result.data
          }

          addWarning({
            agent,
            issue: "Refresh failed; cached planning data reused",
            message: result.error || "unknown error"
          })
        }
      }

      run.results[agent] = normalizedResult
      if (normalizedResult.success) {
        run.completed_stages.push(agent)
        if (normalizedResult.skipped) {
          run.skipped_stages.push(agent)
        }
      } else {
        run.failed_stages.push(agent)
      }
    }

    const comparableResult = useComparableSales
      ? await invokeAgent(
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
      : {
          success: true,
          skipped: true,
          reason: "Skipped because use_comparable_sales was disabled"
        }

    let normalizedComparableResult = comparableResult

    if (useComparableSales && !comparableResult.success) {
      try {
        if (await hasComparableEstimate(supabase, deal_id)) {
          normalizedComparableResult = {
            success: true,
            skipped: true,
            reason: "Using existing comparable sales estimate after refresh attempt failed",
            data: comparableResult.data
          }

          addWarning({
            agent: "comparable-sales-agent",
            issue: "Refresh failed; cached comparable estimate reused",
            message: comparableResult.error || "unknown error"
          })
        }
      } catch (error) {
        addWarning({
          agent: "comparable-sales-agent",
          issue: "Failed to check cached comparable estimate",
          message: getErrorMessage(error)
        })
      }
    }

    run.results["comparable-sales-agent"] = normalizedComparableResult
    if (normalizedComparableResult.success) {
      run.completed_stages.push("comparable-sales-agent")
      if (normalizedComparableResult.skipped) {
        run.skipped_stages.push("comparable-sales-agent")
      }
    } else {
      run.failed_stages.push("comparable-sales-agent")
      addWarning({
        agent: "comparable-sales-agent",
        issue: "Comparable refresh failed without usable fallback",
        message: normalizedComparableResult.error || "unknown error"
      })
    }

    const yieldResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
      requestAuthorizationHeader,
      "yield-agent",
      {
        deal_id,
        use_comparable_sales: useComparableSales
      }
    )

    run.results["yield-agent"] = yieldResult
    if (yieldResult.success) {
      run.completed_stages.push("yield-agent")
    } else {
      run.failed_stages.push("yield-agent")
    }

    const financialResult = yieldResult.success
      ? await invokeAgent(
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
      : {
          success: false,
          skipped: true,
          reason: "Skipped because yield-agent did not complete successfully"
        }

    run.results["financial-engine-agent"] = financialResult
    if (financialResult.success) {
      run.completed_stages.push("financial-engine-agent")
    } else if (financialResult.skipped) {
      run.skipped_stages.push("financial-engine-agent")
    } else {
      run.failed_stages.push("financial-engine-agent")
    }

    try {
      await upsertSiteCandidate(supabase, supabaseUrl, serviceKey, deal_id, address)
    } catch (error) {
      addWarning({
        agent: "site-candidate-persistence",
        issue: "Failed to persist site candidate",
        message: getErrorMessage(error)
      })
      run.results["site-candidate-persistence"] = {
        success: false,
        error: getErrorMessage(error)
      }
    }

    const rankingResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
      requestAuthorizationHeader,
      "parcel-ranking-agent",
      {
        deal_id
      }
    )

    run.results["parcel-ranking-agent"] = rankingResult
    if (rankingResult.success) {
      run.completed_stages.push("parcel-ranking-agent")
    } else {
      run.failed_stages.push("parcel-ranking-agent")
    }

    const rankingData =
      rankingResult.success && rankingResult.data && typeof rankingResult.data === "object"
        ? rankingResult.data as RankingAgentResponse
        : null
    const rankingScore = typeof rankingData?.score === "number" ? rankingData.score : null
    const reportShouldRun =
      rankingResult.success && rankingScore !== null && rankingScore >= reportTriggerThreshold
    const reportTriggerReason = !rankingResult.success
      ? "Skipped because parcel-ranking-agent did not complete successfully"
      : rankingScore === null
        ? "Skipped because parcel-ranking-agent did not return a score"
        : rankingScore >= reportTriggerThreshold
          ? `Triggered because parcel score ${rankingScore} met threshold ${reportTriggerThreshold}`
          : `Skipped because parcel score ${rankingScore} was below threshold ${reportTriggerThreshold}`

    const reportResult = reportShouldRun
      ? await invokeAgent(
          supabaseUrl,
          serviceKey,
          requestAuthorizationHeader,
          "deal-report-agent",
          {
            deal_id,
            use_comparable_sales: useComparableSales
          }
        )
      : {
          success: true,
          skipped: true,
          reason: reportTriggerReason,
          data: {
            report_triggered: false,
            ranking_score: rankingScore,
            threshold: reportTriggerThreshold
          }
        }

    run.results["deal-report-agent"] = reportResult
    if (reportResult.success) {
      run.completed_stages.push("deal-report-agent")
      if (reportResult.skipped) {
        run.skipped_stages.push("deal-report-agent")
      }
    } else {
      run.failed_stages.push("deal-report-agent")
    }

    const criticalFailedStages = run.failed_stages.filter((stage) => CRITICAL_STAGES.has(stage))

    try {
      await logPipeline(supabase, deal_id, run, {
        ranking_score: rankingScore,
        report_trigger_threshold: reportTriggerThreshold,
        report_triggered: reportShouldRun,
        report_trigger_reason: reportTriggerReason
      })
    } catch (error) {
      addWarning({
        agent: "pipeline-log",
        issue: "Failed to persist pipeline log",
        message: getErrorMessage(error)
      })
      run.results["pipeline-log"] = {
        success: false,
        error: getErrorMessage(error)
      }
    }

    return jsonResponse({
      success: true,
      deal_id,
      address,
      pipeline_completed: criticalFailedStages.length === 0,
      ranking_score: rankingScore,
      report_trigger_threshold: reportTriggerThreshold,
      report_triggered: reportShouldRun,
      report_trigger_reason: reportTriggerReason,
      completed_stages: run.completed_stages,
      failed_stages: run.failed_stages,
      critical_failed_stages: criticalFailedStages,
      skipped_stages: run.skipped_stages,
      warnings: run.warnings,
      final_report:
        run.results["deal-report-agent"]?.success && !run.results["deal-report-agent"]?.skipped
          ? run.results["deal-report-agent"].data
          : null,
      results: run.results
    })
  } catch (error) {
    console.error("site-intelligence-agent failed", error)

    return jsonResponse({
      error: getErrorMessage(error)
    }, 500)
  }
})
