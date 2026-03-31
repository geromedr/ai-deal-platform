import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { type DealFeedItem } from "@/lib/api/getDealFeed";

type DealCardProps = {
  deal: DealFeedItem;
};

function formatLocation(deal: DealFeedItem) {
  const location = [deal.suburb, deal.state].filter(Boolean).join(", ");
  return location || "Location pending";
}

function getValueLabel(deal: DealFeedItem) {
  const score = deal.score ?? 0;
  const priorityScore = deal.priority_score ?? 0;

  if (score >= 85 || priorityScore >= 85) {
    return { label: "High Value", variant: "default" as const };
  }

  if (score >= 60 || priorityScore >= 60) {
    return { label: "Watchlist", variant: "secondary" as const };
  }

  return { label: "Needs Review", variant: "outline" as const };
}

export function DealCard({ deal }: DealCardProps) {
  const valueLabel = getValueLabel(deal);

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="text-lg font-semibold">
              {deal.summary || "No summary"}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant={valueLabel.variant}>{valueLabel.label}</Badge>
              {deal.asset_type ? <Badge variant="outline">{deal.asset_type}</Badge> : null}
              {deal.status ? <Badge variant="ghost">{deal.status}</Badge> : null}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>Score: {deal.score ?? "N/A"}</div>
            <div>Priority: {deal.priority_score ?? "N/A"}</div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em]">Location</div>
            <div className="mt-1 text-foreground">{formatLocation(deal)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em]">Source</div>
            <div className="mt-1 text-foreground">{deal.source_name || "Unknown"}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em]">Deal ID</div>
            <div className="mt-1 break-all text-foreground">{deal.deal_id}</div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t border-border/70 bg-muted/30">
        <span className="text-sm text-muted-foreground">
          Action hooks ready for workflow wiring.
        </span>
        <div className="flex flex-wrap gap-2">
          <Button size="sm">Approve</Button>
          <Button size="sm" variant="secondary">
            Allocate
          </Button>
          <Button size="sm" variant="ghost">
            View
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
