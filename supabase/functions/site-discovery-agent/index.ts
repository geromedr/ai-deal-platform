import { serve } from "https://deno.land/std/http/server.ts"

type Candidate = {
  source: string
  external_id: string
  address: string
  suburb?: string
  state?: string
  postcode?: string
  price_text?: string
  property_type?: string
  land_area?: number
  url?: string
  headline?: string
  raw_data?: Record<string, unknown>
}

serve(async (req) => {

  try {

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
    }

    let payload

    try {
      payload = await req.json()
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 })
    }

    const candidates = payload?.candidates

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return new Response(JSON.stringify({
        error: "Missing candidates[]",
        received: payload
      }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const results: Record<string, unknown>[] = []

    for (const candidate of candidates as Candidate[]) {

      try {

        const address = candidate.address

        if (!address) continue

        /*
        --------------------------------
        GEOCODE
        --------------------------------
        */

        const geo = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
          {
            headers: { "User-Agent": "ai-deal-platform/1.0" }
          }
        )

        const geoData = await geo.json()

        if (!Array.isArray(geoData) || geoData.length === 0) continue

        const lat = Number(geoData[0].lat)
        const lon = Number(geoData[0].lon)

        /*
        --------------------------------
        RUN FULL SITE INTELLIGENCE
        --------------------------------
        */

        const dealId = crypto.randomUUID()

        const intelligenceRes = await fetch(
          `${supabaseUrl}/functions/v1/site-intelligence-agent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`
            },
            body: JSON.stringify({
              deal_id: dealId,
              address
            })
          }
        )

        const intelligence = await intelligenceRes.json()

        const zoning =
          intelligence?.results?.["zoning-agent"]?.zoning ?? null

        const height =
          intelligence?.results?.["height-agent"]?.height_limit ?? null

        const fsr =
          intelligence?.results?.["fsr-agent"]?.fsr ?? null

        const units =
          intelligence?.results?.["yield-agent"]?.estimated_units ?? null

        const estimatedProfit =
          intelligence?.results?.["yield-agent"]?.estimated_profit ?? null

        const floodRisk =
          intelligence?.results?.["flood-agent"]?.flood_risk ?? null

        const heritageStatus =
          intelligence?.results?.["heritage-agent"]?.heritage_status ?? null

        /*
        --------------------------------
        DISCOVERY SCORING
        --------------------------------
        */

        let score = 0
        const reasons: string[] = []

        if (candidate.land_area && candidate.land_area >= 1000) {
          score += 2
          reasons.push("Land area 1000sqm+")
        }

        if (typeof zoning === "string" &&
            (zoning.startsWith("R3") || zoning.startsWith("R4") || zoning.startsWith("MU"))) {
          score += 3
          reasons.push(`Favourable zoning: ${zoning}`)
        }

        if (typeof units === "number" && units >= 12) {
          score += 3
          reasons.push(`Strong yield: ${units} units`)
        }

        if (candidate.property_type?.toLowerCase().includes("house")) {
          score += 1
          reasons.push("Possible underutilised dwelling")
        }

        /*
        --------------------------------
        SAVE TO DATABASE
        --------------------------------
        */

        await fetch(`${supabaseUrl}/rest/v1/site_candidates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceKey,
            "Authorization": `Bearer ${serviceKey}`,
            "Prefer": "resolution=merge-duplicates"
          },
          body: JSON.stringify({
            source: candidate.source,
            external_id: candidate.external_id,
            address: candidate.address,
            suburb: candidate.suburb,
            state: candidate.state,
            postcode: candidate.postcode,
            latitude: lat,
            longitude: lon,
            price_text: candidate.price_text,
            property_type: candidate.property_type,
            land_area: candidate.land_area,
            url: candidate.url,
            headline: candidate.headline,
            raw_data: candidate.raw_data || candidate,
            zoning,
            height_limit: height,
            fsr,
            flood_risk: floodRisk,
            heritage_status: heritageStatus,
            estimated_units: units,
            estimated_profit: estimatedProfit,
            discovery_score: score,
            discovery_reasons: reasons
          })
        })

        results.push({
          address,
          zoning,
          fsr,
          flood_risk: floodRisk,
          heritage_status: heritageStatus,
          estimated_units: units,
          estimated_profit: estimatedProfit,
          discovery_score: score,
          discovery_reasons: reasons
        })

      } catch (err) {

        results.push({
          address: candidate.address,
          error: "Candidate processing failed"
        })

      }

    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      results
    }), {
      headers: { "Content-Type": "application/json" }
    })

  } catch (error) {

    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })

  }

})
