# AGENT WORKFLOWS

Load this document only when creating or updating agents.

## CREATION RULES

- Give each agent a clear responsibility.
- Create or update the function in `supabase/functions/{agent-name}`.
- Include input validation, structured logging, explicit error handling, and database writes where required.
- Add a simple test payload.
- Preserve request and response contracts unless the change is intentional.

## DOCUMENTATION RULES

When agent behaviour changes, update the relevant documentation summary and any detailed API or runtime references that become inaccurate.

## REVIEW RULES

Before finishing:
- check validation
- check logging
- check error handling
- check compatibility impact
- check documentation impact

## SHARED EXPECTATIONS

- Prefer existing templates and runtime helpers.
- Avoid introducing isolated agents that do not fit the system pipeline.
- Preserve structured JSON responses and auditable behaviour.
