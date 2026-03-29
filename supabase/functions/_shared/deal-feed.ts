export type DealRiskRecord = {
  severity?: string | null;
  status?: string | null;
};

export type UserPreferenceRecord = {
  user_id?: string | null;
  min_score?: number | null;
  preferred_strategy?: string | null;
  notification_level?: string | null;
};

export type ScoringWeights = {
  score_multiplier: number;
  margin_multiplier: number;
  flood_penalty_multiplier: number;
  risk_penalty_multiplier: number;
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  score_multiplier: 1,
  margin_multiplier: 0.6,
  flood_penalty_multiplier: 1,
  risk_penalty_multiplier: 1,
};

const SCORING_WEIGHT_BOUNDS: Record<keyof ScoringWeights, { min: number; max: number }> = {
  score_multiplier: { min: 0.85, max: 1.15 },
  margin_multiplier: { min: 0.35, max: 0.9 },
  flood_penalty_multiplier: { min: 0.75, max: 1.4 },
  risk_penalty_multiplier: { min: 0.75, max: 1.4 },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseMargin(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  if (parsed > 1 && parsed <= 100) return parsed / 100;
  return parsed;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getStrategyFromDeal(value: unknown) {
  if (!isRecord(value)) return null;
  const strategy = value.strategy;
  return typeof strategy === "string" && strategy.trim().length > 0
    ? strategy.trim()
    : null;
}

export function getMarginFromFeedMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;

  const directMargin = parseMargin(metadata.margin);
  if (directMargin !== null) return directMargin;

  const context = isRecord(metadata.context) ? metadata.context : null;
  const contextFinancials = parseMargin(context?.financials);
  if (contextFinancials !== null) return contextFinancials;

  const feasibility = isRecord(metadata.feasibility)
    ? metadata.feasibility
    : null;
  return parseMargin(feasibility?.margin);
}

export function getMarginFromFinancialMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const feasibility = isRecord(metadata.feasibility)
    ? metadata.feasibility
    : null;
  return parseMargin(feasibility?.margin);
}

function getFloodRiskPenalty(floodRisk: string | null) {
  const normalized = floodRisk?.trim().toLowerCase() ?? "";
  if (!normalized) return 0;
  if (normalized.includes("high")) return 15;
  if (normalized.includes("medium")) return 8;
  if (normalized.includes("low")) return 0;
  return 4;
}

function getRiskSeverityPenalty(risks: DealRiskRecord[]) {
  let penalty = 0;

  for (const risk of risks) {
    const status = risk.status?.trim().toLowerCase() ?? "";
    if (status === "closed" || status === "resolved" || status === "done") {
      continue;
    }

    const severity = risk.severity?.trim().toLowerCase() ?? "";
    if (severity === "high" || severity === "critical") penalty += 10;
    else if (severity === "medium") penalty += 5;
    else if (severity === "low") penalty += 2;
    else penalty += 3;
  }

  return Math.min(penalty, 20);
}

export function normalizeScoringWeights(value: unknown): ScoringWeights {
  const weights = isRecord(value) ? value : {};
  const nextWeights: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS };

  for (const key of Object.keys(DEFAULT_SCORING_WEIGHTS) as Array<keyof ScoringWeights>) {
    const parsed = parseNumber(weights[key]);
    const bounds = SCORING_WEIGHT_BOUNDS[key];
    nextWeights[key] = parsed === null
      ? DEFAULT_SCORING_WEIGHTS[key]
      : Number(clampNumber(parsed, bounds.min, bounds.max).toFixed(4));
  }

  return nextWeights;
}

export function adjustScoringWeights(input: {
  previousWeights?: unknown;
  outcomeType: string | null;
  predictedReturn: number | null;
  actualReturn: number | null;
  predictedPriorityScore: number | null;
}) {
  const previousWeights = normalizeScoringWeights(input.previousWeights);
  const normalizedOutcome = (input.outcomeType ?? "").trim().toLowerCase();
  const actualReturn = input.actualReturn;
  const predictedReturn = input.predictedReturn;
  const returnDelta = actualReturn !== null && predictedReturn !== null
    ? clampNumber(actualReturn - predictedReturn, -0.25, 0.25)
    : 0;

  let scoreShift = returnDelta * 0.18;
  let marginShift = returnDelta * 0.4;
  let penaltyShift = returnDelta * -0.25;

  if (normalizedOutcome === "won") {
    scoreShift += 0.02;
    marginShift += 0.03;
    penaltyShift -= 0.02;
  } else if (normalizedOutcome === "lost") {
    scoreShift -= 0.04;
    marginShift -= 0.05;
    penaltyShift += 0.05;
  } else if (normalizedOutcome === "in_progress") {
    scoreShift += 0.005;
  }

  if (
    normalizedOutcome === "lost" &&
    input.predictedPriorityScore !== null &&
    input.predictedPriorityScore >= 85
  ) {
    scoreShift -= 0.02;
    penaltyShift += 0.03;
  }

  const adjustedWeights = normalizeScoringWeights({
    score_multiplier: previousWeights.score_multiplier + scoreShift,
    margin_multiplier: previousWeights.margin_multiplier + marginShift,
    flood_penalty_multiplier: previousWeights.flood_penalty_multiplier + penaltyShift,
    risk_penalty_multiplier: previousWeights.risk_penalty_multiplier + penaltyShift,
  });

  const adjustmentFactor = Number(
    (
      Math.abs(adjustedWeights.score_multiplier - previousWeights.score_multiplier) +
      Math.abs(adjustedWeights.margin_multiplier - previousWeights.margin_multiplier) +
      Math.abs(adjustedWeights.flood_penalty_multiplier - previousWeights.flood_penalty_multiplier) +
      Math.abs(adjustedWeights.risk_penalty_multiplier - previousWeights.risk_penalty_multiplier)
    ).toFixed(4),
  );

  return {
    previousWeights,
    adjustedWeights,
    adjustmentFactor,
    returnDelta: Number(returnDelta.toFixed(4)),
  };
}

