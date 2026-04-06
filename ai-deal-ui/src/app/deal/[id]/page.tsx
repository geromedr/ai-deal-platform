import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  MapPinned,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import DecisionHeader from "@/components/deal/decision-header";
import { getDealContext } from "@/lib/api/getDealContext";
import { supabase } from "@/lib/supabase";

type RecordLike = Record<string, unknown>;
type CurrentDecision = "BUY" | "REVIEW" | "PASS" | null;

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asRecordArray(value: unknown): RecordLike[] {
  return Array.isArray(value)
    ? value.filter((item): item is RecordLike => Boolean(asRecord(item)))
    : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getValue(source: unknown, path: string): unknown {
  let current: unknown = source;

  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as RecordLike)[segment];
  }

  return current;
}

function firstString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = asString(getValue(source, path));
    if (value) return value;
  }
  return null;
}

function firstNumber(source: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = asNumber(getValue(source, path));
    if (value !== null) return value;
  }
  return null;
}

function formatNumber(value: number | null, options?: Intl.NumberFormatOptions) {
  if (value === null) return "Not available";

  return new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

function formatCurrency(value: number | null) {
  if (value === null) return "Not available";

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return "Not available";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function sentenceCase(value: string | null) {
  if (!value) return "Not available";
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) return "Not available";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function getHighestRiskSeverity(risks: RecordLike[]) {
  const severityRank: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  let highest: string | null = null;

  for (const risk of risks) {
    const severity = asString(risk.severity)?.toLowerCase() ?? "medium";
    const currentRank = severityRank[severity] ?? severityRank.medium;
    const highestRank = highest ? (severityRank[highest] ?? severityRank.medium) : 0;

    if (!highest || currentRank > highestRank) {
      highest = severity;
    }
  }

  return highest;
}

function buildSummary(
  deal: RecordLike | null,
  latestFinancial: RecordLike | null,
  riskCount: number,
) {
  const explicitSummary = firstString(deal, [
    "summary",
    "metadata.summary",
    "metadata.one_line_summary",
    "metadata.tldr",
    "metadata.description",
  ]);

  if (explicitSummary) return explicitSummary;

  const suburb = firstString(deal, ["suburb"]);
  const state = firstString(deal, ["state"]);
  const units = firstNumber(latestFinancial, [
    "metadata.estimated_units",
    "metadata.units",
    "metadata.yield_units",
    "amount",
  ]);

  const location = [suburb, state].filter(Boolean).join(", ");

  if (location && units !== null) {
    return `${location} opportunity with an estimated yield of ${formatNumber(units)} units and ${riskCount} active risk${riskCount === 1 ? "" : "s"}.`;
  }

  if (location) {
    return `${location} deal workspace with current diligence, financial, and action context loaded from Supabase.`;
  }

  return "Deal workspace with current diligence, financial, risk, and action context loaded from Supabase.";
}

async function getLatestDecision(dealId: string): Promise<CurrentDecision> {
  const { data, error } = await supabase
    .from("ai_actions")
    .select("payload")
    .eq("deal_id", dealId)
    .eq("action", "deal_decision")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return null;
  }

  const payload = asRecord(data)?.payload;
  const decision = asString(asRecord(payload)?.decision);

  return decision === "BUY" || decision === "REVIEW" || decision === "PASS"
    ? decision
    : null;
}

function DealWorkspaceState({
  title,
  description,
  message,
  loading = false,
}: {
  title: string;
  description: string;
  message: string;
  loading?: boolean;
}) {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
        <Link
          href="/"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>

        <Card className={loading ? "border-border/70 bg-card/95" : "border-destructive/30 bg-destructive/5"}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {loading ? (
                <Building2 className="size-4 text-primary" />
              ) : (
                <AlertTriangle className="size-4 text-destructive" />
              )}
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {message}
            {loading ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-24 animate-pulse rounded-xl border border-border/70 bg-background/70"
                  />
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

async function DealWorkspaceContent({ dealId }: { dealId: string }) {
  console.log("FETCHING DEAL ID", dealId);
  const data = await getDealContext(dealId);
  console.log("CONTEXT RESPONSE", data);
  const currentDecision = await getLatestDecision(dealId);

  const deal = asRecord(data.deal);
  const tasks = asRecordArray(data.tasks);
  const communications: RecordLike[] = [];
  const financials: RecordLike[] = [];
  const risks: RecordLike[] = [];
  const capitalSummary: RecordLike | null = null;
  const investorMatches: RecordLike[] = [];
  const suggestedInvestorActions: string[] = [];
  const latestFinancial = asRecord(financials[0]);

  if (!deal && tasks.length === 0 && communications.length === 0 && financials.length === 0 && risks.length === 0) {
    return (
      <DealWorkspaceState
        title="Unable to load deal workspace"
        description="No usable deal data was returned from `get-deal-context`."
        message="Failed to load deal"
      />
    );
  }

  const dealName =
    firstString(deal, [
      "name",
      "metadata.deal_name",
      "metadata.name",
      "address",
    ]) ?? `Deal ${dealId.slice(0, 8)}`;
  const dealStage = firstString(deal, ["stage"]);

  const summary = buildSummary(deal, latestFinancial, risks.length);
  const score =
    firstNumber(deal, [
      "score",
      "priority_score",
      "metadata.score",
      "metadata.priority_score",
      "metadata.ranking_score",
    ]) ??
    firstNumber(latestFinancial, [
      "metadata.score",
      "metadata.priority_score",
      "metadata.ranking_score",
    ]) ??
    0;
  const confidence = firstNumber(deal, [
    "confidence",
    "metadata.confidence",
    "metadata.confidence_score",
    "metadata.analysis_confidence",
  ]);
  const margin =
    firstNumber(latestFinancial, [
      "metadata.margin_pct",
      "metadata.margin",
      "metadata.profit_margin_pct",
      "metadata.profit_margin",
      "metadata.estimated_margin_pct",
    ]) ??
    firstNumber(deal, [
      "metadata.margin_pct",
      "metadata.margin",
      "metadata.target_margin_pct",
    ]);

  const zoning =
    firstString(deal, [
      "metadata.zoning",
      "metadata.site_intelligence.zoning",
      "metadata.planning.zoning",
    ]) ?? "Zoning not available";

  const yieldUnits = firstNumber(latestFinancial, [
    "metadata.estimated_units",
    "metadata.units",
    "metadata.yield_units",
    "metadata.net_sellable_units",
  ]);
  const yieldGfa = firstNumber(latestFinancial, [
    "metadata.estimated_gfa",
    "metadata.gfa",
    "metadata.yield_gfa",
  ]);

  const yieldText =
    yieldUnits !== null
      ? `${formatNumber(yieldUnits)} units estimated`
      : yieldGfa !== null
        ? `${formatNumber(yieldGfa)} sqm GFA estimated`
        : "Yield not available";

  const highestRiskSeverity = getHighestRiskSeverity(risks);
  const riskFlag =
    risks.length === 0
      ? "No active risks logged"
      : `${sentenceCase(highestRiskSeverity)} risk, ${risks.length} item${risks.length === 1 ? "" : "s"} open`;

  const address = firstString(deal, ["address"]);
  const location = [
    firstString(deal, ["suburb"]),
    firstString(deal, ["state"]),
    firstString(deal, ["postcode"]),
  ]
    .filter(Boolean)
    .join(", ");

  const latestGdv = firstNumber(latestFinancial, [
    "gdv",
    "metadata.gdv",
    "metadata.estimated_revenue",
  ]);
  const latestTdc = firstNumber(latestFinancial, [
    "tdc",
    "metadata.tdc",
    "metadata.estimated_total_cost",
  ]);
  const latestProfit = firstNumber(latestFinancial, [
    "metadata.estimated_profit",
    "metadata.profit",
  ]);
  const capitalTarget = firstNumber(capitalSummary, ["capital_target"]);
  const totalCommitted = firstNumber(capitalSummary, ["total_committed"]);
  const remainingCapital = firstNumber(capitalSummary, ["remaining_capital"]);
  const stageBadgeClass =
    dealStage === "active"
      ? "bg-green-200 text-green-800"
      : dealStage === "archived"
        ? "bg-gray-200 text-gray-700"
        : "bg-gray-100 text-gray-700";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="bg-background/70">
              Deal Workspace
            </Badge>
            {dealStage ? (
              <div className="inline-flex">
                <span className={`rounded px-2 py-1 text-xs ${stageBadgeClass}`}>
                  {dealStage}
                </span>
              </div>
            ) : null}
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {dealName}
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              {summary}
            </p>
          </div>

          <Link
            href="/"
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>
        </div>

        <DecisionHeader
          dealId={dealId}
          score={score}
          confidence={confidence}
          currentDecision={currentDecision}
        />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Tasks</h2>
              <p className="text-sm text-muted-foreground">
                Current tasks linked to this deal.
              </p>
            </div>
            <Badge variant="outline">{tasks.length} total</Badge>
          </div>

          {tasks.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/95">
              <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-4 border-b border-border/70 bg-background/60 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <span>Title</span>
                <span>Status</span>
                <span>Created At</span>
              </div>
              <div className="divide-y divide-border/70">
                {tasks.map((task, index) => (
                  <div
                    key={String(task.id ?? index)}
                    className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,1fr)] gap-4 px-4 py-4 text-sm"
                  >
                    <span className="font-medium text-foreground">
                      {asString(task.title) ?? `Task ${index + 1}`}
                    </span>
                    <span className="text-muted-foreground">
                      {sentenceCase(asString(task.status) ?? "open")}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateTime(task.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
              No tasks found.
            </div>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
          <Card className="border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.18),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-primary" />
                TLDR
              </CardTitle>
              <CardDescription>
                High-level view of the current deal context.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Deal
                </p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {dealName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {location || address || "Location pending"}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Score
                </p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {score !== null ? formatNumber(score) : "N/A"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Current ranking signal
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Margin
                </p>
                <p className="mt-2 text-3xl font-semibold text-foreground">
                  {formatPercent(margin)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Latest available feasibility margin
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPinned className="size-4 text-primary" />
                Key Signals
              </CardTitle>
              <CardDescription>
                Three quick diligence bullets for the current review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { label: "Zoning", value: zoning },
                { label: "Yield", value: yieldText },
                { label: "Risk Flag", value: riskFlag },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-border/70 bg-background/70 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-2 font-medium text-foreground">{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
              <CardDescription>
                Core deal context and review status.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Status</p>
                <p className="mt-2 font-medium text-foreground">
                  {sentenceCase(firstString(deal, ["status", "stage"]))}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Address</p>
                <p className="mt-2 font-medium text-foreground">
                  {address || location || "Not available"}
                </p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Tasks</p>
                <p className="mt-2 font-medium text-foreground">{tasks.length}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Communications</p>
                <p className="mt-2 font-medium text-foreground">{communications.length}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle>Financials</CardTitle>
              <CardDescription>
                Latest visible feasibility and capital figures.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">GDV</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(latestGdv)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">TDC</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(latestTdc)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Profit</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(latestProfit)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Capital Remaining</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(remainingCapital)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Capital Target</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(capitalTarget)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/70 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Committed</p>
                <p className="mt-2 font-medium text-foreground">{formatCurrency(totalCommitted)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-primary" />
                Risks
              </CardTitle>
              <CardDescription>
                Active risk items from the current context payload.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {risks.length > 0 ? (
                risks.slice(0, 4).map((risk, index) => {
                  const severity = asString(risk.severity)?.toLowerCase();
                  const isSevere = severity === "high" || severity === "critical";

                  return (
                    <div
                      key={String(risk.id ?? index)}
                      className="rounded-xl border border-border/70 bg-background/70 p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-foreground">
                          {asString(risk.title) ?? `Risk ${index + 1}`}
                        </p>
                        <Badge variant={isSevere ? "destructive" : "outline"}>
                          {sentenceCase(asString(risk.severity) ?? "medium")}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {asString(risk.description) ?? "No risk description recorded."}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/50 p-4 text-sm text-muted-foreground">
                  No risks are currently logged for this deal.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BadgeDollarSign className="size-4 text-primary" />
                Actions
              </CardTitle>
              <CardDescription>
                Workflow and investor action signals available from the context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                `Open tasks: ${tasks.length}`,
                `Latest financial snapshots: ${financials.length}`,
                `Investor matches: ${investorMatches.length}`,
                `Suggested investor actions: ${suggestedInvestorActions.length}`,
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-foreground"
                >
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

export default async function DealPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!id) return notFound();

  return (
    <Suspense
      fallback={
        <DealWorkspaceState
          title="Loading deal workspace"
          description="Fetching the latest deal context."
          message="Loading..."
          loading
        />
      }
    >
      <DealWorkspaceContent dealId={id} />
    </Suspense>
  );
}
