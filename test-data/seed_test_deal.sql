-- ============================================================
-- TEST DEAL SEED — run in Supabase SQL Editor
-- Creates a realistic Melbourne development site for pipeline testing.
-- Safe to re-run (uses ON CONFLICT DO NOTHING).
-- ============================================================

-- 1. Insert into deals table (the feed reads from here)
--    Note: omits the 'metadata' column which is not present on the
--    hosted DB. All deal-level details are carried in site_candidates.raw_data.
INSERT INTO public.deals (
  id,
  address,
  suburb,
  state,
  postcode,
  status,
  stage,
  source
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  '247 Geelong Road',
  'Sunshine West',
  'VIC',
  '3020',
  'active',
  'opportunity',
  'manual_test'
) ON CONFLICT (id) DO NOTHING;

-- 2. Insert into site_candidates (pipeline agents use this table)
INSERT INTO public.site_candidates (
  id,
  source,
  external_id,
  address,
  suburb,
  state,
  postcode,
  property_type,
  land_area,
  price_text,
  headline,
  zoning,
  estimated_units,
  discovery_score,
  discovery_reasons,
  raw_data
) VALUES (
  'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  'manual_test',
  'manual-test-sunshine-west-247',
  '247 Geelong Road, Sunshine West VIC 3020',
  'Sunshine West',
  'VIC',
  '3020',
  'land',
  1240,
  '$1,850,000',
  'Corner development site — RGZ2 zoning — 800m to Sunshine station',
  'RGZ2',
  7,
  78,
  '[
    "Corner lot with dual street frontage",
    "RGZ2 zoning allows 3-storey residential",
    "800m walk to Sunshine railway station",
    "Land area 1,240sqm supports 6-8 townhouses",
    "Active development corridor — 12 comparable approvals nearby in 12 months"
  ]'::jsonb,
  '{
    "deal_name": "Sunshine West Dev Site",
    "notes": "Corner lot, RGZ2 zoning. 800m from Sunshine station. DA potential for 6-8 townhouses or 3-storey apartments. Vendor motivated.",
    "price_per_sqm": 1491,
    "comparable_sales": [
      {"address": "219 Geelong Rd Sunshine West", "price": 2050000, "land_area": 1150, "date": "2025-11"},
      {"address": "31 Ash Cres Sunshine West",    "price": 1780000, "land_area": 1100, "date": "2025-09"},
      {"address": "88 Wright St Sunshine West",   "price": 2300000, "land_area": 1350, "date": "2025-12"}
    ],
    "infrastructure": {
      "train_station": "Sunshine (800m)",
      "bus_routes": ["406", "411", "467"],
      "schools": ["Sunshine West Primary (400m)", "Sunshine College (1.2km)"],
      "shopping": "Sunshine Plaza (1.4km)"
    }
  }'::jsonb
) ON CONFLICT (source, external_id) DO NOTHING;

-- ============================================================
-- After running this seed:
--
--   Deal ID (deals):        a1b2c3d4-e5f6-7890-abcd-ef1234567890
--   Site Candidate ID:      b2c3d4e5-f6a7-8901-bcde-f12345678901
--
-- Use the "Run Pipeline" button in the Ops page with:
--   Deal ID:  a1b2c3d4-e5f6-7890-abcd-ef1234567890
--   Address:  247 Geelong Road, Sunshine West VIC 3020
--
-- To reset (clean up before re-running agents):
--   DELETE FROM public.deals           WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
--   DELETE FROM public.site_candidates WHERE id = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
--
-- NOTE: If you still need the metadata column on deals (some agents
-- write to it), run this first:
--   ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
-- ============================================================
