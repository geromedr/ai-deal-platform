import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { createAgentHandler } from "../_shared/agent-runtime.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl) throw new Error("SUPABASE_URL not set");
if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");

const supabase = createClient(supabaseUrl, serviceKey);

function mapDealInvestors(rows: Array<Record<string, unknown>> | null) {
  return (rows ?? []).map((row) => {
    const { investors, ...link } = row;

    return {
      ...link,
      investor: investors ?? null,
    };
  });
}

function mapInvestorMatches(rows: Array<Record<string, unknown>> | null) {
  return (rows ?? []).map((row) => {
    const { investors, ...match } = row;

    return {
      ...match,
      investor: investors ?? null,
    };
  });
}

function mapInvestorPipeline(rows: Array<Record<string, unknown>> | null) {
  return (rows ?? []).map((row) => {
    const { investors, ...pipeline } = row;

    return {
      ...pipeline,
      investor: investors ?? null,
    };
  });
}

function mapInvestorCommunications(
  rows: Array<Record<string, unknown>> | null,
) {
  return (rows ?? []).map((row) => {
    const { investors, ...communication } = row;

    return {
      ...communication,
      investor: investors ?? null,
    };
  });
}

function mapCapitalAllocations(rows: Array<Record<string, unknown>> | null) {
  return (rows ?? []).map((row) => {
    const { investors, ...allocation } = row;

    return {
      ...allocation,
      investor: investors ?? null,
    };
  });
}

function mapCapitalSummary(row: Record<string, unknown> | null) {
  return row ?? null;
}

function throwIfError(result: { error?: { message?: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message ?? "Supabase query failed");
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

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

      const refreshMatchesResult = await supabase.rpc(
        "refresh_deal_investor_matches",
        {
          p_deal_id: deal_id,
        },
      );

      throwIfError(refreshMatchesResult);

      const [
        dealResult,
        tasksResult,
        communicationsResult,
        financialsResult,
        risksResult,
        investorsResult,
        dealTermsResult,
        investorMatchesResult,
        investorPipelineResult,
        investorCommunicationsResult,
        capitalAllocationsResult,
        capitalSummaryResult,
      ] = await Promise.all([
        supabase
          .from("deals")
          .select("*")
          .eq("id", deal_id)
          .single(),

        supabase
          .from("tasks")
          .select("*")
          .eq("deal_id", deal_id),

        supabase
          .from("communications")
          .select("*")
          .eq("deal_id", deal_id)
          .order("sent_at", { ascending: false })
          .limit(20),

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
          .from("deal_investors")
          .select(`
          id,
          deal_id,
          investor_id,
          relationship_stage,
          notes,
          metadata,
          created_at,
          updated_at,
          investors (
            id,
            investor_name,
            investor_type,
            capital_min,
            capital_max,
            status,
            notes,
            metadata,
            created_at,
            updated_at
          )
        `)
          .eq("deal_id", deal_id)
          .order("created_at", { ascending: false }),

        supabase
          .from("deal_terms")
          .select(`
          id,
          deal_id,
          sponsor_fee_pct,
          equity_split,
          preferred_return_pct,
          notes,
          metadata,
          created_at,
          updated_at
        `)
          .eq("deal_id", deal_id)
          .maybeSingle(),

        supabase
          .from("deal_investor_matches")
          .select(`
          id,
          deal_id,
          investor_id,
          match_score,
          match_band,
          strategy_score,
          budget_score,
          risk_score,
          location_score,
          match_reasons,
          deal_snapshot,
          created_at,
          updated_at,
          investors (
            id,
            investor_name,
            investor_type,
            capital_min,
            capital_max,
            status,
            preferred_strategies,
            risk_profile,
            preferred_states,
            preferred_suburbs,
            min_target_margin_pct,
            notes,
            metadata,
            created_at,
            updated_at
          )
        `)
          .eq("deal_id", deal_id)
          .order("match_score", { ascending: false })
          .order("updated_at", { ascending: false }),

        supabase
          .from("investor_deal_pipeline")
          .select(`
          id,
          deal_id,
          investor_id,
          pipeline_status,
          last_contacted_at,
          next_follow_up_at,
          notes,
          metadata,
          created_at,
          updated_at,
          investors (
            id,
            investor_name,
            investor_type,
            capital_min,
            capital_max,
            status,
            notes,
            metadata,
            created_at,
            updated_at
          )
        `)
          .eq("deal_id", deal_id)
          .order("updated_at", { ascending: false }),

        supabase
          .from("investor_communications")
          .select(`
          id,
          investor_id,
          deal_id,
          communication_type,
          direction,
          subject,
          summary,
          status,
          metadata,
          communicated_at,
          created_at,
          updated_at,
          investors (
            id,
            investor_name,
            investor_type,
            status
          )
        `)
          .eq("deal_id", deal_id)
          .order("communicated_at", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(20),

        supabase
          .from("deal_capital_allocations")
          .select(`
          id,
          deal_id,
          investor_id,
          committed_amount,
          allocation_pct,
          status,
          notes,
          metadata,
          created_at,
          updated_at,
          investors (
            id,
            investor_name,
            investor_type,
            capital_min,
            capital_max,
            status,
            notes,
            metadata,
            created_at,
            updated_at
          )
        `)
          .eq("deal_id", deal_id)
          .order("committed_amount", { ascending: false })
          .order("updated_at", { ascending: false }),

        supabase
          .from("deal_capital_summary")
          .select("*")
          .eq("deal_id", deal_id)
          .maybeSingle(),
      ]);

      throwIfError(dealResult);
      throwIfError(tasksResult);
      throwIfError(communicationsResult);
      throwIfError(financialsResult);
      throwIfError(risksResult);
      throwIfError(investorsResult);
      throwIfError(dealTermsResult);
      throwIfError(investorMatchesResult);
      throwIfError(investorPipelineResult);
      throwIfError(investorCommunicationsResult);
      throwIfError(capitalAllocationsResult);
      throwIfError(capitalSummaryResult);

      const context = {
        deal: dealResult.data,
        tasks: tasksResult.data,
        communications: communicationsResult.data,
        financials: financialsResult.data,
        risks: risksResult.data,
        investors: mapDealInvestors(
          investorsResult.data as Array<Record<string, unknown>> | null,
        ),
        deal_terms: dealTermsResult.data,
        investor_pipeline: mapInvestorPipeline(
          investorPipelineResult.data as Array<Record<string, unknown>> | null,
        ),
        investor_communications: mapInvestorCommunications(
          investorCommunicationsResult.data as
            | Array<Record<string, unknown>>
            | null,
        ),
        capital_allocations: mapCapitalAllocations(
          capitalAllocationsResult.data as
            | Array<Record<string, unknown>>
            | null,
        ),
        capital_summary: mapCapitalSummary(
          capitalSummaryResult.data as Record<string, unknown> | null,
        ),
        investor_matches: mapInvestorMatches(
          investorMatchesResult.data as Array<Record<string, unknown>> | null,
        ),
      };

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
