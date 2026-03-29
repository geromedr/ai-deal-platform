create table if not exists public.deal_terms (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  sponsor_fee_pct numeric check (
    sponsor_fee_pct is null
    or (sponsor_fee_pct >= 0 and sponsor_fee_pct <= 100)
  ),
  equity_split jsonb not null default '{}'::jsonb,
  preferred_return_pct numeric check (
    preferred_return_pct is null
    or (preferred_return_pct >= 0 and preferred_return_pct <= 100)
  ),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id)
);

create index if not exists idx_deal_terms_updated_at
  on public.deal_terms (updated_at desc);

drop trigger if exists set_deal_terms_updated_at on public.deal_terms;
create trigger set_deal_terms_updated_at
before update on public.deal_terms
for each row
execute function public.set_updated_at();

create or replace function public.upsert_deal_terms(
  p_deal_id uuid,
  p_sponsor_fee_pct numeric default null,
  p_equity_split jsonb default '{}'::jsonb,
  p_preferred_return_pct numeric default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.deal_terms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.deal_terms;
begin
  insert into public.deal_terms (
    deal_id,
    sponsor_fee_pct,
    equity_split,
    preferred_return_pct,
    notes,
    metadata,
    updated_at
  )
  values (
    p_deal_id,
    p_sponsor_fee_pct,
    coalesce(p_equity_split, '{}'::jsonb),
    p_preferred_return_pct,
    p_notes,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (deal_id)
  do update
  set
    sponsor_fee_pct = excluded.sponsor_fee_pct,
    equity_split = excluded.equity_split,
    preferred_return_pct = excluded.preferred_return_pct,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
