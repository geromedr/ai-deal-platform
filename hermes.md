# Hermes — Project Context

> **Autonomous mode active.** Claude + Hermes are driving this project to production.
> Human intervention only needed for: Domain API credentials, Hermes channel setup, final production deploy approval.

---

## Project Overview

AI-powered deal platform for property development operators. Ingests site addresses, runs a multi-agent pipeline to assess planning, financial feasibility, and risk, then surfaces scored deals through a Next.js workspace UI backed by Supabase.

**Stack:**
- Frontend: Next.js 14 (App Router), Tailwind CSS, shadcn/ui — `ai-deal-ui/`
- Backend: Supabase Edge Functions (Deno/TypeScript) — `supabase/functions/`
- Database: Supabase Postgres + pgvector (RAG knowledge base)
- AI: DeepSeek (LLM), Jina AI `jina-embeddings-v3` 1024-dim (embeddings)
- Auth: Supabase Auth (anon key for UI, service role key for agents)

**Key agents:** `site-intelligence-agent`, `financial-engine-agent`, `deal-report-agent`, `rule-engine-agent`, `notification-agent`, `ai-agent`, `add-knowledge-document`, `search-knowledge`

**Key tables:** `deals`, `deal_feed`, `financial_snapshots`, `risks`, `tasks`, `site_intelligence`, `communications`, `deal_reports`, `ai_actions`, `approval_queue`, `knowledge_chunks`

---

## Current Sprint Goals

**Objective: Ship to production.** Complete everything required for a production-ready state, excluding Domain API integration (handled separately by Gerome).

### Infrastructure & Deploy
- [ ] Audit all environment variables — confirm every secret is set in Supabase dashboard
- [ ] Confirm Jina migration (`202604260002_jina_embeddings_1024.sql`) has been run
- [ ] Re-index knowledge base documents after Jina migration
- [ ] Configure production Next.js environment (`.env.production`)
- [ ] Set up error monitoring (Sentry or equivalent)
- [ ] Configure rate limiting on edge functions

### Testing
- [ ] Unit tests for all shared edge function utilities (`_shared/`)
- [ ] Integration tests for pipeline flow (site-intelligence → financial-engine → deal-report → rule-engine)
- [ ] Unit tests for frontend utility functions (`format.ts`, `scoring.ts`)
- [ ] E2E tests for critical UI paths (deal feed, workspace, decision buttons)
- [ ] API route tests (`/api/run-pipeline`, `/api/deal-reports`, `/api/submit-decision`)

### Code Quality & Hardening
- [ ] Audit all edge functions for missing error handling
- [ ] Add input validation to remaining edge functions
- [ ] Remove all TODO/FIXME/debug comments from production code
- [ ] Confirm no hardcoded UUIDs or test data in production paths
- [ ] Audit for console.log statements left in edge functions

### Features & UX
- [ ] Domain API agent (`domain-discovery-agent`) — BLOCKED pending Gerome's API access
- [ ] Review and complete any half-finished UI components
- [ ] Confirm deal feed pagination works at scale
- [ ] Add loading/error states to any panels missing them

### Documentation
- [ ] `DEPLOYMENT.md` — step-by-step production deploy guide
- [ ] `AGENTS.md` — update with current agent inventory and trigger conditions
- [ ] API documentation for all edge function endpoints
- [ ] Environment variable reference sheet

---

## Technical Decisions

- **Embeddings:** Jina AI `jina-embeddings-v3` (1024-dim) replaced OpenAI. Migration required: drop/recreate `knowledge_chunks.embedding` column and RPC functions.
- **LLM responses:** DeepSeek uses chat completions format. Response text at `ai_result.text` — NOT `output[0].content[0].text` (old OpenAI Responses API).
- **`deal_feed` queries:** Always use `.order("updated_at", { ascending: false }).limit(1)` — never `.maybeSingle()` (multiple rows accumulate per deal).
- **`financial-engine-agent`:** Deletes existing `category = "financial-engine"` rows before insert — one snapshot per deal.
- **`requireEnv()`:** Defined in `_shared/utils.ts`. Must be explicitly imported. Not a global.
- **Pipeline:** Run Pipeline button → `/api/run-pipeline` → site-intelligence → deal-report → notification (sequential, with step results surfaced in UI).

---

## Conventions

### Autonomous Operation
1. **Ambiguity:** Make the sensible default choice, document it in `DECISIONS.md`.
2. **Blockers:** Three attempts, then log in `BLOCKERS.md` and move on.
3. **Tests:** Write tests for everything. No exceptions.
4. **Commits:** Frequent, working code only. Branch: `agent-autonomous`.
5. **Progress:** Update this file as goals are completed.

### Edge Functions
- Shared utilities in `supabase/functions/_shared/` — never copy-paste
- Env vars via `requireEnv(name)` or `optionalEnv(name)`
- Errors: `{ error: string }` + appropriate HTTP status
- Safe error serialisation: `getErrorMessage(err)` from `_shared/utils.ts`

### Frontend
- Formatters: `ai-deal-ui/src/lib/utils/format.ts`
- Score thresholds: `ai-deal-ui/src/lib/constants/scoring.ts`
- Edge function calls: `ai-deal-ui/src/lib/api/callEdgeFunction.ts`
- No `localStorage`/`sessionStorage`. Tailwind only.

### Git
- Branch: `agent-autonomous`
- Commit format: `type(scope): description`
- Co-author: `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`

---

## Pending Tasks (Infrastructure)

- [ ] Run `202604260002_jina_embeddings_1024.sql` in Supabase SQL Editor
- [ ] Re-add knowledge documents (embeddings dropped in 1536→1024 resize)
- [ ] Deploy `domain-discovery-agent` once Domain API access arrives
- [ ] Connect Hermes to a notification channel (Telegram/Slack/Discord)

---

## Blockers Log

*None yet.*

---

## Decisions Log

*See DECISIONS.md for full history.*
