# USER MANUAL RAW

This document is derived from the current repository state, documented schema, and implemented Supabase Edge Functions. It describes the deployed system shape represented by the codebase as of the current checkout. Where behavior differs between write-time and read-time paths, both are called out explicitly.

## 1. System Overview

### 1.1 System Purpose

The platform is an AI-driven property intelligence and execution system built on:

- Supabase database tables and views
- Supabase Edge Functions
- stage-specific agents
- a shared runtime with validation, kill switch, usage tracking, audit logging, and hourly rate limiting
- an event-driven orchestration layer

Primary goal:

- discover development opportunities
- enrich them with planning and feasibility intelligence
- rank and surface high-quality deals
- notify operators
- execute or queue downstream actions
- track outcomes and feed outcome data back into scoring

### 1.2 End-to-End Lifecycle

Discovery -> Feed -> Notification -> Action -> Outcome -> Feedback

1. Discovery
- `domain-discovery-agent`, `da-discovery-agent`, `planning-da-discovery-agent`, `email-agent`, or direct `site-discovery-agent` input create or forward candidates.
- `site-discovery-agent` geocodes, creates a new `deal_id`, invokes `site-intelligence-agent`, saves a `site_candidates` row, and dispatches `post-discovery`.

2. Intelligence
- `site-intelligence-agent` ensures `deals` and `site_intelligence` records exist, runs planning agents, optionally runs `comparable-sales-agent`, runs `yield-agent`, runs `financial-engine-agent`, updates `site_candidates`, runs `parcel-ranking-agent`, dispatches `post-intelligence`, and handles `post-ranking` and report decisions.

3. Feed surfacing
- `rule-engine-agent` evaluates event-scoped rules for `post-discovery`, `post-intelligence`, `post-ranking`, and `post-financial`.
- Only `post-ranking` and `post-financial` are eligible to upsert `deal_feed`.
- `deal_feed` is only written when at least one matched rule contains a qualifying high-quality clause tied to score, margin/financials, or low risk.

4. Notification
- After a `deal_feed` row is persisted, `rule-engine-agent` invokes `notification-agent`.
- `notification-agent` evaluates every `user_preferences` row independently, suppresses or sends per user, writes notification audit rows into `ai_actions`, applies throttling, and sends external email and webhook alerts only for `high_priority` notifications.

5. Action
- Matching rules execute downstream edge functions in priority order.
- Policy-gated actions can be routed into `approval_queue` instead of being executed immediately.
- The rule engine can also auto-create duplicate-safe tasks: `Prepare lender pack` and `Re-evaluate feasibility`.
- Operators can manually trigger reporting, cleanup, approvals, capital allocation, outcome updates, and kill-switch changes.

6. Outcome
- Operators record final status through `update-deal-outcome`.
- `deal_outcomes` receives the raw outcome record.
- `deal_performance` is recomputed from outcome history.

7. Feedback
- `update-deal-outcome` compares predicted vs actual return and writes bounded weight adjustments into `scoring_feedback`.
- `get-deal-feed` applies the latest `scoring_feedback.adjusted_weights` when recomputing feed priority at read time.

## 2. Core Objects

### 2.1 `deals`

Primary development opportunity record.

Key fields:
- `id`
- `address`
- `status`
- `stage`
- `source`
- `metadata`

Status workflow implemented in code:
- `active -> reviewing -> approved -> funded -> completed`

### 2.2 `deal_feed`

Surfaced opportunity feed. One row per `deal_id + trigger_event`.

Key fields:
- `deal_id`
- `score`
- `priority_score`
- `status`
- `trigger_event`
- `summary`
- `metadata`

Lifecycle:
- `active -> stale -> archived`

### 2.3 `ai_actions`

Platform-wide audit log.

Stores:
- standardized `agent_execution` rows from shared runtime
- event dispatch logs
- rule evaluation logs
- notification decisions and deliveries
- task creation logs
- status transitions
- report generation logs
- cleanup, settings, and approval audit rows

### 2.4 `approval_queue`

Deduplicated holding area for rule-triggered actions that require operator approval.

Fields used operationally:
- `approval_type`
- `status`
- `requested_by_agent`
- `payload`
- `dedupe_key`

Statuses in code:
- `pending`
- `rejected`
- `executed`
- `failed`

### 2.5 `deal_performance`

Per-deal engagement and outcome aggregate table.

Tracked metrics:
- `views`
- `notifications_sent`
- `actions_taken`
- `outcomes_recorded`
- `last_actual_return`
- `average_actual_return`
- `average_duration_days`
- `last_viewed_at`

### 2.6 `deal_outcomes`

Append-only outcome snapshots per deal.

