DEPRECATED - see docs_v2/CORE_SYSTEM_PROMPT.md and docs_v2/SYSTEM_RUNTIME.md
This file is retained for compatibility and historical reference.

# Developer Diary
### Entry 006 - Rule-Driven Orchestration, Hosted Compatibility, and Context-Aware Dedupe

---

# Context

This session focused on moving orchestration from hardcoded decision paths into a more robust, event-driven system with dynamic rule execution.

The work started at the orchestration layer, then expanded into hosted-environment compatibility, and finished with production deployment and validation of context-aware duplicate suppression.

The result is a more flexible control plane for agent execution and a more reliable hosted runtime.

---

# Key Achievements

## 1. Rule Engine Introduced as a First-Class Orchestration Layer

Implemented `rule-engine-agent` as a reusable decision layer that:

- accepts `deal_id` and event name
- fetches persisted rules dynamically
- evaluates rule conditions safely
- triggers downstream actions by priority
- returns structured execution results

This replaced the previous model where orchestration decisions were embedded directly in pipeline code.

---

## 2. Event-Driven Orchestration Added

The system now emits orchestration events instead of relying only on manual chaining.

Events now supported:

- `post-discovery`
- `post-intelligence`
- `post-ranking`
- `post-financial`

A shared dispatcher was introduced so agents can trigger rule evaluation consistently after each stage completes.

---

## 3. Rule Coverage Expanded Beyond Ranking

The rule system now supports multiple orchestration contexts:

- post-ranking report triggers
- post-intelligence deeper-analysis triggers
- post-intelligence risk logging
- post-financial report triggers
- post-financial thin-margin risk logging

This materially improves configurability and reduces the need for hardcoded branching in agents.

---

## 4. Rule Evaluation Hardened

Condition parsing was upgraded to make rule execution production-safe.

Improvements:

- support for `>`, `<`, `>=`, `<=`, `==`
- null-safe evaluation
- better invalid-condition handling
- clearer warning output instead of crashes
- safer handling for missing `score`, `zoning`, `yield`, and `financials`

This prevents malformed or partially-populated rule inputs from breaking orchestration.

---

## 5. Planning Failure Resilience Improved

The planning-agent path in `site-intelligence-agent` was hardened so XML / parsing failures no longer collapse the pipeline.

Instead:

- failures are converted into warnings
- fallback values are used
- the pipeline continues
- downstream orchestration still runs

This was important because hosted and local runs exposed intermittent planning-agent parse failures.

---

## 6. Hosted Action-Layer Compatibility Repaired

A significant part of the session involved aligning the hosted environment with the newer local system.

Compatibility work included:

- normalising `create-task`
- normalising `agent-orchestrator`
- supporting legacy `agent_action_rules`
- handling legacy `risks` table layouts
- exposing current orchestration results at the top level of `site-intelligence-agent`

This removed several hosted-only failures caused by schema drift and older action-layer assumptions.

---

## 7. Context-Aware Event Deduplication Implemented

The original duplicate suppression logic used only:

- `deal_id`
- `event`

That was too coarse and caused valid reruns to be skipped after deal context changed.

The dispatcher now builds a deterministic `context_hash` from:

- `score`
- `zoning`
- `yield`
- `financials`

Duplicate suppression now skips only when:

- `deal_id` matches
- event matches
- `context_hash` matches
- status is `in_progress` or `completed`

Legacy records without hashes still fall back to the older event-level behavior for backward compatibility.

---

## 8. Hosted Deployment and Live Validation Completed

The updated orchestration stack was deployed to hosted Supabase and verified live.

Hosted validation covered:

- top-level `site-intelligence-agent` orchestration output
- direct `parcel-ranking-agent` behavior
- direct `financial-engine-agent` behavior
- rule execution logging
- duplicate suppression
- recursion prevention
- report suppression on same-context reruns

Final hosted validation confirmed:

- same context -> skip
- changed financial context -> rerun
- changed score context -> rerun
- no duplicate report creation on identical-context reruns

---

