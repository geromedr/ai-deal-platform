import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

const supabaseUrl = Deno.env.get("SUPABASE_URL")
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const openaiKey = Deno.env.get("OPENAI_API_KEY")

if (!supabaseUrl) throw new Error("SUPABASE_URL not set")
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set")
if (!openaiKey) throw new Error("OPENAI_API_KEY not set")

const supabase = createClient(supabaseUrl, serviceKey)

serve(async (req) => {

  try {

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

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: analysisPrompt
      })
    })

    const aiData = await aiResponse.json()

    const text = aiData.output[0].content[0].text

    const clean = text
      .replace("```json", "")
      .replace("```", "")
      .trim()

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
      payload: parsed
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
      JSON.stringify({ error: error.message }),
      { status: 500 }
    )

  }

})