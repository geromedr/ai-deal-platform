# Project State

Tracks current platform capabilities.

## Completed

Infrastructure
- Supabase setup
- Edge function architecture
- Database schema
- hosted schema alignment migration series applied for legacy drift in `deals`, `site_intelligence`, `financial_snapshots`, `site_candidates`, and comparable-sales tables
- additive hosted alignment now explicitly restores `site_intelligence.raw_data` and `site_intelligence.updated_at` without breaking legacy rows

Planning Intelligence
- zoning-agent
- flood-agent
- height-agent
- fsr-agent
- heritage-agent
- rule-engine-agent
- shared event dispatcher for `post-discovery`, `post-intelligence`, `post-ranking`, and `post-financial`
- site-intelligence-agent now orchestrates the full automated pipeline from planning analysis through deal-specific ranking, with duplicate-run protection, safer internal auth handling, optional comparable-sales refresh, event-driven rule orchestration, planning fallback normalization, and warning-driven bootstrap and persistence fallbacks

Feasibility
- yield-agent
- comparable-sales-agent
- financial-engine-agent
- yield-agent revenue estimates now consume latest comparable sales pricing when available, with fallback defaults preserved
- financial-engine-agent now recalculates revenue as price-per-sqm x GFA using comparable-sales-agent data when available, falls back safely when it is not, includes nearby comparable developments, and produces structured feasibility outputs for revenue, cost, profit, margin, and residual land value

Discovery
- email-agent
- da-discovery-agent
- site-discovery-agent

Deal Management
- deal-agent
- deal-intelligence
- deal-report-agent
- notification-agent
- get-deal-feed
- get-top-deals
- generate-deal-report
- subscribe-deal-feed
- deal-report-agent now builds structured investment summaries from deal, context, planning, yield, financial snapshot, comparable sales, and ranking data with fallback-safe human-readable output plus direct database fallbacks when optional reads or logging fail

Testing
- test-agent

## In Progress

- ranking improvements
- parcel-ranking-agent upgraded to weighted deal scoring using planning, yield, financial, and comparable-sales inputs while preserving batch ranking compatibility
- automated site discovery
- improved feasibility modelling
- request validation and pipeline fallback handling hardened across recently upgraded feasibility and orchestration agents
- rule-engine-agent now supports event-scoped orchestration rules with null-safe condition parsing for `score`, `zoning`, `zoning_density`, `flood_risk`, `yield`, and `financials`, priority-ordered action execution, duplicate-safe report suppression, and a default fallback rule path when persisted rules are unavailable
- rule-engine-agent now upserts `deal_feed` entries for high-quality `post-ranking` and `post-financial` matches, including strong score, margin, and low-risk signals, using existing event deduplication plus `deal_feed` uniqueness on `deal_id + trigger_event` to avoid duplicates
- notification-agent now logs initial `deal_alert` notification events to `ai_actions` for persisted `deal_feed` rows and suppresses duplicates by `deal_feed_id`
- get-deal-feed now returns a flat enriched feed joined to `deals`, with weighted `priority_score` ranking derived from feed score, feasibility margin, and risk penalties
- notification-agent now classifies notifications into `high_priority` or `standard`, persists `priority_score` and `notification_type` into `ai_actions`, and preserves `deal_feed_id`-based deduplication
- deal-feed realtime support now exposes a lightweight `subscribe-deal-feed` endpoint, emits minimal `deal_id + priority_score + change_type` broadcasts, and falls back to postgres changes when broadcast channels are unavailable
- user preferences are now modeled in `user_preferences`, allowing feed filtering and per-user notification matching with null-safe defaults when no preference row exists
- notification-agent now evaluates all users against `user_preferences`, suppresses low-priority alerts unless explicitly allowed, throttles notifications per deal per user per timeframe, and logs per-user decisions into `ai_actions`
- deal performance metrics are now tracked in `deal_performance`, with `get-deal-feed`, `notification-agent`, and `create-task` incrementing views, notifications, and action counts
- rule-engine-agent now auto-creates duplicate-safe `Prepare lender pack` and `Re-evaluate feasibility` tasks when high-priority low-risk or significant-improvement conditions are met
- get-top-deals now ranks deals by composite score using persisted `priority_score` plus `deal_performance` engagement
- generate-deal-report now produces weekly structured JSON summaries for new, improved, and top deals and logs each report to `ai_actions`
- deal-feed lifecycle cleanup now promotes rows from `active` to `stale` to `archived`, trims fallback realtime buffers, and adds query indexes for feed performance
- event-driven orchestration now dispatches standardized event context from discovery, intelligence, ranking, and financial completion points, with duplicate suppression, in-progress recursion protection, and cached invocation reuse through `ai_actions`
- action-layer compatibility normalization now maps legacy hosted `tasks`, `risks`, and `agent_action_rules` schemas into the current orchestration contracts, allowing hosted rule execution to continue without destructive schema changes
- event dispatcher deduplication is now context-aware, using a deterministic hash of `score`, `zoning`, `yield`, and `financials` so changed deal state re-runs orchestration while identical context is still suppressed, with legacy fallback retained for older un-hashed audit rows
- QA hardening completed for deal-report-agent, parcel-ranking-agent, and financial-engine-agent so malformed or empty deal identifiers now return consistent client errors instead of leaking downstream database failures
- internal service-to-service auth handling hardened for deal-report-agent and financial-engine-agent so downstream function failures return structured dependency errors instead of raw 500 responses
- site-intelligence-agent now avoids redundant batch ranking, validates UUID deal IDs, dispatches post-intelligence and post-ranking events, converts planning parse failures into structured fallback values, exposes orchestration summaries at the top level, and still falls back to the legacy threshold trigger when post-ranking rule evaluation fails
- site-intelligence-agent now persists aggregated `site_intelligence.raw_data` when hosted schema alignment is present and degrades to warning-only legacy compatibility when the column is still unavailable
- seeded orchestration rules now cover high-density post-intelligence follow-up, high-flood-risk logging, strong post-financial margin reporting, and thin-margin risk escalation
- hosted production flow now runs cleanly in no-comparables mode after schema drift repair, with persisted deal, ranking, and report outputs aligned around the same score

## Planned

Parcel Scanner  
Deal Ranking AI  
Automated Feasibility Reports  
Investor Deal Feed

Estimated completion: **65–70%**
