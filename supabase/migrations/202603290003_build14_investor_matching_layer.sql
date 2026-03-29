alter table public.investors
  add column if not exists preferred_strategies text[] not null default '{}'::text[],
  add column if not exists risk_profile text not null default 'balanced',
  add column if not exists preferred_states text[] not null default '{}'::text[],
  add column if not exists preferred_suburbs text[] not null default '{}'::text[],
  add column if not exists min_target_margin_pct numeric;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'investors_risk_profile_check'
      and conrelid = 'public.investors'::regclass
  ) then
    alter table public.investors
      add constraint investors_risk_profile_check check (
        risk_profile in ('low', 'balanced', 'high', 'opportunistic')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'investors_min_target_margin_pct_check'
      and conrelid = 'public.investors'::regclass
  ) then
    alter table public.investors
      add constraint investors_min_target_margin_pct_check check (
        min_target_margin_pct is null
        or (min_target_margin_pct >= 0 and min_target_margin_pct <= 100)
      );
  end if;
end;
$$;

create table if not exists public.deal_investor_matches (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  investor_id uuid not null references public.investors(id) on delete cascade,
  match_score integer not null check (match_score >= 0 and match_score <= 100),
  match_band text not null check (
    match_band in ('strong', 'medium', 'weak', 'none')
  ),
  strategy_score integer not null default 0 check (
    strategy_score >= 0 and strategy_score <= 35
  ),
  budget_score integer not null default 0 check (
    budget_score >= 0 and budget_score <= 25
  ),
  risk_score integer not null default 0 check (
    risk_score >= 0 and risk_score <= 20
  ),
  location_score integer not null default 0 check (
    location_score >= 0 and location_score <= 20
  ),
  match_reasons jsonb not null default '{}'::jsonb,
  deal_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, investor_id)
);

create index if not exists idx_deal_investor_matches_deal_score
  on public.deal_investor_matches (deal_id, match_score desc, updated_at desc);

create index if not exists idx_deal_investor_matches_investor_score
  on public.deal_investor_matches (investor_id, match_score desc, updated_at desc);

drop trigger if exists set_deal_investor_matches_updated_at on public.deal_investor_matches;
create trigger set_deal_investor_matches_updated_at
before update on public.deal_investor_matches
for each row
execute function public.set_updated_at();

create or replace function public.safe_to_numeric(p_value text)
returns numeric
language plpgsql
immutable
as $$
declare
  v_value numeric;
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  begin
    v_value := p_value::numeric;
    return v_value;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public.normalize_match_pct(p_value numeric)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_value is null then
    return null;
  end if;

  if p_value > 1 and p_value <= 100 then
    return p_value / 100;
  end if;

  return p_value;
end;
$$;

