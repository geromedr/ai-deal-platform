# DECISIONS.md

Autonomous decisions made during the agent-autonomous sprint. Each entry documents what was decided and why.

---

## 2026-04-28

### DEC-001: console.log statements in edge functions — KEEP but don't strip
**Decision:** Retain structured `console.log` and `console.error` calls in edge functions. Do NOT strip them.
**Reason:** Supabase Edge Function logs are the only observability tool available in production (no APM/tracing layer). Removing them would blind operations. The audit flagged "93 console.log statements" as a risk — but structured operational logging is intentional and useful. The real fix is ensuring no *sensitive data* (keys, full request bodies) is logged, not removing logging entirely.
**Action:** Audit logs for sensitive data exposure instead.

### DEC-002: import_map entries for edge functions — not required
**Decision:** The 31 functions "missing import_map" entries in config.toml are NOT a problem.
**Reason:** Supabase edge functions use a root-level `import_map.json` by default. Per-function import_map entries in config.toml are only needed to *override* the default. The audit found only 21 of 63 have entries — this is expected; the others inherit the root map.
**Action:** No change needed. Confirmed safe.

### DEC-003: .env file in repo — ADD to .gitignore, create .env.example
**Decision:** Add `.env` to .gitignore and create a `.env.example` documenting all required variables.
**Reason:** The root `.env` contains real Supabase URLs and keys. It must not be tracked. The service role key and any API keys must be rotated after removal from history.
**Action:** Added `.env` to gitignore. Created `.env.example`. Recommend Gerome rotates SUPABASE_SERVICE_ROLE_KEY and JINA_API_KEY after confirming new `.env` is set up.

### DEC-004: deal-chat stub LLM — wire to real ai-agent edge function
**Decision:** Replace the stub `generateStubReply()` in `/api/deal-chat/route.ts` with a real call to the `ai-agent` Supabase edge function.
**Reason:** The ai-agent is already built, deployed, and handles RAG + DeepSeek. The stub was a placeholder. This is a straightforward wiring fix.

### DEC-005: internal-ops-dashboard verify_jwt = false — document, not change
**Decision:** Document the JWT bypass but do NOT change it autonomously.
**Reason:** The ops dashboard may intentionally bypass JWT for internal tooling. Changing auth configuration without understanding the access pattern could lock out legitimate users. Flagged for Gerome's review.

### DEC-006: Test framework choice — Vitest for frontend, Deno test for edge functions
**Decision:** Use Vitest for frontend unit/integration tests, Deno's built-in test runner for edge function unit tests.
**Reason:** Vitest integrates natively with Vite/Next.js, is fast, and has a Jest-compatible API. Deno's built-in test runner requires no additional dependencies for edge functions.
