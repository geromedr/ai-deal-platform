create or replace view public.deal_capital_summary as
with latest_terms as (
  select distinct on (dt.deal_id)
    dt.deal_id,
    dt.metadata,
    dt.updated_at
  from public.deal_terms dt
  order by dt.deal_id, dt.updated_at desc
),
latest_financial as (
  select distinct on (fs.deal_id)
    fs.deal_id,
    fs.amount,
    fs.gdv,
    fs.tdc,
    fs.metadata,
    fs.created_at
  from public.financial_snapshots fs
  order by fs.deal_id, fs.created_at desc
),
investor_universe as (
  select di.deal_id, di.investor_id
  from public.deal_investors di
  union
  select idp.deal_id, idp.investor_id
  from public.investor_deal_pipeline idp
  union
  select dca.deal_id, dca.investor_id
  from public.deal_capital_allocations dca
),
investor_pipeline_state as (
  select
    iu.deal_id,
    iu.investor_id,
    coalesce(
      nullif(lower(btrim(idp.pipeline_status)), ''),
      public.map_investor_relationship_stage_to_pipeline_status(di.relationship_stage),
      case
        when dca.status in ('hard_commit', 'funded') then 'committed'
        when dca.status = 'soft_commit' then 'negotiating'
        when dca.status = 'proposed' then 'contacted'
        else 'new'
      end,
      'new'
    ) as pipeline_status
  from investor_universe iu
  left join public.investor_deal_pipeline idp
    on idp.deal_id = iu.deal_id
   and idp.investor_id = iu.investor_id
  left join public.deal_investors di
    on di.deal_id = iu.deal_id
   and di.investor_id = iu.investor_id
  left join public.deal_capital_allocations dca
    on dca.deal_id = iu.deal_id
   and dca.investor_id = iu.investor_id
),
pipeline_rollup as (
  select
    ips.deal_id,
    count(*)::integer as investor_count,
    count(*) filter (where ips.pipeline_status = 'new')::integer as pipeline_new_count,
    count(*) filter (where ips.pipeline_status = 'contacted')::integer as pipeline_contacted_count,
    count(*) filter (where ips.pipeline_status = 'interested')::integer as pipeline_interested_count,
    count(*) filter (where ips.pipeline_status = 'negotiating')::integer as pipeline_negotiating_count,
    count(*) filter (where ips.pipeline_status = 'committed')::integer as pipeline_committed_count,
    count(*) filter (where ips.pipeline_status = 'passed')::integer as pipeline_passed_count,
    count(*) filter (where ips.pipeline_status = 'archived')::integer as pipeline_archived_count
  from investor_pipeline_state ips
  group by ips.deal_id
),
capital_rollup as (
  select
    dca.deal_id,
    coalesce(sum(
      case
        when dca.status in ('hard_commit', 'funded') then dca.committed_amount
        else 0
      end
    ), 0)::numeric as total_committed,
    coalesce(sum(
      case
        when dca.status = 'soft_commit' then dca.committed_amount
        else 0
      end
    ), 0)::numeric as total_soft_commit,
    count(*) filter (where dca.status in ('hard_commit', 'funded'))::integer as committed_investor_count,
    count(*) filter (where dca.status = 'soft_commit')::integer as soft_commit_investor_count
  from public.deal_capital_allocations dca
  group by dca.deal_id
),
base as (
  select
    d.id as deal_id,
    coalesce(
      public.safe_to_numeric(deal_data.deal_json ->> 'capital_target'),
      public.safe_to_numeric(deal_data.deal_json ->> 'equity_required'),
      public.safe_to_numeric(deal_data.deal_json ->> 'target_raise'),
      public.safe_to_numeric(deal_data.deal_json ->> 'deal_size'),
      public.safe_to_numeric(lt.metadata ->> 'equity_required'),
      public.safe_to_numeric(lt.metadata ->> 'target_raise'),
      public.safe_to_numeric(lt.metadata ->> 'deal_size'),
      public.safe_to_numeric(deal_data.deal_json -> 'metadata' ->> 'capital_target'),
      public.safe_to_numeric(deal_data.deal_json -> 'metadata' ->> 'equity_required'),
      public.safe_to_numeric(deal_data.deal_json -> 'metadata' ->> 'target_raise'),
      public.safe_to_numeric(deal_data.deal_json -> 'metadata' ->> 'deal_size'),
      lf.tdc,
      lf.amount,
      lf.gdv
    ) as capital_target,
    coalesce(cr.total_committed, 0)::numeric as total_committed,
    coalesce(cr.total_soft_commit, 0)::numeric as total_soft_commit,
    coalesce(pr.investor_count, 0)::integer as investor_count,
    coalesce(cr.committed_investor_count, 0)::integer as committed_investor_count,
    coalesce(cr.soft_commit_investor_count, 0)::integer as soft_commit_investor_count,
    coalesce(pr.pipeline_new_count, 0)::integer as pipeline_new_count,
    coalesce(pr.pipeline_contacted_count, 0)::integer as pipeline_contacted_count,
    coalesce(pr.pipeline_interested_count, 0)::integer as pipeline_interested_count,
    coalesce(pr.pipeline_negotiating_count, 0)::integer as pipeline_negotiating_count,
    coalesce(pr.pipeline_committed_count, 0)::integer as pipeline_committed_count,
    coalesce(pr.pipeline_passed_count, 0)::integer as pipeline_passed_count,
    coalesce(pr.pipeline_archived_count, 0)::integer as pipeline_archived_count
  from public.deals d
  cross join lateral (
    select to_jsonb(d) as deal_json
  ) as deal_data
  left join latest_terms lt
    on lt.deal_id = d.id
  left join latest_financial lf
    on lf.deal_id = d.id
  left join capital_rollup cr
    on cr.deal_id = d.id
  left join pipeline_rollup pr
    on pr.deal_id = d.id
)
select
  base.deal_id,
  base.capital_target,
  base.total_committed,
  base.total_soft_commit,
  case
    when base.capital_target is null then null
    else greatest(base.capital_target - base.total_committed, 0)
  end as remaining_capital,
  base.investor_count,
  base.committed_investor_count,
  base.soft_commit_investor_count,
  base.pipeline_new_count,
  base.pipeline_contacted_count,
  base.pipeline_interested_count,
  base.pipeline_negotiating_count,
  base.pipeline_committed_count,
  base.pipeline_passed_count,
  base.pipeline_archived_count,
  jsonb_build_object(
    'new', base.pipeline_new_count,
    'contacted', base.pipeline_contacted_count,
    'interested', base.pipeline_interested_count,
    'negotiating', base.pipeline_negotiating_count,
    'committed', base.pipeline_committed_count,
    'passed', base.pipeline_passed_count,
    'archived', base.pipeline_archived_count
  ) as pipeline_summary
from base;
