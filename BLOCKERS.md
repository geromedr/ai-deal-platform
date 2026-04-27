# BLOCKERS.md

Issues that stopped autonomous progress. Gerome reviews periodically.

---

## BLK-001: npm install blocked in Claude sandbox
**Date:** 2026-04-28
**Scope:** Test runner setup
**Issue:** `npm install --save-dev vitest @vitest/coverage-v8` returns 403 Forbidden in the Claude sandbox. npm registry is network-restricted.
**Impact:** Cannot verify `npm run test` passes in sandbox. Test files are written and syntactically correct.
**Resolution:** Run `cd ai-deal-ui && npm install` locally, then `npm run test` to verify. All tests should pass — they cover pure functions with no external dependencies.
**Status:** OPEN — needs local run

## BLK-002: Supabase CLI deploy blocked in Claude sandbox
**Date:** 2026-04-28
**Scope:** Edge function deployment
**Issue:** `npx supabase functions deploy` returns 403 in the Claude sandbox.
**Impact:** All edge function changes must be deployed manually by Gerome.
**Resolution:** After each commit batch, run `npx supabase functions deploy <function-name>` or deploy all with `npx supabase functions deploy`.
**Status:** ONGOING — Gerome deploys after each push

## BLK-003: Domain API integration
**Date:** 2026-04-28
**Scope:** domain-discovery-agent
**Issue:** Awaiting Domain API credentials from Gerome.
**Impact:** domain-discovery-agent is built but not deployed. Deal discovery pipeline incomplete.
**Resolution:** Gerome to provide `DOMAIN_API_KEY` and approve deployment.
**Status:** OPEN — waiting on Gerome

## BLK-004: Hermes channels not connected
**Date:** 2026-04-28
**Scope:** Notifications / agent communication
**Issue:** `mcp__hermes__channels_list` returned 0 channels. No Telegram/Slack/Discord connected.
**Impact:** Cannot send progress notifications via Hermes.
**Resolution:** Gerome to connect a channel via the Hermes plugin settings.
**Status:** OPEN — waiting on Gerome
