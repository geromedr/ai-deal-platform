import { describe, it, expect } from "vitest";
import { SCORE_THRESHOLDS } from "../scoring";

describe("SCORE_THRESHOLDS", () => {
  it("has a HIGH threshold at 85", () => {
    expect(SCORE_THRESHOLDS.HIGH).toBe(85);
  });

  it("has a MEDIUM threshold at 60", () => {
    expect(SCORE_THRESHOLDS.MEDIUM).toBe(60);
  });

  it("HIGH is greater than MEDIUM", () => {
    expect(SCORE_THRESHOLDS.HIGH).toBeGreaterThan(SCORE_THRESHOLDS.MEDIUM);
  });

  it("both thresholds are within 0–100", () => {
    expect(SCORE_THRESHOLDS.HIGH).toBeGreaterThanOrEqual(0);
    expect(SCORE_THRESHOLDS.HIGH).toBeLessThanOrEqual(100);
    expect(SCORE_THRESHOLDS.MEDIUM).toBeGreaterThanOrEqual(0);
    expect(SCORE_THRESHOLDS.MEDIUM).toBeLessThanOrEqual(100);
  });
});
