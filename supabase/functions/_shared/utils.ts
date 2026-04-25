/**
 * _shared/utils.ts
 * Common utilities shared across all edge functions.
 * Import from here instead of copy-pasting into each function.
 */

// ─── Response helpers ────────────────────────────────────────────────────────

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

// ─── Error handling ──────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function assertUuid(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (!isUuid(value)) {
    throw new Error(`${fieldName} must be a valid UUID, got: ${String(value)}`);
  }
}

// ─── Number parsing ──────────────────────────────────────────────────────────

/**
 * Parse a value to a finite number. Returns null if unparseable.
 * Handles numbers, numeric strings, and strips common currency characters.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%\s]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Alias kept for functions that imported parseNumberLoose by name */
export const parseNumberLoose = parseNumber;

// ─── String helpers ──────────────────────────────────────────────────────────

export function normalizeString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim().toLowerCase();
  }
  return null;
}

export function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

// ─── Environment variable helpers ────────────────────────────────────────────

/**
 * Get a required environment variable. Throws a clear error if missing
 * rather than propagating as a confusing downstream failure.
 */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in Supabase Edge Function secrets.`,
    );
  }
  return value;
}

/**
 * Get an optional environment variable, returning null if not set.
 */
export function optionalEnv(name: string): string | null {
  return Deno.env.get(name) ?? null;
}

// ─── Request parsing ─────────────────────────────────────────────────────────

/**
 * Parse a JSON request body safely. Returns null and logs on failure
 * rather than throwing an unhandled exception.
 */
export async function parseJsonBody<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
