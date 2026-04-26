import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { requireEnv } from "../_shared/utils.ts";
import { generateEmbedding } from "../_shared/embeddings.ts";

serve(createAgentHandler({ agentName: "add-knowledge-document", requiredFields: [{ name: "source_name", type: "string" }, { name: "content", type: "string" }] }, async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {

    const { source_name, category, content } = await req.json()
    if (!source_name || !content) {
      return new Response(JSON.stringify({ error: "Missing source_name or content" }), { status: 400 })
    }

    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    )

    const embedding = await generateEmbedding(content, "retrieval.passage")

    const { data, error } = await supabase
      .from("knowledge_chunks")
      .insert({
        source_name,
        category,
        content,
        embedding
      })

    if (error) throw error

    return new Response(JSON.stringify({ success: true }))

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

}));
