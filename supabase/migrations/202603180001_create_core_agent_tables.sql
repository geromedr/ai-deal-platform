create extension if not exists pgcrypto;
create extension if not exists vector;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  suburb text,
  state text,
  postcode text,
  status text not null default 'new',
  stage text not null default 'opportunity',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_threads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  subject text not null,
  participants text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  thread_id uuid references public.email_threads(id) on delete set null,
  sender text,
  recipients text,
  subject text,
  message_summary text,
  body text,
  direction text,
  sent_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  title text not null,
  description text,
  assigned_to text,
  due_date date,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  category text,
  amount numeric(14,2),
  gdv numeric(14,2),
  tdc numeric(14,2),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risks (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  title text not null,
  description text,
  severity text not null default 'medium',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  title text not null,
  due_date date,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  agent text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_action_rules (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  stage text not null,
  rule_description text not null,
  action_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_name, stage)
);

create table if not exists public.site_intelligence (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete cascade,
  address text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  zoning text,
  lep text,
  height_limit text,
  fsr text,
  site_area numeric(12,2),
  flood_risk text,
  source_layer text,
  source_attributes jsonb not null default '{}'::jsonb,
  estimated_gfa numeric(14,2),
  estimated_units integer,
  estimated_revenue numeric(14,2),
  estimated_build_cost numeric(14,2),
  estimated_profit numeric(14,2),
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_candidates (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  address text not null,
  suburb text,
  state text,
  postcode text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  price_text text,
  property_type text,
  land_area numeric(12,2),
  url text,
  headline text,
  raw_data jsonb not null default '{}'::jsonb,
  zoning text,
  height_limit text,
  fsr text,
  estimated_units integer,
  discovery_score integer not null default 0,
  discovery_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  category text,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tasks_deal_id_created_at
  on public.tasks (deal_id, created_at desc);

create index if not exists idx_communications_deal_id_sent_at
  on public.communications (deal_id, sent_at desc);

create index if not exists idx_financial_snapshots_deal_id_created_at
  on public.financial_snapshots (deal_id, created_at desc);

create index if not exists idx_risks_deal_id_created_at
  on public.risks (deal_id, created_at desc);

create index if not exists idx_milestones_deal_id_created_at
  on public.milestones (deal_id, created_at desc);

create index if not exists idx_ai_actions_deal_id_created_at
  on public.ai_actions (deal_id, created_at desc);

create index if not exists idx_site_candidates_score
  on public.site_candidates (discovery_score desc, created_at desc);

create index if not exists idx_knowledge_chunks_category
  on public.knowledge_chunks (category, created_at desc);

create or replace function public.match_knowledge_chunks(
  query_embedding vector(1536),
  match_count integer default 5
)
returns table (
  id uuid,
  source_name text,
  category text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    knowledge_chunks.id,
    knowledge_chunks.source_name,
    knowledge_chunks.category,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks
  where knowledge_chunks.embedding is not null
  order by knowledge_chunks.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

create or replace function public.match_knowledge_chunks_by_category(
  query_embedding vector(1536),
  match_count integer default 5,
  filter_category text default null
)
returns table (
  id uuid,
  source_name text,
  category text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    knowledge_chunks.id,
    knowledge_chunks.source_name,
    knowledge_chunks.category,
    knowledge_chunks.content,
    1 - (knowledge_chunks.embedding <=> query_embedding) as similarity
  from public.knowledge_chunks
  where knowledge_chunks.embedding is not null
    and (filter_category is null or knowledge_chunks.category = filter_category)
  order by knowledge_chunks.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

create or replace view public.deal_activity_feed as
select
  id,
  deal_id,
  'task'::text as activity_type,
  title as headline,
  description as detail,
  status,
  created_at
from public.tasks
union all
select
  id,
  deal_id,
  'communication'::text as activity_type,
  coalesce(subject, sender, 'communication') as headline,
  coalesce(message_summary, body) as detail,
  coalesce(direction, 'logged') as status,
  created_at
from public.communications
union all
select
  id,
  deal_id,
  'risk'::text as activity_type,
  title as headline,
  description as detail,
  severity as status,
  created_at
from public.risks
union all
select
  id,
  deal_id,
  'milestone'::text as activity_type,
  title as headline,
  null::text as detail,
  status,
  created_at
from public.milestones
union all
select
  id,
  deal_id,
  'financial_snapshot'::text as activity_type,
  coalesce(category, 'financial_snapshot') as headline,
  notes as detail,
  null::text as status,
  created_at
from public.financial_snapshots
union all
select
  id,
  deal_id,
  'ai_action'::text as activity_type,
  agent as headline,
  action as detail,
  source as status,
  created_at
from public.ai_actions;

drop trigger if exists set_deals_updated_at on public.deals;
create trigger set_deals_updated_at
before update on public.deals
for each row
execute function public.set_updated_at();

drop trigger if exists set_email_threads_updated_at on public.email_threads;
create trigger set_email_threads_updated_at
before update on public.email_threads
for each row
execute function public.set_updated_at();

drop trigger if exists set_communications_updated_at on public.communications;
create trigger set_communications_updated_at
before update on public.communications
for each row
execute function public.set_updated_at();

drop trigger if exists set_tasks_updated_at on public.tasks;
create trigger set_tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

drop trigger if exists set_financial_snapshots_updated_at on public.financial_snapshots;
create trigger set_financial_snapshots_updated_at
before update on public.financial_snapshots
for each row
execute function public.set_updated_at();

drop trigger if exists set_risks_updated_at on public.risks;
create trigger set_risks_updated_at
before update on public.risks
for each row
execute function public.set_updated_at();

drop trigger if exists set_milestones_updated_at on public.milestones;
create trigger set_milestones_updated_at
before update on public.milestones
for each row
execute function public.set_updated_at();

drop trigger if exists set_agent_action_rules_updated_at on public.agent_action_rules;
create trigger set_agent_action_rules_updated_at
before update on public.agent_action_rules
for each row
execute function public.set_updated_at();

drop trigger if exists set_site_intelligence_updated_at on public.site_intelligence;
create trigger set_site_intelligence_updated_at
before update on public.site_intelligence
for each row
execute function public.set_updated_at();

drop trigger if exists set_site_candidates_updated_at on public.site_candidates;
create trigger set_site_candidates_updated_at
before update on public.site_candidates
for each row
execute function public.set_updated_at();

drop trigger if exists set_knowledge_chunks_updated_at on public.knowledge_chunks;
create trigger set_knowledge_chunks_updated_at
before update on public.knowledge_chunks
for each row
execute function public.set_updated_at();
