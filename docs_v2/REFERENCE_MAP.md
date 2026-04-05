# REFERENCE MAP

## SCOPE

Mapped current markdown references across the original `docs/` tree to identify default-load entry points, deep chains, circular references, and repeated context.

## ENTRY POINT DOCS

Primary entry point loaded by Codex:
- `AGENTS.md` -> `docs/operations/AI_SYSTEM_PROMPT.md`

Primary default-load bundle required by `docs/operations/AI_SYSTEM_PROMPT.md`:
- `docs/database/SCHEMA.md`
- `docs/ai-governance/SUPABASE_WORKFLOWS.md`
- `docs/ai-governance/AGENT_CREATION_WORKFLOW.md`
- `docs/ai-governance/AI_BUILD_RULES.md`

Secondary legacy prompt:
- `docs/ai-governance/AI_SYSTEM_PROMPT.md`

## HIGH-COST DOCS

Largest current docs by size:
- `docs/system/API.md` 56,787 bytes
- `docs/product/USER_MANUAL_RAW.md` 38,420 bytes
- `docs/system/SYSTEM_INTELLIGENCE_REPORT.md` 35,530 bytes
- `docs/database/SCHEMA.md` 22,848 bytes
- `docs/system/PROJECT_STATE.md` 13,566 bytes
- `docs/system/AGENTS.md` 12,965 bytes

These large files are not all loaded directly by the entry prompt, but the governance chain strongly encourages loading several of them during normal execution.

## DIRECT REFERENCE GRAPH

`docs/operations/AI_SYSTEM_PROMPT.md` ->
- `docs/database/SCHEMA.md`
- `docs/ai-governance/SUPABASE_WORKFLOWS.md`
- `docs/ai-governance/AGENT_CREATION_WORKFLOW.md`
- `docs/ai-governance/AI_BUILD_RULES.md`

`docs/ai-governance/AI_BUILD_RULES.md` ->
- `docs/operations/AI_SYSTEM_PROMPT.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/system/AGENTS.md`
- `docs/system/API.md`
- `docs/system/PROJECT_STATE.md`

`docs/ai-governance/SUPABASE_WORKFLOWS.md` ->
- `docs/operations/AI_SYSTEM_PROMPT.md`
- `docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md`
- `docs/ai-governance/AI_AGENT_TEMPLATE.md`
- `docs/system/AGENTS.md`
- `docs/system/API.md`
- `docs/system/PROJECT_STATE.md`

`docs/ai-governance/AGENT_CREATION_WORKFLOW.md` ->
- `docs/operations/AI_SYSTEM_PROMPT.md`
- `docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md`
- `docs/ai-governance/AI_AGENT_TEMPLATE.md`
- `docs/system/AGENTS.md`
- `docs/system/API.md`
- `docs/system/PROJECT_STATE.md`
- `docs/architecture/ARCHITECTURE.md`

`docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md` ->
- `docs/ai-governance/SUPABASE_WORKFLOWS.md`
- `docs/ai-governance/AGENT_CREATION_WORKFLOW.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/system/AGENTS.md`
- `docs/system/API.md`
- `docs/system/PROJECT_STATE.md`

`docs/product/USER_MANUAL_RAW.md` ->
- `docs/database/SCHEMA.md`

`docs/system/SYSTEM_INTELLIGENCE_REPORT.md` ->
- `docs/system/PROJECT_STATE.md`

## DEEP CHAINS

Observed high-cost chains:

1. `AGENTS.md` -> `docs/operations/AI_SYSTEM_PROMPT.md` -> `docs/ai-governance/AI_BUILD_RULES.md` -> `docs/system/API.md`
2. `AGENTS.md` -> `docs/operations/AI_SYSTEM_PROMPT.md` -> `docs/ai-governance/AI_BUILD_RULES.md` -> `docs/system/AGENTS.md`
3. `AGENTS.md` -> `docs/operations/AI_SYSTEM_PROMPT.md` -> `docs/ai-governance/AI_BUILD_RULES.md` -> `docs/architecture/ARCHITECTURE.md`
4. `AGENTS.md` -> `docs/operations/AI_SYSTEM_PROMPT.md` -> `docs/ai-governance/AGENT_CREATION_WORKFLOW.md` -> `docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md` -> `docs/ai-governance/SUPABASE_WORKFLOWS.md`

Result:
- default execution can expand from one prompt file into multiple governance files plus several large system references
- the load path is not flat and invites over-reading

## CIRCULAR REFERENCES

Confirmed cycles:

- `docs/operations/AI_SYSTEM_PROMPT.md` <-> `docs/ai-governance/AI_BUILD_RULES.md`
- `docs/operations/AI_SYSTEM_PROMPT.md` <-> `docs/ai-governance/SUPABASE_WORKFLOWS.md`
- `docs/operations/AI_SYSTEM_PROMPT.md` <-> `docs/ai-governance/AGENT_CREATION_WORKFLOW.md`
- `docs/ai-governance/AGENT_CREATION_WORKFLOW.md` <-> `docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md`
- `docs/ai-governance/SUPABASE_WORKFLOWS.md` <-> `docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md`

## HIGH-FREQUENCY REPEATED SECTIONS

Repeated across multiple docs:

- mandatory read lists
- update `AGENTS.md`, `API.md`, and `PROJECT_STATE.md`
- agent validation, logging, and error-handling rules
- test payload requirements
- deployment approval rules
- schema-change approval rules
- high-level architecture summaries

The same behavioural guidance is currently repeated in the entry prompt, build rules, agent workflow, Supabase workflow, development automation workflow, and agent template.

## REFACTOR DECISIONS

- Flatten default loading to two docs: `CORE_SYSTEM_PROMPT.md` and `SYSTEM_RUNTIME.md`
- Move detailed API, schema, workflow, and architecture content into `docs_v2/ON_DEMAND/`
- Replace cross-doc behavioural rules with one `SYSTEM CONTRACTS` section in the core prompt
- Keep all default references single-hop only
