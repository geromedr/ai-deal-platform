DEPRECATED - see docs_v2/CORE_SYSTEM_PROMPT.md and docs_v2/SYSTEM_RUNTIME.md
This file is retained for compatibility and historical reference.

# SYSTEM INTELLIGENCE REPORT

## 1. SYSTEM OVERVIEW

- System purpose:
  - Discover property development opportunities.
  - Enrich them with planning, feasibility, ranking, reporting, investor, and operator context.
  - Surface qualified deals into a live feed.
  - Trigger notifications, tasks, approvals, capital allocation, and reporting.
  - Track outcomes and feed outcome performance back into priority scoring.
- Core pipeline:
  - `DISCOVERY -> SITE INTELLIGENCE -> FEASIBILITY -> RANKING -> EVENT DISPATCH -> RULE ENGINE -> DEAL FEED -> NOTIFICATIONS / TASKS / APPROVALS / REPORTS -> CAPITAL / INVESTOR WORKFLOWS -> OUTCOMES -> SCORING FEEDBACK`
- Primary architectural principles implemented in code:
  - Event-driven orchestration via `_shared/event-dispatch-v2.ts`
  - Rule-based downstream execution via `rule-engine-agent`
  - Shared runtime enforcement via `_shared/agent-runtime.ts`
  - Database-first state accumulation in Supabase tables/views/RPCs
  - Idempotent / duplicate-safe writes for feed, approvals, task creation, investor matching, and event dispatch
  - Thin operator control layer over autonomous automation
- Important implementation details:
  - Event dedupe is context-aware, not just event-aware: `deal_id + event + context_hash`
  - `deal_feed` is unique on `(deal_id, trigger_event)`
  - Priority scoring differs at write time vs read time:
    - write-time feed score excludes live `risks`
    - read-time feed and notification scoring can include live `risks` and latest `scoring_feedback.adjusted_weights`
  - Shared runtime checks:
    - required input validation
    - global kill switch
    - per-agent hourly limits
    - `agent_registry` status updates
    - `ai_actions` execution audit
    - `usage_metrics` metering

## 2. DATA MODEL

### Core deal tables

- `deals`
  - Core fields: `id`, `address`, `suburb`, `state`, `postcode`, `status`, `stage`, `source`, `metadata`, timestamps
  - Workflow status in live code: `active -> reviewing -> approved -> funded -> completed`
  - UI must surface: address, status, stage, source, metadata-derived strategy/target metrics where present
- `site_intelligence`
  - One row per deal
  - Core fields: planning controls, site area, estimated GFA/units/revenue/build cost/profit, `raw_data`
  - UI must surface: zoning, FSR, height, flood, heritage, estimated yield, planning source context
- `site_candidates`
  - Discovery candidate memory and ranking storage
  - Core fields: source, external_id, address/location, raw listing data, ranking score/tier/reasons, discovery score/reasons
  - UI must surface for discovery ops: source, raw candidate details, ranking reasoning, whether candidate progressed

### Feed, scoring, and audit tables

- `deal_feed`
  - One row per `deal_id + trigger_event`
  - Core fields: `score`, `priority_score`, `status`, `trigger_event`, `summary`, `metadata`, stale/archive timestamps
  - Lifecycle: `active -> stale -> archived`
  - UI must surface: trigger event, summary, raw score, effective priority score, lifecycle status, freshness
- `deal_feed_realtime_fallback`
  - Minimal fallback event buffer: `deal_id`, `priority_score`, `change_type`, `created_at`
  - UI use: realtime fallback only
- `deal_performance`
  - Aggregate engagement + outcome metrics
  - Core fields: `views`, `notifications_sent`, `actions_taken`, `outcomes_recorded`, `last_actual_return`, averages, timestamps
  - UI must surface: engagement, activity, performance over time
- `deal_outcomes`
  - Append-only outcome snapshots
  - Core fields: `outcome_type`, `actual_return`, `duration_days`, `notes`
  - UI must surface: history, not just latest state
- `scoring_feedback`
  - Predicted vs actual scoring adjustments
  - Core fields: predicted priority/return, actual return, adjustment factor, previous/adjusted weights, notes
  - UI must surface: scoring auditability, not just opaque score changes
- `ai_actions`
  - Global audit ledger
  - Stores agent execution, event dispatch, rules evaluated, actions executed, notifications, status transitions, reports, settings changes, approvals, outreach generation, etc.
  - UI must surface: per-deal timeline and operator audit history

### Reporting, knowledge, approvals, controls

