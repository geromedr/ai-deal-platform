insert into public.deals (
  id,
  address,
  suburb,
  state,
  postcode,
  status,
  stage,
  source,
  metadata
)
values (
  '11111111-1111-1111-1111-111111111111',
  '12 Marine Parade, Kingscliff NSW 2487',
  'Kingscliff',
  'NSW',
  '2487',
  'active',
  'opportunity',
  'seed',
  '{"label":"Primary integration test deal"}'::jsonb
)
on conflict (id) do update
set
  address = excluded.address,
  suburb = excluded.suburb,
  state = excluded.state,
  postcode = excluded.postcode,
  status = excluded.status,
  stage = excluded.stage,
  source = excluded.source,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.site_intelligence (
  deal_id,
  address,
  latitude,
  longitude,
  zoning,
  lep,
  height_limit,
  fsr,
  site_area,
  flood_risk,
  estimated_gfa,
  estimated_units,
  estimated_revenue,
  estimated_build_cost,
  estimated_profit
)
values (
  '11111111-1111-1111-1111-111111111111',
  '12 Marine Parade, Kingscliff NSW 2487',
  -28.2580000,
  153.5750000,
  'R3 Medium Density Residential',
  'Tweed Local Environmental Plan 2014',
  '13m',
  '1.8:1',
  1200,
  'Low',
  2160,
  24,
  23760000,
  9072000,
  14688000
)
on conflict (deal_id) do update
set
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  zoning = excluded.zoning,
  lep = excluded.lep,
  height_limit = excluded.height_limit,
  fsr = excluded.fsr,
  site_area = excluded.site_area,
  flood_risk = excluded.flood_risk,
  estimated_gfa = excluded.estimated_gfa,
  estimated_units = excluded.estimated_units,
  estimated_revenue = excluded.estimated_revenue,
  estimated_build_cost = excluded.estimated_build_cost,
  estimated_profit = excluded.estimated_profit,
  updated_at = now();

insert into public.email_threads (
  id,
  deal_id,
  subject,
  participants,
  last_message_at
)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Potential development site',
  'agent@example.com',
  '2026-03-19T09:00:00Z'
)
on conflict (id) do update
set
  subject = excluded.subject,
  participants = excluded.participants,
  last_message_at = excluded.last_message_at,
  updated_at = now();

insert into public.communications (
  deal_id,
  thread_id,
  sender,
  recipients,
  subject,
  message_summary,
  body,
  direction,
  sent_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'agent@example.com',
  'deals@example.com',
  'Potential development site',
  'Agent shared a medium-density coastal site for review.',
  'Please review the site and confirm zoning, planning constraints, and pricing assumptions.',
  'inbound',
  '2026-03-19T09:00:00Z'
)
on conflict do nothing;

insert into public.tasks (
  deal_id,
  title,
  description,
  assigned_to,
  due_date,
  status
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Review zoning controls',
  'Confirm zoning, FSR, and height controls for the subject site.',
  'acquisitions',
  '2026-03-29',
  'open'
)
on conflict do nothing;

insert into public.financial_snapshots (
  deal_id,
  category,
  amount,
  gdv,
  tdc,
  notes
)
values (
  '11111111-1111-1111-1111-111111111111',
  'feasibility',
  14688000,
  23760000,
  9072000,
  'Seed feasibility snapshot for agent testing.'
)
on conflict do nothing;

insert into public.comparable_sales_estimates (
  id,
  deal_id,
  subject_address,
  suburb,
  state,
  postcode,
  radius_km,
  dwelling_type,
  estimated_sale_price_per_sqm,
  currency,
  rationale,
  model_name,
  knowledge_context,
  raw_output,
  status
)
values (
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  '12 Marine Parade, Kingscliff NSW 2487',
  'Kingscliff',
  'NSW',
  '2487',
  5,
  'apartment',
  12500,
  'AUD',
  'Seed comparable pricing for local feasibility validation.',
  'seed-data',
  '[]'::jsonb,
  '{"source":"seed"}'::jsonb,
  'completed'
)
on conflict (id) do update
set
  deal_id = excluded.deal_id,
  subject_address = excluded.subject_address,
  suburb = excluded.suburb,
  state = excluded.state,
  postcode = excluded.postcode,
  radius_km = excluded.radius_km,
  dwelling_type = excluded.dwelling_type,
  estimated_sale_price_per_sqm = excluded.estimated_sale_price_per_sqm,
  currency = excluded.currency,
  rationale = excluded.rationale,
  model_name = excluded.model_name,
  knowledge_context = excluded.knowledge_context,
  raw_output = excluded.raw_output,
  status = excluded.status,
  updated_at = now();