Fields:
- `outcome_type`
- `actual_return`
- `duration_days`
- `notes`

Allowed `outcome_type`:
- `won`
- `lost`
- `in_progress`

### 2.7 `scoring_feedback`

Adaptive scoring audit log derived from actual outcomes.

Stores:
- predicted priority score
- predicted return
- actual return
- adjustment factor
- previous weights
- adjusted weights

### 2.8 `capital_allocations`

One allocation row per allocated deal.

Fields:
- `deal_id`
- `allocated_amount`
- `allocation_status`
- `expected_return`

Allocation statuses:
- `proposed`
- `committed`
- `deployed`

### 2.9 `system_settings`

Global operator safety settings.

Current implemented use:
- single row with `setting_key = global`
- `system_enabled` kill switch checked by shared runtime before agent work

## 3. Agent Map

### 3.1 Event and Runtime Helpers

| Component | Trigger | Output |
|---|---|---|
| `agent-runtime` | wraps almost all POST edge functions | request validation, `agent_registry` status updates, `ai_actions` execution audit, `usage_metrics`, kill-switch enforcement, hourly rate-limit enforcement |
| `event-dispatcher` (`_shared/event-dispatch-v2.ts`) | called by discovery, intelligence, ranking, and financial agents | builds event context, hashes context, deduplicates by `deal_id + event + context_hash`, invokes `rule-engine-agent`, logs dispatch state |
| `action-layer-compat` | used by task and action writers | normalizes writes to legacy hosted `tasks`, `risks`, and rule schemas |

### 3.2 Discovery Agents

| Agent | Trigger | Output |
|---|---|---|
| `domain-discovery-agent` | manual POST with `suburbs[]` | queries Domain API, filters listings by land area, forwards candidates to `site-discovery-agent`, returns per-suburb candidate counts |
| `da-discovery-agent` | manual POST with source, jurisdiction, statuses, and limit | filters mock planning applications to apartment and multi-dwelling DAs, forwards to `site-discovery-agent`, logs planning discovery summary |
| `planning-da-discovery-agent` | manual POST | queries NSW Planning Portal layer 14, filters apartment-style descriptions, forwards candidates to `site-discovery-agent` |
| `site-discovery-agent` | called by discovery agents or manually | geocodes address, creates new `deal_id`, invokes `site-intelligence-agent`, saves `site_candidates`, dispatches `post-discovery`, returns candidate-level processing results |
| `email-agent` | inbound email POST | stores or updates email thread and communication, extracts address with OpenAI, fetches deal context, gets AI decision, invokes `agent-orchestrator`, `deal-intelligence`, and optionally `site-intelligence-agent` |

### 3.3 Planning and Intelligence Agents

| Agent | Trigger | Output |
|---|---|---|
| `site-intelligence-agent` | called by `site-discovery-agent`, `email-agent`, or manually | full site pipeline result, `site_intelligence` updates, `site_candidates` update, `post-intelligence` dispatch, `post-ranking` and report decision summary, optional `site_intelligence.raw_data` persistence |
| `zoning-agent` | invoked by `site-intelligence-agent` or manually | zoning value persisted into `site_intelligence` |
| `flood-agent` | invoked by `site-intelligence-agent` or manually | flood overlay and risk persisted into `site_intelligence` |
| `fsr-agent` | invoked by `site-intelligence-agent` or manually | FSR persisted into `site_intelligence` |
| `height-agent` | invoked by `site-intelligence-agent` or manually | height limit persisted into `site_intelligence` |
| `heritage-agent` | invoked by `site-intelligence-agent` or manually | heritage status persisted into `site_intelligence` |
| `deal-intelligence` | called by `email-agent` or manually | aggregated risks, milestones, and financial insights written back to deal context |

### 3.4 Feasibility and Ranking Agents

| Agent | Trigger | Output |
|---|---|---|
| `comparable-sales-agent` | optional within `site-intelligence-agent`, or manual | comparable-sales estimate row plus supporting evidence rows |
| `yield-agent` | invoked by `site-intelligence-agent` or manually | estimated GFA, units, revenue, build cost, profit; updates `site_intelligence` |
| `financial-engine-agent` | invoked by `site-intelligence-agent` or manually | structured feasibility output, `financial_snapshots` row, `financial_feasibility_calculated` audit row, `post-financial` dispatch |
| `parcel-ranking-agent` | invoked by `site-intelligence-agent` or manually | deal-mode ranking score, tier, reasoning, `site_candidates` ranking update, `deal_ranked` audit row, `post-ranking` dispatch; batch mode updates `site_candidates` only |
| `deal-report-agent` | triggered by rules, fallback threshold path, or manually | structured investment report JSON plus human-readable summary |

