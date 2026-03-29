# DATABASE SCHEMA REGISTRY

This document is the source of truth for agent-facing database schema in this repository.

All new tables MUST be registered here after creation or modification.

---

## NAMING CONVENTIONS

- snake_case only
- plural table names
- jsonb for flexible AI-generated payloads
- `id`, `created_at`, and `updated_at` are standard on mutable tables unless noted otherwise

---

## deals

Primary table for development opportunities.

Fields:
- id (uuid, pk, default gen_random_uuid())
- address (text, required)
- suburb (text)
- state (text)
- postcode (text)
- status (text, default `new`; deal workflow lifecycle now supports `active -> reviewing -> approved -> funded -> completed`, with workflow triggers able to promote high-priority deals and fully completed task sets)
- stage (text, default `opportunity`)
- source (text)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## deal_feed

Source of truth for surfaced opportunities and feed entries emitted for a deal. One row per `deal_id + trigger_event`.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- score (numeric)
- priority_score (numeric)
- status (text, default `active`; lifecycle `active -> stale -> archived`)
- trigger_event (text)
- summary (text)
- metadata (jsonb)
- stale_at (timestamptz)
- archived_at (timestamptz)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id, trigger_event)

Indexes:
- deal_id
- created_at
- priority_score + updated_at
- status + priority_score + updated_at

---

## deal_feed_realtime_fallback

Fallback realtime event buffer used when broadcast channels are unavailable. Intended to emit minimal deal-feed change payloads.

Fields:
- deal_id (uuid, fk-ish reference to deals.id)
- priority_score (numeric)
- change_type (text)
- created_at (timestamptz)

---

## deal_performance

Engagement counters for surfaced deals. This table intentionally uses singular naming because the implementation requirement specified `deal_performance`.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, unique fk -> deals.id)
- views (integer, default `0`)
- notifications_sent (integer, default `0`)
- actions_taken (integer, default `0`)
- outcomes_recorded (integer, default `0`)
- last_outcome_type (text)
- last_actual_return (numeric)
- average_actual_return (numeric)
- average_duration_days (numeric)
- last_outcome_recorded_at (timestamptz)
- last_viewed_at (timestamptz)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- deal_id

---

## capital_allocations

Capital allocation records for surfaced deals. One row per allocated deal.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- allocated_amount (numeric, required, check `>= 0`)
- allocation_status (text, default `proposed`; allowed values `proposed`, `committed`, `deployed`)
- expected_return (numeric)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id)

Indexes:
- allocation_status + updated_at
- deal_id + created_at

---

## investors

Investor registry used for the investor and capital layer base. Stores reusable investor records that can later be linked to deal-specific terms, communications, and matching workflows.

