import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

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

    console.log("Payload received:", payload)

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
    const supabase = createClient(supabaseUrl, serviceKey)

    /*
    ------------------------
    GEOCODE ADDRESS
    ------------------------
    */

    const geo = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      {
        headers: { "User-Agent": "ai-deal-platform/1.0" }
      }
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

    /*
    ------------------------
    NSW ZONING QUERY
    ------------------------
    */

    const zoningUrl =
      `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19/query` +
      `?geometry=${lon},${lat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=false` +
      `&f=json`

    const zoningRes = await fetch(zoningUrl)
    const zoningText = await zoningRes.text()

    let zoningData: Record<string, unknown> | null = null

    try {
      zoningData = JSON.parse(zoningText)
    } catch {
      zoningData = null
    }

    let zoning = "Unknown"
    let lep = "Unknown"

    if (Array.isArray(zoningData?.features) && zoningData.features.length > 0) {

      const attrs = zoningData.features[0].attributes

      zoning =
        attrs.ZONE ||
        attrs.ZONING ||
        attrs.SYM_CODE ||
        attrs.LABEL ||
        "Unknown"

      lep =
        attrs.LEP_NAME ||
        attrs.EPI_NAME ||
        attrs.PLAN_NAME ||
        "Unknown"
    } else {
      const { data: existingSite } = await supabase
        .from("site_intelligence")
        .select("zoning, lep")
        .eq("deal_id", deal_id)
        .maybeSingle()

      zoning = existingSite?.zoning || zoning
      lep = existingSite?.lep || lep
    }

    /*
    ------------------------
    SAVE RESULT
    ------------------------
    */

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
          address,
          latitude: lat,
          longitude: lon,
          zoning,
          lep
        })
      }
    )

    return new Response(JSON.stringify({
      success: true,
      deal_id,
      address,
      zoning,
      lep
    }))

  } catch (error) {

    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })

  }

})
