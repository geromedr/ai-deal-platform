import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type RequestPayload = {
  deal_id?: string;
  new_stage?: string;
  new_status?: string;
  transition_reason?: string;
  auto_evaluate?: boolean;
};

const STATUS_AGENT = "update-deal-stage";
const ALLOWED_STATUS_SEQUENCE = [
  "active",
  "reviewing",
  "approved",
  "funded",
  "completed",
] as const;
const COMPLETED_TASK_STATUSES = new Set([
  "closed",
  "resolved",
  "done",
  "completed",
  "cancelled",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStatus(value: unknown) {
  return normalizeString(value).toLowerCase();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function canTransitionStatus(currentStatus: string, newStatus: string) {
  if (currentStatus === newStatus) return true;

  const currentIndex = ALLOWED_STATUS_SEQUENCE.indexOf(
    currentStatus as (typeof ALLOWED_STATUS_SEQUENCE)[number],
  );
  const nextIndex = ALLOWED_STATUS_SEQUENCE.indexOf(
    newStatus as (typeof ALLOWED_STATUS_SEQUENCE)[number],
  );

  if (nextIndex === -1) return false;
  if (currentIndex === -1) {
    return newStatus === "active" || newStatus === "reviewing";
  }

  return nextIndex === currentIndex + 1;
}

async function logIfNotDuplicate(
  supabase: any,
  deal_id: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const duplicatePayload = {
    action,
    from_status: payload.from_status ?? null,
    to_status: payload.to_status ?? null,
    from_stage: payload.from_stage ?? null,
    to_stage: payload.to_stage ?? null,
    reason: payload.reason ?? null,
    transition_source: payload.transition_source ?? "manual",
  };

  const { data: existing, error: existingError } = await supabase
    .from("ai_actions")
    .select("id")
    .eq("deal_id", deal_id)
    .eq("agent", STATUS_AGENT)
    .eq("action", action)
    .contains("payload", duplicatePayload)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    return false;
  }

  const { error } = await supabase.from("ai_actions").insert({
    deal_id,
    agent: STATUS_AGENT,
    action,
    payload: {
      ...duplicatePayload,
      ...payload,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

async function deriveAutoApprovedStatus(
  supabase: any,
  deal_id: string,
  currentStatus: string,
) {
  if (!["reviewing", "active"].includes(currentStatus)) {
    return null;
  }

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("deal_id", deal_id);

  if (error) {
    throw new Error(error.message);
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return null;
  }

  const hasOpenTasks = tasks.some((task) =>
    !COMPLETED_TASK_STATUSES.has(normalizeStatus(task.status))
  );

  return hasOpenTasks ? null : "approved";
}

serve(createAgentHandler({ agentName: "update-deal-stage", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Supabase environment variables not set" },
      500,
    );
  }

  try {
    const payload = await req.json() as RequestPayload;
    const deal_id = normalizeString(payload.deal_id);
    const new_stage = normalizeString(payload.new_stage);
    let new_status = normalizeStatus(payload.new_status);
    const transition_reason = normalizeString(payload.transition_reason) ||
      "manual update";
    const autoEvaluate = payload.auto_evaluate === true;

    if (!deal_id) {
      return jsonResponse({
        error: "Missing deal_id",
        received: payload,
      }, 400);
    }

    if (!isUuid(deal_id)) {
      return jsonResponse({
        error: "deal_id must be a valid UUID",
        received: payload,
      }, 400);
    }

    if (!new_stage && !new_status && !autoEvaluate) {
      return jsonResponse({
        error: "Provide new_stage, new_status, or auto_evaluate=true",
        received: payload,
      }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: existingDeal, error: fetchError } = await supabase
      .from("deals")
      .select("id, stage, status, updated_at")
      .eq("id", deal_id)
      .maybeSingle();

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    if (!existingDeal) {
      return jsonResponse({ error: "Deal not found", deal_id }, 404);
    }

    const currentStage = normalizeString(existingDeal.stage);
    const currentStatus = normalizeStatus(existingDeal.status) || "active";

    if (!new_status && autoEvaluate) {
      new_status =
        await deriveAutoApprovedStatus(supabase, deal_id, currentStatus) ??
          "";
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const warnings: string[] = [];
    let statusChanged = false;
    let stageChanged = false;

    if (new_status) {
      if (
        !ALLOWED_STATUS_SEQUENCE.includes(
          new_status as (typeof ALLOWED_STATUS_SEQUENCE)[number],
        )
      ) {
        return jsonResponse({
          error: "Unsupported new_status",
          allowed_statuses: ALLOWED_STATUS_SEQUENCE,
          received: payload,
        }, 400);
      }

      if (!canTransitionStatus(currentStatus, new_status)) {
        return jsonResponse({
          error:
            `Invalid status transition from ${currentStatus} to ${new_status}`,
          allowed_statuses: ALLOWED_STATUS_SEQUENCE,
          received: payload,
        }, 400);
      }

      if (currentStatus !== new_status) {
        updatePayload.status = new_status;
        statusChanged = true;
      }
    }

    if (new_stage && currentStage !== new_stage) {
      updatePayload.stage = new_stage;
      stageChanged = true;
    }

    if (!statusChanged && !stageChanged) {
      const dedupePayload: Record<string, unknown> = {
        from_status: currentStatus || null,
        to_status: new_status || currentStatus || null,
        from_stage: currentStage || null,
        to_stage: new_stage || currentStage || null,
        reason: transition_reason,
        transition_source: autoEvaluate ? "auto" : "manual",
        duplicate: true,
      };

      await logIfNotDuplicate(
        supabase,
        deal_id,
        "transition_deduplicated",
        dedupePayload,
      );

      return jsonResponse({
        success: true,
        skipped: true,
        reason: "Requested transition was already applied",
        updated_deal: existingDeal,
        warnings,
      });
    }

    const { data: updatedDeal, error: updateError } = await supabase
      .from("deals")
      .update(updatePayload)
      .eq("id", deal_id)
      .select()
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (statusChanged) {
      await logIfNotDuplicate(
        supabase,
        deal_id,
        "status_transition",
        {
          from_status: currentStatus,
          to_status: new_status,
          reason: transition_reason,
          transition_source: autoEvaluate ? "auto" : "manual",
        },
      );
    }

    if (stageChanged) {
      await logIfNotDuplicate(
        supabase,
        deal_id,
        "stage_updated",
        {
          from_stage: currentStage || null,
          to_stage: new_stage,
          reason: transition_reason,
          transition_source: autoEvaluate ? "auto" : "manual",
        },
      );
    }

    return jsonResponse({
      success: true,
      updated_deal: updatedDeal,
      changes: {
        status_changed: statusChanged,
        stage_changed: stageChanged,
      },
      warnings,
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));

