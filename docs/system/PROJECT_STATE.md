# Project State

Tracks current platform capabilities.

## Completed

Infrastructure

- Supabase setup
- Edge function architecture
- Database schema
- hosted schema alignment migration series applied for legacy drift in `deals`,
  `site_intelligence`, `financial_snapshots`, `site_candidates`, and
  comparable-sales tables
- additive hosted alignment now explicitly restores `site_intelligence.raw_data`
  and `site_intelligence.updated_at` without breaking legacy rows

Planning Intelligence

- zoning-agent
- flood-agent
- height-agent
- fsr-agent
- heritage-agent
- rule-engine-agent
- shared event dispatcher for `post-discovery`, `post-intelligence`,
  `post-ranking`, and `post-financial`
- site-intelligence-agent now orchestrates the full automated pipeline from
  planning analysis through deal-specific ranking, with duplicate-run
  protection, safer internal auth handling, optional comparable-sales refresh,
  event-driven rule orchestration, planning fallback normalization, and
  warning-driven bootstrap and persistence fallbacks

Feasibility

- yield-agent
- comparable-sales-agent
- financial-engine-agent
- yield-agent revenue estimates now consume latest comparable sales pricing when
  available, with fallback defaults preserved
- financial-engine-agent now recalculates revenue as price-per-sqm x GFA using
  comparable-sales-agent data when available, falls back safely when it is not,
  includes nearby comparable developments, and produces structured feasibility
  outputs for revenue, cost, profit, margin, and residual land value

Discovery

- email-agent
- da-discovery-agent
- site-discovery-agent

Deal Management

- deal-agent
- deal-intelligence
- deal-report-agent
- notification-agent
- get-deal
- get-deal-context
- get-deal-feed
- get-top-deals
- generate-deal-report
- generate-deal-pack
- subscribe-deal-feed
- deal-report-agent now builds structured investment summaries from deal,
  context, planning, yield, financial snapshot, comparable sales, and ranking
  data with fallback-safe human-readable output plus direct database fallbacks
  when optional reads or logging fail
- generate-deal-pack now builds structured investor deal-pack JSON with summary,
  financials, risks, comparable context, and PDF-ready render hints
- internal-ops-dashboard now serves a lightweight operator UI for feed review,
  approvals, notifications, usage, health, retry queues, funnel metrics, and
  manual control actions

Investor And Capital Layer

- investor tracking base now persists reusable investor records in `investors`
  and many-to-many deal relationships in `deal_investors`
- deal terms layer now persists one active lightweight terms record per deal in
  `deal_terms`, covering sponsor fee, preferred return, equity split, notes, and
  metadata without introducing waterfall logic
- get-deal and get-deal-context now return linked investor relationship-stage
  data so later communications, terms, and matching features can build on the
  same base layer
- get-deal and get-deal-context now also return `deal_terms` directly so the
  current deal terms can be answered from stored data without additional
  computation
- investor matching layer now stores explicit investor preferences on
  `investors`, computes deterministic rule-based fit scores through SQL,
  persists them in `deal_investor_matches`, and refreshes them automatically
  when `get-deal` or `get-deal-context` is called
- investor CRM foundation now tracks per-investor per-deal status, follow-up
  dates, notes, and metadata in `investor_deal_pipeline`, with additive backfill
  from existing `deal_investors` links
- investor communication foundation now stores structured investor-facing
  communication summaries in `investor_communications`, and `get-deal` /
  `get-deal-context` return recent deal-linked entries as additive context
  fields
- investor action layer now exposes `investor-actions`, allowing deterministic
  `contact_investor` execution that logs communications, advances
  `investor_deal_pipeline`, and surfaces additive suggested actions when
  `deal_investor_matches.match_score >= 50`
- investor outreach generation now exposes `investor-outreach`, returning a
  deterministic ready-to-send `subject` and templated `message` for each
  `deal_id + investor_id` pair using stored deal context, latest financials,
  risks, and optional investor preferences without sending externally
