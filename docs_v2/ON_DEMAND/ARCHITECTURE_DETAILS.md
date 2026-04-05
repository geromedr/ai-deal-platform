# ARCHITECTURE DETAILS

Load this document only when deeper architecture context is required.

## CURRENT ARCHITECTURE SHAPE

The platform uses modular Supabase Edge Functions, event-driven orchestration, shared runtime helpers, and database-backed state.

## IMPORTANT DESIGN PATTERNS

- stage-completion events drive downstream actions
- rule execution consumes normalized event context
- compatibility helpers shield legacy hosted schema drift
- reporting and context endpoints compose persisted state instead of rebuilding it from scratch
- investor and capital workflows are additive to the core deal pipeline

## MAJOR RISK AREAS

- schema drift between repository assumptions and hosted environments
- duplicate or recursive event execution
- silent contract drift between agents, API docs, and runtime behaviour
- overloading the default prompt with large detailed references

## WHEN TO LOAD

Load this document for structural refactors, orchestration changes, or compatibility analysis. Do not load it for routine file edits that only need the default pair.
