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
- status (text, default `new`)
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

## RPC FUNCTIONS

### match_knowledge_chunks(query_embedding vector(1536), match_count integer)

Returns the nearest knowledge chunks by vector similarity.

### match_knowledge_chunks_by_category(query_embedding vector(1536), match_count integer, filter_category text)

Returns the nearest knowledge chunks filtered by category.
