create table if not exists public.capital_allocations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  allocated_amount numeric not null check (allocated_amount >= 0),
  allocation_status text not null default 'proposed' check (
    allocation_status in ('proposed', 'committed', 'deployed')
  ),
  expected_return numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id)
);

create index if not exists idx_capital_allocations_status_updated_at
  on public.capital_allocations (allocation_status, updated_at desc);

create index if not exists idx_capital_allocations_deal_id_created_at
  on public.capital_allocations (deal_id, created_at desc);

drop trigger if exists set_capital_allocations_updated_at on public.capital_allocations;
create trigger set_capital_allocations_updated_at
before update on public.capital_allocations
for each row
execute function public.set_updated_at();
