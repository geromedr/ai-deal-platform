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

export function getStrategyFromDeal(value: unknown) {
  if (!isRecord(value)) return null;
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  const strategy = metadata?.strategy;
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

export function computePriorityScore(input: {
  score: number | null;
  margin: number | null;
  floodRisk: string | null;
  risks: DealRiskRecord[];
}) {
  const scoreComponent = input.score ?? 0;
  const marginComponent = input.margin !== null ? input.margin * 100 * 0.6 : 0;
  const riskPenalty = getFloodRiskPenalty(input.floodRisk) +
    getRiskSeverityPenalty(input.risks);

  return Number((scoreComponent + marginComponent - riskPenalty).toFixed(2));
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
