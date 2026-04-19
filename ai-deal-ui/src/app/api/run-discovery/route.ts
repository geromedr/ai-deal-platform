import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";

export type RunDiscoveryRequest = {
  suburbs: string[];
  min_land_area?: number;
};

export type DiscoverySuburbResult = {
  suburb: string;
  candidate_count: number;
};

export type RunDiscoveryResponse = {
  success: boolean;
  discovered: DiscoverySuburbResult[];
  total_candidates: number;
  error?: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunDiscoveryRequest;
    const suburbs = (body.suburbs ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const minLandArea = typeof body.min_land_area === "number"
      ? body.min_land_area
      : 600;

    if (suburbs.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one suburb is required" },
        { status: 400 },
      );
    }

    const result = await callEdgeFunction<{
      success: boolean;
      discovered: DiscoverySuburbResult[];
      error?: string;
    }>("domain-discovery-agent", {
      suburbs,
      minLandArea,
    });

    const discovered = result.discovered ?? [];
    const total = discovered.reduce((sum, r) => sum + (r.candidate_count ?? 0), 0);

    return NextResponse.json({
      success: result.success ?? true,
      discovered,
      total_candidates: total,
      ...(result.error ? { error: result.error } : {}),
    } satisfies RunDiscoveryResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message, discovered: [], total_candidates: 0 },
      { status: 500 },
    );
  }
}
