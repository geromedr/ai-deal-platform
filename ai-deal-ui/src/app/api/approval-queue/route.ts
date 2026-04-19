import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export type ApprovalQueueItem = {
  id: string;
  deal_id: string;
  approval_type: string;
  status: string;
  requested_by_agent: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
};

export type ApprovalQueueListResponse = {
  items: ApprovalQueueItem[];
  total: number;
};

// GET /api/approval-queue?deal_id=X&approval_type=outbound_email&status=pending
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dealId = searchParams.get("deal_id")?.trim();
  const approvalType = searchParams.get("approval_type")?.trim() ?? null;
  const status = searchParams.get("status")?.trim() ?? "pending";

  if (!dealId) {
    return NextResponse.json(
      { error: "deal_id is required" },
      { status: 400 },
    );
  }

  let query = supabase
    .from("approval_queue")
    .select("id, deal_id, approval_type, status, requested_by_agent, payload, dedupe_key, created_at, updated_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }
  if (approvalType) {
    query = query.eq("approval_type", approvalType);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = (data ?? []) as ApprovalQueueItem[];
  return NextResponse.json({ items, total: items.length } satisfies ApprovalQueueListResponse);
}

// PATCH /api/approval-queue — update payload for an approval (e.g. edited email content)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      approval_id: string;
      payload_patch: Record<string, unknown>;
    };

    const approvalId = body.approval_id?.trim();
    const patch = body.payload_patch;

    if (!approvalId || !patch || typeof patch !== "object") {
      return NextResponse.json(
        { error: "approval_id and payload_patch are required" },
        { status: 400 },
      );
    }

    // Fetch current payload
    const { data: current, error: fetchError } = await supabase
      .from("approval_queue")
      .select("id, status, payload")
      .eq("id", approvalId)
      .maybeSingle();

    if (fetchError) throw new Error(fetchError.message);
    if (!current) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    if (current.status !== "pending") {
      return NextResponse.json(
        { error: `Cannot edit a ${current.status} approval` },
        { status: 409 },
      );
    }

    const currentPayload = (typeof current.payload === "object" && current.payload !== null)
      ? (current.payload as Record<string, unknown>)
      : {};

    // Deep-merge action_payload if provided
    const mergedPayload: Record<string, unknown> = { ...currentPayload, ...patch };
    if (
      patch.action_payload &&
      typeof patch.action_payload === "object" &&
      typeof currentPayload.action_payload === "object"
    ) {
      mergedPayload.action_payload = {
        ...(currentPayload.action_payload as Record<string, unknown>),
        ...(patch.action_payload as Record<string, unknown>),
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from("approval_queue")
      .update({ payload: mergedPayload })
      .eq("id", approvalId)
      .select("id, deal_id, approval_type, status, requested_by_agent, payload, dedupe_key, created_at, updated_at")
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ success: true, approval: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
