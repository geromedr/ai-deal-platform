import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type RuleEngineEvent =
  | "post-ranking"
  | "post-intelligence"
  | "post-discovery"
  | "post-financial"

type RuleEngineRequest = {
  deal_id?: string
  event?: RuleEngineEvent
  action_context?: Record<string, unknown>
  event_context?: Partial<EvaluationContext>
}

type RuleConditionOperator = ">" | "<" | ">=" | "<=" | "==" | "!="

type RuleDefinition = {
  event: string
  condition: string
  action: string
  priority?: number
  payload?: Record<string, unknown>
  enabled?: boolean
  name?: string
}

type RuleRow = {
  id: string
  agent_name: string
  stage: string
  rule_description: string
  action_schema?: unknown
}

type StageResult = {
  success: boolean
  skipped?: boolean
  reason?: string
  data?: unknown
  error?: string
}

type EvaluationContext = {
  deal_id: string
  event: RuleEngineEvent
  score: number | null
  zoning: string | null
  zoning_density: string | null
  flood_risk: string | null
  yield: number | null
  financials: number | null
}

type EvaluatedRule = {
  rule: RuleDefinition
  source_rule_id: string
  matched: boolean
  reason: string
  warning?: string
}

type ParsedConditionClause = {
  field: string
  operator: RuleConditionOperator
  rawValue: string
}

