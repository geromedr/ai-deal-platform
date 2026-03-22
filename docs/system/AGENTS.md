# Agent Catalogue

This document lists all system agents.

## Core System

### agent-orchestrator
Executes structured actions returned by reasoning agents.

### ai-agent
Provides AI reasoning support with knowledge retrieval.

### deal-agent
Advances a deal by requesting context, reasoning on next actions, and delegating execution.

### deal-intelligence
Aggregates analysis outputs and records risks, milestones, and financial insights.

### deal-report-agent
Generates the final investment-ready report for a development opportunity by aggregating get-deal, get-deal-context, planning refreshes, yield, financial snapshots, comparable sales, and ranking data into structured JSON plus a human-readable summary, with strict deal ID validation, warning-driven partial results, and fallback-safe downstream handling.

### create-task
Creates task records linked to deals.

### update-deal-stage
Updates lifecycle stage for an existing deal.

## Communication

### email-agent
Processes inbound emails, updates deal communications, and triggers downstream agents.

### log-communication
Stores communication history.

### get-deal-timeline
Returns the unified activity feed for a deal.

### test-agent
Logs request payloads and returns a success response for testing.

## Planning Intelligence

### site-intelligence-agent
Runs the end-to-end site pipeline for a subject site, sequencing planning agents, comparable sales, yield, financial modelling, parcel ranking, and final deal reporting.

### zoning-agent
Retrieves zoning controls.

### flood-agent
Checks flood overlays.

### fsr-agent
Retrieves floor space ratio limits.

### height-agent
Retrieves building height controls.

### heritage-agent
Checks heritage restrictions.

## Discovery

### domain-discovery-agent
Scans external sources for opportunities.

### da-discovery-agent
Scans mock planning portal data for apartment and multi-dwelling development applications and forwards structured candidates to site-discovery-agent.

### planning-da-discovery-agent
Collects development application discovery opportunities.

### site-discovery-agent
Submits candidate sites into the analysis pipeline and scoring workflow.

### parcel-ranking-agent
Ranks development opportunities using a weighted scoring model across zoning, FSR, height, site size, yield, financial margin, and comparable sales strength, supporting both `deal_id` scoring and existing batch candidate ranking with strict mode-specific request validation.

## Feasibility

### yield-agent
Estimates development yield.

### comparable-sales-agent
Finds nearby comparable developments and estimates sale price per sqm.

### add-financial-snapshot
Stores financial assumptions and snapshots.

### financial-engine-agent
Performs detailed feasibility calculations using yield outputs, explicit comparable-sales price-per-sqm assumptions, nearby comparable developments, and planning constraints, then stores a structured financial snapshot for downstream reporting with fallback-safe revenue assumptions, warning-driven partial results, and clearer client-facing validation errors.

## Knowledge

### add-knowledge-document
Stores vector-searchable supporting documents.

### search-knowledge
Searches stored knowledge chunks for retrieval-augmented reasoning.

## Deal Context

### get-deal
Fetches core deal data and related records.

### get-deal-context
Retrieves contextual information across deal records.

## Rules

### get-agent-rules
Returns system rules and allowed actions for a given stage.
