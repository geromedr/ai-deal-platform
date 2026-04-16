import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";
import type { OperatorSummary, UsageSummary } from "@/lib/api/getOperatorSummary";

export type OpsSummaryResponse = {
  operator: OperatorSummary;
  usage: UsageSummary;
  approvalQueue: Array<{
    id: string;
    deal_id: string | null;
    approval_type: string | null;
    status: string;
    requested_by_agent: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>;
  error?: string;
};

export async function GET() {
  try {
    // Call operator summary and usage summary in parallel via server-side fetch
    const [operator, usage] = await Promise.all([
      callEdgeFunction<OperatorSummary>("get-operator-summary", {}),
      callEdgeFunction<UsageSummary>("get-usage-summary", {}),
    ]);

    // Approval queue is read directly via Supabase REST since there's no dedicated list endpoint
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    let approvalQueue: OpsSummaryResponse["approvalQueue"] = [];
    if (supabaseUrl && anonKey) {
      const queueRes = await fetch(
        `${supabaseUrl}/rest/v1/approval_queue?status=eq.pending&order=created_at.desc&limit=50`,
        {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (queueRes.ok) {
        approvalQueue = (await queueRes.json()) as OpsSummaryResponse["approvalQueue"];
      }
    }

    return NextResponse.json({ operator, usage, approvalQueue } satisfies OpsSummaryResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
