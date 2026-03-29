create table if not exists public.investors (
  id uuid primary key default gen_random_uuid(),
  investor_name text not null,
  investor_type text not null default 'individual' check (
    investor_type in (
      'individual',
      'private_investor',
      'family_office',
      'syndicate',
      'fund',
      'developer',
      'lender',
      'broker',
      'other'
    )
  ),
  capital_min numeric check (capital_min is null or capital_min >= 0),
  capital_max numeric check (
    capital_max is null
    or capital_max >= 0
  ),
  status text not null default 'active' check (
    status in ('active', 'inactive', 'archived')
  ),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint investors_capital_range_check check (
    capital_min is null
    or capital_max is null
    or capital_max >= capital_min
  )
);

create table if not exists public.deal_investors (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  investor_id uuid not null references public.investors(id) on delete cascade,
  relationship_stage text not null default 'new' check (
    relationship_stage in (
      'new',
      'contacted',
      'qualified',
      'interested',
      'soft_committed',
      'committed',
      'passed'
    )
  ),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, investor_id)
);

create index if not exists idx_investors_status_updated_at
  on public.investors (status, updated_at desc);

create index if not exists idx_investors_type_status
  on public.investors (investor_type, status);

create index if not exists idx_deal_investors_deal_id_created_at
  on public.deal_investors (deal_id, created_at desc);

create index if not exists idx_deal_investors_investor_id_created_at
  on public.deal_investors (investor_id, created_at desc);

drop trigger if exists set_investors_updated_at on public.investors;
create trigger set_investors_updated_at
before update on public.investors
for each row
execute function public.set_updated_at();

drop trigger if exists set_deal_investors_updated_at on public.deal_investors;
create trigger set_deal_investors_updated_at
before update on public.deal_investors
for each row
execute function public.set_updated_at();

create or replace function public.upsert_deal_investor(
  p_deal_id uuid,
  p_investor_id uuid,
  p_relationship_stage text default 'new',
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.deal_investors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.deal_investors;
begin
  insert into public.deal_investors (
    deal_id,
    investor_id,
    relationship_stage,
    notes,
    metadata,
    updated_at
  )
  values (
    p_deal_id,
    p_investor_id,
    coalesce(nullif(btrim(p_relationship_stage), ''), 'new'),
    p_notes,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (deal_id, investor_id)
  do update
  set
    relationship_stage = excluded.relationship_stage,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
