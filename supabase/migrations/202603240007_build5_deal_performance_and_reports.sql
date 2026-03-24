-- Build 1-4: deal performance metrics, leaderboard, and weekly reporting support

create table if not exists public.deal_performance (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  views integer not null default 0,
  notifications_sent integer not null default 0,
  actions_taken integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_deal_performance_deal_id
  on public.deal_performance (deal_id);

create or replace function public.increment_deal_performance_metrics(
  p_deal_id uuid,
  p_views integer default 0,
  p_notifications_sent integer default 0,
  p_actions_taken integer default 0,
  p_mark_viewed boolean default false
)
returns public.deal_performance
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.deal_performance;
begin
  insert into public.deal_performance (
    deal_id,
    views,
    notifications_sent,
    actions_taken,
    last_viewed_at
  )
  values (
    p_deal_id,
    greatest(coalesce(p_views, 0), 0),
    greatest(coalesce(p_notifications_sent, 0), 0),
    greatest(coalesce(p_actions_taken, 0), 0),
    case when p_mark_viewed then now() else null end
  )
  on conflict (deal_id)
  do update
  set
    views = public.deal_performance.views + greatest(coalesce(p_views, 0), 0),
    notifications_sent = public.deal_performance.notifications_sent + greatest(coalesce(p_notifications_sent, 0), 0),
    actions_taken = public.deal_performance.actions_taken + greatest(coalesce(p_actions_taken, 0), 0),
    last_viewed_at = case
      when p_mark_viewed then now()
      else public.deal_performance.last_viewed_at
    end
  returning * into v_row;

  return v_row;
end;
$$;
