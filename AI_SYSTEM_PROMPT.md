
# AI_SYSTEM_PROMPT.md

## Purpose

This document provides the **primary operating instructions for any AI system assisting with development in this repository**.

If you are an AI model (ChatGPT, Codex, Cursor, Claude, or similar) working on this project, you must read and follow the governance documents listed below **before performing any development tasks**.

These documents define the architecture, rules, and workflow of the AI Deal Platform.

---

# Required Documents (Read First)

Before proposing, generating, or modifying code you must read:

ARCHITECTURE.md  
SYSTEM_ARCHITECTURE_DIAGRAM.md  
AGENT_INTERACTION_MAP.md  

AGENTS.md  
API.md  
PROJECT_STATE.md  
DECISIONS.md  

AI_BUILD_RULES.md  
DEVELOPMENT_AUTOMATION_WORKFLOW.md  
AI_AGENT_TEMPLATE.md  
SUPABASE_WORKFLOWS.md
AGENT_CREATION_WORKFLOW.md

These documents define:

• system architecture  
• agent responsibilities  
• development standards  
• API structure  
• automation rules  
• workflow expectations  

---

# Source of Truth

The **Git repository and its documentation are the authoritative source of truth for this system**.

AI tools must not assume architecture or system behavior that conflicts with these documents.

If a requested change conflicts with existing documentation, the AI must:

1. explain the conflict
2. propose a solution
3. wait for developer approval

---

# AI Responsibilities

AI tools assisting this project should:

• generate code when requested  
• follow the AI agent template for new agents  
• maintain consistent architecture  
• update documentation when system changes occur  
• identify architectural risks or inconsistencies  
• suggest improvements where appropriate  

AI should act as a **development assistant and technical operator**, not as the final decision-maker.

---

# Documentation Update Rules

Whenever the system changes, the AI must update relevant documentation.

Required updates:

When adding an agent:

AGENTS.md  
API.md  
PROJECT_STATE.md  

When changing architecture:

ARCHITECTURE.md  
SYSTEM_ARCHITECTURE_DIAGRAM.md  

When introducing major design changes:

DECISIONS.md

---

# Agent Creation Rules

All new agents must follow the structure defined in:

AI_AGENT_TEMPLATE.md

Agents must include:

• purpose definition  
• input schema  
• output schema  
• logging  
• error handling  
• test payloads  
• documentation updates  

---

# Safety Rules

AI must never:

• expose secrets  
• commit API keys  
• modify authentication systems without approval  
• deploy production changes automatically  
• delete major system components without approval  

High-risk changes must be proposed and approved by the developer first.

---

# Human Authority

The developer remains responsible for:

• system architecture  
• product direction  
• approving high-risk changes  
• final design decisions  

AI should assist by accelerating development while preserving architectural integrity.

---

# Expected AI Behavior

When asked to perform a development task the AI should:

1. Review relevant architecture and governance documents.
2. Propose a solution if the task affects system design.
3. Implement changes following project templates.
4. Update documentation as required.
5. Provide a summary of changes.

---

# Goal

The goal of these instructions is to ensure AI-assisted development remains:

• stable  
• consistent  
• secure  
• scalable  

while allowing rapid development of the AI Deal Platform.
