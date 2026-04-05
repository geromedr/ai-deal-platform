# SCHEMA DETAILS

Load this document only when table, view, or RPC detail is required.

## CANONICAL DETAIL AREAS

Detailed schema currently lives in legacy `docs/database/SCHEMA.md`. The most important groups are:

Core deal records:
- `deals`
- `site_candidates`
- `site_intelligence`
- `financial_snapshots`
- `risks`
- `tasks`
- `communications`
- `milestones`

Feed, outcomes, and scoring:
- `deal_feed`
- `deal_feed_realtime_fallback`
- `deal_performance`
- `deal_outcomes`
- `scoring_feedback`
- `user_preferences`

Investor and capital:
- `investors`
- `deal_investors`
- `deal_terms`
- `deal_investor_matches`
- `investor_deal_pipeline`
- `investor_communications`
- `deal_capital_allocations`
- `capital_allocations`
- `deal_capital_summary`

Rule and safety:
- `ai_actions`
- `agent_registry`
- `system_health`
- `usage_metrics`
- `system_settings`
- `agent_rate_limits`
- `agent_retry_queue`
- `approval_queue`
- `agent_action_rules`

Knowledge and reporting:
- `knowledge_chunks`
- `deal_knowledge_links`
- `report_index`
- `comparable_sales_estimates`
- `comparable_sales_evidence`
- `deal_activity_feed`

## SCHEMA RULES

- Prefer extending existing tables before creating new ones.
- Preserve naming consistency and current contracts.
- Treat documented schema as the registry to keep in sync with migrations.
- Preserve compatibility for legacy hosted drift when safe fallbacks already exist.

## RPC AREAS

Current detail includes matching, upsert, and capital/investor helper RPCs. Load the legacy schema registry when RPC signatures matter.
