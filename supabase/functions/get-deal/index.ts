import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  getErrorMessage,
  loadDealContext,
} from "../_shared/deal-context.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl) throw new Error("SUPABASE_URL not set");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

const supabase = createClient(supabaseUrl, serviceKey);

serve(
  createAgentHandler({
    agentName: "get-deal",
    requiredFields: [{ name: "deal_id", type: "string", uuid: true }],
  }, async (req) => {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405 },
      );
    }

    try {
      const { deal_id } = await req.json();

      if (!deal_id) {
        return new Response(
          JSON.stringify({ error: "Missing deal_id" }),
          { status: 400 },
        );
      }

      console.log("Fetching context for deal:", deal_id);

      const context = await loadDealContext(supabase, deal_id);

      // log context request
      await supabase.from("ai_actions").insert({
        deal_id,
        agent: "get-deal",
        action: "context_requested",
        payload: {},
      });

      return new Response(
        JSON.stringify(context),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      console.error("CONTEXT AGENT ERROR:", error);

      return new Response(
        JSON.stringify({ error: getErrorMessage(error) }),
        { status: 500 },
      );
    }
  }),
);