create or replace function public.investor_match_score(
  p_deal_id uuid,
  p_investor_id uuid
)
returns table (
  match_score integer,
  match_band text,
  strategy_score integer,
  budget_score integer,
  risk_score integer,
  location_score integer,
  match_reasons jsonb,
  deal_snapshot jsonb
)
language sql
stable
security definer
set search_path = public
as $$
with latest_terms as (
  select
    dt.deal_id,
    dt.metadata,
    dt.updated_at
  from public.deal_terms dt
  where dt.deal_id = p_deal_id
  order by dt.updated_at desc
  limit 1
),
latest_financial as (
  select
    fs.deal_id,
    fs.amount,
    fs.gdv,
    fs.tdc,
    fs.metadata,
    fs.created_at
  from public.financial_snapshots fs
  where fs.deal_id = p_deal_id
  order by fs.created_at desc
  limit 1
),
deal_profile as (
  select
    d.id as deal_id,
    nullif(lower(btrim(coalesce(d.metadata ->> 'strategy', ''))), '') as deal_strategy,
    d.state,
    d.suburb,
    public.normalize_match_pct(
      coalesce(
        public.safe_to_numeric(lt.metadata ->> 'target_margin_pct'),
        public.safe_to_numeric(lt.metadata ->> 'target_margin'),
        public.safe_to_numeric(lf.metadata -> 'feasibility' ->> 'margin')
      )
    ) as deal_target_margin,
    coalesce(
      public.safe_to_numeric(lt.metadata ->> 'equity_required'),
      public.safe_to_numeric(lt.metadata ->> 'target_raise'),
      public.safe_to_numeric(lt.metadata ->> 'deal_size'),
      lf.tdc,
      lf.gdv,
      lf.amount
    ) as deal_size
  from public.deals d
  left join latest_terms lt
    on lt.deal_id = d.id
  left join latest_financial lf
    on lf.deal_id = d.id
  where d.id = p_deal_id
),
investor_profile as (
  select
    i.id as investor_id,
    i.investor_name,
    i.capital_min,
    i.capital_max,
    coalesce(i.preferred_strategies, '{}'::text[]) as preferred_strategies,
    lower(coalesce(i.risk_profile, 'balanced')) as risk_profile,
    coalesce(i.preferred_states, '{}'::text[]) as preferred_states,
    coalesce(i.preferred_suburbs, '{}'::text[]) as preferred_suburbs,
    public.normalize_match_pct(i.min_target_margin_pct) as min_target_margin
  from public.investors i
  where i.id = p_investor_id
),
normalized as (
  select
    dp.*,
    ip.*,
    case
      when dp.deal_target_margin is null then 'unknown'
      when dp.deal_target_margin < 0.14 then 'low'
      when dp.deal_target_margin < 0.2 then 'balanced'
      when dp.deal_target_margin < 0.28 then 'high'
      else 'opportunistic'
    end as deal_risk_band,
    case lower(ip.risk_profile)
      when 'low' then 1
      when 'balanced' then 2
      when 'high' then 3
      when 'opportunistic' then 4
      else 2
    end as investor_risk_rank,
    case
      when dp.deal_target_margin is null then null
      when dp.deal_target_margin < 0.14 then 1
      when dp.deal_target_margin < 0.2 then 2
      when dp.deal_target_margin < 0.28 then 3
      else 4
    end as deal_risk_rank,
    exists (
      select 1
      from unnest(ip.preferred_strategies) as strategy(value)
      where lower(btrim(strategy.value)) = dp.deal_strategy
    ) as strategy_exact_match,
    exists (
      select 1
      from unnest(ip.preferred_suburbs) as suburb(value)
      where lower(btrim(suburb.value)) = lower(coalesce(dp.suburb, ''))
    ) as suburb_match,
    exists (
      select 1
      from unnest(ip.preferred_states) as state(value)
      where lower(btrim(state.value)) = lower(coalesce(dp.state, ''))
    ) as state_match
  from deal_profile dp
  cross join investor_profile ip
),
scored as (
  select
    case
      when coalesce(array_length(preferred_strategies, 1), 0) = 0 then 35
      when deal_strategy is null then 10
      when strategy_exact_match then 35
      else 0
    end as strategy_score,
    case
      when deal_size is null then 12
      when capital_min is null and capital_max is null then 25
      when capital_min is not null and capital_max is not null
        and deal_size between capital_min and capital_max then 25
      when capital_min is not null and capital_max is null
        and deal_size >= capital_min then 25
      when capital_min is null and capital_max is not null
        and deal_size <= capital_max then 25
      when capital_min is not null
        and deal_size >= capital_min * 0.8
        and deal_size < capital_min then 12
      when capital_max is not null
        and deal_size > capital_max
        and deal_size <= capital_max * 1.2 then 12
      else 0
    end as budget_score,
    case
      when deal_risk_rank is null then 10
      when min_target_margin is not null
        and deal_target_margin is not null
        and deal_target_margin < min_target_margin then 0
      when abs(coalesce(deal_risk_rank, investor_risk_rank) - investor_risk_rank) = 0 then 20
      when abs(coalesce(deal_risk_rank, investor_risk_rank) - investor_risk_rank) = 1 then 10
      else 0
    end as risk_score,
    case
      when coalesce(array_length(preferred_states, 1), 0) = 0
        and coalesce(array_length(preferred_suburbs, 1), 0) = 0 then 20
      when suburb_match then 20
      when state_match then 12
      else 0
    end as location_score,
    *
  from normalized
)
select
  least(100, strategy_score + budget_score + risk_score + location_score)::integer as match_score,
  case
    when strategy_score + budget_score + risk_score + location_score >= 75 then 'strong'
    when strategy_score + budget_score + risk_score + location_score >= 50 then 'medium'
    when strategy_score + budget_score + risk_score + location_score > 0 then 'weak'
    else 'none'
  end::text as match_band,
  strategy_score::integer,
  budget_score::integer,
  risk_score::integer,
  location_score::integer,
  jsonb_build_object(
    'strategy', jsonb_build_object(
      'deal_strategy', deal_strategy,
      'preferred_strategies', preferred_strategies,
      'matched', strategy_score >= 35
    ),
    'budget', jsonb_build_object(
      'deal_size', deal_size,
      'capital_min', capital_min,
      'capital_max', capital_max,
      'matched', budget_score >= 25
    ),
    'risk', jsonb_build_object(
      'deal_target_margin', deal_target_margin,
      'deal_risk_band', deal_risk_band,
      'investor_risk_profile', risk_profile,
      'investor_min_target_margin', min_target_margin,
      'matched', risk_score >= 20
    ),
    'location', jsonb_build_object(
      'deal_state', state,
      'deal_suburb', suburb,
      'preferred_states', preferred_states,
      'preferred_suburbs', preferred_suburbs,
      'matched', location_score >= 12
    )
  ) as match_reasons,
  jsonb_build_object(
    'strategy', deal_strategy,
    'state', state,
    'suburb', suburb,
    'deal_size', deal_size,
    'target_margin', deal_target_margin,
    'risk_band', deal_risk_band
  ) as deal_snapshot
