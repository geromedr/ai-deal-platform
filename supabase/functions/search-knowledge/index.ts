import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";

serve(createAgentHandler({ agentName: "search-knowledge", requiredFields: [{ name: "query", type: "string" }] }, async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {

    const { query } = await req.json()
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 })
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY")
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), { status: 500 })
    }

    const embeddingResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: query
      })
    })

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text()
      throw new Error(`Embedding request failed: ${errorText}`)
    }

    const embeddingData = await embeddingResponse.json()

    const embedding = embeddingData.data[0].embedding

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data } = await supabase.rpc("match_knowledge_chunks", {
      query_embedding: embedding,
      match_count: 5
    })

    return new Response(JSON.stringify(data))

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

}));

