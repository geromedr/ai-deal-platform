import {
  DEFAULT_INVESTOR_MATCH_THRESHOLD,
  listSuggestedInvestorActions,
} from "./investor-actions.ts";

type SupabaseLike = any;

type QueryResult<T> = {
  data: T | null;
  error?: { message?: string } | null;
};

type Row = Record<string, unknown>;

export function throwIfError(result: { error?: { message?: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message ?? "Supabase query failed");
  }
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function mapWithInvestors(
  rows: Row[] | null,
  investorsById: Map<string, Row>,
) {
  return asArray(rows).map((row) => ({
    ...row,
    investor: typeof row.investor_id === "string"
      ? investorsById.get(row.investor_id) ?? null
      : null,
  }));
}

async function fetchLatestDealTerms(
  supabase: SupabaseLike,
  dealId: string,
): Promise<QueryResult<Row>> {
  const result = await supabase
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
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return result as QueryResult<Row>;
}

async function fetchInvestorsByIds(
  supabase: SupabaseLike,
  investorIds: string[],
): Promise<QueryResult<Row[]>> {
  if (investorIds.length === 0) {
    return { data: [] };
  }

  const result = await supabase
    .from("investors")
    .select(`
      id,
      investor_name,
      investor_type,
      capital_min,
      capital_max,
      preferred_strategies,
      risk_profile,
      preferred_states,
      preferred_suburbs,
      min_target_margin_pct,
      status,
      notes,
      metadata,
      created_at,
      updated_at
    `)
    .in("id", investorIds);

  return result as QueryResult<Row[]>;
}

function collectInvestorIds(groups: Array<Row[] | null>) {
  const ids = new Set<string>();

  for (const rows of groups) {
    for (const row of asArray(rows)) {
      if (typeof row.investor_id === "string" && row.investor_id.length > 0) {
        ids.add(row.investor_id);
      }
    }
  }

  return [...ids];
}

export async function loadDealContext(
  supabase: SupabaseLike,
  dealId: string,
) {
  const refreshMatchesResult = await supabase.rpc(
    "refresh_deal_investor_matches",
    { p_deal_id: dealId },
  ) as { error?: { message?: string } | null };

  throwIfError(refreshMatchesResult);

  const [
    dealResult,
    tasksResult,
    communicationsResult,
    financialsResult,
    risksResult,
    dealInvestorsResult,
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
      .eq("id", dealId)
      .single() as Promise<QueryResult<Row>>,

    supabase
      .from("tasks")
      .select("*")
      .eq("deal_id", dealId) as Promise<QueryResult<Row[]>>,

    supabase
      .from("communications")
      .select("*")
      .eq("deal_id", dealId)
      .order("sent_at", { ascending: false })
      .limit(20) as Promise<QueryResult<Row[]>>,

    supabase
      .from("financial_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(5) as Promise<QueryResult<Row[]>>,

    supabase
      .from("risks")
      .select("*")
      .eq("deal_id", dealId) as Promise<QueryResult<Row[]>>,

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
        updated_at
      `)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false }) as Promise<QueryResult<Row[]>>,

    fetchLatestDealTerms(supabase, dealId),

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
        updated_at
      `)
      .eq("deal_id", dealId)
      .order("match_score", { ascending: false })
      .order("updated_at", { ascending: false }) as Promise<QueryResult<Row[]>>,

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
        updated_at
      `)
      .eq("deal_id", dealId)
      .order("updated_at", { ascending: false }) as Promise<QueryResult<Row[]>>,

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
        updated_at
      `)
      .eq("deal_id", dealId)
      .order("communicated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20) as Promise<QueryResult<Row[]>>,

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
        updated_at
      `)
      .eq("deal_id", dealId)
      .order("committed_amount", { ascending: false })
      .order("updated_at", { ascending: false }) as Promise<QueryResult<Row[]>>,

    supabase
      .from("deal_capital_summary")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle() as Promise<QueryResult<Row>>,
  ]);

  throwIfError(dealResult);
  throwIfError(tasksResult);
  throwIfError(communicationsResult);
  throwIfError(financialsResult);
  throwIfError(risksResult);
  throwIfError(dealInvestorsResult);
  throwIfError(dealTermsResult);
  throwIfError(investorMatchesResult);
  throwIfError(investorPipelineResult);
  throwIfError(investorCommunicationsResult);
  throwIfError(capitalAllocationsResult);
  throwIfError(capitalSummaryResult);

  const investorIds = collectInvestorIds([
    dealInvestorsResult.data,
    investorMatchesResult.data,
    investorPipelineResult.data,
    investorCommunicationsResult.data,
    capitalAllocationsResult.data,
  ]);

  const investorsResult = await fetchInvestorsByIds(supabase, investorIds);
  throwIfError(investorsResult);

  const investorsById = new Map(
    asArray(investorsResult.data).map((investor) => [
      investor.id as string,
      investor,
    ]),
  );

  const suggestedInvestorActions = await listSuggestedInvestorActions(
    supabase,
    dealId,
    DEFAULT_INVESTOR_MATCH_THRESHOLD,
  );

  if (!suggestedInvestorActions.success) {
    console.error("deal-context suggested investor actions lookup failed", {
      deal_id: dealId,
      ...suggestedInvestorActions.details,
    });
  }

  return {
    deal: dealResult.data,
    tasks: asArray(tasksResult.data),
    communications: asArray(communicationsResult.data),
    financials: asArray(financialsResult.data),
    risks: asArray(risksResult.data),
    investors: mapWithInvestors(dealInvestorsResult.data, investorsById),
    deal_terms: dealTermsResult.data ?? null,
    investor_pipeline: mapWithInvestors(
      investorPipelineResult.data,
      investorsById,
    ),
    investor_communications: mapWithInvestors(
      investorCommunicationsResult.data,
      investorsById,
    ),
    capital_allocations: mapWithInvestors(
      capitalAllocationsResult.data,
      investorsById,
    ),
    capital_summary: capitalSummaryResult.data ?? null,
    investor_matches: mapWithInvestors(
      investorMatchesResult.data,
      investorsById,
    ),
    suggested_investor_actions: suggestedInvestorActions.success
      ? suggestedInvestorActions.data
      : [],
  };
}
