# SYSTEM AUDIT

Current snapshot of the AI Deal Platform repository.

## 1. Project Overview

The platform is a property-deal decision system. It ingests and ranks deal signals, surfaces them in a feed, opens a per-deal workspace, and lets the user record a final triage decision.

End-to-end purpose:
- collect deal opportunities into `deals` and `deal_feed`
- rank and filter surfaced opportunities for operator review
- open a deal workspace with context, tasks, financials, and risk signals
- record decisions through the UI
- persist downstream audit activity and follow-up tasks

Core purpose:
- decision engine for property deals
- the current implementation is focused on deal triage and operator actions, not full automation

## 2. Current System Architecture

### Frontend

The UI is a Next.js app in `ai-deal-ui/src`.

Key routes:
- `src/app/page.tsx` renders the deal feed entry point
- `src/app/deal/[id]/page.tsx` renders the deal workspace/detail view
- `src/app/(dashboard)/workspace/page.tsx` is a placeholder workspace route

Key components:
- `src/components/deal/deal-feed.tsx` fetches and renders the live feed
- `src/components/deal/deal-card.tsx` renders each deal card and routes into the deal page
- `src/components/deal/decision-header.tsx` renders BUY / REVIEW / PASS actions
- `src/components/deal/deal-feed-shell.tsx` is a placeholder dashboard shell

Frontend behavior:
- the feed is client-fetched from Supabase Edge Functions
- the deal page is server-rendered and loads context from the backend
- decision actions are submitted from the deal page back to Supabase

### Backend

The backend is Supabase-based and uses Edge Functions plus Postgres tables.

Relevant tables:
- `deals`
- `deal_feed`
- `tasks`
- `ai_actions`

Relevant Edge Functions for this flow:
- `get-deal-feed`
- `get-deal-context`
- `submit-decision`

### Data Flow

Current working flow:
- `deal_feed` holds surfaced opportunities
- the UI lists `deal_feed` rows in the feed
- clicking a feed card opens the deal workspace
- the workspace loads context from `get-deal-context`
- a decision is submitted through `submit-decision`
- the backend writes to `ai_actions` and may create `tasks`
- the UI refreshes to reflect the latest data

## 3. Database Schema

### `deals`

Purpose:
- canonical deal record
- this is the stable identity for the property opportunity

Key columns:
- `id`
- `address`
- `suburb`
- `state`
- `postcode`
- `status`
- `stage`
- `source`
- `metadata`
- `created_at`
- `updated_at`

How it is used:
- stores the underlying deal entity
- anchors tasks, actions, risks, communications, financial snapshots, and other long-lived records
- provides the persistent deal identity that survives feed churn

Relationships:
- parent record for `deal_feed.deal_id`
- parent record for `tasks.deal_id`
- parent record for `ai_actions.deal_id`

### `deal_feed`

Purpose:
- surfaced opportunity row for the review queue
- this is the triage-facing representation of a deal

Key columns:
- `id`
- `deal_id`
- `score`
- `status`
- `trigger_event`
- `summary`
- `metadata`
- `created_at`
- `updated_at`

How it is used:
- powers the feed list
- stores the row that the UI currently treats as the clickable feed item
- is the row resolved by `get-deal-context` before loading the canonical deal

Relationships:
- `deal_feed.deal_id` references `deals.id`
- feed row `id` is currently used in the UI route and API client as the workspace entry identifier

### `tasks`

Purpose:
- deal-level action items and follow-up work

Key columns:
- `id`
- `deal_id`
- `title`
- `description`
- `assigned_to`
- `due_date`
- `status`
- `metadata`
- `created_at`
- `updated_at`

How it is used:
- shows the work generated from review or operator actions
- the deal page lists current tasks
- `submit-decision` can create a pending task for `REVIEW`

Relationships:
- references `deals.id`
- loaded by `get-deal-context` using the canonical deal id

### `ai_actions`

Purpose:
- audit log of AI- or workflow-driven actions

Key columns:
- `id`
- `deal_id`
- `agent`
- `action`
- `payload`
- `source`
- `created_at`

How it is used:
- records decision submission and context requests
- gives the deal page a way to read back the latest decision history

Relationships:
- references `deals.id`
- also appears in the action timeline and audit surfaces

### Relationship Summary

- `deals` is the canonical entity
- `deal_feed` is the surfaced triage row for that entity
- `tasks` belong to `deals.id`
- `ai_actions` belong to `deals.id`

## 4. Edge Functions

### `get-deal-feed`

Purpose:
- returns ranked feed items for the UI

Inputs:
- `limit`
- `score`
- `status`
- `sort_by`
- `user_id`
- `stageFilter`

Outputs:
- `success`
- `limit`
- `filters`
- `applied_preferences`
- `sort_by`
- `items`
- `warnings`

