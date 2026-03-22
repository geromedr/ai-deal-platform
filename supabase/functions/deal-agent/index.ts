import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
    const openaiKey = Deno.env.get("OPENAI_API_KEY")

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return new Response(
        JSON.stringify({ error: "Supabase environment variables not set" }),
        { status: 500 }
      )
    }

    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not set" }),
        { status: 500 }
      )
    }

    const { deal_id } = await req.json()

    const supabase = createClient(
      supabaseUrl,
      serviceKey
    )

    // Allowed AI actions
    const allowedActions = [
      "create_task",
      "update_deal_stage",
      "log_communication",
      "add_financial_snapshot"
    ]

    // Allowed stage transitions
    const allowedStageTransitions: Record<string, string[]> = {
      opportunity: ["feasibility"],
      feasibility: ["finance"],
      finance: ["delivery"],
      delivery: ["completion"]
    }

    // Fetch full deal context
    const contextResponse = await fetch(
      `${supabaseUrl}/functions/v1/get-deal-context`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`
        },
        body: JSON.stringify({ deal_id })
      }
    )

    const context = await contextResponse.json()

    // Ask OpenAI what to do next
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `
You are an AI property development project manager.

Your job is to advance development deals logically and professionally.

You may use the following actions:

create_task
update_deal_stage
log_communication
add_financial_snapshot

Here is the full deal context:

${JSON.stringify(context, null, 2)}

Determine the most important next action.

Respond ONLY in JSON format:

{
 "action": "create_task",
 "title": "...",
 "description": "..."
}
`
      })
    })

    const aiOutput = await openaiResponse.json()

    const decisionText = aiOutput.output[0].content[0].text

    const decision = JSON.parse(decisionText)

    // Guardrail: ensure action is allowed
    if (!allowedActions.includes(decision.action)) {

      return new Response(
        JSON.stringify({ error: "AI attempted invalid action" }),
        { status: 400 }
      )

    }

    // Guardrail: ensure stage transitions are valid
    if (decision.action === "update_deal_stage") {

      const currentStage = context.deal.stage

      if (!allowedStageTransitions[currentStage]?.includes(decision.new_stage)) {

        return new Response(
          JSON.stringify({ error: "Invalid stage transition attempted" }),
          { status: 400 }
        )

      }

      await fetch(`${supabaseUrl}/functions/v1/update-deal-stage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          deal_id,
          new_stage: decision.new_stage
        })
      })

    }

    // Execute task creation
    if (decision.action === "create_task") {

      await fetch(`${supabaseUrl}/functions/v1/create-task`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          deal_id,
          title: decision.title,
          description: decision.description
        })
      })

    }

    // Execute communication logging
    if (decision.action === "log_communication") {

      await fetch(`${supabaseUrl}/functions/v1/log-communication`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          deal_id,
          message: decision.message
        })
      })

    }

    // Execute financial snapshot update
    if (decision.action === "add_financial_snapshot") {

      await fetch(`${supabaseUrl}/functions/v1/add-financial-snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${anonKey}`
        },
        body: JSON.stringify({
          deal_id,
          gdv: decision.gdv,
          tdc: decision.tdc
        })
      })

    }

    return new Response(
      JSON.stringify({
        decision
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

})
