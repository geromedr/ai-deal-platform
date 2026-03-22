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

    const { error: dealError } = await supabase
      .from("deals")
      .upsert({
        id: deal_id,
        address,
        status: "active",
        stage: "opportunity",
        source: "site-intelligence-agent"
      }, {
        onConflict: "id"
      })

    if (dealError) {
      throw dealError
    }

    const { data: existingSite, error: existingSiteError } = await supabase
      .from("site_intelligence")
      .select("id")
      .eq("deal_id", deal_id)
      .maybeSingle()

    if (existingSiteError) {
      throw existingSiteError
    }

    if (existingSite?.id) {
      const { error: siteUpdateError } = await supabase
        .from("site_intelligence")
        .update({ address })
        .eq("deal_id", deal_id)

      if (siteUpdateError) {
        throw siteUpdateError
      }
    } else {
      const { error: siteInsertError } = await supabase
        .from("site_intelligence")
        .insert({
          deal_id,
          address
        })

      if (siteInsertError) {
        throw siteInsertError
      }
    }

    /*
    -------------------------
    PLANNING AGENTS
    -------------------------
    */

    const agents = [
      "zoning-agent",
      "flood-agent",
      "height-agent",
      "fsr-agent",
      "heritage-agent"
    ]

    const results: Record<string, unknown> = {}

    /*
    -------------------------
    RUN AGENTS (PARALLEL)
    -------------------------
    */

    const tasks = agents.map(async (agent) => {

      try {

        console.log(`Running ${agent}`)

        const res = await fetch(
          `${supabaseUrl}/functions/v1/${agent}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`
            },
            body: JSON.stringify({
              deal_id,
              address
            })
          }
        )

        const data = await res.json()

        results[agent] = data

      } catch (err) {

        console.log(`${agent} failed`)

        results[agent] = {
          error: "Agent failed"
        }

      }

    })

    await Promise.all(tasks)

    /*
    -------------------------
    RUN YIELD AGENT
    -------------------------
    */

    try {

      console.log("Running yield-agent")

      const yieldRes = await fetch(
        `${supabaseUrl}/functions/v1/yield-agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`
          },
          body: JSON.stringify({
            deal_id
          })
        }
      )

      const yieldData = await yieldRes.json()

      results["yield-agent"] = yieldData

    } catch {

      results["yield-agent"] = {
        error: "Yield agent failed"
      }

    }

    /*
    -------------------------
    RESPONSE
    -------------------------
    */

    return new Response(JSON.stringify({
      success: true,
      deal_id,
      address,
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
