import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "get-deal-timeline", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {

  try {

    const { deal_id } = await req.json()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data, error } = await supabase
      .from("deal_activity_feed")
      .select("*")
      .eq("deal_id", deal_id)
      .order("created_at", { ascending: false })

    if (error) throw error

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "get-deal-timeline",
      action: "timeline_requested",
      payload: {}
    })

    return new Response(
      JSON.stringify({ success: true, timeline: data }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

}));

