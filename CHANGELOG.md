# Changelog

This document records significant changes to the system.

---

## v0.8 — 2026-04-17

### UI — Deal Workspace Tabs

Replaced the long-scroll deal workspace with a 7-tab layout:
**Brief · Financials · Risks & Tasks · Investors · Timeline · Reports · Chat**

- `WorkspaceTabs` client component (`src/components/deal/workspace-tabs.tsx`) handles tab state
- Server component passes pre-rendered React nodes as tab slot props — no client/server boundary issues
- Risk + task badge counts displayed on the Risks & Tasks tab

### UI — Global Navigation Bar

Added a persistent `GlobalNav` component (`src/components/layout/global-nav.tsx`) to the root layout.

- Sticky header with backdrop blur across all pages
- Links: Feed, Ops, New Deal — active state via `usePathname`
- Removed redundant inline Ops / New Deal links from the feed header

### UI — Feed Search + Sort Controls

Added a toolbar above the deal card list:

- Text search filtering by address, suburb, state, deal name
- Sort by Score, Priority, or Date (ascending / descending toggle)
- `useMemo` derived `visibleDeals` list passed to `DealCard` components for correct nav index

### API + UI — Deal Timeline

- New Next.js API route: `GET /api/deal-timeline?deal_id=...` proxying `get-deal-timeline` edge function
- New client component `DealTimeline` with expandable event rows, colour-coded timeline spine, and graceful empty state

### API + UI — Deal Reports

- New Next.js API routes: `GET /api/deal-reports?deal_id=...` and `POST /api/deal-reports`
- `GET` proxies `get-deal-reports` edge function; `POST` proxies `deal-report-agent`
- New client component `DealReports` with inline report list, "Generate report" button, auto-refresh after generation

---

## v0.7 — 2026-04-16

### UI — Deal Brief (replacing TLDR)

Replaced the 3-bullet TLDR section with a 4-paragraph operator-facing Deal Brief:

- **Opportunity** — score-band verdict, strategy, location, yield, zoning
- **Financials** — GDV, TDC, profit, margin with qualitative band (Thin / Marginal / Solid / Excellent)
- **Risks & Hurdles** — highest-severity risk, flood flag, rezoning risk
- **Area & Exit** — suburb/state context, buyer pool, infrastructure notes

Margin bands: Thin (<14%), Marginal (14–20%), Solid (20–28%), Excellent (≥28%).  
Score bands: low-confidence (<40), early-stage (40–65), moderate conviction (65–80), high conviction (≥85).

### UI — Deal-level Chat

- New `DealChat` client component with starter prompts, user/assistant avatars, `Enter` to send
- New API route `POST /api/deal-chat` with keyword-matching stub reply
- `AI_ENABLED=false` env flag gates real LLM path (swap body of `generateStubReply` when key is available)

### UI — Investor Panel

- New `InvestorPanel` client component showing suggested actions and matched investor cards
- New API route `GET /api/investor-matches?deal_id=...` proxying `investor-actions` edge function server-side (resolves CORS)

### UI — Operator Dashboard (`/ops`)

- 4 stat cards: active deals, system health, notifications 24h, reports 7d
- Agent usage table (top 8 by call volume + estimated cost)
- Approval queue with inline approve/reject + optional operator notes

### UI — Deal Intake Form (`/deals/new`)

- Form fields: address (required), suburb, state, postcode, property type, asking price, land area, listing URL, notes
- Submits to `POST /api/submit-deal` → `site-discovery-agent` with `source: "manual_intake"`
- Success state shows deal ID with "Open deal workspace" button

### Fix — CORS for Edge Function Calls

Established pattern: all Supabase edge function calls from browser must be proxied through Next.js API routes. Direct client-side fetch to Supabase blocked by missing CORS headers. Proxy routes use `callEdgeFunction()` server-side.

### Fix — `siteIntelligence is not defined` ReferenceError

Removed broken reference to `siteIntelligence` inside `buildDealNarrative` (module-level function cannot access component-scoped variables). Infrastructure context now derived from `deal` metadata fields only.

---

## v0.6 — 2026-04-15

### UI — Deal Feed + Workspace Shell

- Initial Next.js 14 App Router shell
- `DealFeed` client component with live Supabase feed via `get-deal-feed` edge function
- `DealCard` components with score/priority display
- `DealWorkspaceContent` async server component pulling `get-deal-context`
- `DecisionHeader` with BUY / REVIEW / PASS decision recording
- Prev/Next navigation using URL params (`?filter=&ids=&i=`)

---

## v0.1 — Initial architecture

Initial platform architecture: Supabase schema, edge function skeleton, agent orchestration pattern.
