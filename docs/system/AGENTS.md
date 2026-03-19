# Agent Catalogue

This document lists all system agents.

## Core System

### agent-orchestrator
Coordinates workflows between agents.

### ai-agent
Provides AI reasoning support.

### deal-agent
Creates and manages deal records.

### deal-intelligence
Aggregates outputs from multiple agents.

### create-task
Creates tasks linked to deals.

## Communication

### email-agent
Processes inbound emails and extracts site leads.

### log-communication
Stores communication history.

### test-agent
Logs request payloads and returns a success response for testing.

## Planning Intelligence

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

### site-discovery-agent
Submits sites into the analysis pipeline.

## Feasibility

### yield-agent
Estimates development yield.

### comparable-sales-agent
Finds nearby comparable developments and estimates sale price per sqm.

### add-financial-snapshot
Stores financial assumptions.

## Knowledge

### add-knowledge-document
Stores supporting documents.

### search-knowledge
Searches stored knowledge.

## Deal Context

### get-deal
Fetches core deal data.

### get-deal-context
Retrieves contextual information.

### get-deal-timeline
Returns deal timeline.

### update-deal-stage
Updates lifecycle stage.

## Rules

### get-agent-rules
Returns system rules.
