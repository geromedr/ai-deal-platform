import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) return jsonResponse({ error: "SUPABASE_URL not set" }, 500);
  if (!serviceKey) {
    return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const userId = parseString(payload?.user_id);

    if (userId && !isUuid(userId)) {
      return jsonResponse({
        error: "user_id must be a valid UUID",
        received: payload,
      }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    let preferences: Record<string, unknown> | null = null;

    if (userId) {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("user_id, min_score, preferred_strategy, notification_level")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      preferences = data ?? null;
    }

    return jsonResponse({
      success: true,
      channel: {
        topic: "deal-feed",
        event: "deal_feed_change",
        type: "broadcast",
      },
      fallback: {
        topic: "deal-feed-fallback",
        event: "postgres_changes",
        schema: "public",
        table: "deal_feed_realtime_fallback",
      },
      user_preferences: preferences,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
