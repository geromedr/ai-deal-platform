# SYSTEM RUNTIME

This document holds the active repository state needed for normal execution. It is concise by design and pairs with `docs_v2/CORE_SYSTEM_PROMPT.md`.

## ACTIVE SYSTEM STATE

- Backend pattern: Supabase Edge Functions with shared runtime helpers.
- Orchestration pattern: event-driven stage completion with rule evaluation and triggered actions.
- Persistence pattern: Supabase tables and views documented in detail on demand.
- Compatibility pattern: hosted environments may contain legacy schema drift, so functions preserve warning-driven fallbacks where safe.

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
