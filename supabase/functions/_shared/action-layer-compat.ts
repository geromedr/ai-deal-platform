type CompatRecord = Record<string, unknown>

export type NormalizedTaskRecord = {
  id: string | null
  deal_id: string | null
  title: string | null
  description: string | null
  assigned_to: string | null
  due_date: string | null
  status: string | null
  created_at?: string | null
  updated_at?: string | null
  raw: CompatRecord
}

export type NormalizedRiskRecord = {
  id: string | null
  deal_id: string | null
  title: string | null
  description: string | null
  severity: string | null
  status: string | null
  created_at?: string | null
  updated_at?: string | null
  raw: CompatRecord
}

export type NormalizedRuleRow = {
  id: string | null
  agent_name: string | null
  stage: string | null
  rule_description: string
  action_schema: CompatRecord
  created_at?: string | null
  updated_at?: string | null
  raw: CompatRecord
}

export type CompatibilityWriteResult<T> = {
  data: T
  mode: "current" | "legacy"
  warning?: string
}

function isRecord(value: unknown): value is CompatRecord {
  return typeof value === "object" && value !== null
}

function isMissingColumnError(error: unknown, column: string) {
  const message =
    typeof error === "string"
      ? error
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : ""

  return message.includes(`Could not find the '${column}' column`) ||
    message.includes(`column ${column} does not exist`) ||
    message.includes(`column "${column}" does not exist`)
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

export function normalizeTaskRecord(row: unknown): NormalizedTaskRecord {
  const record = isRecord(row) ? row : {}

  return {
    id: getString(record.id),
    deal_id: getString(record.deal_id),
    title: getString(record.title),
    description: getString(record.description),
    assigned_to: getString(record.assigned_to) ?? getString(record.owner),
    due_date: getString(record.due_date),
    status: getString(record.status),
    created_at: getString(record.created_at),
    updated_at: getString(record.updated_at),
    raw: record
  }
}

export function normalizeRiskRecord(row: unknown): NormalizedRiskRecord {
  const record = isRecord(row) ? row : {}
  const description = getString(record.description) ?? getString(record.detail)

  return {
    id: getString(record.id),
    deal_id: getString(record.deal_id),
    title: getString(record.title) ?? description,
    description,
    severity: getString(record.severity) ?? getString(record.priority) ?? "medium",
    status: getString(record.status) ?? "open",
    created_at: getString(record.created_at),
    updated_at: getString(record.updated_at),
    raw: record
  }
}

function parseLegacyRuleDescription(description: unknown) {
  if (typeof description !== "string" || description.trim().length === 0) {
    return {}
  }

  try {
    const parsed = JSON.parse(description)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return { rule_description: description.trim() }
  }
}

function normalizeLegacyAction(action: string) {
  const normalized = action.trim()

  if (normalized === "create_task") return "create-task"
  if (normalized === "log_risk") return "agent-orchestrator"

  return normalized
}

export function normalizeAgentActionRuleRow(row: unknown): NormalizedRuleRow {
  const record = isRecord(row) ? row : {}

  if (isRecord(record.action_schema)) {
    return {
      id: getString(record.id),
      agent_name: getString(record.agent_name),
      stage: getString(record.stage),
      rule_description: getString(record.rule_description) ?? `Rule for ${getString(record.stage) ?? "unknown"}`,
      action_schema: record.action_schema,
      created_at: getString(record.created_at),
      updated_at: getString(record.updated_at),
      raw: record
    }
  }

  const metadata = parseLegacyRuleDescription(record.description)
  const stage = getString(record.stage)
  const allowedAction = getString(record.allowed_action)
  const condition = getString(record.conditions)

  return {
    id: getString(record.id),
    agent_name: getString(record.agent_name),
    stage,
    rule_description:
      getString(metadata.rule_description) ??
      getString(record.description) ??
      `Rule for ${stage ?? "unknown"}`,
    action_schema:
      allowedAction && condition
        ? {
            event: stage,
            condition,
            action: normalizeLegacyAction(allowedAction),
            priority: typeof metadata.priority === "number" ? metadata.priority : 100,
            payload: isRecord(metadata.payload) ? metadata.payload : undefined,
            enabled: true,
            name: getString(metadata.name)
          }
        : { rules: [] },
    created_at: getString(record.created_at),
    updated_at: getString(record.updated_at),
    raw: record
  }
}

export async function insertTaskWithCompatibility(
  supabase: {
    from: (table: string) => {
      insert: (payload: CompatRecord) => {
        select: () => {
          single: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  },
  payload: {
    deal_id: string
    title: string
    description: string | null
    assigned_to: string | null
    due_date: string | null
  }
): Promise<CompatibilityWriteResult<NormalizedTaskRecord>> {
  const currentInsert = await supabase
    .from("tasks")
    .insert({
      deal_id: payload.deal_id,
      title: payload.title,
      description: payload.description,
      assigned_to: payload.assigned_to,
      due_date: payload.due_date,
      status: "open"
    })
    .select()
    .single()

  if (!currentInsert.error) {
    return {
      data: normalizeTaskRecord(currentInsert.data),
      mode: "current"
    }
  }

  if (!isMissingColumnError(currentInsert.error, "assigned_to")) {
    throw currentInsert.error
  }

  const legacyInsert = await supabase
    .from("tasks")
    .insert({
      deal_id: payload.deal_id,
      title: payload.title,
      description: payload.description,
      owner: payload.assigned_to,
      due_date: payload.due_date,
      status: "open"
    })
    .select()
    .single()

  if (legacyInsert.error) throw legacyInsert.error

  return {
    data: normalizeTaskRecord(legacyInsert.data),
    mode: "legacy",
    warning: "tasks table used legacy owner column"
  }
}

export async function insertRiskWithCompatibility(
  supabase: {
    from: (table: string) => {
      insert: (payload: CompatRecord) => {
        select: () => {
          single: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  },
  payload: {
    deal_id: string
    title: string | null
    description: string | null
    severity: string | null
  }
): Promise<CompatibilityWriteResult<NormalizedRiskRecord>> {
  const currentInsert = await supabase
    .from("risks")
    .insert({
      deal_id: payload.deal_id,
      title: payload.title,
      description: payload.description,
      severity: payload.severity ?? "medium",
      status: "open"
    })
    .select()
    .single()

  if (!currentInsert.error) {
    return {
      data: normalizeRiskRecord(currentInsert.data),
      mode: "current"
    }
  }

  if (!isMissingColumnError(currentInsert.error, "title") &&
      !isMissingColumnError(currentInsert.error, "status")) {
    throw currentInsert.error
  }

  const legacyInsert = await supabase
    .from("risks")
    .insert({
      deal_id: payload.deal_id,
      description: payload.description ?? payload.title ?? "Risk logged by agent-orchestrator",
      severity: payload.severity ?? "medium"
    })
  if (legacyInsert.error) throw legacyInsert.error

  return {
    data: normalizeRiskRecord({
      deal_id: payload.deal_id,
      description: payload.description ?? payload.title ?? "Risk logged by agent-orchestrator",
      severity: payload.severity ?? "medium"
    }),
    mode: "legacy",
    warning: "risks table used legacy schema without title/status columns"
  }
}
