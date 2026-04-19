"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { type DealFeedItem } from "@/lib/api/getDealFeed";
import { sentenceCase } from "@/lib/utils/format";
import { SCORE_THRESHOLDS } from "@/lib/constants/scoring";

type DealCardProps = {
  deal: DealFeedItem;
  filter?: string;
  allIds?: string[];
  index?: number;
};

function formatLocation(deal: DealFeedItem) {
  const parts = [deal.suburb, deal.state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : deal.address ?? "Location pending";
}

function getTitle(deal: DealFeedItem) {
  return deal.deal_name || deal.address || deal.summary || "Untitled deal";
}

function getScoreBadge(deal: DealFeedItem) {
  const score = deal.score ?? 0;
  const priorityScore = deal.priority_score ?? 0;
  if (score >= SCORE_THRESHOLDS.HIGH || priorityScore >= SCORE_THRESHOLDS.HIGH) return { label: "High Value", variant: "default" as const };
  if (score >= SCORE_THRESHOLDS.MEDIUM || priorityScore >= SCORE_THRESHOLDS.MEDIUM) return { label: "Watchlist", variant: "secondary" as const };
  return { label: "Needs Review", variant: "outline" as const };
}

function buildDealUrl(dealId: string, filter: string, allIds: string[], index: number) {
  const params = new URLSearchParams();
  params.set("filter", filter);
  params.set("i", String(index));
  params.set("ids", allIds.join(","));
  return `/deal/${dealId}?${params.toString()}`;
}

export function DealCard({ deal, filter = "all", allIds = [], index = 0 }: DealCardProps) {
  const router = useRouter();
  const scoreBadge = getScoreBadge(deal);
  const title = getTitle(deal);
  const url = buildDealUrl(deal.deal_id, filter, allIds, index);

  // Only show summary in body if it adds something not already in the title
  const showSummary =
    deal.summary &&
    deal.summary !== title &&
    deal.summary !== deal.address;

  return (
    <Card
      className="cursor-pointer border-border/70 bg-card/95 shadow-sm transition hover:shadow-lg"
      onClick={() => router.push(url)}
    >
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="text-lg font-semibold">{title}</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant={scoreBadge.variant}>{scoreBadge.label}</Badge>
              {deal.strategy ? (
                <Badge variant="outline">{sentenceCase(deal.strategy)}</Badge>
              ) : null}
              {deal.stage ? (
                <Badge variant="ghost">{sentenceCase(deal.stage)}</Badge>
              ) : null}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>Score: {deal.score ?? "—"}</div>
            <div>Priority: {deal.priority_score ?? "—"}</div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {showSummary ? (
          <p className="text-sm text-muted-foreground">{deal.summary}</p>
        ) : null}
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Location</div>
            <div className="mt-1 text-foreground">{formatLocation(deal)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Strategy</div>
            <div className="mt-1 text-foreground">{sentenceCase(deal.strategy) ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Stage</div>
            <div className="mt-1 text-foreground">{sentenceCase(deal.stage) ?? "—"}</div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="justify-between gap-2 border-t border-border/70 bg-muted/30">
        <span className="font-mono text-xs text-muted-foreground">
          {deal.deal_id.slice(0, 8)}…
        </span>
        <Button
          size="sm"
          onClick={(e) => { e.stopPropagation(); router.push(url); }}
        >
          Open
        </Button>
      </CardFooter>
    </Card>
  );
}