Fields:
- id (uuid, pk, default gen_random_uuid())
- investor_name (text, required)
- investor_type (text, default `individual`; allowed values `individual`, `private_investor`, `family_office`, `syndicate`, `fund`, `developer`, `lender`, `broker`, `other`)
- capital_min (numeric, check `>= 0` when present)
- capital_max (numeric, check `>= 0` when present and `>= capital_min` when both are present)
- preferred_strategies (text[], default `{}`)
- risk_profile (text, default `balanced`; allowed values `low`, `balanced`, `high`, `opportunistic`)
- preferred_states (text[], default `{}`)
- preferred_suburbs (text[], default `{}`)
- min_target_margin_pct (numeric, nullable, check `>= 0` and `<= 100`)
- status (text, default `active`; allowed values `active`, `inactive`, `archived`)
- notes (text)
- metadata (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- status + updated_at
- investor_type + status

---

## deal_investors

Join table linking multiple investors to a single deal, with lightweight relationship-stage tracking for the current deal context.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- investor_id (uuid, fk -> investors.id)
- relationship_stage (text, default `new`; allowed values `new`, `contacted`, `qualified`, `interested`, `soft_committed`, `committed`, `passed`)
- notes (text)
- metadata (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id, investor_id)

Indexes:
- deal_id + created_at
- investor_id + created_at

---

## deal_terms

Lightweight investor-facing terms for a deal. Stores a direct, low-computation summary of the current commercial terms without introducing waterfall or allocation logic. One row per deal for the current active terms set.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, unique fk -> deals.id)
- sponsor_fee_pct (numeric, nullable, check `>= 0` and `<= 100`)
- equity_split (jsonb, default `{}`)
- preferred_return_pct (numeric, nullable, check `>= 0` and `<= 100`)
- notes (text)
- metadata (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- updated_at

---

## deal_investor_matches

Deterministic deal-to-investor fit records generated from stored investor preferences and current deal attributes. One row per `deal_id + investor_id`, updated idempotently by the matching refresh RPC.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- investor_id (uuid, fk -> investors.id)
- match_score (integer, check `>= 0` and `<= 100`)
- match_band (text; allowed values `strong`, `medium`, `weak`, `none`)
- strategy_score (integer, component score out of `35`)
- budget_score (integer, component score out of `25`)
- risk_score (integer, component score out of `20`)
- location_score (integer, component score out of `20`)
- match_reasons (jsonb, default `{}`)
- deal_snapshot (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id, investor_id)

Indexes:
- deal_id + match_score + updated_at
- investor_id + match_score + updated_at

---

## investor_deal_pipeline

Lightweight CRM pipeline table storing the current investor-specific status for a deal plus follow-up context. One row per `deal_id + investor_id`.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- investor_id (uuid, fk -> investors.id)
- pipeline_status (text, default `new`; allowed values `new`, `contacted`, `interested`, `negotiating`, `committed`, `passed`, `archived`)
- last_contacted_at (timestamptz)
- next_follow_up_at (timestamptz)
- notes (text)
- metadata (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id, investor_id)

Indexes:
- deal_id + pipeline_status + next_follow_up_at
- investor_id + pipeline_status + updated_at

---

## investor_communications

Investor-focused communication log used to store structured summaries for inbound, outbound, and internal investor interactions. Records always link to `investor_id` and may optionally link to a `deal_id`.

Fields:
- id (uuid, pk, default gen_random_uuid())
- investor_id (uuid, fk -> investors.id)
- deal_id (uuid, nullable fk -> deals.id)
- communication_type (text, default `note`; allowed values `note`, `email`, `call`, `meeting`, `sms`, `document`, `other`)
- direction (text, default `internal`; allowed values `inbound`, `outbound`, `internal`)
- subject (text)
- summary (text, required)
- status (text, default `logged`; allowed values `draft`, `logged`, `sent`, `received`, `failed`, `archived`)
- metadata (jsonb, default `{}`)
- communicated_at (timestamptz, default `now()`)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- investor_id + communicated_at
- deal_id + communicated_at

---

## deal_capital_allocations

Investor-level capital commitment tracking for a deal. One row per `deal_id + investor_id`, kept intentionally lightweight so commitments can be tracked without introducing payment flows, waterfalls, or distribution logic.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- investor_id (uuid, fk -> investors.id)
- committed_amount (numeric, default `0`, check `>= 0`)
- allocation_pct (numeric, nullable, check `>= 0` and `<= 100`)
- status (text, default `proposed`; allowed values `proposed`, `soft_commit`, `hard_commit`, `funded`)
- notes (text)
- metadata (jsonb, default `{}`)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (deal_id, investor_id)

Indexes:
- deal_id + status + updated_at
- investor_id + status + updated_at
- deal_id + created_at

---

## deal_outcomes

Outcome tracking records for deals. Multiple outcome snapshots may be recorded over time for the same deal.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- outcome_type (text, required; allowed values `won`, `lost`, `in_progress`)
- actual_return (numeric)
- duration_days (integer, check `>= 0` when present)
- notes (text)
- created_at (timestamptz)

Indexes:
- outcome_type + created_at
- deal_id + created_at

---

## scoring_feedback

Adaptive scoring audit log that stores bounded weighting adjustments derived from predicted vs actual outcomes.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- outcome_type (text, required; allowed values `won`, `lost`, `in_progress`)
- predicted_priority_score (numeric)
- predicted_return (numeric)
- actual_return (numeric)
- adjustment_factor (numeric, default `0`)
- previous_weights (jsonb)
- adjusted_weights (jsonb)
- notes (text)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- created_at
- deal_id + created_at

---

## user_preferences

Per-user deal-feed and notification preferences.

Fields:
- id (uuid, pk, default gen_random_uuid())
- user_id (uuid, fk -> auth.users.id)
- min_score (numeric)
- preferred_strategy (text)
- notification_level (text, default `high_priority_only`)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (user_id)

---

## site_intelligence

Aggregated planning and feasibility context for a deal. One row per deal.

Notes:
- hosted alignment keeps legacy rows valid while ensuring `raw_data` and `updated_at` exist
- `knowledge_context` is not part of `site_intelligence`; comparable-sales tables own that field

Fields:
- id (uuid, pk)
- deal_id (uuid, unique fk -> deals.id)
- address (text)
- latitude (numeric)
- longitude (numeric)
- zoning (text)
- lep (text)
- height_limit (text)
- fsr (text)
- heritage_status (text)
- site_area (numeric)
- flood_risk (text)
- source_layer (text)
- source_attributes (jsonb)
- estimated_gfa (numeric)
- estimated_units (integer)
- estimated_revenue (numeric)
- estimated_build_cost (numeric)
- estimated_profit (numeric)
- raw_data (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## email_threads

Conversation threads linked to a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- subject (text)
- participants (text)
- last_message_at (timestamptz)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## communications

Inbound and outbound communication records linked to a deal and optionally an email thread.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- thread_id (uuid, fk -> email_threads.id)
- sender (text)
- recipients (text)
- subject (text)
- message_summary (text)
- body (text)
- direction (text)
- sent_at (timestamptz)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## tasks

Action items created by agents or operators for a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- title (text, required)
- description (text)
- assigned_to (text)
- due_date (date)
- status (text, default `open`)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## financial_snapshots

Feasibility and financial records captured against a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- category (text)
- amount (numeric)
- gdv (numeric)
- tdc (numeric)
- notes (text)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## risks

Structured risk log entries for a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- title (text, required)
- description (text)
- severity (text, default `medium`)
- status (text, default `open`)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## milestones

Key milestone dates and statuses for a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- title (text, required)
- due_date (date)
- status (text, default `pending`)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## ai_actions

Audit log of AI-driven actions across the platform.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id, nullable)
- agent (text, required)
- action (text, required)
- payload (jsonb)
- source (text)
- execution_time_ms (integer)
- success (boolean)
- error_context (jsonb)
- created_at (timestamptz)

---

## agent_registry

Registry of edge-function execution state for all agents. One row per `agent_name`.

Fields:
- id (uuid, pk, default gen_random_uuid())
- agent_name (text, required, unique)
- version (text, required)
- status (text, required)
- last_run (timestamptz)
- last_error (text)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## system_health

System-wide health status snapshot for core components.

Fields:
- id (uuid, pk, default gen_random_uuid())
- component (text, required, unique)
- status (text, required)
- last_checked (timestamptz)
- error_message (text)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## usage_metrics

Execution metering records used for agent usage and estimated-cost reporting.

Fields:
- id (uuid, pk, default gen_random_uuid())
- agent_name (text, required)
- calls (integer, default `1`)
- estimated_cost (numeric, default `0`)
- timestamp (timestamptz, default `now()`)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- agent_name + timestamp
- timestamp

---

## system_settings

Global operator safety settings, including the system kill switch.

Fields:
- id (uuid, pk, default gen_random_uuid())
- setting_key (text, unique, default `global`)
- system_enabled (boolean, default `true`)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## agent_rate_limits

Per-agent execution safety limits used by the shared runtime.

Fields:
- id (uuid, pk, default gen_random_uuid())
- agent_name (text, unique, required)
- max_calls_per_hour (integer, default `120`)
- enabled (boolean, default `true`)
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

Indexes:
- enabled + max_calls_per_hour

---

## agent_retry_queue

Queued retry work for failed agent side effects that should be retried without creating infinite loops.

Fields:
- id (uuid, pk, default gen_random_uuid())
- agent_name (text, required)
- operation (text, required)
- dedupe_key (text, required, unique)
- payload (jsonb)
- status (text, default `queued`)
- retry_count (integer, default `0`)
- max_retries (integer, default `3`)
- last_error (text)
- next_retry_at (timestamptz)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## approval_queue

Approval workflow buffer for policy-gated high-impact actions. One row per deduplicated approval request.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id, nullable)
- approval_type (text, required)
- status (text, default `pending`)
- requested_by_agent (text, required)
- payload (jsonb)
- dedupe_key (text, required, unique)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## deal_knowledge_links

