import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { insertTaskWithCompatibility } from "../_shared/action-layer-compat.ts";
import { incrementDealPerformanceMetrics } from "../_shared/deal-feed.ts";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

serve(createAgentHandler({ agentName: "create-task", requiredFields: [{ name: "deal_id", type: "string", uuid: true }, { name: "title", type: "string" }] }, async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json();
    const deal_id = typeof payload?.deal_id === "string" ? payload.deal_id : "";
    const title = typeof payload?.title === "string"
      ? payload.title.trim()
      : "";
    const description = typeof payload?.description === "string"
      ? payload.description.trim()
      : "";
    const assigned_to =
      typeof payload?.assigned_to === "string" && payload.assigned_to.trim()
        ? payload.assigned_to.trim()
        : null;
    const due_date =
      typeof payload?.due_date === "string" && payload.due_date.trim()
        ? payload.due_date.trim()
        : null;

    if (!deal_id || !title) {
      return jsonResponse({
        error: "Missing deal_id or title",
        received: payload,
      }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse(
        { error: "Supabase environment variables not set" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const warnings: string[] = [];

    const { data: existingTasks, error: existingTasksError } = await supabase
      .from("tasks")
      .select("*")
      .eq("deal_id", deal_id)
      .eq("title", title)
      .order("created_at", { ascending: false });

    if (existingTasksError) throw existingTasksError;

    const openDuplicate = (existingTasks ?? []).find((task) => {
      const status = normalizeStatus(task.status);
      return !["closed", "resolved", "done", "completed", "cancelled"].includes(
        status,
      );
    });

    if (openDuplicate) {
      const { error: duplicateLogError } = await supabase.from("ai_actions")
        .insert({
          deal_id,
          agent: "create-task",
          action: "task_duplicate_suppressed",
          payload: {
            task_id: openDuplicate.id ?? null,
            title,
            assigned_to: openDuplicate.assigned_to ?? openDuplicate.owner ??
              null,
            due_date: openDuplicate.due_date ?? null,
          },
        });

      if (duplicateLogError) throw duplicateLogError;

      return jsonResponse({
        success: true,
        skipped: true,
        duplicate: true,
        reason: "Existing open task with the same title already exists",
        task: openDuplicate,
        warnings,
      });
    }

    const writeResult = await insertTaskWithCompatibility(supabase, {
      deal_id,
      title,
      description: description || null,
      assigned_to,
      due_date,
    });

    const { error: actionError } = await supabase.from("ai_actions").insert({
      deal_id,
      agent: "create-task",
      action: "task_created",
      payload: {
        task_id: writeResult.data.id,
        title,
        assigned_to: writeResult.data.assigned_to,
        due_date,
        compatibility_mode: writeResult.mode,
        warning: writeResult.warning ?? null,
      },
    });

    if (actionError) throw actionError;

    try {
      await incrementDealPerformanceMetrics(supabase, {
        deal_id,
        actions_taken: 1,
      });
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : "Failed to increment deal performance actions",
      );
    }

    return jsonResponse({
      success: true,
      task: writeResult.data,
      compatibility_mode: writeResult.mode,
      duplicate: false,
      warnings: [
        ...(writeResult.warning ? [writeResult.warning] : []),
        ...warnings,
      ],
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}));

