import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import OpenAI from "https://esm.sh/openai@4.52.7"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")
})

serve(async (req) => {
  try {

    const email = await req.json()

    const sender = email.sender
    const subject = email.subject
    const body = email.body

    if (!sender || !subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing email fields" }),
        { status: 400 }
      )
    }

    // Log communication
    const { data: commData, error: commError } = await supabase
      .from("communications")
      .insert({
        sender,
        subject,
        body,
        direction: "inbound"
      })
      .select()
      .single()

    if (commError) {
      throw commError
    }

    // Send email to OpenAI for reasoning
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `
You are an AI assistant coordinating property development deals.

You receive emails from architects, agents, councils, engineers and investors.

Your job is to decide what action should be taken.

Possible actions:
- create_task
- update_deal_stage
- reply_email
- no_action

Respond ONLY with JSON in this format:

{
  "action": "create_task",
  "reason": "why this action is needed",
  "task": "task description if needed",
  "reply": "email reply if needed"
}
`
        },
        {
          role: "user",
          content: `
Sender: ${sender}

Subject: ${subject}

Email body:
${body}
`
        }
      ]
    })

    const decisionText = aiResponse.choices[0].message.content

    let decision

    try {
      decision = JSON.parse(decisionText!)
    } catch {
      decision = {
        action: "no_action",
        reason: "AI response not valid JSON",
        raw: decisionText
      }
    }

    // Log AI decision
    const { error: actionError } = await supabase
      .from("ai_actions")
      .insert({
        agent_name: "email-agent",
        action_type: decision.action,
        action_payload: decision
      })

    if (actionError) {
      throw actionError
    }

    return new Response(
      JSON.stringify({
        status: "processed",
        decision
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {

    console.error(error)

    return new Response(
      JSON.stringify({
        error: error.message
      }),
      { status: 500 }
    )

  }
})