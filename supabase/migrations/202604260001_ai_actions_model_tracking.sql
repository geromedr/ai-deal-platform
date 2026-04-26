-- Migration: add AI model tracking columns to ai_actions
-- These fields support cost auditing and model-level observability
-- as part of the OpenAI → DeepSeek migration.

ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS model_used   text,
  ADD COLUMN IF NOT EXISTS total_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_usd     numeric(10, 6);

-- Index to enable cost queries by model
CREATE INDEX IF NOT EXISTS idx_ai_actions_model_used
  ON public.ai_actions (model_used)
  WHERE model_used IS NOT NULL;
