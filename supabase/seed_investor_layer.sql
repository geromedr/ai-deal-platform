begin;

insert into public.deals (
  id,
  deal_name,
  address,
  city,
  state,
  postcode,
  country,
  strategy,
  target_margin,
  site_area,
  status,
  stage
)
values (
  '11111111-1111-1111-1111-111111111111',
  'Kingscliff Investor Layer Seed Deal',
  '12 Marine Parade',
  'Kingscliff',
  'NSW',
  '2487',
  'Australia',
  'hold-and-develop',
  0.18,
  1200,
  'active',
  'opportunity'
)
on conflict (id) do nothing;

insert into public.investors (
  id,
  investor_name,
  investor_type,
  capital_min,
  capital_max,
  preferred_strategies,
  risk_profile,
  preferred_states,
  preferred_suburbs,
  min_target_margin_pct,
  status,
  notes,
  metadata,
  created_at,
  updated_at
)
values
  (
    '22222222-2222-2222-2222-222222222222',
    'Harbour Capital',
    'fund',
    1000000,
    5000000,
    array['hold-and-develop']::text[],
    'opportunistic',
    array['NSW']::text[],
    array['Kingscliff']::text[],
    18,
    'active',
    'Hard seed investor for get-deal validation.',
    '{"seed":"hard","role":"lead-investor"}'::jsonb,
    '2026-03-29T00:00:00Z',
    '2026-03-29T00:00:00Z'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Coastline Family Office',
    'family_office',
    500000,
    2500000,
    array['hold-and-develop']::text[],
    'balanced',
    array['NSW']::text[],
    array['Kingscliff']::text[],
    15,
    'active',
    'Hard seed investor for get-deal validation.',
    '{"seed":"hard","role":"co-investor"}'::jsonb,
    '2026-03-29T00:01:00Z',
    '2026-03-29T00:01:00Z'
  )
on conflict (id) do nothing;

insert into public.deal_investors (
  id,
  deal_id,
  investor_id,
  relationship_stage,
  notes,
  metadata,
  created_at,
  updated_at
)
values
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'contacted',
    'Lead investor linked to seed deal.',
    '{"seed":"hard","source":"seed_investor_layer.sql"}'::jsonb,
    '2026-03-29T00:02:00Z',
    '2026-03-29T00:02:00Z'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'interested',
    'Co-investor linked to seed deal.',
    '{"seed":"hard","source":"seed_investor_layer.sql"}'::jsonb,
    '2026-03-29T00:03:00Z',
    '2026-03-29T00:03:00Z'
  )
on conflict (deal_id, investor_id) do nothing;

insert into public.deal_terms (
  id,
  deal_id,
  sponsor_fee_pct,
  equity_split,
  preferred_return_pct,
  notes,
  metadata,
  created_at,
  updated_at
)
values (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  2,
  '{"investor_pct":80,"sponsor_pct":20}'::jsonb,
  8,
  'Hard seed terms for investor layer validation.',
  '{"equity_required":2000000,"target_raise":2000000,"deal_size":2000000,"target_margin_pct":18}'::jsonb,
  '2026-03-29T00:04:00Z',
  '2026-03-29T00:04:00Z'
)
on conflict (deal_id) do nothing;

insert into public.investor_deal_pipeline (
  id,
  deal_id,
  investor_id,
  pipeline_status,
  last_contacted_at,
  next_follow_up_at,
  notes,
  metadata,
  created_at,
  updated_at
)
values
  (
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'contacted',
    '2026-03-29T09:00:00Z',
    '2026-04-02T09:00:00Z',
    'Introductory call completed; investment memo requested.',
    '{"seed":"hard","owner":"capital-team"}'::jsonb,
    '2026-03-29T00:05:00Z',
    '2026-03-29T00:05:00Z'
  ),
  (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'interested',
    '2026-03-29T10:00:00Z',
    '2026-04-04T10:00:00Z',
    'Follow-up pack sent and under review.',
    '{"seed":"hard","owner":"capital-team"}'::jsonb,
    '2026-03-29T00:06:00Z',
    '2026-03-29T00:06:00Z'
  )
on conflict (deal_id, investor_id) do nothing;

insert into public.investor_communications (
  id,
  investor_id,
  deal_id,
  communication_type,
  direction,
  subject,
  summary,
  status,
  metadata,
  communicated_at,
  created_at,
  updated_at
)
values
  (
    '99999999-9999-9999-9999-999999999999',
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'call',
    'outbound',
    'Seed investor intro call',
    'Discussed deal overview, target raise, and next-step diligence items.',
    'logged',
    '{"seed":"hard","channel":"phone"}'::jsonb,
    '2026-03-29T09:15:00Z',
    '2026-03-29T00:07:00Z',
    '2026-03-29T00:07:00Z'
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '33333333-3333-3333-3333-333333333333',
    '11111111-1111-1111-1111-111111111111',
    'email',
    'outbound',
    'Seed investor follow-up email',
    'Sent the deal pack and requested soft-circle feedback on timing and cheque size.',
    'sent',
    '{"seed":"hard","channel":"email"}'::jsonb,
    '2026-03-29T10:10:00Z',
    '2026-03-29T00:08:00Z',
    '2026-03-29T00:08:00Z'
  )
on conflict (id) do nothing;

insert into public.deal_capital_allocations (
  id,
  deal_id,
  investor_id,
  committed_amount,
  allocation_pct,
  status,
  notes,
  metadata,
  created_at,
  updated_at
)
values
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    1000000,
    50,
    'hard_commit',
    'Hard-seeded lead commitment.',
    '{"seed":"hard","priority":"lead"}'::jsonb,
    '2026-03-29T00:09:00Z',
    '2026-03-29T00:09:00Z'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    500000,
    25,
    'soft_commit',
    'Hard-seeded soft commitment.',
    '{"seed":"hard","priority":"co-investor"}'::jsonb,
    '2026-03-29T00:10:00Z',
    '2026-03-29T00:10:00Z'
  )
on conflict (deal_id, investor_id) do nothing;

commit;
