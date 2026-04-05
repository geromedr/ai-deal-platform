# AGENTS.md

All AI systems working in this repository must load, in order:

- docs_v2/CORE_SYSTEM_PROMPT.md
- docs_v2/SYSTEM_RUNTIME.md

These documents define the default behavioural contract and active runtime context.

No legacy prompt or governance document is part of the default startup load.
This startup read is mandatory for every task.
