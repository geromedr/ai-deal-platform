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
Runs the planning and yield sub-agents for a subject site.

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

### planning-da-discovery-agent
Collects development application discovery opportunities.

### site-discovery-agent
Submits candidate sites into the analysis pipeline and scoring workflow.

### parcel-ranking-agent
Ranks candidate parcels for acquisition review.

## Feasibility

### yield-agent
Estimates development yield.

### comparable-sales-agent
Finds nearby comparable developments and estimates sale price per sqm.

### add-financial-snapshot
Stores financial assumptions and snapshots.

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
