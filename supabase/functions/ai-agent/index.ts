import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { getErrorMessage } from "../_shared/utils.ts";
import { callAIPrompt } from "../_shared/ai-client.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";

serve(createAgentHandler({ agentName: "ai-agent", requiredFields: [{ name: "deal_id", type: "string", uuid: true }, { name: "prompt", type: "string" }] }, async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    )
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Supabase environment variables not set" }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const {
      prompt,
      deal_id,
      knowledge_query,
      knowledge_category,
      knowledge_match_count
    } = await req.json()

    if (!prompt || !deal_id) {
      return new Response(
        JSON.stringify({ error: "Missing prompt or deal_id" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    }

    const matchCount =
      typeof knowledge_match_count === "number" && knowledge_match_count > 0
        ? knowledge_match_count
        : 5

    const ragQuery = knowledge_query || prompt

    // Create embedding for knowledge search (Jina AI)
    const queryEmbedding = await generateEmbedding(ragQuery, "retrieval.query")

    // Search vector knowledge base
    let knowledgeResults: any[] = []

    if (knowledge_category) {
      const { data, error } = await supabase.rpc("match_knowledge_chunks_by_category", {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        filter_category: knowledge_category
      })

      if (error) throw error
      knowledgeResults = data || []
    } else {
      const { data, error } = await supabase.rpc("match_knowledge_chunks", {
        query_embedding: queryEmbedding,
        match_count: matchCount
      })

      if (error) throw error
      knowledgeResults = data || []
    }

    const formattedKnowledge = knowledgeResults.length
      ? knowledgeResults
          .map((item: any, index: number) => {
            const sourceName = item.source_name || "unknown_source"
            const category = item.category || "uncategorised"
            const similarity =
              typeof item.similarity === "number"
                ? item.similarity.toFixed(4)
                : "n/a"
            const content = item.content || ""

            return `Knowledge Chunk ${index + 1}
Source: ${sourceName}
Category: ${category}
Similarity: ${similarity}
Content:
${content}`
          })
          .join("\n\n---\n\n")
      : "No relevant knowledge found."

    const { text: aiText, model, usage, cost_usd } = await callAIPrompt(`
You are coordinating a property development deal.

You may return the following actions:

task_create
deal_stage_update
risk_log
financial_snapshot_add
milestone_create
log_communication

Use the retrieved knowledge only as supporting context. If it is not relevant, ignore it.

Return ONLY valid JSON in this format:

{
  "summary": "short summary",
  "actions":[
    {
      "action":"task_create",
      "details":{}
    }
  ]
}

Deal ID:
${deal_id}

User Prompt / Situation:
${prompt}

Relevant Knowledge:
${formattedKnowledge}
`, { jsonMode: true })

    const data = { output_text: aiText, model, usage }

    await supabase.from("ai_actions").insert({
      deal_id,
      agent: "ai-agent",
      action: "reasoning_with_rag",
      payload: {
        prompt,
        knowledge_query: ragQuery,
        knowledge_category: knowledge_category || null,
        knowledge_match_count: matchCount,
        retrieved_knowledge: knowledgeResults,
        model_response: data
      },
      source: "ai-agent",
      model_used: model,
      total_tokens: usage?.total_tokens ?? null,
      cost_usd,
    })

    return new Response(
      JSON.stringify({
        status: "success",
        deal_id,
        knowledge_used: knowledgeResults,
        ai_result: { text: aiText, model, usage }
      }),
      {
        headers: { "Content-Type": "application/json" }
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: getErrorMessage(error) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
}));

