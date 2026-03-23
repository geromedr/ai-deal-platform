# Project State

Tracks current platform capabilities.

## Completed

Infrastructure
- Supabase setup
- Edge function architecture
- Database schema
- hosted schema alignment migration series applied for legacy drift in `deals`, `site_intelligence`, `financial_snapshots`, `site_candidates`, and comparable-sales tables

Planning Intelligence
- zoning-agent
- flood-agent
- height-agent
- fsr-agent
- heritage-agent
- site-intelligence-agent now orchestrates the full automated pipeline from planning analysis through deal-specific ranking, with duplicate-run protection, safer internal auth handling, optional comparable-sales refresh, score-threshold gating before final report generation, and warning-driven bootstrap/persistence fallbacks

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
- deal-report-agent now builds structured investment summaries from deal, context, planning, yield, financial snapshot, comparable sales, and ranking data with fallback-safe human-readable output plus direct database fallbacks when optional reads or logging fail

Testing
- test-agent

## In Progress

- ranking improvements
- parcel-ranking-agent upgraded to weighted deal scoring using planning, yield, financial, and comparable-sales inputs while preserving batch ranking compatibility
- automated site discovery
- improved feasibility modelling
- request validation and pipeline fallback handling hardened across recently upgraded feasibility and orchestration agents
- QA hardening completed for deal-report-agent, parcel-ranking-agent, and financial-engine-agent so malformed or empty deal identifiers now return consistent client errors instead of leaking downstream database failures
- internal service-to-service auth handling hardened for deal-report-agent and financial-engine-agent so downstream function failures return structured dependency errors instead of raw 500 responses
- site-intelligence-agent now avoids redundant batch ranking, validates UUID deal IDs, and only triggers deal-report-agent when the parcel score meets the configured report threshold
- hosted production flow now runs cleanly in no-comparables mode after schema drift repair, with persisted deal, ranking, and report outputs aligned around the same score

## Planned

Parcel Scanner  
Deal Ranking AI  
Automated Feasibility Reports  
Investor Deal Feed

Estimated completion: **65–70%**
