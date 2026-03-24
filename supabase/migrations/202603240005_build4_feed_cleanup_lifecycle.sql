-- Build 4: feed cleanup and lifecycle management

alter table public.deal_feed
  add column if not exists stale_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.deal_feed
  alter column status set default 'active';

update public.deal_feed
set status = 'active'
where status is null or status = 'pending';

create index if not exists idx_deal_feed_status_priority_updated
  on public.deal_feed (status, priority_score desc, updated_at desc);

create or replace function public.run_deal_feed_cleanup(
  stale_after_days integer default 14,
  archive_after_days integer default 30,
  archive_below_priority numeric default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale_count integer := 0;
  archived_count integer := 0;
  fallback_cleanup_count integer := 0;
begin
  update public.deal_feed
  set
    status = 'stale',
    stale_at = coalesce(stale_at, now()),
    updated_at = now()
  where status in ('active', 'pending')
    and coalesce(updated_at, created_at) < now() - make_interval(days => greatest(stale_after_days, 1));

  get diagnostics stale_count = row_count;

  update public.deal_feed
  set
    status = 'archived',
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
  where status in ('stale', 'active', 'pending')
    and coalesce(priority_score, score, 0) < archive_below_priority
    and coalesce(updated_at, created_at) < now() - make_interval(days => greatest(archive_after_days, 1));

  get diagnostics archived_count = row_count;

  delete from public.deal_feed_realtime_fallback
  where created_at < now() - interval '7 days';

  get diagnostics fallback_cleanup_count = row_count;

  return jsonb_build_object(
    'stale_count', stale_count,
    'archived_count', archived_count,
    'fallback_cleanup_count', fallback_cleanup_count
  );
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'cron'
  ) then
    begin
      perform cron.unschedule('deal-feed-cleanup');
    exception
      when invalid_parameter_value then null;
      when undefined_function then null;
    end;

    begin
      perform cron.schedule(
        'deal-feed-cleanup',
        '0 */6 * * *',
        $job$select public.run_deal_feed_cleanup();$job$
      );
    exception
      when undefined_function then null;
    end;
  end if;
end
$$;
