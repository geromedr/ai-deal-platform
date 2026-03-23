import { serve } from "https://deno.land/std/http/server.ts"
import { triggerEvent } from "../_shared/event-dispatch-v2.ts"

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error"
}

serve(async (req) => {

  try {

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405)
    }

    let payload

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const candidates = payload?.candidates

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return jsonResponse({
        error: "Missing candidates[]",
        received: payload
      }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    const results: Record<string, unknown>[] = []

    for (const candidate of candidates as Candidate[]) {

      try {

        const address = typeof candidate.address === "string" ? candidate.address.trim() : ""

        if (!address) {
          throw new Error("Candidate address is required")
        }

        /*
        --------------------------------
        GEOCODE
        --------------------------------
        */

        let lat: number | null = null
        let lon: number | null = null
        const warnings: string[] = []

        try {
          const geo = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
            {
              headers: { "User-Agent": "ai-deal-platform/1.0" }
            }
          )

          const geoData = await geo.json()

          if (Array.isArray(geoData) && geoData.length > 0) {
            lat = Number(geoData[0].lat)
            lon = Number(geoData[0].lon)
          } else {
            warnings.push("Geocoding returned no result")
          }
        } catch (geocodeError) {
          warnings.push(`Geocoding failed: ${getErrorMessage(geocodeError)}`)
        }

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
              "Authorization": `Bearer ${serviceKey}`,
              "apikey": serviceKey
            },
            body: JSON.stringify({
              deal_id: dealId,
              address
            })
          }
        )

        const intelligenceText = await intelligenceRes.text()
        let intelligence: Record<string, unknown> | null = null

        try {
          intelligence = JSON.parse(intelligenceText)
        } catch {
          intelligence = null
        }

        if (!intelligenceRes.ok) {
          throw new Error(
            intelligence && typeof intelligence.error === "string"
              ? intelligence.error
              : `site-intelligence-agent failed: ${intelligenceText}`
          )
        }

        const zoning =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["zoning-agent"]?.data?.zoning ?? null

        const height =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["height-agent"]?.data?.height_limit ?? null

        const fsr =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["fsr-agent"]?.data?.fsr ?? null

        const units =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["yield-agent"]?.data?.estimated_units ?? null

        const estimatedProfit =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["yield-agent"]?.data?.estimated_profit ?? null

        const floodRisk =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["flood-agent"]?.data?.flood_risk ?? null

        const heritageStatus =
          (intelligence?.results as Record<string, { data?: Record<string, unknown> }> | undefined)?.["heritage-agent"]?.data?.heritage_status ?? null

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

        const saveResponse = await fetch(
          `${supabaseUrl}/rest/v1/site_candidates?on_conflict=source%2Cexternal_id`,
          {
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

        if (!saveResponse.ok) {
          throw new Error(`Failed to save site candidate: ${await saveResponse.text()}`)
        }

        const eventResult = await triggerEvent({
          supabaseUrl,
          serviceKey,
          sourceAgent: "site-discovery-agent",
          dealId,
          event: "post-discovery",
          eventContext: {
            deal_id: dealId,
            event: "post-discovery",
            score: null,
            zoning: typeof zoning === "string" ? zoning : null,
            zoning_density:
              typeof zoning === "string" && zoning.trim().toUpperCase().startsWith("R4")
                ? "high-density"
                : typeof zoning === "string" && zoning.trim().toUpperCase().startsWith("R3")
                  ? "medium-density"
                  : typeof zoning === "string" && zoning.trim().toUpperCase().startsWith("R2")
                    ? "low-density"
                    : typeof zoning === "string"
                      ? "unknown"
                      : null,
            flood_risk: typeof floodRisk === "string" ? floodRisk : null,
            yield: typeof units === "number" ? units : null,
            financials: null
          }
        })

        if (!eventResult.success) {
          warnings.push(`post-discovery trigger failed: ${eventResult.error ?? "unknown error"}`)
        } else {
          for (const warning of eventResult.warnings ?? []) {
            warnings.push(`post-discovery: ${warning}`)
          }
        }

        results.push({
          deal_id: dealId,
          address,
          zoning,
          fsr,
          flood_risk: floodRisk,
          heritage_status: heritageStatus,
          estimated_units: units,
          estimated_profit: estimatedProfit,
          warnings,
          discovery_score: score,
          discovery_reasons: reasons,
          event_dispatch: {
            event: "post-discovery",
            triggered: eventResult.success,
            duplicate: eventResult.duplicate === true,
            skipped: eventResult.skipped === true,
            reason: eventResult.reason ?? null
          }
        })

      } catch (err) {

        results.push({
          address: candidate.address,
          error: getErrorMessage(err)
        })

      }

    }

    return jsonResponse({
      success: true,
      processed: results.length,
      results
    })

  } catch (error) {

    return jsonResponse({
      error: getErrorMessage(error)
    }, 500)

  }

})
