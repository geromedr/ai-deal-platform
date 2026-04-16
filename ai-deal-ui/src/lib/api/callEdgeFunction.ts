/**
 * Thin wrapper around Supabase Edge Function calls.
 * Handles auth headers, JSON serialisation, and basic error surfacing.
 */
export async function callEdgeFunction<T = unknown>(
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase environment variables are not set.");
  }

  const url = `${supabaseUrl}/functions/v1/${functionName}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(body),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(`${functionName} returned non-JSON (status ${res.status})`);
  }

  if (!res.ok) {
    const msg =
      json && typeof json === "object" && "error" in json
        ? String((json as Record<string, unknown>).error)
        : `${functionName} failed (status ${res.status})`;
    throw new Error(msg);
  }

  return json as T;
}
