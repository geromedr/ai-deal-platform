create table if not exists public.investor_deal_pipeline (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  investor_id uuid not null references public.investors(id) on delete cascade,
  pipeline_status text not null default 'new' check (
    pipeline_status in (
      'new',
      'contacted',
      'interested',
      'negotiating',
      'committed',
      'passed',
      'archived'
    )
  ),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, investor_id)
);

create table if not exists public.investor_communications (
  id uuid primary key default gen_random_uuid(),
  investor_id uuid not null references public.investors(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  communication_type text not null default 'note' check (
    communication_type in (
      'note',
      'email',
      'call',
      'meeting',
      'sms',
      'document',
      'other'
    )
  ),
  direction text not null default 'internal' check (
    direction in ('inbound', 'outbound', 'internal')
  ),
  subject text,
  summary text not null,
  status text not null default 'logged' check (
    status in ('draft', 'logged', 'sent', 'received', 'failed', 'archived')
  ),
  metadata jsonb not null default '{}'::jsonb,
  communicated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_investor_deal_pipeline_deal_status_follow_up
  on public.investor_deal_pipeline (deal_id, pipeline_status, next_follow_up_at asc nulls last);

create index if not exists idx_investor_deal_pipeline_investor_status_updated_at
  on public.investor_deal_pipeline (investor_id, pipeline_status, updated_at desc);

create index if not exists idx_investor_communications_investor_communicated_at
  on public.investor_communications (investor_id, communicated_at desc);

create index if not exists idx_investor_communications_deal_communicated_at
  on public.investor_communications (deal_id, communicated_at desc);

drop trigger if exists set_investor_deal_pipeline_updated_at on public.investor_deal_pipeline;
create trigger set_investor_deal_pipeline_updated_at
before update on public.investor_deal_pipeline
for each row
execute function public.set_updated_at();

drop trigger if exists set_investor_communications_updated_at on public.investor_communications;
create trigger set_investor_communications_updated_at
before update on public.investor_communications
for each row
execute function public.set_updated_at();

create or replace function public.map_investor_relationship_stage_to_pipeline_status(
  p_relationship_stage text
)
returns text
language sql
immutable
as $$
  select case lower(coalesce(p_relationship_stage, ''))
    when 'new' then 'new'
    when 'contacted' then 'contacted'
    when 'qualified' then 'contacted'
    when 'interested' then 'interested'
    when 'soft_committed' then 'negotiating'
    when 'committed' then 'committed'
    when 'passed' then 'passed'
    else 'new'
  end;
$$;

insert into public.investor_deal_pipeline (
  deal_id,
  investor_id,
  pipeline_status,
  notes,
  metadata,
  created_at,
  updated_at
)
select
  di.deal_id,
  di.investor_id,
  public.map_investor_relationship_stage_to_pipeline_status(di.relationship_stage),
  di.notes,
  coalesce(di.metadata, '{}'::jsonb),
  di.created_at,
  di.updated_at
from public.deal_investors di
on conflict (deal_id, investor_id) do nothing;

create or replace function public.upsert_investor_deal_pipeline(
  p_deal_id uuid,
  p_investor_id uuid,
  p_pipeline_status text default 'new',
  p_last_contacted_at timestamptz default null,
  p_next_follow_up_at timestamptz default null,
  p_notes text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.investor_deal_pipeline
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.investor_deal_pipeline;
begin
  insert into public.investor_deal_pipeline (
    deal_id,
    investor_id,
    pipeline_status,
    last_contacted_at,
    next_follow_up_at,
    notes,
    metadata,
    updated_at
  )
  values (
    p_deal_id,
    p_investor_id,
    case
      when coalesce(nullif(btrim(p_pipeline_status), ''), 'new') in (
        'new',
        'contacted',
        'interested',
        'negotiating',
        'committed',
        'passed',
        'archived'
      ) then coalesce(nullif(btrim(p_pipeline_status), ''), 'new')
      else 'new'
    end,
    p_last_contacted_at,
    p_next_follow_up_at,
    p_notes,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (deal_id, investor_id)
  do update
  set
    pipeline_status = excluded.pipeline_status,
    last_contacted_at = excluded.last_contacted_at,
    next_follow_up_at = excluded.next_follow_up_at,
    notes = excluded.notes,
    metadata = excluded.metadata,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
