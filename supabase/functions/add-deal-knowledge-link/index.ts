import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

type RequestPayload = {
  deal_id?: string;
  document_type?: string;
  source_ref?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

serve(
  createAgentHandler(
    {
      agentName: "add-deal-knowledge-link",
      requiredFields: [
        { name: "deal_id", type: "string", uuid: true },
        { name: "document_type", type: "string" },
        { name: "source_ref", type: "string" },
      ],
    },
    async (req) => {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !serviceKey) {
        return jsonResponse(
          { error: "Supabase environment variables not set" },
          500,
        );
      }

      try {
        const payload = await req.json() as RequestPayload;
        const dealId = typeof payload.deal_id === "string"
          ? payload.deal_id.trim()
          : "";
        const documentType = typeof payload.document_type === "string"
          ? payload.document_type.trim()
          : "";
        const sourceRef = typeof payload.source_ref === "string"
          ? payload.source_ref.trim()
          : "";
        const summary = typeof payload.summary === "string"
          ? payload.summary.trim()
          : null;
        const metadata = isRecord(payload.metadata) ? payload.metadata : {};

        if (!isUuid(dealId)) {
          return jsonResponse({ error: "deal_id must be a valid UUID" }, 400);
        }

        const supabase = createClient(supabaseUrl, serviceKey);
        const { data: dealRow, error: dealError } = await supabase
          .from("deals")
          .select("id")
          .eq("id", dealId)
          .maybeSingle();

        if (dealError) throw new Error(dealError.message);
        if (!dealRow) return jsonResponse({ error: "Deal not found" }, 404);

        const { data: linkRow, error: linkError } = await supabase
          .from("deal_knowledge_links")
          .insert({
            deal_id: dealId,
            document_type: documentType,
            source_ref: sourceRef,
            summary,
            metadata,
          })
          .select("id, deal_id, document_type, source_ref, summary, metadata, created_at")
          .single();

        if (linkError) throw new Error(linkError.message);

        const { error: actionError } = await supabase.from("ai_actions").insert({
          deal_id: dealId,
          agent: "add-deal-knowledge-link",
          action: "deal_knowledge_link_added",
          source: "deal_knowledge_links",
          payload: {
            link_id: linkRow.id,
            document_type: documentType,
            source_ref: sourceRef,
            summary,
          },
        });

        if (actionError) throw new Error(actionError.message);

        return jsonResponse({
          success: true,
          id: linkRow.id,
          deal_id: linkRow.deal_id,
          document_type: linkRow.document_type,
          source_ref: linkRow.source_ref,
          summary: linkRow.summary,
          metadata: linkRow.metadata,
          created_at: linkRow.created_at,
        });
      } catch (error) {
        return jsonResponse({ error: getErrorMessage(error) }, 500);
      }
    },
  ),
);