export function computePriorityScore(input: {
  score: number | null;
  margin: number | null;
  floodRisk: string | null;
  risks: DealRiskRecord[];
  weights?: unknown;
}) {
  const weights = normalizeScoringWeights(input.weights);
  const scoreComponent = (input.score ?? 0) * weights.score_multiplier;
  const marginComponent = input.margin !== null
    ? input.margin * 100 * weights.margin_multiplier
    : 0;
  const floodPenalty = getFloodRiskPenalty(input.floodRisk) *
    weights.flood_penalty_multiplier;
  const riskPenalty = getRiskSeverityPenalty(input.risks) *
    weights.risk_penalty_multiplier;

  return Number((scoreComponent + marginComponent - floodPenalty - riskPenalty).toFixed(2));
}

export function computeEngagementScore(input: {
  views: number | null;
  actionsTaken: number | null;
}) {
  const views = input.views ?? 0;
  const actionsTaken = input.actionsTaken ?? 0;

  return Number((views * 0.25 + actionsTaken * 6).toFixed(2));
}

export function computeCompositeDealScore(input: {
  priorityScore: number | null;
  views: number | null;
  actionsTaken: number | null;
}) {
  return Number(
    (
      (input.priorityScore ?? 0) +
      computeEngagementScore({
        views: input.views,
        actionsTaken: input.actionsTaken,
      })
    ).toFixed(2),
  );
}

export function classifyNotificationType(input: {
  score: number | null;
  priorityScore: number | null;
}) {
  const priorityScore = input.priorityScore ?? Number.NEGATIVE_INFINITY;
  const score = input.score ?? Number.NEGATIVE_INFINITY;

  if (priorityScore >= 85 || score >= 80) {
    return "high_priority";
  }

  return "standard";
}

export function normalizeNotificationLevel(value: unknown) {
  const normalized = parseString(value)?.toLowerCase() ?? null;

  if (
    normalized === "all" ||
    normalized === "standard" ||
    normalized === "standard_and_high" ||
    normalized === "high_priority_only" ||
    normalized === "high_only" ||
    normalized === "muted"
  ) {
    return normalized;
  }

  return "high_priority_only";
}

export function notificationLevelAllows(
  notificationLevel: unknown,
  notificationType: "high_priority" | "standard",
) {
  const normalized = normalizeNotificationLevel(notificationLevel);

  if (normalized === "muted") {
    return false;
  }

  if (notificationType === "high_priority") {
    return true;
  }

  return (
    normalized === "all" ||
    normalized === "standard" ||
    normalized === "standard_and_high"
  );
}

export function matchesUserPreferences(input: {
  score: number | null;
  strategy: string | null;
  preferences: UserPreferenceRecord | null;
}) {
  const preferences = input.preferences;
  if (!preferences) {
    return true;
  }

  const minScore = parseNumber(preferences.min_score);
  if (
    minScore !== null && (input.score ?? Number.NEGATIVE_INFINITY) < minScore
  ) {
    return false;
  }

  const preferredStrategy = parseString(preferences.preferred_strategy);
  if (preferredStrategy && input.strategy) {
    return input.strategy.trim().toLowerCase() ===
      preferredStrategy.toLowerCase();
  }

  return preferredStrategy ? false : true;
}

export async function incrementDealPerformanceMetrics(
  supabase: any,
  input: {
    deal_id: string;
    views?: number;
    notifications_sent?: number;
    actions_taken?: number;
    mark_viewed?: boolean;
  },
) {
  const { error } = await supabase.rpc("increment_deal_performance_metrics", {
    p_deal_id: input.deal_id,
    p_views: input.views ?? 0,
    p_notifications_sent: input.notifications_sent ?? 0,
    p_actions_taken: input.actions_taken ?? 0,
    p_mark_viewed: input.mark_viewed ?? false,
  });

  if (error) {
    throw new Error(error.message ?? "Failed to increment deal performance");
  }
}
