import { serve } from "https://deno.land/std/http/server.ts"

serve(async (req) => {
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
    const payload = await req.json()
    const receivedAt = new Date().toISOString()

    console.log("test-agent request received", {
      received_at: receivedAt,
      payload
    })

    console.log("test-agent processing complete", {
      received_at: receivedAt,
      status: "success"
    })

    return new Response(
      JSON.stringify({
        status: "success",
        agent: "test-agent",
        received_at: receivedAt,
        input: payload
      }),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("test-agent failed", error)

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Invalid request"
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    )
  }
})