const DEFAULT_REPORT_TRIGGER_SCORE_THRESHOLD = 50
const DEFAULT_AGENT_NAME = "rule-engine-agent"
const SUPPORTED_EVENTS = new Set<RuleEngineEvent>([
  "post-ranking",
  "post-intelligence",
  "post-discovery",
  "post-financial"
])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function getEnvNumber(name: string, fallback: number) {
  const value = Deno.env.get(name)
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return "Unknown error"
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function buildHeaders(serviceKey: string, authorizationHeader: string | null) {
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

function buildRestHeaders(serviceKey: string) {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceKey}`,
    "apikey": serviceKey
  }
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const match = value.match(/-?\d+(\.\d+)?/)
    if (!match) return null
    const parsed = Number(match[0])
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseRulesFromRow(row: RuleRow): RuleDefinition[] {
  const schema = row.action_schema
  if (!isRecord(schema)) return []

  const rules = Array.isArray(schema.rules) ? schema.rules : [schema]
  const parsed: RuleDefinition[] = []

  for (const rawRule of rules) {
    if (!isRecord(rawRule)) continue
    if (typeof rawRule.event !== "string") continue
    if (typeof rawRule.condition !== "string") continue
    if (typeof rawRule.action !== "string") continue

    parsed.push({
      event: rawRule.event,
      condition: rawRule.condition,
      action: rawRule.action,
      priority: typeof rawRule.priority === "number" ? rawRule.priority : 100,
      payload: isRecord(rawRule.payload) ? rawRule.payload : undefined,
      enabled: typeof rawRule.enabled === "boolean" ? rawRule.enabled : true,
      name: typeof rawRule.name === "string" ? rawRule.name : undefined
    })
  }

  return parsed
}

function getContextValue(context: EvaluationContext, field: string): number | string | null {
  if (field === "score") return context.score
  if (field === "zoning") return context.zoning
  if (field === "zoning_density") return context.zoning_density
  if (field === "flood_risk") return context.flood_risk
  if (field === "yield") return context.yield
  if (field === "financials") return context.financials
  if (field === "margin") return context.financials
  return null
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

function parseConditionClause(
  clause: string
): ParsedConditionClause | null {
  const match = clause.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(.+)$/)
  if (!match) return null

  const rawValue = match[3].trim()
  if (/^(>=|<=|==|!=|>|<)/.test(rawValue)) {
    return null
  }

  return {
    field: match[1],
    operator: match[2] as RuleConditionOperator,
    rawValue
  }
}

function parseCondition(
  condition: string
): { clauses: ParsedConditionClause[] } | null {
  if (/\bOR\b/i.test(condition)) {
    return null
  }

  const clauses = condition
    .split(/\s+AND\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => parseConditionClause(clause))

  if (clauses.length === 0 || clauses.some((clause) => clause === null)) {
    return null
  }

  return {
    clauses: clauses as ParsedConditionClause[]
  }
}

function normalizeComparisonValue(rawValue: string): string | number | null {
  const unquoted = rawValue.replace(/^["']|["']$/g, "")
  if (unquoted.toLowerCase() === "null") return null
  const numeric = Number(unquoted)
  return Number.isFinite(numeric) && unquoted !== "" ? numeric : unquoted
}

function compareValues(
  left: number | string | null,
  operator: RuleConditionOperator,
  right: number | string | null,
  field: string
) {
  if (right === null) {
    if (operator === "==") {
      return { matched: left === null, reason: `${field} == null => ${left === null}` }
    }

    if (operator === "!=") {
      return { matched: left !== null, reason: `${field} != null => ${left !== null}` }
    }

    return { matched: false, reason: "Null comparison only supports == or !=" }
  }

  if (left === null) {
    return { matched: false, reason: `${field} is null` }
  }

  if (typeof right === "number") {
    const leftNumber = typeof left === "number" ? left : parseNumber(left)
    if (leftNumber === null) {
      return { matched: false, reason: `${field} is not numeric` }
    }

    if (operator === ">") return { matched: leftNumber > right, reason: `${leftNumber} > ${right} => ${leftNumber > right}` }
    if (operator === "<") return { matched: leftNumber < right, reason: `${leftNumber} < ${right} => ${leftNumber < right}` }
    if (operator === ">=") return { matched: leftNumber >= right, reason: `${leftNumber} >= ${right} => ${leftNumber >= right}` }
    if (operator === "<=") return { matched: leftNumber <= right, reason: `${leftNumber} <= ${right} => ${leftNumber <= right}` }
    if (operator === "!=") return { matched: leftNumber !== right, reason: `${leftNumber} != ${right} => ${leftNumber !== right}` }
    return { matched: leftNumber === right, reason: `${leftNumber} == ${right} => ${leftNumber === right}` }
  }

  const leftString = String(left).trim()
  const rightString = String(right).trim()
  if (operator !== "==" && operator !== "!=") {
    return { matched: false, reason: "Only == and != are supported for string comparisons" }
  }

  return {
    matched: operator === "==" ? leftString === rightString : leftString !== rightString,
    reason: operator === "=="
      ? `${leftString} == ${rightString} => ${leftString === rightString}`
      : `${leftString} != ${rightString} => ${leftString !== rightString}`
  }
}

function evaluateRule(rule: RuleDefinition, source_rule_id: string, context: EvaluationContext): EvaluatedRule {
  if (rule.enabled === false) {
    return {
      rule,
      source_rule_id,
      matched: false,
      reason: "Rule disabled"
    }
  }

  if (rule.event !== context.event) {
    return {
      rule,
      source_rule_id,
      matched: false,
      reason: `Rule event ${rule.event} did not match ${context.event}`
    }
  }

  const parsedCondition = parseCondition(rule.condition)
  if (!parsedCondition) {
    return {
      rule,
      source_rule_id,
      matched: false,
      reason: `Unsupported condition syntax: ${rule.condition}. Use clauses like "score != null AND score >= 75".`,
      warning: `Invalid condition for ${rule.action}: ${rule.condition}`
    }
  }

  const reasons: string[] = []
  for (const clause of parsedCondition.clauses) {
    const left = getContextValue(context, clause.field)
    const right = normalizeComparisonValue(clause.rawValue)
    const comparison = compareValues(left, clause.operator, right, clause.field)
    reasons.push(comparison.reason)

    if (!comparison.matched) {
      return {
        rule,
        source_rule_id,
        matched: false,
        reason: reasons.join(" AND ")
      }
    }
  }

  return {
    rule,
    source_rule_id,
    matched: true,
    reason: reasons.join(" AND ")
  }
}

async function fetchRuleRows(
  supabaseUrl: string,
  serviceKey: string,
  authorizationHeader: string | null,
  event: RuleEngineEvent
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/get-agent-rules`, {
    method: "POST",
    headers: buildHeaders(serviceKey, authorizationHeader),
    body: JSON.stringify({
      agent_name: DEFAULT_AGENT_NAME,
      event
    })
  })

  const bodyText = await response.text()
  let body: unknown = []

  try {
    body = bodyText ? JSON.parse(bodyText) : []
  } catch {
    body = bodyText
  }

  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error)
        : `Failed to fetch rules: ${bodyText}`
    )
  }

  return Array.isArray(body) ? body as RuleRow[] : []
}