- `approval_queue`
  - Core fields: `approval_type`, `status`, `requested_by_agent`, `payload`, `dedupe_key`
  - Statuses used in code: `pending`, `rejected`, `executed`, `failed`
  - UI must surface: action being requested, source rule, payload, approval state, execution result
- `deal_knowledge_links`
  - Lightweight links from deals to external/knowledge references
  - Core fields: `document_type`, `source_ref`, `summary`, `metadata`
  - UI must surface: attached reference list per deal
- `knowledge_chunks`
  - Vector-searchable document chunks with embeddings
  - Core fields: `source_name`, `category`, `content`, `embedding`, `metadata`
  - UI must surface: source/category/content preview for knowledge management
- `report_index`
  - Stable index for generated reports
  - Core fields: `deal_id`, `report_type`, `source_agent`, `source_action`, `payload`, `created_at`
  - UI must surface: all generated artifacts by deal and by type
- `system_settings`
  - Global kill switch row keyed by `setting_key = global`
  - UI must surface: current enabled/disabled state and note metadata
- `agent_registry`, `usage_metrics`, `system_health`, `agent_rate_limits`, `agent_retry_queue`
  - Operator observability and safety layer
  - UI must surface: runtime health, usage, retries, limits, last errors

### Investor and capital tables

- `investors`
  - Registry of reusable investor profiles
  - Core fields: type, capital min/max, preferred strategies, risk profile, preferred states/suburbs, min target margin, notes, metadata
  - UI must surface: profile, mandate, geography, cheque size, risk tolerance
- `deal_investors`
  - Many-to-many deal/investor link
  - Core fields: `relationship_stage`, notes, metadata
  - UI must surface: who is attached to the deal and at what stage
- `deal_terms`
  - One active terms row per deal
  - Core fields: sponsor fee %, equity split, preferred return %, notes, metadata
  - UI must surface: investor-facing commercial terms summary
- `deal_investor_matches`
  - Deterministic fit scoring
  - Core fields: total score/band, strategy/budget/risk/location component scores, reasons, deal snapshot
  - UI must surface: explainable match reasons, not just rank
- `investor_deal_pipeline`
  - CRM state per deal/investor
  - Core fields: `pipeline_status`, last contacted, next follow-up, notes, metadata
  - UI must surface: pipeline board/table, follow-up dates, stale contacts
- `investor_communications`
  - Investor communication log
  - Core fields: type, direction, subject, summary, status, metadata, communicated_at
  - UI must surface: contact history
- `deal_capital_allocations`
  - Investor-level commitment tracking
  - Core fields: committed amount, allocation %, status, notes, metadata
  - Statuses: `proposed`, `soft_commit`, `hard_commit`, `funded`
  - UI must surface: soft vs hard commitments, allocation percentages, investor mix
- `capital_allocations`
  - System-level capital allocation across deals
  - One row per allocated deal
  - Core fields: allocated amount, allocation status, expected return
  - UI must surface: portfolio allocation state
- `deal_capital_summary` view
  - UI-ready rollup
  - Core fields: capital target, total committed, total soft commit, remaining capital, investor counts, pipeline counts, `pipeline_summary`
  - UI must surface directly; no need to rebuild these aggregates client-side

### Deal support tables and views

- `email_threads`, `communications`, `tasks`, `financial_snapshots`, `risks`, `milestones`
  - Deal execution record
- `comparable_sales_estimates`, `comparable_sales_evidence`
  - Comparable pricing storage
- `deal_activity_feed` view
  - Unified deal timeline across tasks, communications, risks, milestones, financials, and AI actions

### Key relationships

- `deal_feed.deal_id -> deals.id`
- `site_intelligence.deal_id -> deals.id`
- `tasks`, `communications`, `financial_snapshots`, `risks`, `milestones`, `deal_outcomes`, `deal_knowledge_links`, `capital_allocations`, `report_index` all link to `deals`
- `deal_investors`, `deal_investor_matches`, `investor_deal_pipeline`, `investor_communications`, `deal_capital_allocations` link deals and investors
- `comparable_sales_evidence.estimate_id -> comparable_sales_estimates.id`

## 3. AGENTS & EDGE FUNCTIONS

### Discovery

- `domain-discovery-agent`
  - Purpose: pull listing candidates from Domain and forward to discovery
  - Trigger: manual POST
  - Inputs: `suburbs[]`, optional land filters
  - Outputs: per-suburb candidate counts, forwarded results
  - Side effects: invokes `site-discovery-agent`
