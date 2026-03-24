-- Create deal_feed as the source of truth for surfaced opportunities.
-- This migration is additive and idempotent.

create table if not exists public.deal_feed (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  score numeric(14,2),
  status text not null default 'pending',
  trigger_event text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deal_feed
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists deal_id uuid,
  add column if not exists score numeric(14,2),
  add column if not exists status text default 'pending',
  add column if not exists trigger_event text,
  add column if not exists summary text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.deal_feed
  alter column id set default gen_random_uuid(),
  alter column deal_id set not null,
  alter column status set default 'pending',
  alter column status set not null,
  alter column trigger_event set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deal_feed_pkey'
      and conrelid = 'public.deal_feed'::regclass
  ) then
    alter table public.deal_feed
      add constraint deal_feed_pkey primary key (id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deal_feed_deal_id_fkey'
      and conrelid = 'public.deal_feed'::regclass
  ) then
    alter table public.deal_feed
      add constraint deal_feed_deal_id_fkey
      foreign key (deal_id) references public.deals(id) on delete cascade;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'deal_feed_deal_id_trigger_event_key'
      and conrelid = 'public.deal_feed'::regclass
  ) then
    alter table public.deal_feed
      add constraint deal_feed_deal_id_trigger_event_key
      unique (deal_id, trigger_event);
  end if;
end
$$;

create index if not exists idx_deal_feed_deal_id
  on public.deal_feed (deal_id);

create index if not exists idx_deal_feed_created_at
  on public.deal_feed (created_at desc);

drop trigger if exists set_deal_feed_updated_at on public.deal_feed;
create trigger set_deal_feed_updated_at
before update on public.deal_feed
for each row
execute function public.set_updated_at();
