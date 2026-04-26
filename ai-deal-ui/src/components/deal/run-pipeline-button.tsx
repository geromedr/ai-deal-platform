"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Play, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RunPipelineResponse, PipelineStep } from "@/app/api/run-pipeline/route";

type Props = {
  dealId: string;
  address: string | null | undefined;
};

function StepRow({ step }: { step: PipelineStep }) {
  const icon =
    step.status === "done" ? (
      <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
    ) : step.status === "error" ? (
      <XCircle className="size-3.5 text-destructive shrink-0" />
    ) : (
      <Loader2 className="size-3.5 animate-spin text-muted-foreground shrink-0" />
    );

  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <span className="text-xs font-medium text-foreground">{step.name}</span>
        {step.message ? (
          <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 break-words">{step.message}</p>
        ) : null}
      </div>
    </div>
  );
}

export default function RunPipelineButton({ dealId, address }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunPipelineResponse | null>(null);
  const [expanded, setExpanded] = useState(true);

  async function handleRun() {
    if (!address) return;
    setRunning(true);
    setResult(null);
    setExpanded(true);

    try {
      const res = await fetch("/api/run-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId, address }),
      });
      const json = (await res.json()) as RunPipelineResponse;
      setResult(json);
    } catch (err) {
      setResult({
        success: false,
        deal_id: dealId,
        steps: [],
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRunning(false);
    }
  }

  const disabled = running || !address;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => void handleRun()}
        disabled={disabled}
        title={!address ? "No address on this deal — add one first" : undefined}
        className="gap-1.5"
      >
        {running ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        {running ? "Running pipeline…" : "Run Pipeline"}
      </Button>

      {(running || result) && (
        <div className="w-72 rounded-xl border border-border/70 bg-background/95 shadow-lg text-left">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>
              {running
                ? "Pipeline running…"
                : result?.success
                  ? "Pipeline complete"
                  : "Pipeline finished with errors"}
            </span>
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>

          {expanded && (
            <div className="border-t border-border/50 px-3 pb-3 pt-1 space-y-0.5">
              {running && !result && (
                <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin shrink-0" />
                  Contacting agents…
                </div>
              )}
              {result?.steps.map((step) => (
                <StepRow key={step.name} step={step} />
              ))}
              {result?.error && !result.steps.length && (
                <p className="text-xs text-destructive pt-1">{result.error}</p>
              )}
              {result && (
                <button
                  onClick={() => setResult(null)}
                  className="mt-2 text-[11px] text-muted-foreground hover:text-foreground underline"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
