import { serve } from "https://deno.land/std/http/server.ts"

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

type RankingFactor = {
  key:
    | "zoning_flexibility"
    | "fsr_potential"
    | "height_potential"
    | "site_size"
    | "estimated_yield"
    | "financial_margin"
    | "constraint_adjustment"
  label: string
  weight: number
  value: number
  contribution: number
  summary: string
}

type RankingResult = {
  score: number
  tier: "A" | "B" | "C"
  reason: string
  factors: RankingFactor[]
}

const FACTOR_WEIGHTS = {
  zoning_flexibility: 22,
  fsr_potential: 18,
  height_potential: 14,
  site_size: 14,
  estimated_yield: 18,
  financial_margin: 14,
  constraint_adjustment: 10
} as const

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

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function buildFactor(
  key: RankingFactor["key"],
  label: string,
  weight: number,
  value: number,
  summary: string
): RankingFactor {
  const boundedValue = clamp(value)

  return {
    key,
    label,
    weight,
    value: boundedValue,
    contribution: Number((boundedValue * weight).toFixed(2)),
    summary
  }
}

function scoreZoning(zoningRaw: string | null | undefined) {
  const zoning = (zoningRaw || "").trim().toUpperCase()

  if (!zoning) return { value: 0.2, summary: "No zoning evidence available" }
  if (zoning.startsWith("R4")) return { value: 1, summary: `High-density zoning ${zoning}` }
  if (zoning.startsWith("MU")) return { value: 0.95, summary: `Mixed-use zoning ${zoning}` }
  if (zoning.startsWith("R3")) return { value: 0.8, summary: `Medium-density zoning ${zoning}` }
  if (zoning.startsWith("B")) return { value: 0.65, summary: `Business zoning ${zoning}` }
  if (zoning.startsWith("R2")) return { value: 0.35, summary: `Lower-density zoning ${zoning}` }

  return { value: 0.25, summary: `Limited zoning flexibility ${zoning}` }
}

function scoreFsr(fsrRaw: string | null | undefined) {
  const fsr = parseNumberLoose(fsrRaw)

  if (fsr === null) return { value: 0.2, summary: "FSR not yet defined" }
  if (fsr >= 3) return { value: 1, summary: `Excellent FSR potential ${fsr}:1` }
  if (fsr >= 2) return { value: 0.85, summary: `Strong FSR potential ${fsr}:1` }
  if (fsr >= 1.5) return { value: 0.65, summary: `Useful FSR potential ${fsr}:1` }
  if (fsr >= 1) return { value: 0.45, summary: `Moderate FSR potential ${fsr}:1` }

  return { value: 0.2, summary: `Constrained FSR potential ${fsr}:1` }
}

function scoreHeight(heightRaw: string | null | undefined) {
  const height = parseNumberLoose(heightRaw)

  if (height === null) return { value: 0.2, summary: "Height controls not yet defined" }
  if (height >= 24) return { value: 1, summary: `Excellent height capacity ${height}m` }
  if (height >= 18) return { value: 0.8, summary: `Strong height capacity ${height}m` }
  if (height >= 12) return { value: 0.55, summary: `Moderate height capacity ${height}m` }
  if (height >= 9) return { value: 0.35, summary: `Limited height capacity ${height}m` }

  return { value: 0.15, summary: `Low height capacity ${height}m` }
}

function scoreSiteSize(landArea: number | null | undefined) {
  if (landArea === null || landArea === undefined) {
    return { value: 0.2, summary: "Site area unavailable" }
  }

  if (landArea >= 2500) return { value: 1, summary: `Large site ${landArea}sqm` }
  if (landArea >= 1500) return { value: 0.8, summary: `Strong site size ${landArea}sqm` }
  if (landArea >= 1000) return { value: 0.6, summary: `Usable site size ${landArea}sqm` }
  if (landArea >= 700) return { value: 0.4, summary: `Moderate site size ${landArea}sqm` }

  return { value: 0.2, summary: `Small site ${landArea}sqm` }
}

function scoreYield(estimatedUnits: number | null | undefined) {
  if (estimatedUnits === null || estimatedUnits === undefined) {
    return { value: 0.2, summary: "Estimated yield unavailable" }
  }

  if (estimatedUnits >= 50) return { value: 1, summary: `High yield ${estimatedUnits} units` }
  if (estimatedUnits >= 30) return { value: 0.8, summary: `Strong yield ${estimatedUnits} units` }
  if (estimatedUnits >= 15) return { value: 0.6, summary: `Good yield ${estimatedUnits} units` }
  if (estimatedUnits >= 8) return { value: 0.4, summary: `Moderate yield ${estimatedUnits} units` }

  return { value: 0.2, summary: `Limited yield ${estimatedUnits} units` }
}

function scoreFinancialMargin(estimatedProfit: number | null | undefined) {
  if (estimatedProfit === null || estimatedProfit === undefined) {
    return { value: 0.25, summary: "Financial margin unavailable" }
  }

  if (estimatedProfit >= 20000000) return { value: 1, summary: "Exceptional projected margin" }
  if (estimatedProfit >= 10000000) return { value: 0.8, summary: "Strong projected margin" }
  if (estimatedProfit >= 5000000) return { value: 0.6, summary: "Positive projected margin" }
  if (estimatedProfit > 0) return { value: 0.35, summary: "Modest projected margin" }

  return { value: 0.1, summary: "Weak or negative projected margin" }
}

