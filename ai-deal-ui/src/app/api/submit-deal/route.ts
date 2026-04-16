import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

export type SubmitDealRequest = {
  address: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  property_type?: string;
  price_text?: string;
  land_area?: number;
  url?: string;
  notes?: string;
};

export type SubmitDealResponse = {
  success: boolean;
  deal_id?: string;
  address?: string;
  message?: string;
  warnings?: string[];
  error?: string;
};

type SiteDiscoveryResult = {
  success?: boolean;
  results?: Array<{
    address?: string;
    deal_id?: string;
    warnings?: string[];
    error?: string;
  }>;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SubmitDealRequest;

    const address = body.address?.trim();
    if (!address) {
      return NextResponse.json(
        { error: "address is required" },
        { status: 400 },
      );
    }

    // site-discovery-agent expects a candidates[] array
    const candidate: Record<string, unknown> = {
      source: "manual_intake",
      external_id: `manual-${Date.now()}`,
      address,
    };

    if (body.suburb) candidate.suburb = body.suburb;
    if (body.state) candidate.state = body.state;
    if (body.postcode) candidate.postcode = body.postcode;
    if (body.property_type) candidate.property_type = body.property_type;
    if (body.price_text) candidate.price_text = body.price_text;
    if (body.land_area) candidate.land_area = body.land_area;
    if (body.url) candidate.url = body.url;
    if (body.notes) {
      candidate.raw_data = { notes: body.notes };
    }

    const result = await callEdgeFunction<SiteDiscoveryResult>(
      "site-discovery-agent",
      { candidates: [candidate] },
    );

    const first = result.results?.[0];
    if (!first) {
      return NextResponse.json({
        success: false,
        error: result.error ?? "No result returned from site-discovery-agent",
      } satisfies SubmitDealResponse);
    }

    if (first.error) {
      return NextResponse.json({
        success: false,
        error: first.error,
      } satisfies SubmitDealResponse, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      deal_id: first.deal_id,
      address: first.address ?? address,
      message: "Deal submitted and pipeline triggered.",
      warnings: first.warnings ?? [],
    } satisfies SubmitDealResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message } satisfies SubmitDealResponse,
      { status: 500 },
    );
  }
}
