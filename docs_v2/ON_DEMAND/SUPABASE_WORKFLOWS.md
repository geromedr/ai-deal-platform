# SUPABASE WORKFLOWS

Load this document only when changing infrastructure-facing Supabase behaviour.

## EDGE FUNCTION WORKFLOW

- Review existing implementation before changing it.
- Preserve validation, logging, and response structure unless the task changes them.
- Keep tests or test payloads aligned with behavioural changes.

## SCHEMA CHANGE WORKFLOW

- Check existing schema first.
- Prefer additive changes.
- Generate migrations rather than inline schema creation in app code.
- Human approval is required before applying production schema changes.

## DEPLOYMENT RULES

- Prepare deployment commands if needed.
- Do not deploy automatically.
- Do not change production infrastructure without explicit instruction.

## DOCUMENTATION RULES

- Keep runtime and on-demand detail aligned with actual Supabase behaviour.
- Avoid duplicating long schema or API content across multiple docs.
