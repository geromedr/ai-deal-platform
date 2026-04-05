# REQUIRED CHANGES

This file records the bootstrap changes that were required to make `docs_v2` the active default-load system.

## REQUIRED BOOTSTRAP CHANGES

1. Update repository bootstrap guidance in `AGENTS.md` so the mandatory startup read points to:
   - `docs_v2/CORE_SYSTEM_PROMPT.md`
   - `docs_v2/SYSTEM_RUNTIME.md`
   Status: complete

2. Replace the mandatory read list in `docs/operations/AI_SYSTEM_PROMPT.md` with the new default-load pair, or retire that file from bootstrap use.
   Status: complete

3. Remove recursive mandatory-read instructions from legacy governance docs so they no longer expand the load path when opened for compatibility reasons.
   Status: complete for mandatory default-load instructions

4. Decide whether `docs/ai-governance/AI_SYSTEM_PROMPT.md` remains a legacy reference or is retired entirely, because it currently presents a second prompt model that conflicts with the new structure.
   Status: retained as legacy reference and explicitly marked `DO NOT USE - replaced by docs_v2 system`

## WHY THIS IS REQUIRED

Without these bootstrap changes, Codex would continue to follow the legacy entry path and load the old multi-document governance chain, which preserves behaviour but does not deliver the intended token and speed improvement.
