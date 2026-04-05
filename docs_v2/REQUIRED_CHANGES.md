# REQUIRED CHANGES

Prompt-format updates are required for `docs_v2` to become the active default-load system. Per instruction, these prompts were not modified in this migration step.

## REQUIRED BOOTSTRAP CHANGES

1. Update repository bootstrap guidance in `AGENTS.md` so the mandatory startup read points to:
   - `docs_v2/CORE_SYSTEM_PROMPT.md`
   - `docs_v2/SYSTEM_RUNTIME.md`

2. Replace the mandatory read list in `docs/operations/AI_SYSTEM_PROMPT.md` with the new default-load pair, or retire that file from bootstrap use.

3. Remove recursive mandatory-read instructions from legacy governance docs so they no longer expand the load path when opened for compatibility reasons.

4. Decide whether `docs/ai-governance/AI_SYSTEM_PROMPT.md` remains a legacy reference or is retired entirely, because it currently presents a second prompt model that conflicts with the new structure.

## WHY THIS IS REQUIRED

Without these bootstrap changes, Codex will continue to follow the legacy entry path and load the old multi-document governance chain, which preserves behaviour but does not deliver the intended token and speed improvement.
