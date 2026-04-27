/**
 * Unit tests for _shared/utils.ts
 * Run with: deno test supabase/functions/_shared/__tests__/utils.test.ts
 */

import {
  assertEquals,
  assertThrows,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// We test the pure functions by importing from the source.
// requireEnv and optionalEnv are side-effectful (read Deno.env) so we
// test their behaviour separately via env manipulation.

// ── isUuid ────────────────────────────────────────────────────────────────────

Deno.test("isUuid — accepts valid UUID v4", () => {
  const { isUuid } = await import("../utils.ts");
  assertEquals(isUuid("f389c5c4-8a2e-4015-8012-4992b8441206"), true);
});

Deno.test("isUuid — rejects empty string", () => {
  const { isUuid } = await import("../utils.ts");
  assertEquals(isUuid(""), false);
});

Deno.test("isUuid — rejects non-UUID string", () => {
  const { isUuid } = await import("../utils.ts");
  assertEquals(isUuid("not-a-uuid"), false);
});

Deno.test("isUuid — rejects null", () => {
  const { isUuid } = await import("../utils.ts");
  assertEquals(isUuid(null), false);
});

// ── parseNumber ───────────────────────────────────────────────────────────────

Deno.test("parseNumber — parses integer", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber(42), 42);
});

Deno.test("parseNumber — parses numeric string", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber("3.14"), 3.14);
});

Deno.test("parseNumber — strips currency characters", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber("$1,234,567"), 1234567);
});

Deno.test("parseNumber — returns null for non-numeric string", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber("not a number"), null);
});

Deno.test("parseNumber — returns null for null", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber(null), null);
});

Deno.test("parseNumber — returns null for Infinity", () => {
  const { parseNumber } = await import("../utils.ts");
  assertEquals(parseNumber(Infinity), null);
});

// ── getErrorMessage ───────────────────────────────────────────────────────────

Deno.test("getErrorMessage — handles Error instance", () => {
  const { getErrorMessage } = await import("../utils.ts");
  assertEquals(getErrorMessage(new Error("boom")), "boom");
});

Deno.test("getErrorMessage — handles string", () => {
  const { getErrorMessage } = await import("../utils.ts");
  assertEquals(getErrorMessage("something went wrong"), "something went wrong");
});

Deno.test("getErrorMessage — handles plain object", () => {
  const { getErrorMessage } = await import("../utils.ts");
  const result = getErrorMessage({ code: 500 });
  assertEquals(typeof result, "string");
  assertEquals(result.length > 0, true);
});

// ── normalizeString ───────────────────────────────────────────────────────────

Deno.test("normalizeString — trims and lowercases", () => {
  const { normalizeString } = await import("../utils.ts");
  assertEquals(normalizeString("  Hello World  "), "hello world");
});

Deno.test("normalizeString — returns null for empty string", () => {
  const { normalizeString } = await import("../utils.ts");
  assertEquals(normalizeString(""), null);
});

Deno.test("normalizeString — returns null for null", () => {
  const { normalizeString } = await import("../utils.ts");
  assertEquals(normalizeString(null), null);
});

// ── coerceString ──────────────────────────────────────────────────────────────

Deno.test("coerceString — trims string", () => {
  const { coerceString } = await import("../utils.ts");
  assertEquals(coerceString("  hello  "), "hello");
});

Deno.test("coerceString — returns null for whitespace-only string", () => {
  const { coerceString } = await import("../utils.ts");
  assertEquals(coerceString("   "), null);
});

// ── requireEnv ────────────────────────────────────────────────────────────────

Deno.test("requireEnv — returns value when env var is set", () => {
  const { requireEnv } = await import("../utils.ts");
  Deno.env.set("TEST_VAR_REQUIRED", "hello");
  assertEquals(requireEnv("TEST_VAR_REQUIRED"), "hello");
  Deno.env.delete("TEST_VAR_REQUIRED");
});

Deno.test("requireEnv — throws when env var is missing", () => {
  const { requireEnv } = await import("../utils.ts");
  Deno.env.delete("TEST_VAR_MISSING_XYZ");
  assertThrows(
    () => requireEnv("TEST_VAR_MISSING_XYZ"),
    Error,
    "Missing required environment variable",
  );
});

// ── jsonResponse / errorResponse ──────────────────────────────────────────────

Deno.test("jsonResponse — returns 200 with JSON body", async () => {
  const { jsonResponse } = await import("../utils.ts");
  const res = jsonResponse({ ok: true });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json");
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test("errorResponse — returns given status with error body", async () => {
  const { errorResponse } = await import("../utils.ts");
  const res = errorResponse("Something went wrong", 400);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Something went wrong");
});
