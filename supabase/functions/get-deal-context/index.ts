import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  getErrorMessage,
  loadDealContext,
} from "../_shared/deal-context.ts";

serve(
  createAgentHandler({
    agentName: "get-deal-context",
    requiredFields: [{ name: "deal_id", type: "string", uuid: true }],
  }, async (req) => {
    try {
      const { deal_id } = await req.json();

      if (!deal_id) {
        return new Response(
          JSON.stringify({ error: "Missing deal_id" }),
          { status: 400 },
        );
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const context = await loadDealContext(supabase, deal_id);

      await supabase.from("ai_actions").insert({
        deal_id,
        agent: "get-deal-context",
        action: "context_requested",
        payload: {},
      });

      return new Response(
        JSON.stringify(context),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: getErrorMessage(err) }),
        { status: 500 },
      );
    }
  }),
);
