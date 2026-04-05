DEPRECATED - see docs_v2/CORE_SYSTEM_PROMPT.md and docs_v2/SYSTEM_RUNTIME.md
This file is retained for compatibility and historical reference.

# DEVELOPMENT_AUTOMATION_WORKFLOW.md

## Purpose

This document defines the workflow for AI-assisted development of the AI Deal Platform.

ChatGPT operates as a **development automation layer** working alongside the developer to accelerate coding, documentation, testing, and system improvements.

---

# Development Roles

## Developer (Human)

Responsible for:

• product vision  
• architecture decisions  
• approving major changes  
• reviewing AI-generated work  

## ChatGPT / AI Tools

Responsible for:

• generating code  
• updating project files  
• creating agents  
• maintaining documentation  
• troubleshooting errors  

## Development Tools

• VS Code — development environment  
• Supabase — backend infrastructure  
• GitHub — version control  
• Terminal / CLI — command execution  

Supabase-specific operations are defined in:

docs/ai-governance/SUPABASE_WORKFLOWS.md  

Agent creation standards are defined in:

docs/ai-governance/AGENT_CREATION_WORKFLOW.md  

---

# AI-Assisted Development Flow

## Step 1 — Design Phase

Developer describes a feature or system improvement.

AI proposes:

• architecture approach  
• required agents  
• data structures  
• API changes  

Developer approves before implementation.

---

## Step 2 — Build Phase

AI generates:

• folders  
• code files  
• Supabase edge functions  
• test payloads  
• documentation updates  

---

## Step 3 — Review Phase

AI performs a code review of its own work and identifies:

• potential bugs  
• architecture inconsistencies  
• missing documentation  
• test gaps  

Developer then reviews.

---

## Step 4 — Test Phase

AI generates:

• Postman payloads  
• curl commands  
• test scenarios  

Developer runs tests.

---

## Step 5 — Commit Phase

AI prepares:

• commit message  
• change summary  
• documentation updates  

Developer executes git commit and push.

---

# Documentation Workflow

Whenever the system changes AI must update:

docs/architecture/ARCHITECTURE.md  
docs/system/AGENTS.md  
docs/system/API.md  
docs/system/PROJECT_STATE.md  

---

# Deployment Rules

AI may prepare deployment steps but must NOT deploy automatically.

Deployment always requires human approval.

---

# Long-Term Automation Vision

Eventually ChatGPT will be able to:

• scaffold large system features  
• analyze project structure  
• recommend architecture improvements  
• maintain documentation automatically  
• generate test coverage  
• orchestrate development tasks across tools  

The developer remains the **final authority** over system direction.