- capital allocation commitments now persist per-investor per-deal commitment
  tracking in `deal_capital_allocations`, with optional allocation percentages,
  lightweight status progression, and an idempotent
  `upsert_deal_capital_allocation` RPC
- get-deal and get-deal-context now return `capital_allocations` directly so the
  platform can answer who has committed what to a deal without inferring from
  pipeline or terms state
- capital visibility is now exposed through derived `deal_capital_summary`
  outputs returned by `get-deal` and `get-deal-context`, so UI layers can
  consume raise totals, remaining capital, investor counts, and pipeline counts
  without duplicating aggregation logic

Testing

- test-agent

## In Progress

- ranking improvements
- parcel-ranking-agent upgraded to weighted deal scoring using planning, yield,
  financial, and comparable-sales inputs while preserving batch ranking
  compatibility
- automated site discovery
- improved feasibility modelling
- request validation and pipeline fallback handling hardened across recently
  upgraded feasibility and orchestration agents
- rule-engine-agent now supports event-scoped orchestration rules with null-safe
  condition parsing for `score`, `zoning`, `zoning_density`, `flood_risk`,
  `yield`, and `financials`, priority-ordered action execution, duplicate-safe
  report suppression, and a default fallback rule path when persisted rules are
  unavailable
- rule-engine-agent now upserts `deal_feed` entries for high-quality
  `post-ranking` and `post-financial` matches, including strong score, margin,
  and low-risk signals, using existing event deduplication plus `deal_feed`
  uniqueness on `deal_id + trigger_event` to avoid duplicates
- notification-agent now logs initial `deal_alert` notification events to
  `ai_actions` for persisted `deal_feed` rows and suppresses duplicates by
  `deal_feed_id`
- get-deal-feed now returns a flat enriched feed joined to `deals`, with
  weighted `priority_score` ranking derived from feed score, feasibility margin,
  and risk penalties
- notification-agent now classifies notifications into `high_priority` or
  `standard`, persists `priority_score` and `notification_type` into
  `ai_actions`, and preserves `deal_feed_id`-based deduplication
- deal-feed realtime support now exposes a lightweight `subscribe-deal-feed`
  endpoint, emits minimal `deal_id + priority_score + change_type` broadcasts,
  and falls back to postgres changes when broadcast channels are unavailable
- user preferences are now modeled in `user_preferences`, allowing feed
  filtering and per-user notification matching with null-safe defaults when no
  preference row exists
- notification-agent now evaluates all users against `user_preferences`,
  suppresses low-priority alerts unless explicitly allowed, throttles
  notifications per deal per user per timeframe, and logs per-user decisions
  into `ai_actions`
- notification-agent now sends external high-priority email and webhook alerts,
  includes deal summary, score, and reference links, retries webhook delivery,
  and logs delivery outcomes in `ai_actions`
- all edge functions now pass through a shared runtime that validates required
  inputs, updates `agent_registry`, and writes standardized `agent_execution`
  audit rows with `execution_time_ms`, `success`, and `error_context`
- system health monitoring now persists database, agent, and recent-activity
  checks into `system_health` via `system-health-check`
- shared runtime now enforces the global `system_settings.system_enabled` kill
  switch, records per-call `usage_metrics`, and applies per-agent hourly limits
  from `agent_rate_limits`
- rule-engine-agent now retries failed notification and deal-feed side effects,
  downgrades notification priority on exhausted notification retries, and queues
  failed feed writes in `agent_retry_queue` with dedupe protection
- operator summary support now exposes `get-operator-summary` for flat
  platform-level counts covering active deals, high-priority deals,
  notifications, retries, system health, and recent reports
- operator tooling now includes `get-usage-summary`, `update-system-settings`,
  `approve-approval-queue`, and `cleanup` for cost visibility, kill-switch
  control, approval execution, and bounded maintenance
- policy-gated high-impact rule actions can now be routed into `approval_queue`
  with deduplicated approval requests instead of executing immediately
- deal knowledge references can now be attached through `deal_knowledge_links`
  via `add-deal-knowledge-link`
