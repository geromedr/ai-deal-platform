"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Play,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { OpsSummaryResponse } from "@/app/api/ops-summary/route";
import type { RunPipelineResponse, PipelineStep } from "@/app/api/run-pipeline/route";
import type { RunDiscoveryResponse, DiscoverySuburbResult } from "@/app/api/run-discovery/route";
import { sentenceCase as sharedSentenceCase, formatDateTime as sharedFormatDateTime } from "@/lib/utils/format";

// ─── helpers ────────────────────────────────────────────────────────────────

const sentenceCase = sharedSentenceCase;
const formatDateTime = (v: unknown) => sharedFormatDateTime(typeof v === "string" ? v : null);

function healthVariant(status: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (status === "healthy") return "default";
  if (status === "warning") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

function healthIcon(status: string | null) {
  if (status === "healthy") return <CheckCircle2 className="size-4 text-green-600" />;
  if (status === "warning") return <AlertTriangle className="size-4 text-amber-500" />;
  if (status === "error") return <AlertCircle className="size-4 text-destructive" />;
  return <Clock className="size-4 text-muted-foreground" />;
}

// ─── Approval queue row ──────────────────────────────────────────────────────

type ApprovalRow = OpsSummaryResponse["approvalQueue"][number];

function ApprovalQueueRow({
  item,
  onDecision,
  processing,
}: {
  item: ApprovalRow;
  onDecision: (id: string, decision: "approved" | "rejected", note?: string) => Promise<void>;
  processing: boolean;
}) {
  const [note, setNote] = useState("");
  const actionName =
    item.payload &&
    typeof item.payload.action === "string"
      ? item.payload.action
      : null;

  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 min-w-0">
          <p className="font-medium text-foreground">{sentenceCase(item.approval_type)}</p>
          <p className="text-xs text-muted-foreground font-mono">{item.id.slice(0, 8)}…</p>
          {item.deal_id ? (
            <Link
              href={`/deal/${item.deal_id}`}
              className="text-xs text-primary hover:underline"
            >
              View deal →
            </Link>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 shrink-0">
          <Badge variant="secondary">{sentenceCase(item.status)}</Badge>
          {item.requested_by_agent ? (
            <Badge variant="outline">{sentenceCase(item.requested_by_agent)}</Badge>
          ) : null}
        </div>
      </div>

      {actionName ? (
        <p className="text-xs text-muted-foreground">
          Action: <span className="font-mono">{actionName}</span>
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">Requested {formatDateTime(item.created_at)}</p>

      <div className="flex items-end gap-2">
        <input
          type="text"
          placeholder="Operator note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={processing}
          className="flex-1 rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <Button
          size="sm"
          disabled={processing}
          onClick={() => void onDecision(item.id, "approved", note || undefined)}
          className="shrink-0 text-xs"
        >
          {processing ? <Loader2 className="size-3 animate-spin" /> : null}
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={processing}
          onClick={() => void onDecision(item.id, "rejected", note || undefined)}
          className="shrink-0 text-xs"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function OpsPage() {
  const [data, setData] = useState<OpsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Discovery runner state
  const [discoverySuburbs, setDiscoverySuburbs] = useState("Surry Hills, Newtown, Marrickville");
  const [discoveryMinLand, setDiscoveryMinLand] = useState("600");
  const [discoveryRunning, setDiscoveryRunning] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<RunDiscoveryResponse | null>(null);

  // Pipeline runner state
  const [pipelineDealId, setPipelineDealId] = useState("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  const [pipelineAddress, setPipelineAddress] = useState("247 Geelong Road, Sunshine West VIC 3020");
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<RunPipelineResponse | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ops-summary");
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = (await res.json()) as OpsSummaryResponse;
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ops data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDecision(
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string,
  ) {
    setProcessingId(approvalId);
    try {
      const res = await fetch("/api/approve-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approval_id: approvalId, decision, operator_note: note }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Request failed");
      setToastMsg(`Approval ${decision === "approved" ? "approved ✓" : "rejected"}`);
      setTimeout(() => setToastMsg(null), 3000);
      await load();
    } catch (err) {
      setToastMsg(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      setTimeout(() => setToastMsg(null), 4000);
    } finally {
      setProcessingId(null);
    }
  }

  async function handleRunDiscovery() {
    const suburbs = discoverySuburbs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (suburbs.length === 0) return;
    setDiscoveryRunning(true);
    setDiscoveryResult(null);
    try {
      const res = await fetch("/api/run-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suburbs,
          min_land_area: parseInt(discoveryMinLand, 10) || 600,
        }),
      });
      const json = (await res.json()) as RunDiscoveryResponse;
      setDiscoveryResult(json);
      if (json.success && json.total_candidates > 0) {
        setToastMsg(`Discovery found ${json.total_candidates} candidate${json.total_candidates === 1 ? "" : "s"} ✓`);
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (err) {
      setDiscoveryResult({
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
        discovered: [],
        total_candidates: 0,
      });
    } finally {
      setDiscoveryRunning(false);
    }
  }

  async function handleRunPipeline() {
    setPipelineRunning(true);
    setPipelineResult(null);
    try {
      const res = await fetch("/api/run-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_id: pipelineDealId.trim(), address: pipelineAddress.trim() }),
      });
      const json = (await res.json()) as RunPipelineResponse;
      setPipelineResult(json);
      if (json.success) {
        setToastMsg("Pipeline completed ✓");
        setTimeout(() => setToastMsg(null), 4000);
      }
    } catch (err) {
      setPipelineResult({
        success: false,
        deal_id: pipelineDealId,
        steps: [],
        error: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setPipelineRunning(false);
    }
  }

  const op = data?.operator;
  const usage = data?.usage;
  const queue = data?.approvalQueue ?? [];
  const topAgents = usage?.windows.last_7_days.slice(0, 8) ?? [];

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">

        {/* Header */}
        <section className="overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.22),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] p-6 shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 text-sm font-medium hover:bg-muted"
                >
                  <ArrowLeft className="size-4" />
                  Dashboard
                </Link>
                <Badge variant="outline" className="bg-background/70">Operator Console</Badge>
              </div>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                System Operations
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground">
                Live platform health, agent usage, and approval queue.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start lg:self-auto"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
              Refresh
            </Button>
          </div>
        </section>

        {/* Toast */}
        {toastMsg ? (
          <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm font-medium shadow-lg">
            {toastMsg}
          </div>
        ) : null}

        {/* Error */}
        {!loading && error ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex items-start gap-3 py-5">
              <AlertCircle className="mt-0.5 size-4 text-destructive" />
              <div>
                <p className="font-medium">Failed to load operator data</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Loading skeleton */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-border/70 bg-card/80">
                <CardContent className="space-y-2 py-6">
                  <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
                  <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {/* Stat cards */}
        {!loading && op ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/70 bg-card/95">
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active Deals</span>
                  <Activity className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-3xl font-semibold">{op.total_active_deals}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {op.total_high_priority_deals} high priority
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/95">
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">System Health</span>
                  {healthIcon(op.latest_system_health_status)}
                </div>
                <p className="mt-2 text-3xl font-semibold capitalize">
                  {op.latest_system_health_status ?? "Unknown"}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {op.latest_system_health_checked_at
                    ? `Checked ${formatDateTime(op.latest_system_health_checked_at)}`
                    : "No health check data"}
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/95">
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notifications (24h)</span>
                  <Zap className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-3xl font-semibold">{op.recent_notifications_count}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {op.pending_retries_count} retries pending
                </p>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/95">
              <CardContent className="pt-6 pb-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reports (7d)</span>
                  <ShieldCheck className="size-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-3xl font-semibold">{op.latest_generated_reports_count}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">Deal reports generated</p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Agent usage + approval queue */}
        {!loading && (topAgents.length > 0 || queue.length > 0) ? (
          <div className="grid gap-6 lg:grid-cols-2">

            {/* Agent usage table */}
            {topAgents.length > 0 ? (
              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="size-4 text-primary" />
                    Agent Usage (7 days)
                  </CardTitle>
                  <CardDescription>Top agents by call volume.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-xl border border-border/70">
                    <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-3 border-b border-border/70 bg-background/60 px-4 py-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      <span>Agent</span>
                      <span className="text-right">Calls</span>
                      <span className="text-right">Est. cost</span>
                    </div>
                    <div className="divide-y divide-border/70">
                      {topAgents.map((row) => (
                        <div
                          key={row.agent_name}
                          className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-3 px-4 py-2.5 text-sm"
                        >
                          <span className="truncate font-mono text-foreground text-xs">{row.agent_name}</span>
                          <span className="text-right text-foreground">{row.calls}</span>
                          <span className="text-right text-muted-foreground">
                            ${row.estimated_cost.toFixed(4)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {usage?.windows.last_24_hours.length ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Last 24h: {usage.windows.last_24_hours.reduce((s, r) => s + r.calls, 0)} calls
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {/* Approval queue */}
            {queue.length > 0 ? (
              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    Approval Queue
                  </CardTitle>
                  <CardDescription>
                    {queue.length} item{queue.length === 1 ? "" : "s"} awaiting operator review.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {queue.map((item) => (
                    <ApprovalQueueRow
                      key={item.id}
                      item={item}
                      onDecision={handleDecision}
                      processing={processingId === item.id}
                    />
                  ))}
                </CardContent>
              </Card>
            ) : null}

          </div>
        ) : null}

        {/* ── Discovery Runner ── */}
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4 text-primary" />
              Run Discovery
            </CardTitle>
            <CardDescription>
              Pull live NSW listings from Domain and score them as deal candidates. Enter suburbs separated by commas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">NSW Suburbs (comma-separated)</label>
                <input
                  className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={discoverySuburbs}
                  onChange={(e) => setDiscoverySuburbs(e.target.value)}
                  placeholder="Surry Hills, Newtown, Marrickville"
                  disabled={discoveryRunning}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Min. land area (m²)</label>
                <input
                  className="w-full rounded-xl border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  value={discoveryMinLand}
                  onChange={(e) => setDiscoveryMinLand(e.target.value)}
                  placeholder="600"
                  type="number"
                  min={200}
                  max={5000}
                  disabled={discoveryRunning}
                />
              </div>
            </div>

            <Button
              onClick={() => void handleRunDiscovery()}
              disabled={discoveryRunning || !discoverySuburbs.trim()}
              className="gap-2"
            >
              {discoveryRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Zap className="size-4" />
              )}
              {discoveryRunning ? "Searching listings…" : "Run Discovery"}
            </Button>

            {discoveryResult && (
              <div className="space-y-2">
                {discoveryResult.error ? (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    {discoveryResult.error}
                  </div>
                ) : null}

                {discoveryResult.discovered.length > 0 ? (
                  <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
                    {discoveryResult.discovered.map((r: DiscoverySuburbResult) => (
                      <div key={r.suburb} className="flex items-center justify-between px-4 py-2.5 text-sm">
                        <span className="font-medium">{r.suburb}</span>
                        <Badge variant={r.candidate_count > 0 ? "default" : "outline"}>
                          {r.candidate_count} candidate{r.candidate_count === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className={`rounded-xl px-4 py-3 text-sm font-medium ${
                  discoveryResult.success && discoveryResult.total_candidates > 0
                    ? "bg-green-50 text-green-800 border border-green-200"
                    : discoveryResult.success
                    ? "bg-muted/50 text-muted-foreground border border-border/70"
                    : "bg-destructive/5 text-destructive border border-destructive/20"
                }`}>
                  {discoveryResult.success
                    ? discoveryResult.total_candidates > 0
                      ? `✓ ${discoveryResult.total_candidates} candidate${discoveryResult.total_candidates === 1 ? "" : "s"} found — check the Feed to see new deals.`
                      : "Discovery ran but no candidates met the minimum land area filter."
                    : "Discovery finished with errors."}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Pipeline Runner ── */}
        <Card className="border-border/70 bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4 text-primary" />
              Run Deal Pipeline
            </CardTitle>
            <CardDescription>
              Manually trigger the full agent pipeline for a deal. Run the SQL seed first
              (see <code className="rounded bg-muted px-1 text-xs">test-data/seed_test_deal.sql</code>),
              then press Run. The test deal ID is pre-filled below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Deal ID</label>
                <input
                  type="text"
                  value={pipelineDealId}
                  onChange={(e) => setPipelineDealId(e.target.value)}
                  placeholder="UUID from deals table"
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Address</label>
                <input
                  type="text"
                  value={pipelineAddress}
                  onChange={(e) => setPipelineAddress(e.target.value)}
                  placeholder="Full street address"
                  className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            <Button
              onClick={() => void handleRunPipeline()}
              disabled={pipelineRunning || !pipelineDealId.trim() || !pipelineAddress.trim()}
              className="gap-2"
            >
              {pipelineRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {pipelineRunning ? "Running pipeline…" : "Run Full Pipeline"}
            </Button>

            {/* Step progress */}
            {(pipelineRunning || pipelineResult) && (
              <div className="space-y-2 pt-1">
                {pipelineRunning && !pipelineResult && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Running agents — this may take 30–90 seconds…
                  </div>
                )}
                {pipelineResult?.steps.map((step: PipelineStep) => (
                  <div key={step.name} className="flex items-start gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                    {step.status === "done" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                    ) : step.status === "error" ? (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    ) : (
                      <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{step.name}</p>
                      {step.message && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{step.message}</p>
                      )}
                    </div>
                    {step.durationMs != null && (
                      <span className="shrink-0 text-xs text-muted-foreground">{(step.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                ))}
                {pipelineResult && (
                  <div className={`rounded-xl px-4 py-3 text-sm font-medium ${pipelineResult.success ? "bg-green-50 text-green-800 border border-green-200" : "bg-destructive/5 text-destructive border border-destructive/20"}`}>
                    {pipelineResult.success
                      ? "✓ Pipeline completed — refresh the deal workspace to see results."
                      : `Pipeline finished with errors. Check step details above.`}
                    {pipelineResult.error && (
                      <p className="mt-1 text-xs opacity-80">{pipelineResult.error}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Empty state */}
        {!loading && !error && topAgents.length === 0 && queue.length === 0 ? (
          <Card className="border-border/70 bg-card/90">
            <CardContent className="py-10 text-center">
              <p className="text-lg font-medium">No data yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Usage metrics and approval queue items will appear here once the platform begins processing deals.
              </p>
            </CardContent>
          </Card>
        ) : null}

      </div>
    </main>
  );
}
