alter table public.site_intelligence
  add column if not exists heritage_status text;

alter table public.site_candidates
  add column if not exists flood_risk text,
  add column if not exists heritage_status text,
  add column if not exists estimated_profit numeric(14,2),
  add column if not exists ranking_score integer,
  add column if not exists ranking_tier text,
  add column if not exists ranking_reasons jsonb not null default '[]'::jsonb,
  add column if not exists ranking_run_at timestamptz;
