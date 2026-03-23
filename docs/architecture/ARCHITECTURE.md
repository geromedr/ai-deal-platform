# System Architecture

The AI Deal Platform is built around a **modular agent architecture** using Supabase Edge Functions.

Each agent performs a single specialized task.

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
Ranked Opportunities

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

### Decision Layer
Uses orchestration rules to decide whether a site advances to final reporting.

- site-intelligence-agent executes planning, feasibility, and ranking in sequence
- parcel-ranking-agent score thresholds determine whether deal-report-agent is triggered
- hosted environments may require additive schema-alignment migrations before autonomous orchestration can persist deal, feasibility, comparable-sales, and ranking outputs consistently
- low-scoring opportunities can stop at structured ranking output without generating a full report

## Architecture Principles

- Modular
- Extensible
- Data‑driven
- AI‑assisted
