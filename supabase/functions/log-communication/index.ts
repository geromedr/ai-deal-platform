import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    })
  }

  try {

    const { deal_id, message, sender, subject, recipients, direction } = await req.json()

    if (!deal_id || !message) {
      return new Response(JSON.stringify({
        error: "Missing deal_id or message"
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data, error } = await supabase
      .from("communications")
      .insert({
        deal_id,
        sender: sender || null,
        recipients: recipients || null,
        subject: subject || null,
        message_summary: message,
        body: message,
        direction: direction || "logged"
      })
      .select()

    if (error) throw error

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "log-communication",
      action: "communication_logged",
      payload: { sender, message }
    })

    return new Response(JSON.stringify({
      success: true,
      communication: data
    }), {
      headers: { "Content-Type": "application/json" }
    })

  } catch (err) {

    return new Response(JSON.stringify({ error: err.message }), {
      status: 500
    })

  }

})
