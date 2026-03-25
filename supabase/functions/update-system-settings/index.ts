import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type SystemSettingsPayload = {
  system_enabled?: boolean;
  note?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

serve(createAgentHandler({
  agentName: "update-system-settings",
  requiredFields: [{ name: "system_enabled", type: "boolean" }],
  allowWhenDisabled: true,
  skipRateLimit: true,
}, async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  try {
    const payload = await req.json() as SystemSettingsPayload;
    const systemEnabled = payload.system_enabled === true;
    const note = typeof payload.note === "string" && payload.note.trim().length > 0
      ? payload.note.trim()
      : null;
    const now = new Date().toISOString();
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("system_settings")
      .upsert({
        setting_key: "global",
        system_enabled: systemEnabled,
        metadata: {
          note,
          updated_by: "update-system-settings",
          updated_at: now,
        },
      }, { onConflict: "setting_key" })
      .select("id, setting_key, system_enabled, metadata, created_at, updated_at")
      .single();

    if (error) throw new Error(error.message);

    const { error: logError } = await supabase.from("ai_actions").insert({
      agent: "update-system-settings",
      action: "system_settings_updated",
      payload: {
        system_enabled: systemEnabled,
        note,
        updated_at: now,
      },
    });

    if (logError) throw new Error(logError.message);

    return jsonResponse({
      success: true,
      settings: data,
    });
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
}));
