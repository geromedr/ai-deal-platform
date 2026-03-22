import { serve } from "https://deno.land/std/http/server.ts"

serve(async (req) => {

  try {

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
    }

    const { deal_id } = await req.json()

    if (!deal_id) {
      return new Response(JSON.stringify({ error: "Missing deal_id" }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

    /*
    --------------------------------
    GET SITE INTELLIGENCE DATA
    --------------------------------
    */

    const siteRes = await fetch(
      `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=*`,
      {
        headers: {
          "apikey": serviceKey,
          "Authorization": `Bearer ${serviceKey}`
        }
      }
    )

    const siteData = await siteRes.json()

    if (!siteData.length) {
      return new Response(JSON.stringify({ error: "No site intelligence found" }), { status: 400 })
    }

    const site = siteData[0]

    /*
    --------------------------------
    INPUT DATA
    --------------------------------
    */

    const siteArea = Number(site.site_area || 1000)
    const fsr = parseFloat(String(site.fsr || "1"))

    const avgUnitSize = 90        // sqm
    const salePricePerSqm = 11000
    const buildCostPerSqm = 4200

    /*
    --------------------------------
    CALCULATIONS
    --------------------------------
    */

    const maxGFA = siteArea * fsr

    const unitCount = Math.floor(maxGFA / avgUnitSize)

    const revenue = maxGFA * salePricePerSqm

    const buildCost = maxGFA * buildCostPerSqm

    const profit = revenue - buildCost

    /*
    --------------------------------
    SAVE RESULTS
    --------------------------------
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
          estimated_gfa: maxGFA,
          estimated_units: unitCount,
          estimated_revenue: revenue,
          estimated_build_cost: buildCost,
          estimated_profit: profit
        })
      }
    )

    return new Response(JSON.stringify({
      success: true,
      site_area: siteArea,
      fsr,
      max_gfa: maxGFA,
      estimated_units: unitCount,
      estimated_revenue: revenue,
      estimated_build_cost: buildCost,
      estimated_profit: profit
    }))

  } catch (error) {

    return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  }

})