### 3.5 Decision and Communication Agents

| Agent | Trigger | Output |
|---|---|---|
| `rule-engine-agent` | invoked by event dispatcher | evaluates rules, executes actions, optionally queues approvals, upserts `deal_feed`, invokes `notification-agent`, creates auto tasks, writes audit rows |
| `notification-agent` | invoked after successful `deal_feed` persistence or manually | per-user decisions, `deal_alert` rows in `ai_actions`, optional external email and webhook delivery, `deal_performance.notifications_sent` increment |
| `agent-orchestrator` | called by `email-agent` or manually | executes structured action lists returned by reasoning agents |
| `ai-agent` | called by `email-agent`, `deal-agent`, or manually | reasoning response with knowledge retrieval support |
| `deal-agent` | manual | fetches deal context, reasons on next actions, delegates execution |

### 3.6 Operator and Analytics Agents

| Agent | Trigger | Output |
|---|---|---|
| `get-deal-feed` | manual, operator, or UI | filtered surfaced deals, recomputed or persisted `priority_score`, applied preferences, increments views |
| `get-top-deals` | manual, operator, or UI | top deals ranked by composite score or priority score |
| `subscribe-deal-feed` | manual or UI | realtime channel contract plus fallback channel and optional user preferences |
| `get-operator-summary` | manual, operator, or UI | flat platform summary counts |
| `get-usage-summary` | manual, operator, or UI | usage and estimated cost aggregates |
| `system-health-check` | manual, operator, or UI | health snapshot and `system_health` upserts |
| `internal-ops-dashboard` | GET or POST | operator HTML UI or control-surface action results |
| `update-system-settings` | operator action | kill-switch update and audit log |
| `approve-approval-queue` | operator action | approval decision, downstream execution on approval, audit log |
| `cleanup` | operator action | trims aged metrics, trims realtime fallback rows, and fails exhausted retries |
| `allocate-capital` | operator action | capital allocation rows and audit log |
| `update-deal-outcome` | operator action | outcome row, recomputed performance, optional scoring feedback |
| `get-deal-funnel` | operator action | lifecycle counts, conversions, average time in stage |
| `generate-deal-report` | operator action | weekly structured report and `report_index` row |
| `generate-deal-pack` | operator action | investor deal-pack JSON and report index row |
| `get-deal-reports` | operator or UI | indexed reports and packs |

### 3.7 Data, Context, Knowledge, and Utility Agents

| Agent | Trigger | Output |
|---|---|---|
| `get-deal` | manual or caller dependency | core deal with related records |
| `get-deal-context` | manual or caller dependency | contextual deal payload across records |
| `get-deal-timeline` | manual, operator, or UI | unified timeline from `deal_activity_feed` |
| `log-communication` | manual or caller dependency | communication row |
| `create-task` | manual, orchestrator, or rule-engine auto-task path | duplicate-safe task row and performance increment |
| `update-deal-stage` | manual or automatic evaluation path | validated status and stage transition with deduped transition audit |
| `add-financial-snapshot` | manual or caller dependency | snapshot row |
| `add-knowledge-document` | manual | `knowledge_chunks` rows with embeddings |
| `search-knowledge` | manual or caller dependency | vector-search retrieval results |
| `add-deal-knowledge-link` | manual or operator | lightweight deal and document link and audit row |
| `test-agent` | manual | echo-style health response |

## 4. API Layer

Base path:

- `/functions/v1/{agent-name}`

Implementation rules enforced by shared runtime:

- POST only for nearly all functions
- `400` on validation failure
- `429` on rate-limit violation
- `503` when `system_settings.system_enabled = false` unless a function explicitly allows execution while disabled
- standardized `agent_execution` audit rows

### 4.1 Discovery and Intake Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `domain-discovery-agent` | Discover listing candidates from Domain and forward to site discovery | `suburbs[]`, optional `minLandArea` | per-suburb candidate counts | manual POST only |
| `da-discovery-agent` | Discover mock planning applications and forward candidate sites | `source`, `jurisdiction`, `statuses[]`, `limit` | scanned, matched, and forwarded counts and forwarded result | manual POST only |
| `planning-da-discovery-agent` | Query NSW Planning Portal DA layer and forward apartment-style candidates | no required body | candidate count and site-discovery result | manual POST only |
| `site-discovery-agent` | Submit candidate sites into analysis pipeline | `candidates[]` | per-candidate results with `deal_id`, discovery score, and event dispatch result | called by discovery agents or manual POST |
| `email-agent` | Process inbound email into communications, reasoning, orchestration, and optional site analysis | `sender`, `subject`, `body`, `deal_id` | `status`, `thread_id`, `aiDecision`, `detectedAddress` | inbound email integration or manual POST |

