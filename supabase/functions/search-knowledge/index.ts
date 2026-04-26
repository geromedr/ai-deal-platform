import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { requireEnv } from "../_shared/utils.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";

serve(createAgentHandler({ agentName: "search-knowledge", requiredFields: [{ name: "query", type: "string" }] }, async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {

    const { query } = await req.json()
    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 })
    }

    const embedding = await generateEmbedding(query, "retrieval.query")

    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
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
