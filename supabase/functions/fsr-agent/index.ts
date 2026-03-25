import { serve } from "https://deno.land/std/http/server.ts"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "fsr-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }, { name: "address", type: "string" }] }, async (req) => {

  try {

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

    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
    )

    const geoData = await geo.json()

    if (!geoData.length) {
      return new Response(JSON.stringify({
        error: "Address not found",
        address_attempted: address
      }), { status: 400 })
    }

    const lat = geoData[0].lat
    const lon = geoData[0].lon

    const fsrUrl =
      `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/11/query` +
      `?geometry=${lon},${lat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=false` +
      `&f=json`

    const fsrRes = await fetch(fsrUrl)
    const fsrData = await fsrRes.json()

    let fsr = "Unknown"

    if (fsrData?.features?.length > 0) {

      const attrs = fsrData.features[0].attributes

      fsr =
        attrs.FSR ||
        attrs.RATIO ||
        attrs.LABEL ||
        "Mapped FSR control"

    }

    await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          fsr: String(fsr)
        })
      }
    )

    return new Response(JSON.stringify({
      success: true,
      fsr
    }))

  } catch (error) {

    return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  }

}));

