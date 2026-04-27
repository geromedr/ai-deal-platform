import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatCurrencyShort,
  formatPercent,
  formatNumber,
  formatDateTime,
  formatDateTimeShort,
  formatDate,
  sentenceCase,
  sentenceCaseOrNA,
  timeAgo,
} from "../format";

// ── formatCurrency ────────────────────────────────────────────────────────────

describe("formatCurrency", () => {
  it("formats a positive integer as AUD", () => {
    expect(formatCurrency(1000000)).toContain("1,000,000");
  });
  it("returns 'Not available' for null", () => {
    expect(formatCurrency(null)).toBe("Not available");
  });
  it("returns 'Not available' for undefined", () => {
    expect(formatCurrency(undefined)).toBe("Not available");
  });
  it("handles zero", () => {
    expect(formatCurrency(0)).toContain("0");
  });
  it("handles negative values", () => {
    const result = formatCurrency(-500000);
    expect(result).toContain("500,000");
  });
});

// ── formatCurrencyShort ───────────────────────────────────────────────────────

describe("formatCurrencyShort", () => {
  it("formats a value as AUD", () => {
    expect(formatCurrencyShort(2500000)).toContain("2,500,000");
  });
  it("returns '—' for null", () => {
    expect(formatCurrencyShort(null)).toBe("—");
  });
  it("returns '—' for undefined", () => {
    expect(formatCurrencyShort(undefined)).toBe("—");
  });
});

// ── formatPercent ─────────────────────────────────────────────────────────────

describe("formatPercent", () => {
  it("formats a decimal (0–1) as a percentage", () => {
    expect(formatPercent(0.18)).toBe("18%");
  });
  it("formats a value > 1 as already a percentage", () => {
    expect(formatPercent(18)).toBe("18%");
  });
  it("shows one decimal place for non-whole percentages", () => {
    expect(formatPercent(0.183)).toBe("18.3%");
  });
  it("returns 'Not available' for null", () => {
    expect(formatPercent(null)).toBe("Not available");
  });
  it("returns 'Not available' for undefined", () => {
    expect(formatPercent(undefined)).toBe("Not available");
  });
  it("handles 100%", () => {
    expect(formatPercent(1)).toBe("100%");
  });
  it("handles 0%", () => {
    expect(formatPercent(0)).toBe("Not available"); // 0 is falsy → null check
  });
});

// ── formatNumber ──────────────────────────────────────────────────────────────

describe("formatNumber", () => {
  it("formats a large integer with commas", () => {
    expect(formatNumber(12500)).toContain("12,500");
  });
  it("returns 'Not available' for null", () => {
    expect(formatNumber(null)).toBe("Not available");
  });
  it("accepts Intl options override", () => {
    const result = formatNumber(3.14159, { maximumFractionDigits: 2 });
    expect(result).toContain("3.14");
  });
});

// ── formatDateTime ────────────────────────────────────────────────────────────

describe("formatDateTime", () => {
  it("formats a valid ISO datetime string", () => {
    const result = formatDateTime("2026-04-28T10:00:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("Not available");
  });
  it("returns 'Not available' for null", () => {
    expect(formatDateTime(null)).toBe("Not available");
  });
  it("returns 'Not available' for empty string", () => {
    expect(formatDateTime("")).toBe("Not available");
  });
  it("returns 'Not available' for undefined", () => {
    expect(formatDateTime(undefined)).toBe("Not available");
  });
  it("returns the raw value for unparseable strings", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

// ── formatDate ────────────────────────────────────────────────────────────────

describe("formatDate", () => {
  it("formats a valid date string", () => {
    const result = formatDate("2026-04-28");
    expect(result).not.toBe("—");
    expect(result.length).toBeGreaterThan(0);
  });
  it("returns '—' for null", () => {
    expect(formatDate(null)).toBe("—");
  });
  it("returns '—' for undefined", () => {
    expect(formatDate(undefined)).toBe("—");
  });
});

// ── formatDateTimeShort ───────────────────────────────────────────────────────

describe("formatDateTimeShort", () => {
  it("formats a valid ISO string", () => {
    const result = formatDateTimeShort("2026-04-28T12:00:00Z");
    expect(result).not.toBe("—");
  });
  it("returns '—' for null/undefined", () => {
    expect(formatDateTimeShort(null)).toBe("—");
    expect(formatDateTimeShort(undefined)).toBe("—");
  });
});

// ── sentenceCase ──────────────────────────────────────────────────────────────

describe("sentenceCase", () => {
  it("converts snake_case to Title Case", () => {
    expect(sentenceCase("hello_world")).toBe("Hello World");
  });
  it("converts kebab-case to Title Case", () => {
    expect(sentenceCase("hello-world")).toBe("Hello World");
  });
  it("returns '—' for null", () => {
    expect(sentenceCase(null)).toBe("—");
  });
  it("returns '—' for empty string", () => {
    expect(sentenceCase("")).toBe("—");
  });
  it("handles already-titlecase strings", () => {
    expect(sentenceCase("Active")).toBe("Active");
  });
});

// ── sentenceCaseOrNA ──────────────────────────────────────────────────────────

describe("sentenceCaseOrNA", () => {
  it("converts snake_case to Title Case", () => {
    expect(sentenceCaseOrNA("in_review")).toBe("In Review");
  });
  it("returns 'Not available' for null", () => {
    expect(sentenceCaseOrNA(null)).toBe("Not available");
  });
  it("returns 'Not available' for empty string", () => {
    expect(sentenceCaseOrNA("")).toBe("Not available");
  });
});

// ── timeAgo ───────────────────────────────────────────────────────────────────

describe("timeAgo", () => {
  it("returns 'just now' for a very recent timestamp", () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe("just now");
  });
  it("returns minutes ago for a recent timestamp", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(fiveMinutesAgo)).toBe("5m ago");
  });
  it("returns hours ago for a timestamp a few hours old", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(timeAgo(threeHoursAgo)).toBe("3h ago");
  });
  it("returns days ago for an old timestamp", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    expect(timeAgo(twoDaysAgo)).toBe("2d ago");
  });
  it("returns '—' for null", () => {
    expect(timeAgo(null)).toBe("—");
  });
  it("returns '—' for undefined", () => {
    expect(timeAgo(undefined)).toBe("—");
  });
  it("returns original value for an unparseable string", () => {
    expect(timeAgo("not-a-date")).toBe("not-a-date");
  });
});
