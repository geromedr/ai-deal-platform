import { serve } from "https://deno.land/std/http/server.ts"

type RankingRequest = {
  deal_id?: string
  limit?: number
  only_unranked?: boolean
}

type CandidateRow = {
  id: string
  address: string
  property_type?: string | null
  land_area?: number | null
  zoning?: string | null
  height_limit?: string | null
  fsr?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  estimated_units?: number | null
  estimated_profit?: number | null
  discovery_score?: number | null
}

type DealRow = {
  id: string
  address?: string | null
}

type SiteIntelligenceRow = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  site_area?: number | null
  estimated_gfa?: number | null
  estimated_units?: number | null
  estimated_profit?: number | null
}

type FinancialSnapshotRow = {
  id: string
  amount?: number | null
  gdv?: number | null
  tdc?: number | null
  metadata?: Record<string, unknown> | null
}

type ComparableSalesEstimateRow = {
  id: string
  estimated_sale_price_per_sqm?: number | null
  rationale?: string | null
}

type RankingInput = {
  address: string
  zoning?: string | null
  fsr?: string | null
  height_limit?: string | null
  site_size?: number | null
  estimated_gfa?: number | null
  estimated_units?: number | null
  financial_margin?: number | null
  comparable_sale_price_per_sqm?: number | null
  comparable_rationale?: string | null
  flood_risk?: string | null
  heritage_status?: string | null
  property_type?: string | null
}

type ScoringComponentKey =
  | "zoning"
  | "fsr"
  | "height"
  | "site_size"
  | "yield"
  | "financial"
  | "comparables"

type DetailedFactor = {
  key: ScoringComponentKey
  label: string
  weight: number
  raw_score: number
  weighted_score: number
  summary: string
}

type RankingResult = {
  score: number
  tier: "A" | "B" | "C"
  breakdown: Record<ScoringComponentKey, number>
  reasoning: string
  factors: DetailedFactor[]
}