- `da-discovery-agent`
  - Purpose: scan mock planning applications and forward development candidates
  - Trigger: manual POST
  - Inputs: source, jurisdiction, statuses, limit
  - Outputs: scanned/matched/forwarded counts
  - Side effects: invokes `site-discovery-agent`
- `planning-da-discovery-agent`
  - Purpose: query NSW Planning Portal and forward apartment-style DA candidates
  - Trigger: manual POST
  - Inputs: none required
  - Outputs: candidate count, forwarded result
  - Side effects: invokes `site-discovery-agent`
- `site-discovery-agent`
  - Purpose: create deal, geocode, kick off intelligence pipeline
  - Trigger: called by discovery agents or manually
  - Inputs: `candidates[]`
  - Outputs: per-candidate `deal_id`, discovery score, dispatch result
  - Side effects: creates deals/site candidates, invokes `site-intelligence-agent`, dispatches `post-discovery`
- `email-agent`
  - Purpose: process inbound email into communications + AI-driven next actions
  - Trigger: inbound/manual POST
  - Inputs: sender, subject, body, optional `deal_id`
  - Outputs: processing status, thread id, AI decision, detected address
  - Side effects: upserts `email_threads`/`communications`, invokes `ai-agent`, `agent-orchestrator`, `deal-intelligence`, optional `site-intelligence-agent`

### Intelligence and planning

- `site-intelligence-agent`
  - Purpose: full site pipeline orchestration
  - Trigger: `site-discovery-agent`, `email-agent`, manual
  - Inputs: `deal_id`, `address`, optional `force_refresh`, `use_comparable_sales`
  - Outputs: orchestration summary, ranking/report decisions, warnings
  - Side effects: upserts `deals`, `site_intelligence`, updates `site_candidates`, invokes planning/feasibility/ranking agents, dispatches `post-intelligence` and `post-ranking`
- `zoning-agent`, `flood-agent`, `fsr-agent`, `height-agent`, `heritage-agent`
  - Purpose: fetch planning constraints
  - Trigger: site pipeline or manual
  - Inputs: `deal_id`, `address`
  - Outputs: agent-specific planning data
  - Side effects: persist into `site_intelligence`
- `deal-intelligence`
  - Purpose: aggregate risks, milestones, financial insights
  - Trigger: `email-agent` or manual
  - Inputs: `deal_id`
  - Outputs: intelligence result
  - Side effects: writes risks/milestones/related context

### Financials and ranking

- `comparable-sales-agent`
  - Purpose: estimate sale price per sqm and evidence
  - Trigger: site pipeline or manual
  - Inputs: `deal_id`, optional radius/dwelling type
  - Outputs: estimate id, price/sqm, comparables
  - Side effects: writes `comparable_sales_estimates` and `comparable_sales_evidence`
- `yield-agent`
  - Purpose: estimate GFA, units, revenue, build cost, profit
  - Trigger: site pipeline or manual
  - Inputs: `deal_id`, optional comparable-sales usage
  - Outputs: yield model output
  - Side effects: updates `site_intelligence`
- `financial-engine-agent`
  - Purpose: structured feasibility and residual value model
  - Trigger: site pipeline or manual
  - Inputs: `deal_id`, optional refresh/comparable usage/assumptions
  - Outputs: feasibility JSON, snapshot id, event dispatch result
  - Side effects: writes `financial_snapshots`, logs audit, dispatches `post-financial`
- `add-financial-snapshot`
  - Purpose: direct snapshot insertion
  - Trigger: manual or dependency
  - Inputs: deal + snapshot fields
  - Outputs: inserted snapshot
  - Side effects: writes `financial_snapshots`
- `parcel-ranking-agent`
  - Purpose: rank a deal or batch-rank candidates
  - Trigger: site pipeline or manual
  - Inputs: deal mode `deal_id`; batch mode `limit`, `only_unranked`
  - Outputs: ranking score/tier/reasoning or batch list
  - Side effects: updates `site_candidates`, logs `deal_ranked`, dispatches `post-ranking`

### Rules, orchestration, feed, notifications

- `get-agent-rules`
  - Purpose: return normalized rule rows for event/stage
  - Trigger: rule engine/manual
  - Inputs: `agent_name`, event/stage context
  - Outputs: normalized rules
  - Side effects: none
