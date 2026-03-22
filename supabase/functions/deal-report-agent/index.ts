import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type DealRow = {
  id: string
  address?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
  stage?: string | null
  status?: string | null
}

type SiteIntelligenceRow = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  estimated_units?: number | null
  estimated_revenue?: number | null
  estimated_build_cost?: number | null
  estimated_profit?: number | null
}

type FinancialSnapshotRow = {
  id: string
  category?: string | null
  amount?: number | null
  gdv?: number | null
  tdc?: number | null
  notes?: string | null
  created_at?: string | null
}

type SiteCandidateRow = {
  address?: string | null
  ranking_score?: number | null
  ranking_tier?: "A" | "B" | "C" | null
  ranking_reasons?: Array<{
    summary?: string | null
  }> | null
}

type ReportPayload = {
  address: string | null
  planning_controls: {
    zoning: string | null
    fsr: string | null
    height_limit: string | null
    flood_risk: string | null
    heritage_status: string | null
  }
  estimated_yield: {
    units: number | null
  }
  financials: {
    estimated_revenue: number | null
    estimated_build_cost: number | null
    projected_margin: number | null
  }
  ranking: {
    score: number | null
    tier: string | null
    reason: string | null
  }
  recommendation: string
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

function buildRecommendation(report: ReportPayload) {
  const score = report.ranking.score ?? 0
  const units = report.estimated_yield.units ?? 0
  const margin = report.financials.projected_margin ?? 0
  const zoning = (report.planning_controls.zoning || "").toUpperCase()
  const flood = (report.planning_controls.flood_risk || "").toLowerCase()

  if (score >= 75 && units >= 15 && margin > 0 && !flood.includes("high")) {
    return "Proceed to acquisition review"
  }

  if ((score >= 50 || zoning.startsWith("R3") || zoning.startsWith("R4")) && !flood.includes("high")) {
    return "Proceed with targeted due diligence"
  }

  return "Hold for further investigation"
}

function buildFallbackSummary(report: ReportPayload) {
  const parts = [
    report.address ? `Site: ${report.address}.` : "Site address unavailable.",
    report.planning_controls.zoning
      ? `Planning controls indicate zoning ${report.planning_controls.zoning}, FSR ${report.planning_controls.fsr || "unknown"}, and height ${report.planning_controls.height_limit || "unknown"}.`
      : "Planning controls are incomplete.",
    report.estimated_yield.units !== null
      ? `Estimated yield is ${report.estimated_yield.units} units.`
      : "Estimated yield is not yet available.",
    report.financials.projected_margin !== null
      ? `Projected margin is ${report.financials.projected_margin}.`
      : "Projected margin is not yet available.",
    report.ranking.score !== null
      ? `Current parcel ranking is ${report.ranking.score} (${report.ranking.tier || "unrated"}).`
      : "Parcel ranking is not yet available.",
    `Recommendation: ${report.recommendation}.`
  ]

  return parts.join(" ")
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    let payload: { deal_id?: string }

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const deal_id = typeof payload.deal_id === "string" ? payload.deal_id : ""

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400)
    }

    console.log("deal-report-agent request received", { deal_id })

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: dealData, error: dealError } = await supabase
      .from("deals")
      .select("id, address, suburb, state, postcode, stage, status")
      .eq("id", deal_id)
      .maybeSingle()

    if (dealError) throw dealError
    const deal = dealData as DealRow | null

    if (!deal) {
      return jsonResponse({ error: "Deal not found" }, 404)
    }

    const { data: siteData, error: siteError } = await supabase
      .from("site_intelligence")
      .select("deal_id, address, zoning, fsr, height_limit, flood_risk, heritage_status, estimated_units, estimated_revenue, estimated_build_cost, estimated_profit")
      .eq("deal_id", deal_id)
      .maybeSingle()

    if (siteError) throw siteError
    const site = siteData as SiteIntelligenceRow | null

    const { data: financialData, error: financialError } = await supabase
      .from("financial_snapshots")
      .select("id, category, amount, gdv, tdc, notes, created_at")
      .eq("deal_id", deal_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (financialError) throw financialError
    const latestFinancial = financialData as FinancialSnapshotRow | null

    const rankingRefreshResponse = await fetch(`${supabaseUrl}/functions/v1/parcel-ranking-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey
      },
      body: JSON.stringify({
        limit: 100,
        only_unranked: false
      })
    })

    if (!rankingRefreshResponse.ok) {
      const errorText = await rankingRefreshResponse.text()
      throw new Error(`parcel-ranking-agent failed: ${errorText}`)
    }

    const { data: siteCandidateData, error: candidateError } = await supabase
      .from("site_candidates")
      .select("address, ranking_score, ranking_tier, ranking_reasons")
      .eq("address", site?.address || deal.address || "")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (candidateError) throw candidateError
    const ranking = siteCandidateData as SiteCandidateRow | null

    const estimatedRevenue =
      site?.estimated_revenue ??
      latestFinancial?.gdv ??
      null

    const estimatedBuildCost =
      site?.estimated_build_cost ??
      latestFinancial?.tdc ??
      null

    const projectedMargin =
      site?.estimated_profit ??
      latestFinancial?.amount ??
      (
        estimatedRevenue !== null && estimatedBuildCost !== null
          ? estimatedRevenue - estimatedBuildCost
          : null
      )

    const report: ReportPayload = {
      address: site?.address || deal.address || null,
      planning_controls: {
        zoning: site?.zoning || null,
        fsr: site?.fsr || null,
        height_limit: site?.height_limit || null,
        flood_risk: site?.flood_risk || null,
        heritage_status: site?.heritage_status || null
      },
      estimated_yield: {
        units: site?.estimated_units ?? null
      },
      financials: {
        estimated_revenue: estimatedRevenue,
        estimated_build_cost: estimatedBuildCost,
        projected_margin: projectedMargin
      },
      ranking: {
        score: ranking?.ranking_score ?? null,
        tier: ranking?.ranking_tier ?? null,
        reason:
          ranking?.ranking_reasons?.[0]?.summary ||
          ranking?.ranking_reasons?.map((item) => item.summary).filter(Boolean).slice(0, 3).join("; ") ||
          null
      },
      recommendation: ""
    }

    report.recommendation = buildRecommendation(report)

    let humanReadableSummary: string | null = null
    let summarySource = "fallback"

    const aiResponse = await fetch(`${supabaseUrl}/functions/v1/ai-agent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
        "apikey": serviceKey
      },
      body: JSON.stringify({
        deal_id,
        prompt: `
Generate a concise investment-ready development opportunity summary.

Return ONLY valid JSON in this exact format:
{
  "human_readable_summary": "string",
  "recommendation": "string"
}

Deal report data:
${JSON.stringify(report, null, 2)}
`
      })
    })

    if (aiResponse.ok) {
      try {
        const aiData = await aiResponse.json()
        const responseText = aiData?.ai_result?.output?.[0]?.content?.[0]?.text

        if (typeof responseText === "string" && responseText.trim()) {
          const parsed = JSON.parse(cleanJsonBlock(responseText))

          if (typeof parsed.human_readable_summary === "string" && parsed.human_readable_summary.trim()) {
            humanReadableSummary = parsed.human_readable_summary.trim()
            summarySource = "ai-agent"
          }

          if (typeof parsed.recommendation === "string" && parsed.recommendation.trim()) {
            report.recommendation = parsed.recommendation.trim()
          }
        }
      } catch (error) {
        console.log("deal-report-agent ai summary parse failed", error)
      }
    }

    if (!humanReadableSummary) {
      humanReadableSummary = buildFallbackSummary(report)
    }

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "deal-report-agent",
      action: "investment_report_generated",
      payload: {
        summary_source: summarySource,
        report
      }
    })

    console.log("deal-report-agent processing complete", {
      deal_id,
      summary_source: summarySource,
      ranking_score: report.ranking.score
    })

    return jsonResponse({
      success: true,
      deal_id,
      report,
      human_readable_summary: humanReadableSummary,
      summary_source: summarySource
    })
  } catch (error) {
    console.error("deal-report-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
