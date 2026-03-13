import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

serve(async (req) => {

  try {

    const { deal_id, title, description } = await req.json()

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Create task
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        deal_id: deal_id,
        title: title,
        description: description,
        status: "open"
      })
      .select()

    if (error) throw error

    // Log AI action
    await supabase.from("ai_actions").insert({
      deal_id: deal_id,
      agent: "create-task",
      action: "task_created",
      payload: {
        title: title,
        description: description
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        task: data
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    )

  }

})