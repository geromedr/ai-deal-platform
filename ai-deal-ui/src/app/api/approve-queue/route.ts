import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

type ApproveQueueRequest = {
  approval_id: string;
  decision: "approved" | "rejected";
  operator_note?: string;
};

type ApproveQueueResponse = {
  success: boolean;
  approval?: Record<string, unknown>;
  execution_result?: Record<string, unknown> | null;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ApproveQueueRequest;

    if (!body.approval_id || !body.decision) {
      return NextResponse.json(
        { error: "approval_id and decision are required" },
        { status: 400 },
      );
    }

    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be approved or rejected" },
        { status: 400 },
      );
    }

    const result = await callEdgeFunction<ApproveQueueResponse>(
      "approve-approval-queue",
      {
        approval_id: body.approval_id,
        decision: body.decision,
        ...(body.operator_note ? { operator_note: body.operator_note } : {}),
      },
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
