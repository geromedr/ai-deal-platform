create or replace function public.log_deal_status_transition(
  p_deal_id uuid,
  p_from_status text,
  p_to_status text,
  p_reason_code text,
  p_reason text,
  p_agent text default 'deal-status-workflow'
) returns void
language plpgsql
as $$
begin
  insert into public.ai_actions (deal_id, agent, action, payload, source)
  select
    p_deal_id,
    p_agent,
    'status_transition',
    jsonb_build_object(
      'from_status', p_from_status,
      'to_status', p_to_status,
      'reason_code', p_reason_code,
      'reason', p_reason
    ),
    'workflow_engine'
  where not exists (
    select 1
    from public.ai_actions existing
    where existing.deal_id = p_deal_id
      and existing.agent = p_agent
      and existing.action = 'status_transition'
      and coalesce(existing.payload ->> 'from_status', '') = coalesce(p_from_status, '')
      and coalesce(existing.payload ->> 'to_status', '') = coalesce(p_to_status, '')
      and coalesce(existing.payload ->> 'reason_code', '') = coalesce(p_reason_code, '')
  );
end;
$$;

create or replace function public.apply_deal_status_transition(
  p_deal_id uuid,
  p_new_status text,
  p_reason_code text,
  p_reason text,
  p_agent text default 'deal-status-workflow'
) returns boolean
language plpgsql
as $$
declare
  v_current_status text;
begin
  select lower(coalesce(status, 'active'))
  into v_current_status
  from public.deals
  where id = p_deal_id
  for update;

  if not found then
    return false;
  end if;

  if v_current_status = lower(coalesce(p_new_status, '')) then
    return false;
  end if;

  if lower(coalesce(p_new_status, '')) = 'reviewing' then
    if v_current_status not in ('new', 'active') then
      return false;
    end if;
  elsif lower(coalesce(p_new_status, '')) = 'approved' then
    if v_current_status not in ('active', 'reviewing') then
      return false;
    end if;
  elsif lower(coalesce(p_new_status, '')) = 'funded' then
    if v_current_status <> 'approved' then
      return false;
    end if;
  elsif lower(coalesce(p_new_status, '')) = 'completed' then
    if v_current_status <> 'funded' then
      return false;
    end if;
  elsif lower(coalesce(p_new_status, '')) <> 'active' then
    return false;
  end if;

  update public.deals
  set
    status = lower(p_new_status),
    updated_at = now()
  where id = p_deal_id;

  perform public.log_deal_status_transition(
    p_deal_id,
    v_current_status,
    lower(p_new_status),
    p_reason_code,
    p_reason,
    p_agent
  );

  return true;
end;
$$;

create or replace function public.handle_high_priority_deal_feed_transition()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.priority_score, 0) >= 85 or coalesce(new.score, 0) >= 80 then
    perform public.apply_deal_status_transition(
      new.deal_id,
      'reviewing',
      'high_priority_deal_feed',
      'Auto-moved to reviewing because a high_priority deal feed entry was persisted.'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_high_priority_deal_feed_transition on public.deal_feed;

create trigger trg_high_priority_deal_feed_transition
after insert or update of score, priority_score on public.deal_feed
for each row
execute function public.handle_high_priority_deal_feed_transition();

create or replace function public.handle_task_completion_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_deal_id uuid;
  v_total_tasks integer;
  v_open_tasks integer;
begin
  v_deal_id := coalesce(new.deal_id, old.deal_id);

  if v_deal_id is null then
    return coalesce(new, old);
  end if;

  select count(*)
  into v_total_tasks
  from public.tasks
  where deal_id = v_deal_id;

  if v_total_tasks = 0 then
    return coalesce(new, old);
  end if;

  select count(*)
  into v_open_tasks
  from public.tasks
  where deal_id = v_deal_id
    and lower(coalesce(status, 'open')) not in ('closed', 'resolved', 'done', 'completed', 'cancelled');

  if v_open_tasks = 0 then
    perform public.apply_deal_status_transition(
      v_deal_id,
      'approved',
      'tasks_completed',
      'Auto-moved to approved because all tasks are completed.'
    );
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_task_completion_status_transition on public.tasks;

create trigger trg_task_completion_status_transition
after insert or update of status on public.tasks
for each row
execute function public.handle_task_completion_status_transition();
