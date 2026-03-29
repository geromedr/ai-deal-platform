export const DEFAULT_INVESTOR_MATCH_THRESHOLD = 50;
export const CONTACT_INVESTOR_ACTION = "contact_investor";
export const VALID_INVESTOR_ACTION_PIPELINE_STATUSES = [
  "new",
  "contacted",
  "interested",
  "negotiating",
] as const;

type SupabaseLike = any;

type PipelineStatus =
  (typeof VALID_INVESTOR_ACTION_PIPELINE_STATUSES)[number];

type QueryError = {
  message?: string;
};

type QueryResult<T> = {
  data: T | null;
  error?: QueryError | null;
};

type PipelineRow = {
  id?: string;
  deal_id?: string;
  investor_id?: string;
  pipeline_status?: string | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

type InvestorMatchRow = {
  deal_id?: string;
  investor_id?: string;
  match_score?: number | string | null;
  match_band?: string | null;
  investor?: Record<string, unknown> | null;
};

type ContactInvestorInput = {
  dealId: string;
  investorId: string;
  summary?: string | null;
  subject?: string | null;
  communicationType?: string | null;
  direction?: string | null;
  communicatedAt?: string | null;
  nextFollowUpAt?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown>;
};

type InvestorActionFailure = {
  success: false;
  error: true;
  message: string;
  details: {
    step: string;
    reason?: string;
    [key: string]: unknown;
  };
};

type InvestorActionSuccess<T> = {
  success: true;
  data: T;
};

type InvestorActionResult<T> = InvestorActionSuccess<T> | InvestorActionFailure;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFailure(
  step: string,
  message: string,
  details: Record<string, unknown> = {},
): InvestorActionFailure {
  return {
    success: false,
    error: true,
    message,
    details: {
      step,
      ...details,
    },
  };
}

function isFailure<T>(
  result: InvestorActionResult<T>,
): result is InvestorActionFailure {
  return result.success === false;
}

async function runDatabaseStep<T>(
  step: string,
  operation: () => Promise<T>,
  failureMessage: string,
  failureDetails: Record<string, unknown> = {},
): Promise<InvestorActionResult<T>> {
  try {
    return {
      success: true,
      data: await operation(),
    };
  } catch (error) {
    const reason = getErrorMessage(error);
    console.error(`investor-actions database step failed: ${step}`, {
      step,
      reason,
      ...failureDetails,
    });
    return createFailure(step, failureMessage, {
      reason,
      ...failureDetails,
    });
  }
}

function validateRequiredFields(
  step: string,
  fields: Record<string, unknown>,
) {
  for (const [fieldName, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim().length > 0) {
      continue;
    }

    if (value !== undefined && value !== null) {
      continue;
    }

    return createFailure(
      step,
      `Missing required field: ${fieldName}`,
      { field: fieldName },
    );
  }

  return null;
}

function normalizePipelineStatus(status: unknown): PipelineStatus | null {
  const normalized = typeof status === "string"
    ? status.trim().toLowerCase()
    : "";

  switch (normalized) {
    case "new":
    case "contacted":
    case "interested":
    case "negotiating":
      return normalized;
    default:
      return null;
  }
}

export function getNextInvestorPipelineStatus(
  currentStatus: unknown,
): PipelineStatus {
  switch (normalizePipelineStatus(currentStatus) ?? "new") {
    case "new":
      return "contacted";
    case "contacted":
      return "interested";
    case "interested":
      return "negotiating";
    case "negotiating":
      return "negotiating";
    default:
      return "contacted";
  }
}

function buildDefaultContactSummary(
  currentStatus: PipelineStatus,
  nextStatus: PipelineStatus,
) {
  if (currentStatus === nextStatus) {
    return `Investor outreach logged while pipeline remained at ${nextStatus}.`;
  }

  return `Investor outreach logged and pipeline moved from ${currentStatus} to ${nextStatus}.`;
}

async function ensureDealAndInvestorExist(
  supabase: SupabaseLike,
  dealId: string,
  investorId: string,
) {
  const dealResult = await runDatabaseStep(
    "load_deal",
    async () => {
      const result = await supabase.from("deals")
        .select("id")
        .eq("id", dealId)
        .maybeSingle() as QueryResult<{ id: string }>;

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to load deal");
      }

      if (!result.data) {
        throw new Error("Deal not found");
      }

      return result.data;
    },
    "Failed to validate deal",
    { deal_id: dealId },
  );

  if (isFailure(dealResult)) {
    return dealResult;
  }

  const investorResult = await runDatabaseStep(
    "load_investor",
    async () => {
      const result = await supabase.from("investors")
        .select("id")
        .eq("id", investorId)
        .maybeSingle() as QueryResult<{ id: string }>;

      if (result.error) {
        throw new Error(result.error.message ?? "Failed to load investor");
      }

      if (!result.data) {
        throw new Error("Investor not found");
      }

      return result.data;
    },
    "Failed to validate investor",
    { investor_id: investorId },
  );

  if (isFailure(investorResult)) {
    return investorResult;
  }

  return {
    success: true,
    data: {
      deal: dealResult.data,
      investor: investorResult.data,
    },
  };
}

