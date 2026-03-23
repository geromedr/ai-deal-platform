-- Align legacy hosted core tables with columns assumed by current discovery,
-- comparable-sales, and reporting agents. This migration is additive and idempotent.

alter table public.deals
  add column if not exists suburb text,
  add column if not exists state text,
  add column if not exists postcode text;

alter table public.site_intelligence
  add column if not exists updated_at timestamptz not null default now();
