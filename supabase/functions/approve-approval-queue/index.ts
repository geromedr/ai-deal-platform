import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type ApprovalPayload = {
  approval_id?: string;
  decision?: "approved" | "rejected";
  operator_note?: string;
};

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

serve(createAgentHandler({
  agentName: "approve-approval-queue",
  requiredFields: [
    { name: "approval_id", type: "string", uuid: true },
    { name: "decision", type: "string" },
  ],
}, async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  try {
    const authorizationHeader = req.headers.get("Authorization");
    const payload = await req.json() as ApprovalPayload;
    const approvalId = typeof payload.approval_id === "string" ? payload.approval_id.trim() : "";
    const decision = typeof payload.decision === "string" ? payload.decision.trim().toLowerCase() : "";
    const operatorNote = typeof payload.operator_note === "string" && payload.operator_note.trim().length > 0
      ? payload.operator_note.trim()
      : null;

    if (!isUuid(approvalId)) {
      return jsonResponse({ error: "approval_id must be a valid UUID" }, 400);
    }

    if (decision !== "approved" && decision !== "rejected") {
      return jsonResponse({ error: "decision must be approved or rejected" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: approvalRow, error: approvalError } = await supabase
      .from("approval_queue")
      .select("id, deal_id, approval_type, status, requested_by_agent, payload, dedupe_key")
      .eq("id", approvalId)
      .maybeSingle();

    if (approvalError) throw new Error(approvalError.message);
    if (!approvalRow) return jsonResponse({ error: "Approval request not found" }, 404);
    if (approvalRow.status !== "pending") {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: `Approval request already ${approvalRow.status}`,
        approval: approvalRow,
      });
    }

    let executionResult: Record<string, unknown> | null = null;
    let finalStatus = decision;

    if (decision === "approved") {
      const actionPayload = isRecord(approvalRow.payload) ? approvalRow.payload : {};
      const actionName = typeof actionPayload.action === "string" ? actionPayload.action : null;
      const downstreamPayload = isRecord(actionPayload.action_payload)
        ? actionPayload.action_payload
        : {};

      if (!actionName) {
        finalStatus = "failed";
        executionResult = {
          success: false,
          error: "Approval payload missing action",
        };
      } else {
        const response = await fetch(`${supabaseUrl}/functions/v1/${actionName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authorizationHeader?.trim().length
              ? authorizationHeader
              : `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify(downstreamPayload),
        });

        const responseText = await response.text();
        let responseBody: unknown = null;
        try {
          responseBody = responseText ? JSON.parse(responseText) : null;
        } catch {
          responseBody = responseText;
        }

        executionResult = {
          success: response.ok,
          status: response.status,
          action: actionName,
          data: responseBody,
        };
        finalStatus = response.ok ? "executed" : "failed";
      }
    }

    const nextPayload = {
      ...(isRecord(approvalRow.payload) ? approvalRow.payload : {}),
      operator_note: operatorNote,
      reviewed_at: new Date().toISOString(),
      decision,
      execution_result: executionResult,
    };

    const { data: updatedApproval, error: updateError } = await supabase
      .from("approval_queue")
      .update({
        status: finalStatus,
        payload: nextPayload,
      })
      .eq("id", approvalId)
      .select("id, deal_id, approval_type, status, requested_by_agent, payload, created_at, updated_at")
      .single();

    if (updateError) throw new Error(updateError.message);

    const { error: logError } = await supabase.from("ai_actions").insert({
      deal_id: updatedApproval.deal_id,
      agent: "approve-approval-queue",
      action: "approval_queue_reviewed",
      payload: {
        approval_id: approvalId,
        approval_type: updatedApproval.approval_type,
        decision,
        final_status: finalStatus,
        operator_note: operatorNote,
        execution_result: executionResult,
      },
    });

    if (logError) throw new Error(logError.message);

    return jsonResponse({
      success: finalStatus !== "failed",
      approval: updatedApproval,
      execution_result: executionResult,
    }, finalStatus === "failed" ? 500 : 200);
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
