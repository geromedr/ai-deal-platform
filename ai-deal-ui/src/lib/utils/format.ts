/**
 * Shared formatting utilities used across the deal platform UI.
 * Import from here rather than duplicating inline.
 */

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCurrencyShort(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "Not available";
  // Normalise: values ≤ 1 are decimals (0.18 → 18%), values > 1 are already percentages
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`;
}

export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (value == null) return "Not available";
  return new Intl.NumberFormat("en-AU", {
    maximumFractionDigits: 0,
    ...options,
  }).format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value || typeof value !== "string" || value.trim().length === 0)
    return "Not available";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatDateTimeShort(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(d);
}

/** Convert snake_case / kebab-case strings to Title Case. Returns "—" for null/empty. */
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Same as sentenceCase but returns "Not available" for null/empty (used in workspace). */
export function sentenceCaseOrNA(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Relative time label — "2 hours ago", "3 days ago", etc. */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(value);
}
