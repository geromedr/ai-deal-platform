# MIGRATION REPORT

## SUMMARY

Created a flattened documentation layer under `docs_v2/` designed to preserve current behaviour while reducing default context load.

Created:
- `docs_v2/CORE_SYSTEM_PROMPT.md`
- `docs_v2/SYSTEM_RUNTIME.md`
- `docs_v2/REFERENCE_MAP.md`
- `docs_v2/VALIDATION.md`
- `docs_v2/REQUIRED_CHANGES.md`
- `docs_v2/ON_DEMAND/API_DETAILS.md`
- `docs_v2/ON_DEMAND/SCHEMA_DETAILS.md`
- `docs_v2/ON_DEMAND/AGENT_WORKFLOWS.md`
- `docs_v2/ON_DEMAND/SUPABASE_WORKFLOWS.md`
- `docs_v2/ON_DEMAND/ARCHITECTURE_DETAILS.md`

Backup created:
- `docs_backup_original/` with the full original `docs/` hierarchy preserved.

## WHAT WAS REMOVED OR MERGED

Merged into `CORE_SYSTEM_PROMPT.md`:
- repeated behavioural rules
- repeated approval boundaries
- repeated execution expectations
- repeated logging and stability rules
- shared system contracts

Merged into `SYSTEM_RUNTIME.md`:
- high-level active architecture state
- key agents
- core pipelines
- critical data-structure summary
- current workflow summary

Moved to on-demand detail:
- endpoint detail
- schema detail
- agent creation workflow detail
- Supabase workflow detail
- architecture detail

## TOKEN REDUCTION ESTIMATE

Approximate current default path:
- `docs/operations/AI_SYSTEM_PROMPT.md`
- `docs/database/SCHEMA.md`
- `docs/ai-governance/SUPABASE_WORKFLOWS.md`
- `docs/ai-governance/AGENT_CREATION_WORKFLOW.md`
- `docs/ai-governance/AI_BUILD_RULES.md`

This bundle is roughly 34 KB before follow-on reads. In practice it expands further into large files like `docs/system/API.md`, `docs/system/AGENTS.md`, `docs/system/PROJECT_STATE.md`, and `docs/architecture/ARCHITECTURE.md`, pushing real loading pressure well above 100 KB of markdown.

Approximate new default path:
- `docs_v2/CORE_SYSTEM_PROMPT.md`
- `docs_v2/SYSTEM_RUNTIME.md`

Estimated result:
- default load reduced from a multi-hop governance bundle to a flat 2-doc bundle
- likely token reduction in the 75% to 90% range depending on whether legacy follow-on docs were previously loaded

## NEW LOADING STRATEGY

Default:
- load `CORE_SYSTEM_PROMPT.md`
- load `SYSTEM_RUNTIME.md`

Optional:
- load exactly one matching doc from `docs_v2/ON_DEMAND/` when needed

Target effect:
- minimal default loading
- no recursive references
- no multi-hop dependency chains
- one clear stability layer via `SYSTEM CONTRACTS`

## RISKS

- some nuanced endpoint and schema details remain only in legacy documents until or unless those details are further migrated
- legacy files still contain internal cross-references for compatibility and historical context, but they are no longer part of the default load path
- backup copies under `docs_backup_original/` remain in-repo and should not be used as entrypoints
