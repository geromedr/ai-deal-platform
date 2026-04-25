import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { getErrorMessage } from "../_shared/deal-context.ts";
import { isUuid } from "../_shared/utils.ts";

type Row = Record<string, unknown>;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}


function logMissingFields(
  label: string,
  row: Row | null,
  fields: string[],
  snapshot: Record<string, unknown>,
) {
  if (!row) {
    console.error(`${label} is null`, snapshot);
    return;
  }

  const missingFields = fields.filter((field) =>
    row[field] == null || row[field] === ""
  );

  if (missingFields.length > 0) {
    console.error(`${label} missing expected fields`, {
      ...snapshot,
      missingFields,
      row,
    });
  }
}

serve(
  createAgentHandler({
    agentName: "get-deal-context",
    requiredFields: [{ name: "deal_id", type: "string", uuid: true }],
    validate: (payload) => {
      const incomingDealId = payload.deal_id;
      const normalizedDealId = normalizeString(incomingDealId);
      const validationState = {
        payload,
        incomingDealId,
        normalizedDealId,
        rawDealIdType: typeof incomingDealId,
        hasDealId: incomingDealId !== undefined && incomingDealId !== null,
        isUuid: normalizedDealId ? isUuid(normalizedDealId) : false,
      };

      console.log("get-deal-context validation checks", validationState);

      if (!normalizedDealId) {
        console.error("get-deal-context validation failed: missing deal_id", validationState);
      } else if (!isUuid(normalizedDealId)) {
        console.error("get-deal-context validation warning: deal_id is not a valid UUID", validationState);
      }

      return [];
    },
  }, async (req) => {
    let debugState: Record<string, unknown> = {};

    try {
      let requestBody: Record<string, unknown>;
      try {
        requestBody = await req.json() as Record<string, unknown>;
      } catch (requestError) {
        console.error("get-deal-context failed to parse request body", {
          error: getErrorMessage(requestError),
          rawError: requestError,
          ...debugState,
        });
        throw requestError;
      }
      console.log("get-deal-context request body", requestBody);

      const incomingDealId = requestBody.deal_id;
      const deal_id = normalizeString(incomingDealId);
      console.log("get-deal-context normalized request params", {
        incomingDealId,
        normalizedDealId: deal_id,
        rawDealIdType: typeof incomingDealId,
      });

      debugState = {
        requestBody,
        incomingDealId,
        normalizedDealId: deal_id,
      };

      if (!deal_id) {
        console.error("get-deal-context validation failed: missing deal_id", {
          ...debugState,
        });
        return new Response(
          JSON.stringify({ error: "Missing deal_id" }),
          { status: 400 },
        );
      }

      if (!isUuid(deal_id)) {
        console.error("get-deal-context validation warning: deal_id is not a valid UUID", {
          ...debugState,
        });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      console.log("Incoming deal_id:", deal_id);

      const { data: dealData, error: dealError } = await supabase
        .from("deals")
        .select("*")
        .eq("id", deal_id)
        .maybeSingle();
      console.log("get-deal-context deals row", dealData);

      debugState = {
        ...debugState,
        dealRow: dealData,
        dealError,
      };

      const deal = dealData as Row | null;
      if (dealError) {
        console.error("get-deal-context deals query returned an error", {
          ...debugState,
        });
        return new Response(
          JSON.stringify({ error: "Deal not found in deals" }),
          { status: 404 },
        );
      }

      if (!deal) {
        console.error("get-deal-context deals query returned an error or no row", {
          ...debugState,
        });
        return new Response(
          JSON.stringify({ error: "Deal not found in deals" }),
          { status: 404 },
        );
      }

      const { data: feed, error: feedError } = await supabase
        .from("deal_feed")
        .select("*")
        .eq("deal_id", deal_id)
        .maybeSingle();
      console.log("Full deal_feed row:", feed);

      if (feedError) {
        console.error("get-deal-context deal_feed lookup returned an error", {
          ...debugState,
          feedError,
          feed,
        });
      }

      logMissingFields(
        "get-deal-context deal row",
        deal,
        ["id", "address", "suburb", "stage", "created_at", "updated_at"],
        {
          ...debugState,
        },
      );

      debugState = {
        ...debugState,
        feedRow: feed,
        feedError,
      };

      const { data: tasks, error: tasksError } = await supabase
        .from("tasks")
        .select("*")
        .eq("deal_id", deal_id);
      console.log("get-deal-context tasks rows", tasks);

      debugState = {
        ...debugState,
        tasks,
        tasksError,
      };

      if (tasksError) {
        console.error("get-deal-context tasks query returned an error", {
          ...debugState,
        });
      }

      // Fetch enrichment data in parallel — errors are logged but non-fatal
      const [financialsResult, risksResult, siteIntelResult, commsResult] =
        await Promise.all([
          supabase
            .from("financial_snapshots")
            .select("*")
            .eq("deal_id", deal_id)
            .order("created_at", { ascending: false })
            .limit(5),
          supabase
            .from("risks")
            .select("*")
            .eq("deal_id", deal_id),
          supabase
            .from("site_intelligence")
            .select("*")
            .eq("deal_id", deal_id)
            .maybeSingle(),
          supabase
            .from("communications")
            .select("*")
            .eq("deal_id", deal_id)
            .order("sent_at", { ascending: false })
            .limit(20),
        ]);

      if (financialsResult.error) {
        console.error("get-deal-context financial_snapshots error", {
          error: financialsResult.error,
          deal_id,
        });
      }
      if (risksResult.error) {
        console.error("get-deal-context risks error", {
          error: risksResult.error,
          deal_id,
        });
      }
      if (siteIntelResult.error) {
        console.error("get-deal-context site_intelligence error", {
          error: siteIntelResult.error,
          deal_id,
        });
      }
      if (commsResult.error) {
        console.error("get-deal-context communications error", {
          error: commsResult.error,
          deal_id,
        });
      }

      const financials = financialsResult.data ?? [];
      const risks = risksResult.data ?? [];
      const siteIntelligence = siteIntelResult.data ?? null;
      const communications = commsResult.data ?? [];

      console.log("get-deal-context enrichment", {
        financials: financials.length,
        risks: risks.length,
        siteIntelligence: siteIntelligence ? "found" : "not found",
        communications: communications.length,
      });

      const aiActionsPayload = {
        deal_id,
        agent: "get-deal-context",
        action: "context_requested",
        payload: {},
      };
      console.log("get-deal-context ai_actions insert payload", aiActionsPayload);

      await supabase.from("ai_actions").insert(aiActionsPayload);

      const responseBody = {
        deal,
        feed: feed || null,
        tasks: tasks || [],
        financials,
        risks,
        site_intelligence: siteIntelligence,
        communications,
      };
      console.log("get-deal-context response payload", responseBody);

      debugState = {
        ...debugState,
        responseBody,
      };

      return new Response(
        JSON.stringify(responseBody),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      console.error("get-deal-context failed", {
        error: getErrorMessage(err),
        rawError: err,
        ...debugState,
      });
      return new Response(
        JSON.stringify({ error: getErrorMessage(err) }),
        { status: 500 },
      );
    }
  }),
);