Lightweight references linking a deal to attached knowledge or external document context.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id)
- document_type (text, required)
- source_ref (text, required)
- summary (text)
- metadata (jsonb)
- created_at (timestamptz)

---

## report_index

Stable index of generated deal reports, deal packs, and weekly reports for retrieval endpoints.

Fields:
- id (uuid, pk, default gen_random_uuid())
- deal_id (uuid, fk -> deals.id, nullable)
- report_type (text, required)
- source_agent (text, required)
- source_action (text, required)
- payload (jsonb)
- created_at (timestamptz)

---

## agent_action_rules

Stage-based action policy for agents.

Fields:
- id (uuid, pk)
- agent_name (text, required)
- stage (text, required)
- rule_description (text, required)
- action_schema (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (agent_name, stage)

---

## site_candidates

Scored discovery candidates produced by external source ingestion.

Fields:
- id (uuid, pk)
- source (text, required)
- external_id (text, required)
- address (text, required)
- suburb (text)
- state (text)
- postcode (text)
- latitude (numeric)
- longitude (numeric)
- price_text (text)
- property_type (text)
- land_area (numeric)
- url (text)
- headline (text)
- raw_data (jsonb)
- zoning (text)
- height_limit (text)
- fsr (text)
- flood_risk (text)
- heritage_status (text)
- estimated_units (integer)
- estimated_profit (numeric)
- ranking_score (integer)
- ranking_tier (text)
- ranking_reasons (jsonb)
- ranking_run_at (timestamptz)
- discovery_score (integer)
- discovery_reasons (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

Unique:
- (source, external_id)

---

## knowledge_chunks

Vector-searchable knowledge snippets used by RAG-style agents.

Fields:
- id (uuid, pk)
- source_name (text, required)
- category (text)
- content (text, required)
- embedding (vector(1536))
- metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## comparable_sales_estimates

Stored comparable-sales pricing estimates for a deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk -> deals.id)
- subject_address (text)
- suburb (text)
- state (text)
- postcode (text)
- radius_km (numeric)
- dwelling_type (text)
- estimated_sale_price_per_sqm (numeric)
- currency (text)
- rationale (text)
- model_name (text)
- knowledge_context (jsonb)
- raw_output (jsonb)
- status (text)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## comparable_sales_evidence

Comparable project records supporting a comparable-sales estimate.

Fields:
- id (uuid, pk)
- estimate_id (uuid, fk -> comparable_sales_estimates.id)
- project_name (text)
- location (text)
- dwelling_type (text)
- estimated_sale_price_per_sqm (numeric)
- similarity_reason (text)
- source_metadata (jsonb)
- created_at (timestamptz)
- updated_at (timestamptz)

---

## deal_activity_feed

Database view combining tasks, communications, risks, milestones, financial snapshots, and AI actions into a single timeline per deal.

Columns:
- id (uuid)
- deal_id (uuid)
- activity_type (text)
- headline (text)
- detail (text)
- status (text)
- created_at (timestamptz)

---

## deal_capital_summary

Database view exposing UI-ready capital visibility metrics per deal without introducing new workflow tables.

Columns:
- deal_id (uuid)
- capital_target (numeric, nullable; derived from `deal_terms.metadata`, `deals.metadata`, then latest financial snapshot fallback)
- total_committed (numeric; sum of `deal_capital_allocations.committed_amount` where status is `hard_commit` or `funded`)
- total_soft_commit (numeric; sum where status is `soft_commit`)
- remaining_capital (numeric, nullable; `capital_target - total_committed`, floor at `0`)
- investor_count (integer; distinct investor count across linked deal-investor, pipeline, and capital-allocation rows)
- committed_investor_count (integer; count of investor allocations with `hard_commit` or `funded`)
- soft_commit_investor_count (integer; count of investor allocations with `soft_commit`)
- pipeline_new_count (integer)
- pipeline_contacted_count (integer)
- pipeline_interested_count (integer)
- pipeline_negotiating_count (integer)
- pipeline_committed_count (integer)
- pipeline_passed_count (integer)
- pipeline_archived_count (integer)
- pipeline_summary (jsonb; flat status-to-count object for UI consumption)

---

## RPC FUNCTIONS

### match_knowledge_chunks(query_embedding vector(1536), match_count integer)

Returns the nearest knowledge chunks by vector similarity.

### match_knowledge_chunks_by_category(query_embedding vector(1536), match_count integer, filter_category text)

Returns the nearest knowledge chunks filtered by category.

### upsert_deal_investor(p_deal_id uuid, p_investor_id uuid, p_relationship_stage text, p_notes text, p_metadata jsonb)

Creates or updates a `deal_investors` link for a given deal and investor, keeping relationship-stage tracking idempotent for future investor workflow endpoints.

### upsert_deal_terms(p_deal_id uuid, p_sponsor_fee_pct numeric, p_equity_split jsonb, p_preferred_return_pct numeric, p_notes text, p_metadata jsonb)

Creates or updates the single active `deal_terms` row for a given deal, keeping terms storage lightweight and directly queryable for later investor and AI workflows.

### investor_match_score(p_deal_id uuid, p_investor_id uuid)

Returns a deterministic rule-based score breakdown for a single deal and investor using strategy, budget fit, target margin / risk fit, and location preferences.

### refresh_deal_investor_matches(p_deal_id uuid, p_investor_id uuid default null)

Upserts `deal_investor_matches` rows for the target deal across all active investors, or for a single investor when `p_investor_id` is supplied.

### upsert_investor_deal_pipeline(p_deal_id uuid, p_investor_id uuid, p_pipeline_status text default 'new', p_last_contacted_at timestamptz default null, p_next_follow_up_at timestamptz default null, p_notes text default null, p_metadata jsonb default '{}'::jsonb)

Creates or updates the single CRM pipeline row for a given deal and investor, keeping lightweight investor follow-up tracking idempotent.

### upsert_deal_capital_allocation(p_deal_id uuid, p_investor_id uuid, p_committed_amount numeric default 0, p_allocation_pct numeric default null, p_status text default 'proposed', p_notes text default null, p_metadata jsonb default '{}'::jsonb)

Creates or updates the single investor commitment row for a given deal and investor, keeping capital commitment tracking deterministic and additive to `deal_terms` and `investor_deal_pipeline`.
