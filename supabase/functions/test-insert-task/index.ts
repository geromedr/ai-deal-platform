import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "../_shared/debug-supabase.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method !== "POST") {
    console.error("[test-insert-task] early return: method not allowed", {
      method: req.method,
    });
    const response = jsonResponse({ error: "Method not allowed" }, 405);
    console.log("[test-insert-task] final response payload", {
      status: response.status,
      payload: { error: "Method not allowed" },
    });
    return response;
  }

  try {
    const rawBody = await req.clone().text();
    console.log("[test-insert-task] incoming request body", rawBody);
    const payload = await req.json();
    console.log("[test-insert-task] normalized parameters", payload);
    const deal_id = typeof payload?.deal_id === "string"
      ? payload.deal_id.trim()
      : "";

    if (!deal_id) {
      console.error("[test-insert-task] early return: missing deal_id", {
        payload,
      });
      const response = jsonResponse({ error: "Missing deal_id" }, 400);
      console.log("[test-insert-task] final response payload", {
        status: response.status,
        payload: { error: "Missing deal_id" },
      });
      return response;
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) {
      console.error("[test-insert-task] early return: missing env", {
        supabaseUrlConfigured: Boolean(supabaseUrl),
        serviceKeyConfigured: Boolean(serviceKey),
      });
      const response = jsonResponse({ error: "Supabase environment variables not set" }, 500);
      console.log("[test-insert-task] final response payload", {
        status: response.status,
        payload: { error: "Supabase environment variables not set" },
      });
      return response;
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

    const response = jsonResponse(data);
    console.log("[test-insert-task] final response payload", {
      status: response.status,
      payload: data,
    });
    return response;
  } catch (error) {
    console.error("[test-insert-task] handler exception", { error });
    const responsePayload = {
      error: error instanceof Error ? error.message : "Unknown error",
    };
    const response = jsonResponse(responsePayload, 500);
    console.log("[test-insert-task] final response payload", {
      status: response.status,
      payload: responsePayload,
    });
    return response;
  }
});
