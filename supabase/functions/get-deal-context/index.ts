import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { getErrorMessage } from "../_shared/deal-context.ts";

type Row = Record<string, unknown>;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
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

      const dealFeedQueryResponse = await supabase
        .from("deal_feed")
        .select("*, deals(*)")
        .eq("id", deal_id)
        .single();
      const { data, error: dealFeedError } = dealFeedQueryResponse;
      console.log("get-deal-context deal_feed query response", dealFeedQueryResponse);
      console.log("get-deal-context deal_feed row", data);

      debugState = {
        ...debugState,
        dealFeedQueryResponse,
        dealFeedRow: data,
        dealFeedError,
      };

      if (dealFeedError) {
        console.error("get-deal-context deal_feed query returned an error", {
          ...debugState,
        });
      }

      const feed = data as Row | null;
      const deal = (feed as { deals?: Row | null } | null)?.deals ?? null;
      if (!deal) {
        console.error("get-deal-context deal_feed row did not contain a linked deal", {
          ...debugState,
        });
        return new Response(
          JSON.stringify({ error: "Deal not found in deal_feed" }),
          { status: 404 },
        );
      }

      logMissingFields(
        "get-deal-context deal row",
        deal,
        ["id", "address", "suburb", "stage", "created_at", "updated_at"],
        {
          ...debugState,
        },
      );

      const resolvedDealId = normalizeString(deal.id);
      if (!resolvedDealId) {
        console.error("get-deal-context linked deal is missing an id", {
          ...debugState,
          deal,
        });
        return new Response(
          JSON.stringify({ error: "Linked deal is missing an id" }),
          { status: 500 },
        );
      }

      console.log("TASK QUERY USING", resolvedDealId);
      console.log("get-deal-context resolvedDealId", { resolvedDealId });

      debugState = {
        ...debugState,
        resolvedDealId,
      };

      const tasksQueryResponse = await supabase
        .from("tasks")
        .select("*")
        .eq("deal_id", resolvedDealId)
        .order("created_at", { ascending: false });
      const { data: tasks, error: tasksError } = tasksQueryResponse;
      console.log("get-deal-context tasks query response", tasksQueryResponse);
      console.log("get-deal-context tasks rows", tasks);

      debugState = {
        ...debugState,
        tasksQueryResponse,
        tasks,
        tasksError,
      };

      if (tasksError) {
        console.error("get-deal-context tasks query returned an error", {
          ...debugState,
        });
      }

      const aiActionsPayload = {
        deal_id,
        agent: "get-deal-context",
        action: "context_requested",
        payload: {},
      };
      console.log("get-deal-context ai_actions insert payload", aiActionsPayload);

      await supabase.from("ai_actions").insert(aiActionsPayload);

      const responseBody = { deal, feed, tasks };
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
