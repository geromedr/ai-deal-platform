# AI_BUILD_RULES.md

# AI Build Rules

IMPORTANT

Any AI system assisting development in this repository must read:

docs_v2/CORE_SYSTEM_PROMPT.md  
docs_v2/SYSTEM_RUNTIME.md  

before generating or modifying code.

---

## Purpose

This document defines the operational rules for AI-assisted development in the AI Deal Platform project.

ChatGPT (or other AI coding agents) acts as a development operator but must follow strict guidelines to ensure system stability, architectural consistency, and security.

---

# Core Principles

1. The Git repository is the **source of truth**  
2. Architecture decisions must be documented  
3. AI-generated code must follow existing project templates  
4. All new agents must update project documentation  
5. High-risk operations require explicit human approval  
6. System stability is more important than development speed  

---

# AI Responsibilities

AI tools are allowed to:

• generate code  
• scaffold new agents  
• edit existing code  
• update documentation  
• generate test payloads  
• suggest architecture improvements  
• diagnose errors  

AI tools must **explain reasoning when proposing structural changes**.

---

# Operations Allowed Without Approval

AI may automatically perform:

• creating new files  
• updating documentation  
• refactoring small code sections  
• generating Supabase edge functions  
• adding test payloads  
• improving logging  
• preparing commit messages  

---

# Operations Requiring Human Approval

AI must NOT perform these actions automatically:

• database schema changes  
• production deployments  
• environment variable changes  
• secret handling  
• deleting major components  
• replacing architecture patterns  
• modifying financial calculations  

AI must propose the change and wait for approval.

---

# Coding Standards

All agents must follow:

• TypeScript  
• Supabase Edge Function format  
• structured logging  
• consistent error handling  
• documented inputs and outputs  

---

# Documentation Rules

When new agents are created the AI must update:

docs/system/AGENTS.md  
docs/system/API.md  
docs/system/PROJECT_STATE.md  

If architecture changes:

docs/architecture/ARCHITECTURE.md must also be updated.

---

# Security Rules

AI must never:

• expose secrets  
• hardcode API keys  
• commit credentials  
• modify authentication without approval  

---

# Development Philosophy

AI accelerates engineering work but does not replace human oversight.

The developer remains responsible for:

• system architecture  
• final design decisions  
• approving high-risk changes  
• long-term product direction  
