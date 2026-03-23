import { createClient } from "https://esm.sh/@supabase/supabase-js"

export type OrchestrationEvent =
  | "post-discovery"
  | "post-intelligence"
  | "post-ranking"
  | "post-financial"

export type EventContext = {
  deal_id: string
  event: OrchestrationEvent
  score: number | null
  zoning: string | null
  zoning_density: string | null
  flood_risk: string | null
  yield: number | null
  financials: number | null
}

type RuleEngineResponse = {
  success?: boolean
  executed_actions?: Array<Record<string, unknown>>
  skipped_rules?: Array<Record<string, unknown>>
  warnings?: string[]
}

type DispatchActionRow = {
  id: string
  action?: string | null
  created_at?: string | null
  payload?: unknown
}

type ExistingDispatchState =
  | {
      status: "completed"
      row: DispatchActionRow
      cachedResponse: RuleEngineResponse | null
      matchType: "exact" | "legacy_fallback"
      contextHash: string | null
    }
  | {
      status: "in_progress"
      row: DispatchActionRow
      matchType: "exact" | "legacy_fallback"
      contextHash: string | null
    }

export type DispatchEventResult = {
  success: boolean
  skipped?: boolean
  duplicate?: boolean
  reason?: string
  data?: RuleEngineResponse | null
  error?: string
  warnings?: string[]
}

type TriggerEventParams = {
  supabaseUrl: string
  serviceKey: string
  authorizationHeader?: string | null
  sourceAgent: string
  dealId: string
  event: OrchestrationEvent
  actionContext?: Record<string, unknown>
  eventContext?: Partial<EventContext>
}

const DISPATCHER_AGENT = "event-dispatcher"
const EVENT_TRIGGERED_ACTION = "event_triggered"
const EVENT_DUPLICATE_SKIPPED_ACTION = "event_duplicate_skipped"
const RULE_ENGINE_INVOKED_ACTION = "rule_engine_invoked"
const DISPATCH_STATUS_IN_PROGRESS = "in_progress"
const DISPATCH_STATUS_COMPLETED = "completed"
const DISPATCH_STATUS_FAILED = "failed"

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error")
  }
  return "Unknown error"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function classifyZoningDensity(zoning: string | null) {
  if (!zoning) return null
  const normalized = zoning.trim().toUpperCase()

  if (normalized.startsWith("R4") || normalized.includes("HIGH DENSITY")) {
    return "high-density"
  }

  if (normalized.startsWith("R3") || normalized.includes("MEDIUM DENSITY")) {
    return "medium-density"
  }

  if (normalized.startsWith("R2") || normalized.includes("LOW DENSITY")) {
    return "low-density"
  }

  return "unknown"
}

function normalizeHashString(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : null
}

function buildHashInput(context: EventContext) {
  return {
    score: context.score,
    zoning: context.zoning,
    yield: context.yield,
    financials: context.financials
  }
}

async function buildContextHash(context: EventContext) {
  const encoder = new TextEncoder()
  const payload = JSON.stringify(buildHashInput(context))
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(payload))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function buildRestHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey
  }
}

function buildFunctionHeaders(serviceKey: string, authorizationHeader?: string | null) {
  const normalizedAuth =
    typeof authorizationHeader === "string" && authorizationHeader.trim().length > 0
      ? authorizationHeader.trim()
      : null
  const bearerToken = normalizedAuth?.toLowerCase().startsWith("bearer ")
    ? normalizedAuth
    : `Bearer ${serviceKey}`

  return {
    "Content-Type": "application/json",
    "Authorization": bearerToken,
    "apikey": serviceKey
  }
}

async function logDispatchAction(
  supabase: ReturnType<typeof createClient>,
  dealId: string,
  action: string,
  payload: Record<string, unknown>
) {
  const { error } = await supabase
    .from("ai_actions")
    .insert({
      deal_id: dealId,
      agent: DISPATCHER_AGENT,
      action,
      payload
    })

  if (error) {
    throw new Error(error.message)
  }
}

