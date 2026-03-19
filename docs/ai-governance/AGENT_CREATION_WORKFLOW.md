# AGENT_CREATION_WORKFLOW.md

Referenced by:

docs/ai-governance/AI_SYSTEM_PROMPT.md  
docs/ai-governance/DEVELOPMENT_AUTOMATION_WORKFLOW.md  

## Purpose

This document defines the **standard workflow for creating new agents** in the AI Deal Platform.

All new agents must follow this workflow to maintain system consistency.

---

# Step 1 — Define Purpose

Every agent must have a **single clear responsibility**.

Examples:

- retrieve zoning data  
- estimate development yield  
- analyse flood overlays  

---

# Step 2 — Create Agent Folder

Create directory:

supabase/functions/{agent-name}

---

# Step 3 — Create Core File

Create:

index.ts

Follow the structure defined in:

docs/ai-governance/AI_AGENT_TEMPLATE.md

---

# Step 4 — Implement Logic

Agent must include:

- request validation  
- structured logging  
- clear error handling  
- database write logic  
- environment variable usage if required  

---

# Step 5 — Define Input Schema

Example:

{
  "deal_id": "uuid",
  "address": "string"
}

---

# Step 6 — Define Output Schema

Example:

{
  "zoning": "string",
  "permitted_use": "string"
}

---

# Step 7 — Create Test Payload

Each agent must have a simple JSON payload used for testing.

---

# Step 8 — Update Documentation

Whenever a new agent is created the following files must be updated:

docs/system/AGENTS.md  
docs/system/API.md  
docs/system/PROJECT_STATE.md  

If the agent introduces architectural change:

docs/architecture/ARCHITECTURE.md must also be updated.

---

# Step 9 — Review

AI should check:

- documentation updated  
- schema consistency  
- error handling present  
- logging present  
- test payload present  

---

# Step 10 — Commit

Prepare commit summary explaining:

- new agent purpose  
- new endpoints  
- documentation updates  