### 4.2 Planning and Intelligence Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `site-intelligence-agent` | Full site pipeline orchestration | `deal_id`, `address`, optional `force_refresh`, `use_comparable_sales` | pipeline summary, stage results, ranking score, report decision, warnings, final report if run | called by `site-discovery-agent`, `email-agent`, or manual POST |
| `zoning-agent` | Retrieve zoning controls | `deal_id`, `address` | zoning response and persistence into `site_intelligence` | called inside site pipeline or manual POST |
| `flood-agent` | Retrieve flood overlay and risk | `deal_id`, `address` | flood response and persistence into `site_intelligence` | called inside site pipeline or manual POST |
| `fsr-agent` | Retrieve FSR controls | `deal_id`, `address` | FSR response and persistence into `site_intelligence` | called inside site pipeline or manual POST |
| `height-agent` | Retrieve building height controls | `deal_id`, `address` | height response and persistence into `site_intelligence` | called inside site pipeline or manual POST |
| `heritage-agent` | Retrieve heritage status | `deal_id`, `address` | heritage response and persistence into `site_intelligence` | called inside site pipeline or manual POST |
| `deal-intelligence` | Aggregate analysis and write structured deal intelligence | `deal_id` | intelligence result | called by `email-agent` or manual POST |

### 4.3 Feasibility and Ranking Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `comparable-sales-agent` | Generate comparable sale price per sqm estimate and evidence | `deal_id`, optional `radius_km`, `dwelling_type` | estimate id, price per sqm, comparables | optional stage within `site-intelligence-agent` or manual POST |
| `yield-agent` | Estimate GFA, units, revenue, build cost, and profit | `deal_id`, optional `use_comparable_sales` | yield model output | called by `site-intelligence-agent` or manual POST |
| `financial-engine-agent` | Calculate feasibility and persist snapshot | `deal_id`, optional `refresh_yield`, `use_comparable_sales`, `assumptions` | structured feasibility output, snapshot id, event dispatch result | called by `site-intelligence-agent` or manual POST |
| `parcel-ranking-agent` | Rank a deal or batch-rank site candidates | deal mode: `deal_id`; batch mode: `limit`, `only_unranked` | deal ranking output or `top_sites` batch output | called by `site-intelligence-agent` or manual POST |
| `deal-report-agent` | Build investment-ready deal report | `deal_id`, optional `use_comparable_sales` | structured report JSON and human-readable summary | triggered by rules, fallback threshold in site pipeline, or manual POST |
| `generate-deal-pack` | Build investor-facing deal pack | `deal_id` | structured deal-pack JSON | manual or operator trigger |
| `add-financial-snapshot` | Persist a financial snapshot | deal and snapshot fields | inserted snapshot | manual or caller dependency |

### 4.4 Event, Rule, and Action Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `get-agent-rules` | Return event or stage rules for an agent | `agent_name`, `event` or stage context | normalized rule rows | invoked by `rule-engine-agent` or manual POST |
| `rule-engine-agent` | Evaluate rules, execute actions, manage feed, notifications, and tasks | `deal_id`, `event`, optional `action_context`, `event_context` | execution summary, skipped rules, `deal_feed_entry`, `notification_result`, warnings | invoked by event dispatcher on `post-discovery`, `post-intelligence`, `post-ranking`, `post-financial`; may also be called manually |
| `agent-orchestrator` | Execute structured actions from AI reasoning | `deal_id`, `aiDecision` | action execution results | called by `email-agent` or manual POST |
| `create-task` | Create duplicate-safe task | `deal_id`, `title`, optional `description`, `assigned_to`, `due_date` | task row, compatibility mode, warnings | manual, orchestrator, or rule-engine auto-task path |
| `approve-approval-queue` | Review pending approval and optionally execute downstream function | `approval_id`, `decision`, optional `operator_note` | updated approval row and execution result | operator action or dashboard action |

