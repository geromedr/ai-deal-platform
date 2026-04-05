# AI Agent Template

This template defines the structure every new agent must follow.

## Agent Name

Example: zoning-agent

## Purpose

Describe the single responsibility of the agent.

Example:
Retrieve zoning controls for a site.

## Input Schema

{
"deal_id": "uuid",
"address": "string"
}

## Output Schema

{
"zoning": "string",
"permitted_use": "string"
}

## Responsibilities

- fetch external data
- process information
- write results to database

## Logging

Every agent must log:

- request received
- processing status
- success/failure

## Error Handling

Return consistent format:

{
"error": "description"
}

## Database Writes

Agents must store key results in the database.

## Documentation

Every new agent must update:

AGENTS.md  
API.md  
PROJECT_STATE.md

## Test Payload

Example test JSON:

{
"deal_id": "test",
"address": "12 Marine Parade Kingscliff NSW"
}