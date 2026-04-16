import { callEdgeFunction } from "./callEdgeFunction";

export type InvestorMatch = {
  deal_id: string;
  investor_id: string;
  match_score: number | null;
  match_band: string | null;
  investor: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    preferred_strategy: string | null;
    min_investment: number | null;
    max_investment: number | null;
    pipeline_status?: string | null;
  } | null;
};

export type InvestorActionsResponse = {
  success: boolean;
  suggested_actions?: Array<{
    investor_id: string;
    investor_name: string | null;
    action: string;
    reason: string;
    match_score: number | null;
    match_band: string | null;
    pipeline_status: string | null;
  }>;
  matches?: InvestorMatch[];
  message?: string;
};

export async function getInvestorMatches(dealId: string): Promise<InvestorActionsResponse> {
  return callEdgeFunction<InvestorActionsResponse>("investor-actions", {
    deal_id: dealId,
    suggest_only: true,
  });
}
