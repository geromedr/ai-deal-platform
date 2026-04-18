"use client";

import { useEffect, useState } from "react";
import { Users, TrendingUp, AlertCircle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrencyShort, sentenceCase } from "@/lib/utils/format";
import type { InvestorActionsResponse } from "@/lib/api/getInvestorMatches";

type InvestorPanelProps = {
  dealId: string;
};

function bandVariant(band: string | null): "default" | "secondary" | "outline" | "destructive" {
  if (!band) return "outline";
  const b = band.toLowerCase();
  if (b === "high") return "default";
  if (b === "medium") return "secondary";
  return "outline";
}

function pipelineVariant(status: string | null): "default" | "secondary" | "outline" | "destructive" {
  if (!status) return "outline";
  const s = status.toLowerCase();
  if (s === "interested" || s === "negotiating") return "default";
  if (s === "contacted") return "secondary";
  return "outline";
}

export default function InvestorPanel({ dealId }: InvestorPanelProps) {
  const [data, setData] = useState<InvestorActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/investor-matches?deal_id=${encodeURIComponent(dealId)}`)
      .then(async (res) => {
        const json = (await res.json()) as InvestorActionsResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
        return json;
      })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load investor data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dealId]);

  const actions = data?.suggested_actions ?? [];
  const matches = data?.matches ?? [];

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          Investor Matches
        </CardTitle>
        <CardDescription>
          Suggested investor contacts and pipeline status for this deal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading investor data…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : actions.length === 0 && matches.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
            No investor matches found for this deal. Run the investor-actions agent to generate suggestions.
          </div>
        ) : null}

        {/* Suggested actions */}
        {!loading && !error && actions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Suggested Actions
            </p>
            <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-background/70">
              {actions.map((action) => (
                <div
                  key={action.investor_id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-4"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">
                      {action.investor_name ?? "Unknown investor"}
                    </p>
                    <p className="text-sm text-muted-foreground">{action.reason}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Badge variant={bandVariant(action.match_band)}>
                      {sentenceCase(action.match_band)} match
                    </Badge>
                    {action.pipeline_status ? (
                      <Badge variant={pipelineVariant(action.pipeline_status)}>
                        {sentenceCase(action.pipeline_status)}
                      </Badge>
                    ) : null}
                    {action.match_score != null ? (
                      <span className="text-xs text-muted-foreground self-center">
                        Score: {action.match_score}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Match detail cards */}
        {!loading && !error && matches.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Matched Investors
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {matches.map((match) => {
                const inv = match.investor;
                return (
                  <div
                    key={match.investor_id}
                    className="rounded-2xl border border-border/70 bg-background/70 p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-foreground">
                        {inv?.name ?? "Unknown"}
                      </p>
                      <Badge variant={bandVariant(match.match_band)}>
                        {sentenceCase(match.match_band)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {inv?.email ? <span className="col-span-2 truncate">{inv.email}</span> : null}
                      {inv?.preferred_strategy ? (
                        <span>Strategy: {sentenceCase(inv.preferred_strategy)}</span>
                      ) : null}
                      {inv?.min_investment != null || inv?.max_investment != null ? (
                        <span>
                          {formatCurrencyShort(inv?.min_investment)} – {formatCurrencyShort(inv?.max_investment)}
                        </span>
                      ) : null}
                    </div>
                    {inv?.pipeline_status ? (
                      <Badge variant={pipelineVariant(inv.pipeline_status)} className="text-xs">
                        Pipeline: {sentenceCase(inv.pipeline_status)}
                      </Badge>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Summary stat */}
        {!loading && !error && (actions.length > 0 || matches.length > 0) ? (
          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <TrendingUp className="size-3.5 shrink-0" />
            <span>
              {actions.length > 0
                ? `${actions.length} action suggestion${actions.length === 1 ? "" : "s"}`
                : `${matches.length} match${matches.length === 1 ? "" : "es"}`}
              {" · "}
              <span className="text-foreground">
                {actions.filter((a) => a.match_band?.toLowerCase() === "high").length} high-band
              </span>
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
