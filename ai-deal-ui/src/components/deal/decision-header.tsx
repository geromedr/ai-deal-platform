"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { submitDecision, type DealDecision } from "@/lib/api/submitDecision";
import { cn } from "@/lib/utils";

type DecisionHeaderProps = {
  dealId: string;
  score: number;
  confidence: number | null;
};

function getScoreTone(score: number) {
  if (score >= 80) {
    return {
      text: "text-emerald-700",
      panel: "border-emerald-200/80 bg-emerald-50/80",
    };
  }

  if (score >= 50) {
    return {
      text: "text-amber-700",
      panel: "border-amber-200/80 bg-amber-50/80",
    };
  }

  return {
    text: "text-rose-700",
    panel: "border-rose-200/80 bg-rose-50/80",
  };
}

function formatScore(score: number) {
  return new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: score % 1 === 0 ? 0 : 1,
  }).format(score);
}

function formatConfidence(confidence: number | null) {
  if (confidence === null || !Number.isFinite(confidence)) {
    return "Not available";
  }

  const normalized = confidence <= 1 ? confidence * 100 : confidence;

  return `${normalized.toFixed(normalized % 1 === 0 ? 0 : 1)}%`;
}

export default function DecisionHeader({
  dealId,
  score,
  confidence,
}: DecisionHeaderProps) {
  const scoreTone = getScoreTone(score);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleDecision(decision: DealDecision) {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await submitDecision({
        deal_id: dealId,
        decision,
      });

      console.log("Decision submitted successfully", result);
    } catch (error) {
      console.error("Failed to submit decision", {
        dealId,
        decision,
        error,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-border/70 bg-[linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)]">
      <div className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Score
            </p>
            <div
              className={cn(
                "mt-3 inline-flex rounded-2xl border px-5 py-4",
                scoreTone.panel,
              )}
            >
              <span className={cn("text-5xl font-bold tracking-tight sm:text-6xl", scoreTone.text)}>
                {formatScore(score)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Confidence
            </p>
            <p className="text-lg font-medium text-foreground">
              {formatConfidence(confidence)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            className="h-12 px-6 text-base font-semibold text-white hover:bg-emerald-700"
            disabled={isSubmitting}
            onClick={() => void handleDecision("BUY")}
            style={{ backgroundColor: "rgb(22 163 74)" }}
          >
            BUY
          </Button>
          <Button
            className="h-12 px-6 text-base font-semibold text-slate-950 hover:bg-amber-400"
            disabled={isSubmitting}
            onClick={() => void handleDecision("REVIEW")}
            style={{ backgroundColor: "rgb(250 204 21)" }}
          >
            REVIEW
          </Button>
          <Button
            className="h-12 px-6 text-base font-semibold text-white hover:bg-rose-700"
            disabled={isSubmitting}
            onClick={() => void handleDecision("PASS")}
            style={{ backgroundColor: "rgb(220 38 38)" }}
          >
            PASS
          </Button>
        </div>
      </div>
    </section>
  );
}
