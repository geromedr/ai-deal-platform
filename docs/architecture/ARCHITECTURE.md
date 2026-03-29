# System Architecture

The AI Deal Platform uses a modular Supabase Edge Function architecture with stage-specific agents and an event-driven orchestration layer.

## Core Pipeline

Data Sources
↓
Discovery Agents
↓
Site Intelligence Orchestrator
↓
Planning Analysis Agents
↓
Feasibility Agents
↓
Ranking Engine
↓
Event Dispatcher
↓
Rule Engine
↓
Triggered Actions

## Major Layers

### Discovery Layer
Brings candidate sites into the system.

Sources:
- inbound emails
- planning portals
- real estate listings
- manual input

### Intelligence Layer
Collects planning constraints:

- zoning
- flood overlays
- height limits
- FSR
- heritage restrictions

### Feasibility Layer
Estimates development potential:

- GFA
- unit count
- revenue
- build cost
- profit
- sale price per sqm from comparable developments

### Ranking Layer
Evaluates opportunities based on:

- planning flexibility
- yield potential
- site size
- feasibility
- adaptive feedback from predicted vs actual outcomes stored in `scoring_feedback`

### Capital Allocation Layer
Assigns capital to the highest-priority deals using `priority_score`, persists allocations in `capital_allocations`, and logs allocation decisions for auditability.

### Investor And Capital Layer
Maintains the investor registry in `investors`, links multiple investors to a deal through `deal_investors`, stores one lightweight active terms record per deal in `deal_terms`, and now computes deterministic fit scores into `deal_investor_matches` using investor preferences plus current deal strategy, location, target margin, and deal-size signals. The layer remains rule-based and lightweight, leaving notifications, allocation expansion, and CRM workflows out of scope.
It now also includes a simple CRM foundation through `investor_deal_pipeline` and `investor_communications`, so each investor-deal pair can carry pipeline state, follow-up timing, and recent structured communication summaries without introducing outbound automation or autonomous messaging.
It now also includes lightweight investor commitment tracking through `deal_capital_allocations`, allowing each investor-deal pair to store committed capital, optional allocation percentage, and commitment status without coupling that data to payment or distribution logic.
It now also includes a thin capital visibility layer through the derived `deal_capital_summary` view, which computes raise totals, remaining capital, investor counts, and pipeline-status counts for direct UI and context consumption without adding new capital workflows.

### Analytics Layer
Tracks final deal outcomes, scoring feedback, and lifecycle funnel performance through `deal_outcomes`, `deal_performance`, `scoring_feedback`, and `get-deal-funnel`.

### Cost And Safety Layer
Tracks runtime activity in `usage_metrics`, applies operator kill-switch settings from `system_settings`, enforces per-agent hourly controls from `agent_rate_limits`, and exposes operator controls through `get-usage-summary`, `update-system-settings`, `cleanup`, and the internal dashboard.

### Event-Driven Decision Layer
Uses stage-completion events to drive downstream orchestration rules.

- `site-discovery-agent` dispatches `post-discovery`
- `site-intelligence-agent` dispatches `post-intelligence`
- `parcel-ranking-agent` dispatches `post-ranking`
- `financial-engine-agent` dispatches `post-financial`
- the shared event dispatcher invokes `rule-engine-agent`, logs `event_triggered` and `rule_engine_invoked` records to `ai_actions`, and suppresses duplicate processing for the same `deal_id` and event
- `rule-engine-agent` fetches event-scoped rules from `get-agent-rules`, evaluates them against persisted planning, yield, ranking, and financial context, and executes matching actions in priority order
- `notification-agent` now extends the action layer with external high-priority email and webhook delivery, while recording delivery status in `ai_actions`
- shared agent runtime validation now records per-agent execution state in `agent_registry` and standardized `agent_execution` rows in `ai_actions`
- failed notification triggers now retry with bounded attempts and downgrade priority when retries are exhausted
- failed `deal_feed` persistence now retries with deduplicated queue fallback in `agent_retry_queue`
- `system-health-check` snapshots key agent, database, and recent-activity status into `system_health`
- the shared agent runtime records one `usage_metrics` row per successful or client-error execution, checks the global `system_settings` kill switch before agent work starts, and blocks over-limit agents using `agent_rate_limits`
- database workflow triggers promote `deals.status` from `active` to `reviewing` when high-priority feed entries are persisted and from `reviewing` to `approved` when all linked tasks are completed, with deduplicated status-transition logging
- `site-intelligence-agent` preserves the legacy score-threshold fallback if post-ranking rule execution fails or no report rule matches
- hosted environments may require additive schema-alignment migrations before autonomous orchestration can persist deal, feasibility, comparable-sales, and ranking outputs consistently
- `internal-ops-dashboard` provides the operator-facing web surface for deal feed review, notification audit, approvals, funnel monitoring, health checks, cleanup, report generation, and kill-switch controls

## Architecture Principles

- Modular
- Extensible
- Data-driven
- AI-assisted
