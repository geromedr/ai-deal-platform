-- Build 1: realtime deal feed updates
-- Adds stored priority scores plus realtime broadcast support for deal_feed changes.

alter table public.deal_feed
  add column if not exists priority_score numeric(14,2);

create table if not exists public.deal_feed_realtime_fallback (
  deal_id uuid not null,
  priority_score numeric(14,2),
  change_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_deal_feed_realtime_fallback_created_at
  on public.deal_feed_realtime_fallback (created_at desc);

do $$
begin
  begin
    alter publication supabase_realtime add table public.deal_feed_realtime_fallback;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end
$$;

create or replace function public.broadcast_deal_feed_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_payload jsonb;
  old_payload jsonb;
  change_type text;
begin
  change_type := case when tg_op = 'INSERT' then 'created' else 'updated' end;

  new_payload := jsonb_build_object(
    'deal_id', new.deal_id,
    'priority_score', new.priority_score,
    'change_type', change_type
  );

  old_payload := case
    when tg_op = 'UPDATE' then jsonb_build_object(
      'deal_id', old.deal_id,
      'priority_score', old.priority_score,
      'change_type', 'updated'
    )
    else '{}'::jsonb
  end;

  if tg_op = 'UPDATE' and new_payload = old_payload then
    return new;
  end if;

  begin
    execute
      'select realtime.broadcast_changes($1, $2, $3, $4, $5, $6, $7)'
    using
      'deal-feed',
      'deal_feed_change',
      tg_op,
      tg_table_name,
      tg_table_schema,
      new_payload,
      old_payload;
  exception
    when undefined_function then
      insert into public.deal_feed_realtime_fallback (deal_id, priority_score, change_type)
      values (new.deal_id, new.priority_score, change_type);
    when invalid_schema_name then
      insert into public.deal_feed_realtime_fallback (deal_id, priority_score, change_type)
      values (new.deal_id, new.priority_score, change_type);
  end;

  return new;
end;
$$;

drop trigger if exists broadcast_deal_feed_change on public.deal_feed;
create trigger broadcast_deal_feed_change
after insert or update on public.deal_feed
for each row
execute function public.broadcast_deal_feed_change();
