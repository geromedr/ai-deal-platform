import { callEdgeFunction } from "./callEdgeFunction";

export type OperatorSummary = {
  success: boolean;
  total_active_deals: number;
  total_high_priority_deals: number;
  recent_notifications_count: number;
  pending_retries_count: number;
  latest_system_health_status: "healthy" | "warning" | "error" | null;
  latest_generated_reports_count: number;
  latest_system_health_checked_at: string | null;
};

export type UsageRow = {
  agent_name: string;
  calls: number;
  estimated_cost: number;
};

export type UsageSummary = {
  success: boolean;
  generated_at: string;
  windows: {
    last_24_hours: UsageRow[];
    last_7_days: UsageRow[];
  };
};

export type ApprovalQueueItem = {
  id: string;
  deal_id: string | null;
  approval_type: string | null;
  status: string;
  requested_by_agent: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export async function getOperatorSummary(): Promise<OperatorSummary> {
  return callEdgeFunction<OperatorSummary>("get-operator-summary", {});
}

export async function getUsageSummary(): Promise<UsageSummary> {
  return callEdgeFunction<UsageSummary>("get-usage-summary", {});
}
