import { serve } from "https://deno.land/std/http/server.ts"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "flood-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }, { name: "address", type: "string" }] }, async (req) => {

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

    const deal_id = payload?.deal_id
    const address = payload?.address

    if (!deal_id || !address) {
      return new Response(JSON.stringify({
        error: "Missing deal_id or address",
        received: payload
      }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    console.log("Geocoding:", address)

    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      {
        headers: { "User-Agent": "ai-deal-platform/1.0" }
      }
    )

    const geoData = await geo.json()

    console.log("Geocode result:", geoData)

    if (!Array.isArray(geoData) || geoData.length === 0) {
      return new Response(JSON.stringify({
        error: "Address not found",
        address_attempted: address
      }), { status: 400 })
    }

    const lat = geoData[0].lat
    const lon = geoData[0].lon

    const floodUrl =
      `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Hazard/MapServer/1/query` +
      `?geometry=${lon},${lat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=false` +
      `&f=json`

    const floodRes = await fetch(floodUrl)
    const floodData = await floodRes.json()

    let floodRisk = "Not mapped"
    let sourceAttributes: Record<string, unknown> | null = null

    if (Array.isArray(floodData?.features) && floodData.features.length > 0) {

      const attrs = floodData.features[0].attributes || {}
      sourceAttributes = attrs

      floodRisk =
        attrs.LABEL ||
        attrs.FLOOD ||
        attrs.FLOOD_TYPE ||
        attrs.LEGEND ||
        "Mapped flood layer"

    }

    await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`,
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          address,
          latitude: lat,
          longitude: lon,
          flood_risk: floodRisk,
          source_layer: "NSW Flood Hazard",
          source_attributes: sourceAttributes
        })
      }
    )

    return new Response(JSON.stringify({
      success: true,
      deal_id,
      address,
      latitude: lat,
      longitude: lon,
      flood_risk: floodRisk
    }), { headers: { "Content-Type": "application/json" }})

  } catch (error) {

    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })

  }

}));

