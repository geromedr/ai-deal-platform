import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "get-deal-context", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {

  try {

    const { deal_id } = await req.json()

    if (!deal_id) {
      return new Response(
        JSON.stringify({ error: "Missing deal_id" }),
        { status: 400 }
      )
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const [
      dealResult,
      tasksResult,
      communicationsResult,
      financialsResult,
      risksResult
    ] = await Promise.all([

      supabase
        .from("deals")
        .select("*")
        .eq("id", deal_id)
        .single(),

      supabase
        .from("tasks")
        .select("*")
        .eq("deal_id", deal_id),

      supabase
        .from("communications")
        .select("*")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(20),

      supabase
        .from("financial_snapshots")
        .select("*")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(5),

      supabase
        .from("risks")
        .select("*")
        .eq("deal_id", deal_id)
    ])

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "get-deal-context",
      action: "context_requested",
      payload: {}
    })

    return new Response(
      JSON.stringify({
        deal: dealResult.data,
        tasks: tasksResult.data,
        communications: communicationsResult.data,
        financials: financialsResult.data,
        risks: risksResult.data
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

}));

