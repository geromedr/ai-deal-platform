# Agent Catalogue

This document lists all system agents.

## Core System

### agent-orchestrator

Executes structured actions returned by reasoning agents, with
compatibility-aware writes for legacy hosted task and risk schemas.

### rule-engine-agent

Evaluates event-scoped orchestration rules fetched from `get-agent-rules`,
compares null-safe conditions against standardized event context (`score`,
`zoning`, `zoning_density`, `flood_risk`, `yield`, `financials`), executes
downstream agents in priority order with duplicate-safe report suppression,
upserts high-quality `deal_feed` entries on `post-ranking` and `post-financial`
when matched rules indicate strong score, margin, or low-risk signals, triggers
`notification-agent` for persisted feed rows, auto-creates duplicate-safe
`Prepare lender pack` and `Re-evaluate feasibility` tasks when high-priority or
significantly improved conditions are met, and returns structured rule, feed,
notification, and audit results for `post-discovery`, `post-intelligence`,
`post-ranking`, and `post-financial`.

### ai-agent

Provides AI reasoning support with knowledge retrieval.

### deal-agent

Advances a deal by requesting context, reasoning on next actions, and delegating
execution.

### deal-intelligence

Aggregates analysis outputs and records risks, milestones, and financial
insights.

### deal-report-agent

Generates the final investment-ready report for a development opportunity by
aggregating get-deal, get-deal-context, planning refreshes, yield, financial
snapshots, comparable sales, and ranking data into structured JSON plus a
human-readable summary, with strict deal ID validation, warning-driven partial
results, fallback-safe downstream handling, and direct database fallbacks when
optional reads or logging fail.

### create-task

Creates task records linked to deals and normalizes legacy hosted task rows into
the current response shape.

### update-deal-stage

Updates deal stage and deal status for an existing deal, validates lifecycle
transitions, supports automatic task-completion evaluation, and deduplicates
transition audit logging in `ai_actions`.

## Communication

### email-agent

Processes inbound emails, updates deal communications, and triggers downstream
agents.

### investor-actions

Executes the deterministic investor action layer for investor-deal pairs. It
currently supports `contact_investor`, which logs an `investor_communications`
entry, advances `investor_deal_pipeline` through
`new -> contacted -> interested -> negotiating`, returns current suggestions
based on `deal_investor_matches.match_score >= 50`, and avoids outbound
messaging integrations or autonomous action loops.

### investor-outreach

Generates a ready-to-send investor outreach draft for a single
`deal_id + investor_id` pair by loading deal summary, address, key financials,
risks, and investor preferences, then returning a deterministic `subject` and
templated `message` with a one-line hook, 3-bullet TL;DR, and call to action.
It does not send messages externally or trigger autonomous communication.

### notification-agent

Evaluates each `deal_feed` update against `user_preferences`, suppresses
low-priority or throttled notifications, writes per-user `notification_decision`
and `deal_alert` audit rows to `ai_actions`, and enforces max one notification
per deal per user within the configured throttle window. For `high_priority`
deals it also sends external email and webhook alerts, includes score, summary,
and deal reference links, retries webhook delivery on failure, and logs delivery
outcomes in `ai_actions`.

### system-health-check

Checks `agent_registry`, database connectivity, `ai_actions`, and `deal_feed`
activity for key components such as `rule-engine-agent`, `notification-agent`,
`site-intelligence-agent`, `site-discovery-agent`, and `get-deal-feed`, then
upserts the latest results into `system_health`.

### get-operator-summary

Returns a flat operator-facing platform summary covering active deals,
high-priority deals, recent notifications, pending retries, latest system health
status, and recent generated report counts using null-safe aggregate queries.

### get-usage-summary

Returns per-agent usage and estimated-cost aggregates for the last 24 hours and
last 7 days from `usage_metrics`.

### update-system-settings

Updates the global `system_settings` kill switch row so agents can be enabled or
disabled safely at runtime, and logs the change to `ai_actions`.

### approve-approval-queue

Reviews pending `approval_queue` items, marks them approved or rejected,
executes the queued downstream edge function when approved, and logs the
operator decision to `ai_actions`.

### cleanup

Runs bounded maintenance cleanup across `usage_metrics`,
`deal_feed_realtime_fallback`, and exhausted `agent_retry_queue` rows, then logs
the cleanup run to `ai_actions`.

### internal-ops-dashboard

Serves a lightweight internal operator web UI for the deal feed, approvals,
notifications, usage summary, system health, retry queue, funnel metrics, and
manual control triggers.

### get-top-deals

Returns the top-ranked deals using `priority_score` plus engagement metrics from
`deal_performance`, defaulting to composite-score ordering and a top-10 result
set.

### allocate-capital

Assigns capital across the highest-priority deals, prevents duplicate
allocations through `capital_allocations`, and logs each allocation run to
`ai_actions`.

### update-deal-outcome

Records deal outcomes in `deal_outcomes`, synchronizes aggregated outcome
metrics back into `deal_performance`, persists bounded scoring feedback into
`scoring_feedback`, and logs the update to `ai_actions`.

### get-deal-funnel

Returns deal lifecycle counts, stage-to-stage conversion rates, and average
time-in-stage metrics for `active`, `reviewing`, `approved`, `funded`, and
`completed` deals.

### generate-deal-report

Builds a weekly structured JSON summary of new deals, improved deals, and top
deals, then logs the generated report to `ai_actions`.

### generate-deal-pack

Builds a structured investor-facing JSON deal pack containing deal summary,
financials, risks, and comparable context, with render hints so the output can
later be converted to PDF, then logs generation in `ai_actions`.