UI and DB connection:
- called by `src/lib/api/getDealFeed.ts`
- used by the feed page to render deal cards and filter buttons
- reads `deal_feed`, then enriches from `deals`, `financial_snapshots`, `site_intelligence`, `risks`, `scoring_feedback`, and `user_preferences`

### `get-deal-context`

Purpose:
- returns deal detail context for the workspace page

Inputs:
- `deal_id`

Outputs:
- `deal`
- `feed`
- `tasks`

UI and DB connection:
- called by `src/lib/api/getDealContext.ts`
- used by `src/app/deal/[id]/page.tsx`
- resolves the clicked feed row, fetches the linked canonical deal, then loads tasks by `deals.id`
- also writes an `ai_actions` context request record

### `submit-decision`

Purpose:
- records a BUY / REVIEW / PASS decision

Inputs:
- `deal_id`
- `decision`

Outputs:
- `success`
- `deal_id`
- `decision`
- `action_id`
- `timestamp`
- `message`

UI and DB connection:
- called by `src/components/deal/decision-header.tsx`
- resolves the feed row to the canonical deal
- inserts an `ai_actions` record
- creates a `tasks` row when the decision is `REVIEW`

## 5. Current UI Features

Confirmed UI features in the repo:
- deal feed landing page
- deal feed loading, error, empty, and success states
- feed filters: `All`, `Active`, `Archived`
- manual feed refresh
- deal card navigation into the workspace/detail page
- deal workspace page
- decision actions: `BUY`, `REVIEW`, `PASS`
- task list display on the deal page
- summary cards for score, margin, risks, financials, and actions

## 6. Working System Flow

Current step-by-step flow:

1. User clicks a deal card in the feed.
2. The UI routes to `/deal/[id]` using the feed row identifier.
3. The deal page calls `getDealContext` with that identifier.
4. `get-deal-context` looks up the matching `deal_feed` row.
5. The function resolves the linked canonical `deals.id`.
6. It loads tasks using `tasks.deal_id = deals.id`.
7. The deal page renders the workspace with score, context, and task data.
8. The user chooses `BUY`, `REVIEW`, or `PASS`.
9. `submit-decision` writes an `ai_actions` record for the canonical deal.
10. If the decision is `REVIEW`, a pending task is created.
11. The UI refreshes and re-reads the deal context.

## 7. Known Working Components

Confirmed working in the current repo:
- `src/components/deal/deal-feed.tsx` fetches the feed and renders rows
- `src/components/deal/deal-card.tsx` routes from feed to deal page
- `src/app/deal/[id]/page.tsx` renders a working deal detail view
- `src/components/deal/decision-header.tsx` submits decisions
- `get-deal-feed` returns feed items for the UI
- `get-deal-context` returns deal, feed, and task context
- `submit-decision` writes actions and can create review tasks
- the `/workspace` route exists and is reachable

## 8. Known Limitations / Gaps

Current gaps in the product:
- scoring engine not implemented as a standalone system
- rule engine missing from the current user-facing flow
- task lifecycle incomplete
- operator dashboard missing
- workspace is still mostly placeholder content
- hosted schema and migration files are not fully aligned in every detail
- `get-deal-context` and `submit-decision` use the feed row as the entry identifier, which requires careful mapping to the canonical deal id
- the current decision readback logic on the deal page looks for a different action label than the submit function writes, so decision state display is not fully aligned yet

## 9. Data Model Clarity

### `deal_feed.id` vs `deals.id`

`deal_feed.id`:
- identifies the surfaced feed row
- is what the feed UI currently uses for routing and workspace entry
- is the identifier passed into `get-deal-context` and `submit-decision`
- the current client feed wrapper exposes this value as `deal_id`, so the UI naming is misleading even though the value is the feed-row id

`deals.id`:
- identifies the canonical deal record
- is the stable entity used for persisted operational data
- is the id that tasks and AI action audit records should attach to

### When to use each

Use `deal_feed.id` when:
- the user is interacting with the surfaced triage item
- the UI needs to open the current feed row and resolve its linked deal

Use `deals.id` when:
- writing durable deal-linked records
- creating tasks
- creating audit actions
- loading canonical deal context

### Why tasks use `deals.id`

Tasks are operational records tied to the actual deal, not to one surfaced feed row. Feed rows can change, stale out, or be archived, while the deal record must remain stable.

### Why the UI uses `deal_feed.id`

The feed is the operator entry point. The UI starts from the surfaced queue item, so it uses the feed row identifier to open the right workspace view, then resolves the canonical deal from there.

## 10. Current State Summary

Product stage:
- the platform is in a working vertical-slice stage
- the feed-to-workspace-to-decision loop exists
- the persistence layer for tasks and action logging is in place

Stable:
- feed rendering
- deal workspace rendering
- decision submission wiring
- task display
- Supabase Edge Function integration

Unstable:
- scoring logic
- rule automation
- task lifecycle management
- operator tooling
- some schema contracts and action labels still need alignment

Overall:
- the platform is functional for triage and decision capture
- it is not yet a complete automated deal operations system
