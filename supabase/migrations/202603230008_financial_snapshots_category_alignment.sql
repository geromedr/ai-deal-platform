-- Align hosted financial_snapshots schema with the current feasibility snapshot write shape.
-- This migration is additive and idempotent.

alter table public.financial_snapshots
  add column if not exists category text;