- `rule-engine-agent`
  - Purpose: evaluate event rules, execute downstream actions, write feed, trigger notifications, create auto tasks
  - Trigger: event dispatcher or manual
  - Inputs: `deal_id`, `event`, optional `action_context`, `event_context`
  - Outputs: executed actions, skipped rules, `deal_feed_entry`, `notification_result`, warnings
  - Side effects:
    - reads persisted context from ranking/site/financial tables
    - upserts `approval_queue` when approval flags are set
    - invokes target functions in priority order
    - auto-creates `Prepare lender pack` / `Re-evaluate feasibility` tasks
    - upserts `deal_feed` for qualifying `post-ranking` / `post-financial`
    - invokes `notification-agent`
    - logs audits to `ai_actions`
    - queues retries to `agent_retry_queue`
- `notification-agent`
  - Purpose: per-user notification decisioning + external delivery for high-priority deals
  - Trigger: after feed persistence or manual
  - Inputs: `deal_feed_id`, `deal_id`, score, priority score, trigger event, summary
  - Outputs: notifications sent, per-user decisions, delivery outcomes
  - Side effects:
    - reads deal/feed/financial/site/risk/user preference context
    - writes `notification_decision` and `deal_alert` rows to `ai_actions`
    - sends email/webhook for `high_priority`
    - increments `deal_performance.notifications_sent`
- `subscribe-deal-feed`
  - Purpose: return realtime subscription contract
  - Trigger: UI/manual
  - Inputs: optional `user_id`
  - Outputs: broadcast topic, fallback topic, optional preferences
  - Side effects: none
- `get-deal-feed`
  - Purpose: query surfaced deals with preference-aware filtering
  - Trigger: UI/operator/manual
  - Inputs: optional limit, score, status, sort, `user_id`
  - Outputs: feed items, applied preferences, warnings
  - Side effects: recomputes effective priority score, increments views in `deal_performance`
- `get-top-deals`
  - Purpose: rank deals by priority/composite score
  - Trigger: UI/operator/manual
  - Inputs: optional limit/sort
  - Outputs: top deal items
  - Side effects: none

### Reporting and knowledge

- `deal-report-agent`
  - Purpose: generate investment-ready deal report
  - Trigger: rules, fallback threshold path, manual
  - Inputs: `deal_id`, optional comparable-sales usage
  - Outputs: structured report, human-readable summary, warnings, stage results
  - Side effects:
    - invokes `get-deal`, `get-deal-context`, planning agents, comparable/yield/financial/ranking agents, `ai-agent`
    - logs `investment_report_generated` to `ai_actions`
    - inserts `report_index`
- `generate-deal-pack`
  - Purpose: produce investor-facing deal pack JSON
  - Trigger: operator/manual
  - Inputs: `deal_id`
  - Outputs: deal-pack payload
  - Side effects: logs to `ai_actions`, inserts `report_index`
- `generate-deal-report`
  - Purpose: weekly summary report
  - Trigger: operator/manual
  - Inputs: optional trailing `days`
  - Outputs: weekly report payload
  - Side effects: logs to `ai_actions`, inserts `report_index`
- `get-deal-reports`
  - Purpose: retrieve indexed reports
  - Trigger: UI/operator/manual
  - Inputs: optional `deal_id`, `report_type`, `created_at`, `limit`
  - Outputs: indexed report items
  - Side effects: fallback to legacy `ai_actions` report rows when needed
- `add-knowledge-document`
  - Purpose: chunk and embed supporting documents
  - Trigger: manual
  - Inputs: document fields/content
  - Outputs: stored chunk result
  - Side effects: writes `knowledge_chunks`
- `search-knowledge`
  - Purpose: vector retrieval
  - Trigger: AI/manual
  - Inputs: query text, optional category filters
  - Outputs: matched chunks
  - Side effects: none
- `add-deal-knowledge-link`
  - Purpose: attach reference to deal
  - Trigger: manual/operator
  - Inputs: `deal_id`, `document_type`, `source_ref`, optional summary/metadata
  - Outputs: inserted link row
  - Side effects: writes `deal_knowledge_links`, logs audit

### Investor and capital

- `investor-actions`
  - Purpose: deterministic investor action execution or suggestion list
  - Trigger: manual/UI
  - Inputs: `deal_id`, optional `investor_id`, `action_type`, thresholds, communication details
  - Outputs: suggestions or executed action result
  - Side effects: for `contact_investor`, logs `investor_communications`, advances `investor_deal_pipeline`, returns remaining suggestions
- `investor-outreach`
  - Purpose: build ready-to-send outreach draft
  - Trigger: manual/UI
  - Inputs: `deal_id`, `investor_id`
  - Outputs: deterministic `subject` and `message`
  - Side effects: logs `outreach_generated` to `ai_actions`
