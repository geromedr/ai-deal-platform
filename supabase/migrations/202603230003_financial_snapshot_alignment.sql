-- Align hosted financial_snapshots schema with current feasibility and ranking agents.
-- This migration is additive and idempotent.

alter table public.financial_snapshots
  add column if not exists amount numeric(14,2),
  add column if not exists gdv numeric(14,2),
  add column if not exists tdc numeric(14,2),
  add column if not exists notes text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
