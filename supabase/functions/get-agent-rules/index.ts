import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { normalizeAgentActionRuleRow } from "../_shared/action-layer-compat.ts"

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    )
  }

  try {
    const payload = await req.json()
    const agent_name =
      typeof payload?.agent_name === "string" && payload.agent_name.trim().length > 0
        ? payload.agent_name.trim()
        : ""
    const stage =
      typeof payload?.stage === "string" && payload.stage.trim().length > 0
        ? payload.stage.trim()
        : typeof payload?.event === "string" && payload.event.trim().length > 0
          ? payload.event.trim()
          : ""

    if (!agent_name || !stage) {
      return new Response(
        JSON.stringify({ error: "agent_name and stage/event are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    const { data, error } = await supabase
      .from("agent_action_rules")
      .select("*")
      .eq("agent_name", agent_name)
      .eq("stage", stage)

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    const sortedData = Array.isArray(data)
      ? [...data].sort((a, b) => {
          const aTimestamp =
            typeof a?.updated_at === "string" && a.updated_at.length > 0
              ? a.updated_at
              : typeof a?.created_at === "string" && a.created_at.length > 0
                ? a.created_at
                : ""
          const bTimestamp =
            typeof b?.updated_at === "string" && b.updated_at.length > 0
              ? b.updated_at
              : typeof b?.created_at === "string" && b.created_at.length > 0
                ? b.created_at
                : ""

          return bTimestamp.localeCompare(aTimestamp)
        }).map((row) => {
          const normalized = normalizeAgentActionRuleRow(row)

          return {
            id: normalized.id,
            agent_name: normalized.agent_name,
            stage: normalized.stage,
            rule_description: normalized.rule_description,
            action_schema: normalized.action_schema,
            created_at: normalized.created_at,
            updated_at: normalized.updated_at
          }
        })
      : data

    return new Response(
      JSON.stringify(sortedData),
      { headers: { "Content-Type": "application/json" } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})
