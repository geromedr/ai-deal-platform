/**
 * Shared score threshold constants used across the deal platform UI.
 * Centralised here so a single change propagates everywhere.
 */

export const SCORE_THRESHOLDS = {
  /** High conviction threshold — score at or above this is "High Value" */
  HIGH: 85,
  /** Watchlist threshold — score at or above this (but below HIGH) is "Watchlist" */
  MEDIUM: 60,
} as const;
