import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "email-agent", requiredFields: [{ name: "sender", type: "string" }, { name: "subject", type: "string" }, { name: "body", type: "string" }, { name: "deal_id", type: "string", uuid: true }] }, async (req) => {

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
    const openaiKey = Deno.env.get("OPENAI_API_KEY")

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return new Response(JSON.stringify({ error: "Supabase environment variables not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }

    if (!openaiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { sender, subject, body, deal_id } = await req.json()

    if (!sender || !subject || !body || !deal_id) {
      return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400 })
    }

    /*
    --------------------------------
    AI ADDRESS EXTRACTION
    --------------------------------
    */

    let detectedAddress = null

    try {

      const addressResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: "Extract a property address from the email text. Return only the address or null."
              },
              {
                role: "user",
                content: body
              }
            ]
          })
        }
      )

      const addressData = await addressResponse.json()

      detectedAddress =
        addressData?.choices?.[0]?.message?.content?.trim()

      console.log("Detected address:", detectedAddress)

    } catch (err) {

      console.log("Address extraction failed")

    }

    /*
    --------------------------------
    EMAIL THREAD MANAGEMENT
    --------------------------------
    */

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

    /*
    --------------------------------
    SAVE COMMUNICATION
    --------------------------------
    */

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

    /*
    --------------------------------
    FETCH DEAL CONTEXT
    --------------------------------
    */

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

    /*
    --------------------------------
    AI REASONING
    --------------------------------
    */

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

    /*
    --------------------------------
    EXECUTE AI ACTIONS
    --------------------------------
    */

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

    /*
    --------------------------------
    DEAL INTELLIGENCE
    --------------------------------
    */

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

    /*
    --------------------------------
    SITE INTELLIGENCE
    --------------------------------
    */

    if (detectedAddress && detectedAddress !== "null") {

      await fetch(`${supabaseUrl}/functions/v1/site-intelligence-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`
        },
        body: JSON.stringify({
          deal_id,
          address: detectedAddress
        })
      })

    }

    /*
    --------------------------------
    RESPONSE
    --------------------------------
    */

    return new Response(
      JSON.stringify({
        status: "processed",
        thread_id,
        aiDecision,
        detectedAddress
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {

    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500 }
    )

  }

}));