export async function fetchInvestorPipelineRow(
  supabase: SupabaseLike,
  dealId: string,
  investorId: string,
) {
  return await runDatabaseStep(
    "load_investor_pipeline",
    async () => {
      const result = await supabase
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
        .eq("investor_id", investorId)
        .maybeSingle() as QueryResult<PipelineRow>;

      if (result.error) {
        throw new Error(
          result.error.message ?? "Failed to load investor pipeline",
        );
      }

      return result.data ?? null;
    },
    "Failed to load investor pipeline",
    {
      deal_id: dealId,
      investor_id: investorId,
    },
  );
}

export async function executeContactInvestorAction(
  supabase: SupabaseLike,
  input: ContactInvestorInput,
) {
  const existenceResult = await ensureDealAndInvestorExist(
    supabase,
    input.dealId,
    input.investorId,
  );

  if (isFailure(existenceResult)) {
    return existenceResult;
  }

  const existingPipeline = await fetchInvestorPipelineRow(
    supabase,
    input.dealId,
    input.investorId,
  );

  if (isFailure(existingPipeline)) {
    return existingPipeline;
  }

  const existingPipelineRow = existingPipeline.data;
  const rawCurrentStatus = existingPipelineRow?.pipeline_status;
  const currentStatus = rawCurrentStatus == null ||
      rawCurrentStatus === ""
    ? "new"
    : normalizePipelineStatus(rawCurrentStatus);

  if (!currentStatus) {
    const failure = createFailure(
      "validate_pipeline_transition",
      "Current pipeline status is not valid for investor-actions",
      {
        current_status: rawCurrentStatus,
        allowed_statuses: VALID_INVESTOR_ACTION_PIPELINE_STATUSES,
      },
    );
    console.error("investor-actions validation failed", failure.details);
    return failure;
  }

  const nextStatus = getNextInvestorPipelineStatus(currentStatus);
  const communicatedAt = input.communicatedAt?.trim() ||
    new Date().toISOString();
  const subject = input.subject?.trim() || null;
  const communicationType = input.communicationType?.trim() || "note";
  const direction = input.direction?.trim() || "outbound";
  const summary = input.summary?.trim() ||
    buildDefaultContactSummary(currentStatus, nextStatus);
  const mergedMetadata = {
    ...(isRecord(existingPipelineRow?.metadata) ? existingPipelineRow.metadata : {}),
    ...(isRecord(input.metadata) ? input.metadata : {}),
    action_type: CONTACT_INVESTOR_ACTION,
    pipeline_transition: {
      from: currentStatus,
      to: nextStatus,
    },
  };

  const communicationInsertValidation = validateRequiredFields(
    "validate_investor_communications_insert",
    {
      deal_id: input.dealId,
      investor_id: input.investorId,
      status: "logged",
      summary,
    },
  );

  if (communicationInsertValidation) {
    console.error(
      "investor-actions validation failed",
      communicationInsertValidation.details,
    );
    return communicationInsertValidation;
  }

  const communicationResult = await runDatabaseStep(
    "insert_investor_communication",
    async () => {
      const { data, error } = await supabase
        .from("investor_communications")
        .insert({
          investor_id: input.investorId,
          deal_id: input.dealId,
          communication_type: communicationType,
          direction,
          subject,
          summary,
          status: "logged",
          metadata: mergedMetadata,
          communicated_at: communicatedAt,
        })
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
        .single();

      if (error) {
        throw new Error(
          error.message ?? "Failed to log investor communication",
        );
      }

      return data;
    },
    "Failed to insert investor communication",
    {
      deal_id: input.dealId,
      investor_id: input.investorId,
      status: "logged",
    },
  );

  if (isFailure(communicationResult)) {
    return communicationResult;
  }

  const communicationRow = communicationResult.data;

  const pipelineInsertValidation = validateRequiredFields(
    "validate_investor_deal_pipeline_insert",
    {
      deal_id: input.dealId,
      investor_id: input.investorId,
      status: nextStatus,
    },
  );

  if (pipelineInsertValidation) {
    console.error(
      "investor-actions validation failed",
      pipelineInsertValidation.details,
    );
    return pipelineInsertValidation;
  }

  if (!VALID_INVESTOR_ACTION_PIPELINE_STATUSES.includes(nextStatus)) {
    const failure = createFailure(
      "validate_pipeline_transition",
      "Next pipeline status is not valid for investor-actions",
      {
        next_status: nextStatus,
        allowed_statuses: VALID_INVESTOR_ACTION_PIPELINE_STATUSES,
      },
    );
    console.error("investor-actions validation failed", failure.details);
    return failure;
  }

  const pipelinePayload = {
    p_deal_id: input.dealId,
    p_investor_id: input.investorId,
    p_pipeline_status: nextStatus,
    p_last_contacted_at: communicatedAt,
    p_next_follow_up_at: input.nextFollowUpAt ??
      existingPipelineRow?.next_follow_up_at ?? null,
    p_notes: input.notes ?? existingPipelineRow?.notes ?? summary,
    p_metadata: mergedMetadata,
  };

  const pipelineResult = await runDatabaseStep(
    "upsert_investor_deal_pipeline",
    async () => {
      const {
        data,
        error,
      } = await supabase.rpc(
        "upsert_investor_deal_pipeline",
        pipelinePayload,
      ) as QueryResult<PipelineRow>;

      if (error) {
        throw new Error(
          error.message ?? "Failed to update investor pipeline",
        );
      }

      return data;
    },
    "Failed to update investor pipeline",
    {
      deal_id: input.dealId,
      investor_id: input.investorId,
      status: nextStatus,
    },
  );

  if (isFailure(pipelineResult)) {
    return {
      ...pipelineResult,
      details: {
        ...pipelineResult.details,
        communication_id: communicationRow.id ?? null,
      },
    };
  }

  const pipelineRow = pipelineResult.data;

  try {
    const { error } = await supabase.from("ai_actions").insert({
      deal_id: input.dealId,
      agent: "investor-actions",
      action: CONTACT_INVESTOR_ACTION,
      metadata: {
        investor_id: input.investorId,
        communication_id: communicationRow.id,
        pipeline_status_from: currentStatus,
        pipeline_status_to: nextStatus,
        communicated_at: communicatedAt,
        summary,
      },
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(error.message ?? "Failed to log investor action");
    }
  } catch (error) {
    console.warn("investor-actions ai_actions logging failed", {
      reason: getErrorMessage(error),
      deal_id: input.dealId,
      investor_id: input.investorId,
      communication_id: communicationRow.id ?? null,
      status: nextStatus,
    });
  }

  return {
    success: true,
    data: {
      action_type: CONTACT_INVESTOR_ACTION,
      deal_id: input.dealId,
      investor_id: input.investorId,
      pipeline_transition: {
        from: currentStatus,
        to: nextStatus,
      },
      communication: communicationRow,
      pipeline: pipelineRow,
    },
  };
}

export async function listSuggestedInvestorActions(
  supabase: SupabaseLike,
  dealId: string,
  threshold = DEFAULT_INVESTOR_MATCH_THRESHOLD,
  investorId?: string | null,
) {
  return await runDatabaseStep(
    "list_suggested_investor_actions",
    async () => {
      const matchQuery = supabase
        .from("deal_investor_matches")
        .select(`
          deal_id,
          investor_id,
          match_score,
          match_band,
          investor:investors (
            id,
            investor_name,
            investor_type,
            status
          )
        `)
        .eq("deal_id", dealId)
        .gte("match_score", threshold)
        .order("match_score", { ascending: false })
        .order("updated_at", { ascending: false });

      const pipelineQuery = supabase
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
        .eq("deal_id", dealId);

      if (investorId) {
        matchQuery.eq("investor_id", investorId);
        pipelineQuery.eq("investor_id", investorId);
      }

      const [matchesResult, pipelineResult] = await Promise.all([
        matchQuery,
        pipelineQuery,
      ]) as [QueryResult<InvestorMatchRow[]>, QueryResult<PipelineRow[]>];

      if (matchesResult.error) {
        throw new Error(
          matchesResult.error.message ?? "Failed to load investor matches",
        );
      }

      if (pipelineResult.error) {
        throw new Error(
          pipelineResult.error.message ?? "Failed to load investor pipeline",
        );
      }

      const pipelineByInvestorId = new Map(
        asArray(pipelineResult.data).map((row) => [row.investor_id ?? "", row]),
      );

      return asArray(matchesResult.data)
        .map((match) => {
          const resolvedInvestorId = match.investor_id ?? "";
          const existingPipeline = pipelineByInvestorId.get(resolvedInvestorId) ??
            null;
          const currentStatus = normalizePipelineStatus(
            existingPipeline?.pipeline_status,
          ) ?? "new";

          if (currentStatus !== "new") return null;

          return {
            deal_id: dealId,
            investor_id: resolvedInvestorId,
            action_type: CONTACT_INVESTOR_ACTION,
            reason: `Investor match score ${
              match.match_score ?? 0
            } is at or above threshold ${threshold}.`,
            match_score: match.match_score ?? 0,
            match_band: match.match_band ?? null,
            threshold,
            current_pipeline_status: currentStatus,
            target_pipeline_status: getNextInvestorPipelineStatus(currentStatus),
            investor: match.investor ?? null,
          };
        })
        .filter((item) => item !== null);
    },
    "Failed to list suggested investor actions",
    {
      deal_id: dealId,
      investor_id: investorId ?? null,
      threshold,
    },
  );
}

export function getInvestorActionErrorMessage(error: unknown) {
  return getErrorMessage(error);
}
