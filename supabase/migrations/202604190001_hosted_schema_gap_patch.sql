-- ============================================================
-- Hosted schema gap patch
-- Adds columns that exist in the local migration files but were
-- never applied to the hosted Supabase instance.
-- Safe to re-run — all statements use IF NOT EXISTS.
-- ============================================================

-- deals: metadata column (used by notification-agent, rule-engine-agent, etc.)
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- risks: status column (used by notification-agent for priority scoring)
ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';

-- deal_feed: metadata column (used by notification-agent)
ALTER TABLE public.deal_feed
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- financial_snapshots: metadata column (used by notification-agent)
ALTER TABLE public.financial_snapshots
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- site_intelligence: flood_risk column (used by notification-agent priority scoring)
ALTER TABLE public.site_intelligence
  ADD COLUMN IF NOT EXISTS flood_risk text;

-- ============================================================
-- Run this in the Supabase SQL Editor (dashboard → SQL Editor)
-- then re-run the pipeline from the Ops page.
-- ============================================================