function scoreConstraints(
  floodRiskRaw: string | null | undefined,
  heritageStatusRaw: string | null | undefined,
  propertyTypeRaw: string | null | undefined
) {
  const floodRisk = (floodRiskRaw || "").toLowerCase()
  const heritageStatus = (heritageStatusRaw || "").toLowerCase()
  const propertyType = (propertyTypeRaw || "").toLowerCase()

  let value = 0.7
  const notes: string[] = []

  if (floodRisk.includes("high")) {
    value -= 0.45
    notes.push("high flood constraint")
  } else if (floodRisk.includes("medium")) {
    value -= 0.25
    notes.push("medium flood constraint")
  } else if (floodRisk.includes("low") || floodRisk.includes("not mapped")) {
    notes.push("manageable flood profile")
  }

  if (heritageStatus && !heritageStatus.includes("no")) {
    value -= 0.3
    notes.push("heritage constraint present")
  } else {
    notes.push("no heritage constraint")
  }

  if (propertyType.includes("house")) {
    value += 0.1
    notes.push("existing house suggests redevelopment upside")
  }

  return {
    value: clamp(value),
    summary: notes.join(", ")
  }
}

function buildRanking(row: CandidateRow): RankingResult {
  const zoningFactor = scoreZoning(row.zoning)
  const fsrFactor = scoreFsr(row.fsr)
  const heightFactor = scoreHeight(row.height_limit)
  const siteSizeFactor = scoreSiteSize(row.land_area)
  const yieldFactor = scoreYield(row.estimated_units)
  const marginFactor = scoreFinancialMargin(row.estimated_profit)
  const constraintFactor = scoreConstraints(
    row.flood_risk,
    row.heritage_status,
    row.property_type
  )

  const factors: RankingFactor[] = [
    buildFactor(
      "zoning_flexibility",
      "Zoning Flexibility",
      FACTOR_WEIGHTS.zoning_flexibility,
      zoningFactor.value,
      zoningFactor.summary
    ),
    buildFactor(
      "fsr_potential",
      "FSR Potential",
      FACTOR_WEIGHTS.fsr_potential,
      fsrFactor.value,
      fsrFactor.summary
    ),
    buildFactor(
      "height_potential",
      "Height Potential",
      FACTOR_WEIGHTS.height_potential,
      heightFactor.value,
      heightFactor.summary
    ),
    buildFactor(
      "site_size",
      "Site Size",
      FACTOR_WEIGHTS.site_size,
      siteSizeFactor.value,
      siteSizeFactor.summary
    ),
    buildFactor(
      "estimated_yield",
      "Estimated Yield",
      FACTOR_WEIGHTS.estimated_yield,
      yieldFactor.value,
      yieldFactor.summary
    ),
    buildFactor(
      "financial_margin",
      "Financial Margin",
      FACTOR_WEIGHTS.financial_margin,
      marginFactor.value,
      marginFactor.summary
    ),
    buildFactor(
      "constraint_adjustment",
      "Constraint Adjustment",
      FACTOR_WEIGHTS.constraint_adjustment,
      constraintFactor.value,
      constraintFactor.summary
    )
  ]

  const rawScore = factors.reduce((total, factor) => total + factor.contribution, 0)
  const score = Math.round(rawScore)

  let tier: RankingResult["tier"] = "C"
  if (score >= 75) tier = "A"
  else if (score >= 50) tier = "B"

  const strongestFactors = [...factors]
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 3)
    .map((factor) => factor.summary)

  return {
    score,
    tier,
    reason: strongestFactors.join("; "),
    factors
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    let payload: Record<string, unknown> = {}

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

    if (
      payload.limit !== undefined &&
      !(typeof payload.limit === "number" && Number.isFinite(payload.limit) && payload.limit > 0)
    ) {
      return jsonResponse({ error: "limit must be a positive number" }, 400)
    }

    if (payload.only_unranked !== undefined && typeof payload.only_unranked !== "boolean") {
      return jsonResponse({ error: "only_unranked must be a boolean" }, 400)
    }

    const limit = typeof payload.limit === "number" ? payload.limit : 100
    const onlyUnranked = payload.only_unranked === true

    console.log("parcel-ranking-agent v2 request received", {
      limit,
      only_unranked: onlyUnranked
    })

    let query = `${supabaseUrl}/rest/v1/site_candidates?select=*`

    if (onlyUnranked) {
      query += `&ranking_score=is.null`
    }

    query += `&limit=${limit}`

    const res = await fetch(query, {
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`
      }
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Failed to fetch site candidates: ${errorText}`)
    }

    const rows: CandidateRow[] = await res.json()
    const ranked: Array<Record<string, unknown>> = []

    for (const row of rows) {
      const ranking = buildRanking(row)

      const updateRes = await fetch(
        `${supabaseUrl}/rest/v1/site_candidates?id=eq.${row.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`
          },
          body: JSON.stringify({
            ranking_score: ranking.score,
            ranking_tier: ranking.tier,
            ranking_reasons: ranking.factors.map((factor) => ({
              key: factor.key,
              label: factor.label,
              weight: factor.weight,
              value: factor.value,
              contribution: factor.contribution,
              summary: factor.summary
            })),
            ranking_run_at: new Date().toISOString()
          })
        }
      )

      if (!updateRes.ok) {
        const errorText = await updateRes.text()
        throw new Error(`Failed to update ranked candidate ${row.id}: ${errorText}`)
      }

      ranked.push({
        address: row.address,
        score: ranking.score,
        tier: ranking.tier,
        reason: ranking.reason,
        ranking_score: ranking.score,
        ranking_tier: ranking.tier
      })
    }

    ranked.sort((left, right) => Number(right.score) - Number(left.score))

    console.log("parcel-ranking-agent v2 processing complete", {
      processed: ranked.length
    })

    return jsonResponse({
      success: true,
      processed: ranked.length,
      top_sites: ranked.slice(0, 20)
    })
  } catch (error) {
    console.error("parcel-ranking-agent v2 failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
