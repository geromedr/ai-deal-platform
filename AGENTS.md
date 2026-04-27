# AGENTS.md

## Behavioural Contract

All AI systems working in this repository must load, in order:

- `docs_v2/CORE_SYSTEM_PROMPT.md`
- `docs_v2/SYSTEM_RUNTIME.md`

These documents define the default behavioural contract and active runtime context.
No legacy prompt or governance document is part of the default startup load.
This startup read is mandatory for every task.

---

## Edge Function Agent Inventory

All agents live in `supabase/functions/`. Deployed via `supabase functions deploy`.

### Pipeline Agents (called by Run Pipeline)

| Agent | Trigger | Writes to | Description |
|-------|---------|-----------|-------------|
| `site-intelligence-agent` | Pipeline step 1 | `site_intelligence` | Orchestrates all sub-agents. Calls zoning, FSR, height, flood, heritage, yield, comparable-sales, financial-engine, parcel-ranking. |
| `zoning-agent` | Via site-intelligence | `site_intelligence` | Looks up zoning classification for an address |
| `fsr-agent` | Via site-intelligence | `site_intelligence` | Retrieves floor space ratio (FSR) controls |
| `height-agent` | Via site-intelligence | `site_intelligence` | Retrieves maximum building height controls |
| `flood-agent` | Via site-intelligence | `site_intelligence` | Assesses flood overlay risk for a site |
| `heritage-agent` | Via site-intelligence | `site_intelligence` | Checks heritage listing status |
| `yield-agent` | Via site-intelligence | `site_intelligence` | Estimates development yield (units, GFA) |
| `comparable-sales-agent` | Via site-intelligence | `comparable_sales_estimates` | Sources comparable sale evidence for GDV estimation |
| `financial-engine-agent` | Via site-intelligence | `financial_snapshots` | Calculates GDV, TDC, profit, margin, RLV. Replaces (not appends) snapshot on each run. |
| `parcel-ranking-agent` | Via site-intelligence | `site_candidates` | Scores and ranks parcels against each other |
| `deal-report-agent` | Pipeline step 2 | `deal_reports` | Generates structured AI report + human summary. Calls rule-engine-agent. |
| `rule-engine-agent` | Via deal-report | `deal_feed` | Scores deal 0–100 based on planning, financial, and risk signals. Writes to deal_feed. |
| `notification-agent` | Pipeline step 3 | `notifications` | Sends deal event notifications. Requires deal_feed_id + trigger_event + summary. |

### On-Demand / User-Triggered Agents

| Agent | Trigger | Description |
|-------|---------|-------------|
| `ai-agent` | Deal Chat tab | RAG-powered Q&A using Jina embeddings + DeepSeek. Accepts `deal_id` + `prompt`. Returns `{ ai_result: { text } }`. |
| `add-knowledge-document` | Manual / ops | Adds a document to the RAG knowledge base. Uses Jina `retrieval.passage` embedding. |
| `search-knowledge` | Internal / ai-agent | Searches the RAG knowledge base. Uses Jina `retrieval.query` embedding. |
| `submit-decision` | BUY/REVIEW/PASS buttons | Records an operator decision on a deal. Called by `/api/submit-decision`. |
| `investor-outreach` | Investor panel | Generates and queues investor outreach emails for approval. |
| `email-agent` | Approval queue | Sends approved email drafts. |
| `agent-orchestrator` | Internal | Routes tasks to appropriate downstream agents. |

### Data / Lookup Agents

| Agent | Description |
|-------|-------------|
| `get-deal-context` | Returns all deal data (deal, feed, tasks, financials, risks, site_intelligence, communications). Always use `.order().limit(1)` not `.maybeSingle()` for deal_feed. |
| `get-deal-feed` | Returns the scored deal feed with filters and pagination. |
| `get-deal` | Returns a single deal record. |
| `get-deal-reports` | Returns AI-generated reports for a deal. |
| `get-deal-timeline` | Returns timeline events for a deal. |
| `get-deal-funnel` | Returns funnel/stage analytics. |
| `get-top-deals` | Returns highest-scored deals. |
| `get-operator-summary` | Returns aggregate operator metrics. |
| `get-agent-rules` | Returns rule definitions for the rule engine. |
| `get-usage-summary` | Returns API usage and cost summary. |

### Management Agents

| Agent | Description |
|-------|-------------|
| `add-financial-snapshot` | Manually adds a financial snapshot for a deal. |
| `add-deal-knowledge-link` | Links a knowledge document to a deal. |
| `create-task` | Creates a workflow task linked to a deal. |
| `log-communication` | Records a communication event. |
| `allocate-capital` | Records a capital allocation against a deal. |
| `update-deal-stage` | Updates a deal's pipeline stage. |
| `update-deal-outcome` | Records a deal outcome (sold, withdrawn, etc.). |
| `update-system-settings` | Updates platform configuration. |
| `approve-approval-queue` | Approves a queued action (email draft, etc.). |
| `cleanup` | Removes stale or test data. |

### Infrastructure / Ops Agents

| Agent | Description |
|-------|-------------|
| `internal-ops-dashboard` | Ops metrics dashboard. ⚠️ `verify_jwt = false` — internal use only. |
| `system-health-check` | Checks all agent endpoints and DB connectivity. |
| `subscribe-deal-feed` | Real-time deal feed subscription endpoint. |
| `da-discovery-agent` | DA (development application) discovery and parsing. |
| `planning-da-discovery-agent` | Extended DA discovery with planning context. |
| `deal-intelligence` | Legacy deal intelligence endpoint (superseded by deal-report-agent). |
| `deal-agent` | Legacy deal agent (superseded by ai-agent). |
| `generate-deal-pack` | Generates a deal pack document bundle. |
| `generate-deal-report` | Legacy report generator (superseded by deal-report-agent). |
| `site-discovery-agent` | Ingests new site candidates into the platform. Called by `/api/submit-deal`. |
| `domain-discovery-agent` | ⛔ NOT DEPLOYED — awaiting Domain API credentials. Discovers sites from Domain.com.au listings. |

---

## Shared Libraries (`supabase/functions/_shared/`)

| File | Purpose |
|------|---------|
| `utils.ts` | `requireEnv`, `optionalEnv`, `isUuid`, `parseNumber`, `getErrorMessage`, `jsonResponse`, `errorResponse`, `normalizeString`, `coerceString` |
| `agent-runtime.ts` | `createAgentHandler` — wraps all edge functions with CORS, auth, validation, error handling |
| `ai-client.ts` | `callAIPrompt` — DeepSeek API wrapper |
| `embeddings.ts` | `generateEmbedding` — Jina AI embeddings (`jina-embeddings-v3`, 1024-dim) |
| `deal-context.ts` | Deal context utilities and error helpers |
| `event-dispatch.ts` / `event-dispatch-v2.ts` | Agent-to-agent event dispatching |

---

## Key Data Contracts

**`ai-agent` request:** `{ deal_id: string, prompt: string, knowledge_query?: string }`
**`ai-agent` response:** `{ status: "success", ai_result: { text: string, model, usage }, knowledge_used, deal_id }`

**`get-deal-context` request:** `{ deal_id: string }`
**`get-deal-context` response:** `{ deal, feed, tasks, financials, risks, site_intelligence, communications }`

**`financial-engine-agent` request:** `{ deal_id: string, refresh_yield?: boolean, assumptions?: {...} }`

**`rule-engine-agent`** writes `priority_score` and `score` to `deal_feed`. Always query `deal_feed` with `.order("updated_at", { ascending: false }).limit(1)` — never `.maybeSingle()`.
