import { NextRequest, NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/api/callEdgeFunction";
import { supabase } from "@/lib/supabase";

export type PipelineStep = {
  name: string;
  status: "pending" | "running" | "done" | "error";
  message?: string;
  durationMs?: number;
};

export type RunPipelineRequest = {
  deal_id: string;
  address: string;
};

export type RunPipelineResponse = {
  success: boolean;
  deal_id: string;
  steps: PipelineStep[];
  error?: string;
};

type StepResult = {
  name: string;
  durationMs: number;
  error?: string;
};

async function runStep(
  name: string,
  fn: () => Promise<unknown>,
): Promise<StepResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, durationMs: Date.now() - start };
  } catch (err) {
    return {
      name,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunPipelineRequest;
    const dealId = body.deal_id?.trim();
    const address = body.address?.trim();

    if (!dealId || !address) {
      return NextResponse.json(
        { success: false, error: "deal_id and address are required" },
        { status: 400 },
      );
    }

    const results: StepResult[] = [];

    // Step 1: Site Intelligence (orchestrates zoning, yield, financial, parcel ranking)
    results.push(
      await runStep("site-intelligence-agent", () =>
        callEdgeFunction("site-intelligence-agent", {
          deal_id: dealId,
          address,
        }),
      ),
    );

    // Step 2: Deal Report (only run if site intelligence succeeded)
    if (!results[0].error) {
      results.push(
        await runStep("deal-report-agent", () =>
          callEdgeFunction("deal-report-agent", {
            deal_id: dealId,
          }),
        ),
      );
    }

    // Step 3: Notification agent (best-effort — don't fail pipeline if this errors)
    // Requires deal_feed_id + trigger_event + summary, which come from the deal_feed
    // table written by rule-engine-agent. Look them up before calling.
    {
      const { data: feedRow } = await supabase
        .from("deal_feed")
        .select("id, trigger_event, summary, score, priority_score")
        .eq("deal_id", dealId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!feedRow?.id) {
        results.push({
          name: "notification-agent",
          durationMs: 0,
          error: "Skipped — no deal_feed row found for this deal (run rule-engine-agent first, or trigger a pipeline that populates deal_feed)",
        });
      } else {
        results.push(
          await runStep("notification-agent", () =>
            callEdgeFunction("notification-agent", {
              deal_id: dealId,
              deal_feed_id: feedRow.id,
              trigger_event: feedRow.trigger_event ?? "manual_pipeline_run",
              summary: feedRow.summary ?? "Pipeline triggered manually from Ops dashboard.",
              score: feedRow.score ?? null,
              priority_score: feedRow.priority_score ?? null,
            }),
          ),
        );
      }
    }

    const steps: PipelineStep[] = results.map((r) => ({
      name: r.name,
      status: r.error ? "error" : "done",
      message: r.error ?? `Completed in ${r.durationMs}ms`,
      durationMs: r.durationMs,
    }));

    const anyFailed = results.some((r) => r.error);

    return NextResponse.json({
      success: !anyFailed,
      deal_id: dealId,
      steps,
    } satisfies RunPipelineResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message, steps: [] },
      { status: 500 },
    );
  }
}
