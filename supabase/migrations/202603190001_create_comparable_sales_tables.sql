create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.comparable_sales_estimates (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  subject_address text,
  suburb text,
  state text,
  postcode text,
  radius_km numeric(6,2) not null default 5,
  dwelling_type text not null,
  estimated_sale_price_per_sqm numeric(12,2) not null,
  currency text not null default 'AUD',
  rationale text,
  model_name text,
  knowledge_context jsonb not null default '[]'::jsonb,
  raw_output jsonb not null default '{}'::jsonb,
  status text not null default 'completed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comparable_sales_estimates_deal_id_created_at
  on public.comparable_sales_estimates (deal_id, created_at desc);

create table if not exists public.comparable_sales_evidence (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.comparable_sales_estimates(id) on delete cascade,
  project_name text not null,
  location text not null,
  dwelling_type text,
  estimated_sale_price_per_sqm numeric(12,2) not null,
  similarity_reason text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_comparable_sales_evidence_estimate_id
  on public.comparable_sales_evidence (estimate_id);

drop trigger if exists set_comparable_sales_estimates_updated_at
  on public.comparable_sales_estimates;

create trigger set_comparable_sales_estimates_updated_at
before update on public.comparable_sales_estimates
for each row
execute function public.set_updated_at();

drop trigger if exists set_comparable_sales_evidence_updated_at
  on public.comparable_sales_evidence;

create trigger set_comparable_sales_evidence_updated_at
before update on public.comparable_sales_evidence
for each row
execute function public.set_updated_at();
