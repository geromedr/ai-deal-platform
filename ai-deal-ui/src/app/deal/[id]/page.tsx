import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  ChevronLeft,
  ChevronRight,
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
import DealChat from "@/components/deal/deal-chat";
import DealTimeline from "@/components/deal/deal-timeline";
import DealReports from "@/components/deal/deal-reports";
import InvestorPanel from "@/components/deal/investor-panel";
import WorkspaceTabs from "@/components/deal/workspace-tabs";
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
  // Normalise: values <= 1 are decimals (0.18 → 18%), values > 1 are already percentages
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
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

type DealNarrative = {
  verdict: string;
  financials: string;
  risks: string;
  area: string;
};

function marginBand(pct: number): { label: string; qualifier: string } {
  if (pct >= 28) return { label: "Excellent", qualifier: "well above the threshold for this strategy" };
  if (pct >= 20) return { label: "Solid",    qualifier: "comfortably within acceptable range" };
  if (pct >= 14) return { label: "Marginal", qualifier: "acceptable but leaves little buffer for cost overruns" };
  return           { label: "Thin",     qualifier: "below typical minimum — revisit cost assumptions" };
}

function scoreBand(score: number): string {
  if (score >= 85) return "high conviction";
  if (score >= 65) return "moderate conviction";
  if (score >= 40) return "early-stage";
  return "low-confidence";
}

