-- Align hosted site_candidates schema with current site-intelligence persistence.
-- This migration is additive and idempotent.

alter table public.site_candidates
  add column if not exists estimated_units integer;