insert into public.risks (
  deal_id,
  title,
  description,
  severity,
  status
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Flood planning review',
  'Confirm whether coastal flooding overlays create design or floor-level constraints.',
  'medium',
  'open'
)
on conflict do nothing;

insert into public.milestones (
  deal_id,
  title,
  due_date,
  status
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Complete initial feasibility review',
  '2026-04-05',
  'pending'
)
on conflict do nothing;

insert into public.agent_action_rules (
  agent_name,
  stage,
  rule_description,
  action_schema
)
values
  (
    'ai-agent',
    'opportunity',
    'Allow AI to recommend tasks, risk logs, communications, stage updates, milestones, and financial snapshots during early deal review.',
    '{"allowed_actions":["task_create","risk_log","log_communication","deal_stage_update","milestone_create","financial_snapshot_add"]}'::jsonb
  ),
  (
    'agent-orchestrator',
    'opportunity',
    'Execute structured actions returned by ai-agent for active opportunity-stage deals.',
    '{"allowed_actions":["task_create","risk_log","log_communication","deal_stage_update","milestone_create","financial_snapshot_add"]}'::jsonb
  ),
  (
    'rule-engine-agent',
    'post-ranking',
    'Evaluate post-ranking orchestration rules and trigger downstream agents in priority order.',
    '{"rules":[{"name":"generate-report-for-a-tier-sites","event":"post-ranking","condition":"score >= 75","action":"deal-report-agent","priority":1}]}'::jsonb
  ),
  (
    'rule-engine-agent',
    'post-intelligence',
    'Run deeper analysis or log risks after planning intelligence completes.',
    '{"rules":[{"name":"high-density-follow-up","event":"post-intelligence","condition":"zoning_density == \"high-density\"","action":"create-task","priority":1,"payload":{"title":"Run deeper high-density analysis","description":"High-density zoning detected during post-intelligence orchestration. Review planning controls, comparable evidence, and downstream feasibility assumptions.","assigned_to":"acquisitions"}},{"name":"high-flood-risk-log","event":"post-intelligence","condition":"flood_risk != null AND flood_risk == \"High\"","action":"agent-orchestrator","priority":2,"payload":{"summary":"Log flood risk raised by post-intelligence rule.","actions":[{"action":"risk_log","details":{"title":"High flood risk identified","description":"Post-intelligence rule detected a high flood risk classification and escalated the site for review.","severity":"high"}}]}}]}'::jsonb
  ),
  (
    'rule-engine-agent',
    'post-discovery',
    'Reserved workflow slot for post-discovery orchestration rules.',
    '{"rules":[]}'::jsonb
  ),
  (
    'rule-engine-agent',
    'post-financial',
    'Trigger reporting for strong margins and log risks for weak margins.',
    '{"rules":[{"name":"strong-margin-report","event":"post-financial","condition":"financials != null AND financials > 0.2","action":"deal-report-agent","priority":1},{"name":"thin-margin-risk-log","event":"post-financial","condition":"financials != null AND financials < 0.1","action":"agent-orchestrator","priority":2,"payload":{"summary":"Log thin-margin feasibility risk.","actions":[{"action":"risk_log","details":{"title":"Thin development margin","description":"Post-financial rule detected margin below 10 percent and logged a risk for acquisitions review.","severity":"medium"}}]}}]}'::jsonb
  )
on conflict (agent_name, stage) do update
set
  rule_description = excluded.rule_description,
  action_schema = excluded.action_schema,
  updated_at = now();