### 4.5 Feed, Notification, and Deal Access Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `notification-agent` | Evaluate per-user notification delivery and external high-priority delivery | `deal_feed_id`, `deal_id`, optional `score`, `priority_score`, `trigger_event`, `summary` | `notifications`, `decisions`, `deliveries`, warnings | automatically called after `deal_feed` persistence or manual POST |
| `get-deal-feed` | Return surfaced feed rows with optional preference filtering | optional `limit`, `score`, `status`, `sort_by`, `user_id` | feed items, applied preferences, warnings | manual, operator, or UI |
| `subscribe-deal-feed` | Return realtime subscription contract | optional `user_id` | broadcast topic, fallback table channel, optional preferences | frontend or UI integration |
| `get-top-deals` | Return top deals by composite, priority, or recency sorting | optional `limit`, `sort_by` | ranked items with `priority_score`, `views`, and `actions_taken` | operator, UI, or manual |
| `get-deal` | Fetch core deal and related records | `deal_id` | core deal payload | manual or caller dependency |
| `get-deal-context` | Fetch contextual deal data | `deal_id` | combined deal context | used by `email-agent`, `deal-agent`, `deal-report-agent`, or manual |
| `get-deal-timeline` | Fetch timeline from unified activity view | `deal_id` | timeline items | operator, UI, or manual |
| `get-deal-reports` | Retrieve reports, packs, and weekly reports | optional `deal_id`, `report_type`, `created_at`, `limit` | indexed report items | operator, UI, or manual |
| `log-communication` | Store communication history | communication fields | inserted communication result | manual or caller dependency |

### 4.6 Operator, Analytics, and Control Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `system-health-check` | Evaluate database, key agents, action flow, and feed activity | none | overall health plus per-component checks | operator, manual, or dashboard |
| `get-operator-summary` | Return operator summary counts | none | active deals, high-priority deals, recent notifications, pending retries, health, reports | operator, manual, or dashboard |
| `get-usage-summary` | Aggregate usage metrics and estimated cost | none | last 24h and 7d windows | operator, manual, or dashboard |
| `update-system-settings` | Update global kill switch | `system_enabled`, optional `note` | updated settings row | operator, manual, or dashboard |
| `cleanup` | Trim aged operational data and fail exhausted retries | optional retention day values | delete and fail counts | operator, manual, or dashboard |
| `internal-ops-dashboard` | Serve internal operator UI and action proxy | GET: none; POST: `action`, `payload` | HTML page or proxied action result | browser access or operator POST |
| `allocate-capital` | Allocate capital across top eligible feed deals | `capital_pool`, optional `max_deals`, `allocation_status`, `minimum_priority_score` | allocation rows | operator, manual, or dashboard |
| `update-deal-outcome` | Record deal outcome and scoring feedback | `deal_id`, `outcome_type`, optional `actual_return`, `duration_days`, `notes` | outcome row, recomputed `deal_performance`, optional `scoring_feedback` | operator, manual, or dashboard |
| `get-deal-funnel` | Compute lifecycle funnel metrics | none | counts, conversion rates, average stage times | operator, manual, or dashboard |
| `generate-deal-report` | Generate weekly structured summary | optional `days` | weekly report payload | operator, manual, or dashboard |
| `update-deal-stage` | Validate and apply deal stage or status changes | `deal_id`, optional `new_stage`, `new_status`, `transition_reason`, `auto_evaluate` | updated deal and change flags | operator, manual, or automatic evaluation path |

### 4.7 Knowledge, AI Support, and Utility Endpoints

| Function | Purpose | Inputs | Outputs | Trigger Conditions |
|---|---|---|---|---|
| `ai-agent` | LLM reasoning with retrieval support | prompt-oriented payload | structured AI reasoning response | called by `email-agent`, `deal-agent`, or manual |
| `deal-agent` | Determine next actions for a deal | `deal_id` and prompt or context | reasoning and delegated execution response | manual |
| `add-knowledge-document` | Chunk document and store embeddings | document fields and content | stored chunk result | manual |
| `search-knowledge` | Search knowledge chunks by embedding similarity | query text, optional category controls | retrieved chunk list | called by AI flows or manual |
| `add-deal-knowledge-link` | Link a deal to external or knowledge reference | `deal_id`, `document_type`, `source_ref`, optional `summary`, `metadata` | inserted link row | manual or operator |
| `test-agent` | Simple test endpoint | any test payload | echo response | manual |

## 5. Decision Logic

### 5.1 How Deals Enter `deal_feed`

Implemented path:

1. A pipeline stage emits an event:
- `post-discovery`
- `post-intelligence`
- `post-ranking`
- `post-financial`

2. `event-dispatcher` builds a standardized context:
- `score`
- `zoning`
- `zoning_density`
- `flood_risk`
- `yield`
- `financials`

3. Dispatcher computes `context_hash = SHA-256(JSON.stringify({ score, zoning, yield, financials }))`.

4. Dispatcher suppresses duplicate execution when the same `deal_id + event + context_hash` has already completed or is in progress.

5. Dispatcher invokes `rule-engine-agent`.

6. `rule-engine-agent` loads persisted event rules through `get-agent-rules`. If none load, it falls back only for `post-ranking` to a default threshold report rule using `REPORT_TRIGGER_SCORE_THRESHOLD` with default `50`.

7. `rule-engine-agent` evaluates null-safe rule conditions using:
- `>`, `<`, `>=`, `<=`, `==`, `!=`
- conjunction `AND`
- no `OR` support