# Key Issues Found

## 1. Hosted Schema Drift Was Still Material

Even after earlier stabilisation work, hosted drift still affected:

- `site_intelligence`
- `risks`
- `agent_action_rules`
- action-layer behavior

The orchestration layer had to remain backward-compatible rather than assuming local schema parity.

---

## 2. Hosted Deployments Can Appear Successful While Shared Behavior Lags

One notable issue was that direct stage-agent behavior did not immediately reflect the intended shared-dispatcher changes.

This required:

- explicit redeploys
- live probes
- function source download from hosted
- a versioned shared dispatcher module to force refresh

That was a valuable reminder that deployment confirmation is not the same as runtime confirmation.

---

## 3. Top-Level and Direct-Agent Paths Must Both Be Verified

`site-intelligence-agent` was behaving correctly at the orchestration level before direct `parcel-ranking-agent` behavior fully reflected the same dispatcher changes.

This reinforced the need to validate:

- orchestrated path
- direct invocation path
- audit-log output

separately.

---

# Current System Capability

The system now supports:

DISCOVERY -> INTELLIGENCE -> FINANCIAL / RANKING EVENTS -> RULE EVALUATION -> ACTION EXECUTION

With:

- dynamic rule lookup
- event-driven orchestration
- hosted backward compatibility
- context-aware deduplication
- legacy fallback protection
- structured orchestration summaries

---

# Recommendations

## 1. Normalise Hosted Schema Fully

The system is currently compatible with legacy hosted schema, but it should still be brought into full alignment through migrations.

Highest-priority remaining drift:

- `site_intelligence`

---

## 2. Add Automated Hosted Regression Checks

The deployment work showed that runtime behavior can diverge from local expectations even when deploy commands succeed.

Add smoke tests for:

- direct stage-agent invocation
- top-level orchestration response
- `ai_actions` payload shape
- duplicate suppression semantics

---

## 3. Investigate First-Run Report Fanout More Deeply

Same-context reruns are now controlled well, but the broader report-generation path should still be monitored to ensure no parallel first-run fanout remains under heavier orchestration scenarios.

---

# Reflection

This session pushed the system beyond simple trigger logic into a real orchestration framework.

The most important shift was not just adding a rule engine, but proving that it can operate safely in a messy hosted environment with legacy schema, partial drift, and real deployment quirks.

That is the difference between feature implementation and systems engineering.

---

# Closing Thought

The platform is no longer just chaining agents together.

It is beginning to behave like an orchestration system:

- event-driven
- rule-governed
- state-aware
- deployment-tested

That is a foundational step toward a genuinely autonomous deal engine.

---

# Session Addendum - Hosted `site_intelligence.raw_data` Alignment

This session extended the orchestration hardening work by addressing a remaining hosted-schema gap in `site_intelligence`.

## What Changed

- added an additive migration to restore `site_intelligence.raw_data` and `site_intelligence.updated_at` in hosted environments
- updated `site-intelligence-agent` to persist the aggregated orchestration payload into `site_intelligence.raw_data`
- kept the write path backward-compatible so legacy hosted rows still complete successfully when the `raw_data` column is missing
- surfaced raw-data persistence outcomes inside pipeline results instead of turning schema drift into a fatal failure
- aligned system documentation so the schema registry, agent docs, API docs, and project state all describe the current hosted-safe behaviour

## Why It Mattered

Previous work exposed orchestration summaries at the top level of the response, but the hosted database layer could still lag behind the runtime payload shape.

That meant the system could successfully compute richer site intelligence while still lacking a reliable persisted copy of the full orchestration payload.

This session closed that gap without breaking older hosted rows.

## Result

The platform now has a cleaner persistence path for end-to-end site intelligence state:

- aligned hosted schema can store the full aggregated payload in `raw_data`
- unaligned hosted schema falls back to warning-only behaviour
- orchestration continues without regression while migration rollout catches up

This is a small change at the schema layer, but an important one for making orchestration outputs durable, inspectable, and consistent across local and hosted environments.