async function fetchLatestSiteContext(supabaseUrl: string, serviceKey: string, deal_id: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/site_intelligence?deal_id=eq.${deal_id}&select=deal_id,zoning,flood_risk,estimated_units&order=updated_at.desc&limit=1`,
    { headers: buildRestHeaders(serviceKey) }
  )

  if (!response.ok) {
    throw new Error(`Failed to load site context: ${await response.text()}`)
  }

  const rows = await response.json() as Array<Record<string, unknown>>
  return rows[0] ?? null
}

async function fetchLatestFinancialContext(supabaseUrl: string, serviceKey: string, deal_id: string) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/financial_snapshots?deal_id=eq.${deal_id}&category=eq.financial-engine&select=amount,metadata,created_at&order=created_at.desc&limit=1`,
    { headers: buildRestHeaders(serviceKey) }
  )

  if (!response.ok) {
    throw new Error(`Failed to load financial context: ${await response.text()}`)
  }

  const rows = await response.json() as Array<Record<string, unknown>>
  return rows[0] ?? null
}

async function fetchLatestRankingContext(supabaseUrl: string, serviceKey: string, deal_id: string) {
  const candidateResponse = await fetch(
    `${supabaseUrl}/rest/v1/site_candidates?source=eq.site-intelligence-agent&external_id=eq.${deal_id}&select=ranking_score,ranking_tier&limit=1`,
    { headers: buildRestHeaders(serviceKey) }
  )

  if (!candidateResponse.ok) {
    throw new Error(`Failed to load ranking context: ${await candidateResponse.text()}`)
  }

  const candidateRows = await candidateResponse.json() as Array<Record<string, unknown>>
  if (candidateRows[0]) return candidateRows[0]

  const actionResponse = await fetch(
    `${supabaseUrl}/rest/v1/ai_actions?deal_id=eq.${deal_id}&agent=eq.parcel-ranking-agent&action=eq.deal_ranked&select=payload,created_at&order=created_at.desc&limit=1`,
    { headers: buildRestHeaders(serviceKey) }
  )

  if (!actionResponse.ok) {
    throw new Error(`Failed to load ranking action context: ${await actionResponse.text()}`)
  }

  const actionRows = await actionResponse.json() as Array<Record<string, unknown>>
  const latestPayload = actionRows[0]?.payload

  if (isRecord(latestPayload)) {
    return {
      ranking_score: latestPayload.score ?? null,
      ranking_tier: latestPayload.tier ?? null
    }
  }

  return null
}

async function buildEvaluationContext(
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string,
  event: RuleEngineEvent,
  overrides?: Partial<EvaluationContext>
): Promise<EvaluationContext> {
  const [site, financial, ranking] = await Promise.all([
    fetchLatestSiteContext(supabaseUrl, serviceKey, deal_id),
    fetchLatestFinancialContext(supabaseUrl, serviceKey, deal_id).catch(() => null),
    fetchLatestRankingContext(supabaseUrl, serviceKey, deal_id).catch(() => null)
  ])

  const financialMetadata = isRecord(financial?.metadata) ? financial.metadata : null
  const feasibility = financialMetadata && isRecord(financialMetadata.feasibility)
    ? financialMetadata.feasibility
    : null

  const baseContext: EvaluationContext = {
    deal_id,
    event,
    score: parseNumber(ranking?.ranking_score ?? null),
    zoning: typeof site?.zoning === "string" ? site.zoning : null,
    zoning_density: classifyZoningDensity(typeof site?.zoning === "string" ? site.zoning : null),
    flood_risk: typeof site?.flood_risk === "string" ? site.flood_risk : null,
    yield: parseNumber(site?.estimated_units ?? null),
    financials: parseNumber(feasibility?.margin ?? null)
  }

  return {
    ...baseContext,
    ...overrides,
    deal_id,
    event,
    zoning_density:
      typeof overrides?.zoning_density === "string"
        ? overrides.zoning_density
        : classifyZoningDensity(
            typeof overrides?.zoning === "string" ? overrides.zoning : baseContext.zoning
          )
  }
}

