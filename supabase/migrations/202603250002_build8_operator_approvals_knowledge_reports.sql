create table if not exists public.approval_queue (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  approval_type text not null,
  status text not null default 'pending',
  requested_by_agent text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

create table if not exists public.deal_knowledge_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  document_type text not null,
  source_ref text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.report_index (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  report_type text not null,
  source_agent text not null,
  source_action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_approval_queue_status_created_at
  on public.approval_queue (status, created_at desc);

create index if not exists idx_approval_queue_deal_id_created_at
  on public.approval_queue (deal_id, created_at desc);

create index if not exists idx_deal_knowledge_links_deal_id_created_at
  on public.deal_knowledge_links (deal_id, created_at desc);

create index if not exists idx_report_index_deal_type_created_at
  on public.report_index (deal_id, report_type, created_at desc);

create index if not exists idx_report_index_type_created_at
  on public.report_index (report_type, created_at desc);

drop trigger if exists set_approval_queue_updated_at on public.approval_queue;
create trigger set_approval_queue_updated_at
before update on public.approval_queue
for each row
execute function public.set_updated_at();
