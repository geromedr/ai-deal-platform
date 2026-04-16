import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";
import type { InvestorActionsResponse } from "@/lib/api/getInvestorMatches";

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("deal_id");

  if (!dealId) {
    return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
  }

  try {
    const result = await callEdgeFunction<InvestorActionsResponse>(
      "investor-actions",
      { deal_id: dealId, suggest_only: true },
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