function buildDealNarrative({
  deal,
  score,
  margin,
  zoning,
  risks,
  highestRiskSeverity,
  suburb,
  state,
  siteArea,
  heightLimit,
  yieldUnits,
  gdv,
  tdc,
  profit,
  floodRisk,
  strategy,
}: {
  deal: RecordLike | null;
  score: number;
  margin: number | null;
  zoning: string;
  risks: RecordLike[];
  highestRiskSeverity: string | null;
  suburb: string | null;
  state: string | null;
  siteArea: number | null;
  heightLimit: string | null;
  yieldUnits: number | null;
  gdv: number | null;
  tdc: number | null;
  profit: number | null;
  floodRisk: string | null;
  strategy: string | null;
}): DealNarrative {
  const location = [suburb, state].filter(Boolean).join(", ");
  const rawStrategy = strategy ?? firstString(deal, ["strategy", "metadata.strategy"]);
  const strategyLabel =
    rawStrategy && rawStrategy.toLowerCase() !== "not available"
      ? (sentenceCase(rawStrategy) ?? "development")
      : "development";
  const zoningKnown = zoning !== "Zoning not available";
  const hasFinancials = gdv !== null || tdc !== null || profit !== null || margin !== null;
  const marginPct = margin !== null ? (margin <= 1 ? margin * 100 : margin) : null;

  // ── Para 1: Verdict ────────────────────────────────────────────────────────
  let verdict: string;
  const band = scoreBand(score);
  const locationClause = location ? ` in ${location}` : "";
  const zoningClause = zoningKnown ? ` The site carries ${zoning} zoning` : "";
  const yieldClause = yieldUnits !== null ? `, with an estimated yield of ${formatNumber(yieldUnits)} units` : "";
  const siteClause = siteArea !== null ? ` on a ${formatNumber(siteArea)} sqm land parcel` : "";

  if (score >= 65 && marginPct !== null && marginPct >= 14) {
    verdict = `This is a ${band} ${strategyLabel} opportunity${locationClause} that warrants serious operator attention.${zoningClause}${yieldClause}${siteClause}. The financial profile and site characteristics align — this deal is worth your time to progress through due diligence.`;
  } else if (score >= 40) {
    verdict = `This ${strategyLabel} site${locationClause} shows potential but requires further validation before committing resources.${zoningClause}${yieldClause}${siteClause}. The current scoring reflects ${band} data — a deeper feasibility pass is recommended before advancing.`;
  } else {
    verdict = `This ${strategyLabel} opportunity${locationClause} is in early analysis.${zoningClause}${yieldClause}${siteClause}. Scoring and financial data are incomplete — treat current outputs as indicative only until a full site intelligence run has been completed.`;
  }

  // ── Para 2: Financials ─────────────────────────────────────────────────────
  let financials: string;
  if (!hasFinancials) {
    financials = "No financial snapshot has been recorded yet. GDV, TDC, and margin cannot be assessed until a feasibility run is completed. This is the single biggest gap in the current deal context — without it, profit potential is speculative.";
  } else {
    const parts: string[] = [];
    if (gdv !== null) parts.push(`GDV of ${formatCurrency(gdv)}`);
    if (tdc !== null) parts.push(`TDC of ${formatCurrency(tdc)}`);
    if (profit !== null) parts.push(`estimated profit of ${formatCurrency(profit)}`);

    const bandInfo = marginPct !== null ? marginBand(marginPct) : null;
    const marginClause = bandInfo !== null
      ? ` The projected margin of ${marginPct!.toFixed(1)}% is rated **${bandInfo.label}** — ${bandInfo.qualifier}.`
      : "";

    if (parts.length > 0) {
      financials = `The latest financial snapshot shows a ${parts.join(", ")}.${marginClause}${marginPct !== null && marginPct < 14 ? " Cost efficiency and contingency management will be critical to viability." : marginPct !== null && marginPct >= 20 ? " This return profile supports a well-structured development case." : ""}`;
    } else {
      financials = `A financial snapshot exists but key figures (GDV, TDC, profit) could not be resolved from the current data.${marginClause} Review the financial_snapshots table directly to confirm the underlying values.`;
    }
  }

  // ── Para 3: Risks & hurdles ────────────────────────────────────────────────
  let risksText: string;
  const severeRisks = risks.filter((r) => {
    const s = asString(r.severity)?.toLowerCase();
    return s === "high" || s === "critical";
  });
  const floodFlag = floodRisk && floodRisk.toLowerCase() !== "none" && floodRisk.toLowerCase() !== "low";
  const needsRezoning = zoningKnown && (zoning.toLowerCase().includes("rezone") || zoning.toLowerCase().includes("future"));
  const planningCertain = zoningKnown && !needsRezoning;

  if (risks.length === 0 && !floodFlag) {
    risksText = `No risk items are currently logged${planningCertain ? ` and the zoning (${zoning}) supports the intended use without requiring rezoning` : ""}. This is a clean risk profile at this stage — though absence of logged risks may also reflect incomplete diligence rather than a genuinely low-risk site. Confirm planning constraints, flood overlay, and title issues have been checked before treating this as low-risk.`;
  } else {
    const riskParts: string[] = [];
    if (severeRisks.length > 0) {
      const topRisk = asString(severeRisks[0].title) ?? asString(severeRisks[0].description) ?? "unnamed high-severity item";
      riskParts.push(`the most critical logged item is "${topRisk}" — this has the potential to materially affect viability`);
    } else if (risks.length > 0) {
      riskParts.push(`${risks.length} risk item${risks.length === 1 ? "" : "s"} logged at ${sentenceCase(highestRiskSeverity) ?? "medium"} severity`);
    }
    if (floodFlag) riskParts.push(`flood risk is flagged as ${floodRisk} — check flood certificate and insurance implications`);
    if (needsRezoning) riskParts.push(`zoning (${zoning}) suggests rezoning may be required, which introduces planning timeline risk`);
    if (!planningCertain && !zoningKnown) riskParts.push("zoning has not been confirmed — this must be resolved before advancing");

    risksText = `The primary hurdles on this deal: ${riskParts.join("; ")}. ${severeRisks.length > 0 ? "Resolve the high-severity items before committing to the next stage — they represent deal-breaker territory if unaddressed." : "These are manageable at this stage but should not be deferred."}`;
  }

  // ── Para 4: Area & exit ───────────────────────────────────────────────────
  let area: string;
  const comparables = asString(firstString(deal, [
    "metadata.comparable_context",
    "metadata.area_context",
    "metadata.market_context",
  ]));
  const infrastructure = asString(firstString(deal, [
    "metadata.infrastructure",
    "metadata.local_context",
    "metadata.area_notes",
  ]));

  if (comparables) {
    area = comparables;
  } else if (suburb && state) {
    const stratLower = strategyLabel?.toLowerCase() ?? "development";
    const isResi = stratLower.includes("resid") || stratLower.includes("unit") || stratLower.includes("town") || stratLower.includes("house");
    const buyerPool = isResi
      ? "owner-occupiers and investors seeking completed stock"
      : "commercial tenants and yield-focused investors";

    area = `${suburb}, ${state} is the target market. ${heightLimit ? `The site sits within a ${heightLimit} height limit zone` : "Height limits have not been confirmed"} — verify the planning certificate for full envelope controls. ${infrastructure ? `Local context: ${infrastructure}. ` : ""}The likely exit buyer pool for a completed ${strategyLabel?.toLowerCase() ?? "development"} project here would be ${buyerPool}. Check recent comparable sales and any planned infrastructure corridors in the area to firm up end-value assumptions before finalising feasibility.`;
  } else {
    area = `Location data for this deal is incomplete — suburb and state have not been recorded. Area quality, exit buyer profile, and comparable sale evidence cannot be assessed without a confirmed address. Update the deal record to enable area-level analysis.`;
  }

  return { verdict, financials, risks: risksText, area };
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

async function DealWorkspaceContent({
  dealId,
  prevId,
  nextId,
  filter,
  allIds,
  currentIndex,
}: {
  dealId: string;
  prevId: string | null;
  nextId: string | null;
  filter: string;
  allIds: string[];
  currentIndex: number;
}) {
  console.log("FETCHING DEAL ID", dealId);
  const data = await getDealContext(dealId);
  console.log("CONTEXT RESPONSE", data);
  const currentDecision = await getLatestDecision(dealId);

  const deal = asRecord(data.deal);
  const feed = asRecord(data.feed);
  const feedId = asString(feed?.id) ?? "";
  const tasks = asRecordArray(data.tasks);
  const communications = asRecordArray(data.communications);
  const financials = asRecordArray(data.financials);
  const risks = asRecordArray(data.risks);
  const siteIntelligence = asRecord(data.site_intelligence);
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
      "deal_name",
      "name",
      "metadata.deal_name",
      "metadata.name",
      "address",
    ]) ?? `Deal ${dealId.slice(0, 8)}`;
  const dealStage = firstString(deal, ["stage"]);

  const summary = buildSummary(deal, latestFinancial, risks.length);
  const score = asNumber(feed?.priority_score ?? feed?.score) ?? 0;
  const confidence = firstNumber(deal, [
    "confidence",
    "metadata.confidence",
    "metadata.confidence_score",
    "metadata.analysis_confidence",
  ]);
  const marginExplicit =
    firstNumber(latestFinancial, [
      "margin_pct",
      "metadata.margin_pct",
      "metadata.margin",
      "metadata.profit_margin_pct",
      "metadata.profit_margin",
      "metadata.estimated_margin_pct",
    ]) ??
    firstNumber(deal, [
      "target_margin",
      "metadata.margin_pct",
      "metadata.margin",
      "metadata.target_margin_pct",
    ]);
  // Derive margin from GDV/TDC if no explicit field exists
  const gdvForMargin =
    firstNumber(latestFinancial, ["gdv", "metadata.gdv"]) ??
    firstNumber(siteIntelligence, ["estimated_revenue"]);
  const tdcForMargin =
    firstNumber(latestFinancial, ["tdc", "metadata.tdc"]) ??
    firstNumber(siteIntelligence, ["estimated_build_cost"]);
  const marginDerived =
    gdvForMargin !== null && tdcForMargin !== null && gdvForMargin > 0
      ? (gdvForMargin - tdcForMargin) / gdvForMargin
      : null;
  const margin = marginExplicit ?? marginDerived;

  const zoning =
    firstString(deal, [
      "zoning",
      "metadata.zoning",
      "metadata.site_intelligence.zoning",
      "metadata.planning.zoning",
    ]) ??
    firstString(siteIntelligence, ["zoning", "lep"]) ??
    "Zoning not available";

  const yieldUnits =
    firstNumber(latestFinancial, [
      "metadata.estimated_units",
      "metadata.units",
      "metadata.yield_units",
      "metadata.net_sellable_units",
    ]) ?? firstNumber(siteIntelligence, ["estimated_units"]);
  const yieldGfa =
    firstNumber(latestFinancial, [
      "metadata.estimated_gfa",
      "metadata.gfa",
      "metadata.yield_gfa",
    ]) ??
    firstNumber(siteIntelligence, ["estimated_gfa"]) ??
    firstNumber(deal, ["site_area"]);

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

  const suburb = firstString(deal, ["suburb"]);
  const state = firstString(deal, ["state"]);
  const siteArea = firstNumber(deal, ["site_area"]);
  const heightLimit =
    firstString(deal, ["height_limit", "metadata.height_limit"]) ??
    firstString(siteIntelligence, ["height_limit"]);

  const address = firstString(deal, ["address"]);
  const location = [suburb, state, firstString(deal, ["postcode"])]
    .filter(Boolean)
    .join(", ");

  const latestGdv =
    firstNumber(latestFinancial, ["gdv", "metadata.gdv", "metadata.estimated_revenue"]) ??
    firstNumber(siteIntelligence, ["estimated_revenue"]);
  const latestTdc =
    firstNumber(latestFinancial, ["tdc", "metadata.tdc", "metadata.estimated_total_cost"]) ??
    firstNumber(siteIntelligence, ["estimated_build_cost"]);
  // Profit: prefer explicit field, fall back to derived GDV − TDC
  const latestProfitExplicit =
    firstNumber(latestFinancial, ["profit", "metadata.estimated_profit", "metadata.profit"]) ??
    firstNumber(siteIntelligence, ["estimated_profit"]);
  const latestProfit =
    latestProfitExplicit ??
    (latestGdv !== null && latestTdc !== null ? latestGdv - latestTdc : null);

  const floodRisk = asString(siteIntelligence?.flood_risk) ?? null;
  const dealStrategy = firstString(deal, ["strategy", "metadata.strategy"]);

  const dealNarrative = buildDealNarrative({
    deal,
    score,
    margin,
    zoning,
    risks,
    highestRiskSeverity,
    suburb,
    state,
    siteArea,
    heightLimit,
    yieldUnits,
    gdv: latestGdv ?? null,
    tdc: latestTdc ?? null,
    profit: latestProfit ?? null,
    floodRisk,
    strategy: dealStrategy,
  });
  const capitalTarget = firstNumber(capitalSummary, ["capital_target"]);
  const totalCommitted = firstNumber(capitalSummary, ["total_committed"]);
  const remainingCapital = firstNumber(capitalSummary, ["remaining_capital"]);
  const stageBadgeClass =
    dealStage === "active"
      ? "bg-green-200 text-green-800"
      : dealStage === "archived"
        ? "bg-gray-200 text-gray-700"
        : "bg-gray-100 text-gray-700";

  const backHref = "/";
  const idsParam = allIds.length > 0 ? `&ids=${allIds.join(",")}` : "";
  const prevHref = prevId
    ? `/deal/${prevId}?filter=${filter}&i=${currentIndex - 1}${idsParam}`
    : null;
  const nextHref = nextId
    ? `/deal/${nextId}?filter=${filter}&i=${currentIndex + 1}${idsParam}`
    : null;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">

        {/* Top nav bar — back + prev/next */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href={backHref}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium whitespace-nowrap transition-all outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" />
            Back to dashboard
          </Link>

          {(prevHref ?? nextHref) ? (
            <div className="flex items-center gap-1">
              {filter !== "all" ? (
                <span className="mr-2 text-xs text-muted-foreground capitalize">
                  {filter}
                </span>
              ) : null}
              <Link
                href={prevHref ?? "#"}
                aria-disabled={!prevHref}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  prevHref
                    ? "hover:bg-muted hover:text-foreground"
                    : "pointer-events-none opacity-35"
                }`}
              >
                <ChevronLeft className="size-4" />
              </Link>
              <Link
                href={nextHref ?? "#"}
                aria-disabled={!nextHref}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  nextHref
                    ? "hover:bg-muted hover:text-foreground"
                    : "pointer-events-none opacity-35"
                }`}
              >
                <ChevronRight className="size-4" />
              </Link>
            </div>
          ) : null}
        </div>

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

        </div>

        <DecisionHeader
          dealId={dealId}
          feedId={feedId}
          score={score}
          confidence={confidence}
          currentDecision={currentDecision}
        />

        <WorkspaceTabs
          riskCount={risks.length}
          taskCount={tasks.length}

          brief={
            <section className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
              <Card className="border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.18),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)]">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="size-4 text-primary" />
                    Deal Brief
                  </CardTitle>
                  <CardDescription>
                    Operator summary — opportunity, financials, risks, and area context.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(
                    [
                      { label: "Opportunity",    text: dealNarrative.verdict },
                      { label: "Financials",     text: dealNarrative.financials },
                      { label: "Risks & Hurdles", text: dealNarrative.risks },
                      { label: "Area & Exit",    text: dealNarrative.area },
                    ] as const
                  ).map(({ label, text }) => (
                    <div key={label} className="rounded-xl border border-border/70 bg-background/70 px-4 py-3 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">{label}</p>
                      <p
                        className="text-sm leading-6 text-foreground"
                        dangerouslySetInnerHTML={{
                          __html: text
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
                        }}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPinned className="size-4 text-primary" />
                    Key Signals
                  </CardTitle>
                  <CardDescription>
                    Quick diligence signals for the current review.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {[
                    { label: "Zoning",           value: zoning },
                    { label: "Height Limit",     value: heightLimit ?? "Not available" },
                    { label: "Yield / Site Area", value: yieldText },
                    { label: "Risk Flag",         value: riskFlag },
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
          }

          financials={
            <section className="grid gap-4 lg:grid-cols-2">
              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                  <CardDescription>Core deal context and review status.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    { label: "Status",         value: sentenceCase(firstString(deal, ["status", "stage"])) },
                    { label: "Strategy",       value: sentenceCase(firstString(deal, ["strategy", "metadata.strategy"])) ?? "Not available" },
                    { label: "Address",        value: address || location || "Not available" },
                    { label: "Site Area",      value: siteArea !== null ? `${formatNumber(siteArea)} sqm` : "Not available" },
                    { label: "Tasks",          value: String(tasks.length) },
                    { label: "Communications", value: String(communications.length) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border/70 bg-background/70 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                      <p className="mt-2 font-medium text-foreground">{item.value}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle>Financials</CardTitle>
                  <CardDescription>Latest visible feasibility and capital figures.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      { label: "GDV",    value: formatCurrency(latestGdv) },
                      { label: "TDC",    value: formatCurrency(latestTdc) },
                      { label: "Profit", value: formatCurrency(latestProfit) },
                      { label: "Margin", value: formatPercent(margin) },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-border/70 bg-background/70 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                        <p className="mt-2 font-medium text-foreground">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {financials.length > 0 && (
                    <div className="overflow-hidden rounded-xl border border-border/70">
                      <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-border/70 bg-background/60 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        <span>Category</span>
                        <span className="text-right">Amount</span>
                      </div>
                      <div className="divide-y divide-border/70">
                        {financials.map((snap, index) => {
                          const cat = asString(snap.category) ?? `Snapshot ${index + 1}`;
                          const amt = asNumber(snap.amount);
                          const gdvVal = asNumber(snap.gdv);
                          const tdcVal = asNumber(snap.tdc);
                          const displayAmt = amt ?? gdvVal ?? tdcVal;
                          return (
                            <div
                              key={String(snap.id ?? index)}
                              className="grid grid-cols-[1fr_auto] gap-2 px-3 py-2.5 text-sm"
                            >
                              <span className="text-foreground">{sentenceCase(cat)}</span>
                              <span className="text-right font-medium text-foreground">
                                {displayAmt !== null ? formatCurrency(displayAmt) : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          }

          risks={
            <section className="flex flex-col gap-4">
              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-primary" />
                    Risks
                  </CardTitle>
                  <CardDescription>Active risk items from the current context payload.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {risks.length > 0 ? (
                    risks.slice(0, 6).map((risk, index) => {
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
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>Tasks</CardTitle>
                      <CardDescription>Current tasks linked to this deal.</CardDescription>
                    </div>
                    <Badge variant="outline">{tasks.length} total</Badge>
                  </div>
                </CardHeader>
                <CardContent>
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
                </CardContent>
              </Card>
            </section>
          }

          investors={
            <section className="flex flex-col gap-4">
              <InvestorPanel dealId={dealId} />
              <Card className="border-border/70 bg-card/95">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BadgeDollarSign className="size-4 text-primary" />
                    Pipeline Summary
                  </CardTitle>
                  <CardDescription>
                    Workflow and capital context for this deal.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Open tasks",              value: String(tasks.length) },
                    { label: "Financial snapshots",     value: String(financials.length) },
                    { label: "Communications logged",   value: String(communications.length) },
                    { label: "Capital target",          value: capitalTarget !== null ? formatCurrency(capitalTarget) : "Not set" },
                    { label: "Total committed",         value: totalCommitted !== null ? formatCurrency(totalCommitted) : "Not set" },
                    { label: "Remaining capital need",  value: remainingCapital !== null ? formatCurrency(remainingCapital) : "Not set" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-sm"
                    >
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-medium text-foreground">{item.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>
          }

          timeline={
            <section className="flex flex-col gap-4">
              <DealTimeline dealId={dealId} />
            </section>
          }

          reports={
            <section className="flex flex-col gap-4">
              <DealReports dealId={dealId} />
            </section>
          }

          chat={
            <section className="flex flex-col gap-4">
              <DealChat
                dealId={dealId}
                dealContext={{
                  dealName: dealName !== "Untitled deal" ? dealName : null,
                  address: firstString(deal, ["address"]),
                  score,
                  strategy: firstString(deal, ["strategy"]),
                  stage: dealStage,
                  summary: firstString(feed, ["summary"]),
                }}
              />
            </section>
          }
        />
      </div>
    </main>
  );
}

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  if (!id) return notFound();

  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const rawIds = typeof sp.ids === "string" ? sp.ids : "";
  const allIds = rawIds ? rawIds.split(",").filter(Boolean) : [];
  const rawIndex = typeof sp.i === "string" ? parseInt(sp.i, 10) : -1;
  const currentIndex = Number.isFinite(rawIndex) ? rawIndex : allIds.indexOf(id);
  const prevId = currentIndex > 0 ? (allIds[currentIndex - 1] ?? null) : null;
  const nextId = currentIndex >= 0 && currentIndex < allIds.length - 1
    ? (allIds[currentIndex + 1] ?? null)
    : null;

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
      <DealWorkspaceContent
        dealId={id}
        prevId={prevId}
        nextId={nextId}
        filter={filter}
        allIds={allIds}
        currentIndex={currentIndex}
      />
    </Suspense>
  );
}