async function findExistingInvocation(
  supabase: ReturnType<typeof createClient>,
  dealId: string,
  event: OrchestrationEvent,
  contextHash: string
) : Promise<ExistingDispatchState | null> {
  const { data, error } = await supabase
    .from("ai_actions")
    .select("id,action,created_at,payload")
    .eq("deal_id", dealId)
    .eq("agent", DISPATCHER_AGENT)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data as DispatchActionRow[] | null)?.filter((row) =>
    row.action === EVENT_TRIGGERED_ACTION || row.action === RULE_ENGINE_INVOKED_ACTION
  ) ?? []

  const eventRows = rows.filter((row) => isRecord(row.payload) && row.payload.event === event)
  const hashedEventRows = eventRows.filter((row) =>
    isRecord(row.payload) && normalizeHashString(
      typeof row.payload.context_hash === "string" ? row.payload.context_hash : null
    ) !== null
  )

  const findMatch = (
    matchRows: DispatchActionRow[],
    matchType: "exact" | "legacy_fallback"
  ): ExistingDispatchState | null => {
    const completedInvocation = matchRows.find((row) =>
      row.action === RULE_ENGINE_INVOKED_ACTION &&
      isRecord(row.payload) &&
      row.payload.status === DISPATCH_STATUS_COMPLETED
    )

    if (completedInvocation && isRecord(completedInvocation.payload)) {
      return {
        status: "completed",
        row: completedInvocation,
        cachedResponse: isRecord(completedInvocation.payload.rule_engine_response)
          ? completedInvocation.payload.rule_engine_response as RuleEngineResponse
          : null,
        matchType,
        contextHash: normalizeHashString(
          typeof completedInvocation.payload.context_hash === "string"
            ? completedInvocation.payload.context_hash
            : null
        )
      }
    }

    const latestTrigger = matchRows.find((row) =>
      row.action === EVENT_TRIGGERED_ACTION &&
      isRecord(row.payload) &&
      row.payload.status === DISPATCH_STATUS_IN_PROGRESS
    )

    if (latestTrigger && isRecord(latestTrigger.payload)) {
      return {
        status: "in_progress",
        row: latestTrigger,
        matchType,
        contextHash: normalizeHashString(
          typeof latestTrigger.payload.context_hash === "string"
            ? latestTrigger.payload.context_hash
            : null
        )
      }
    }

    return null
  }

  const exactRows = hashedEventRows.filter((row) =>
    isRecord(row.payload) && normalizeHashString(
      typeof row.payload.context_hash === "string" ? row.payload.context_hash : null
    ) === contextHash
  )
  const exactMatch = findMatch(exactRows, "exact")
  if (exactMatch) return exactMatch

  if (hashedEventRows.length === 0) {
    const legacyRows = eventRows.filter((row) =>
      isRecord(row.payload) &&
      normalizeHashString(typeof row.payload.context_hash === "string" ? row.payload.context_hash : null) === null
    )
    const legacyMatch = findMatch(legacyRows, "legacy_fallback")
    if (legacyMatch) return legacyMatch
  }

  return null
}