- `allocate-capital`
  - Purpose: allocate capital pool across top feed deals
  - Trigger: operator/manual/dashboard
  - Inputs: `capital_pool`, optional `max_deals`, `allocation_status`, `minimum_priority_score`
  - Outputs: inserted allocation rows
  - Side effects: selects highest-priority unallocated deals, writes `capital_allocations`, logs `capital_allocated`

### Deal context, workflow, operator controls, utilities

- `get-deal`, `get-deal-context`
  - Purpose: load unified deal context
  - Trigger: UI/agents/manual
  - Inputs: `deal_id`
  - Outputs: deal, tasks, communications, financials, risks, investor structures, capital summary, refreshed investor matches, suggested investor actions
  - Side effects: runs `refresh_deal_investor_matches`, logs `context_requested`
- `get-deal-timeline`
  - Purpose: unified activity feed
  - Trigger: UI/operator/manual
  - Inputs: `deal_id`
  - Outputs: timeline items from `deal_activity_feed`
  - Side effects: logs audit
- `create-task`
  - Purpose: duplicate-safe task creation
  - Trigger: manual, orchestrator, rule engine
  - Inputs: `deal_id`, title, description, assignee, due date
  - Outputs: task row + duplicate/compatibility flags
  - Side effects: writes `tasks`, increments `deal_performance.actions_taken`
- `update-deal-stage`
  - Purpose: validated stage/status changes
  - Trigger: operator/manual/auto-evaluate
  - Inputs: `deal_id`, status/stage fields, reason, `auto_evaluate`
  - Outputs: updated deal, change flags
  - Side effects: writes `deals`, logs deduped status transitions
- `update-deal-outcome`
  - Purpose: persist outcome and scoring feedback
  - Trigger: operator/manual/dashboard
  - Inputs: `deal_id`, `outcome_type`, optional return/duration/notes
  - Outputs: outcome row, performance aggregate, scoring feedback row
  - Side effects: writes `deal_outcomes`, updates `deal_performance` via RPC, inserts `scoring_feedback`, logs audit
- `get-deal-funnel`
  - Purpose: lifecycle funnel analytics
  - Trigger: operator/UI/manual
  - Inputs: none
  - Outputs: counts, conversion rates, average stage durations
  - Side effects: none
- `get-operator-summary`
  - Purpose: platform summary counts
  - Trigger: operator/UI/manual
  - Inputs: none
  - Outputs: active deals, high-priority deals, notifications, retries, health, reports
  - Side effects: none
- `get-usage-summary`
  - Purpose: usage/cost aggregates
  - Trigger: operator/UI/manual
  - Inputs: none
  - Outputs: 24h and 7d aggregates
  - Side effects: none
- `system-health-check`
  - Purpose: snapshot health of database/agents/activity
  - Trigger: operator/UI/manual
  - Inputs: none
  - Outputs: overall health + per-component checks
  - Side effects: upserts `system_health`
- `update-system-settings`
  - Purpose: toggle kill switch
  - Trigger: operator/UI/manual
  - Inputs: `system_enabled`, optional note
  - Outputs: updated settings row
  - Side effects: writes `system_settings`, logs audit
- `approve-approval-queue`
  - Purpose: approve/reject pending actions
  - Trigger: operator/UI/manual
  - Inputs: `approval_id`, decision, note
  - Outputs: updated approval row, optional downstream execution result
  - Side effects: updates `approval_queue`, invokes queued action on approval, logs audit
- `cleanup`
  - Purpose: bounded maintenance
  - Trigger: operator/UI/manual
  - Inputs: retention day overrides
  - Outputs: deleted/failed counts
  - Side effects: deletes old `usage_metrics` and `deal_feed_realtime_fallback`, fails exhausted retries, logs audit
- `internal-ops-dashboard`
  - Purpose: lightweight operator web UI + action proxy
  - Trigger: GET/POST
  - Inputs: dashboard action + payload
  - Outputs: HTML UI or proxied action result
  - Side effects: calls operator functions
- `agent-orchestrator`
  - Purpose: execute structured AI decisions
  - Trigger: `email-agent` or manual
  - Inputs: `deal_id`, `aiDecision`
  - Outputs: action execution results
  - Side effects: writes tasks/risks/communications via compatibility layer
- `ai-agent`
  - Purpose: general reasoning with knowledge retrieval support
  - Trigger: other agents/manual
  - Inputs: prompt-oriented payload
  - Outputs: reasoning response
  - Side effects: depends on caller
- `deal-agent`
  - Purpose: reason on deal next steps
  - Trigger: manual
  - Inputs: deal/context prompt
  - Outputs: reasoning + delegated actions
  - Side effects: can invoke orchestrator path
