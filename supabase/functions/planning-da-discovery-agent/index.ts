import { serve } from "https://deno.land/std/http/server.ts"

serve(async () => {

  try {

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    /*
    NSW Planning Portal DA dataset
    */

    const res = await fetch(
      "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/14/query?where=1%3D1&outFields=*&f=json"
    )

    const data = await res.json()

    const candidates = []

    for (const feature of data.features) {

      const attr = feature.attributes

      const description = String(attr.DEV_DESC || "").toLowerCase()

      /*
      Filter for apartment style developments
      */

      if (
        description.includes("apartments") ||
        description.includes("units") ||
        description.includes("multi dwelling")
      ) {

        const address = attr.ADDRESS || attr.LOCATION

        if (!address) continue

        candidates.push({
          source: "nsw_da",
          external_id: String(attr.ID),
          address: address,
          suburb: attr.SUBURB,
          state: "NSW",
          raw_data: attr
        })

      }

    }

    /*
    Send into site discovery pipeline
    */

    const discoveryRes = await fetch(
      `${supabaseUrl}/functions/v1/site-discovery-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          candidates
        })
      }
    )

    const result = await discoveryRes.json()

    return new Response(JSON.stringify({
      success: true,
      candidates_found: candidates.length,
      discovery_result: result
    }))

  } catch (error) {

    return new Response(JSON.stringify({
      error: error.message
    }), { status: 500 })

  }

})