-- Align hosted site_candidates timestamps with existing update trigger behavior.
-- This migration is additive and idempotent.

alter table public.site_candidates
  add column if not exists updated_at timestamptz not null default now();