async function buildEventContext(
  supabase: ReturnType<typeof createClient>,
  dealId: string,
  event: OrchestrationEvent,
  overrides: Partial<EventContext>
): Promise<EventContext> {
  const [siteResponse, financialResponse, rankingResponse] = await Promise.all([
    supabase
      .from("site_intelligence")
      .select("zoning,flood_risk,estimated_units,updated_at")
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("financial_snapshots")
      .select("metadata,created_at")
      .eq("deal_id", dealId)
      .eq("category", "financial-engine")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("site_candidates")
      .select("ranking_score,updated_at")
      .eq("source", "site-intelligence-agent")
      .eq("external_id", dealId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ])

  if (siteResponse.error) throw new Error(siteResponse.error.message)
  if (financialResponse.error) throw new Error(financialResponse.error.message)
  if (rankingResponse.error) throw new Error(rankingResponse.error.message)

  const site = siteResponse.data
  const ranking = rankingResponse.data
  const financialMetadata = isRecord(financialResponse.data?.metadata)
    ? financialResponse.data.metadata
    : null
  const feasibility = financialMetadata && isRecord(financialMetadata.feasibility)
    ? financialMetadata.feasibility
    : null

  const baseContext: EventContext = {
    deal_id: dealId,
    event,
    score: parseNumber(ranking?.ranking_score ?? null),
    zoning: normalizeString(site?.zoning ?? null),
    zoning_density: classifyZoningDensity(normalizeString(site?.zoning ?? null)),
    flood_risk: normalizeString(site?.flood_risk ?? null),
    yield: parseNumber(site?.estimated_units ?? null),
    financials: parseNumber(feasibility?.margin ?? null)
  }

  return {
    ...baseContext,
    ...overrides,
    deal_id: dealId,
    event,
    zoning_density: normalizeString(overrides.zoning_density) ?? classifyZoningDensity(normalizeString(overrides.zoning) ?? baseContext.zoning)
  }
}

export async function triggerEvent({
  supabaseUrl,
  serviceKey,
  authorizationHeader = null,
  sourceAgent,
  dealId,
  event,
  actionContext = {},
  eventContext = {}
}: TriggerEventParams): Promise<DispatchEventResult> {
  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    const resolvedEventContext = await buildEventContext(supabase, dealId, event, eventContext)
    const contextHash = await buildContextHash(resolvedEventContext)
    const existingInvocation = await findExistingInvocation(supabase, dealId, event, contextHash)
    if (existingInvocation) {
      try {
        await logDispatchAction(supabase, dealId, EVENT_DUPLICATE_SKIPPED_ACTION, {
          event,
          source_agent: sourceAgent,
          context_hash: contextHash,
          event_context: resolvedEventContext,
          dispatch_status: existingInvocation.status,
          match_type: existingInvocation.matchType,
          existing_action: existingInvocation.row.action ?? null,
          existing_action_id: existingInvocation.row.id,
          existing_created_at: existingInvocation.row.created_at ?? null,
          existing_status: existingInvocation.status,
          existing_context_hash: existingInvocation.contextHash,
          skip_reason: existingInvocation.matchType === "exact"
            ? "exact_context_match"
            : "legacy_event_match"
        })
      } catch (error) {
        console.warn("event-dispatch duplicate log failed", {
          deal_id: dealId,
          event,
          source_agent: sourceAgent,
          error: getErrorMessage(error)
        })
      }

      return {
        success: true,
        skipped: true,
        duplicate: true,
        reason: existingInvocation.status === "completed"
          ? existingInvocation.matchType === "exact"
            ? `Event ${event} already processed for deal ${dealId} with matching context`
            : `Event ${event} already processed for deal ${dealId} via legacy event fallback`
          : existingInvocation.matchType === "exact"
            ? `Event ${event} is already in progress for deal ${dealId} with matching context`
            : `Event ${event} is already in progress for deal ${dealId} via legacy event fallback`,
        data: existingInvocation.status === "completed" ? existingInvocation.cachedResponse : null,
        warnings: existingInvocation.status === "completed"
          ? existingInvocation.cachedResponse?.warnings
          : []
      }
    }

    await logDispatchAction(supabase, dealId, EVENT_TRIGGERED_ACTION, {
      event,
      source_agent: sourceAgent,
      context_hash: contextHash,
      status: DISPATCH_STATUS_IN_PROGRESS,
      match_type: "none",
      action_context: actionContext,
      event_context: resolvedEventContext
    })

    const response = await fetch(`${supabaseUrl}/functions/v1/rule-engine-agent`, {
      method: "POST",
      headers: buildFunctionHeaders(serviceKey, authorizationHeader),
      body: JSON.stringify({
        deal_id: dealId,
        event,
        action_context: actionContext,
        event_context: resolvedEventContext
      })
    })

    const responseText = await response.text()
    let responseBody: unknown = null

    try {
      responseBody = responseText ? JSON.parse(responseText) : null
    } catch {
      responseBody = responseText
    }

    const normalizedResponse = isRecord(responseBody)
      ? responseBody as RuleEngineResponse
      : null

    const dispatchPayload = {
      event,
      source_agent: sourceAgent,
      context_hash: contextHash,
      success: response.ok,
      status: response.ok ? DISPATCH_STATUS_COMPLETED : DISPATCH_STATUS_FAILED,
      match_type: "none",
      action_context: actionContext,
      event_context: resolvedEventContext,
      rule_engine_response: normalizedResponse ?? null,
      error: response.ok
        ? null
        : isRecord(responseBody) && typeof responseBody.error === "string"
          ? responseBody.error
          : typeof responseBody === "string"
            ? responseBody
            : `rule-engine-agent returned HTTP ${response.status}`
    }

    try {
      await logDispatchAction(supabase, dealId, RULE_ENGINE_INVOKED_ACTION, dispatchPayload)
    } catch (error) {
      console.warn("event-dispatch invocation log failed", {
        deal_id: dealId,
        event,
        source_agent: sourceAgent,
        error: getErrorMessage(error)
      })
    }

    if (!response.ok) {
      return {
        success: false,
        error: dispatchPayload.error ?? "rule-engine-agent failed"
      }
    }

    return {
      success: true,
      data: normalizedResponse,
      warnings: Array.isArray(normalizedResponse?.warnings)
        ? normalizedResponse.warnings.filter((warning): warning is string => typeof warning === "string")
        : []
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error)
    }
  }
}

export function buildDispatcherHeaders(serviceKey: string) {
  return buildRestHeaders(serviceKey)
}