8. `deal_feed` upsert is attempted only for:
- `post-ranking`
- `post-financial`

9. `deal_feed` upsert occurs only when at least one matched rule contains a qualifying high-quality clause:
- score threshold clause
- margin or `financials` threshold clause
- low-risk clause on `flood_risk`

10. Upsert key:
- `(deal_id, trigger_event)`

Result:
- qualifying reruns update existing rows rather than creating duplicates

### 5.2 How `priority_score` Is Computed

#### Write-time score

`rule-engine-agent` computes and persists a feed score as:

`priority_score = score_component + margin_component - flood_penalty - risk_penalty`

Default weights:
- `score_multiplier = 1`
- `margin_multiplier = 0.6`
- `flood_penalty_multiplier = 1`
- `risk_penalty_multiplier = 1`

Components:
- `score_component = score * score_multiplier`
- `margin_component = margin * 100 * margin_multiplier`

Flood penalty mapping:
- high -> 15
- medium -> 8
- low -> 0
- other non-empty -> 4

Risk penalty mapping across unresolved risks:
- high or critical -> +10 each
- medium -> +5 each
- low -> +2 each
- unknown -> +3 each
- capped at 20 total

Important write-time detail:
- `rule-engine-agent` currently computes the persisted `deal_feed.priority_score` with `risks: []`
- this means persisted write-time score does not include live `risks` rows

#### Read-time score

`get-deal-feed` and `notification-agent` can recompute `priority_score` using:
- persisted feed score
- margin from feed metadata or latest `financial_snapshots`
- `site_intelligence.flood_risk`
- live `risks` rows
- latest `scoring_feedback.adjusted_weights`

This is the effective operator-facing score path.

#### Feedback weight bounds

`scoring_feedback` weight adjustments are clamped:
- `score_multiplier`: `0.85` to `1.15`
- `margin_multiplier`: `0.35` to `0.9`
- `flood_penalty_multiplier`: `0.75` to `1.4`
- `risk_penalty_multiplier`: `0.75` to `1.4`

### 5.3 How Notifications Are Triggered

Notification path:

1. `rule-engine-agent` successfully persists a `deal_feed` row.
2. It invokes `notification-agent` with:
- `deal_feed_id`
- `deal_id`
- `score`
- `priority_score`
- `trigger_event`
- `summary`
3. `notification-agent` loads or resolves:
- feed row
- deal row
- latest financial margin
- flood risk
- live risks
- all `user_preferences`
4. Notification type classification:
- `high_priority` if `priority_score >= 85` or `score >= 80`
- otherwise `standard`
5. For each user:
- suppress if feed does not match `min_score` or `preferred_strategy`
- suppress if notification level does not allow the type
- suppress if throttled by a previous `deal_alert` in the throttle window
- otherwise create a `deal_alert` row in `ai_actions`
6. If any notifications were sent:
- increment `deal_performance.notifications_sent`
7. External delivery:
- only for `high_priority`
- email channel optional
- webhook channel optional

Throttle behavior:
- one notification per deal per user per throttle window
- default throttle window: `1440` minutes

### 5.4 How Auto-Actions Fire

#### Rule-driven downstream actions

For every matched rule, `rule-engine-agent`:
- merges standard context into action payload
- applies any rule payload overrides
- executes target edge function in ascending priority order

If the rule payload sets any of:
- `requires_approval`
- `approval_required`
- `route_to_approval_queue`

then:
- action execution is skipped
- request is upserted into `approval_queue`

#### Auto-created tasks

Independent of persisted rules, `rule-engine-agent` also computes automatic tasks.

`Prepare lender pack`
- created when computed `priority_score > 90`
- and flood risk is low

`Re-evaluate feasibility`
- created when any of the following vs previous feed baseline are true:
  - score improvement >= 10
  - margin improvement >= 0.05
  - priority improvement >= 12

Task creation is duplicate-safe through `create-task`.

## 6. Operator Controls

### 6.1 Kill Switch

Control surface:
- `update-system-settings`
- dashboard `toggle-system`

Storage:
- `system_settings(setting_key = global, system_enabled)`

Effect:
- shared runtime blocks most agents before handler execution when disabled
- blocked response status: `503`

Functions explicitly allowed when disabled:
- `system-health-check`
- `get-usage-summary`
- `get-operator-summary`
- `cleanup`
- `update-system-settings`
- `get-deal-funnel`

### 6.2 Approvals

Creation path:
- rule payload flags route actions to `approval_queue`

Review path:
- `approve-approval-queue`
- dashboard `approve-queue`

