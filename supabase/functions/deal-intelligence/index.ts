import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { getErrorMessage } from "../_shared/utils.ts";
import { callAIPrompt } from "../_shared/ai-client.ts";

serve(createAgentHandler({ agentName: "deal-intelligence", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return new Response(
        JSON.stringify({ error: "Supabase environment variables not set" }),
        { status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { deal_id } = await req.json()

    if (!deal_id) {
      return new Response(
        JSON.stringify({ error: "Missing deal_id" }),
        { status: 400 }
      )
    }

    const { data: deal } = await supabase
      .from("deals")
      .select("*")
      .eq("id", deal_id)
      .single()

    const analysisPrompt = `
You are analysing a property development opportunity.

Deal data:
${JSON.stringify(deal)}

Analyse the following:

zoning feasibility
flood risk
development yield potential
planning risks
recommended next actions

Return JSON:

{
  "risks":[
    {
      "title":"",
      "description":"",
      "severity":"low|medium|high"
    }
  ],
  "milestones":[
    {
      "title":"",
      "due_date":""
    }
  ],
  "financial_insights":[
    {
      "category":"",
      "amount":0,
      "notes":""
    }
  ]
}
`

    const { text, model, usage, cost_usd } = await callAIPrompt(analysisPrompt, { jsonMode: true })

    const clean = text.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(clean)

    for (const risk of parsed.risks || []) {

      await supabase.from("risks").insert({
        deal_id,
        title: risk.title,
        description: risk.description,
        severity: risk.severity
      })

    }

    for (const milestone of parsed.milestones || []) {

      await supabase.from("milestones").insert({
        deal_id,
        title: milestone.title,
        due_date: milestone.due_date,
        status: "pending"
      })

    }

    for (const financial of parsed.financial_insights || []) {

      await supabase.from("financial_snapshots").insert({
        deal_id,
        category: financial.category,
        amount: financial.amount,
        notes: financial.notes
      })

    }

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "deal-intelligence",
      action: "analysis_completed",
      payload: parsed,
      model_used: model,
      total_tokens: usage?.total_tokens ?? null,
      cost_usd,
    })

    return new Response(
      JSON.stringify({
        status: "analysis_completed",
        insights: parsed
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {

    return new Response(
      JSON.stringify({ error: getErrorMessage(error) }),
      { status: 500 }
    )

  }

}));

