# SUPABASE_WORKFLOWS.md

Referenced by:

docs/ai-governance/AI_SYSTEM_PROMPT.md  
docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md  

## Purpose

This document defines the **standard workflows for interacting with Supabase infrastructure** in the AI Deal Platform repository.

These workflows ensure AI-assisted development remains:

- consistent  
- predictable  
- safe  
- well documented  

AI systems working with this repository must follow the procedures defined here.

---

# Workflow 1 — Create New Edge Function

1. Create folder:

supabase/functions/{agent-name}

2. Create file:

index.ts

3. Follow the structure defined in:

docs/ai-governance/AI_AGENT_TEMPLATE.md

4. Ensure the function includes:

- request validation  
- structured logging  
- error handling  
- database writes  
- environment variable usage  

5. Add a **test payload**.

6. Update documentation.

Required doc updates:

docs/system/AGENTS.md  
docs/system/API.md  
docs/system/PROJECT_STATE.md  

---

# Workflow 2 — Update Edge Function

Steps:

1. Review existing code  
2. Preserve input/output schema unless change approved  
3. Maintain logging format  
4. Maintain error response format  
5. Update tests if behaviour changes  
6. Update documentation where necessary  

---

# Workflow 3 — Create SQL Migration

1. Generate migration SQL  
2. Explain schema change  
3. Wait for developer approval before execution  

AI must **never automatically modify production schema**.

---

# Workflow 4 — API Documentation Updates

Whenever endpoints change:

Update:

docs/system/API.md  

Include:

- endpoint path  
- request schema  
- response schema  
- example payload  

---

# Workflow 5 — Generate Test Payload

Each agent must include a test payload.

Example:

{
  "deal_id": "test-id",
  "address": "12 Marine Parade Kingscliff NSW"
}

---

# Workflow 6 — Register New Agent

After creating an agent AI must update:

docs/system/AGENTS.md  
docs/system/API.md  
docs/system/PROJECT_STATE.md  

---

# Workflow 7 — Deployment

AI may prepare deployment commands but must **not deploy automatically**.

Deployment requires developer approval.

## Deployment Rule

AI must NOT deploy functions automatically.

Default:
- generate deploy command
- wait for developer instruction

Only deploy if explicitly instructed:
"deploy this agent"

## CREATE TABLE WORKFLOW

When a required table does not exist:

1. Design schema
2. Generate SQL migration
3. Apply via Supabase migration system

Example:

create table comparable_sales (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid,
  address text,
  sale_price numeric,
  sale_date date,
  metadata jsonb,
  created_at timestamp default now()
);

4. Update documentation if needed
