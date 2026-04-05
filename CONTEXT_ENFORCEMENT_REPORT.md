# CONTEXT ENFORCEMENT REPORT

## Rules Added

- Added `Maximum additional documents per task: 1 unless explicitly required` under `DEFAULT DOCUMENT LOADING POLICY`.
- Added a hard stop under `EXECUTION RULES`: if more than one additional document seems required, stop and ask for clarification before loading more.
- Added a runtime size guard: `SYSTEM_RUNTIME.md` must remain concise and under 1500-2000 tokens, and must be reduced before further use if it exceeds that size.
- Added anti-drift rules: do not reintroduce cross-document dependency chains, and keep all references single-hop only.

## Conflicts Found

- No direct conflicts found in the current default pair.
- Existing rule `request exactly one matching document` is consistent with the new maximum-document rule.
- Existing rule `Do not follow chained references` is consistent with the new single-hop anti-drift rule.
- Existing `SYSTEM_RUNTIME.md` boundary language is consistent with the new runtime size guard.

## Enforcement Confirmation

- Default loading remains restricted to `CORE_SYSTEM_PROMPT.md` and `SYSTEM_RUNTIME.md`.
- Additional context is now explicitly capped at one document per task unless explicitly required.
- Multi-document expansion now requires a stop-and-clarify step before any further loading.
- Cross-document dependency chains are explicitly prohibited.
- Existing behaviour is preserved while context loading is made stricter.
