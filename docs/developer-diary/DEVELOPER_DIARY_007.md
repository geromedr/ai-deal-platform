DEPRECATED - see docs_v2/CORE_SYSTEM_PROMPT.md and docs_v2/SYSTEM_RUNTIME.md
This file is retained for compatibility and historical reference.

# Developer Diary
### Entry 007 - Capital Visibility Layer for UI-Ready Deal Raise Context

---

# Context

This session was intentionally constrained.

The platform already had the core Investor and Capital Layer in place:

- `investors`
- `deal_investors`
- `deal_terms`
- `deal_investor_matches`
- `investor_deal_pipeline`
- `investor_communications`
- `deal_capital_allocations`

The objective was not to expand capital workflows, add dashboards, or introduce new investor automation.

The objective was to build a thin, deterministic Capital Visibility Layer so the system can answer UI-facing questions directly:

- how much capital is raised for this deal
- how much capital is remaining
- how many investors are committed
- what the current investor pipeline looks like

This work was designed to stay additive, lightweight, and aligned with the existing live schema.

---

# Key Achievements

## 1. Added a Derived `deal_capital_summary` View

Implemented a new additive database view:

- `deal_capital_summary`

This view creates a clean, UI-ready capital summary per deal without introducing any new mutable workflow tables.

It aggregates:

- `capital_target`
- `total_committed`
- `total_soft_commit`
- `remaining_capital`
- `investor_count`
- `committed_investor_count`
- `soft_commit_investor_count`
- pipeline counts by status
- `pipeline_summary` as a flat JSON object

This is the key structural outcome of the session.

---

## 2. Reused Existing Deal and Capital Sources Instead of Creating New State

The visibility layer was built entirely from data the platform already stores.

The summary view derives its output from:

- `deal_terms.metadata`
- `deals.metadata`
- latest `financial_snapshots`
- `deal_investors`
- `investor_deal_pipeline`
- `deal_capital_allocations`

This avoided introducing duplicate capital-tracking structures and kept the implementation consistent with the existing architecture.

The capital target follows the current repository conventions and resolves from:

- `equity_required`
- `target_raise`
- `deal_size`
- latest financial snapshot fallback values

That keeps the new layer aligned with how deal size and raise expectations are already inferred elsewhere in the platform.

---

## 3. Normalised Pipeline Visibility Across Existing CRM and Commitment Data

The capital summary does not depend only on explicit CRM rows.

Instead, it builds an investor universe from:

- `deal_investors`
- `investor_deal_pipeline`
- `deal_capital_allocations`

Then it resolves a usable pipeline state by prioritising:

- explicit `investor_deal_pipeline.pipeline_status`
- mapped `deal_investors.relationship_stage`
- inferred state from capital allocation status

This ensures pipeline counts remain available even when one layer is incomplete, while still preserving deterministic behavior.

---

## 4. Added `capital_summary` to `get-deal`

The `get-deal` edge function now returns:

- existing deal context
- existing capital allocation rows
- new additive `capital_summary`

This means downstream consumers no longer need to compute raise totals client-side just to answer core capital questions.

The change was additive and did not remove or restructure existing response fields.

---

## 5. Added `capital_summary` to `get-deal-context`

The same derived summary was also added to `get-deal-context`.

This keeps the two main context-retrieval surfaces aligned and prevents summary logic from drifting across separate endpoints.

That alignment matters because these functions are already used as the central read path for reports, AI reasoning, and future UI work.

---

## 6. Updated Governance and System Documentation

The change was fully registered across repository governance docs.

Updated:

- `docs/database/SCHEMA.md`
- `docs/system/API.md`
- `docs/system/AGENTS.md`
- `docs/system/PROJECT_STATE.md`
- `docs/architecture/ARCHITECTURE.md`

This keeps the schema registry, API contract, architecture description, and current-state documentation aligned with the implementation.

---

# What Was Explicitly Not Built

To keep scope tight and consistent with the brief, this session did not add:

- UI or dashboards
- notifications
- new CRM workflows
- payment logic
- distribution logic
- waterfall logic
- allocation expansion workflows
- new investor automation

The work stayed within the boundary of shaping clean aggregated outputs for the next UX phase.

---

# Current System Capability

The platform can now answer the following directly from stored and derived context:

- total hard committed capital for a deal
- total soft committed capital for a deal
- remaining capital when a target exists
- total investor count involved in the deal raise context
- committed investor count
- pipeline status counts across the investor set

This materially improves the readiness of the existing deal context layer for UI consumption.

---

# Design Decisions

## 1. View Instead of New Table

The correct shape here was a derived view, not a new persisted workflow table.

Reason:

- no new source of truth needed
- avoids synchronization logic
- keeps the layer deterministic
- reduces maintenance surface area

---

## 2. Additive Response Field Instead of Reworking Existing Payloads

The summary was exposed as:

- `capital_summary`

This preserves backward compatibility for existing consumers while making the richer aggregate output available immediately.

---

## 3. Existing Metadata Conventions Were Respected

Instead of inventing a new required field for target capital, the implementation used the existing metadata patterns already present in:

- `deal_terms`
- `deals`
- `financial_snapshots`

That decision reduces migration risk and keeps the visibility layer compatible with current live data.

---

# Risks and Constraints

## 1. Capital Target Depends on Existing Metadata Quality

`remaining_capital` is only as reliable as the current target-capital metadata.

If a deal lacks:

- `equity_required`
- `target_raise`
- `deal_size`
- relevant financial fallback values

then `capital_target` and `remaining_capital` may be null.

This is acceptable for now because the layer was intentionally designed to derive from existing live data rather than introduce new mandatory schema.

---

## 2. Migration Still Requires Manual Application

Per repository governance, the migration was created but not applied automatically.

That means the code and docs are prepared, but the view is not live until the migration is run in Supabase.

---

## 3. No Runtime Validation Was Performed in This Session

The implementation was completed in code, but the following were not executed here:

- migration apply
- hosted verification
- edge function deployment
- endpoint smoke tests

Those remain operational follow-up steps.

---

# Recommendations

## 1. Apply the Migration First

Run the new migration so `deal_capital_summary` exists before deploying the updated retrieval functions.

---

## 2. Smoke Test Both Read Endpoints

After migration and deployment, validate:

- `get-deal`
- `get-deal-context`

Check specifically:

- deals with hard commitments
- deals with only soft commitments
- deals with pipeline rows but no capital rows
- deals with no target-capital metadata

---

## 3. Standardise Target Raise Metadata Over Time

The current fallback chain is pragmatic and compatible, but long-term consistency will improve if the product converges on one preferred capital-target field.

---

# Reflection

This was a small architectural change, not a broad feature build.

That was the correct move.

The Investor and Capital Layer was already complete enough to support commitment tracking, CRM context, and matching.

What it lacked was a clean, stable, reusable summary surface for presentation and product consumption.

This session filled that gap without creating new workflow complexity.

---

# Closing Thought

The important outcome here is not more capital logic.

It is better capital readability.

The platform now has a thin derived layer that turns existing investor and commitment data into a UI-ready capital picture, which is exactly what the next UX phase needs.

