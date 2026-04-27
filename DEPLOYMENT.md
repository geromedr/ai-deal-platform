# Deployment Guide

Complete guide for deploying the AI Deal Platform to production.

---

## Prerequisites

- Node.js 20+
- Supabase CLI (`npm install -g supabase`)
- A Supabase project (create at [supabase.com](https://supabase.com))
- DeepSeek API key ([platform.deepseek.com](https://platform.deepseek.com))
- Jina AI API key ([jina.ai](https://jina.ai))
- Domain API key (optional — pending approval)

---

## 1. Clone & Install

```bash
git clone <repo-url>
cd ai-deal-platform/ai-deal-ui
npm install
```

---

## 2. Environment Variables

### Frontend (`ai-deal-ui/.env.local`)

Copy `.env.example` from the root and fill in:

```bash
cp .env.example ai-deal-ui/.env.local
```

Required values:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Supabase Edge Function Secrets

Set these in the Supabase dashboard under **Project Settings → Edge Functions → Secrets**, or via CLI:

```bash
supabase secrets set SUPABASE_URL=https://your-project.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set JINA_API_KEY=your-jina-key
supabase secrets set DEEPSEEK_API_KEY=your-deepseek-key

# Financial engine defaults (optional — these values are the defaults)
supabase secrets set DEFAULT_BUILD_COST_PER_SQM=4200
supabase secrets set DEFAULT_CONTINGENCY_RATE=0.07
supabase secrets set DEFAULT_PROFESSIONAL_FEES_RATE=0.09
supabase secrets set DEFAULT_MARKETING_RATE=0.035
supabase secrets set DEFAULT_FINANCE_RATE=0.05
supabase secrets set DEFAULT_DEVELOPER_MARGIN_TARGET_RATE=0.18
```

---

## 3. Database Migrations

Run all migrations in order via the Supabase SQL Editor or CLI:

```bash
supabase db push
```

**Critical migration to verify has run:**
- `202604260002_jina_embeddings_1024.sql` — resizes `knowledge_chunks.embedding` from 1536 to 1024 dimensions (required for Jina embeddings). After running, all knowledge documents must be re-added to rebuild the vector index.

---

## 4. Deploy Edge Functions

Deploy all functions:

```bash
supabase functions deploy
```

Or deploy individually:

```bash
supabase functions deploy site-intelligence-agent
supabase functions deploy financial-engine-agent
supabase functions deploy deal-report-agent
supabase functions deploy rule-engine-agent
supabase functions deploy notification-agent
supabase functions deploy ai-agent
supabase functions deploy get-deal-context
supabase functions deploy get-deal-feed
supabase functions deploy add-knowledge-document
supabase functions deploy search-knowledge
supabase functions deploy submit-decision
supabase functions deploy investor-outreach
# ... etc for all functions in supabase/functions/
```

---

## 5. Build & Deploy Frontend

### Vercel (recommended)

1. Connect repo to [vercel.com](https://vercel.com)
2. Set **Root Directory** to `ai-deal-ui`
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy

### Manual

```bash
cd ai-deal-ui
npm run build
npm run start  # or deploy .next/ to your hosting provider
```

---

## 6. Post-Deploy Checklist

- [ ] Visit `/` — deal feed loads without errors
- [ ] Create a new deal at `/new-deal` — deal appears in feed
- [ ] Open a deal workspace — all tabs render (Brief, Financials, Risks, etc.)
- [ ] Click "Run Pipeline" — pipeline completes with green steps
- [ ] Check Reports tab — AI summary renders as formatted UI (not raw JSON)
- [ ] Use Chat tab — AI responds using real DeepSeek (not stub responses)
- [ ] Click BUY/REVIEW/PASS — decision saves and score does NOT reset to 0
- [ ] Visit `/ops` — ops dashboard loads
- [ ] Check Supabase Edge Function logs for any persistent errors

---

## 7. Agent Pipeline Flow

```
User clicks "Run Pipeline"
  → site-intelligence-agent
      → zoning-agent
      → fsr-agent
      → height-agent
      → flood-agent
      → heritage-agent
      → yield-agent
      → comparable-sales-agent
      → financial-engine-agent
      → parcel-ranking-agent
  → deal-report-agent
      → rule-engine-agent (scores the deal)
  → notification-agent
```

---

## 8. Key Supabase Tables

| Table | Purpose |
|-------|---------|
| `deals` | Core deal records |
| `deal_feed` | Scored/ranked deal entries (one per deal, latest row wins) |
| `financial_snapshots` | Feasibility snapshots per deal (one active row per deal) |
| `site_intelligence` | Zoning, FSR, height, flood, heritage data |
| `risks` | Risk items linked to deals |
| `tasks` | Workflow tasks linked to deals |
| `deal_reports` | AI-generated reports (structured JSON + human summary) |
| `ai_actions` | Audit log of all AI agent actions |
| `approval_queue` | Email drafts pending human approval |
| `knowledge_chunks` | RAG knowledge base (1024-dim Jina embeddings) |

---

## 9. Troubleshooting

**Deal workspace shows "Unable to load deal workspace"**
- Check Supabase Edge Function logs for `get-deal-context`
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set as edge function secrets
- Check that `requireEnv` is imported from `_shared/utils.ts` in the function

**Score resets to 0 after clicking BUY/REVIEW/PASS**
- Verify `get-deal-context` is using `.order("updated_at", { ascending: false }).limit(1)` for the `deal_feed` query (not `.maybeSingle()`)

**Chat returns generic keyword responses instead of AI answers**
- Verify `ai-agent` function is deployed
- Check `DEEPSEEK_API_KEY` is set in edge function secrets
- Check `JINA_API_KEY` is set (required for RAG search in ai-agent)

**Financial snapshots showing multiple rows for same deal**
- Verify `financial-engine-agent` is deployed with the delete-before-insert fix
- Manually clean old rows: `DELETE FROM financial_snapshots WHERE deal_id = '<id>' AND category = 'financial-engine' AND id NOT IN (SELECT id FROM financial_snapshots WHERE deal_id = '<id>' ORDER BY created_at DESC LIMIT 1)`

**Knowledge search returns no results**
- Run the Jina migration (`202604260002_jina_embeddings_1024.sql`) if not already done
- Re-add knowledge documents (migration drops existing embeddings)

---

## 10. Environment Variable Reference

See `.env.example` in the project root for a full list of all variables with descriptions.
