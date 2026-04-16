"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileText, Loader2, RefreshCcw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportsListResponse, ReportItem } from "@/app/api/deal-reports/route";

type DealReportsProps = {
  dealId: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function sentenceCase(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function reportTypeBadge(reportType: string | null | undefined) {
  const t = (reportType ?? "").toLowerCase();
  if (t === "deal_report") return "default";
  if (t === "deal_pack") return "secondary";
  return "outline";
}

function ReportRow({ report }: { report: ReportItem }) {
  const [expanded, setExpanded] = useState(false);
  const title = report.summary ?? sentenceCase(report.report_type);
  const hasContent = report.content && Object.keys(report.content).length > 0;

  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground text-sm">{title}</p>
          {report.source_agent ? (
            <p className="text-xs text-muted-foreground">Agent: {report.source_agent}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant={reportTypeBadge(report.report_type)}>
            {sentenceCase(report.report_type)}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatDateTime(report.created_at)}</span>
        </div>
      </div>

      {hasContent ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      ) : null}

      {expanded && report.content ? (
        <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {JSON.stringify(report.content, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function DealReports({ dealId }: DealReportsProps) {
  const [data, setData] = useState<ReportsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/deal-reports?deal_id=${encodeURIComponent(dealId)}`)
      .then(async (res) => {
        const json = (await res.json()) as ReportsListResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
        return json;
      })
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load reports"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [dealId]);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateMessage(null);
    try {
      const res = await fetch("/api/deal-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: dealId }),
      });
      const json = (await res.json()) as { message?: string; error?: string };
      if (json.error) throw new Error(json.error);
      setGenerateMessage(json.message ?? "Report generation triggered.");
      // Reload list after short delay
      setTimeout(() => load(), 2500);
    } catch (err) {
      setGenerateMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setGenerating(false);
    }
  }

  const reports = data?.items ?? [];

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              Deal Reports
            </CardTitle>
            <CardDescription>
              Investment reports and deal packs generated by agents.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => load()}
              disabled={loading}
            >
              <RefreshCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => void handleGenerate()}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              {generating ? "Generating…" : "Generate report"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {generateMessage ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            generateMessage.startsWith("Error")
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-green-200 bg-green-50/60 text-green-800"
          }`}>
            {generateMessage}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading reports…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
            No reports found for this deal. Use the Generate button to create an investment report.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <ReportRow key={report.id} report={report} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