- generated deal reports, packs, and weekly summaries are now indexed in
  `report_index` and retrievable through `get-deal-reports`
- deal performance metrics are now tracked in `deal_performance`, with
  `get-deal-feed`, `notification-agent`, and `create-task` incrementing views,
  notifications, and action counts
- capital allocation support now persists `capital_allocations`, exposes
  `allocate-capital`, assigns capital across top-priority deals, and logs each
  allocation run to `ai_actions`
- investor matching is now enabled as a simple rule-based layer, while outbound
  automation, autonomous communication workflows, and allocation expansion
  remain explicitly deferred
- deal outcome tracking now persists `deal_outcomes`, updates aggregate outcome
  metrics on `deal_performance`, and logs final outcome updates through
  `update-deal-outcome`
- adaptive scoring feedback now stores bounded predicted-vs-actual weight
  adjustments in `scoring_feedback` and applies the latest feedback weights
  inside `get-deal-feed` priority scoring
- deal funnel analytics now exposes `get-deal-funnel` for lifecycle counts,
  conversion rates, and average stage durations across `active`, `reviewing`,
  `approved`, `funded`, and `completed`
- rule-engine-agent now auto-creates duplicate-safe `Prepare lender pack` and
  `Re-evaluate feasibility` tasks when high-priority low-risk or
  significant-improvement conditions are met
- get-top-deals now ranks deals by composite score using persisted
  `priority_score` plus `deal_performance` engagement
- generate-deal-report now produces weekly structured JSON summaries for new,
  improved, and top deals and logs each report to `ai_actions`
- deal-feed lifecycle cleanup now promotes rows from `active` to `stale` to
  `archived`, trims fallback realtime buffers, and adds query indexes for feed
  performance
- event-driven orchestration now dispatches standardized event context from
  discovery, intelligence, ranking, and financial completion points, with
  duplicate suppression, in-progress recursion protection, and cached invocation
  reuse through `ai_actions`
- action-layer compatibility normalization now maps legacy hosted `tasks`,
  `risks`, and `agent_action_rules` schemas into the current orchestration
  contracts, allowing hosted rule execution to continue without destructive
  schema changes
- event dispatcher deduplication is now context-aware, using a deterministic
  hash of `score`, `zoning`, `yield`, and `financials` so changed deal state
  re-runs orchestration while identical context is still suppressed, with legacy
  fallback retained for older un-hashed audit rows
- QA hardening completed for deal-report-agent, parcel-ranking-agent, and
  financial-engine-agent so malformed or empty deal identifiers now return
  consistent client errors instead of leaking downstream database failures
- internal service-to-service auth handling hardened for deal-report-agent and
  financial-engine-agent so downstream function failures return structured
  dependency errors instead of raw 500 responses
- site-intelligence-agent now avoids redundant batch ranking, validates UUID
  deal IDs, dispatches post-intelligence and post-ranking events, converts
  planning parse failures into structured fallback values, exposes orchestration
  summaries at the top level, and still falls back to the legacy threshold
  trigger when post-ranking rule evaluation fails
- site-intelligence-agent now persists aggregated `site_intelligence.raw_data`
  when hosted schema alignment is present and degrades to warning-only legacy
  compatibility when the column is still unavailable
- seeded orchestration rules now cover high-density post-intelligence follow-up,
  high-flood-risk logging, strong post-financial margin reporting, and
  thin-margin risk escalation
- hosted production flow now runs cleanly in no-comparables mode after schema
  drift repair, with persisted deal, ranking, and report outputs aligned around
  the same score
- deal status workflow now supports
  `active -> reviewing -> approved -> funded -> completed`, auto-moves
  high-priority deals to `reviewing`, auto-moves deals with fully completed task
  sets to `approved`, and deduplicates transition logs in `ai_actions`

## Planned

Parcel Scanner\
Deal Ranking AI\
Automated Feasibility Reports\
Investor Deal Feed Workflow

Estimated completion: **65–70%**