function buildDefaultRules(event: RuleEngineEvent): RuleDefinition[] {
  if (event !== "post-ranking") return []
  const threshold = getEnvNumber(
    "REPORT_TRIGGER_SCORE_THRESHOLD",
    DEFAULT_REPORT_TRIGGER_SCORE_THRESHOLD
  )

  return [{
    event: "post-ranking",
    condition: `score >= ${threshold}`,
    action: "deal-report-agent",
    priority: 1,
    name: "default-post-ranking-report-rule"
  }]
}

async function invokeAction(
  supabaseUrl: string,
  serviceKey: string,
  authorizationHeader: string | null,
  action: string,
  payload: Record<string, unknown>
): Promise<StageResult> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${action}`, {
      method: "POST",
      headers: buildHeaders(serviceKey, authorizationHeader),
      body: JSON.stringify(payload)
    })

    const responseText = await response.text()
    let data: unknown = null
    try {
      data = responseText ? JSON.parse(responseText) : null
    } catch {
      data = responseText
    }

    if (!response.ok) {
      return {
        success: false,
        error:
          typeof data === "object" && data !== null && "error" in data
            ? String((data as { error?: unknown }).error)
            : typeof data === "string"
              ? data
              : `Action ${action} failed`,
        data
      }
    }

    return {
      success: true,
      data
    }
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error)
    }
  }
}

async function getDuplicateActionResult(
  supabaseUrl: string,
  serviceKey: string,
  deal_id: string,
  action: string
): Promise<StageResult | null> {
  if (action !== "deal-report-agent") {
    return null
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_actions?deal_id=eq.${deal_id}&agent=eq.deal-report-agent&action=eq.investment_report_generated&select=created_at,payload&order=created_at.desc&limit=1`,
    { headers: buildRestHeaders(serviceKey) }
  )

  if (!response.ok) {
    throw new Error(`Failed to check duplicate action state: ${await response.text()}`)
  }

  const rows = await response.json() as Array<Record<string, unknown>>
  const latest = rows[0]
  if (!latest) {
    return null
  }

  return {
    success: true,
    skipped: true,
    reason: "Skipped because deal-report-agent completed recently for this deal",
    data: isRecord(latest.payload) ? latest.payload : latest.payload ?? null
  }
}

