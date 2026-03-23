-- Align hosted site_intelligence schema with the current orchestration payload shape.
-- This migration is additive and idempotent.

alter table public.site_intelligence
  add column if not exists raw_data jsonb default '{}'::jsonb,
  add column if not exists updated_at timestamptz default now();

update public.site_intelligence
set
  raw_data = coalesce(raw_data, '{}'::jsonb),
  updated_at = coalesce(updated_at, created_at, now())
where raw_data is null
   or updated_at is null;

alter table public.site_intelligence
  alter column raw_data set default '{}'::jsonb,
  alter column raw_data set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;
