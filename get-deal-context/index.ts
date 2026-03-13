import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {

  try {

    const { deal_id } = await req.json()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data: deal } = await supabase
      .from("deals")
      .select("*")
      .eq("id", deal_id)
      .single()

    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("deal_id", deal_id)

    const { data: communications } = await supabase
      .from("communications")
      .select("*")
      .eq("deal_id", deal_id)

    const { data: financials } = await supabase
      .from("financial_snapshots")
      .select("*")
      .eq("deal_id", deal_id)

    const { data: risks } = await supabase
      .from("risks")
      .select("*")
      .eq("deal_id", deal_id)

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "get-deal-context",
      action: "context_requested",
      payload: {}
    })

    return new Response(JSON.stringify({
      deal,
      tasks,
      communications,
      financials,
      risks
    }), {
      headers: { "Content-Type": "application/json" }
    })

  } catch (err) {

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })

  }

})