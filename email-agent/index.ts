import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

const supabaseUrl = Deno.env.get("SUPABASE_URL")
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")

if (!supabaseUrl) throw new Error("SUPABASE_URL not set")
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set")
if (!anonKey) throw new Error("SUPABASE_ANON_KEY not set")

const supabase = createClient(supabaseUrl, serviceKey)

serve(async (req) => {

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {

    const { sender, subject, body, deal_id } = await req.json()

    if (!sender || !subject || !body || !deal_id) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 })
    }

    let thread_id

    const { data: existingThread } = await supabase
      .from("email_threads")
      .select("id")
      .eq("deal_id", deal_id)
      .eq("subject", subject)
      .maybeSingle()

    if (existingThread) {
      thread_id = existingThread.id
    } else {

      const { data: newThread } = await supabase
        .from("email_threads")
        .insert({
          deal_id,
          subject,
          participants: sender,
          last_message_at: new Date().toISOString()
        })
        .select()
        .single()

      thread_id = newThread.id
    }

    await supabase.from("communications").insert({
      deal_id,
      thread_id,
      sender,
      recipients: "",
      subject,
      message_summary: body,
      sent_at: new Date().toISOString()
    })

    await supabase
      .from("email_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", thread_id)

    const contextResponse = await fetch(
      `${supabaseUrl}/functions/v1/get-deal-context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": anonKey
        },
        body: JSON.stringify({ deal_id })
      }
    )

    const context = await contextResponse.json()

    const aiResponse = await fetch(
      `${supabaseUrl}/functions/v1/ai-agent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": anonKey
        },
        body: JSON.stringify({
          deal_id,
          prompt: `
Email received.

Sender: ${sender}
Subject: ${subject}

Body:
${body}

Context:
${JSON.stringify(context)}
`
        })
      }
    )

    const aiDecision = await aiResponse.json()

    // send AI decision to orchestrator
    await fetch(`${supabaseUrl}/functions/v1/agent-orchestrator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`
      },
      body: JSON.stringify({
        deal_id,
        aiDecision
      })
    })

    // NEW: run deal intelligence analysis
    await fetch(`${supabaseUrl}/functions/v1/deal-intelligence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`
      },
      body: JSON.stringify({
        deal_id
      })
    })

    return new Response(
      JSON.stringify({
        status: "processed",
        thread_id,
        aiDecision
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    )

  }

})
