import { serve } from "https://deno.land/std/http/server.ts"

serve(async (req) => {

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

    const heritageUrl =
      `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/16/query` +
      `?geometry=${lon},${lat}` +
      `&geometryType=esriGeometryPoint` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&outFields=*` +
      `&returnGeometry=false` +
      `&f=json`

    const heritageRes = await fetch(heritageUrl)
    const heritageData = await heritageRes.json()

    let heritageStatus = "No mapped heritage"

    if (heritageData?.features?.length > 0) {

      const attrs = heritageData.features[0].attributes

      heritageStatus =
        attrs.ITEM_NAME ||
        attrs.HERITAGE ||
        attrs.NAME ||
        "Mapped heritage item"

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
          heritage_status: heritageStatus
        })
      }
    )

    return new Response(JSON.stringify({
      success: true,
      heritage_status: heritageStatus
    }))

  } catch (error) {

    return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  }

})