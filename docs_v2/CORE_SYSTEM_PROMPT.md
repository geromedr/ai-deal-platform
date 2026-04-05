# CORE SYSTEM PROMPT

This document is the default behavioural contract for AI systems working in this repository.

Default load set:
- `docs_v2/CORE_SYSTEM_PROMPT.md`
- `docs_v2/SYSTEM_RUNTIME.md`

Do not load any other documentation by default. Load an on-demand document only when the task explicitly requires that detail.

## OPERATING RULES

- Act autonomously when the correct action is clear.
- Keep scope narrow. Touch only files directly related to the task.
- Prefer extending existing systems over creating parallel systems.
- Preserve existing behaviour, API contracts, and data contracts unless the task explicitly changes them.
- Build production-quality changes, not prototypes.
- Use deterministic outputs, explicit validation, and explicit error handling.
- Reuse existing patterns before introducing new ones.
- Update relevant documentation whenever behaviour, interfaces, or architecture change.

## EXECUTION RULES

Before work:
1. Load this document and `docs_v2/SYSTEM_RUNTIME.md`.
2. Decide whether the task needs additional detail.
3. If yes, request exactly one matching document from `docs_v2/ON_DEMAND/`.

Context integrity check:

If required context is missing, ambiguous, or not covered by the loaded documents, STOP and request the specific missing document before proceeding.

Do not follow chained references. Do not recursively load documentation.

## CRITICAL SYSTEM CONSTRAINTS

- The repository is the source of truth.
- High-risk operations require human approval.
- Do not automatically deploy.
- Do not automatically apply production schema changes.
- Do not change secrets, auth, or environment configuration without approval.
- Do not replace core architecture patterns unless explicitly directed.
- Do not silently change financial calculation semantics.
- Do not introduce undocumented schema, endpoint, or agent behaviour.

## HIGH-LEVEL ARCHITECTURE

The platform is an event-driven Supabase Edge Function system for property-deal discovery, planning intelligence, feasibility analysis, ranking, rule execution, reporting, and investor/capital workflows.

Primary flow:

Data sources -> discovery agents -> site intelligence -> feasibility and ranking -> event dispatcher -> rule engine -> triggered actions -> deal/investor/operator surfaces

State is persisted in Supabase tables and views. Operational traceability is maintained through structured responses plus audit and runtime logging.

## SYSTEM CONTRACTS

### Required Deal Structure

Every deal-centric workflow must preserve these minimum contracts:

- stable `deal_id` UUID
- address and core deal identity
- explicit stage/status
- persisted planning/intelligence context when available
- persisted financial/risk/task/communication context when available
- structured JSON responses for machine use

### Required Agent Behaviours

All agents and helpers must:

- have a clear responsibility
- validate required inputs before work
- return predictable JSON
- log key execution and action outcomes
- preserve compatibility with existing callers where possible
- use warnings for safe partial results instead of silent failure
- write or update persistent state only through established patterns

### Logging Rules

- Execution and action logging must remain traceable.
- Log agent name, action, success state, and relevant deal context when applicable.
- Return warnings explicitly when fallback or partial execution is used.
- Do not hide compatibility fallbacks or downstream failures.

## DEFAULT DOCUMENT LOADING POLICY

- Load only `CORE_SYSTEM_PROMPT.md` and `SYSTEM_RUNTIME.md` by default.
- Load at most one additional on-demand document for a task unless the task explicitly requires more.
- Prefer summaries in the default pair over large detailed references.

## SUCCESS STANDARD

Success means behaviour stays stable while context loading remains minimal, flat, and fast.
