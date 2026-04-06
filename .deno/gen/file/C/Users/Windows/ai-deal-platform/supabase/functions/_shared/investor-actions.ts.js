export const DEFAULT_INVESTOR_MATCH_THRESHOLD = 50;
export const CONTACT_INVESTOR_ACTION = "contact_investor";
export const VALID_INVESTOR_ACTION_PIPELINE_STATUSES = [
  "new",
  "contacted",
  "interested",
  "negotiating"
];
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}
function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function createFailure(step, message, details = {}) {
  return {
    success: false,
    error: true,
    message,
    details: {
      step,
      ...details
    }
  };
}
function isFailure(result) {
  return result.success === false;
}
async function runDatabaseStep(step, operation, failureMessage, failureDetails = {}) {
  try {
    return {
      success: true,
      data: await operation()
    };
  } catch (error) {
    const reason = getErrorMessage(error);
    console.error(`investor-actions database step failed: ${step}`, {
      step,
      reason,
      ...failureDetails
    });
    return createFailure(step, failureMessage, {
      reason,
      ...failureDetails
    });
  }
}
function validateRequiredFields(step, fields) {
  for (const [fieldName, value] of Object.entries(fields)){
    if (typeof value === "string" && value.trim().length > 0) {
      continue;
    }
    if (value !== undefined && value !== null) {
      continue;
    }
    return createFailure(step, `Missing required field: ${fieldName}`, {
      field: fieldName
    });
  }
  return null;
}
function normalizePipelineStatus(status) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch(normalized){
    case "new":
    case "contacted":
    case "interested":
    case "negotiating":
      return normalized;
    default:
      return null;
  }
}
export function getNextInvestorPipelineStatus(currentStatus) {
  switch(normalizePipelineStatus(currentStatus) ?? "new"){
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
function buildDefaultContactSummary(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    return `Investor outreach logged while pipeline remained at ${nextStatus}.`;
  }
  return `Investor outreach logged and pipeline moved from ${currentStatus} to ${nextStatus}.`;
}
async function ensureDealAndInvestorExist(supabase, dealId, investorId) {
  const dealResult = await runDatabaseStep("load_deal", async ()=>{
    const result = await supabase.from("deals").select("id").eq("id", dealId).maybeSingle();
    if (result.error) {
      throw new Error(result.error.message ?? "Failed to load deal");
    }
    if (!result.data) {
      throw new Error("Deal not found");
    }
    return result.data;
  }, "Failed to validate deal", {
    deal_id: dealId
  });
  if (isFailure(dealResult)) {
    return dealResult;
  }
  const investorResult = await runDatabaseStep("load_investor", async ()=>{
    const result = await supabase.from("investors").select("id").eq("id", investorId).maybeSingle();
    if (result.error) {
      throw new Error(result.error.message ?? "Failed to load investor");
    }
    if (!result.data) {
      throw new Error("Investor not found");
    }
    return result.data;
  }, "Failed to validate investor", {
    investor_id: investorId
  });
  if (isFailure(investorResult)) {
    return investorResult;
  }
  return {
    success: true,
    data: {
      deal: dealResult.data,
      investor: investorResult.data
    }
  };
}
export async function fetchInvestorPipelineRow(supabase, dealId, investorId) {
  return await runDatabaseStep("load_investor_pipeline", async ()=>{
    const result = await supabase.from("investor_deal_pipeline").select(`
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
        `).eq("deal_id", dealId).eq("investor_id", investorId).maybeSingle();
    if (result.error) {
      throw new Error(result.error.message ?? "Failed to load investor pipeline");
    }
    return result.data ?? null;
  }, "Failed to load investor pipeline", {
    deal_id: dealId,
    investor_id: investorId
  });
}
export async function executeContactInvestorAction(supabase, input) {
  const existenceResult = await ensureDealAndInvestorExist(supabase, input.dealId, input.investorId);
  if (isFailure(existenceResult)) {
    return existenceResult;
  }
  const existingPipeline = await fetchInvestorPipelineRow(supabase, input.dealId, input.investorId);
  if (isFailure(existingPipeline)) {
    return existingPipeline;
  }
  const existingPipelineRow = existingPipeline.data;
  const rawCurrentStatus = existingPipelineRow?.pipeline_status;
  const currentStatus = rawCurrentStatus == null || rawCurrentStatus === "" ? "new" : normalizePipelineStatus(rawCurrentStatus);
  if (!currentStatus) {
    const failure = createFailure("validate_pipeline_transition", "Current pipeline status is not valid for investor-actions", {
      current_status: rawCurrentStatus,
      allowed_statuses: VALID_INVESTOR_ACTION_PIPELINE_STATUSES
    });
    console.error("investor-actions validation failed", failure.details);
    return failure;
  }
  const nextStatus = getNextInvestorPipelineStatus(currentStatus);
  const communicatedAt = input.communicatedAt?.trim() || new Date().toISOString();
  const subject = input.subject?.trim() || null;
  const communicationType = input.communicationType?.trim() || "note";
  const direction = input.direction?.trim() || "outbound";
  const summary = input.summary?.trim() || buildDefaultContactSummary(currentStatus, nextStatus);
  const mergedMetadata = {
    ...isRecord(existingPipelineRow?.metadata) ? existingPipelineRow.metadata : {},
    ...isRecord(input.metadata) ? input.metadata : {},
    action_type: CONTACT_INVESTOR_ACTION,
    pipeline_transition: {
      from: currentStatus,
      to: nextStatus
    }
  };
  const communicationInsertValidation = validateRequiredFields("validate_investor_communications_insert", {
    deal_id: input.dealId,
    investor_id: input.investorId,
    status: "logged",
    summary
  });
  if (communicationInsertValidation) {
    console.error("investor-actions validation failed", communicationInsertValidation.details);
    return communicationInsertValidation;
  }
  const communicationResult = await runDatabaseStep("insert_investor_communication", async ()=>{
    const { data, error } = await supabase.from("investor_communications").insert({
      investor_id: input.investorId,
      deal_id: input.dealId,
      communication_type: communicationType,
      direction,
      subject,
      summary,
      status: "logged",
      metadata: mergedMetadata,
      communicated_at: communicatedAt
    }).select(`
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
        `).single();
    if (error) {
      throw new Error(error.message ?? "Failed to log investor communication");
    }
    return data;
  }, "Failed to insert investor communication", {
    deal_id: input.dealId,
    investor_id: input.investorId,
    status: "logged"
  });
  if (isFailure(communicationResult)) {
    return communicationResult;
  }
  const communicationRow = communicationResult.data;
  const pipelineInsertValidation = validateRequiredFields("validate_investor_deal_pipeline_insert", {
    deal_id: input.dealId,
    investor_id: input.investorId,
    status: nextStatus
  });
  if (pipelineInsertValidation) {
    console.error("investor-actions validation failed", pipelineInsertValidation.details);
    return pipelineInsertValidation;
  }
  if (!VALID_INVESTOR_ACTION_PIPELINE_STATUSES.includes(nextStatus)) {
    const failure = createFailure("validate_pipeline_transition", "Next pipeline status is not valid for investor-actions", {
      next_status: nextStatus,
      allowed_statuses: VALID_INVESTOR_ACTION_PIPELINE_STATUSES
    });
    console.error("investor-actions validation failed", failure.details);
    return failure;
  }
  const pipelinePayload = {
    p_deal_id: input.dealId,
    p_investor_id: input.investorId,
    p_pipeline_status: nextStatus,
    p_last_contacted_at: communicatedAt,
    p_next_follow_up_at: input.nextFollowUpAt ?? existingPipelineRow?.next_follow_up_at ?? null,
    p_notes: input.notes ?? existingPipelineRow?.notes ?? summary,
    p_metadata: mergedMetadata
  };
  const pipelineResult = await runDatabaseStep("upsert_investor_deal_pipeline", async ()=>{
    const { data, error } = await supabase.rpc("upsert_investor_deal_pipeline", pipelinePayload);
    if (error) {
      throw new Error(error.message ?? "Failed to update investor pipeline");
    }
    return data;
  }, "Failed to update investor pipeline", {
    deal_id: input.dealId,
    investor_id: input.investorId,
    status: nextStatus
  });
  if (isFailure(pipelineResult)) {
    return {
      ...pipelineResult,
      details: {
        ...pipelineResult.details,
        communication_id: communicationRow.id ?? null
      }
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
        summary
      },
      created_at: new Date().toISOString()
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
      status: nextStatus
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
        to: nextStatus
      },
      communication: communicationRow,
      pipeline: pipelineRow
    }
  };
}
export async function listSuggestedInvestorActions(supabase, dealId, threshold = DEFAULT_INVESTOR_MATCH_THRESHOLD, investorId) {
  return await runDatabaseStep("list_suggested_investor_actions", async ()=>{
    const matchQuery = supabase.from("deal_investor_matches").select(`
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
        `).eq("deal_id", dealId).gte("match_score", threshold).order("match_score", {
      ascending: false
    }).order("updated_at", {
      ascending: false
    });
    const pipelineQuery = supabase.from("investor_deal_pipeline").select(`
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
        `).eq("deal_id", dealId);
    if (investorId) {
      matchQuery.eq("investor_id", investorId);
      pipelineQuery.eq("investor_id", investorId);
    }
    const [matchesResult, pipelineResult] = await Promise.all([
      matchQuery,
      pipelineQuery
    ]);
    if (matchesResult.error) {
      throw new Error(matchesResult.error.message ?? "Failed to load investor matches");
    }
    if (pipelineResult.error) {
      throw new Error(pipelineResult.error.message ?? "Failed to load investor pipeline");
    }
    const pipelineByInvestorId = new Map(asArray(pipelineResult.data).map((row)=>[
        row.investor_id ?? "",
        row
      ]));
    return asArray(matchesResult.data).map((match)=>{
      const resolvedInvestorId = match.investor_id ?? "";
      const existingPipeline = pipelineByInvestorId.get(resolvedInvestorId) ?? null;
      const currentStatus = normalizePipelineStatus(existingPipeline?.pipeline_status) ?? "new";
      if (currentStatus !== "new") return null;
      return {
        deal_id: dealId,
        investor_id: resolvedInvestorId,
        action_type: CONTACT_INVESTOR_ACTION,
        reason: `Investor match score ${match.match_score ?? 0} is at or above threshold ${threshold}.`,
        match_score: match.match_score ?? 0,
        match_band: match.match_band ?? null,
        threshold,
        current_pipeline_status: currentStatus,
        target_pipeline_status: getNextInvestorPipelineStatus(currentStatus),
        investor: match.investor ?? null
      };
    }).filter((item)=>item !== null);
  }, "Failed to list suggested investor actions", {
    deal_id: dealId,
    investor_id: investorId ?? null,
    threshold
  });
}
export function getInvestorActionErrorMessage(error) {
  return getErrorMessage(error);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZpbGU6Ly8vQzovVXNlcnMvV2luZG93cy9haS1kZWFsLXBsYXRmb3JtL3N1cGFiYXNlL2Z1bmN0aW9ucy9fc2hhcmVkL2ludmVzdG9yLWFjdGlvbnMudHMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGNvbnN0IERFRkFVTFRfSU5WRVNUT1JfTUFUQ0hfVEhSRVNIT0xEID0gNTA7XG5leHBvcnQgY29uc3QgQ09OVEFDVF9JTlZFU1RPUl9BQ1RJT04gPSBcImNvbnRhY3RfaW52ZXN0b3JcIjtcbmV4cG9ydCBjb25zdCBWQUxJRF9JTlZFU1RPUl9BQ1RJT05fUElQRUxJTkVfU1RBVFVTRVMgPSBbXG4gIFwibmV3XCIsXG4gIFwiY29udGFjdGVkXCIsXG4gIFwiaW50ZXJlc3RlZFwiLFxuICBcIm5lZ290aWF0aW5nXCIsXG5dIGFzIGNvbnN0O1xuXG50eXBlIFN1cGFiYXNlTGlrZSA9IGFueTtcblxudHlwZSBQaXBlbGluZVN0YXR1cyA9XG4gICh0eXBlb2YgVkFMSURfSU5WRVNUT1JfQUNUSU9OX1BJUEVMSU5FX1NUQVRVU0VTKVtudW1iZXJdO1xuXG50eXBlIFF1ZXJ5RXJyb3IgPSB7XG4gIG1lc3NhZ2U/OiBzdHJpbmc7XG59O1xuXG50eXBlIFF1ZXJ5UmVzdWx0PFQ+ID0ge1xuICBkYXRhOiBUIHwgbnVsbDtcbiAgZXJyb3I/OiBRdWVyeUVycm9yIHwgbnVsbDtcbn07XG5cbnR5cGUgUGlwZWxpbmVSb3cgPSB7XG4gIGlkPzogc3RyaW5nO1xuICBkZWFsX2lkPzogc3RyaW5nO1xuICBpbnZlc3Rvcl9pZD86IHN0cmluZztcbiAgcGlwZWxpbmVfc3RhdHVzPzogc3RyaW5nIHwgbnVsbDtcbiAgbGFzdF9jb250YWN0ZWRfYXQ/OiBzdHJpbmcgfCBudWxsO1xuICBuZXh0X2ZvbGxvd191cF9hdD86IHN0cmluZyB8IG51bGw7XG4gIG5vdGVzPzogc3RyaW5nIHwgbnVsbDtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGw7XG4gIGNyZWF0ZWRfYXQ/OiBzdHJpbmc7XG4gIHVwZGF0ZWRfYXQ/OiBzdHJpbmc7XG59O1xuXG50eXBlIEludmVzdG9yTWF0Y2hSb3cgPSB7XG4gIGRlYWxfaWQ/OiBzdHJpbmc7XG4gIGludmVzdG9yX2lkPzogc3RyaW5nO1xuICBtYXRjaF9zY29yZT86IG51bWJlciB8IHN0cmluZyB8IG51bGw7XG4gIG1hdGNoX2JhbmQ/OiBzdHJpbmcgfCBudWxsO1xuICBpbnZlc3Rvcj86IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbDtcbn07XG5cbnR5cGUgQ29udGFjdEludmVzdG9ySW5wdXQgPSB7XG4gIGRlYWxJZDogc3RyaW5nO1xuICBpbnZlc3RvcklkOiBzdHJpbmc7XG4gIHN1bW1hcnk/OiBzdHJpbmcgfCBudWxsO1xuICBzdWJqZWN0Pzogc3RyaW5nIHwgbnVsbDtcbiAgY29tbXVuaWNhdGlvblR5cGU/OiBzdHJpbmcgfCBudWxsO1xuICBkaXJlY3Rpb24/OiBzdHJpbmcgfCBudWxsO1xuICBjb21tdW5pY2F0ZWRBdD86IHN0cmluZyB8IG51bGw7XG4gIG5leHRGb2xsb3dVcEF0Pzogc3RyaW5nIHwgbnVsbDtcbiAgbm90ZXM/OiBzdHJpbmcgfCBudWxsO1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufTtcblxudHlwZSBJbnZlc3RvckFjdGlvbkZhaWx1cmUgPSB7XG4gIHN1Y2Nlc3M6IGZhbHNlO1xuICBlcnJvcjogdHJ1ZTtcbiAgbWVzc2FnZTogc3RyaW5nO1xuICBkZXRhaWxzOiB7XG4gICAgc3RlcDogc3RyaW5nO1xuICAgIHJlYXNvbj86IHN0cmluZztcbiAgICBba2V5OiBzdHJpbmddOiB1bmtub3duO1xuICB9O1xufTtcblxudHlwZSBJbnZlc3RvckFjdGlvblN1Y2Nlc3M8VD4gPSB7XG4gIHN1Y2Nlc3M6IHRydWU7XG4gIGRhdGE6IFQ7XG59O1xuXG50eXBlIEludmVzdG9yQWN0aW9uUmVzdWx0PFQ+ID0gSW52ZXN0b3JBY3Rpb25TdWNjZXNzPFQ+IHwgSW52ZXN0b3JBY3Rpb25GYWlsdXJlO1xuXG5mdW5jdGlvbiBnZXRFcnJvck1lc3NhZ2UoZXJyb3I6IHVua25vd24pIHtcbiAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiBlcnJvci5tZXNzYWdlO1xuICBpZiAodHlwZW9mIGVycm9yID09PSBcInN0cmluZ1wiKSByZXR1cm4gZXJyb3I7XG4gIHJldHVybiBcIlVua25vd24gZXJyb3JcIjtcbn1cblxuZnVuY3Rpb24gYXNBcnJheTxUPih2YWx1ZTogVFtdIHwgbnVsbCB8IHVuZGVmaW5lZCkge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSh2YWx1ZSkgPyB2YWx1ZSA6IFtdO1xufVxuXG5mdW5jdGlvbiBpc1JlY29yZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUZhaWx1cmUoXG4gIHN0ZXA6IHN0cmluZyxcbiAgbWVzc2FnZTogc3RyaW5nLFxuICBkZXRhaWxzOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHt9LFxuKTogSW52ZXN0b3JBY3Rpb25GYWlsdXJlIHtcbiAgcmV0dXJuIHtcbiAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICBlcnJvcjogdHJ1ZSxcbiAgICBtZXNzYWdlLFxuICAgIGRldGFpbHM6IHtcbiAgICAgIHN0ZXAsXG4gICAgICAuLi5kZXRhaWxzLFxuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzRmFpbHVyZTxUPihcbiAgcmVzdWx0OiBJbnZlc3RvckFjdGlvblJlc3VsdDxUPixcbik6IHJlc3VsdCBpcyBJbnZlc3RvckFjdGlvbkZhaWx1cmUge1xuICByZXR1cm4gcmVzdWx0LnN1Y2Nlc3MgPT09IGZhbHNlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBydW5EYXRhYmFzZVN0ZXA8VD4oXG4gIHN0ZXA6IHN0cmluZyxcbiAgb3BlcmF0aW9uOiAoKSA9PiBQcm9taXNlPFQ+LFxuICBmYWlsdXJlTWVzc2FnZTogc3RyaW5nLFxuICBmYWlsdXJlRGV0YWlsczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSB7fSxcbik6IFByb21pc2U8SW52ZXN0b3JBY3Rpb25SZXN1bHQ8VD4+IHtcbiAgdHJ5IHtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIGRhdGE6IGF3YWl0IG9wZXJhdGlvbigpLFxuICAgIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc3QgcmVhc29uID0gZ2V0RXJyb3JNZXNzYWdlKGVycm9yKTtcbiAgICBjb25zb2xlLmVycm9yKGBpbnZlc3Rvci1hY3Rpb25zIGRhdGFiYXNlIHN0ZXAgZmFpbGVkOiAke3N0ZXB9YCwge1xuICAgICAgc3RlcCxcbiAgICAgIHJlYXNvbixcbiAgICAgIC4uLmZhaWx1cmVEZXRhaWxzLFxuICAgIH0pO1xuICAgIHJldHVybiBjcmVhdGVGYWlsdXJlKHN0ZXAsIGZhaWx1cmVNZXNzYWdlLCB7XG4gICAgICByZWFzb24sXG4gICAgICAuLi5mYWlsdXJlRGV0YWlscyxcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZVJlcXVpcmVkRmllbGRzKFxuICBzdGVwOiBzdHJpbmcsXG4gIGZpZWxkczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sXG4pIHtcbiAgZm9yIChjb25zdCBbZmllbGROYW1lLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZmllbGRzKSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gY3JlYXRlRmFpbHVyZShcbiAgICAgIHN0ZXAsXG4gICAgICBgTWlzc2luZyByZXF1aXJlZCBmaWVsZDogJHtmaWVsZE5hbWV9YCxcbiAgICAgIHsgZmllbGQ6IGZpZWxkTmFtZSB9LFxuICAgICk7XG4gIH1cblxuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplUGlwZWxpbmVTdGF0dXMoc3RhdHVzOiB1bmtub3duKTogUGlwZWxpbmVTdGF0dXMgfCBudWxsIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHR5cGVvZiBzdGF0dXMgPT09IFwic3RyaW5nXCJcbiAgICA/IHN0YXR1cy50cmltKCkudG9Mb3dlckNhc2UoKVxuICAgIDogXCJcIjtcblxuICBzd2l0Y2ggKG5vcm1hbGl6ZWQpIHtcbiAgICBjYXNlIFwibmV3XCI6XG4gICAgY2FzZSBcImNvbnRhY3RlZFwiOlxuICAgIGNhc2UgXCJpbnRlcmVzdGVkXCI6XG4gICAgY2FzZSBcIm5lZ290aWF0aW5nXCI6XG4gICAgICByZXR1cm4gbm9ybWFsaXplZDtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldE5leHRJbnZlc3RvclBpcGVsaW5lU3RhdHVzKFxuICBjdXJyZW50U3RhdHVzOiB1bmtub3duLFxuKTogUGlwZWxpbmVTdGF0dXMge1xuICBzd2l0Y2ggKG5vcm1hbGl6ZVBpcGVsaW5lU3RhdHVzKGN1cnJlbnRTdGF0dXMpID8/IFwibmV3XCIpIHtcbiAgICBjYXNlIFwibmV3XCI6XG4gICAgICByZXR1cm4gXCJjb250YWN0ZWRcIjtcbiAgICBjYXNlIFwiY29udGFjdGVkXCI6XG4gICAgICByZXR1cm4gXCJpbnRlcmVzdGVkXCI7XG4gICAgY2FzZSBcImludGVyZXN0ZWRcIjpcbiAgICAgIHJldHVybiBcIm5lZ290aWF0aW5nXCI7XG4gICAgY2FzZSBcIm5lZ290aWF0aW5nXCI6XG4gICAgICByZXR1cm4gXCJuZWdvdGlhdGluZ1wiO1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gXCJjb250YWN0ZWRcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBidWlsZERlZmF1bHRDb250YWN0U3VtbWFyeShcbiAgY3VycmVudFN0YXR1czogUGlwZWxpbmVTdGF0dXMsXG4gIG5leHRTdGF0dXM6IFBpcGVsaW5lU3RhdHVzLFxuKSB7XG4gIGlmIChjdXJyZW50U3RhdHVzID09PSBuZXh0U3RhdHVzKSB7XG4gICAgcmV0dXJuIGBJbnZlc3RvciBvdXRyZWFjaCBsb2dnZWQgd2hpbGUgcGlwZWxpbmUgcmVtYWluZWQgYXQgJHtuZXh0U3RhdHVzfS5gO1xuICB9XG5cbiAgcmV0dXJuIGBJbnZlc3RvciBvdXRyZWFjaCBsb2dnZWQgYW5kIHBpcGVsaW5lIG1vdmVkIGZyb20gJHtjdXJyZW50U3RhdHVzfSB0byAke25leHRTdGF0dXN9LmA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVuc3VyZURlYWxBbmRJbnZlc3RvckV4aXN0KFxuICBzdXBhYmFzZTogU3VwYWJhc2VMaWtlLFxuICBkZWFsSWQ6IHN0cmluZyxcbiAgaW52ZXN0b3JJZDogc3RyaW5nLFxuKSB7XG4gIGNvbnN0IGRlYWxSZXN1bHQgPSBhd2FpdCBydW5EYXRhYmFzZVN0ZXAoXG4gICAgXCJsb2FkX2RlYWxcIixcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzdXBhYmFzZS5mcm9tKFwiZGVhbHNcIilcbiAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgIC5lcShcImlkXCIsIGRlYWxJZClcbiAgICAgICAgLm1heWJlU2luZ2xlKCkgYXMgUXVlcnlSZXN1bHQ8eyBpZDogc3RyaW5nIH0+O1xuXG4gICAgICBpZiAocmVzdWx0LmVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuZXJyb3IubWVzc2FnZSA/PyBcIkZhaWxlZCB0byBsb2FkIGRlYWxcIik7XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVzdWx0LmRhdGEpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRGVhbCBub3QgZm91bmRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHQuZGF0YTtcbiAgICB9LFxuICAgIFwiRmFpbGVkIHRvIHZhbGlkYXRlIGRlYWxcIixcbiAgICB7IGRlYWxfaWQ6IGRlYWxJZCB9LFxuICApO1xuXG4gIGlmIChpc0ZhaWx1cmUoZGVhbFJlc3VsdCkpIHtcbiAgICByZXR1cm4gZGVhbFJlc3VsdDtcbiAgfVxuXG4gIGNvbnN0IGludmVzdG9yUmVzdWx0ID0gYXdhaXQgcnVuRGF0YWJhc2VTdGVwKFxuICAgIFwibG9hZF9pbnZlc3RvclwiLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHN1cGFiYXNlLmZyb20oXCJpbnZlc3RvcnNcIilcbiAgICAgICAgLnNlbGVjdChcImlkXCIpXG4gICAgICAgIC5lcShcImlkXCIsIGludmVzdG9ySWQpXG4gICAgICAgIC5tYXliZVNpbmdsZSgpIGFzIFF1ZXJ5UmVzdWx0PHsgaWQ6IHN0cmluZyB9PjtcblxuICAgICAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IocmVzdWx0LmVycm9yLm1lc3NhZ2UgPz8gXCJGYWlsZWQgdG8gbG9hZCBpbnZlc3RvclwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKCFyZXN1bHQuZGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZlc3RvciBub3QgZm91bmRcIik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByZXN1bHQuZGF0YTtcbiAgICB9LFxuICAgIFwiRmFpbGVkIHRvIHZhbGlkYXRlIGludmVzdG9yXCIsXG4gICAgeyBpbnZlc3Rvcl9pZDogaW52ZXN0b3JJZCB9LFxuICApO1xuXG4gIGlmIChpc0ZhaWx1cmUoaW52ZXN0b3JSZXN1bHQpKSB7XG4gICAgcmV0dXJuIGludmVzdG9yUmVzdWx0O1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBzdWNjZXNzOiB0cnVlLFxuICAgIGRhdGE6IHtcbiAgICAgIGRlYWw6IGRlYWxSZXN1bHQuZGF0YSxcbiAgICAgIGludmVzdG9yOiBpbnZlc3RvclJlc3VsdC5kYXRhLFxuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEludmVzdG9yUGlwZWxpbmVSb3coXG4gIHN1cGFiYXNlOiBTdXBhYmFzZUxpa2UsXG4gIGRlYWxJZDogc3RyaW5nLFxuICBpbnZlc3RvcklkOiBzdHJpbmcsXG4pIHtcbiAgcmV0dXJuIGF3YWl0IHJ1bkRhdGFiYXNlU3RlcChcbiAgICBcImxvYWRfaW52ZXN0b3JfcGlwZWxpbmVcIixcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzdXBhYmFzZVxuICAgICAgICAuZnJvbShcImludmVzdG9yX2RlYWxfcGlwZWxpbmVcIilcbiAgICAgICAgLnNlbGVjdChgXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgZGVhbF9pZCxcbiAgICAgICAgICBpbnZlc3Rvcl9pZCxcbiAgICAgICAgICBwaXBlbGluZV9zdGF0dXMsXG4gICAgICAgICAgbGFzdF9jb250YWN0ZWRfYXQsXG4gICAgICAgICAgbmV4dF9mb2xsb3dfdXBfYXQsXG4gICAgICAgICAgbm90ZXMsXG4gICAgICAgICAgbWV0YWRhdGEsXG4gICAgICAgICAgY3JlYXRlZF9hdCxcbiAgICAgICAgICB1cGRhdGVkX2F0XG4gICAgICAgIGApXG4gICAgICAgIC5lcShcImRlYWxfaWRcIiwgZGVhbElkKVxuICAgICAgICAuZXEoXCJpbnZlc3Rvcl9pZFwiLCBpbnZlc3RvcklkKVxuICAgICAgICAubWF5YmVTaW5nbGUoKSBhcyBRdWVyeVJlc3VsdDxQaXBlbGluZVJvdz47XG5cbiAgICAgIGlmIChyZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIHJlc3VsdC5lcnJvci5tZXNzYWdlID8/IFwiRmFpbGVkIHRvIGxvYWQgaW52ZXN0b3IgcGlwZWxpbmVcIixcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHJlc3VsdC5kYXRhID8/IG51bGw7XG4gICAgfSxcbiAgICBcIkZhaWxlZCB0byBsb2FkIGludmVzdG9yIHBpcGVsaW5lXCIsXG4gICAge1xuICAgICAgZGVhbF9pZDogZGVhbElkLFxuICAgICAgaW52ZXN0b3JfaWQ6IGludmVzdG9ySWQsXG4gICAgfSxcbiAgKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVDb250YWN0SW52ZXN0b3JBY3Rpb24oXG4gIHN1cGFiYXNlOiBTdXBhYmFzZUxpa2UsXG4gIGlucHV0OiBDb250YWN0SW52ZXN0b3JJbnB1dCxcbikge1xuICBjb25zdCBleGlzdGVuY2VSZXN1bHQgPSBhd2FpdCBlbnN1cmVEZWFsQW5kSW52ZXN0b3JFeGlzdChcbiAgICBzdXBhYmFzZSxcbiAgICBpbnB1dC5kZWFsSWQsXG4gICAgaW5wdXQuaW52ZXN0b3JJZCxcbiAgKTtcblxuICBpZiAoaXNGYWlsdXJlKGV4aXN0ZW5jZVJlc3VsdCkpIHtcbiAgICByZXR1cm4gZXhpc3RlbmNlUmVzdWx0O1xuICB9XG5cbiAgY29uc3QgZXhpc3RpbmdQaXBlbGluZSA9IGF3YWl0IGZldGNoSW52ZXN0b3JQaXBlbGluZVJvdyhcbiAgICBzdXBhYmFzZSxcbiAgICBpbnB1dC5kZWFsSWQsXG4gICAgaW5wdXQuaW52ZXN0b3JJZCxcbiAgKTtcblxuICBpZiAoaXNGYWlsdXJlKGV4aXN0aW5nUGlwZWxpbmUpKSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nUGlwZWxpbmU7XG4gIH1cblxuICBjb25zdCBleGlzdGluZ1BpcGVsaW5lUm93ID0gZXhpc3RpbmdQaXBlbGluZS5kYXRhO1xuICBjb25zdCByYXdDdXJyZW50U3RhdHVzID0gZXhpc3RpbmdQaXBlbGluZVJvdz8ucGlwZWxpbmVfc3RhdHVzO1xuICBjb25zdCBjdXJyZW50U3RhdHVzID0gcmF3Q3VycmVudFN0YXR1cyA9PSBudWxsIHx8XG4gICAgICByYXdDdXJyZW50U3RhdHVzID09PSBcIlwiXG4gICAgPyBcIm5ld1wiXG4gICAgOiBub3JtYWxpemVQaXBlbGluZVN0YXR1cyhyYXdDdXJyZW50U3RhdHVzKTtcblxuICBpZiAoIWN1cnJlbnRTdGF0dXMpIHtcbiAgICBjb25zdCBmYWlsdXJlID0gY3JlYXRlRmFpbHVyZShcbiAgICAgIFwidmFsaWRhdGVfcGlwZWxpbmVfdHJhbnNpdGlvblwiLFxuICAgICAgXCJDdXJyZW50IHBpcGVsaW5lIHN0YXR1cyBpcyBub3QgdmFsaWQgZm9yIGludmVzdG9yLWFjdGlvbnNcIixcbiAgICAgIHtcbiAgICAgICAgY3VycmVudF9zdGF0dXM6IHJhd0N1cnJlbnRTdGF0dXMsXG4gICAgICAgIGFsbG93ZWRfc3RhdHVzZXM6IFZBTElEX0lOVkVTVE9SX0FDVElPTl9QSVBFTElORV9TVEFUVVNFUyxcbiAgICAgIH0sXG4gICAgKTtcbiAgICBjb25zb2xlLmVycm9yKFwiaW52ZXN0b3ItYWN0aW9ucyB2YWxpZGF0aW9uIGZhaWxlZFwiLCBmYWlsdXJlLmRldGFpbHMpO1xuICAgIHJldHVybiBmYWlsdXJlO1xuICB9XG5cbiAgY29uc3QgbmV4dFN0YXR1cyA9IGdldE5leHRJbnZlc3RvclBpcGVsaW5lU3RhdHVzKGN1cnJlbnRTdGF0dXMpO1xuICBjb25zdCBjb21tdW5pY2F0ZWRBdCA9IGlucHV0LmNvbW11bmljYXRlZEF0Py50cmltKCkgfHxcbiAgICBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gIGNvbnN0IHN1YmplY3QgPSBpbnB1dC5zdWJqZWN0Py50cmltKCkgfHwgbnVsbDtcbiAgY29uc3QgY29tbXVuaWNhdGlvblR5cGUgPSBpbnB1dC5jb21tdW5pY2F0aW9uVHlwZT8udHJpbSgpIHx8IFwibm90ZVwiO1xuICBjb25zdCBkaXJlY3Rpb24gPSBpbnB1dC5kaXJlY3Rpb24/LnRyaW0oKSB8fCBcIm91dGJvdW5kXCI7XG4gIGNvbnN0IHN1bW1hcnkgPSBpbnB1dC5zdW1tYXJ5Py50cmltKCkgfHxcbiAgICBidWlsZERlZmF1bHRDb250YWN0U3VtbWFyeShjdXJyZW50U3RhdHVzLCBuZXh0U3RhdHVzKTtcbiAgY29uc3QgbWVyZ2VkTWV0YWRhdGEgPSB7XG4gICAgLi4uKGlzUmVjb3JkKGV4aXN0aW5nUGlwZWxpbmVSb3c/Lm1ldGFkYXRhKSA/IGV4aXN0aW5nUGlwZWxpbmVSb3cubWV0YWRhdGEgOiB7fSksXG4gICAgLi4uKGlzUmVjb3JkKGlucHV0Lm1ldGFkYXRhKSA/IGlucHV0Lm1ldGFkYXRhIDoge30pLFxuICAgIGFjdGlvbl90eXBlOiBDT05UQUNUX0lOVkVTVE9SX0FDVElPTixcbiAgICBwaXBlbGluZV90cmFuc2l0aW9uOiB7XG4gICAgICBmcm9tOiBjdXJyZW50U3RhdHVzLFxuICAgICAgdG86IG5leHRTdGF0dXMsXG4gICAgfSxcbiAgfTtcblxuICBjb25zdCBjb21tdW5pY2F0aW9uSW5zZXJ0VmFsaWRhdGlvbiA9IHZhbGlkYXRlUmVxdWlyZWRGaWVsZHMoXG4gICAgXCJ2YWxpZGF0ZV9pbnZlc3Rvcl9jb21tdW5pY2F0aW9uc19pbnNlcnRcIixcbiAgICB7XG4gICAgICBkZWFsX2lkOiBpbnB1dC5kZWFsSWQsXG4gICAgICBpbnZlc3Rvcl9pZDogaW5wdXQuaW52ZXN0b3JJZCxcbiAgICAgIHN0YXR1czogXCJsb2dnZWRcIixcbiAgICAgIHN1bW1hcnksXG4gICAgfSxcbiAgKTtcblxuICBpZiAoY29tbXVuaWNhdGlvbkluc2VydFZhbGlkYXRpb24pIHtcbiAgICBjb25zb2xlLmVycm9yKFxuICAgICAgXCJpbnZlc3Rvci1hY3Rpb25zIHZhbGlkYXRpb24gZmFpbGVkXCIsXG4gICAgICBjb21tdW5pY2F0aW9uSW5zZXJ0VmFsaWRhdGlvbi5kZXRhaWxzLFxuICAgICk7XG4gICAgcmV0dXJuIGNvbW11bmljYXRpb25JbnNlcnRWYWxpZGF0aW9uO1xuICB9XG5cbiAgY29uc3QgY29tbXVuaWNhdGlvblJlc3VsdCA9IGF3YWl0IHJ1bkRhdGFiYXNlU3RlcChcbiAgICBcImluc2VydF9pbnZlc3Rvcl9jb21tdW5pY2F0aW9uXCIsXG4gICAgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBkYXRhLCBlcnJvciB9ID0gYXdhaXQgc3VwYWJhc2VcbiAgICAgICAgLmZyb20oXCJpbnZlc3Rvcl9jb21tdW5pY2F0aW9uc1wiKVxuICAgICAgICAuaW5zZXJ0KHtcbiAgICAgICAgICBpbnZlc3Rvcl9pZDogaW5wdXQuaW52ZXN0b3JJZCxcbiAgICAgICAgICBkZWFsX2lkOiBpbnB1dC5kZWFsSWQsXG4gICAgICAgICAgY29tbXVuaWNhdGlvbl90eXBlOiBjb21tdW5pY2F0aW9uVHlwZSxcbiAgICAgICAgICBkaXJlY3Rpb24sXG4gICAgICAgICAgc3ViamVjdCxcbiAgICAgICAgICBzdW1tYXJ5LFxuICAgICAgICAgIHN0YXR1czogXCJsb2dnZWRcIixcbiAgICAgICAgICBtZXRhZGF0YTogbWVyZ2VkTWV0YWRhdGEsXG4gICAgICAgICAgY29tbXVuaWNhdGVkX2F0OiBjb21tdW5pY2F0ZWRBdCxcbiAgICAgICAgfSlcbiAgICAgICAgLnNlbGVjdChgXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgaW52ZXN0b3JfaWQsXG4gICAgICAgICAgZGVhbF9pZCxcbiAgICAgICAgICBjb21tdW5pY2F0aW9uX3R5cGUsXG4gICAgICAgICAgZGlyZWN0aW9uLFxuICAgICAgICAgIHN1YmplY3QsXG4gICAgICAgICAgc3VtbWFyeSxcbiAgICAgICAgICBzdGF0dXMsXG4gICAgICAgICAgbWV0YWRhdGEsXG4gICAgICAgICAgY29tbXVuaWNhdGVkX2F0LFxuICAgICAgICAgIGNyZWF0ZWRfYXQsXG4gICAgICAgICAgdXBkYXRlZF9hdFxuICAgICAgICBgKVxuICAgICAgICAuc2luZ2xlKCk7XG5cbiAgICAgIGlmIChlcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgZXJyb3IubWVzc2FnZSA/PyBcIkZhaWxlZCB0byBsb2cgaW52ZXN0b3IgY29tbXVuaWNhdGlvblwiLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gZGF0YTtcbiAgICB9LFxuICAgIFwiRmFpbGVkIHRvIGluc2VydCBpbnZlc3RvciBjb21tdW5pY2F0aW9uXCIsXG4gICAge1xuICAgICAgZGVhbF9pZDogaW5wdXQuZGVhbElkLFxuICAgICAgaW52ZXN0b3JfaWQ6IGlucHV0LmludmVzdG9ySWQsXG4gICAgICBzdGF0dXM6IFwibG9nZ2VkXCIsXG4gICAgfSxcbiAgKTtcblxuICBpZiAoaXNGYWlsdXJlKGNvbW11bmljYXRpb25SZXN1bHQpKSB7XG4gICAgcmV0dXJuIGNvbW11bmljYXRpb25SZXN1bHQ7XG4gIH1cblxuICBjb25zdCBjb21tdW5pY2F0aW9uUm93ID0gY29tbXVuaWNhdGlvblJlc3VsdC5kYXRhO1xuXG4gIGNvbnN0IHBpcGVsaW5lSW5zZXJ0VmFsaWRhdGlvbiA9IHZhbGlkYXRlUmVxdWlyZWRGaWVsZHMoXG4gICAgXCJ2YWxpZGF0ZV9pbnZlc3Rvcl9kZWFsX3BpcGVsaW5lX2luc2VydFwiLFxuICAgIHtcbiAgICAgIGRlYWxfaWQ6IGlucHV0LmRlYWxJZCxcbiAgICAgIGludmVzdG9yX2lkOiBpbnB1dC5pbnZlc3RvcklkLFxuICAgICAgc3RhdHVzOiBuZXh0U3RhdHVzLFxuICAgIH0sXG4gICk7XG5cbiAgaWYgKHBpcGVsaW5lSW5zZXJ0VmFsaWRhdGlvbikge1xuICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICBcImludmVzdG9yLWFjdGlvbnMgdmFsaWRhdGlvbiBmYWlsZWRcIixcbiAgICAgIHBpcGVsaW5lSW5zZXJ0VmFsaWRhdGlvbi5kZXRhaWxzLFxuICAgICk7XG4gICAgcmV0dXJuIHBpcGVsaW5lSW5zZXJ0VmFsaWRhdGlvbjtcbiAgfVxuXG4gIGlmICghVkFMSURfSU5WRVNUT1JfQUNUSU9OX1BJUEVMSU5FX1NUQVRVU0VTLmluY2x1ZGVzKG5leHRTdGF0dXMpKSB7XG4gICAgY29uc3QgZmFpbHVyZSA9IGNyZWF0ZUZhaWx1cmUoXG4gICAgICBcInZhbGlkYXRlX3BpcGVsaW5lX3RyYW5zaXRpb25cIixcbiAgICAgIFwiTmV4dCBwaXBlbGluZSBzdGF0dXMgaXMgbm90IHZhbGlkIGZvciBpbnZlc3Rvci1hY3Rpb25zXCIsXG4gICAgICB7XG4gICAgICAgIG5leHRfc3RhdHVzOiBuZXh0U3RhdHVzLFxuICAgICAgICBhbGxvd2VkX3N0YXR1c2VzOiBWQUxJRF9JTlZFU1RPUl9BQ1RJT05fUElQRUxJTkVfU1RBVFVTRVMsXG4gICAgICB9LFxuICAgICk7XG4gICAgY29uc29sZS5lcnJvcihcImludmVzdG9yLWFjdGlvbnMgdmFsaWRhdGlvbiBmYWlsZWRcIiwgZmFpbHVyZS5kZXRhaWxzKTtcbiAgICByZXR1cm4gZmFpbHVyZTtcbiAgfVxuXG4gIGNvbnN0IHBpcGVsaW5lUGF5bG9hZCA9IHtcbiAgICBwX2RlYWxfaWQ6IGlucHV0LmRlYWxJZCxcbiAgICBwX2ludmVzdG9yX2lkOiBpbnB1dC5pbnZlc3RvcklkLFxuICAgIHBfcGlwZWxpbmVfc3RhdHVzOiBuZXh0U3RhdHVzLFxuICAgIHBfbGFzdF9jb250YWN0ZWRfYXQ6IGNvbW11bmljYXRlZEF0LFxuICAgIHBfbmV4dF9mb2xsb3dfdXBfYXQ6IGlucHV0Lm5leHRGb2xsb3dVcEF0ID8/XG4gICAgICBleGlzdGluZ1BpcGVsaW5lUm93Py5uZXh0X2ZvbGxvd191cF9hdCA/PyBudWxsLFxuICAgIHBfbm90ZXM6IGlucHV0Lm5vdGVzID8/IGV4aXN0aW5nUGlwZWxpbmVSb3c/Lm5vdGVzID8/IHN1bW1hcnksXG4gICAgcF9tZXRhZGF0YTogbWVyZ2VkTWV0YWRhdGEsXG4gIH07XG5cbiAgY29uc3QgcGlwZWxpbmVSZXN1bHQgPSBhd2FpdCBydW5EYXRhYmFzZVN0ZXAoXG4gICAgXCJ1cHNlcnRfaW52ZXN0b3JfZGVhbF9waXBlbGluZVwiLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9ID0gYXdhaXQgc3VwYWJhc2UucnBjKFxuICAgICAgICBcInVwc2VydF9pbnZlc3Rvcl9kZWFsX3BpcGVsaW5lXCIsXG4gICAgICAgIHBpcGVsaW5lUGF5bG9hZCxcbiAgICAgICkgYXMgUXVlcnlSZXN1bHQ8UGlwZWxpbmVSb3c+O1xuXG4gICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIGVycm9yLm1lc3NhZ2UgPz8gXCJGYWlsZWQgdG8gdXBkYXRlIGludmVzdG9yIHBpcGVsaW5lXCIsXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBkYXRhO1xuICAgIH0sXG4gICAgXCJGYWlsZWQgdG8gdXBkYXRlIGludmVzdG9yIHBpcGVsaW5lXCIsXG4gICAge1xuICAgICAgZGVhbF9pZDogaW5wdXQuZGVhbElkLFxuICAgICAgaW52ZXN0b3JfaWQ6IGlucHV0LmludmVzdG9ySWQsXG4gICAgICBzdGF0dXM6IG5leHRTdGF0dXMsXG4gICAgfSxcbiAgKTtcblxuICBpZiAoaXNGYWlsdXJlKHBpcGVsaW5lUmVzdWx0KSkge1xuICAgIHJldHVybiB7XG4gICAgICAuLi5waXBlbGluZVJlc3VsdCxcbiAgICAgIGRldGFpbHM6IHtcbiAgICAgICAgLi4ucGlwZWxpbmVSZXN1bHQuZGV0YWlscyxcbiAgICAgICAgY29tbXVuaWNhdGlvbl9pZDogY29tbXVuaWNhdGlvblJvdy5pZCA/PyBudWxsLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgcGlwZWxpbmVSb3cgPSBwaXBlbGluZVJlc3VsdC5kYXRhO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBlcnJvciB9ID0gYXdhaXQgc3VwYWJhc2UuZnJvbShcImFpX2FjdGlvbnNcIikuaW5zZXJ0KHtcbiAgICAgIGRlYWxfaWQ6IGlucHV0LmRlYWxJZCxcbiAgICAgIGFnZW50OiBcImludmVzdG9yLWFjdGlvbnNcIixcbiAgICAgIGFjdGlvbjogQ09OVEFDVF9JTlZFU1RPUl9BQ1RJT04sXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICBpbnZlc3Rvcl9pZDogaW5wdXQuaW52ZXN0b3JJZCxcbiAgICAgICAgY29tbXVuaWNhdGlvbl9pZDogY29tbXVuaWNhdGlvblJvdy5pZCxcbiAgICAgICAgcGlwZWxpbmVfc3RhdHVzX2Zyb206IGN1cnJlbnRTdGF0dXMsXG4gICAgICAgIHBpcGVsaW5lX3N0YXR1c190bzogbmV4dFN0YXR1cyxcbiAgICAgICAgY29tbXVuaWNhdGVkX2F0OiBjb21tdW5pY2F0ZWRBdCxcbiAgICAgICAgc3VtbWFyeSxcbiAgICAgIH0sXG4gICAgICBjcmVhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgfSk7XG5cbiAgICBpZiAoZXJyb3IpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihlcnJvci5tZXNzYWdlID8/IFwiRmFpbGVkIHRvIGxvZyBpbnZlc3RvciBhY3Rpb25cIik7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUud2FybihcImludmVzdG9yLWFjdGlvbnMgYWlfYWN0aW9ucyBsb2dnaW5nIGZhaWxlZFwiLCB7XG4gICAgICByZWFzb246IGdldEVycm9yTWVzc2FnZShlcnJvciksXG4gICAgICBkZWFsX2lkOiBpbnB1dC5kZWFsSWQsXG4gICAgICBpbnZlc3Rvcl9pZDogaW5wdXQuaW52ZXN0b3JJZCxcbiAgICAgIGNvbW11bmljYXRpb25faWQ6IGNvbW11bmljYXRpb25Sb3cuaWQgPz8gbnVsbCxcbiAgICAgIHN0YXR1czogbmV4dFN0YXR1cyxcbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgc3VjY2VzczogdHJ1ZSxcbiAgICBkYXRhOiB7XG4gICAgICBhY3Rpb25fdHlwZTogQ09OVEFDVF9JTlZFU1RPUl9BQ1RJT04sXG4gICAgICBkZWFsX2lkOiBpbnB1dC5kZWFsSWQsXG4gICAgICBpbnZlc3Rvcl9pZDogaW5wdXQuaW52ZXN0b3JJZCxcbiAgICAgIHBpcGVsaW5lX3RyYW5zaXRpb246IHtcbiAgICAgICAgZnJvbTogY3VycmVudFN0YXR1cyxcbiAgICAgICAgdG86IG5leHRTdGF0dXMsXG4gICAgICB9LFxuICAgICAgY29tbXVuaWNhdGlvbjogY29tbXVuaWNhdGlvblJvdyxcbiAgICAgIHBpcGVsaW5lOiBwaXBlbGluZVJvdyxcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbGlzdFN1Z2dlc3RlZEludmVzdG9yQWN0aW9ucyhcbiAgc3VwYWJhc2U6IFN1cGFiYXNlTGlrZSxcbiAgZGVhbElkOiBzdHJpbmcsXG4gIHRocmVzaG9sZCA9IERFRkFVTFRfSU5WRVNUT1JfTUFUQ0hfVEhSRVNIT0xELFxuICBpbnZlc3RvcklkPzogc3RyaW5nIHwgbnVsbCxcbikge1xuICByZXR1cm4gYXdhaXQgcnVuRGF0YWJhc2VTdGVwKFxuICAgIFwibGlzdF9zdWdnZXN0ZWRfaW52ZXN0b3JfYWN0aW9uc1wiLFxuICAgIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IG1hdGNoUXVlcnkgPSBzdXBhYmFzZVxuICAgICAgICAuZnJvbShcImRlYWxfaW52ZXN0b3JfbWF0Y2hlc1wiKVxuICAgICAgICAuc2VsZWN0KGBcbiAgICAgICAgICBkZWFsX2lkLFxuICAgICAgICAgIGludmVzdG9yX2lkLFxuICAgICAgICAgIG1hdGNoX3Njb3JlLFxuICAgICAgICAgIG1hdGNoX2JhbmQsXG4gICAgICAgICAgaW52ZXN0b3I6aW52ZXN0b3JzIChcbiAgICAgICAgICAgIGlkLFxuICAgICAgICAgICAgaW52ZXN0b3JfbmFtZSxcbiAgICAgICAgICAgIGludmVzdG9yX3R5cGUsXG4gICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICApXG4gICAgICAgIGApXG4gICAgICAgIC5lcShcImRlYWxfaWRcIiwgZGVhbElkKVxuICAgICAgICAuZ3RlKFwibWF0Y2hfc2NvcmVcIiwgdGhyZXNob2xkKVxuICAgICAgICAub3JkZXIoXCJtYXRjaF9zY29yZVwiLCB7IGFzY2VuZGluZzogZmFsc2UgfSlcbiAgICAgICAgLm9yZGVyKFwidXBkYXRlZF9hdFwiLCB7IGFzY2VuZGluZzogZmFsc2UgfSk7XG5cbiAgICAgIGNvbnN0IHBpcGVsaW5lUXVlcnkgPSBzdXBhYmFzZVxuICAgICAgICAuZnJvbShcImludmVzdG9yX2RlYWxfcGlwZWxpbmVcIilcbiAgICAgICAgLnNlbGVjdChgXG4gICAgICAgICAgaWQsXG4gICAgICAgICAgZGVhbF9pZCxcbiAgICAgICAgICBpbnZlc3Rvcl9pZCxcbiAgICAgICAgICBwaXBlbGluZV9zdGF0dXMsXG4gICAgICAgICAgbGFzdF9jb250YWN0ZWRfYXQsXG4gICAgICAgICAgbmV4dF9mb2xsb3dfdXBfYXQsXG4gICAgICAgICAgbm90ZXMsXG4gICAgICAgICAgbWV0YWRhdGEsXG4gICAgICAgICAgY3JlYXRlZF9hdCxcbiAgICAgICAgICB1cGRhdGVkX2F0XG4gICAgICAgIGApXG4gICAgICAgIC5lcShcImRlYWxfaWRcIiwgZGVhbElkKTtcblxuICAgICAgaWYgKGludmVzdG9ySWQpIHtcbiAgICAgICAgbWF0Y2hRdWVyeS5lcShcImludmVzdG9yX2lkXCIsIGludmVzdG9ySWQpO1xuICAgICAgICBwaXBlbGluZVF1ZXJ5LmVxKFwiaW52ZXN0b3JfaWRcIiwgaW52ZXN0b3JJZCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IFttYXRjaGVzUmVzdWx0LCBwaXBlbGluZVJlc3VsdF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgIG1hdGNoUXVlcnksXG4gICAgICAgIHBpcGVsaW5lUXVlcnksXG4gICAgICBdKSBhcyBbUXVlcnlSZXN1bHQ8SW52ZXN0b3JNYXRjaFJvd1tdPiwgUXVlcnlSZXN1bHQ8UGlwZWxpbmVSb3dbXT5dO1xuXG4gICAgICBpZiAobWF0Y2hlc1Jlc3VsdC5lcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgbWF0Y2hlc1Jlc3VsdC5lcnJvci5tZXNzYWdlID8/IFwiRmFpbGVkIHRvIGxvYWQgaW52ZXN0b3IgbWF0Y2hlc1wiLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAocGlwZWxpbmVSZXN1bHQuZXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIHBpcGVsaW5lUmVzdWx0LmVycm9yLm1lc3NhZ2UgPz8gXCJGYWlsZWQgdG8gbG9hZCBpbnZlc3RvciBwaXBlbGluZVwiLFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBwaXBlbGluZUJ5SW52ZXN0b3JJZCA9IG5ldyBNYXAoXG4gICAgICAgIGFzQXJyYXkocGlwZWxpbmVSZXN1bHQuZGF0YSkubWFwKChyb3cpID0+IFtyb3cuaW52ZXN0b3JfaWQgPz8gXCJcIiwgcm93XSksXG4gICAgICApO1xuXG4gICAgICByZXR1cm4gYXNBcnJheShtYXRjaGVzUmVzdWx0LmRhdGEpXG4gICAgICAgIC5tYXAoKG1hdGNoKSA9PiB7XG4gICAgICAgICAgY29uc3QgcmVzb2x2ZWRJbnZlc3RvcklkID0gbWF0Y2guaW52ZXN0b3JfaWQgPz8gXCJcIjtcbiAgICAgICAgICBjb25zdCBleGlzdGluZ1BpcGVsaW5lID0gcGlwZWxpbmVCeUludmVzdG9ySWQuZ2V0KHJlc29sdmVkSW52ZXN0b3JJZCkgPz9cbiAgICAgICAgICAgIG51bGw7XG4gICAgICAgICAgY29uc3QgY3VycmVudFN0YXR1cyA9IG5vcm1hbGl6ZVBpcGVsaW5lU3RhdHVzKFxuICAgICAgICAgICAgZXhpc3RpbmdQaXBlbGluZT8ucGlwZWxpbmVfc3RhdHVzLFxuICAgICAgICAgICkgPz8gXCJuZXdcIjtcblxuICAgICAgICAgIGlmIChjdXJyZW50U3RhdHVzICE9PSBcIm5ld1wiKSByZXR1cm4gbnVsbDtcblxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBkZWFsX2lkOiBkZWFsSWQsXG4gICAgICAgICAgICBpbnZlc3Rvcl9pZDogcmVzb2x2ZWRJbnZlc3RvcklkLFxuICAgICAgICAgICAgYWN0aW9uX3R5cGU6IENPTlRBQ1RfSU5WRVNUT1JfQUNUSU9OLFxuICAgICAgICAgICAgcmVhc29uOiBgSW52ZXN0b3IgbWF0Y2ggc2NvcmUgJHtcbiAgICAgICAgICAgICAgbWF0Y2gubWF0Y2hfc2NvcmUgPz8gMFxuICAgICAgICAgICAgfSBpcyBhdCBvciBhYm92ZSB0aHJlc2hvbGQgJHt0aHJlc2hvbGR9LmAsXG4gICAgICAgICAgICBtYXRjaF9zY29yZTogbWF0Y2gubWF0Y2hfc2NvcmUgPz8gMCxcbiAgICAgICAgICAgIG1hdGNoX2JhbmQ6IG1hdGNoLm1hdGNoX2JhbmQgPz8gbnVsbCxcbiAgICAgICAgICAgIHRocmVzaG9sZCxcbiAgICAgICAgICAgIGN1cnJlbnRfcGlwZWxpbmVfc3RhdHVzOiBjdXJyZW50U3RhdHVzLFxuICAgICAgICAgICAgdGFyZ2V0X3BpcGVsaW5lX3N0YXR1czogZ2V0TmV4dEludmVzdG9yUGlwZWxpbmVTdGF0dXMoY3VycmVudFN0YXR1cyksXG4gICAgICAgICAgICBpbnZlc3RvcjogbWF0Y2guaW52ZXN0b3IgPz8gbnVsbCxcbiAgICAgICAgICB9O1xuICAgICAgICB9KVxuICAgICAgICAuZmlsdGVyKChpdGVtKSA9PiBpdGVtICE9PSBudWxsKTtcbiAgICB9LFxuICAgIFwiRmFpbGVkIHRvIGxpc3Qgc3VnZ2VzdGVkIGludmVzdG9yIGFjdGlvbnNcIixcbiAgICB7XG4gICAgICBkZWFsX2lkOiBkZWFsSWQsXG4gICAgICBpbnZlc3Rvcl9pZDogaW52ZXN0b3JJZCA/PyBudWxsLFxuICAgICAgdGhyZXNob2xkLFxuICAgIH0sXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRJbnZlc3RvckFjdGlvbkVycm9yTWVzc2FnZShlcnJvcjogdW5rbm93bikge1xuICByZXR1cm4gZ2V0RXJyb3JNZXNzYWdlKGVycm9yKTtcbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxPQUFPLE1BQU0sbUNBQW1DLEdBQUc7QUFDbkQsT0FBTyxNQUFNLDBCQUEwQixtQkFBbUI7QUFDMUQsT0FBTyxNQUFNLDBDQUEwQztFQUNyRDtFQUNBO0VBQ0E7RUFDQTtD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
// denoCacheMetadata=1953351344003681375,6280473411578409584