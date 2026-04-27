# System Audit

## Working
- `deals` table is present and used consistently by `get-deal-context`, `submit-decision`, and the deal detail page. See `supabase/migrations/202603180001_create_core_agent_tables.sql`.
- `tasks` table is present and wired into `get-deal-context`, the deal workspace, and the REVIEW branch in `submit-decision`.
- `ai_actions` table is present and is the shared audit/action trail for decision logging and context lookups.
- `get-deal-context` is built end-to-end: backend returns `deal`, `feed`, `tasks`, `financials`, `risks`, `site_intelligence`, and `communications`; frontend consumes the same shape in `ai-deal-ui/src/lib/api/getDealContext.ts` and `ai-deal-ui/src/app/deal/[id]/page.tsx`.
- `submit-decision` is built end-to-end: the frontend calls the function with `deal_id` and `decision`, and the backend logs to `ai_actions` and creates a task for REVIEW.

## Partial
- `deal_feed` is only partially aligned. The base table exists, but the wider feed pipeline expects extra fields and behaviors that are not fully reflected in the schema.
- `financial_snapshots` is present and readable from the workspace, but it is still a thin snapshot model rather than a fully expressive financial layer.
- Deal feed frontend is scaffolded and fetches live data, but the filter semantics are not aligned with the backend model.
- `DecisionHeader` is wired to `submitDecision`, but the `feedId` prop is unused and is only carried for logging.

## Missing
- `generate-deal-tasks` Edge Function is missing. There is no `supabase/functions/generate-deal-tasks/index.ts` file and no frontend caller for it.

## Critical Issues
- `deal_feed` schema mismatch: `supabase/functions/get-deal-feed/index.ts` selects `priority_score`, and migrations/indexes reference it, but `supabase/migrations/202603240001_create_deal_feed_table.sql` does not define a `priority_score` column. This is the highest-risk backend drift in the audited surface.
- Frontend feed filter mismatch: `ai-deal-ui/src/components/deal/deal-feed.tsx` sends `stageFilter` values of `active` and `archived`, but `get-deal-feed` applies that filter to `deals.stage`. The `deals` schema defaults `stage` to `opportunity`, while lifecycle state for the feed lives in `deal_feed.status`, so the filter path is effectively broken.
- Deal feed is not actually driven from `deal_feed` rows as the source of truth. The function primarily queries `deals` and only enriches with `deal_feed`, which means the frontend can show deals that are not surfaced in the feed table lifecycle.
