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

function parseNumberLoose(value: unknown): number | null {
  if (!value) return null
  const cleaned = String(value).replace(/[^0-9.\-]/g, "")
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : null
}

function scoreCandidate(row: CandidateRow) {

  let score = 0
  const reasons: string[] = []

  const zoning = (row.zoning || "").toUpperCase()
  const flood = (row.flood_risk || "").toLowerCase()
  const heritage = (row.heritage_status || "").toLowerCase()
  const propertyType = (row.property_type || "").toLowerCase()

  const landArea = row.land_area ?? null
  const fsr = parseNumberLoose(row.fsr)
  const height = parseNumberLoose(row.height_limit)
  const units = row.estimated_units ?? null
  const profit = row.estimated_profit ?? null

  /*
  LAND AREA
  */

  if (landArea !== null) {

    if (landArea >= 2000) {
      score += 4
      reasons.push("Very large site")
    }

    else if (landArea >= 1200) {
      score += 3
      reasons.push("Large development site")
    }

    else if (landArea >= 800) {
      score += 2
      reasons.push("Decent development block")
    }

  }

  /*
  ZONING
  */

  if (zoning.startsWith("R4")) {
    score += 5
    reasons.push("High density zoning")
  }

  else if (zoning.startsWith("R3")) {
    score += 4
    reasons.push("Medium density zoning")
  }

  else if (zoning.startsWith("MU")) {
    score += 5
    reasons.push("Mixed use zoning")
  }

  /*
  FSR
  */

  if (fsr !== null) {

    if (fsr >= 2.5) {
      score += 5
      reasons.push(`Excellent FSR ${fsr}`)
    }

    else if (fsr >= 1.5) {
      score += 3
      reasons.push(`Strong FSR ${fsr}`)
    }

    else if (fsr >= 1.0) {
      score += 1
      reasons.push(`Usable FSR ${fsr}`)
    }

  }

  /*
  HEIGHT
  */

  if (height !== null) {

    if (height >= 18) {
      score += 4
      reasons.push(`Good height limit ${height}m`)
    }

    else if (height >= 12) {
      score += 2
      reasons.push(`Moderate height limit ${height}m`)
    }

  }

  /*
  YIELD
  */

  if (units !== null) {

    if (units >= 30) {
      score += 5
      reasons.push(`Excellent yield ${units} units`)
    }

    else if (units >= 15) {
      score += 3
      reasons.push(`Good yield ${units} units`)
    }

    else if (units >= 8) {
      score += 1
      reasons.push(`Moderate yield ${units} units`)
    }

  }

  /*
  PROFIT
  */

  if (profit !== null) {

    if (profit >= 15000000) {
      score += 5
      reasons.push("Very strong profit")
    }

    else if (profit >= 7000000) {
      score += 3
      reasons.push("Strong profit")
    }

    else if (profit >= 3000000) {
      score += 1
      reasons.push("Positive profit")
    }

  }

  /*
  EXISTING HOUSE
  */

  if (propertyType.includes("house")) {
    score += 1
    reasons.push("Underutilised house site")
  }

  /*
  FLOOD
  */

  if (flood.includes("high")) {
    score -= 4
    reasons.push("High flood constraint")
  }

  else if (flood.includes("medium")) {
    score -= 2
    reasons.push("Flood risk")
  }

  else if (flood.includes("none") || flood.includes("low")) {
    score += 1
    reasons.push("No major flood constraint")
  }

  /*
  HERITAGE
  */

  if (!heritage || heritage.includes("no")) {
    score += 1
    reasons.push("No heritage constraint")
  }

  else {
    score -= 3
    reasons.push("Heritage constraint")
  }

  /*
  TIER
  */

  let tier = "C"

  if (score >= 18) tier = "A"
  else if (score >= 10) tier = "B"

  return { score, tier, reasons }

}

serve(async (req) => {

  try {

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
    }

    let payload: any = {}

    try {
      payload = await req.json()
    } catch {}

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const limit = payload.limit ?? 100
    const onlyUnranked = payload.only_unranked ?? false

    let query =
      `${supabaseUrl}/rest/v1/site_candidates` +
      `?select=*`

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

    const rows: CandidateRow[] = await res.json()

    const ranked = []

    for (const row of rows) {

      const { score, tier, reasons } = scoreCandidate(row)

      await fetch(
        `${supabaseUrl}/rest/v1/site_candidates?id=eq.${row.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`
          },
          body: JSON.stringify({
            ranking_score: score,
            ranking_tier: tier,
            ranking_reasons: reasons,
            ranking_run_at: new Date().toISOString()
          })
        }
      )

      ranked.push({
        address: row.address,
        ranking_score: score,
        ranking_tier: tier
      })

    }

    ranked.sort((a, b) => b.ranking_score - a.ranking_score)

    return new Response(JSON.stringify({
      success: true,
      processed: ranked.length,
      top_sites: ranked.slice(0, 20)
    }), {
      headers: { "Content-Type": "application/json" }
    })

  }

  catch (error) {

    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })

  }

})