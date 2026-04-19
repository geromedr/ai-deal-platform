"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTimeShort, sentenceCase } from "@/lib/utils/format";
import type { TimelineResponse, TimelineEvent } from "@/app/api/deal-timeline/route";

type DealTimelineProps = {
  dealId: string;
};

function eventTypeColor(eventType: string | null | undefined): string {
  if (!eventType) return "bg-border/70";
  const t = eventType.toLowerCase();
  if (t.includes("decision") || t.includes("buy")) return "bg-green-500";
  if (t.includes("risk") || t.includes("alert") || t.includes("warn")) return "bg-amber-500";
  if (t.includes("report") || t.includes("analysis")) return "bg-primary";
  if (t.includes("task")) return "bg-blue-500";
  if (t.includes("investor") || t.includes("capital")) return "bg-purple-500";
  return "bg-muted-foreground/50";
}

function EventRow({ event, isLast }: { event: TimelineEvent; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = event.description || (event.content && Object.keys(event.content).length > 0);
  const title = event.title ?? sentenceCase(event.action ?? event.event_type ?? "Event");
  const subtitle = event.agent ?? sentenceCase(event.event_type);

  return (
    <div className="relative flex gap-4 pb-0">
      {/* Timeline spine */}
      <div className="flex flex-col items-center">
        <div className={`mt-1.5 size-2.5 shrink-0 rounded-full ${eventTypeColor(event.event_type ?? event.action)}`} />
        {!isLast && <div className="mt-1.5 w-px flex-1 bg-border/60" />}
      </div>

      {/* Content */}
      <div className={`pb-5 min-w-0 flex-1 ${isLast ? "pb-0" : ""}`}>
        <button
          className={`w-full text-left ${hasContent ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => hasContent && setExpanded((v) => !v)}
          disabled={!hasContent}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium text-foreground text-sm">{title}</p>
            <span className="text-xs text-muted-foreground shrink-0">
              {formatDateTimeShort(event.created_at)}
            </span>
          </div>
          {subtitle && subtitle !== title ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </button>

        {expanded && event.description ? (
          <p className="mt-2 rounded-xl border border-border/70 bg-background/70 p-3 text-xs text-muted-foreground leading-5">
            {event.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function DealTimeline({ dealId }: DealTimelineProps) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/deal-timeline?deal_id=${encodeURIComponent(dealId)}`)
      .then(async (res) => {
        const json = await res
          .json()
          .catch(() => { throw new Error(`Request failed (${res.status})`); }) as TimelineResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
        return json;
      })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load timeline"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [dealId]);

  const events = data?.timeline ?? [];

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          Activity Timeline
        </CardTitle>
        <CardDescription>
          Chronological record of agent actions and deal events.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading timeline…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
            No activity events have been recorded for this deal yet.
          </div>
        ) : (
          <div className="pt-1">
            {events.map((event, i) => (
              <EventRow key={event.id ?? i} event={event} isLast={i === events.length - 1} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
