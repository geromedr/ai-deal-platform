import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {

  try {

    const { query } = await req.json()

    const apiKey = Deno.env.get("OPENAI_API_KEY")

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

})