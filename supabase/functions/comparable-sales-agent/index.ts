import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type DealRow = {
  id: string
  address?: string | null
  suburb?: string | null
  state?: string | null
  postcode?: string | null
}

type SiteIntelligenceRow = {
  deal_id: string
  address?: string | null
  zoning?: string | null
  estimated_units?: number | null
  estimated_gfa?: number | null
}

type KnowledgeMatch = {
  content?: string | null
  source_name?: string | null
  category?: string | null
}

type ComparableSalesOutput = {
  estimated_sale_price_per_sqm: number
  currency: string
  rationale: string
  comparables: Array<{
    project_name: string
    location: string
    dwelling_type: string
    estimated_sale_price_per_sqm: number
    similarity_reason: string
  }>
}

type ComparableSalesEstimateRow = {
  id: string
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function cleanJsonBlock(text: string) {
  return text.replace("```json", "").replace("```", "").trim()
}

function buildFunctionHeaders(serviceKey: string, authorizationHeader: string | null) {
  const normalizedRequestAuthorization =
    typeof authorizationHeader === "string" && authorizationHeader.trim().length > 0
      ? authorizationHeader.trim()
      : null
  const bearerToken = normalizedRequestAuthorization?.toLowerCase().startsWith("bearer ")
    ? normalizedRequestAuthorization
    : serviceKey.includes(".")
      ? `Bearer ${serviceKey}`
      : normalizedRequestAuthorization
        ? `Bearer ${normalizedRequestAuthorization.replace(/^Bearer\s+/i, "")}`
        : null

  return {
    "Content-Type": "application/json",
    ...(bearerToken ? { "Authorization": bearerToken } : {}),
    "apikey": serviceKey
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return "Unknown error"
  }
}

serve(createAgentHandler({ agentName: "comparable-sales-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const openaiKey = Deno.env.get("OPENAI_API_KEY")

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500)
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500)
  if (!openaiKey) return jsonResponse({ error: "OPENAI_API_KEY not set" }, 500)

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    let payload: Record<string, unknown>
    const requestAuthorizationHeader = req.headers.get("Authorization")

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const deal_id = typeof payload.deal_id === "string" ? payload.deal_id : null
    const radius_km =
      typeof payload.radius_km === "number" && Number.isFinite(payload.radius_km)
        ? payload.radius_km
        : 5
    const dwelling_type =
      typeof payload.dwelling_type === "string" && payload.dwelling_type.trim()
        ? payload.dwelling_type.trim()
        : "apartment"

    if (!deal_id) {
      return jsonResponse({
        error: "Missing deal_id",
        received: payload
      }, 400)
    }

    console.log("comparable-sales-agent request received", {
      deal_id,
      radius_km,
      dwelling_type
    })

    const { data: dealData, error: dealError } = await supabase
      .from("deals")
      .select("id, address, suburb, state, postcode")
      .eq("id", deal_id)
      .maybeSingle()

    if (dealError) throw dealError
    const deal = dealData as DealRow | null
    if (!deal) {
      return jsonResponse({ error: "Deal not found" }, 404)
    }

    const { data: siteRows, error: siteError } = await supabase
      .from("site_intelligence")
      .select("deal_id, address, zoning, estimated_units, estimated_gfa")
      .eq("deal_id", deal_id)
      .order("updated_at", { ascending: false })
      .limit(1)

    if (siteError) throw siteError
    const site = (siteRows?.[0] ?? null) as SiteIntelligenceRow | null

    const siteAddress = site?.address || deal.address || ""
    const suburb = deal.suburb || extractSuburbFromAddress(siteAddress)

    if (!siteAddress && !suburb) {
      return jsonResponse({
        error: "Missing site location context for comparable search"
      }, 400)
    }

    const knowledgeQuery = [
      "nearby comparable developments",
      dwelling_type,
      suburb || siteAddress,
      "sale price per sqm",
      "NSW"
    ].join(" ")

    console.log("comparable-sales-agent querying knowledge", {
      deal_id,
      knowledge_query: knowledgeQuery
    })

    const knowledgeResponse = await fetch(`${supabaseUrl}/functions/v1/search-knowledge`, {
      method: "POST",
      headers: buildFunctionHeaders(serviceKey, requestAuthorizationHeader),
      body: JSON.stringify({ query: knowledgeQuery })
    })

    if (!knowledgeResponse.ok) {
      const failureText = await knowledgeResponse.text()
      throw new Error(`search-knowledge failed: ${failureText}`)
    }

    const knowledgeMatches = await knowledgeResponse.json() as KnowledgeMatch[]

    const prompt = `
You are a property development market analyst for New South Wales, Australia.

Your task is to estimate a realistic sale price per sqm for a development site by identifying nearby comparable developments from the provided knowledge context.

Requirements:
- Use the knowledge context first.
- If knowledge context is thin, make a conservative estimate and say so clearly.
- Focus on new development comparables, not detached house resale evidence.
- Return ONLY valid JSON.

Site context:
${JSON.stringify({
  deal_id,
  address: siteAddress,
  suburb,
  state: deal.state || "NSW",
  postcode: deal.postcode,
  zoning: site?.zoning || null,
  estimated_units: site?.estimated_units || null,
  estimated_gfa: site?.estimated_gfa || null,
  radius_km,
  dwelling_type
}, null, 2)}

Knowledge context:
${JSON.stringify(knowledgeMatches, null, 2)}

Return JSON in this exact shape:
{
  "estimated_sale_price_per_sqm": 0,
  "currency": "AUD",
  "rationale": "short explanation",
  "comparables": [
    {
      "project_name": "string",
      "location": "string",
      "dwelling_type": "string",
      "estimated_sale_price_per_sqm": 0,
      "similarity_reason": "string"
    }
  ]
}
`

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt
      })
    })

    if (!openaiResponse.ok) {
      const failureText = await openaiResponse.text()
      throw new Error(`OpenAI request failed: ${failureText}`)
    }

    const openaiData = await openaiResponse.json()
    const responseText = openaiData?.output?.[0]?.content?.[0]?.text

    if (!responseText) {
      throw new Error("OpenAI response did not include text output")
    }

    const parsed = JSON.parse(cleanJsonBlock(responseText)) as ComparableSalesOutput

    if (!Number.isFinite(parsed.estimated_sale_price_per_sqm)) {
      throw new Error("Invalid estimated_sale_price_per_sqm returned")
    }

    const { data: estimateData, error: estimateError } = await supabase
      .from("comparable_sales_estimates")
      .insert({
        deal_id,
        subject_address: siteAddress,
        suburb,
        state: deal.state || "NSW",
        postcode: deal.postcode || null,
        radius_km,
        dwelling_type,
        estimated_sale_price_per_sqm: parsed.estimated_sale_price_per_sqm,
        currency: parsed.currency || "AUD",
        rationale: parsed.rationale,
        model_name: "gpt-4.1-mini",
        knowledge_context: knowledgeMatches,
        raw_output: parsed,
        status: "completed"
      })
      .select()
      .single()

    if (estimateError) throw estimateError
    const estimate = estimateData as ComparableSalesEstimateRow

    if (parsed.comparables.length > 0) {
      const evidenceRows = parsed.comparables.map((comparable) => ({
        estimate_id: estimate.id,
        project_name: comparable.project_name,
        location: comparable.location,
        dwelling_type: comparable.dwelling_type,
        estimated_sale_price_per_sqm: comparable.estimated_sale_price_per_sqm,
        similarity_reason: comparable.similarity_reason,
        source_metadata: {
          agent: "comparable-sales-agent",
          suburb,
          radius_km
        }
      }))

      const { error: evidenceError } = await supabase
        .from("comparable_sales_evidence")
        .insert(evidenceRows)

      if (evidenceError) throw evidenceError
    }

    const { error: actionError } = await supabase
      .from("ai_actions")
      .insert({
        deal_id,
        agent: "comparable-sales-agent",
        action: "comparable_sales_estimated",
        payload: {
          estimate_id: estimate.id,
          radius_km,
          dwelling_type,
          suburb,
          estimated_sale_price_per_sqm: parsed.estimated_sale_price_per_sqm,
          comparable_count: parsed.comparables.length
        }
      })

    if (actionError) throw actionError

    console.log("comparable-sales-agent processing complete", {
      deal_id,
      estimated_sale_price_per_sqm: parsed.estimated_sale_price_per_sqm,
      comparable_count: parsed.comparables.length
    })

    return jsonResponse({
      success: true,
      deal_id,
      address: siteAddress,
      suburb,
      radius_km,
      dwelling_type,
      estimate_id: estimate.id,
      estimated_sale_price_per_sqm: parsed.estimated_sale_price_per_sqm,
      currency: parsed.currency || "AUD",
      rationale: parsed.rationale,
      comparables: parsed.comparables
    })
  } catch (error) {
    console.error("comparable-sales-agent failed", error)

    return jsonResponse({
      error: getErrorMessage(error)
    }, 500)
  }
}));

function extractSuburbFromAddress(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return ""
  return parts[parts.length - 2] || ""
}


