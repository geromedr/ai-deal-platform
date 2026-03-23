import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import {
  insertRiskWithCompatibility,
  insertTaskWithCompatibility
} from "../_shared/action-layer-compat.ts"

type ActionDetails = Record<string, unknown>

type AgentAction = {
  action: string
  details?: ActionDetails
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function cleanJsonBlock(text: string) {
  return text.replace("```json", "").replace("```", "").trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normaliseDecision(payload: Record<string, unknown>) {
  const directDecision = payload.aiDecision

  if (isRecord(directDecision) && Array.isArray(directDecision.actions)) {
    return directDecision
  }

  if (isRecord(directDecision) && isRecord(directDecision.ai_result)) {
    const outputText = directDecision.ai_result?.output?.[0]?.content?.[0]?.text

    if (typeof outputText === "string" && outputText.trim()) {
      return JSON.parse(cleanJsonBlock(outputText))
    }
  }

  if (Array.isArray(payload.actions)) {
    return {
      summary: payload.summary ?? null,
      actions: payload.actions
    }
  }

  throw new Error("Unable to determine agent action payload")
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    const payload = await req.json()
    const deal_id = typeof payload?.deal_id === "string" ? payload.deal_id : ""

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id", received: payload }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const parsed = normaliseDecision(payload as Record<string, unknown>)

    if (!Array.isArray(parsed.actions)) {
      return jsonResponse({ error: "No actions supplied", parsed }, 400)
    }

    const results: Array<Record<string, unknown>> = []

    for (const rawAction of parsed.actions as AgentAction[]) {
      const details = isRecord(rawAction.details) ? rawAction.details : {}

      if (rawAction.action === "task_create") {
        try {
          const writeResult = await insertTaskWithCompatibility(supabase, {
            deal_id,
            title: typeof details.title === "string" ? details.title : "Untitled task",
            description: typeof details.description === "string" ? details.description : null,
            assigned_to: typeof details.assigned_to === "string" ? details.assigned_to : null,
            due_date: typeof details.due_date === "string" ? details.due_date : null
          })

          results.push({
            action: "task_create",
            success: true,
            error: null,
            compatibility_mode: writeResult.mode,
            warning: writeResult.warning ?? null,
            data: writeResult.data
          })
        } catch (error) {
          results.push({
            action: "task_create",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          })
        }
      }

      if (rawAction.action === "log_communication") {
        const { error } = await supabase
          .from("communications")
          .insert({
            deal_id,
            sender: details.sender ?? null,
            subject: details.subject ?? null,
            message_summary: details.message_summary ?? details.message ?? null,
            sent_at: details.received_at ?? new Date().toISOString()
          })

        results.push({
          action: "log_communication",
          success: !error,
          error: error?.message ?? null
        })
      }

      if (rawAction.action === "deal_stage_update") {
        const { error } = await supabase
          .from("deals")
          .update({
            stage: details.stage ?? null,
            updated_at: new Date().toISOString()
          })
          .eq("id", deal_id)

        results.push({
          action: "deal_stage_update",
          success: !error,
          error: error?.message ?? null
        })
      }

      if (rawAction.action === "risk_log") {
        try {
          const writeResult = await insertRiskWithCompatibility(supabase, {
            deal_id,
            title: typeof details.title === "string" ? details.title : null,
            description: typeof details.description === "string" ? details.description : null,
            severity: typeof details.severity === "string" ? details.severity : "medium"
          })

          results.push({
            action: "risk_log",
            success: true,
            error: null,
            compatibility_mode: writeResult.mode,
            warning: writeResult.warning ?? null,
            data: writeResult.data
          })
        } catch (error) {
          results.push({
            action: "risk_log",
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          })
        }
      }

      if (rawAction.action === "financial_snapshot_add") {
        const { error } = await supabase
          .from("financial_snapshots")
          .insert({
            deal_id,
            category: details.category ?? "general",
            amount: details.amount ?? null,
            notes: details.notes ?? null,
            gdv: details.gdv ?? null,
            tdc: details.tdc ?? null
          })

        results.push({
          action: "financial_snapshot_add",
          success: !error,
          error: error?.message ?? null
        })
      }

      if (rawAction.action === "milestone_create") {
        const { error } = await supabase
          .from("milestones")
          .insert({
            deal_id,
            title: details.title ?? null,
            due_date: details.due_date ?? null,
            status: "pending"
          })

        results.push({
          action: "milestone_create",
          success: !error,
          error: error?.message ?? null
        })
      }
    }

    const { error: actionError } = await supabase.from("ai_actions").insert({
      deal_id,
      agent: "agent-orchestrator",
      action: "actions_executed",
      payload: {
        summary: parsed.summary ?? null,
        results
      }
    })

    if (actionError) throw actionError

    return jsonResponse({
      success: true,
      summary: parsed.summary ?? null,
      results
    })
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
