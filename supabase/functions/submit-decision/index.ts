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

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
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
    const body = await req.json() as RequestPayload;
    console.log("BODY", body);
    const dealId = normalizeString(body.deal_id);
    const decision = normalizeString(body.decision) as RequestPayload["decision"];

    if (!dealId) {
      const error = new Error("deal_id is required");
      return jsonResponse({ error: error.message }, 400);
    }

    if (!isUuid(dealId)) {
      const error = new Error("deal_id must be a valid UUID");
      return jsonResponse({ error: error.message }, 400);
    }

    if (!decision || !ALLOWED_DECISIONS.has(decision)) {
      const error = new Error("decision must be one of BUY, REVIEW, PASS");
      return jsonResponse(
        { error: error.message },
        400,
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: dealRow, error: dealError } = await supabase
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealError) {
      throw new Error(dealError.message);
    }

    if (!dealRow) {
      const error = new Error("Deal not found");
      return jsonResponse({ error: error.message }, 400);
    }

    const { data, error } = await supabase
      .from("ai_actions")
      .insert({
        deal_id: body.deal_id,
        agent: "decision-engine",
        action: "deal_decision",
        payload: {
          decision: body.decision,
        },
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    console.log("DECISION RECORDED", data);

    return jsonResponse({
      success: true,
      deal_id: dealId,
      decision,
      action_id: data.id,
      timestamp: data.created_at ?? new Date().toISOString(),
      message: "Decision submitted successfully",
    });
  } catch (error) {
    console.error("submit-decision failed", error);
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