from scored;
$$;

create or replace function public.refresh_deal_investor_matches(
  p_deal_id uuid,
  p_investor_id uuid default null
)
returns setof public.deal_investor_matches
language sql
security definer
set search_path = public
as $$
  with target_investors as (
    select i.id
    from public.investors i
    where (p_investor_id is null or i.id = p_investor_id)
      and i.status = 'active'
  ),
  scored as (
    select
      p_deal_id as deal_id,
      ti.id as investor_id,
      ims.match_score,
      ims.match_band,
      ims.strategy_score,
      ims.budget_score,
      ims.risk_score,
      ims.location_score,
      ims.match_reasons,
      ims.deal_snapshot
    from target_investors ti
    cross join lateral public.investor_match_score(p_deal_id, ti.id) ims
  )
  insert into public.deal_investor_matches (
    deal_id,
    investor_id,
    match_score,
    match_band,
    strategy_score,
    budget_score,
    risk_score,
    location_score,
    match_reasons,
    deal_snapshot,
    updated_at
  )
  select
    deal_id,
    investor_id,
    match_score,
    match_band,
    strategy_score,
    budget_score,
    risk_score,
    location_score,
    coalesce(match_reasons, '{}'::jsonb),
    coalesce(deal_snapshot, '{}'::jsonb),
    now()
  from scored
  on conflict (deal_id, investor_id)
  do update
  set
    match_score = excluded.match_score,
    match_band = excluded.match_band,
    strategy_score = excluded.strategy_score,
    budget_score = excluded.budget_score,
    risk_score = excluded.risk_score,
    location_score = excluded.location_score,
    match_reasons = excluded.match_reasons,
    deal_snapshot = excluded.deal_snapshot,
    updated_at = now()
  returning *;
$$;
