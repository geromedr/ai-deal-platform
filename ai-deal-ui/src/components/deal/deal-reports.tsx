"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Download,
  FileText,
  Loader2,
  RefreshCcw,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTimeShort, formatPercent, sentenceCase } from "@/lib/utils/format";
import { escapeHtml } from "@/lib/utils/markdown";
import type { ReportsListResponse, ReportItem } from "@/app/api/deal-reports/route";

type DealReportsProps = { dealId: string };

// ─── Structured report types ─────────────────────────────────────────────────

type PlanningControls = {
  zoning?: string | null;
  fsr?: string | null;
  height_limit?: string | null;
  flood_risk?: string | null;
  heritage_status?: string | null;
};

type Feasibility = {
  estimated_revenue?: number | null;
  estimated_costs?: number | null;
  projected_profit?: number | null;
  margin?: number | null;
  residual_land_value?: number | null;
};

type ComparableSalesSummary = {
  available?: boolean;
  estimated_sale_price_per_sqm?: number | null;
  currency?: string;
  rationale?: string;
  source?: string;
};

type OpportunityScore = {
  score?: number | null;
  tier?: string;
  reason?: string;
};

type DevelopmentPotential = {
  gfa?: number | null;
  units?: number | null;
};

type StructuredReport = {
  address?: string;
  recommendation?: "Strong" | "Moderate" | "Weak" | string;
  reasoning?: string[];
  planning_controls?: PlanningControls;
  feasibility?: Feasibility;
  comparable_sales_summary?: ComparableSalesSummary;
  opportunity_score?: OpportunityScore;
  development_potential?: DevelopmentPotential;
  context?: {
    stage?: string;
    status?: string;
    open_task_count?: number;
    risk_count?: number;
    latest_communication_summary?: string;
  };
};

type WarningEntry = {
  agent?: string;
  issue?: string;
  message?: string;
};

