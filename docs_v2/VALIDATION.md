# VALIDATION

## METHOD

Validated the proposed `docs_v2` structure against the current documented system flows rather than changing runtime code or prompts.

## SIMULATIONS

### Agent Creation

Required context available from default pair plus one optional workflow doc:
- behavioural and approval rules: `CORE_SYSTEM_PROMPT.md`
- current active agents and runtime shape: `SYSTEM_RUNTIME.md`
- creation specifics when needed: `ON_DEMAND/AGENT_WORKFLOWS.md`

Result:
- no recursive load required
- no missing critical creation rule identified

### Deal Flow

Required context available from default pair:
- discovery -> intelligence -> feasibility/ranking -> rules -> actions is summarized in `SYSTEM_RUNTIME.md`
- behavioural and contract constraints are in `CORE_SYSTEM_PROMPT.md`

Optional detail:
- `ON_DEMAND/API_DETAILS.md`
- `ON_DEMAND/SCHEMA_DETAILS.md`

Result:
- baseline deal execution remains understandable without loading large legacy docs

### Rule Execution

Required context available from default pair:
- event dispatcher, rule engine, notification/action path, audit expectations, and critical tables are summarized in `SYSTEM_RUNTIME.md`
- logging and deterministic behaviour contracts are in `CORE_SYSTEM_PROMPT.md`

Optional detail:
- `ON_DEMAND/ARCHITECTURE_DETAILS.md`
- `ON_DEMAND/API_DETAILS.md`

Result:
- no silent dependency chain remains in the default load path

## BEHAVIOUR CHECK

- default behavioural rules preserved
- approval boundaries preserved
- event-driven architecture preserved
- agent validation/logging expectations preserved
- investor/capital layer preserved at summary level
- fallback-safe compatibility stance preserved

## REMAINING RISK

The main remaining risk is accidental manual use of retained legacy files or backup copies. The active repository bootstrap now points only at `docs_v2/CORE_SYSTEM_PROMPT.md` and `docs_v2/SYSTEM_RUNTIME.md`.