const WEIGHTS: Record<ScoringComponentKey, number> = {
  zoning: 20,
  fsr: 15,
  height: 10,
  site_size: 10,
  yield: 15,
  financial: 20,
  comparables: 10
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function parseNumberLoose(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const cleaned = String(value).replace(/[^0-9.\-]/g, "")
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function buildHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`
  }
}

function buildFactor(
  key: ScoringComponentKey,
  label: string,
  rawScore: number,
  summary: string
): DetailedFactor {
  const bounded = clamp(rawScore)
  const weight = WEIGHTS[key]
  const weighted = Number((bounded * weight).toFixed(2))

  return {
    key,
    label,
    weight,
    raw_score: Number(bounded.toFixed(4)),
    weighted_score: weighted,
    summary
  }
}

function scoreZoning(zoningRaw: string | null | undefined) {
  const zoning = (zoningRaw || "").trim().toUpperCase()

  if (!zoning) return { score: 0.25, summary: "Zoning unavailable" }
  if (zoning.startsWith("R4")) return { score: 1, summary: `High-density zoning ${zoning}` }
  if (zoning.startsWith("MU")) return { score: 0.95, summary: `Mixed-use zoning ${zoning}` }
  if (zoning.startsWith("R3")) return { score: 0.8, summary: `Medium-density zoning ${zoning}` }
  if (zoning.startsWith("B")) return { score: 0.6, summary: `Business zoning ${zoning}` }
  if (zoning.startsWith("R2")) return { score: 0.35, summary: `Lower-density zoning ${zoning}` }

  return { score: 0.2, summary: `Limited zoning flexibility ${zoning}` }
}

function scoreFsr(fsrRaw: string | null | undefined) {
  const fsr = parseNumberLoose(fsrRaw)

  if (fsr === null) return { score: 0.2, summary: "FSR unavailable" }
  if (fsr >= 3) return { score: 1, summary: `Excellent FSR potential ${fsr}:1` }
  if (fsr >= 2) return { score: 0.85, summary: `Strong FSR potential ${fsr}:1` }
  if (fsr >= 1.5) return { score: 0.65, summary: `Useful FSR potential ${fsr}:1` }
  if (fsr >= 1) return { score: 0.45, summary: `Moderate FSR potential ${fsr}:1` }

  return { score: 0.2, summary: `Constrained FSR potential ${fsr}:1` }
}

function scoreHeight(heightRaw: string | null | undefined) {
  const height = parseNumberLoose(heightRaw)

  if (height === null) return { score: 0.2, summary: "Height unavailable" }
  if (height >= 24) return { score: 1, summary: `Excellent height capacity ${height}m` }
  if (height >= 18) return { score: 0.8, summary: `Strong height capacity ${height}m` }
  if (height >= 12) return { score: 0.55, summary: `Moderate height capacity ${height}m` }
  if (height >= 9) return { score: 0.35, summary: `Limited height capacity ${height}m` }

  return { score: 0.15, summary: `Low height capacity ${height}m` }
}

function scoreSiteSize(siteSize: number | null | undefined) {
  if (siteSize === null || siteSize === undefined) {
    return { score: 0.2, summary: "Site size unavailable" }
  }

  if (siteSize >= 2500) return { score: 1, summary: `Large site ${siteSize}sqm` }
  if (siteSize >= 1500) return { score: 0.8, summary: `Strong site size ${siteSize}sqm` }
  if (siteSize >= 1000) return { score: 0.6, summary: `Usable site size ${siteSize}sqm` }
  if (siteSize >= 700) return { score: 0.4, summary: `Moderate site size ${siteSize}sqm` }

  return { score: 0.2, summary: `Small site ${siteSize}sqm` }
}

function scoreYield(gfa: number | null | undefined, units: number | null | undefined) {
  const yieldUnits = units ?? 0
  const yieldGfa = gfa ?? 0

  if ((units === null || units === undefined) && (gfa === null || gfa === undefined)) {
    return { score: 0.2, summary: "Yield unavailable" }
  }

  if (yieldUnits >= 50 || yieldGfa >= 4500) {
    return { score: 1, summary: `High yield potential ${yieldUnits} units / ${yieldGfa}sqm GFA` }
  }

  if (yieldUnits >= 30 || yieldGfa >= 2500) {
    return { score: 0.8, summary: `Strong yield potential ${yieldUnits} units / ${yieldGfa}sqm GFA` }
  }

  if (yieldUnits >= 15 || yieldGfa >= 1500) {
    return { score: 0.6, summary: `Good yield potential ${yieldUnits} units / ${yieldGfa}sqm GFA` }
  }

  if (yieldUnits >= 8 || yieldGfa >= 800) {
    return { score: 0.4, summary: `Moderate yield potential ${yieldUnits} units / ${yieldGfa}sqm GFA` }
  }

  return { score: 0.2, summary: `Limited yield potential ${yieldUnits} units / ${yieldGfa}sqm GFA` }
}

function scoreFinancial(margin: number | null | undefined) {
  if (margin === null || margin === undefined) {
    return { score: 0.25, summary: "Financial margin unavailable" }
  }

  if (margin >= 0.25) return { score: 1, summary: `Excellent financial margin ${(margin * 100).toFixed(1)}%` }
  if (margin >= 0.18) return { score: 0.8, summary: `Strong financial margin ${(margin * 100).toFixed(1)}%` }
  if (margin >= 0.1) return { score: 0.6, summary: `Acceptable financial margin ${(margin * 100).toFixed(1)}%` }
  if (margin > 0) return { score: 0.35, summary: `Thin financial margin ${(margin * 100).toFixed(1)}%` }

  return { score: 0.1, summary: `Negative financial margin ${(margin * 100).toFixed(1)}%` }
}

function scoreComparables(pricePerSqm: number | null | undefined, rationale: string | null | undefined) {
  if (pricePerSqm === null || pricePerSqm === undefined) {
    return { score: 0.25, summary: "Comparable sales unavailable" }
  }

  if (pricePerSqm >= 12000) return { score: 1, summary: `Very strong comparable pricing ${pricePerSqm}/sqm` }
  if (pricePerSqm >= 9000) return { score: 0.8, summary: `Strong comparable pricing ${pricePerSqm}/sqm` }
  if (pricePerSqm >= 6500) return { score: 0.6, summary: `Moderate comparable pricing ${pricePerSqm}/sqm` }
  if (pricePerSqm >= 5000) {
    return {
      score: 0.45,
      summary: rationale ? `Conservative comparable pricing ${pricePerSqm}/sqm` : `Comparable pricing ${pricePerSqm}/sqm`
    }
  }

  return { score: 0.25, summary: `Weak comparable pricing ${pricePerSqm}/sqm` }
}

function applyConstraintAdjustments(result: RankingResult, input: RankingInput) {
  const floodRisk = (input.flood_risk || "").toLowerCase()
  const heritageStatus = (input.heritage_status || "").toLowerCase()

  let score = result.score
  const notes: string[] = []

  if (floodRisk.includes("high")) {
    score -= 10
    notes.push("high flood risk reduces attractiveness")
  } else if (floodRisk.includes("medium")) {
    score -= 5
    notes.push("medium flood risk reduces attractiveness")
  }

  if (heritageStatus && !heritageStatus.includes("no")) {
    score -= 7
    notes.push("heritage controls reduce flexibility")
  }

  return {
    adjustedScore: Math.max(0, Math.min(100, Math.round(score))),
    notes
  }
}

function buildRanking(input: RankingInput): RankingResult {
  const zoning = scoreZoning(input.zoning)
  const fsr = scoreFsr(input.fsr)
  const height = scoreHeight(input.height_limit)
  const siteSize = scoreSiteSize(input.site_size)
  const yieldPotential = scoreYield(input.estimated_gfa, input.estimated_units)
  const financial = scoreFinancial(input.financial_margin)
  const comparables = scoreComparables(
    input.comparable_sale_price_per_sqm,
    input.comparable_rationale
  )

  const factors: DetailedFactor[] = [
    buildFactor("zoning", "Zoning Flexibility", zoning.score, zoning.summary),
    buildFactor("fsr", "FSR Potential", fsr.score, fsr.summary),
    buildFactor("height", "Height Potential", height.score, height.summary),
    buildFactor("site_size", "Site Size", siteSize.score, siteSize.summary),
    buildFactor("yield", "Yield Potential", yieldPotential.score, yieldPotential.summary),
    buildFactor("financial", "Financial Margin", financial.score, financial.summary),
    buildFactor("comparables", "Comparable Sales Strength", comparables.score, comparables.summary)
  ]

  const rawScore = factors.reduce((total, factor) => total + factor.weighted_score, 0)
  const baseScore = Math.round(rawScore)
  const adjustment = applyConstraintAdjustments(
    {
      score: baseScore,
      tier: "C",
      breakdown: {
        zoning: 0,
        fsr: 0,
        height: 0,
        site_size: 0,
        yield: 0,
        financial: 0,
        comparables: 0
      },
      reasoning: "",
      factors
    },
    input
  )

  const finalScore = adjustment.adjustedScore
  let tier: RankingResult["tier"] = "C"
  if (finalScore >= 75) tier = "A"
  else if (finalScore >= 50) tier = "B"

  const breakdown = {
    zoning: Math.round(factors.find((factor) => factor.key === "zoning")?.weighted_score ?? 0),
    fsr: Math.round(factors.find((factor) => factor.key === "fsr")?.weighted_score ?? 0),
    height: Math.round(factors.find((factor) => factor.key === "height")?.weighted_score ?? 0),
    site_size: Math.round(factors.find((factor) => factor.key === "site_size")?.weighted_score ?? 0),
    yield: Math.round(factors.find((factor) => factor.key === "yield")?.weighted_score ?? 0),
    financial: Math.round(factors.find((factor) => factor.key === "financial")?.weighted_score ?? 0),
    comparables: Math.round(factors.find((factor) => factor.key === "comparables")?.weighted_score ?? 0)
  }

  const strongest = [...factors]
    .sort((left, right) => right.weighted_score - left.weighted_score)
    .slice(0, 3)
    .map((factor) => factor.summary)

  const reasoning = [
    ...strongest,
    ...adjustment.notes
  ].join("; ")

  return {
    score: finalScore,
    tier,
    breakdown,
    reasoning,
    factors
  }
}

function mapCandidateToRankingInput(row: CandidateRow): RankingInput {
  return {
    address: row.address,
    zoning: row.zoning,
    fsr: row.fsr,
    height_limit: row.height_limit,
    site_size: row.land_area ?? null,
    estimated_units: row.estimated_units ?? null,
    estimated_gfa: null,
    financial_margin: null,
    comparable_sale_price_per_sqm: null,
    comparable_rationale: null,
    flood_risk: row.flood_risk,
    heritage_status: row.heritage_status,
    property_type: row.property_type
  }
}

async function getDealRankingInput(
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string
) {
  const dealResponse = await fetch(
    `${supabaseUrl}/rest/v1/deals?id=eq.${deal_id}&select=id,address&limit=1`,
    { headers: buildHeaders(serviceKey) }
  )

  if (!dealResponse.ok) {
    throw new Error(`Failed to load deal: ${await dealResponse.text()}`)
  }

  const dealRows = await dealResponse.json() as DealRow[]
  const deal = dealRows[0] ?? null
  if (!deal) {
    const notFoundError = new Error("Deal not found")
    ;(notFoundError as Error & { status?: number }).status = 404
    throw notFoundError
  }

  const siteResponse = await fetch(
    `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=deal_id,address,zoning,fsr,height_limit,flood_risk,heritage_status,site_area,estimated_gfa,estimated_units,estimated_profit&limit=1`,
    { headers: buildHeaders(serviceKey) }
  )

  if (!siteResponse.ok) {
    throw new Error(`Failed to load site intelligence: ${await siteResponse.text()}`)
  }

  const siteRows = await siteResponse.json() as SiteIntelligenceRow[]
  const site = siteRows[0] ?? null

  const financialResponse = await fetch(
    `${supabaseUrl}/rest/v1/financial_snapshots?deal_id=eq.${deal_id}&select=id,amount,gdv,tdc,metadata&order=created_at.desc&limit=1`,
    { headers: buildHeaders(serviceKey) }
  )

  if (!financialResponse.ok) {
    throw new Error(`Failed to load financial snapshot: ${await financialResponse.text()}`)
  }

  const financialRows = await financialResponse.json() as FinancialSnapshotRow[]
  const latestFinancial = financialRows[0] ?? null
  const feasibility = latestFinancial?.metadata?.feasibility as Record<string, unknown> | undefined

  const comparableResponse = await fetch(
    `${supabaseUrl}/rest/v1/comparable_sales_estimates?deal_id=eq.${deal_id}&status=eq.completed&select=id,estimated_sale_price_per_sqm,rationale&order=created_at.desc&limit=1`,
    { headers: buildHeaders(serviceKey) }
  )

  if (!comparableResponse.ok) {
    throw new Error(`Failed to load comparable sales estimate: ${await comparableResponse.text()}`)
  }

  const comparableRows = await comparableResponse.json() as ComparableSalesEstimateRow[]
  const comparable = comparableRows[0] ?? null

  const profit =
    parseNumberLoose(feasibility?.profit) ??
    latestFinancial?.amount ??
    site?.estimated_profit ??
    null
  const revenue =
    parseNumberLoose(feasibility?.revenue) ??
    latestFinancial?.gdv ??
    null
  const margin =
    parseNumberLoose(feasibility?.margin) ??
    (profit !== null && revenue !== null && revenue > 0 ? Number((profit / revenue).toFixed(4)) : null)

  return {
    deal,
    site,
    latestFinancial,
    comparable,
    input: {
      address: site?.address || deal.address || "Unknown address",
      zoning: site?.zoning,
      fsr: site?.fsr,
      height_limit: site?.height_limit,
      site_size: site?.site_area ?? null,
      estimated_gfa: site?.estimated_gfa ?? null,
      estimated_units: site?.estimated_units ?? null,
      financial_margin: margin,
      comparable_sale_price_per_sqm: comparable?.estimated_sale_price_per_sqm ?? null,
      comparable_rationale: comparable?.rationale ?? null,
      flood_risk: site?.flood_risk,
      heritage_status: site?.heritage_status,
      property_type: "development-site"
    } satisfies RankingInput
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    let payload: RankingRequest = {}

    try {
      payload = await req.json()
    } catch {
      payload = {}
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    const rawDealId = typeof payload.deal_id === "string" ? payload.deal_id.trim() : ""
    const deal_id = rawDealId

    if (
      payload.limit !== undefined &&
      !(typeof payload.limit === "number" && Number.isFinite(payload.limit) && payload.limit > 0)
    ) {
      return jsonResponse({ error: "limit must be a positive number" }, 400)
    }

    if (payload.only_unranked !== undefined && typeof payload.only_unranked !== "boolean") {
      return jsonResponse({ error: "only_unranked must be a boolean" }, 400)
    }

    if (payload.deal_id !== undefined && typeof payload.deal_id !== "string") {
      return jsonResponse({ error: "deal_id must be a string" }, 400)
    }

    if (payload.deal_id !== undefined && !deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400)
    }

    if (deal_id && !isUuid(deal_id)) {
      return jsonResponse({ error: "deal_id must be a valid UUID" }, 400)
    }

    if (deal_id) {
      console.log("parcel-ranking-agent deal mode request received", { deal_id })

      const { site, input } = await getDealRankingInput(supabaseUrl, serviceKey, deal_id)
      const ranking = buildRanking(input)

      const { score, tier, breakdown, reasoning, factors } = ranking

      const upsertCandidateResponse = await fetch(
        `${supabaseUrl}/rest/v1/site_candidates?on_conflict=source,external_id`,
        {
          method: "POST",
          headers: {
            ...buildHeaders(serviceKey),
            "Prefer": "resolution=merge-duplicates,return=minimal"
          },
          body: JSON.stringify({
            source: "site-intelligence-agent",
            external_id: deal_id,
            address: input.address,
            property_type: "development-site",
            land_area: input.site_size,
            zoning: input.zoning,
            height_limit: input.height_limit,
            fsr: input.fsr,
            flood_risk: input.flood_risk,
            heritage_status: input.heritage_status,
            estimated_units: input.estimated_units,
            estimated_profit: site?.estimated_profit ?? null,
            ranking_score: score,
            ranking_tier: tier,
            ranking_reasons: factors.map((factor) => ({
              key: factor.key,
              label: factor.label,
              weight: factor.weight,
              raw_score: factor.raw_score,
              weighted_score: factor.weighted_score,
              summary: factor.summary
            })),
            ranking_run_at: new Date().toISOString()
          })
        }
      )

      if (!upsertCandidateResponse.ok && upsertCandidateResponse.status !== 204) {
        console.log("parcel-ranking-agent deal mode candidate update skipped", {
          deal_id,
          status: upsertCandidateResponse.status
        })
      }

      const actionResponse = await fetch(`${supabaseUrl}/rest/v1/ai_actions`, {
        method: "POST",
        headers: buildHeaders(serviceKey),
        body: JSON.stringify({
          deal_id,
          agent: "parcel-ranking-agent",
          action: "deal_ranked",
          payload: {
            score,
            tier,
            breakdown,
            reasoning
          }
        })
      })

      if (!actionResponse.ok) {
        throw new Error(`Failed to log ranking result: ${await actionResponse.text()}`)
      }

      return jsonResponse({
        success: true,
        deal_id,
        address: input.address,
        score,
        tier,
        breakdown,
        reasoning,
        reason: reasoning,
        ranking_score: score,
        ranking_tier: tier,
        inputs: {
          zoning: input.zoning ?? null,
          fsr: input.fsr ?? null,
          height_limit: input.height_limit ?? null,
          site_size: input.site_size ?? null,
          estimated_gfa: input.estimated_gfa ?? null,
          estimated_units: input.estimated_units ?? null,
          financial_margin: input.financial_margin ?? null,
          comparable_sale_price_per_sqm: input.comparable_sale_price_per_sqm ?? null
        }
      })
    }

    const limit = typeof payload.limit === "number" ? payload.limit : 100
    const onlyUnranked = payload.only_unranked === true

    console.log("parcel-ranking-agent batch mode request received", {
      limit,
      only_unranked: onlyUnranked
    })

    let query = `${supabaseUrl}/rest/v1/site_candidates?select=*`

    if (onlyUnranked) {
      query += `&ranking_score=is.null`
    }

    query += `&limit=${limit}`

    const res = await fetch(query, {
      headers: buildHeaders(serviceKey)
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch site candidates: ${await res.text()}`)
    }

    const rows: CandidateRow[] = await res.json()
    const ranked: Array<Record<string, unknown>> = []

    for (const row of rows) {
      const ranking = buildRanking(mapCandidateToRankingInput(row))

      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/site_candidates?id=eq.${row.id}`,
        {
          method: "PATCH",
          headers: buildHeaders(serviceKey),
          body: JSON.stringify({
            ranking_score: ranking.score,
            ranking_tier: ranking.tier,
            ranking_reasons: ranking.factors.map((factor) => ({
              key: factor.key,
              label: factor.label,
              weight: factor.weight,
              raw_score: factor.raw_score,
              weighted_score: factor.weighted_score,
              summary: factor.summary
            })),
            ranking_run_at: new Date().toISOString()
          })
        }
      )

      if (!updateRes.ok) {
        throw new Error(`Failed to update ranked candidate ${row.id}: ${await updateRes.text()}`)
      }

      ranked.push({
        address: row.address,
        score: ranking.score,
        tier: ranking.tier,
        breakdown: ranking.breakdown,
        reasoning: ranking.reasoning,
        reason: ranking.reasoning,
        ranking_score: ranking.score,
        ranking_tier: ranking.tier
      })
    }

    ranked.sort((left, right) => Number(right.score) - Number(left.score))

    console.log("parcel-ranking-agent batch mode processing complete", {
      processed: ranked.length
    })

    return jsonResponse({
      success: true,
      processed: ranked.length,
      top_sites: ranked.slice(0, 20)
    })
  } catch (error) {
    console.error("parcel-ranking-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 500)
  }
})
