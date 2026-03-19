# DATABASE SCHEMA REGISTRY

This document is the source of truth for all database tables.

All new tables MUST be registered here after creation.

---

## NAMING CONVENTIONS

- snake_case only
- plural table names (deals, comparable_sales)
- *_data for raw ingestion tables
- *_analysis for computed outputs

---

## deals

Primary table for all development opportunities.

Fields:
- id (uuid, pk)
- address (text)
- status (text)
- created_at (timestamp)

---

## zoning_data

Stores zoning information per deal.

Fields:
- id (uuid, pk)
- deal_id (uuid, fk → deals.id)
- zoning_code (text)
- height_limit (numeric)
- fsr (numeric)
- raw_data (jsonb)
- created_at (timestamp)

---

## flood_data

Stores flood-related constraints.

Fields:
- id (uuid, pk)
- deal_id (uuid)
- flood_risk (text)
- raw_data (jsonb)
- created_at (timestamp)

---

## yield_analysis

Stores feasibility outputs.

Fields:
- id (uuid, pk)
- deal_id (uuid)
- estimated_units (integer)
- revenue (numeric)
- costs (numeric)
- profit (numeric)
- assumptions (jsonb)
- created_at (timestamp)