import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

type ReportItem = {
  id: string;
  deal_id?: string | null;
  report_type?: string | null;
  source_agent?: string | null;
  source_action?: string | null;
  created_at?: string | null;
  summary?: string | null;
  content?: Record<string, unknown>;
};

type ReportsListResponse = {
  success: boolean;
  items?: ReportItem[];
  limit?: number;
  error?: string;
};

type GenerateReportResponse = {
  success: boolean;
  report_id?: string;
  message?: string;
  error?: string;
};

export type { ReportItem, ReportsListResponse, GenerateReportResponse };

export async function GET(req: NextRequest) {
  const dealId = req.nextUrl.searchParams.get("deal_id");
  const reportType = req.nextUrl.searchParams.get("report_type");

  try {
    const body: Record<string, unknown> = { limit: 20 };
    if (dealId) body.deal_id = dealId;
    if (reportType) body.report_type = reportType;

    const result = await callEdgeFunction<ReportsListResponse>("get-deal-reports", body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { deal_id?: string };
    const dealId = body.deal_id?.trim();

    if (!dealId) {
      return NextResponse.json({ error: "deal_id is required" }, { status: 400 });
    }

    const result = await callEdgeFunction<GenerateReportResponse>("deal-report-agent", {
      deal_id: dealId,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
