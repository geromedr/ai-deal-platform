import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type SiteIntelligenceRequest = {
  deal_id?: string
  address?: string
  force_refresh?: boolean
  use_comparable_sales?: boolean
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

type PipelineRun = {
  results: Record<string, StageResult>
  completed_stages: string[]
  failed_stages: string[]
  skipped_stages: string[]
  warnings: string[]
}

const PIPELINE_ACTION = "site_pipeline_completed"
const PIPELINE_COOLDOWN_MS = 5 * 60 * 1000
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

function buildFunctionHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey
  }
}

async function ensureDealAndSite(
  supabase: ReturnType<typeof createClient>,
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

  if (dealError) throw dealError

  const { data: existingSite, error: existingSiteError } = await supabase
    .from("site_intelligence")
    .select("deal_id")
    .eq("deal_id", deal_id)
    .maybeSingle()

  if (existingSiteError) throw existingSiteError

  if (existingSite?.deal_id) {
    const { error: updateError } = await supabase
      .from("site_intelligence")
      .update({ address })
      .eq("deal_id", deal_id)

    if (updateError) throw updateError
    return
  }

  const { error: insertError } = await supabase
    .from("site_intelligence")
    .insert({
      deal_id,
      address
    })

  if (insertError) throw insertError
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
  agent: string,
  payload: Record<string, unknown>
): Promise<StageResult> {
  try {
    console.log("site-intelligence-agent stage starting", { agent, payload })

    const response = await fetch(`${supabaseUrl}/functions/v1/${agent}`, {
      method: "POST",
      headers: buildFunctionHeaders(serviceKey),
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
    const errorMessage = error instanceof Error ? error.message : "Unknown error"

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
  supabase: ReturnType<typeof createClient>,
  deal_id: string
) {
  const { data, error } = await supabase
    .from("site_intelligence")
    .select(
      "deal_id, address, zoning, fsr, height_limit, flood_risk, heritage_status, site_area, estimated_units, estimated_profit"
    )
    .eq("deal_id", deal_id)
    .maybeSingle()

  if (error) throw error
  return data as SiteRow | null
}

async function upsertSiteCandidate(
  supabase: ReturnType<typeof createClient>,
  deal_id: string,
  address: string
) {
  const site = await getSiteRow(supabase, deal_id)

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

  if (error) throw error
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
  run: PipelineRun
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
        results: run.results
      }
    })

  if (error) throw error
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

    console.log("site-intelligence-agent request received", {
      deal_id,
      address,
      force_refresh: forceRefresh,
      use_comparable_sales: useComparableSales
    })

    const supabase = createClient(supabaseUrl, serviceKey)

    await ensureDealAndSite(supabase, deal_id, address)

    if (await shouldSkipPipeline(supabase, deal_id, forceRefresh)) {
      const skippedResults: Record<string, StageResult> = {
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
        results: skippedResults
      })
    }

    const run: PipelineRun = {
      results: {},
      completed_stages: [],
      failed_stages: [],
      skipped_stages: [],
      warnings: []
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
        invokeAgent(supabaseUrl, serviceKey, agent, { deal_id, address })
          .then((result) => ({ agent, result }))
      )
    )

    for (const { agent, result } of planningResults) {
      let normalizedResult = result

      if (!result.success) {
        const cachedSite = await getSiteRow(supabase, deal_id)
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

          run.warnings.push(
            `${agent} refresh failed; cached planning data reused: ${result.error || "unknown error"}`
          )
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

    const comparableResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
      "comparable-sales-agent",
      {
        deal_id,
        radius_km: 5,
        dwelling_type: "apartment"
      }
    )

    let normalizedComparableResult = comparableResult

    if (!comparableResult.success && await hasComparableEstimate(supabase, deal_id)) {
      normalizedComparableResult = {
        success: true,
        skipped: true,
        reason: "Using existing comparable sales estimate after refresh attempt failed",
        data: comparableResult.data
      }

      run.warnings.push(
        `comparable-sales-agent refresh failed; existing comparable estimate reused: ${comparableResult.error || "unknown error"}`
      )
    }

    run.results["comparable-sales-agent"] = normalizedComparableResult
    if (normalizedComparableResult.success) {
      run.completed_stages.push("comparable-sales-agent")
      if (normalizedComparableResult.skipped) {
        run.skipped_stages.push("comparable-sales-agent")
      }
    } else {
      run.failed_stages.push("comparable-sales-agent")
      run.warnings.push(
        `comparable-sales-agent failed and no cached estimate was available: ${normalizedComparableResult.error || "unknown error"}`
      )
    }

    const yieldResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
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

    await upsertSiteCandidate(supabase, deal_id, address)

    const rankingResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
      "parcel-ranking-agent",
      {
        limit: 200,
        only_unranked: false
      }
    )

    run.results["parcel-ranking-agent"] = rankingResult
    if (rankingResult.success) {
      run.completed_stages.push("parcel-ranking-agent")
    } else {
      run.failed_stages.push("parcel-ranking-agent")
    }

    const reportResult = await invokeAgent(
      supabaseUrl,
      serviceKey,
      "deal-report-agent",
      {
        deal_id
      }
    )

    run.results["deal-report-agent"] = reportResult
    if (reportResult.success) {
      run.completed_stages.push("deal-report-agent")
    } else {
      run.failed_stages.push("deal-report-agent")
    }

    const criticalFailedStages = run.failed_stages.filter((stage) => CRITICAL_STAGES.has(stage))

    await logPipeline(supabase, deal_id, run)

    return jsonResponse({
      success: true,
      deal_id,
      address,
      pipeline_completed: criticalFailedStages.length === 0,
      completed_stages: run.completed_stages,
      failed_stages: run.failed_stages,
      critical_failed_stages: criticalFailedStages,
      skipped_stages: run.skipped_stages,
      warnings: run.warnings,
      final_report:
        run.results["deal-report-agent"]?.success
          ? run.results["deal-report-agent"].data
          : null,
      results: run.results
    })
  } catch (error) {
    console.error("site-intelligence-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
