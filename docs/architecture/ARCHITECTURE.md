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

### Event-Driven Decision Layer
Uses stage-completion events to drive downstream orchestration rules.

- `site-discovery-agent` dispatches `post-discovery`
- `site-intelligence-agent` dispatches `post-intelligence`
- `parcel-ranking-agent` dispatches `post-ranking`
- `financial-engine-agent` dispatches `post-financial`
- the shared event dispatcher invokes `rule-engine-agent`, logs `event_triggered` and `rule_engine_invoked` records to `ai_actions`, and suppresses duplicate processing for the same `deal_id` and event
- `rule-engine-agent` fetches event-scoped rules from `get-agent-rules`, evaluates them against persisted planning, yield, ranking, and financial context, and executes matching actions in priority order
- `site-intelligence-agent` preserves the legacy score-threshold fallback if post-ranking rule execution fails or no report rule matches
- hosted environments may require additive schema-alignment migrations before autonomous orchestration can persist deal, feasibility, comparable-sales, and ranking outputs consistently

## Architecture Principles

- Modular
- Extensible
- Data-driven
- AI-assisted