- `log-communication`
  - Purpose: direct communication logging
  - Trigger: manual/dependency
  - Inputs: communication fields
  - Outputs: inserted row
  - Side effects: writes `communications`
- `test-agent`
  - Purpose: echo/test endpoint
  - Trigger: manual
  - Inputs: any payload
  - Outputs: success echo
  - Side effects: minimal logging

## 4. EVENT SYSTEM

- Events in active use:
  - `post-discovery`
  - `post-intelligence`
  - `post-ranking`
  - `post-financial`
- Event emitters:
  - `site-discovery-agent` -> `post-discovery`
  - `site-intelligence-agent` -> `post-intelligence`
  - `parcel-ranking-agent` -> `post-ranking`
  - `financial-engine-agent` -> `post-financial`
- Listener:
  - `_shared/event-dispatch-v2.ts` always calls `rule-engine-agent`
- `event-dispatch-v2` implementation:
  - builds standardized context from DB:
    - `score`, `zoning`, `zoning_density`, `flood_risk`, `yield`, `financials`
  - derives `context_hash = SHA-256(JSON.stringify({ score, zoning, yield, financials }))`
  - checks `ai_actions` for exact completed/in-progress duplicates
  - exact duplicate behavior:
    - completed -> return cached response
    - in progress -> skip
  - legacy fallback:
    - if no hashed history exists, uses older event-only records
  - logs:
    - `event_triggered`
    - `event_duplicate_skipped`
    - `rule_engine_invoked`

## 5. RULE ENGINE

- Rules are stored in `agent_action_rules.action_schema`
- Rule payload structure:
  - one object or `rules[]`
  - required fields: `event`, `condition`, `action`
  - optional: `priority`, `payload`, `enabled`, `name`
- Supported conditions:
  - operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
  - conjunction: `AND`
  - no `OR` support
  - null-safe comparisons supported
- Supported context fields:
  - `score`
  - `zoning`
  - `zoning_density`
  - `flood_risk`
  - `yield`
  - `financials`
  - alias `margin` maps to `financials`
- Approval routing flags:
  - `requires_approval`
  - `approval_required`
  - `route_to_approval_queue`
- Feed write gating:
  - only `post-ranking` and `post-financial`
  - requires at least one matched high-quality clause:
    - score threshold clause
    - financial/margin threshold clause
    - low-risk flood clause
- Default fallback rule actually enforced in code:
  - if no rules load, only `post-ranking` gets fallback
  - fallback condition: `score >= REPORT_TRIGGER_SCORE_THRESHOLD`
  - default threshold: `50`
- Real rule examples confirmed from code/docs:
  - `score != null AND score >= 75`
  - `financials != null AND financials > 0.2`
  - `flood_risk == "Low"`
- Important repo finding:
  - `docs/system/PROJECT_STATE.md` says seeded orchestration rules cover high-density follow-up, high-flood logging, strong-margin reporting, and thin-margin escalation
  - no checked-in `insert into public.agent_action_rules` was found in current migrations or seed files
  - operational implication: unless rules exist in hosted DB, the code falls back to the default post-ranking report rule

## 6. DEAL FEED + NOTIFICATIONS

- How deals enter the feed:
  - upstream stage emits event
  - event dispatcher standardizes context and dedupes
  - rule engine evaluates rules
  - qualifying `post-ranking` or `post-financial` match upserts `deal_feed`
- Write-time `priority_score` formula:
  - `score_component + margin_component - flood_penalty - risk_penalty`
  - defaults:
    - `score_multiplier = 1`
    - `margin_multiplier = 0.6`
    - `flood_penalty_multiplier = 1`
    - `risk_penalty_multiplier = 1`
  - flood penalty:
    - high `15`
    - medium `8`
    - low `0`
    - other `4`
  - risk penalty:
    - high/critical `10`
    - medium `5`
    - low `2`
    - unknown `3`
    - capped at `20`
- Important scoring detail:
  - `rule-engine-agent` writes feed priority using `risks: []`
  - `get-deal-feed` and `notification-agent` can recompute with live risks + latest feedback weights
- Notification creation:
  - `notification-agent` loads all `user_preferences`
  - checks min score, preferred strategy, notification level, throttle window
  - writes:
    - `notification_decision` audit rows
    - `deal_alert` audit rows
- Deduplication/throttling:
  - one `deal_feed` row per `deal_id + trigger_event`
  - one notification per deal/user per throttle window
  - email/webhook repeat suppression by `deal_feed_id`