### get-deal-reports

Returns indexed deal reports, deal packs, and weekly reports with optional
`deal_id`, `report_type`, and `created_at` filters, defaulting to most recent
first and falling back to legacy `ai_actions` report records when needed.

### subscribe-deal-feed

Returns the Realtime subscription contract for `deal_feed`, exposing the primary
`deal-feed` broadcast topic plus a postgres-changes fallback channel and the
caller's optional `user_preferences`.

### log-communication

Stores communication history.

### get-deal-timeline

Returns the unified activity feed for a deal.

### test-agent

Logs request payloads and returns a success response for testing.

## Planning Intelligence

### site-intelligence-agent

Runs the end-to-end site pipeline for a subject site, sequencing planning
agents, optional comparable sales, yield, financial modelling, and deal-specific
parcel ranking, dispatching `post-intelligence` and `post-ranking` events
through the shared event dispatcher, converting planning parse and dependency
failures into warning-driven fallback values, persisting aggregated
`site_intelligence.raw_data` when the hosted schema supports it, preserving
threshold-based fallback protection for post-ranking report decisions, and
exposing orchestration summaries at the top level of the response while
retaining legacy-schema-safe fallback when `raw_data` is still unavailable.

### zoning-agent

Retrieves zoning controls.

### flood-agent

Checks flood overlays.

### fsr-agent

Retrieves floor space ratio limits.

### height-agent

Retrieves building height controls.

### heritage-agent

Checks heritage restrictions.

## Discovery

### domain-discovery-agent

Scans external sources for opportunities.

### da-discovery-agent

Scans mock planning portal data for apartment and multi-dwelling development
applications and forwards structured candidates to site-discovery-agent.

### planning-da-discovery-agent

Collects development application discovery opportunities.

### site-discovery-agent

Submits candidate sites into the analysis pipeline and scoring workflow, then
dispatches the `post-discovery` event for downstream rule evaluation.

### parcel-ranking-agent

Ranks development opportunities using a weighted scoring model across zoning,
FSR, height, site size, yield, financial margin, and comparable sales strength,
supporting both `deal_id` scoring and existing batch candidate ranking with
strict mode-specific request validation, reliable persisted ranking upserts in
hosted environments, and event dispatch for `post-ranking`.

## Feasibility

### yield-agent

Estimates development yield.

### comparable-sales-agent

Finds nearby comparable developments and estimates sale price per sqm, using
standard internal function auth and resilient site-context lookup when legacy
environments contain duplicate `site_intelligence` rows.

### add-financial-snapshot

Stores financial assumptions and snapshots.

### financial-engine-agent

Performs detailed feasibility calculations using yield outputs, explicit
comparable-sales price-per-sqm assumptions, nearby comparable developments, and
planning constraints, then stores a structured financial snapshot for downstream
reporting with fallback-safe revenue assumptions, warning-driven partial
results, clearer client-facing validation errors, standardized event context,
and event dispatch for `post-financial`.

### event-dispatcher

A shared helper used by stage agents to build standardized event context, derive
a deterministic context hash from `score`, `zoning`, `yield`, and `financials`,
log stage-completion events, suppress only exact-context duplicate and
in-progress processing in `ai_actions`, invoke `rule-engine-agent`, and fall
back to legacy `deal_id` and event dedupe only when older un-hashed records are
the only history available.

### agent-runtime

A shared helper that performs pre-execution required-input validation, updates
`agent_registry`, and writes standardized `agent_execution` audit rows to
`ai_actions` with success state, execution time, and error context.

### action-layer-compat

A shared normalization helper that maps legacy hosted `tasks`, `risks`, and
`agent_action_rules` shapes into the current structures expected by the
orchestration layer and retries writes with legacy column mappings when
required.

## Knowledge

### add-knowledge-document

Stores vector-searchable supporting documents.

### search-knowledge

Searches stored knowledge chunks for retrieval-augmented reasoning.

### add-deal-knowledge-link

Attaches lightweight knowledge and document references to a deal through
`deal_knowledge_links`, then logs the attachment to `ai_actions`.

## Deal Context

### get-deal

Fetches core deal data and related records, now including linked
`deal_investors` rows with nested investor registry details, the direct
`deal_terms` record when one exists, an additive `investor_pipeline` array
sourced from `investor_deal_pipeline`, recent additive `investor_communications`
summaries for the deal, additive `capital_allocations` rows sourced from
`deal_capital_allocations`, a derived `capital_summary` object sourced from
`deal_capital_summary`, and an auto-refreshed `investor_matches` array sourced
from `deal_investor_matches`.

### get-deal-context

Retrieves contextual information across deal records, now including linked
investor relationships, investor base-record details, the direct `deal_terms`
record for the deal when present, an additive `investor_pipeline` array for
per-investor CRM state, recent additive `investor_communications` summaries,
additive `capital_allocations` rows for per-investor commitment tracking, a
derived `capital_summary` object sourced from `deal_capital_summary`, and an
auto-refreshed `investor_matches` array for deterministic investor-fit review.

### get-deal-feed

Returns recent `deal_feed` entries with optional minimum score, status, and
`user_id` preference filtering, joined to `deals` for flat address, suburb,
strategy, and stage fields, while using the persisted or computed weighted
`priority_score` plus the latest bounded `scoring_feedback` adjustments when
available.

## Rules

### get-agent-rules

Returns system rules and allowed actions for a given stage, normalizing both
current and legacy hosted `agent_action_rules` schemas.
