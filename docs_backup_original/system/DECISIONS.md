# Architecture Decisions

## Agent Architecture

Decision: use modular agents.

Reason:
- scalable
- easier debugging
- independent development

## Supabase Edge Functions

Decision: implement agents as edge functions.

Reason:
- serverless
- simple deployment
- integrated database access

## Database as System Memory

Decision: store all outputs in database.

Reason:
- persistent state
- enables historical analysis

## AI Usage

AI used for:
- interpretation
- summarization
- decision support

Core logic remains deterministic.

## Comparable Sales Schema

Decision: store comparable sales outputs in dedicated tables.

Reason:
- avoids overloading financial snapshot records
- preserves estimate history for each deal
- supports normalized comparable evidence rows with JSONB context
