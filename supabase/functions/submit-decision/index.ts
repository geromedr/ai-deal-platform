import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  try {
    const body = (await req.json()) as RequestPayload;
    const deal_id = normalizeString(body.deal_id);
    const decision = normalizeString(body.decision) as RequestPayload["decision"];

    if (!deal_id) {
      return jsonResponse({ error: "deal_id is required" }, 400);
    }

    if (!isUuid(deal_id)) {
      return jsonResponse({ error: "deal_id must be a valid UUID" }, 400);
    }

    if (!decision || !ALLOWED_DECISIONS.has(decision)) {
      return jsonResponse(
        { error: "decision must be one of BUY, REVIEW, PASS" },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: dealFeedRow, error: dealFeedError } = await supabase
      .from("deal_feed")
      .select("deals(id)")
      .eq("id", deal_id)
      .single();

    if (dealFeedError) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const resolvedDealId = (dealFeedRow as { deals?: { id?: string | null } } | null)
      ?.deals?.id ?? null;

    if (!resolvedDealId) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const { data: actionRow, error: actionError } = await supabase
      .from("ai_actions")
      .insert({
        deal_id: resolvedDealId,
        agent: "submit-decision",
        action: "decision_submitted",
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

    return jsonResponse({
      success: true,
      deal_id: resolvedDealId,
      decision,
      action_id: actionRow?.id ?? null,
      timestamp: actionRow?.created_at ?? new Date().toISOString(),
      message: "Decision submitted successfully",
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
