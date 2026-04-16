# SYSTEM RUNTIME

This document holds the active repository state needed for normal execution. It is concise by design and pairs with `docs_v2/CORE_SYSTEM_PROMPT.md`.

## ACTIVE SYSTEM STATE

- Backend pattern: Supabase Edge Functions with shared runtime helpers.
- Orchestration pattern: event-driven stage completion with rule evaluation and triggered actions.
- Persistence pattern: Supabase tables and views documented in detail on demand.
- Compatibility pattern: hosted environments may contain legacy schema drift, so functions preserve warning-driven fallbacks where safe.
- UI pattern: Next.js 14 App Router (`ai-deal-ui/`). All Supabase edge function calls must be proxied through Next.js API routes — direct browser fetch to Supabase is blocked by CORS. See **UI Layer** section below.

## KEY AGENT GROUPS

Discovery:
- `email-agent`
- `da-discovery-agent`
- `planning-da-discovery-agent`
- `site-discovery-agent`

Planning and feasibility:
- `site-intelligence-agent`
- `zoning-agent`
- `flood-agent`
- `height-agent`
- `fsr-agent`
- `heritage-agent`
- `yield-agent`
- `comparable-sales-agent`
- `financial-engine-agent`
- `parcel-ranking-agent`

Rules and actions:
- `event-dispatcher`
- `rule-engine-agent`
- `agent-orchestrator`
- `notification-agent`
- `create-task`
- `test-insert-task`
- `update-deal-stage`
- `submit-decision`

Deal and reporting:
- `get-deal`
- `get-deal-context`
- `get-deal-feed`
- `get-top-deals`
- `deal-intelligence`
- `deal-report-agent`
- `generate-deal-report`
- `generate-deal-pack`
- `get-deal-reports`
- `get-deal-timeline`

Investor and capital:
- `investor-actions`
- `investor-outreach`
- `allocate-capital`
- `update-deal-outcome`
- `get-deal-funnel`

Operations and safety:
- `agent-runtime`
- `system-health-check`
- `get-operator-summary`
- `get-usage-summary`
- `update-system-settings`
- `approve-approval-queue`
- `cleanup`
- `internal-ops-dashboard`

## CORE PIPELINES

### 1. Deal Discovery

Inbound email, manual input, and discovery agents create or forward candidate deals into the platform.

### 2. Site Intelligence

`site-intelligence-agent` orchestrates planning lookups, optional comparable sales, yield, feasibility, ranking, and downstream event dispatch.

### 3. Rule Execution

Stage-completion events are normalized by `event-dispatcher`, evaluated by `rule-engine-agent`, then used to trigger reports, feed updates, notifications, tasks, or escalations.

### 4. Deal Context and Reporting

Context endpoints assemble deal, planning, financial, risk, communication, and investor data. Reporting agents convert that state into operator-facing and investor-facing outputs.

### 5. Investor and Capital

Investor registry, investor-deal links, lightweight deal terms, CRM pipeline state, communication summaries, commitment tracking, and derived capital visibility are already active.

### 6. Safety and Operations

Shared runtime validation, kill switch, rate limits, retries, health checks, approval queue, and usage tracking provide operational control.

## CRITICAL DATA STRUCTURES

Core deals:
- `deals`
- `site_candidates`
- `site_intelligence`
- `financial_snapshots`
- `risks`
- `tasks`
- `communications`
- `milestones`

Rule and audit layer:
- `ai_actions`
- `agent_action_rules`
- `agent_registry`
- `agent_retry_queue`
- `approval_queue`
- `system_health`
- `usage_metrics`
- `system_settings`
- `agent_rate_limits`

Feed and outcome layer:
- `deal_feed`
- `deal_feed_realtime_fallback`
- `deal_performance`
- `deal_outcomes`
- `scoring_feedback`

Investor and capital layer:
- `investors`
- `deal_investors`
- `deal_terms`
- `deal_investor_matches`
- `investor_deal_pipeline`
- `investor_communications`
- `deal_capital_allocations`
- `capital_allocations`
- `deal_capital_summary`

Knowledge and reports:
- `knowledge_chunks`
- `deal_knowledge_links`
- `report_index`
- `comparable_sales_estimates`
- `comparable_sales_evidence`

## UI LAYER

The front-end is a Next.js 14 App Router application located at `ai-deal-ui/`.

### Key Pages

| Route | Purpose |
|---|---|
| `/` | Deal feed — ranked list of all deals |
| `/deal/[id]` | Deal workspace — full context, brief, financials, risks, investors, timeline, reports, chat |
| `/ops` | Operator dashboard — agent health, usage metrics, approval queue |
| `/deals/new` | Manual deal intake — triggers `site-discovery-agent` |