- High-priority classification:
  - `priority_score >= 85` or `score >= 80`
  - only high-priority deals trigger external email/webhook delivery

## 7. INVESTOR / CAPITAL SYSTEM

- Investor matching logic:
  - implemented in SQL function `investor_match_score`
  - components:
    - strategy score out of `35`
    - budget score out of `25`
    - risk score out of `20`
    - location score out of `20`
  - total score banding:
    - `strong >= 75`
    - `medium >= 50`
    - `weak > 0`
    - `none = 0`
  - refresh path:
    - `refresh_deal_investor_matches`
    - automatically called by `get-deal` / `get-deal-context`
- Outreach system:
  - `investor-outreach` generates deterministic draft only
  - fixed structure:
    - hook
    - preference-fit sentence
    - 3-bullet TL;DR
    - CTA
  - no outbound sending
- Investor pipeline states:
  - `new`, `contacted`, `interested`, `negotiating`, `committed`, `passed`, `archived`
  - relationship-stage mapping also backfills pipeline state from `deal_investors`
- Multi-investor handling:
  - fully supported
  - deal can have many investors across:
    - `deal_investors`
    - `deal_investor_matches`
    - `investor_deal_pipeline`
    - `investor_communications`
    - `deal_capital_allocations`
- Capital allocation logic:
  - portfolio-level `allocate-capital`
    - selects highest-priority feed deals not already in `capital_allocations`
    - distributes pool by relative `priority_score`
  - investor-level commitment tracking:
    - `deal_capital_allocations`
    - statuses: `proposed`, `soft_commit`, `hard_commit`, `funded`
  - UI-ready summary via `deal_capital_summary`

## 8. REPORTING SYSTEM

- `deal-report-agent`
  - orchestrates direct refresh of planning/comparable/yield/financial/ranking context
  - builds structured report JSON
  - asks `ai-agent` for a human-readable summary
  - logs to `ai_actions`
  - indexes output in `report_index`
- Report generation triggers:
  - rules via `rule-engine-agent`
  - fallback threshold in `site-intelligence-agent`
  - manual/operator calls
- Report storage:
  - durable index in `report_index`
  - legacy fallback reads from `ai_actions` if needed
- Report types present:
  - `deal_report`
  - `deal_pack`
  - `weekly_report`
- IM-style outputs present:
  - yes, via human-readable summary and investor outreach style drafting
  - not a full investment memorandum renderer yet

## 9. OPERATOR CONTROLS

- `approval_queue`
  - live policy gate for rule-triggered actions
- Kill switches:
  - `system_settings.system_enabled`
  - shared runtime blocks most agents with `503` when disabled
  - functions allowed while disabled:
    - `system-health-check`
    - `get-usage-summary`
    - `get-operator-summary`
    - `cleanup`
    - `update-system-settings`
    - `get-deal-funnel`
- Manual overrides:
  - deal stage updates
  - outcome updates
  - approval decisions
  - capital allocation
  - report generation
  - cleanup
  - health checks
- Operator UI actually implemented:
  - `internal-ops-dashboard`
  - panels:
    - platform summary
    - deal feed
    - action panel
    - notification dashboard
    - operator controls
    - usage summary

## 10. KNOWLEDGE SYSTEM

- Storage:
  - `knowledge_chunks`
  - `deal_knowledge_links`
- Document ingestion:
  - `add-knowledge-document` chunks and embeds
- Retrieval:
  - RPCs `match_knowledge_chunks` and `match_knowledge_chunks_by_category`
  - `search-knowledge` uses embedding similarity retrieval
- Deal linking:
  - `add-deal-knowledge-link`
  - `get-deal` / `get-deal-context` do not currently merge `deal_knowledge_links` into the returned payload

## 11. AUTOMATION & ORCHESTRATION

- `agent-orchestrator`
  - executes structured action lists returned by reasoning agents
- Action execution flow:
  - stage agent emits event
  - dispatcher dedupes and invokes rule engine
  - rule engine:
    - fetches rules
    - evaluates conditions
    - optionally queues approvals
    - invokes target functions
    - writes feed if allowed
    - invokes notifications
    - creates auto tasks
- `ai_actions` logging covers:
  - runtime execution
  - event dispatch
  - rule evaluations
  - executed actions
  - notifications and deliveries
  - status transitions
  - report generation
  - outreach generation
  - settings/cleanup/outcome logs
- Recursion / duplicate protection:
  - event dispatcher dedupe by exact context hash
  - in-progress suppression
  - deal feed uniqueness
  - duplicate-safe task creation
  - duplicate-safe approval queue via `dedupe_key`
  - report duplicate suppression for recent `deal-report-agent` result
  - retry queue for failed side effects