Approval execution behavior:
- approved: downstream function in `approval_queue.payload.action` is invoked
- rejected: request is marked rejected
- failed execution: request status becomes `failed`

### 6.3 Manual Triggers

Manual triggers exist for:
- all edge functions via HTTP
- dashboard actions:
  - health check
  - cleanup
  - weekly report generation
  - kill-switch enable and disable
  - approval execution
  - capital allocation
  - outcome update

### 6.4 Cleanup

`cleanup` performs bounded maintenance:
- deletes old `usage_metrics`
- deletes old `deal_feed_realtime_fallback` rows
- marks `agent_retry_queue` rows as `failed` when `retry_count >= 3` and status is `queued` or `retrying`

### 6.5 Reporting

Operator-facing reporting endpoints:
- `generate-deal-report`
- `generate-deal-pack`
- `get-deal-reports`
- `get-operator-summary`
- `get-usage-summary`
- `get-deal-funnel`
- `get-top-deals`

## 7. Observability + Safety

### 7.1 Usage Tracking

Implemented by shared runtime:
- one `usage_metrics` row per successful or client-error execution
- no usage row on server error (`>= 500`)
- estimated cost comes from:
  - `AGENT_ESTIMATED_COST_{AGENT}`
  - else `DEFAULT_AGENT_ESTIMATED_COST`
  - else `0`

Usage summary surfaces:
- `get-usage-summary`
- `internal-ops-dashboard`

### 7.2 Rate Limiting

Implemented by shared runtime:
- reads and upserts `agent_rate_limits` per agent
- default hourly limit from `DEFAULT_AGENT_MAX_CALLS_PER_HOUR`, default `120`
- returns `429` when recent `usage_metrics.calls` in last hour meet or exceed limit

Can be bypassed only by functions configured with `skipRateLimit: true`.

### 7.3 Retries

Implemented retry behaviors:
- `rule-engine-agent` retries `deal_feed` writes
- `rule-engine-agent` retries `notification-agent` invocation
- failed feed writes can be queued into `agent_retry_queue`
- exhausted notification retries produce a downgrade audit path instead of repeated retries
- webhook delivery in `notification-agent` retries up to `NOTIFICATION_WEBHOOK_MAX_RETRIES`

### 7.4 Health Checks

`system-health-check` validates:
- database access through `agent_registry`
- presence and freshness of key agents:
  - `rule-engine-agent`
  - `notification-agent`
  - `site-intelligence-agent`
  - `site-discovery-agent`
  - `get-deal-feed`
- recent `ai_actions` activity within 6 hours
- recent `deal_feed` activity within 6 hours

Persists results into:
- `system_health`

### 7.5 Auditability

Primary audit stores:
- `ai_actions`
- `agent_registry`
- `usage_metrics`
- `system_health`
- `approval_queue`
- `report_index`

### 7.6 Duplicate Suppression and Safety Guards

Implemented safeguards:
- event dispatch dedupe by `deal_id + event + context_hash`
- `deal_feed` uniqueness on `deal_id + trigger_event`
- duplicate-safe task creation by `deal_id + title` for open tasks
- approval dedupe via `approval_queue.dedupe_key`
- webhook and email repeat suppression by `deal_feed_id`
- notification per-user throttling
- site-intelligence pipeline cooldown of 5 minutes unless `force_refresh = true`

## 8. Data Flow Diagram (Textual)

### 8.1 Standard Discovery-to-Feedback Flow

1. Discovery source produces a candidate.
2. Candidate enters `site-discovery-agent`.
3. `site-discovery-agent` geocodes address and creates a new `deal_id`.
4. `site-discovery-agent` calls `site-intelligence-agent`.
5. `site-intelligence-agent` upserts `deals` and `site_intelligence`.
6. Planning agents write zoning, flood, height, FSR, and heritage data into `site_intelligence`.
7. `site-intelligence-agent` dispatches `post-intelligence`.
8. Optional comparable-sales refresh runs.
9. `yield-agent` writes yield outputs.
10. `financial-engine-agent` writes `financial_snapshots` and dispatches `post-financial`.
11. `site-intelligence-agent` updates `site_candidates`.
12. `parcel-ranking-agent` computes ranking, updates `site_candidates`, writes `deal_ranked`, and dispatches `post-ranking`.
13. Event dispatcher calls `rule-engine-agent` for the stage event.
14. `rule-engine-agent` evaluates rules against standardized context.
15. Matching rules execute actions immediately or queue approval requests.
16. For `post-ranking` and `post-financial`, qualifying matched rules can upsert `deal_feed`.
17. `notification-agent` evaluates the new or updated `deal_feed` row for all users.
18. Notification decisions and deliveries are written to `ai_actions`.
19. Operators consume surfaced deals through `get-deal-feed`, `get-top-deals`, and `internal-ops-dashboard`.
20. Operators can approve actions, create or update tasks, generate reports, allocate capital, and update deal stage or outcome.
21. `update-deal-outcome` writes `deal_outcomes`, refreshes `deal_performance`, and writes `scoring_feedback`.
22. Future `get-deal-feed` requests apply latest feedback-adjusted scoring weights.

