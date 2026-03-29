import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import {
  CONTACT_INVESTOR_ACTION,
  DEFAULT_INVESTOR_MATCH_THRESHOLD,
  executeContactInvestorAction,
  listSuggestedInvestorActions,
} from "../_shared/investor-actions.ts";

type RequestPayload = {
  deal_id?: string;
  investor_id?: string;
  action_type?: string;
  summary?: string;
  subject?: string;
  communication_type?: string;
  direction?: string;
  communicated_at?: string;
  next_follow_up_at?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  suggestion_threshold?: number;
  suggest_only?: boolean;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

serve(
  createAgentHandler(
    {
      agentName: "investor-actions",
      requiredFields: [{ name: "deal_id", type: "string", uuid: true }],
      validate: (payload) => {
        const errors: string[] = [];
        const actionType = typeof payload.action_type === "string"
          ? payload.action_type.trim()
          : "";
        const suggestOnly = payload.suggest_only === true;

        if (!actionType && !suggestOnly) {
          errors.push("action_type is required unless suggest_only is true");
        }

        if (actionType && actionType !== CONTACT_INVESTOR_ACTION) {
          errors.push(`action_type must be ${CONTACT_INVESTOR_ACTION}`);
        }

        if (actionType) {
          const investorId = typeof payload.investor_id === "string"
            ? payload.investor_id.trim()
            : "";

          if (!investorId) {
            errors.push("investor_id is required when action_type is provided");
          } else if (!isUuid(investorId)) {
            errors.push("investor_id must be a valid UUID");
          }
        }

        if (
          payload.suggestion_threshold !== undefined &&
          (typeof payload.suggestion_threshold !== "number" ||
            !Number.isFinite(payload.suggestion_threshold))
        ) {
          errors.push("suggestion_threshold must be a number");
        }

        return errors;
      },
    },
    async (req) => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceKey) {
        return jsonResponse(
          {
            success: false,
            error: true,
            message: "Supabase environment variables not set",
            details: {
              step: "load_environment",
            },
          },
        );
      }

      try {
        const payload = await req.json() as RequestPayload;
        const dealId = typeof payload.deal_id === "string"
          ? payload.deal_id.trim()
          : "";
        const investorId = typeof payload.investor_id === "string"
          ? payload.investor_id.trim()
          : "";
        const actionType = typeof payload.action_type === "string"
          ? payload.action_type.trim()
          : "";
        const suggestionThreshold =
          typeof payload.suggestion_threshold === "number" &&
            Number.isFinite(payload.suggestion_threshold)
            ? Math.max(0, Math.trunc(payload.suggestion_threshold))
            : DEFAULT_INVESTOR_MATCH_THRESHOLD;
        const metadata = isRecord(payload.metadata) ? payload.metadata : {};

        const supabase = createClient(supabaseUrl, serviceKey);
        const suggestions = await listSuggestedInvestorActions(
          supabase,
          dealId,
          suggestionThreshold,
          investorId || null,
        );

        if (!suggestions.success) {
          return jsonResponse({
            success: false,
            error: true,
            message: suggestions.message,
            details: suggestions.details,
            deal_id: dealId,
            investor_id: investorId || null,
            action_executed: false,
          });
        }

        if (!actionType || payload.suggest_only === true) {
          return jsonResponse({
            success: true,
            deal_id: dealId,
            investor_id: investorId || null,
            action_executed: false,
            suggestion_threshold: suggestionThreshold,
            suggestions: suggestions.data,
          });
        }

        const result = await executeContactInvestorAction(supabase, {
          dealId,
          investorId,
          summary: payload.summary ?? null,
          subject: payload.subject ?? null,
          communicationType: payload.communication_type ?? null,
          direction: payload.direction ?? null,
          communicatedAt: payload.communicated_at ?? null,
          nextFollowUpAt: payload.next_follow_up_at ?? null,
          notes: payload.notes ?? null,
          metadata,
        });

        if (!result.success) {
          return jsonResponse({
            success: false,
            error: true,
            message: result.message,
            details: result.details,
            deal_id: dealId,
            investor_id: investorId,
            action_executed: false,
          });
        }

        const matchingSuggestion = suggestions.data.find((suggestion) =>
          suggestion.investor_id === investorId &&
          suggestion.action_type === CONTACT_INVESTOR_ACTION
        ) ?? null;

        return jsonResponse({
          success: true,
          deal_id: dealId,
          investor_id: investorId,
          action_executed: true,
          result: result.data,
          matched_suggestion: matchingSuggestion,
          remaining_suggestions: suggestions.data.filter((suggestion) =>
            suggestion.investor_id !== investorId
          ),
        });
      } catch (error) {
        console.error("investor-actions unhandled error", {
          message: getErrorMessage(error),
        });
        return jsonResponse(
          {
            success: false,
            error: true,
            message: getErrorMessage(error),
            details: {
              step: "request_handler",
            },
          },
        );
      }
    },
  ),
);