## 12. CURRENT SYSTEM STATE

- COMPLETE in code:
  - core Supabase schema and edge-function architecture
  - planning agents
  - site pipeline orchestration
  - feasibility + ranking pipeline
  - event dispatch + rule engine
  - feed + realtime fallback + notifications
  - reporting index + deal packs + weekly reports
  - investor registry, matching, CRM, communications, outreach drafting
  - operator dashboard, health, usage, kill switch, approvals, cleanup
  - outcomes + scoring feedback
- PARTIAL / constrained:
  - rule behavior depends on hosted `agent_action_rules` population
  - `da-discovery-agent` still uses mock planning data
  - `planning-da-discovery-agent` filtering is lightweight text matching
  - write-time feed priority excludes live risks
  - multiple legacy-hosted compatibility paths remain in read/write logic
  - several operational jobs exist only as manual endpoints, not schedulers
- NOT BUILT in checked-in code:
  - autonomous outbound investor sending
  - payment/distribution/waterfall logic
  - scheduled recurring health checks / cleanup / weekly reporting inside repo
  - ML ranking layer
  - cadastre-wide parcel scanner
  - investor-facing external deal feed workflow

## 13. UI/UX IMPLICATIONS

### Deal feed and triage

- User needs to SEE:
  - current surfaced deals
  - trigger event, summary, status, raw score, effective priority score
  - why the deal surfaced
  - stage/status transitions
- User needs to DO:
  - filter/sort feed
  - open deal detail
  - trigger follow-up actions
  - approve/reject gated actions
- Automate vs manual:
  - automate surfacing and notification
  - manual triage, approval, final workflow decisions
- TL;DR vs deep detail:
  - TL;DR: score, priority, summary, risk flag, trigger event
  - deep: rule match reasons, financial context, audit log, recalculated scoring inputs

### Deal detail / execution workspace

- User needs to SEE:
  - deal header, lifecycle status, stage
  - planning controls
  - financial snapshots
  - risks, tasks, milestones, communications
  - timeline from `deal_activity_feed`
  - reports and knowledge links
- User needs to DO:
  - update stage
  - add tasks/communications/knowledge links
  - run report generation
  - record outcomes
- Automate vs manual:
  - automate context assembly
  - manual execution and overrides
- TL;DR vs deep detail:
  - TL;DR: opportunity snapshot, recommendation, margin, risk, stage
  - deep: every snapshot, audit record, comparable evidence, planning outputs

### Investor / capital screens

- User needs to SEE:
  - investor registry
  - match scores and reasons
  - deal terms
  - pipeline status per investor
  - communications log
  - capital commitments and capital summary
- User needs to DO:
  - attach investors to deals
  - update CRM state
  - log communications
  - generate outreach draft
  - record commitments
- Automate vs manual:
  - automate matching, suggestions, draft generation
  - manual relationship management and commitment updates
- TL;DR vs deep detail:
  - TL;DR: strongest matches, next follow-up, amount committed, remaining capital
  - deep: score breakdown, communication history, metadata, deal snapshot used for matching

### Reports and knowledge

- User needs to SEE:
  - indexed reports by type and date
  - report summaries
  - supporting knowledge/doc links
- User needs to DO:
  - generate report/pack
  - retrieve previous versions
  - attach support docs
- Automate vs manual:
  - automate report generation once triggered
  - manual selection, review, sharing
- TL;DR vs deep detail:
  - TL;DR: report title, recommendation, date, summary
  - deep: full payload, render hints, source agent/action

### Operator controls

- User needs to SEE:
  - kill switch state
  - pending approvals
  - retry queue
  - system health
  - usage/cost summary
  - funnel metrics
- User needs to DO:
  - approve/reject queued actions
  - toggle system enabled state
  - run cleanup/health checks/reports
  - allocate capital
  - update outcomes
- Automate vs manual:
  - automate logging, monitoring data collection, guardrails
  - manual control for high-impact actions
- TL;DR vs deep detail:
  - TL;DR: system enabled, pending retries, health status, approval count
  - deep: exact component errors, retry payloads, action payloads, historical usage

### Screens implied by the current system

- Deal Feed
- Deal Detail
- Deal Timeline / Activity
- Reports Library
- Investor Registry
- Deal-Investor Workspace
- Capital Raise / Allocation
- Approvals Queue
- Operator Dashboard
- Usage / Health
- Knowledge Manager