### Deal Workspace Tabs

The workspace is divided into 7 tabs (client-side, no page reload):

1. **Brief** — 4-paragraph Deal Brief (Opportunity, Financials, Risks & Hurdles, Area & Exit) + Key Signals card
2. **Financials** — Overview (status, strategy, address, site area, task count) + Financials (GDV, TDC, profit, margin, snapshot table)
3. **Risks & Tasks** — Risk cards + Tasks table. Tab label shows a badge count.
4. **Investors** — InvestorPanel (suggested actions, matched investor cards) + Pipeline Summary
5. **Timeline** — Chronological activity feed from `deal_activity_feed`
6. **Reports** — Report list from `report_index` + "Generate report" button wired to `deal-report-agent`
7. **Chat** — Deal-level chat. Stub reply by default; wire to Anthropic API via `AI_ENABLED=true` in `.env.local`

### Deal Brief (replaces TLDR)

The workspace Brief tab shows a 4-paragraph narrative generated server-side on each page load. Paragraphs:
- **Opportunity**: score-band label, strategy, location, yield, zoning, overall verdict
- **Financials**: GDV, TDC, profit, margin with qualitative band (Thin / Marginal / Solid / Excellent)
- **Risks & Hurdles**: highest-severity risk item, flood flag, rezoning signal, no-risk confirmation
- **Area & Exit**: suburb/state context, comparable availability, buyer pool inference

Margin bands: Thin (<14%), Marginal (14–20%), Solid (20–28%), Excellent (≥28%).
Score bands: low-confidence (<40), early-stage (40–65), moderate conviction (65–85), high conviction (≥85).

### CORS Proxy Pattern

All edge function calls from the browser MUST go through a Next.js API route. Direct fetch to Supabase from the browser is blocked by missing CORS headers on the edge functions.

Pattern: `Browser → /api/[route]/route.ts → callEdgeFunction() → Supabase`

Current proxy routes and their targets:
- `GET /api/deal-chat` → `(stub)` | `POST` → replies from local stub or LLM
- `GET /api/investor-matches?deal_id=...` → `investor-actions`
- `GET /api/deal-timeline?deal_id=...` → `get-deal-timeline`
- `GET /api/deal-reports?deal_id=...` → `get-deal-reports`
- `POST /api/deal-reports` → `deal-report-agent`
- `GET /api/ops-summary` → `get-operator-summary` + `get-usage-summary`
- `POST /api/approve-queue` → `approve-approval-queue`
- `POST /api/submit-deal` → `site-discovery-agent`

### Global Navigation

`GlobalNav` component is rendered in the root layout (`app/layout.tsx`). It is a sticky header with links to Feed, Ops, and New Deal. Active state is determined by `usePathname`.

### Feed Capabilities

- Filter: All / Active / Archived (stage-based)
- Search: client-side text filter on address, deal name, suburb, state
- Sort: Score, Priority, or Date (ascending/descending toggle)
- Navigation: deal cards pass the current visible + sorted ID list to the workspace via URL params (`?ids=...&i=...`) so prev/next navigation respects the active filter and sort order

## CURRENT WORKING FLOWS

Agent creation and updates:
- Preserve existing request/response contracts unless intentionally changed.
- Keep validation, logging, and documentation aligned.

Schema work:
- Prefer extending existing tables.
- Document schema changes and route them through migrations with approval.

Deal flow:
- discovery -> intelligence -> ranking/financials -> rule execution -> feed/report/task/notification outputs

Rule flow:
- event context build -> dedupe -> fetch rules -> evaluate conditions -> execute actions -> log outcomes

## ON-DEMAND DOCUMENTS

Load only the one that matches the task:

- `docs_v2/ON_DEMAND/API_DETAILS.md`: endpoint contracts and request/response detail
- `docs_v2/ON_DEMAND/SCHEMA_DETAILS.md`: table, view, and RPC detail
- `docs_v2/ON_DEMAND/AGENT_WORKFLOWS.md`: agent creation, update, and documentation workflow
- `docs_v2/ON_DEMAND/SUPABASE_WORKFLOWS.md`: migrations, deployment boundaries, and infrastructure workflow
- `docs_v2/ON_DEMAND/ARCHITECTURE_DETAILS.md`: deeper architecture and compatibility notes

## RUNTIME BOUNDARY

This document is a summary layer. It should stay concise and should not duplicate full API specs, schema registries, or long agent catalogues.
