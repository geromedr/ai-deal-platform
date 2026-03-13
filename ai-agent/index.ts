import { serve } from "https://deno.land/std/http/server.ts"

serve(async (req) => {

  const { prompt } = await req.json()

  const apiKey = Deno.env.get("OPENAI_API_KEY")

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt
    })
  })

  const data = await response.json()

  return new Response(
    JSON.stringify(data),
    { headers: { "Content-Type": "application/json" } }
  )

})