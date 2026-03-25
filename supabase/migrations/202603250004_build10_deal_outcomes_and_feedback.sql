create table if not exists public.deal_outcomes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  outcome_type text not null check (
    outcome_type in ('won', 'lost', 'in_progress')
  ),
  actual_return numeric,
  duration_days integer check (duration_days is null or duration_days >= 0),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.deal_performance
  add column if not exists outcomes_recorded integer not null default 0,
  add column if not exists last_outcome_type text,
  add column if not exists last_actual_return numeric,
  add column if not exists average_actual_return numeric,
  add column if not exists average_duration_days numeric,
  add column if not exists last_outcome_recorded_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_deal_outcomes_outcome_type_created_at
  on public.deal_outcomes (outcome_type, created_at desc);

create index if not exists idx_deal_outcomes_deal_id_created_at
  on public.deal_outcomes (deal_id, created_at desc);

drop trigger if exists set_deal_performance_updated_at on public.deal_performance;
create trigger set_deal_performance_updated_at
before update on public.deal_performance
for each row
execute function public.set_updated_at();

create table if not exists public.scoring_feedback (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  outcome_type text not null check (
    outcome_type in ('won', 'lost', 'in_progress')
  ),
  predicted_priority_score numeric,
  predicted_return numeric,
  actual_return numeric,
  adjustment_factor numeric not null default 0,
  previous_weights jsonb not null default '{}'::jsonb,
  adjusted_weights jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scoring_feedback_created_at
  on public.scoring_feedback (created_at desc);

create index if not exists idx_scoring_feedback_deal_id_created_at
  on public.scoring_feedback (deal_id, created_at desc);

drop trigger if exists set_scoring_feedback_updated_at on public.scoring_feedback;
create trigger set_scoring_feedback_updated_at
before update on public.scoring_feedback
for each row
execute function public.set_updated_at();

create or replace function public.sync_deal_performance_outcome_metrics(
  p_deal_id uuid
)
returns public.deal_performance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outcome public.deal_outcomes;
  v_outcome_count integer;
  v_average_actual_return numeric;
  v_average_duration_days numeric;
  v_row public.deal_performance;
begin
  select *
  into v_outcome
  from public.deal_outcomes
  where deal_id = p_deal_id
  order by created_at desc
  limit 1;

  select
    count(*),
    avg(actual_return),
    avg(duration_days::numeric)
  into
    v_outcome_count,
    v_average_actual_return,
    v_average_duration_days
  from public.deal_outcomes
  where deal_id = p_deal_id;

  insert into public.deal_performance (
    deal_id,
    outcomes_recorded,
    last_outcome_type,
    last_actual_return,
    average_actual_return,
    average_duration_days,
    last_outcome_recorded_at,
    updated_at
  )
  values (
    p_deal_id,
    coalesce(v_outcome_count, 0),
    v_outcome.outcome_type,
    v_outcome.actual_return,
    v_average_actual_return,
    v_average_duration_days,
    v_outcome.created_at,
    now()
  )
  on conflict (deal_id)
  do update
  set
    outcomes_recorded = excluded.outcomes_recorded,
    last_outcome_type = excluded.last_outcome_type,
    last_actual_return = excluded.last_actual_return,
    average_actual_return = excluded.average_actual_return,
    average_duration_days = excluded.average_duration_days,
    last_outcome_recorded_at = excluded.last_outcome_recorded_at,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;
