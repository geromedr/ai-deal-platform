create table if not exists public.usage_metrics (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  calls integer not null default 1 check (calls >= 0),
  estimated_cost numeric not null default 0 check (estimated_cost >= 0),
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_usage_metrics_agent_timestamp
  on public.usage_metrics (agent_name, timestamp desc);

create index if not exists idx_usage_metrics_timestamp
  on public.usage_metrics (timestamp desc);

drop trigger if exists set_usage_metrics_updated_at on public.usage_metrics;
create trigger set_usage_metrics_updated_at
before update on public.usage_metrics
for each row
execute function public.set_updated_at();

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  setting_key text not null unique default 'global',
  system_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.system_settings (setting_key, system_enabled, metadata)
values ('global', true, '{}'::jsonb)
on conflict (setting_key) do nothing;

drop trigger if exists set_system_settings_updated_at on public.system_settings;
create trigger set_system_settings_updated_at
before update on public.system_settings
for each row
execute function public.set_updated_at();

create table if not exists public.agent_rate_limits (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null unique,
  max_calls_per_hour integer not null default 120 check (max_calls_per_hour >= 0),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_rate_limits_enabled
  on public.agent_rate_limits (enabled, max_calls_per_hour);

drop trigger if exists set_agent_rate_limits_updated_at on public.agent_rate_limits;
create trigger set_agent_rate_limits_updated_at
before update on public.agent_rate_limits
for each row
execute function public.set_updated_at();