type ReportContent = {
  report?: StructuredReport;
  warnings?: WarningEntry[];
  human_readable_summary?: string;
  summary_source?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function recommendationColor(rec: string | null | undefined) {
  const r = (rec ?? "").toLowerCase();
  if (r === "strong") return "text-green-600 bg-green-50 border-green-200";
  if (r === "moderate") return "text-amber-600 bg-amber-50 border-amber-200";
  return "text-red-600 bg-red-50 border-red-200";
}

function recommendationIcon(rec: string | null | undefined) {
  const r = (rec ?? "").toLowerCase();
  if (r === "strong") return <TrendingUp className="size-3.5" />;
  if (r === "moderate") return <TrendingUp className="size-3.5 opacity-60" />;
  return <TrendingDown className="size-3.5" />;
}

function planningVal(v: string | null | undefined) {
  if (!v || v.toLowerCase() === "unknown" || v.toLowerCase() === "n/a") {
    return <span className="text-muted-foreground/50 italic">Unknown</span>;
  }
  return <span>{v}</span>;
}

function reportTypeBadge(reportType: string | null | undefined) {
  const t = (reportType ?? "").toLowerCase();
  if (t === "deal_report") return "default";
  if (t === "deal_pack") return "secondary";
  return "outline";
}

// ─── IM HTML generator ────────────────────────────────────────────────────────

function buildIMHtml(report: StructuredReport, humanSummary: string, createdAt: string | null | undefined): string {
  const now = new Date(createdAt ?? Date.now()).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const f = report;
  const pc = f.planning_controls ?? {};
  const fe = f.feasibility ?? {};
  const cs = f.comparable_sales_summary;
  const dp = f.development_potential ?? {};
  const rec = f.recommendation ?? "—";
  const score = f.opportunity_score;

  const fmt = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString("en-AU")}` : "—";
  const fmtPct = (n: number | null | undefined) =>
    n != null ? `${(n * 100).toFixed(1)}%` : "—";
  const fmtSqm = (n: number | null | undefined) =>
    n != null ? `$${n.toLocaleString("en-AU")} / sqm` : "—";

  const recColor =
    rec.toLowerCase() === "strong" ? "#16a34a" :
    rec.toLowerCase() === "moderate" ? "#d97706" : "#dc2626";

  const planRows = [
    ["Zoning", pc.zoning],
    ["Floor Space Ratio", pc.fsr],
    ["Height Limit", pc.height_limit],
    ["Flood Risk", pc.flood_risk],
    ["Heritage Status", pc.heritage_status],
  ].map(([label, value]) => `
    <tr>
      <td class="tbl-label">${escapeHtml(String(label))}</td>
      <td class="tbl-val">${value && value.toLowerCase() !== "unknown" ? escapeHtml(String(value)) : '<span style="color:#aaa;font-style:italic">Not assessed</span>'}</td>
    </tr>`).join("");

  const feasRows = [
    ["Estimated Revenue", fmt(fe.estimated_revenue)],
    ["Estimated Costs", fmt(fe.estimated_costs)],
    ["Projected Profit / (Loss)", fmt(fe.projected_profit)],
    ["Margin", fmtPct(fe.margin)],
    ["Residual Land Value", fmt(fe.residual_land_value)],
  ].map(([label, value]) => `
    <tr>
      <td class="tbl-label">${escapeHtml(String(label))}</td>
      <td class="tbl-val">${escapeHtml(String(value))}</td>
    </tr>`).join("");

  const reasoningHtml = (f.reasoning ?? [])
    .map((r) => `<li>${escapeHtml(r)}</li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Information Memorandum — ${escapeHtml(f.address ?? "Deal")}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.65;
      color: #1a1a1a;
      background: #fff;
      padding: 36px 48px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* Cover header */
    .cover-header {
      border-bottom: 3px solid #b6cc1a;
      padding-bottom: 18px;
      margin-bottom: 28px;
    }
    .brand {
      font-size: 7.5pt;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #999;
    }
    .doc-type {
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #b6cc1a;
      margin-top: 14px;
    }
    h1 {
      font-size: 22pt;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #111;
      margin-top: 4px;
      margin-bottom: 8px;
    }
    .meta-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .rec-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border-radius: 20px;
      padding: 3px 12px;
      font-size: 8.5pt;
      font-weight: 700;
      color: ${recColor};
      border: 1.5px solid ${recColor};
      background: ${recColor}12;
    }
    .score-pill {
      font-size: 8pt;
      font-weight: 600;
      color: #555;
      background: #f3f3f3;
      border: 1px solid #e0e0e0;
      border-radius: 20px;
      padding: 2px 10px;
    }
    .date {
      font-size: 8pt;
      color: #aaa;
      margin-left: auto;
    }

    /* Section headings */
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 7.5pt;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #7a9a00;
      border-bottom: 1px solid #e8f0b0;
      padding-bottom: 5px;
      margin-bottom: 12px;
    }
    p { margin-bottom: 8px; color: #222; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .tbl-label {
      font-size: 8.5pt;
      font-weight: 600;
      color: #555;
      width: 40%;
      padding: 6px 8px;
      border-bottom: 1px solid #f0f0f0;
      vertical-align: top;
    }
    .tbl-val {
      font-size: 9pt;
      font-weight: 500;
      color: #111;
      padding: 6px 8px;
      border-bottom: 1px solid #f0f0f0;
    }
    tr:last-child .tbl-label,
    tr:last-child .tbl-val { border-bottom: none; }
    .tbl-wrap {
      border: 1px solid #e8e8e8;
      border-radius: 8px;
      overflow: hidden;
      background: #fafafa;
    }

    /* KPI grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 10px;
      margin-bottom: 4px;
    }
    .kpi-card {
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: 10px 12px;
      background: #fafafa;
    }
    .kpi-label {
      font-size: 7pt;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 3px;
    }
    .kpi-value {
      font-size: 11pt;
      font-weight: 700;
      color: #111;
    }

    /* Reasoning list */
    ul.reasoning { padding-left: 18px; }
    ul.reasoning li { margin-bottom: 5px; font-size: 9.5pt; color: #333; }

    /* Comparable sales */
    .comp-box {
      background: #f8faf0;
      border: 1px solid #d4e06a;
      border-radius: 8px;
      padding: 12px 14px;
    }
    .comp-price {
      font-size: 14pt;
      font-weight: 700;
      color: #4a6400;
      margin-bottom: 4px;
    }
    .comp-rationale { font-size: 9pt; color: #555; line-height: 1.55; }

    /* Disclaimer */
    .disclaimer {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #e5e5e5;
      font-size: 7.5pt;
      color: #bbb;
      line-height: 1.5;
    }

    /* Footer */
    .footer {
      margin-top: 12px;
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: #bbb;
    }

    @media print {
      body { padding: 0; }
      @page { margin: 18mm 16mm; size: A4; }
    }
  </style>
</head>
<body>

  <!-- Cover Header -->
  <div class="cover-header">
    <div class="brand">AI Deal Platform · Information Memorandum</div>
    <div class="doc-type">Investment Opportunity</div>
    <h1>${escapeHtml(f.address ?? "Property Development Opportunity")}</h1>
    <div class="meta-row">
      <div class="rec-badge">${escapeHtml(rec)}</div>
      ${score?.tier && score.tier !== "Unrated" ? `<div class="score-pill">${escapeHtml(score.tier)}${score.score != null ? ` · ${score.score}` : ""}</div>` : ""}
      <div class="date">${now}</div>
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <p>${escapeHtml(humanSummary || "No summary available.")}</p>
  </div>

  <!-- KPI Grid -->
  ${fe.estimated_revenue != null || fe.projected_profit != null || dp.units != null ? `
  <div class="section">
    <div class="section-title">Key Metrics</div>
    <div class="kpi-grid">
      ${fe.estimated_revenue != null ? `<div class="kpi-card"><div class="kpi-label">Est. Revenue</div><div class="kpi-value">${fmt(fe.estimated_revenue)}</div></div>` : ""}
      ${fe.projected_profit != null ? `<div class="kpi-card"><div class="kpi-label">Projected Profit</div><div class="kpi-value">${fmt(fe.projected_profit)}</div></div>` : ""}
      ${fe.margin != null ? `<div class="kpi-card"><div class="kpi-label">Margin</div><div class="kpi-value">${fmtPct(fe.margin)}</div></div>` : ""}
      ${dp.units != null ? `<div class="kpi-card"><div class="kpi-label">Est. Units</div><div class="kpi-value">${dp.units}</div></div>` : ""}
      ${dp.gfa != null ? `<div class="kpi-card"><div class="kpi-label">Est. GFA</div><div class="kpi-value">${dp.gfa.toLocaleString("en-AU")} sqm</div></div>` : ""}
      ${cs?.estimated_sale_price_per_sqm != null ? `<div class="kpi-card"><div class="kpi-label">Sale Price / sqm</div><div class="kpi-value">${fmtSqm(cs.estimated_sale_price_per_sqm)}</div></div>` : ""}
    </div>
  </div>` : ""}

  <!-- Financial Analysis -->
  <div class="section">
    <div class="section-title">Financial Analysis</div>
    <div class="tbl-wrap">
      <table>${feasRows}</table>
    </div>
  </div>

  <!-- Planning Controls -->
  <div class="section">
    <div class="section-title">Planning Controls</div>
    <div class="tbl-wrap">
      <table>${planRows}</table>
    </div>
  </div>

  <!-- Market Evidence -->
  ${cs?.estimated_sale_price_per_sqm != null ? `
  <div class="section">
    <div class="section-title">Comparable Sales &amp; Market Evidence</div>
    <div class="comp-box">
      <div class="comp-price">${fmtSqm(cs.estimated_sale_price_per_sqm)} ${cs.currency ? `(${escapeHtml(cs.currency)})` : ""}</div>
      ${cs.rationale ? `<div class="comp-rationale">${escapeHtml(cs.rationale)}</div>` : ""}
    </div>
  </div>` : ""}

  <!-- AI Analysis Reasoning -->
  ${(f.reasoning ?? []).length > 0 ? `
  <div class="section">
    <div class="section-title">Assessment Reasoning</div>
    <ul class="reasoning">${reasoningHtml}</ul>
  </div>` : ""}

  <!-- Disclaimer -->
  <div class="disclaimer">
    This Information Memorandum has been prepared using AI-assisted analysis and is intended for indicative purposes only.
    It does not constitute financial, legal, or investment advice. All figures are estimates and should be independently
    verified prior to making any investment decision. This document is confidential and intended solely for the recipient.
  </div>

  <div class="footer">
    <span>Generated by AI Deal Platform</span>
    <span>Confidential — Not for Distribution</span>
  </div>

  <script>
    window.addEventListener("load", () => { setTimeout(() => window.print(), 400); });
  </script>
</body>
</html>`;
}

// ─── Structured report detail view ───────────────────────────────────────────

function PlanningGrid({ pc }: { pc: PlanningControls }) {
  const items = [
    { label: "Zoning", value: pc.zoning },
    { label: "FSR", value: pc.fsr },
    { label: "Height Limit", value: pc.height_limit },
    { label: "Flood Risk", value: pc.flood_risk },
    { label: "Heritage", value: pc.heritage_status },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(({ label, value }) => (
        <div key={label} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">{label}</p>
          <p className="mt-0.5 text-xs font-medium">{planningVal(value)}</p>
        </div>
      ))}
    </div>
  );
}

function FeasibilityTable({ fe }: { fe: Feasibility }) {
  const profitPositive = (fe.projected_profit ?? 0) >= 0;
  const rows = [
    { label: "Est. Revenue", value: formatCurrency(fe.estimated_revenue), highlight: false },
    { label: "Est. Costs", value: formatCurrency(fe.estimated_costs), highlight: false },
    {
      label: "Projected Profit",
      value: formatCurrency(fe.projected_profit),
      highlight: true,
      positive: profitPositive,
    },
    { label: "Margin", value: formatPercent(fe.margin), highlight: false },
    { label: "Residual Land Value", value: formatCurrency(fe.residual_land_value), highlight: false },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-border/50">
      {rows.map(({ label, value, highlight, positive }) => (
        <div
          key={label}
          className={`flex items-center justify-between px-3 py-1.5 text-xs border-b border-border/30 last:border-0 ${
            highlight ? (positive ? "bg-green-50/50" : "bg-red-50/50") : "bg-background/60"
          }`}
        >
          <span className="text-muted-foreground font-medium">{label}</span>
          <span className={`font-semibold tabular-nums ${highlight ? (positive ? "text-green-700" : "text-red-600") : ""}`}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

function DealReportDetail({
  content,
  createdAt,
}: {
  content: ReportContent;
  createdAt: string | null | undefined;
}) {
  const report = content.report;
  const warnings = content.warnings ?? [];
  const humanSummary = content.human_readable_summary ?? "";

  if (!report) {
    return (
      <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
        {JSON.stringify(content, null, 2)}
      </pre>
    );
  }

  const rec = report.recommendation ?? "—";
  const recClass = recommendationColor(rec);
  const dp = report.development_potential ?? {};
  const cs = report.comparable_sales_summary;

  return (
    <div className="mt-3 space-y-4 border-t border-border/40 pt-4">

      {/* Recommendation + score row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-semibold ${recClass}`}>
          {recommendationIcon(rec)}
          {rec}
        </span>
        {report.opportunity_score?.tier && report.opportunity_score.tier !== "Unrated" && (
          <span className="rounded-full border border-border/50 bg-muted/30 px-3 py-0.5 text-xs font-medium text-muted-foreground">
            {report.opportunity_score.tier}
            {report.opportunity_score.score != null && ` · ${report.opportunity_score.score}`}
          </span>
        )}
        {dp.units != null && (
          <span className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-3 py-0.5 text-xs text-muted-foreground">
            <Building2 className="size-3" />
            {dp.units} units · {dp.gfa?.toLocaleString("en-AU") ?? "—"} sqm GFA
          </span>
        )}
      </div>

      {/* AI summary */}
      {humanSummary && (
        <p className="text-sm text-muted-foreground leading-relaxed">{humanSummary}</p>
      )}

      {/* Feasibility */}
      {report.feasibility && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Feasibility</p>
          <FeasibilityTable fe={report.feasibility} />
        </div>
      )}

      {/* Planning controls */}
      {report.planning_controls && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Planning Controls</p>
          <PlanningGrid pc={report.planning_controls} />
        </div>
      )}

      {/* Comparable sales */}
      {cs?.estimated_sale_price_per_sqm != null && (
        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-1">Comparable Sales</p>
          <p className="text-sm font-bold text-foreground">
            ${cs.estimated_sale_price_per_sqm.toLocaleString("en-AU")} {cs.currency ?? "AUD"} / sqm
          </p>
          {cs.rationale && (
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{cs.rationale}</p>
          )}
        </div>
      )}

      {/* AI reasoning */}
      {(report.reasoning ?? []).length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">AI Reasoning</p>
          <ul className="space-y-1">
            {report.reasoning!.map((r, i) => (
              <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-primary/40 mt-1.5" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/40 px-3 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-700/70">
            <AlertTriangle className="size-3" />
            Pipeline Warnings
          </p>
          <ul className="space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-800/70">
                <span className="font-medium">{w.agent}</span>
                {w.message ? ` — ${w.message}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* IM export button */}
      <div className="pt-1">
        <button
          onClick={() => {
            const html = buildIMHtml(report, humanSummary, createdAt);
            const win = window.open("", "_blank");
            if (!win) return;
            win.document.write(html);
            win.document.close();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 bg-background/80 px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Download className="size-3.5" />
          Export IM (PDF)
        </button>
      </div>
    </div>
  );
}

// ─── Report row ───────────────────────────────────────────────────────────────

function ReportRow({ report }: { report: ReportItem }) {
  const [expanded, setExpanded] = useState(false);
  const title = report.summary ?? sentenceCase(report.report_type);
  const isDealReport = (report.report_type ?? "").toLowerCase() === "deal_report";
  const hasContent = report.content && Object.keys(report.content).length > 0;
  const typedContent = report.content as ReportContent | undefined;

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
          <span className="text-xs text-muted-foreground">{formatDateTimeShort(report.created_at)}</span>
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

      {expanded && typedContent ? (
        isDealReport ? (
          <DealReportDetail content={typedContent} createdAt={report.created_at} />
        ) : (
          <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(report.content, null, 2)}
          </pre>
        )
      ) : null}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

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
        const json = await res
          .json()
          .catch(() => { throw new Error(`Request failed (${res.status})`); }) as ReportsListResponse & { error?: string };
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
            <Button size="sm" variant="outline" onClick={() => load()} disabled={loading}>
              <RefreshCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => void handleGenerate()} disabled={generating}>
              {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
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
          <div className="space-y-3 animate-pulse" aria-label="Loading reports">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="h-3.5 w-2/3 rounded bg-muted" />
                    <div className="h-2.5 w-1/3 rounded bg-muted/70" />
                  </div>
                  <div className="h-5 w-16 rounded-full bg-muted shrink-0" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/50 px-4 py-6 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 size-5 opacity-40" />
            <p className="font-medium text-foreground/70">No reports yet</p>
            <p className="mt-1">
              Use the <span className="font-medium text-foreground/80">Generate Report</span> button above to create an AI-powered investment report for this deal.
            </p>
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