### 8.2 Email-Initiated Flow

1. Email enters `email-agent`.
2. Email thread and communication rows are created or updated.
3. Address is extracted by OpenAI.
4. `get-deal-context` is fetched.
5. `ai-agent` produces a reasoning and action decision.
6. `agent-orchestrator` executes structured actions.
7. `deal-intelligence` refreshes aggregated intelligence.
8. If an address was extracted, `site-intelligence-agent` is invoked for the same `deal_id`.

## 9. Known Gaps / Runtime Dependencies

### 9.1 External Dependencies

Required for full operation of specific features:

- Supabase:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Some AI and caller flows also expect:
  - `SUPABASE_ANON_KEY`
- OpenAI:
  - `OPENAI_API_KEY`
  - used by `ai-agent`, `deal-agent`, `deal-intelligence`, `email-agent`, `comparable-sales-agent`, `add-knowledge-document`, `search-knowledge`
- Domain discovery:
  - `DOMAIN_API_KEY`
- Notification email delivery:
  - `NOTIFICATION_EMAIL_API_URL`
  - `NOTIFICATION_EMAIL_FROM`
  - `NOTIFICATION_EMAIL_TO`
  - optional `NOTIFICATION_EMAIL_API_KEY`
  - optional `NOTIFICATION_EMAIL_AUTH_HEADER`
- Notification webhook delivery:
  - `NOTIFICATION_WEBHOOK_URL`
  - optional `NOTIFICATION_WEBHOOK_AUTH_HEADER`
  - optional `NOTIFICATION_WEBHOOK_AUTH_TOKEN`
  - optional `NOTIFICATION_WEBHOOK_FORMAT`
  - optional retry settings
- Deal links:
  - optional `DEAL_LINK_BASE_URL`
  - optional `APP_BASE_URL`
- Runtime tuning:
  - `DEFAULT_AGENT_MAX_CALLS_PER_HOUR`
  - `DEFAULT_AGENT_ESTIMATED_COST`
  - agent-specific cost env vars
  - `REPORT_TRIGGER_SCORE_THRESHOLD`

External HTTP services used directly in code:
- OpenStreetMap Nominatim geocoding
- NSW map and ArcGIS planning layers
- Domain listings API
- OpenAI Responses, Embeddings, and Chat Completions APIs
- configured email provider endpoint
- configured webhook endpoint

### 9.2 Conditions Required for Full Operation

The following conditions are required for end-to-end automated behavior:

- hosted schema must include the tables documented in `docs/database/SCHEMA.md`
- hosted schema alignment should include `site_intelligence.raw_data` and `site_intelligence.updated_at` for full raw payload persistence
- RPC functions used by the code must exist:
  - `increment_deal_performance_metrics`
  - `sync_deal_performance_outcome_metrics`
- `agent_action_rules` should be populated for event-specific rule behavior; otherwise only the default `post-ranking` report fallback exists
- `user_preferences` must contain rows for user-targeted notifications
- high-priority external notifications require email and webhook env vars
- discovery quality depends on external provider availability
- comparable-sales quality depends on OpenAI availability and comparable data generation

### 9.3 Current Runtime Gaps and Compatibility Notes

- `planning-da-discovery-agent` uses a live NSW portal query but does not implement filtering beyond simple text matching on development description.
- `da-discovery-agent` still uses a mock planning dataset by design.
- `rule-engine-agent` persists `deal_feed.priority_score` without incorporating live `risks`; operator-facing readers may recompute a different effective score.
- `site-intelligence-agent` still preserves a legacy fallback report trigger based on `REPORT_TRIGGER_SCORE_THRESHOLD` when rule execution fails or no report rule matches.
- Several endpoints support legacy hosted schema compatibility paths for `tasks`, `risks`, `agent_action_rules`, and `site_intelligence`.
- Full automation depends on events actually being emitted by upstream agents. If a stage is never invoked, downstream rules, feed writes, and notifications do not occur.

### 9.4 Manual and Operator Dependencies

The following capabilities are not shown as autonomous schedulers in the current codebase and therefore require manual triggering or external orchestration:

- periodic health checks
- periodic cleanup
- periodic weekly report generation
- capital allocation runs
- approval reviews
- deal outcome updates
- deal stage transitions