async function logAudit(
  supabase: ReturnType<typeof createClient>,
  deal_id: string,
  action: string,
  payload: Record<string, unknown>
) {
  const { error } = await supabase.from("ai_actions").insert({
    deal_id,
    agent: DEFAULT_AGENT_NAME,
    action,
    payload
  })

  if (error) {
    throw new Error(error.message)
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500)
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500)

  try {
    const authorizationHeader = req.headers.get("Authorization")
    const payload = await req.json() as RuleEngineRequest
    const deal_id =
      typeof payload.deal_id === "string" && payload.deal_id.trim().length > 0
        ? payload.deal_id.trim()
        : ""
    const event = payload.event
    const actionContext = isRecord(payload.action_context) ? payload.action_context : {}
    const eventContext = isRecord(payload.event_context)
      ? payload.event_context as Partial<EvaluationContext>
      : {}

    if (!deal_id || !event) {
      return jsonResponse({ error: "Missing deal_id or event", received: payload }, 400)
    }

    if (!isUuid(deal_id)) {
      return jsonResponse({ error: "deal_id must be a valid UUID", received: payload }, 400)
    }

    if (!SUPPORTED_EVENTS.has(event)) {
      return jsonResponse({ error: "Unsupported event", received: payload }, 400)
    }

    console.log("rule-engine-agent request received", { deal_id, event })

    const supabase = createClient(supabaseUrl, serviceKey)
    const warnings: string[] = []
    const skipped_rules: Array<Record<string, unknown>> = []
    const executed_actions: Array<Record<string, unknown>> = []

    const context = await buildEvaluationContext(
      supabaseUrl,
      serviceKey,
      deal_id,
      event,
      eventContext
    )
    console.log("rule-engine-agent evaluation context", context)

    let rawRuleRows: RuleRow[] = []
    let rules: Array<{ source_rule_id: string; rule: RuleDefinition }> = []

    try {
      rawRuleRows = await fetchRuleRows(supabaseUrl, serviceKey, authorizationHeader, event)
      rules = rawRuleRows.flatMap((row) =>
        parseRulesFromRow(row).map((rule) => ({
          source_rule_id: row.id,
          rule
        }))
      )
    } catch (error) {
      warnings.push(`Rule lookup failed: ${getErrorMessage(error)}`)
    }

    if (rules.length === 0) {
      rules = buildDefaultRules(event).map((rule) => ({
        source_rule_id: "default",
        rule
      }))
      warnings.push("No rules configured for event; default fallback rule set loaded")
    }

    const evaluations = rules
      .map(({ rule, source_rule_id }) => evaluateRule(rule, source_rule_id, context))
      .sort((left, right) => (left.rule.priority ?? 100) - (right.rule.priority ?? 100))

    for (const evaluation of evaluations) {
      if (evaluation.warning) {
        warnings.push(evaluation.warning)
      }
    }

    console.log("rule-engine-agent rules evaluated", {
      deal_id,
      event,
      evaluations: evaluations.map((entry) => ({
        source_rule_id: entry.source_rule_id,
        action: entry.rule.action,
        condition: entry.rule.condition,
        matched: entry.matched,
        reason: entry.reason
      }))
    })

    for (const evaluation of evaluations) {
      if (!evaluation.matched) {
        skipped_rules.push({
          source_rule_id: evaluation.source_rule_id,
          event: evaluation.rule.event,
          condition: evaluation.rule.condition,
          action: evaluation.rule.action,
          priority: evaluation.rule.priority ?? 100,
          reason: evaluation.reason
        })
        continue
      }

      const actionPayload = {
        deal_id,
        event,
        score: context.score,
        zoning: context.zoning,
        zoning_density: context.zoning_density,
        flood_risk: context.flood_risk,
        yield: context.yield,
        financials: context.financials,
        ...actionContext,
        ...evaluation.rule.payload
      }

      const duplicateActionResult = await getDuplicateActionResult(
        supabaseUrl,
        serviceKey,
        deal_id,
        evaluation.rule.action
      ).catch((error) => ({
        success: false,
        error: getErrorMessage(error)
      } satisfies StageResult))

      if (duplicateActionResult && duplicateActionResult.success && duplicateActionResult.skipped) {
        executed_actions.push({
          source_rule_id: evaluation.source_rule_id,
          event: evaluation.rule.event,
          condition: evaluation.rule.condition,
          action: evaluation.rule.action,
          priority: evaluation.rule.priority ?? 100,
          success: true,
          skipped: true,
          reason: duplicateActionResult.reason ?? evaluation.reason,
          error: null,
          data: duplicateActionResult.data ?? null
        })
        continue
      }

      if (duplicateActionResult && duplicateActionResult.success === false) {
        warnings.push(
          `Failed to check duplicate state for ${evaluation.rule.action}: ${duplicateActionResult.error ?? "unknown error"}`
        )
      }

      const result = await invokeAction(
        supabaseUrl,
        serviceKey,
        authorizationHeader,
        evaluation.rule.action,
        actionPayload
      )

      executed_actions.push({
        source_rule_id: evaluation.source_rule_id,
        event: evaluation.rule.event,
        condition: evaluation.rule.condition,
        action: evaluation.rule.action,
        priority: evaluation.rule.priority ?? 100,
        success: result.success,
        skipped: result.skipped ?? false,
        reason: evaluation.reason,
        error: result.error ?? null,
        data: result.data ?? null
      })
    }

    try {
      await logAudit(supabase, deal_id, "rules_evaluated", {
        event,
        context,
        evaluated_rules: evaluations.map((entry) => ({
          source_rule_id: entry.source_rule_id,
          event: entry.rule.event,
          condition: entry.rule.condition,
          action: entry.rule.action,
          priority: entry.rule.priority ?? 100,
          matched: entry.matched,
          reason: entry.reason,
          warning: entry.warning ?? null
        })),
        warnings
      })
      await logAudit(supabase, deal_id, "actions_executed", {
        event,
        executed_actions,
        skipped_rules
      })
    } catch (error) {
      warnings.push(`Failed to persist rule-engine audit log: ${getErrorMessage(error)}`)
    }

    return jsonResponse({
      success: true,
      deal_id,
      event,
      context,
      executed_actions,
      skipped_rules,
      warnings
    })
  } catch (error) {
    console.error("rule-engine-agent failed", error)
    return jsonResponse({ error: getErrorMessage(error) }, 500)
  }
})
