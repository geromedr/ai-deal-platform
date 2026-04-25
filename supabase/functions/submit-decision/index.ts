import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "../_shared/debug-supabase.ts";
import { isUuid } from "../_shared/utils.ts";

type RequestPayload = {
  deal_id?: string;
  decision?: "BUY" | "REVIEW" | "PASS";
};

const ALLOWED_DECISIONS = new Set(["BUY", "REVIEW", "PASS"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.error("[submit-decision] early return: method not allowed", {
      method: req.method,
    });
    const response = jsonResponse({ error: "Method not allowed" }, 405);
    console.log("[submit-decision] final response payload", {
      status: response.status,
      payload: { error: "Method not allowed" },
    });
    return response;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error("[submit-decision] early return: missing env", {
      supabaseUrlConfigured: Boolean(supabaseUrl),
      serviceKeyConfigured: Boolean(serviceKey),
    });
    const response = jsonResponse({ error: "Supabase environment variables not set" }, 500);
    console.log("[submit-decision] final response payload", {
      status: response.status,
      payload: { error: "Supabase environment variables not set" },
    });
    return response;
  }

  try {
    const rawBody = await req.clone().text();
    console.log("[submit-decision] incoming request body", rawBody);
    const body = (await req.json()) as RequestPayload;
    const deal_id = normalizeString(body.deal_id);
    const decision = normalizeString(body.decision) as RequestPayload["decision"];
    console.log("[submit-decision] normalized parameters", {
      deal_id,
      decision,
    });

    if (!deal_id) {
      console.error("[submit-decision] early return: missing deal_id", { body });
      const response = jsonResponse({ error: "deal_id is required" }, 400);
      console.log("[submit-decision] final response payload", {
        status: response.status,
        payload: { error: "deal_id is required" },
      });
      return response;
    }

    if (!isUuid(deal_id)) {
      console.error("[submit-decision] early return: invalid deal_id", { deal_id });
      const response = jsonResponse({ error: "deal_id must be a valid UUID" }, 400);
      console.log("[submit-decision] final response payload", {
        status: response.status,
        payload: { error: "deal_id must be a valid UUID" },
      });
      return response;
    }

    if (!decision || !ALLOWED_DECISIONS.has(decision)) {
      console.error("[submit-decision] early return: invalid decision", {
        decision,
      });
      const response = jsonResponse(
        { error: "decision must be one of BUY, REVIEW, PASS" },
        400,
      );
      console.log("[submit-decision] final response payload", {
        status: response.status,
        payload: { error: "decision must be one of BUY, REVIEW, PASS" },
      });
      return response;
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve the deal directly from the deals table — no deal_feed row required
    const { data: dealRow, error: dealError } = await supabase
      .from("deals")
      .select("id")
      .eq("id", deal_id)
      .maybeSingle();

    if (dealError) {
      console.error("[submit-decision] early return: deal lookup error", {
        dealError,
        deal_id,
      });
      const response = jsonResponse({ error: "Deal not found" }, 404);
      console.log("[submit-decision] final response payload", {
        status: response.status,
        payload: { error: "Deal not found" },
      });
      return response;
    }

    if (!dealRow) {
      console.error("[submit-decision] early return: deal not found", { deal_id });
      const response = jsonResponse({ error: "Deal not found" }, 404);
      console.log("[submit-decision] final response payload", {
        status: response.status,
        payload: { error: "Deal not found" },
      });
      return response;
    }

    const resolvedDealId = (dealRow as { id: string }).id;

    const { data: actionRow, error: actionError } = await supabase
      .from("ai_actions")
      .insert({
        deal_id: resolvedDealId,
        agent: "submit-decision",
        action: "deal_decision",
        payload: {
          decision,
        },
      })
      .select("id, created_at")
      .single();

    if (actionError) {
      throw new Error(actionError.message);
    }

    if (decision === "REVIEW") {
      const { error: taskError } = await supabase.from("tasks").insert({
        deal_id: resolvedDealId,
        title: "Review Deal",
        status: "pending",
      });

      if (taskError) {
        throw new Error(taskError.message);
      }
    }

    const responsePayload = {
      success: true,
      deal_id: resolvedDealId,
      decision,
      action_id: actionRow?.id ?? null,
      timestamp: actionRow?.created_at ?? new Date().toISOString(),
      message: "Decision submitted successfully",
    };
    const response = jsonResponse(responsePayload);
    console.log("[submit-decision] final response payload", {
      status: response.status,
      payload: responsePayload,
    });
    return response;
  } catch (error) {
    console.error("[submit-decision] handler exception", { error });
    const responsePayload = {
      error: error instanceof Error ? error.message : "Unknown error",
    };
    const response = jsonResponse(responsePayload, 500);
    console.log("[submit-decision] final response payload", {
      status: response.status,
      payload: responsePayload,
    });
    return response;
  }
});
