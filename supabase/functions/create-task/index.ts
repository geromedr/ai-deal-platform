import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const payload = await req.json()
    const deal_id = typeof payload?.deal_id === "string" ? payload.deal_id : ""
    const title = typeof payload?.title === "string" ? payload.title.trim() : ""
    const description =
      typeof payload?.description === "string" ? payload.description.trim() : ""
    const assigned_to =
      typeof payload?.assigned_to === "string" && payload.assigned_to.trim()
        ? payload.assigned_to.trim()
        : null
    const due_date =
      typeof payload?.due_date === "string" && payload.due_date.trim()
        ? payload.due_date.trim()
        : null

    if (!deal_id || !title) {
      return jsonResponse({
        error: "Missing deal_id or title",
        received: payload
      }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        deal_id,
        title,
        description: description || null,
        assigned_to,
        due_date,
        status: "open"
      })
      .select()
      .single()

    if (error) throw error

    const { error: actionError } = await supabase.from("ai_actions").insert({
      deal_id,
      agent: "create-task",
      action: "task_created",
      payload: {
        task_id: data.id,
        title,
        assigned_to,
        due_date
      }
    })

    if (actionError) throw actionError

    return jsonResponse({
      success: true,
      task: data
    })
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
