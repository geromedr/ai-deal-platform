import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {
  try {

    const { deal_id, gdv, tdc } = await req.json()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data, error } = await supabase
      .from("financial_snapshots")
      .insert({
        deal_id,
        gdv,
        tdc
      })
      .select()

    if (error) throw error

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "add-financial-snapshot",
      action: "financial_snapshot_added",
      payload: { gdv, tdc }
    })

    return new Response(JSON.stringify({ success: true, snapshot: data }), {
      headers: { "Content-Type": "application/json" }
    })

  } catch (err) {

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })

  }
})