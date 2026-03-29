begin;

do $$
declare
  v_deal_id constant uuid := '11111111-1111-1111-1111-111111111111';
  v_insert_columns text;
  v_insert_values text;
  v_update_clause text;
begin
  select
    string_agg(format('%I', column_name), ', ' order by ordinal_position),
    string_agg(
      case column_name
        when 'id' then quote_literal(v_deal_id::text)
        when 'deal_name' then quote_literal('Validation Seed Deal')
        when 'address' then quote_literal('12 Marine Parade')
        when 'city' then quote_literal('Kingscliff')
        when 'state' then quote_literal('NSW')
        when 'postcode' then quote_literal('2487')
        when 'country' then quote_literal('Australia')
        when 'strategy' then quote_literal('hold-and-develop')
        when 'target_margin' then '0.18'
        when 'site_area' then '1200'
      end,
      ', ' order by ordinal_position
    ),
    string_agg(
      case
        when column_name = 'id' then null
        else format('%1$I = excluded.%1$I', column_name)
      end,
      ', ' order by ordinal_position
    )
  into v_insert_columns, v_insert_values, v_update_clause
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'deals'
    and column_name in (
      'id',
      'deal_name',
      'address',
      'city',
      'state',
      'postcode',
      'country',
      'strategy',
      'target_margin',
      'site_area'
    );

  if v_insert_columns is null or position('id' in v_insert_columns) = 0 then
    raise exception 'public.deals is missing required id column';
  end if;

  execute format(
    'insert into public.deals (%s) values (%s) on conflict (id) do update set %s',
    v_insert_columns,
    v_insert_values,
    coalesce(v_update_clause, 'id = excluded.id')
  );
end
$$;

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
  notes
)
values
  (
    '22222222-2222-2222-2222-222222222222',
    'Harbour Capital',
    'fund',
    1000000,
    5000000,
    array['hold-and-develop'],
    'opportunistic',
    array['NSW'],
    array['Kingscliff'],
    18,
    'active',
    'Seed investor for validation.'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Coastline Family Office',
    'family_office',
    500000,
    2500000,
    array['hold-and-develop'],
    'balanced',
    array['NSW'],
    array[]::text[],
    15,
    'active',
    'Secondary seed investor for validation.'
  )
on conflict (id) do update
set
  investor_name = excluded.investor_name,
  investor_type = excluded.investor_type,
  capital_min = excluded.capital_min,
  capital_max = excluded.capital_max,
  preferred_strategies = excluded.preferred_strategies,
  risk_profile = excluded.risk_profile,
  preferred_states = excluded.preferred_states,
  preferred_suburbs = excluded.preferred_suburbs,
  min_target_margin_pct = excluded.min_target_margin_pct,
  status = excluded.status,
  notes = excluded.notes;

insert into public.deal_investors (
  id,
  deal_id,
  investor_id,
  relationship_stage,
  notes
)
values
  (
    '44444444-4444-4444-4444-444444444444',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'new',
    'Seed relationship for validation.'
  ),
  (
    '55555555-5555-5555-5555-555555555555',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'interested',
    'Seed relationship for validation.'
  )
on conflict (deal_id, investor_id) do update
set
  relationship_stage = excluded.relationship_stage,
  notes = excluded.notes;

insert into public.deal_terms (
  id,
  deal_id,
  sponsor_fee_pct,
  equity_split,
  preferred_return_pct,
  notes
)
values (
  '66666666-6666-6666-6666-666666666666',
  '11111111-1111-1111-1111-111111111111',
  2,
  '{"investor_pct": 80, "sponsor_pct": 20}'::jsonb,
  8,
  'Seed terms for validation.'
)
on conflict (deal_id) do update
set
  sponsor_fee_pct = excluded.sponsor_fee_pct,
  equity_split = excluded.equity_split,
  preferred_return_pct = excluded.preferred_return_pct,
  notes = excluded.notes;

insert into public.investor_deal_pipeline (
  id,
  deal_id,
  investor_id,
  pipeline_status,
  last_contacted_at,
  next_follow_up_at,
  notes
)
values
  (
    '77777777-7777-7777-7777-777777777777',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    'new',
    '2026-03-20T09:00:00Z',
    '2026-04-03T09:00:00Z',
    'Initial outreach queued.'
  ),
  (
    '88888888-8888-8888-8888-888888888888',
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    'interested',
    '2026-03-22T11:00:00Z',
    '2026-04-05T11:00:00Z',
    'Investor requested more detail.'
  )
on conflict (deal_id, investor_id) do update
set
  pipeline_status = excluded.pipeline_status,
  last_contacted_at = excluded.last_contacted_at,
  next_follow_up_at = excluded.next_follow_up_at,
  notes = excluded.notes;

insert into public.investor_communications (
  id,
  investor_id,
  deal_id,
  communication_type,
  direction,
  subject,
  summary,
  status,
  communicated_at
)
values (
  '99999999-9999-9999-9999-999999999999',
  '33333333-3333-3333-3333-333333333333',
  '11111111-1111-1111-1111-111111111111',
  'email',
  'outbound',
  'Validation seed outreach',
  'Seed outreach logged for deal context validation.',
  'sent',
  '2026-03-22T11:00:00Z'
)
on conflict (id) do update
set
  investor_id = excluded.investor_id,
  deal_id = excluded.deal_id,
  communication_type = excluded.communication_type,
  direction = excluded.direction,
  subject = excluded.subject,
  summary = excluded.summary,
  status = excluded.status,
  communicated_at = excluded.communicated_at;

insert into public.deal_capital_allocations (
  id,
  deal_id,
  investor_id,
  committed_amount,
  allocation_pct,
  status,
  notes
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  '33333333-3333-3333-3333-333333333333',
  750000,
  25,
  'soft_commit',
  'Seed soft commitment for validation.'
)
on conflict (deal_id, investor_id) do update
set
  committed_amount = excluded.committed_amount,
  allocation_pct = excluded.allocation_pct,
  status = excluded.status,
  notes = excluded.notes;

commit;
