import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
  }

  try {

    const { source_name, category, content } = await req.json()
    if (!source_name || !content) {
      return new Response(JSON.stringify({ error: "Missing source_name or content" }), { status: 400 })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

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
        input: content
      })
    })

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text()
      throw new Error(`Embedding request failed: ${errorText}`)
    }

    const embeddingData = await embeddingResponse.json()

    const embedding = embeddingData.data[0].embedding

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

})
