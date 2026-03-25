create table if not exists public.agent_registry (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  version text not null default '2026-03-25',
  status text not null default 'active',
  last_run timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_name)
);

create table if not exists public.system_health (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  status text not null,
  last_checked timestamptz not null default now(),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (component)
);

create table if not exists public.agent_retry_queue (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  operation text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  last_error text,
  next_retry_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

alter table public.ai_actions
  add column if not exists execution_time_ms integer,
  add column if not exists success boolean,
  add column if not exists error_context jsonb;

update public.ai_actions
set
  execution_time_ms = coalesce(execution_time_ms, 0),
  success = coalesce(success, true),
  error_context = coalesce(error_context, '{}'::jsonb)
where execution_time_ms is null
   or success is null
   or error_context is null;

create index if not exists idx_agent_registry_status_last_run
  on public.agent_registry (status, last_run desc);

create index if not exists idx_system_health_status_last_checked
  on public.system_health (status, last_checked desc);

create index if not exists idx_agent_retry_queue_status_next_retry
  on public.agent_retry_queue (status, next_retry_at asc);

create index if not exists idx_ai_actions_agent_action_created_at
  on public.ai_actions (agent, action, created_at desc);

create or replace function public.sync_agent_registry_from_ai_actions()
returns trigger
language plpgsql
as $$
begin
  insert into public.agent_registry (
    agent_name,
    version,
    status,
    last_run,
    last_error
  )
  values (
    new.agent,
    coalesce(new.payload ->> 'version', '2026-03-25'),
    case when coalesce(new.success, true) then 'active' else 'error' end,
    new.created_at,
    case
      when new.error_context is null then null
      when jsonb_typeof(new.error_context) = 'object' then coalesce(new.error_context ->> 'message', new.error_context::text)
      else new.error_context::text
    end
  )
  on conflict (agent_name) do update
  set
    version = excluded.version,
    status = excluded.status,
    last_run = excluded.last_run,
    last_error = excluded.last_error,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_agent_registry_from_ai_actions on public.ai_actions;
create trigger sync_agent_registry_from_ai_actions
after insert on public.ai_actions
for each row
execute function public.sync_agent_registry_from_ai_actions();

drop trigger if exists set_agent_registry_updated_at on public.agent_registry;
create trigger set_agent_registry_updated_at
before update on public.agent_registry
for each row
execute function public.set_updated_at();

drop trigger if exists set_system_health_updated_at on public.system_health;
create trigger set_system_health_updated_at
before update on public.system_health
for each row
execute function public.set_updated_at();

drop trigger if exists set_agent_retry_queue_updated_at on public.agent_retry_queue;
create trigger set_agent_retry_queue_updated_at
before update on public.agent_retry_queue
for each row
execute function public.set_updated_at();
