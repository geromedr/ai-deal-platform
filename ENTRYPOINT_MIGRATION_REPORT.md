# ENTRYPOINT MIGRATION REPORT

## What Was Changed

- Updated `AGENTS.md` so the mandatory startup load now points only to:
  - `docs_v2/CORE_SYSTEM_PROMPT.md`
  - `docs_v2/SYSTEM_RUNTIME.md`
- Updated `docs/operations/AI_SYSTEM_PROMPT.md` to:
  - add `DO NOT USE - replaced by docs_v2 system`
  - replace the legacy mandatory read bundle with the `docs_v2` pair
- Updated `docs/ai-governance/AI_BUILD_RULES.md` so its mandatory read instruction now points only to the `docs_v2` pair
- Updated retained backup compatibility copies under `docs_backup_original/` to remove legacy default-load instructions and align their mandatory read text to the `docs_v2` pair
- Updated legacy prompt variants to add the explicit block marker:
  - `docs/ai-governance/AI_SYSTEM_PROMPT.md`
  - `docs_backup_original/ai-governance/AI_SYSTEM_PROMPT.md`
- Updated `docs_v2` migration/status docs so they reflect the completed cutover instead of a pending bootstrap migration:
  - `docs_v2/REFERENCE_MAP.md`
  - `docs_v2/REQUIRED_CHANGES.md`
  - `docs_v2/MIGRATION_REPORT.md`
  - `docs_v2/VALIDATION.md`

## Remaining Legacy References

Remaining legacy references are still present, but they are not default-load instructions:

- Historical analysis in `docs_v2/REFERENCE_MAP.md` and `docs_v2/MIGRATION_REPORT.md`
- Compatibility/internal cross-references inside retained legacy docs, for example:
  - `docs/operations/AI_SYSTEM_PROMPT.md` still references `docs/ai-governance/SUPABASE_WORKFLOWS.md` and `docs/ai-governance/AGENT_CREATION_WORKFLOW.md` as legacy workflow detail
  - `docs/ai-governance/SUPABASE_WORKFLOWS.md` and `docs/ai-governance/AGENT_CREATION_WORKFLOW.md` still list `docs/operations/AI_SYSTEM_PROMPT.md` in `Referenced by` sections
  - `docs_backup_original/` preserves old document relationships for archival purposes

These references are retained for history or compatibility only. None of them is the active repository bootstrap.

## Clean Cutover Confirmation

Confirmed:

- `AGENTS.md` default startup load is now flat and minimal
- active default entrypoint is `docs_v2/CORE_SYSTEM_PROMPT.md` + `docs_v2/SYSTEM_RUNTIME.md`
- no current repository bootstrap file instructs loading `docs/operations/AI_SYSTEM_PROMPT.md` or the legacy governance bundle by default
- legacy prompt files are explicitly marked `DO NOT USE - replaced by docs_v2 system`

Cutover status: clean for default-load entrypoints.
