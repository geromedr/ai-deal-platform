"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
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

// ─── helpers ────────────────────────────────────────────────────────────────

function sentenceCase(value: string | null | undefined) {
  if (!value) return "—";
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(value: unknown) {
  if (typeof value !== "string") return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" });
}

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
