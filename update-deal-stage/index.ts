import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {

  try {

    const { deal_id, new_stage } = await req.json()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data, error } = await supabase
      .from("deals")
      .update({
        stage: new_stage,
        updated_at: new Date()
      })
      .eq("id", deal_id)
      .select()

    if (error) throw error

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "update-deal-stage",
      action: "stage_updated",
      payload: { new_stage }
    })

    return new Response(JSON.stringify({ success: true, updated_deal: data }), {
      headers: { "Content-Type": "application/json" }
    })

  } catch (err) {

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })

  }

})