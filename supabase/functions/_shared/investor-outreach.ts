export type TldrEntry = {
  label: string;
  value: string;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function formatCompactCurrency(value: unknown) {
  try {
    const parsed = parseNumber(value);
    if (parsed === null) return null;

    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(parsed);
  } catch (error) {
    console.error("investor-outreach formatCompactCurrency failed", { error });
    return null;
  }
}

export function formatPercentLabel(value: unknown) {
  try {
    const parsed = parseNumber(value);
    if (parsed === null) return null;

    const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
    return `${(normalized * 100).toFixed(normalized * 100 >= 10 ? 0 : 1)}%`;
  } catch (error) {
    console.error("investor-outreach formatPercentLabel failed", { error });
    return null;
  }
}

export function formatTldrHierarchy(title: string, entries: TldrEntry[]) {
  try {
    const safeTitle = typeof title === "string" && title.trim().length > 0
      ? title.trim()
      : "TL;DR";
    const safeEntries = Array.isArray(entries) ? entries : [];
    const lines = [safeTitle];

    for (const entry of safeEntries) {
      const label = typeof entry?.label === "string" ? entry.label.trim() : "";
      const value = typeof entry?.value === "string" ? entry.value.trim() : "";
      if (!label || !value) continue;
      lines.push(`- ${label}: ${value}`);
    }

    return lines.join("\n");
  } catch (error) {
    console.error("investor-outreach formatTldrHierarchy failed", { error });
    return "TL;DR";
  }
}
