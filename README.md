# AI Deal Platform

AI Deal Platform is an autonomous property development intelligence system designed to discover, analyze, and rank property development opportunities in New South Wales (NSW), Australia.

The platform automates tasks traditionally performed by development acquisition teams including:

- discovering potential development sites
- researching planning controls
- estimating development yield
- assessing feasibility
- ranking opportunities

The system uses a modular **agent architecture** built with **Supabase Edge Functions** and orchestrated with AI.

## Core Concept

Input → Analysis → Feasibility → Ranking → Development Opportunity

## Technology Stack

- Runtime: Supabase Edge Functions
- Language: TypeScript
- Database: PostgreSQL (Supabase)
- AI: OpenAI / ChatGPT
- Development: VS Code
- Version Control: Git / GitHub

## Repository Structure

ai-deal-platform/
├── README.md
├── ARCHITECTURE.md
├── AGENTS.md
├── API.md
├── PROJECT_STATE.md
├── DECISIONS.md
├── AI_AGENT_TEMPLATE.md
└── supabase/
    └── functions/

## Vision

The long‑term goal is an **AI-powered development acquisition engine** that can:

- scan NSW property markets

# AI Development Rules

AI tools operating on this repository must consult the following
governance documents before performing work.

AI_SYSTEM_PROMPT.md  
AI_BUILD_RULES.md  
DEVELOPMENT_AUTOMATION_WORKFLOW.md  

These define the operational constraints for AI-assisted development.
- identify development opportunities

## AI Development Workflows

AI tools operating on this repository must follow the defined development workflows:

SUPABASE_WORKFLOWS.md  
AGENT_CREATION_WORKFLOW.md  

These documents define the correct procedures for creating agents,
modifying edge functions, updating documentation, and managing
Supabase infrastructure.
- analyze planning constraints
- estimate project feasibility
- rank opportunities
- notify developers or investors
