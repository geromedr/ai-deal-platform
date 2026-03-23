-- Align hosted site_candidates table with the full current write shape used by
-- site-intelligence-agent and parcel-ranking-agent. This migration is additive
-- and idempotent.

alter table public.site_candidates
  add column if not exists property_type text,
  add column if not exists land_area numeric(12,2),
  add column if not exists raw_data jsonb not null default '{}'::jsonb,
  add column if not exists zoning text,
  add column if not exists height_limit text,
  add column if not exists fsr text,
  add column if not exists flood_risk text,
  add column if not exists heritage_status text,
  add column if not exists estimated_units integer,
  add column if not exists estimated_profit numeric(14,2),
  add column if not exists ranking_score integer,
  add column if not exists ranking_tier text,
  add column if not exists ranking_reasons jsonb not null default '[]'::jsonb,
  add column if not exists ranking_run_at timestamptz;
