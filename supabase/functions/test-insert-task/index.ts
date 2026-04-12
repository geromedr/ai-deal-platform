import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = await req.json();
    const deal_id = typeof payload?.deal_id === "string"
      ? payload.deal_id.trim()
      : "";

    if (!deal_id) {
      return jsonResponse({ error: "Missing deal_id" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        deal_id,
        title: "Test Task",
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return jsonResponse(data);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
