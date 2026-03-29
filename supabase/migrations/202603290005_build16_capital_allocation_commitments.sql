create table if not exists public.deal_capital_allocations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  investor_id uuid not null references public.investors(id) on delete cascade,
  committed_amount numeric not null default 0 check (committed_amount >= 0),
  allocation_pct numeric check (
    allocation_pct is null
    or (allocation_pct >= 0 and allocation_pct <= 100)
  ),
  status text not null default 'proposed' check (
    status in ('proposed', 'soft_commit', 'hard_commit', 'funded')
  ),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, investor_id)
);

create index if not exists idx_deal_capital_allocations_deal_status_updated_at
  on public.deal_capital_allocations (deal_id, status, updated_at desc);

create index if not exists idx_deal_capital_allocations_investor_status_updated_at
  on public.deal_capital_allocations (investor_id, status, updated_at desc);

create index if not exists idx_deal_capital_allocations_deal_created_at
  on public.deal_capital_allocations (deal_id, created_at desc);

drop trigger if exists set_deal_capital_allocations_updated_at on public.deal_capital_allocations;
create trigger set_deal_capital_allocations_updated_at
before update on public.deal_capital_allocations
for each row
execute function public.set_updated_at();

create or replace function public.upsert_deal_capital_allocation(
  p_deal_id uuid,
  p_investor_id uuid,
  p_committed_amount numeric default 0,
  p_allocation_pct numeric default null,
  p_status text default 'proposed',
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.deal_capital_allocations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.deal_capital_allocations;
begin
  insert into public.deal_capital_allocations (
    deal_id,
    investor_id,
    committed_amount,
    allocation_pct,
    status,
    notes,
    metadata,
    updated_at
  )
  values (
    p_deal_id,
    p_investor_id,
    greatest(coalesce(p_committed_amount, 0), 0),
    p_allocation_pct,
    case
      when coalesce(nullif(btrim(p_status), ''), 'proposed') in (
        'proposed',
        'soft_commit',
        'hard_commit',
        'funded'
      ) then coalesce(nullif(btrim(p_status), ''), 'proposed')
      else 'proposed'
    end,
    p_notes,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (deal_id, investor_id)
  do update
  set
    committed_amount = excluded.committed_amount,
    allocation_pct = excluded.allocation_pct,
    status = excluded.status,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
