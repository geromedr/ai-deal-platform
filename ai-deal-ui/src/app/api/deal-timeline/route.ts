import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

type TimelineEvent = {
  id: string;
  deal_id: string;
  event_type?: string | null;
  title?: string | null;
  description?: string | null;
  agent?: string | null;
  action?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
};

type TimelineResponse = {
  success: boolean;
  timeline?: TimelineEvent[];
  error?: string;
};

export type { TimelineEvent, TimelineResponse };

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("deal_id");

  if (!dealId) {
    return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
  }

  try {
    const result = await callEdgeFunction<TimelineResponse>("get-deal-timeline", {
      deal_id: dealId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
