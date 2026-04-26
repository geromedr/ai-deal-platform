/**
 * _shared/ai-client.ts
 * Centralised DeepSeek (OpenAI-compatible) client for all edge function agents.
 *
 * Embeddings remain on OpenAI (DeepSeek has no embeddings endpoint).
 * All chat/completion calls go through DeepSeek.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type AiMessage = { role: "system" | "user" | "assistant"; content: string }

export type AiTaskType =
  | "standard"
  | "complex_planning"
  | "legal_review"
  | "dispute_analysis"

export type AiCallOptions = {
  /** Selects deepseek-reasoner for complex tasks, deepseek-chat otherwise */
  taskType?: AiTaskType
  /** Override model directly — skips taskType router */
  model?: string
  /** Set true to request JSON-only output (response_format: json_object) */
  jsonMode?: boolean
  /** Max tokens for the response. Default: unrestricted */
  maxTokens?: number
}

export type AiUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type AiCallResult = {
  text: string
  model: string
  usage: AiUsage | null
  cost_usd: number | null
}

// ─── Model router ─────────────────────────────────────────────────────────────

const COMPLEX_TASKS: AiTaskType[] = [
  "complex_planning",
  "legal_review",
  "dispute_analysis",
]

export function selectModel(taskType: AiTaskType = "standard"): string {
  return COMPLEX_TASKS.includes(taskType) ? "deepseek-reasoner" : "deepseek-chat"
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

// Prices in USD per 1M tokens (as of April 2026)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "deepseek-chat":     { input: 0.27,  output: 1.10 }, // cache-miss pricing
  "deepseek-reasoner": { input: 0.55,  output: 2.19 },
}

export function calculateCostUsd(usage: AiUsage | null, model: string): number | null {
  if (!usage) return null
  const pricing = MODEL_COSTS[model]
  if (!pricing) return null
  const inputCost  = (usage.prompt_tokens     / 1_000_000) * pricing.input
  const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

// ─── Core caller ──────────────────────────────────────────────────────────────

/**
 * Call the DeepSeek chat completions API.
 * Accepts an array of messages (system + user) for full control.
 */
export async function callAI(
  messages: AiMessage[],
  options: AiCallOptions = {},
): Promise<AiCallResult> {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY")
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set")

  const baseURL =
    Deno.env.get("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com/v1"

  const model = options.model ?? selectModel(options.taskType)

  const body: Record<string, unknown> = { model, messages }
  if (options.jsonMode) body.response_format = { type: "json_object" }
  if (options.maxTokens) body.max_tokens = options.maxTokens

  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`DeepSeek API error (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const text: string = data?.choices?.[0]?.message?.content ?? ""
  const usage: AiUsage | null = data?.usage ?? null

  return {
    text,
    model,
    usage,
    cost_usd: calculateCostUsd(usage, model),
  }
}

/**
 * Convenience wrapper — wraps a single string prompt in a user message.
 */
export async function callAIPrompt(
  prompt: string,
  options: AiCallOptions = {},
): Promise<AiCallResult> {
  return callAI([{ role: "user", content: prompt }], options)
}
