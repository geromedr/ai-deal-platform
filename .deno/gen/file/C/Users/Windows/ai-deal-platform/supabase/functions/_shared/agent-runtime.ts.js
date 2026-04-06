import { createClient } from "https://esm.sh/@supabase/supabase-js";
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message ?? "Unknown error");
  }
  return "Unknown error";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function parseRequestPayload(req) {
  const rawBody = await req.clone().text();
  const trimmed = rawBody.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  return isRecord(parsed) ? parsed : {};
}
function normalizeFieldConfig(field) {
  return typeof field === "string" ? {
    name: field,
    type: undefined,
    uuid: false,
    allowEmptyString: false,
    minItems: 0
  } : {
    name: field.name,
    type: field.type,
    uuid: field.uuid ?? false,
    allowEmptyString: field.allowEmptyString ?? false,
    minItems: field.minItems ?? 0
  };
}
function validatePayload(payload, requiredFields) {
  const errors = [];
  for (const field of requiredFields){
    const config = normalizeFieldConfig(field);
    const value = payload[config.name];
    if (value === undefined || value === null) {
      errors.push(`${config.name} is required`);
      continue;
    }
    if (!config.allowEmptyString && typeof value === "string" && value.trim().length === 0) {
      errors.push(`${config.name} is required`);
      continue;
    }
    if (config.type === "string" && typeof value !== "string") {
      errors.push(`${config.name} must be a string`);
      continue;
    }
    if (config.type === "number" && typeof value !== "number") {
      errors.push(`${config.name} must be a number`);
      continue;
    }
    if (config.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${config.name} must be a boolean`);
      continue;
    }
    if (config.type === "array") {
      if (!Array.isArray(value)) {
        errors.push(`${config.name} must be an array`);
        continue;
      }
      if (config.minItems > 0 && value.length < config.minItems) {
        errors.push(`${config.name} must contain at least ${config.minItems} item(s)`);
        continue;
      }
    }
    if (config.type === "object" && !isRecord(value)) {
      errors.push(`${config.name} must be an object`);
      continue;
    }
    if (config.uuid) {
      if (typeof value !== "string" || !isUuid(value.trim())) {
        errors.push(`${config.name} must be a valid UUID`);
      }
    }
  }
  return errors;
}
function extractDealId(payload) {
  const candidate = payload.deal_id;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
}
function getRuntimeVersion(config) {
  const configured = config.version?.trim();
  if (configured) return configured;
  const envVersion = Deno.env.get("AGENT_RUNTIME_VERSION")?.trim();
  if (envVersion) return envVersion;
  return "2026-03-25";
}
function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}
function toEnvKey(agentName) {
  return agentName.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}
function getDefaultRateLimitPerHour() {
  const value = Number(Deno.env.get("DEFAULT_AGENT_MAX_CALLS_PER_HOUR") ?? "120");
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 120;
}
function getEstimatedCallCost(agentName) {
  const specificValue = Number(Deno.env.get(`AGENT_ESTIMATED_COST_${toEnvKey(agentName)}`) ?? "");
  if (Number.isFinite(specificValue) && specificValue >= 0) {
    return specificValue;
  }
  const defaultValue = Number(Deno.env.get("DEFAULT_AGENT_ESTIMATED_COST") ?? "0");
  return Number.isFinite(defaultValue) && defaultValue >= 0 ? defaultValue : 0;
}
async function readSystemEnabled(supabase) {
  if (!supabase) return true;
  const { data, error } = await supabase.from("system_settings").select("system_enabled").eq("setting_key", "global").maybeSingle();
  if (error) {
    console.warn("system settings lookup failed", {
      error: error.message
    });
    return true;
  }
  return data?.system_enabled !== false;
}
async function getAgentRateLimit(supabase, config) {
  if (!supabase) return null;
  const defaultRateLimit = getDefaultRateLimitPerHour();
  const { data, error } = await supabase.from("agent_rate_limits").upsert({
    agent_name: config.agentName,
    max_calls_per_hour: defaultRateLimit,
    enabled: true
  }, {
    onConflict: "agent_name"
  }).select("agent_name, max_calls_per_hour, enabled").single();
  if (error) {
    console.warn("agent rate limit lookup failed", {
      agent: config.agentName,
      error: error.message
    });
    return null;
  }
  return data;
}
async function isRateLimited(supabase, config) {
  if (!supabase || config.skipRateLimit) {
    return {
      limited: false,
      count: 0,
      limit: null
    };
  }
  const rateLimitRow = await getAgentRateLimit(supabase, config);
  const enabled = rateLimitRow?.enabled !== false;
  const limit = typeof rateLimitRow?.max_calls_per_hour === "number" ? Math.trunc(rateLimitRow.max_calls_per_hour) : null;
  if (!enabled || !limit || limit <= 0) {
    return {
      limited: false,
      count: 0,
      limit
    };
  }
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("usage_metrics").select("calls").eq("agent_name", config.agentName).gte("timestamp", cutoff);
  if (error) {
    console.warn("usage metrics lookup failed", {
      agent: config.agentName,
      error: error.message
    });
    return {
      limited: false,
      count: 0,
      limit
    };
  }
  const count = (data ?? []).reduce((sum, row)=>{
    const calls = typeof row.calls === "number" ? row.calls : Number(row.calls ?? 0);
    return sum + (Number.isFinite(calls) ? calls : 0);
  }, 0);
  return {
    limited: count >= limit,
    count,
    limit
  };
}
async function logUsageMetric(supabase, config, responseStatus) {
  if (!supabase || config.skipUsageTracking || responseStatus >= 500) return;
  const { error } = await supabase.from("usage_metrics").insert({
    agent_name: config.agentName,
    calls: 1,
    estimated_cost: getEstimatedCallCost(config.agentName),
    timestamp: new Date().toISOString()
  });
  if (error) {
    console.warn("usage metric insert failed", {
      agent: config.agentName,
      error: error.message
    });
  }
}
async function upsertRegistryStatus(supabase, config, status, errorMessage) {
  if (!supabase) return;
  const { error } = await supabase.from("agent_registry").upsert({
    agent_name: config.agentName,
    version: getRuntimeVersion(config),
    status,
    last_run: new Date().toISOString(),
    last_error: errorMessage
  }, {
    onConflict: "agent_name"
  });
  if (error) {
    console.warn("agent-registry upsert failed", {
      agent: config.agentName,
      status,
      error: error.message
    });
  }
}
async function logExecution(supabase, config, input) {
  if (!supabase || config.logExecution === false) return;
  const { error } = await supabase.from("ai_actions").insert({
    deal_id: input.dealId,
    agent: config.agentName,
    action: "agent_execution",
    source: "edge_function",
    payload: {
      version: getRuntimeVersion(config),
      validation: {
        passed: input.validationPassed,
        errors: input.validationErrors,
        required_fields: (config.requiredFields ?? []).map((field)=>typeof field === "string" ? field : field.name)
      },
      request: {
        deal_id: input.dealId
      },
      response: {
        status: input.responseStatus
      }
    },
    execution_time_ms: input.executionTimeMs,
    success: input.status === "active",
    error_context: input.errorMessage ? {
      message: input.errorMessage,
      response_status: input.responseStatus,
      request_payload: input.requestPayload
    } : null
  });
  if (error) {
    console.warn("agent execution audit failed", {
      agent: config.agentName,
      error: error.message
    });
  }
}
export function createAgentHandler(config, handler) {
  return async (req)=>{
    const startedAt = Date.now();
    const supabase = createServiceClient();
    let payload = {};
    let validationErrors = [];
    let responseStatus = 500;
    let response = null;
    let errorMessage = null;
    if (req.method !== "POST") {
      return jsonResponse({
        error: "Method not allowed"
      }, 405);
    }
    try {
      payload = await parseRequestPayload(req);
    } catch  {
      validationErrors = [
        "Invalid JSON body"
      ];
      responseStatus = 400;
      errorMessage = "Invalid JSON body";
      await upsertRegistryStatus(supabase, config, "error", errorMessage);
      await logExecution(supabase, config, {
        dealId: null,
        status: "error",
        errorMessage,
        executionTimeMs: Date.now() - startedAt,
        validationPassed: false,
        validationErrors,
        requestPayload: payload,
        responseStatus
      });
      return jsonResponse({
        error: "Invalid JSON body"
      }, 400);
    }
    validationErrors = validatePayload(payload, config.requiredFields ?? []);
    if (config.validate) {
      validationErrors.push(...config.validate(payload));
    }
    if (validationErrors.length > 0) {
      responseStatus = 400;
      errorMessage = validationErrors.join("; ");
      await upsertRegistryStatus(supabase, config, "error", errorMessage);
      await logExecution(supabase, config, {
        dealId: extractDealId(payload),
        status: "error",
        errorMessage,
        executionTimeMs: Date.now() - startedAt,
        validationPassed: false,
        validationErrors,
        requestPayload: payload,
        responseStatus
      });
      return jsonResponse({
        error: validationErrors[0],
        validation_errors: validationErrors,
        received: payload
      }, 400);
    }
    const systemEnabled = await readSystemEnabled(supabase);
    if (!systemEnabled && !config.allowWhenDisabled) {
      responseStatus = 503;
      errorMessage = "System is disabled by operator kill switch";
      await upsertRegistryStatus(supabase, config, "error", errorMessage);
      await logExecution(supabase, config, {
        dealId: extractDealId(payload),
        status: "error",
        errorMessage,
        executionTimeMs: Date.now() - startedAt,
        validationPassed: true,
        validationErrors: [],
        requestPayload: payload,
        responseStatus
      });
      return jsonResponse({
        error: errorMessage,
        system_enabled: false
      }, 503);
    }
    const rateLimit = await isRateLimited(supabase, config);
    if (rateLimit.limited) {
      responseStatus = 429;
      errorMessage = `Rate limit exceeded for ${config.agentName}: ${rateLimit.count}/${rateLimit.limit} calls in the last hour`;
      await upsertRegistryStatus(supabase, config, "error", errorMessage);
      await logExecution(supabase, config, {
        dealId: extractDealId(payload),
        status: "error",
        errorMessage,
        executionTimeMs: Date.now() - startedAt,
        validationPassed: true,
        validationErrors: [],
        requestPayload: payload,
        responseStatus
      });
      return jsonResponse({
        error: errorMessage,
        rate_limit: {
          count: rateLimit.count,
          limit: rateLimit.limit,
          window: "1h"
        }
      }, 429);
    }
    await upsertRegistryStatus(supabase, config, "running", null);
    try {
      response = await handler(req);
      responseStatus = response.status;
    } catch (error) {
      errorMessage = getErrorMessage(error);
      responseStatus = 500;
      response = jsonResponse({
        error: errorMessage
      }, 500);
    }
    const status = responseStatus < 400 ? "active" : "error";
    if (status === "error" && !errorMessage) {
      try {
        const body = await response.clone().json();
        if (isRecord(body) && typeof body.error === "string") {
          errorMessage = body.error;
        }
      } catch  {
        errorMessage = `HTTP ${responseStatus}`;
      }
    }
    await upsertRegistryStatus(supabase, config, status, errorMessage);
    await logExecution(supabase, config, {
      dealId: extractDealId(payload),
      status,
      errorMessage,
      executionTimeMs: Date.now() - startedAt,
      validationPassed: true,
      validationErrors: [],
      requestPayload: payload,
      responseStatus
    });
    await logUsageMetric(supabase, config, responseStatus);
    return response;
  };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImZpbGU6Ly8vQzovVXNlcnMvV2luZG93cy9haS1kZWFsLXBsYXRmb3JtL3N1cGFiYXNlL2Z1bmN0aW9ucy9fc2hhcmVkL2FnZW50LXJ1bnRpbWUudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY3JlYXRlQ2xpZW50IH0gZnJvbSBcImh0dHBzOi8vZXNtLnNoL0BzdXBhYmFzZS9zdXBhYmFzZS1qc1wiO1xuXG50eXBlIEZpZWxkVHlwZSA9IFwic3RyaW5nXCIgfCBcIm51bWJlclwiIHwgXCJib29sZWFuXCIgfCBcImFycmF5XCIgfCBcIm9iamVjdFwiO1xuXG5leHBvcnQgdHlwZSBSZXF1aXJlZEZpZWxkID1cbiAgfCBzdHJpbmdcbiAgfCB7XG4gICAgICBuYW1lOiBzdHJpbmc7XG4gICAgICB0eXBlPzogRmllbGRUeXBlO1xuICAgICAgdXVpZD86IGJvb2xlYW47XG4gICAgICBhbGxvd0VtcHR5U3RyaW5nPzogYm9vbGVhbjtcbiAgICAgIG1pbkl0ZW1zPzogbnVtYmVyO1xuICAgIH07XG5cbmV4cG9ydCB0eXBlIEFnZW50SGFuZGxlckNvbmZpZyA9IHtcbiAgYWdlbnROYW1lOiBzdHJpbmc7XG4gIHZlcnNpb24/OiBzdHJpbmc7XG4gIHJlcXVpcmVkRmllbGRzPzogUmVxdWlyZWRGaWVsZFtdO1xuICB2YWxpZGF0ZT86IChwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gc3RyaW5nW107XG4gIGxvZ0V4ZWN1dGlvbj86IGJvb2xlYW47XG4gIGFsbG93V2hlbkRpc2FibGVkPzogYm9vbGVhbjtcbiAgc2tpcFJhdGVMaW1pdD86IGJvb2xlYW47XG4gIHNraXBVc2FnZVRyYWNraW5nPzogYm9vbGVhbjtcbn07XG5cbnR5cGUgRXhlY3V0aW9uTG9nSW5wdXQgPSB7XG4gIGRlYWxJZDogc3RyaW5nIHwgbnVsbDtcbiAgc3RhdHVzOiBcImFjdGl2ZVwiIHwgXCJlcnJvclwiO1xuICBlcnJvck1lc3NhZ2U6IHN0cmluZyB8IG51bGw7XG4gIGV4ZWN1dGlvblRpbWVNczogbnVtYmVyO1xuICB2YWxpZGF0aW9uUGFzc2VkOiBib29sZWFuO1xuICB2YWxpZGF0aW9uRXJyb3JzOiBzdHJpbmdbXTtcbiAgcmVxdWVzdFBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICByZXNwb25zZVN0YXR1czogbnVtYmVyO1xufTtcblxudHlwZSBTdXBhYmFzZUNsaWVudExpa2UgPSBhbnk7XG5cbnR5cGUgU3lzdGVtU2V0dGluZ3NSb3cgPSB7XG4gIHN5c3RlbV9lbmFibGVkPzogYm9vbGVhbiB8IG51bGw7XG59O1xuXG50eXBlIEFnZW50UmF0ZUxpbWl0Um93ID0ge1xuICBhZ2VudF9uYW1lPzogc3RyaW5nIHwgbnVsbDtcbiAgbWF4X2NhbGxzX3Blcl9ob3VyPzogbnVtYmVyIHwgbnVsbDtcbiAgZW5hYmxlZD86IGJvb2xlYW4gfCBudWxsO1xufTtcblxuZnVuY3Rpb24ganNvblJlc3BvbnNlKGJvZHk6IHVua25vd24sIHN0YXR1cyA9IDIwMCkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGJvZHkpLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEVycm9yTWVzc2FnZShlcnJvcjogdW5rbm93bikge1xuICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIGVycm9yLm1lc3NhZ2U7XG4gIGlmICh0eXBlb2YgZXJyb3IgPT09IFwic3RyaW5nXCIpIHJldHVybiBlcnJvcjtcbiAgaWYgKGVycm9yICYmIHR5cGVvZiBlcnJvciA9PT0gXCJvYmplY3RcIiAmJiBcIm1lc3NhZ2VcIiBpbiBlcnJvcikge1xuICAgIHJldHVybiBTdHJpbmcoKGVycm9yIGFzIHsgbWVzc2FnZT86IHVua25vd24gfSkubWVzc2FnZSA/PyBcIlVua25vd24gZXJyb3JcIik7XG4gIH1cbiAgcmV0dXJuIFwiVW5rbm93biBlcnJvclwiO1xufVxuXG5mdW5jdGlvbiBpc1JlY29yZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG5cbmZ1bmN0aW9uIGlzVXVpZCh2YWx1ZTogc3RyaW5nKSB7XG4gIHJldHVybiAvXlswLTlhLWZdezh9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezR9LVswLTlhLWZdezEyfSQvaS50ZXN0KFxuICAgIHZhbHVlLFxuICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwYXJzZVJlcXVlc3RQYXlsb2FkKHJlcTogUmVxdWVzdCk6IFByb21pc2U8UmVjb3JkPHN0cmluZywgdW5rbm93bj4+IHtcbiAgY29uc3QgcmF3Qm9keSA9IGF3YWl0IHJlcS5jbG9uZSgpLnRleHQoKTtcbiAgY29uc3QgdHJpbW1lZCA9IHJhd0JvZHkudHJpbSgpO1xuXG4gIGlmICghdHJpbW1lZCkgcmV0dXJuIHt9O1xuXG4gIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UodHJpbW1lZCk7XG4gIHJldHVybiBpc1JlY29yZChwYXJzZWQpID8gcGFyc2VkIDoge307XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUZpZWxkQ29uZmlnKGZpZWxkOiBSZXF1aXJlZEZpZWxkKSB7XG4gIHJldHVybiB0eXBlb2YgZmllbGQgPT09IFwic3RyaW5nXCJcbiAgICA/IHsgbmFtZTogZmllbGQsIHR5cGU6IHVuZGVmaW5lZCwgdXVpZDogZmFsc2UsIGFsbG93RW1wdHlTdHJpbmc6IGZhbHNlLCBtaW5JdGVtczogMCB9XG4gICAgOiB7XG4gICAgICAgIG5hbWU6IGZpZWxkLm5hbWUsXG4gICAgICAgIHR5cGU6IGZpZWxkLnR5cGUsXG4gICAgICAgIHV1aWQ6IGZpZWxkLnV1aWQgPz8gZmFsc2UsXG4gICAgICAgIGFsbG93RW1wdHlTdHJpbmc6IGZpZWxkLmFsbG93RW1wdHlTdHJpbmcgPz8gZmFsc2UsXG4gICAgICAgIG1pbkl0ZW1zOiBmaWVsZC5taW5JdGVtcyA/PyAwLFxuICAgICAgfTtcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVQYXlsb2FkKFxuICBwYXlsb2FkOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPixcbiAgcmVxdWlyZWRGaWVsZHM6IFJlcXVpcmVkRmllbGRbXSxcbikge1xuICBjb25zdCBlcnJvcnM6IHN0cmluZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBmaWVsZCBvZiByZXF1aXJlZEZpZWxkcykge1xuICAgIGNvbnN0IGNvbmZpZyA9IG5vcm1hbGl6ZUZpZWxkQ29uZmlnKGZpZWxkKTtcbiAgICBjb25zdCB2YWx1ZSA9IHBheWxvYWRbY29uZmlnLm5hbWVdO1xuXG4gICAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHtcbiAgICAgIGVycm9ycy5wdXNoKGAke2NvbmZpZy5uYW1lfSBpcyByZXF1aXJlZGApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKCFjb25maWcuYWxsb3dFbXB0eVN0cmluZyAmJiB0eXBlb2YgdmFsdWUgPT09IFwic3RyaW5nXCIgJiYgdmFsdWUudHJpbSgpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgZXJyb3JzLnB1c2goYCR7Y29uZmlnLm5hbWV9IGlzIHJlcXVpcmVkYCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLnR5cGUgPT09IFwic3RyaW5nXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICBlcnJvcnMucHVzaChgJHtjb25maWcubmFtZX0gbXVzdCBiZSBhIHN0cmluZ2ApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy50eXBlID09PSBcIm51bWJlclwiICYmIHR5cGVvZiB2YWx1ZSAhPT0gXCJudW1iZXJcIikge1xuICAgICAgZXJyb3JzLnB1c2goYCR7Y29uZmlnLm5hbWV9IG11c3QgYmUgYSBudW1iZXJgKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGlmIChjb25maWcudHlwZSA9PT0gXCJib29sZWFuXCIgJiYgdHlwZW9mIHZhbHVlICE9PSBcImJvb2xlYW5cIikge1xuICAgICAgZXJyb3JzLnB1c2goYCR7Y29uZmlnLm5hbWV9IG11c3QgYmUgYSBib29sZWFuYCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLnR5cGUgPT09IFwiYXJyYXlcIikge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICBlcnJvcnMucHVzaChgJHtjb25maWcubmFtZX0gbXVzdCBiZSBhbiBhcnJheWApO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbmZpZy5taW5JdGVtcyA+IDAgJiYgdmFsdWUubGVuZ3RoIDwgY29uZmlnLm1pbkl0ZW1zKSB7XG4gICAgICAgIGVycm9ycy5wdXNoKGAke2NvbmZpZy5uYW1lfSBtdXN0IGNvbnRhaW4gYXQgbGVhc3QgJHtjb25maWcubWluSXRlbXN9IGl0ZW0ocylgKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy50eXBlID09PSBcIm9iamVjdFwiICYmICFpc1JlY29yZCh2YWx1ZSkpIHtcbiAgICAgIGVycm9ycy5wdXNoKGAke2NvbmZpZy5uYW1lfSBtdXN0IGJlIGFuIG9iamVjdGApO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy51dWlkKSB7XG4gICAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiIHx8ICFpc1V1aWQodmFsdWUudHJpbSgpKSkge1xuICAgICAgICBlcnJvcnMucHVzaChgJHtjb25maWcubmFtZX0gbXVzdCBiZSBhIHZhbGlkIFVVSURgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gZXJyb3JzO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0RGVhbElkKHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSB7XG4gIGNvbnN0IGNhbmRpZGF0ZSA9IHBheWxvYWQuZGVhbF9pZDtcbiAgcmV0dXJuIHR5cGVvZiBjYW5kaWRhdGUgPT09IFwic3RyaW5nXCIgJiYgY2FuZGlkYXRlLnRyaW0oKS5sZW5ndGggPiAwXG4gICAgPyBjYW5kaWRhdGUudHJpbSgpXG4gICAgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBnZXRSdW50aW1lVmVyc2lvbihjb25maWc6IEFnZW50SGFuZGxlckNvbmZpZykge1xuICBjb25zdCBjb25maWd1cmVkID0gY29uZmlnLnZlcnNpb24/LnRyaW0oKTtcbiAgaWYgKGNvbmZpZ3VyZWQpIHJldHVybiBjb25maWd1cmVkO1xuXG4gIGNvbnN0IGVudlZlcnNpb24gPSBEZW5vLmVudi5nZXQoXCJBR0VOVF9SVU5USU1FX1ZFUlNJT05cIik/LnRyaW0oKTtcbiAgaWYgKGVudlZlcnNpb24pIHJldHVybiBlbnZWZXJzaW9uO1xuXG4gIHJldHVybiBcIjIwMjYtMDMtMjVcIjtcbn1cblxuZnVuY3Rpb24gY3JlYXRlU2VydmljZUNsaWVudCgpOiBTdXBhYmFzZUNsaWVudExpa2UgfCBudWxsIHtcbiAgY29uc3Qgc3VwYWJhc2VVcmwgPSBEZW5vLmVudi5nZXQoXCJTVVBBQkFTRV9VUkxcIik7XG4gIGNvbnN0IHNlcnZpY2VLZXkgPSBEZW5vLmVudi5nZXQoXCJTVVBBQkFTRV9TRVJWSUNFX1JPTEVfS0VZXCIpO1xuXG4gIGlmICghc3VwYWJhc2VVcmwgfHwgIXNlcnZpY2VLZXkpIHJldHVybiBudWxsO1xuICByZXR1cm4gY3JlYXRlQ2xpZW50KHN1cGFiYXNlVXJsLCBzZXJ2aWNlS2V5KTtcbn1cblxuZnVuY3Rpb24gdG9FbnZLZXkoYWdlbnROYW1lOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGFnZW50TmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOV0rL2csIFwiX1wiKS50b1VwcGVyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBnZXREZWZhdWx0UmF0ZUxpbWl0UGVySG91cigpIHtcbiAgY29uc3QgdmFsdWUgPSBOdW1iZXIoRGVuby5lbnYuZ2V0KFwiREVGQVVMVF9BR0VOVF9NQVhfQ0FMTFNfUEVSX0hPVVJcIikgPz8gXCIxMjBcIik7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID4gMCA/IE1hdGgudHJ1bmModmFsdWUpIDogMTIwO1xufVxuXG5mdW5jdGlvbiBnZXRFc3RpbWF0ZWRDYWxsQ29zdChhZ2VudE5hbWU6IHN0cmluZykge1xuICBjb25zdCBzcGVjaWZpY1ZhbHVlID0gTnVtYmVyKFxuICAgIERlbm8uZW52LmdldChgQUdFTlRfRVNUSU1BVEVEX0NPU1RfJHt0b0VudktleShhZ2VudE5hbWUpfWApID8/IFwiXCIsXG4gICk7XG4gIGlmIChOdW1iZXIuaXNGaW5pdGUoc3BlY2lmaWNWYWx1ZSkgJiYgc3BlY2lmaWNWYWx1ZSA+PSAwKSB7XG4gICAgcmV0dXJuIHNwZWNpZmljVmFsdWU7XG4gIH1cblxuICBjb25zdCBkZWZhdWx0VmFsdWUgPSBOdW1iZXIoRGVuby5lbnYuZ2V0KFwiREVGQVVMVF9BR0VOVF9FU1RJTUFURURfQ09TVFwiKSA/PyBcIjBcIik7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUoZGVmYXVsdFZhbHVlKSAmJiBkZWZhdWx0VmFsdWUgPj0gMCA/IGRlZmF1bHRWYWx1ZSA6IDA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRTeXN0ZW1FbmFibGVkKFxuICBzdXBhYmFzZTogU3VwYWJhc2VDbGllbnRMaWtlIHwgbnVsbCxcbikge1xuICBpZiAoIXN1cGFiYXNlKSByZXR1cm4gdHJ1ZTtcblxuICBjb25zdCB7IGRhdGEsIGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZVxuICAgIC5mcm9tKFwic3lzdGVtX3NldHRpbmdzXCIpXG4gICAgLnNlbGVjdChcInN5c3RlbV9lbmFibGVkXCIpXG4gICAgLmVxKFwic2V0dGluZ19rZXlcIiwgXCJnbG9iYWxcIilcbiAgICAubWF5YmVTaW5nbGUoKTtcblxuICBpZiAoZXJyb3IpIHtcbiAgICBjb25zb2xlLndhcm4oXCJzeXN0ZW0gc2V0dGluZ3MgbG9va3VwIGZhaWxlZFwiLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgcmV0dXJuIChkYXRhIGFzIFN5c3RlbVNldHRpbmdzUm93IHwgbnVsbCk/LnN5c3RlbV9lbmFibGVkICE9PSBmYWxzZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0QWdlbnRSYXRlTGltaXQoXG4gIHN1cGFiYXNlOiBTdXBhYmFzZUNsaWVudExpa2UgfCBudWxsLFxuICBjb25maWc6IEFnZW50SGFuZGxlckNvbmZpZyxcbikge1xuICBpZiAoIXN1cGFiYXNlKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBkZWZhdWx0UmF0ZUxpbWl0ID0gZ2V0RGVmYXVsdFJhdGVMaW1pdFBlckhvdXIoKTtcbiAgY29uc3QgeyBkYXRhLCBlcnJvciB9ID0gYXdhaXQgc3VwYWJhc2VcbiAgICAuZnJvbShcImFnZW50X3JhdGVfbGltaXRzXCIpXG4gICAgLnVwc2VydChcbiAgICAgIHtcbiAgICAgICAgYWdlbnRfbmFtZTogY29uZmlnLmFnZW50TmFtZSxcbiAgICAgICAgbWF4X2NhbGxzX3Blcl9ob3VyOiBkZWZhdWx0UmF0ZUxpbWl0LFxuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHsgb25Db25mbGljdDogXCJhZ2VudF9uYW1lXCIgfSxcbiAgICApXG4gICAgLnNlbGVjdChcImFnZW50X25hbWUsIG1heF9jYWxsc19wZXJfaG91ciwgZW5hYmxlZFwiKVxuICAgIC5zaW5nbGUoKTtcblxuICBpZiAoZXJyb3IpIHtcbiAgICBjb25zb2xlLndhcm4oXCJhZ2VudCByYXRlIGxpbWl0IGxvb2t1cCBmYWlsZWRcIiwge1xuICAgICAgYWdlbnQ6IGNvbmZpZy5hZ2VudE5hbWUsXG4gICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHJldHVybiBkYXRhIGFzIEFnZW50UmF0ZUxpbWl0Um93IHwgbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaXNSYXRlTGltaXRlZChcbiAgc3VwYWJhc2U6IFN1cGFiYXNlQ2xpZW50TGlrZSB8IG51bGwsXG4gIGNvbmZpZzogQWdlbnRIYW5kbGVyQ29uZmlnLFxuKSB7XG4gIGlmICghc3VwYWJhc2UgfHwgY29uZmlnLnNraXBSYXRlTGltaXQpIHtcbiAgICByZXR1cm4geyBsaW1pdGVkOiBmYWxzZSwgY291bnQ6IDAsIGxpbWl0OiBudWxsIGFzIG51bWJlciB8IG51bGwgfTtcbiAgfVxuXG4gIGNvbnN0IHJhdGVMaW1pdFJvdyA9IGF3YWl0IGdldEFnZW50UmF0ZUxpbWl0KHN1cGFiYXNlLCBjb25maWcpO1xuICBjb25zdCBlbmFibGVkID0gcmF0ZUxpbWl0Um93Py5lbmFibGVkICE9PSBmYWxzZTtcbiAgY29uc3QgbGltaXQgPSB0eXBlb2YgcmF0ZUxpbWl0Um93Py5tYXhfY2FsbHNfcGVyX2hvdXIgPT09IFwibnVtYmVyXCJcbiAgICA/IE1hdGgudHJ1bmMocmF0ZUxpbWl0Um93Lm1heF9jYWxsc19wZXJfaG91cilcbiAgICA6IG51bGw7XG5cbiAgaWYgKCFlbmFibGVkIHx8ICFsaW1pdCB8fCBsaW1pdCA8PSAwKSB7XG4gICAgcmV0dXJuIHsgbGltaXRlZDogZmFsc2UsIGNvdW50OiAwLCBsaW1pdCB9O1xuICB9XG5cbiAgY29uc3QgY3V0b2ZmID0gbmV3IERhdGUoRGF0ZS5ub3coKSAtIDYwICogNjAgKiAxMDAwKS50b0lTT1N0cmluZygpO1xuICBjb25zdCB7IGRhdGEsIGVycm9yIH0gPSBhd2FpdCBzdXBhYmFzZVxuICAgIC5mcm9tKFwidXNhZ2VfbWV0cmljc1wiKVxuICAgIC5zZWxlY3QoXCJjYWxsc1wiKVxuICAgIC5lcShcImFnZW50X25hbWVcIiwgY29uZmlnLmFnZW50TmFtZSlcbiAgICAuZ3RlKFwidGltZXN0YW1wXCIsIGN1dG9mZik7XG5cbiAgaWYgKGVycm9yKSB7XG4gICAgY29uc29sZS53YXJuKFwidXNhZ2UgbWV0cmljcyBsb29rdXAgZmFpbGVkXCIsIHtcbiAgICAgIGFnZW50OiBjb25maWcuYWdlbnROYW1lLFxuICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgfSk7XG4gICAgcmV0dXJuIHsgbGltaXRlZDogZmFsc2UsIGNvdW50OiAwLCBsaW1pdCB9O1xuICB9XG5cbiAgY29uc3QgY291bnQgPSAoZGF0YSA/PyBbXSkucmVkdWNlKChzdW06IG51bWJlciwgcm93OiB7IGNhbGxzPzogdW5rbm93biB9KSA9PiB7XG4gICAgY29uc3QgY2FsbHMgPSB0eXBlb2Ygcm93LmNhbGxzID09PSBcIm51bWJlclwiID8gcm93LmNhbGxzIDogTnVtYmVyKHJvdy5jYWxscyA/PyAwKTtcbiAgICByZXR1cm4gc3VtICsgKE51bWJlci5pc0Zpbml0ZShjYWxscykgPyBjYWxscyA6IDApO1xuICB9LCAwKTtcblxuICByZXR1cm4ge1xuICAgIGxpbWl0ZWQ6IGNvdW50ID49IGxpbWl0LFxuICAgIGNvdW50LFxuICAgIGxpbWl0LFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBsb2dVc2FnZU1ldHJpYyhcbiAgc3VwYWJhc2U6IFN1cGFiYXNlQ2xpZW50TGlrZSB8IG51bGwsXG4gIGNvbmZpZzogQWdlbnRIYW5kbGVyQ29uZmlnLFxuICByZXNwb25zZVN0YXR1czogbnVtYmVyLFxuKSB7XG4gIGlmICghc3VwYWJhc2UgfHwgY29uZmlnLnNraXBVc2FnZVRyYWNraW5nIHx8IHJlc3BvbnNlU3RhdHVzID49IDUwMCkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgZXJyb3IgfSA9IGF3YWl0IHN1cGFiYXNlLmZyb20oXCJ1c2FnZV9tZXRyaWNzXCIpLmluc2VydCh7XG4gICAgYWdlbnRfbmFtZTogY29uZmlnLmFnZW50TmFtZSxcbiAgICBjYWxsczogMSxcbiAgICBlc3RpbWF0ZWRfY29zdDogZ2V0RXN0aW1hdGVkQ2FsbENvc3QoY29uZmlnLmFnZW50TmFtZSksXG4gICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gIH0pO1xuXG4gIGlmIChlcnJvcikge1xuICAgIGNvbnNvbGUud2FybihcInVzYWdlIG1ldHJpYyBpbnNlcnQgZmFpbGVkXCIsIHtcbiAgICAgIGFnZW50OiBjb25maWcuYWdlbnROYW1lLFxuICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgfSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gdXBzZXJ0UmVnaXN0cnlTdGF0dXMoXG4gIHN1cGFiYXNlOiBTdXBhYmFzZUNsaWVudExpa2UgfCBudWxsLFxuICBjb25maWc6IEFnZW50SGFuZGxlckNvbmZpZyxcbiAgc3RhdHVzOiBcInJ1bm5pbmdcIiB8IFwiYWN0aXZlXCIgfCBcImVycm9yXCIsXG4gIGVycm9yTWVzc2FnZTogc3RyaW5nIHwgbnVsbCxcbikge1xuICBpZiAoIXN1cGFiYXNlKSByZXR1cm47XG5cbiAgY29uc3QgeyBlcnJvciB9ID0gYXdhaXQgc3VwYWJhc2UuZnJvbShcImFnZW50X3JlZ2lzdHJ5XCIpLnVwc2VydChcbiAgICB7XG4gICAgICBhZ2VudF9uYW1lOiBjb25maWcuYWdlbnROYW1lLFxuICAgICAgdmVyc2lvbjogZ2V0UnVudGltZVZlcnNpb24oY29uZmlnKSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIGxhc3RfcnVuOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBsYXN0X2Vycm9yOiBlcnJvck1lc3NhZ2UsXG4gICAgfSxcbiAgICB7IG9uQ29uZmxpY3Q6IFwiYWdlbnRfbmFtZVwiIH0sXG4gICk7XG5cbiAgaWYgKGVycm9yKSB7XG4gICAgY29uc29sZS53YXJuKFwiYWdlbnQtcmVnaXN0cnkgdXBzZXJ0IGZhaWxlZFwiLCB7XG4gICAgICBhZ2VudDogY29uZmlnLmFnZW50TmFtZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgIH0pO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvZ0V4ZWN1dGlvbihcbiAgc3VwYWJhc2U6IFN1cGFiYXNlQ2xpZW50TGlrZSB8IG51bGwsXG4gIGNvbmZpZzogQWdlbnRIYW5kbGVyQ29uZmlnLFxuICBpbnB1dDogRXhlY3V0aW9uTG9nSW5wdXQsXG4pIHtcbiAgaWYgKCFzdXBhYmFzZSB8fCBjb25maWcubG9nRXhlY3V0aW9uID09PSBmYWxzZSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgZXJyb3IgfSA9IGF3YWl0IHN1cGFiYXNlLmZyb20oXCJhaV9hY3Rpb25zXCIpLmluc2VydCh7XG4gICAgZGVhbF9pZDogaW5wdXQuZGVhbElkLFxuICAgIGFnZW50OiBjb25maWcuYWdlbnROYW1lLFxuICAgIGFjdGlvbjogXCJhZ2VudF9leGVjdXRpb25cIixcbiAgICBzb3VyY2U6IFwiZWRnZV9mdW5jdGlvblwiLFxuICAgIHBheWxvYWQ6IHtcbiAgICAgIHZlcnNpb246IGdldFJ1bnRpbWVWZXJzaW9uKGNvbmZpZyksXG4gICAgICB2YWxpZGF0aW9uOiB7XG4gICAgICAgIHBhc3NlZDogaW5wdXQudmFsaWRhdGlvblBhc3NlZCxcbiAgICAgICAgZXJyb3JzOiBpbnB1dC52YWxpZGF0aW9uRXJyb3JzLFxuICAgICAgICByZXF1aXJlZF9maWVsZHM6IChjb25maWcucmVxdWlyZWRGaWVsZHMgPz8gW10pLm1hcCgoZmllbGQpID0+XG4gICAgICAgICAgdHlwZW9mIGZpZWxkID09PSBcInN0cmluZ1wiID8gZmllbGQgOiBmaWVsZC5uYW1lXG4gICAgICAgICksXG4gICAgICB9LFxuICAgICAgcmVxdWVzdDoge1xuICAgICAgICBkZWFsX2lkOiBpbnB1dC5kZWFsSWQsXG4gICAgICB9LFxuICAgICAgcmVzcG9uc2U6IHtcbiAgICAgICAgc3RhdHVzOiBpbnB1dC5yZXNwb25zZVN0YXR1cyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBleGVjdXRpb25fdGltZV9tczogaW5wdXQuZXhlY3V0aW9uVGltZU1zLFxuICAgIHN1Y2Nlc3M6IGlucHV0LnN0YXR1cyA9PT0gXCJhY3RpdmVcIixcbiAgICBlcnJvcl9jb250ZXh0OiBpbnB1dC5lcnJvck1lc3NhZ2VcbiAgICAgID8ge1xuICAgICAgICAgIG1lc3NhZ2U6IGlucHV0LmVycm9yTWVzc2FnZSxcbiAgICAgICAgICByZXNwb25zZV9zdGF0dXM6IGlucHV0LnJlc3BvbnNlU3RhdHVzLFxuICAgICAgICAgIHJlcXVlc3RfcGF5bG9hZDogaW5wdXQucmVxdWVzdFBheWxvYWQsXG4gICAgICAgIH1cbiAgICAgIDogbnVsbCxcbiAgfSk7XG5cbiAgaWYgKGVycm9yKSB7XG4gICAgY29uc29sZS53YXJuKFwiYWdlbnQgZXhlY3V0aW9uIGF1ZGl0IGZhaWxlZFwiLCB7XG4gICAgICBhZ2VudDogY29uZmlnLmFnZW50TmFtZSxcbiAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBZ2VudEhhbmRsZXIoXG4gIGNvbmZpZzogQWdlbnRIYW5kbGVyQ29uZmlnLFxuICBoYW5kbGVyOiAocmVxOiBSZXF1ZXN0KSA9PiBQcm9taXNlPFJlc3BvbnNlPixcbikge1xuICByZXR1cm4gYXN5bmMgKHJlcTogUmVxdWVzdCkgPT4ge1xuICAgIGNvbnN0IHN0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgY29uc3Qgc3VwYWJhc2UgPSBjcmVhdGVTZXJ2aWNlQ2xpZW50KCk7XG4gICAgbGV0IHBheWxvYWQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge307XG4gICAgbGV0IHZhbGlkYXRpb25FcnJvcnM6IHN0cmluZ1tdID0gW107XG4gICAgbGV0IHJlc3BvbnNlU3RhdHVzID0gNTAwO1xuICAgIGxldCByZXNwb25zZTogUmVzcG9uc2UgfCBudWxsID0gbnVsbDtcbiAgICBsZXQgZXJyb3JNZXNzYWdlOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuICAgIGlmIChyZXEubWV0aG9kICE9PSBcIlBPU1RcIikge1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZSh7IGVycm9yOiBcIk1ldGhvZCBub3QgYWxsb3dlZFwiIH0sIDQwNSk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHBheWxvYWQgPSBhd2FpdCBwYXJzZVJlcXVlc3RQYXlsb2FkKHJlcSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICB2YWxpZGF0aW9uRXJyb3JzID0gW1wiSW52YWxpZCBKU09OIGJvZHlcIl07XG4gICAgICByZXNwb25zZVN0YXR1cyA9IDQwMDtcbiAgICAgIGVycm9yTWVzc2FnZSA9IFwiSW52YWxpZCBKU09OIGJvZHlcIjtcbiAgICAgIGF3YWl0IHVwc2VydFJlZ2lzdHJ5U3RhdHVzKHN1cGFiYXNlLCBjb25maWcsIFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlKTtcbiAgICAgIGF3YWl0IGxvZ0V4ZWN1dGlvbihzdXBhYmFzZSwgY29uZmlnLCB7XG4gICAgICAgIGRlYWxJZDogbnVsbCxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgIGVycm9yTWVzc2FnZSxcbiAgICAgICAgZXhlY3V0aW9uVGltZU1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxuICAgICAgICB2YWxpZGF0aW9uUGFzc2VkOiBmYWxzZSxcbiAgICAgICAgdmFsaWRhdGlvbkVycm9ycyxcbiAgICAgICAgcmVxdWVzdFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHJlc3BvbnNlU3RhdHVzLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKHsgZXJyb3I6IFwiSW52YWxpZCBKU09OIGJvZHlcIiB9LCA0MDApO1xuICAgIH1cblxuICAgIHZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0ZVBheWxvYWQocGF5bG9hZCwgY29uZmlnLnJlcXVpcmVkRmllbGRzID8/IFtdKTtcblxuICAgIGlmIChjb25maWcudmFsaWRhdGUpIHtcbiAgICAgIHZhbGlkYXRpb25FcnJvcnMucHVzaCguLi5jb25maWcudmFsaWRhdGUocGF5bG9hZCkpO1xuICAgIH1cblxuICAgIGlmICh2YWxpZGF0aW9uRXJyb3JzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJlc3BvbnNlU3RhdHVzID0gNDAwO1xuICAgICAgZXJyb3JNZXNzYWdlID0gdmFsaWRhdGlvbkVycm9ycy5qb2luKFwiOyBcIik7XG4gICAgICBhd2FpdCB1cHNlcnRSZWdpc3RyeVN0YXR1cyhzdXBhYmFzZSwgY29uZmlnLCBcImVycm9yXCIsIGVycm9yTWVzc2FnZSk7XG4gICAgICBhd2FpdCBsb2dFeGVjdXRpb24oc3VwYWJhc2UsIGNvbmZpZywge1xuICAgICAgICBkZWFsSWQ6IGV4dHJhY3REZWFsSWQocGF5bG9hZCksXG4gICAgICAgIHN0YXR1czogXCJlcnJvclwiLFxuICAgICAgICBlcnJvck1lc3NhZ2UsXG4gICAgICAgIGV4ZWN1dGlvblRpbWVNczogRGF0ZS5ub3coKSAtIHN0YXJ0ZWRBdCxcbiAgICAgICAgdmFsaWRhdGlvblBhc3NlZDogZmFsc2UsXG4gICAgICAgIHZhbGlkYXRpb25FcnJvcnMsXG4gICAgICAgIHJlcXVlc3RQYXlsb2FkOiBwYXlsb2FkLFxuICAgICAgICByZXNwb25zZVN0YXR1cyxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGpzb25SZXNwb25zZShcbiAgICAgICAge1xuICAgICAgICAgIGVycm9yOiB2YWxpZGF0aW9uRXJyb3JzWzBdLFxuICAgICAgICAgIHZhbGlkYXRpb25fZXJyb3JzOiB2YWxpZGF0aW9uRXJyb3JzLFxuICAgICAgICAgIHJlY2VpdmVkOiBwYXlsb2FkLFxuICAgICAgICB9LFxuICAgICAgICA0MDAsXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IHN5c3RlbUVuYWJsZWQgPSBhd2FpdCByZWFkU3lzdGVtRW5hYmxlZChzdXBhYmFzZSk7XG4gICAgaWYgKCFzeXN0ZW1FbmFibGVkICYmICFjb25maWcuYWxsb3dXaGVuRGlzYWJsZWQpIHtcbiAgICAgIHJlc3BvbnNlU3RhdHVzID0gNTAzO1xuICAgICAgZXJyb3JNZXNzYWdlID0gXCJTeXN0ZW0gaXMgZGlzYWJsZWQgYnkgb3BlcmF0b3Iga2lsbCBzd2l0Y2hcIjtcbiAgICAgIGF3YWl0IHVwc2VydFJlZ2lzdHJ5U3RhdHVzKHN1cGFiYXNlLCBjb25maWcsIFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlKTtcbiAgICAgIGF3YWl0IGxvZ0V4ZWN1dGlvbihzdXBhYmFzZSwgY29uZmlnLCB7XG4gICAgICAgIGRlYWxJZDogZXh0cmFjdERlYWxJZChwYXlsb2FkKSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgIGVycm9yTWVzc2FnZSxcbiAgICAgICAgZXhlY3V0aW9uVGltZU1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxuICAgICAgICB2YWxpZGF0aW9uUGFzc2VkOiB0cnVlLFxuICAgICAgICB2YWxpZGF0aW9uRXJyb3JzOiBbXSxcbiAgICAgICAgcmVxdWVzdFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHJlc3BvbnNlU3RhdHVzLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKHtcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcbiAgICAgICAgc3lzdGVtX2VuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSwgNTAzKTtcbiAgICB9XG5cbiAgICBjb25zdCByYXRlTGltaXQgPSBhd2FpdCBpc1JhdGVMaW1pdGVkKHN1cGFiYXNlLCBjb25maWcpO1xuICAgIGlmIChyYXRlTGltaXQubGltaXRlZCkge1xuICAgICAgcmVzcG9uc2VTdGF0dXMgPSA0Mjk7XG4gICAgICBlcnJvck1lc3NhZ2UgPVxuICAgICAgICBgUmF0ZSBsaW1pdCBleGNlZWRlZCBmb3IgJHtjb25maWcuYWdlbnROYW1lfTogJHtyYXRlTGltaXQuY291bnR9LyR7cmF0ZUxpbWl0LmxpbWl0fSBjYWxscyBpbiB0aGUgbGFzdCBob3VyYDtcbiAgICAgIGF3YWl0IHVwc2VydFJlZ2lzdHJ5U3RhdHVzKHN1cGFiYXNlLCBjb25maWcsIFwiZXJyb3JcIiwgZXJyb3JNZXNzYWdlKTtcbiAgICAgIGF3YWl0IGxvZ0V4ZWN1dGlvbihzdXBhYmFzZSwgY29uZmlnLCB7XG4gICAgICAgIGRlYWxJZDogZXh0cmFjdERlYWxJZChwYXlsb2FkKSxcbiAgICAgICAgc3RhdHVzOiBcImVycm9yXCIsXG4gICAgICAgIGVycm9yTWVzc2FnZSxcbiAgICAgICAgZXhlY3V0aW9uVGltZU1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxuICAgICAgICB2YWxpZGF0aW9uUGFzc2VkOiB0cnVlLFxuICAgICAgICB2YWxpZGF0aW9uRXJyb3JzOiBbXSxcbiAgICAgICAgcmVxdWVzdFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICAgIHJlc3BvbnNlU3RhdHVzLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ganNvblJlc3BvbnNlKHtcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcbiAgICAgICAgcmF0ZV9saW1pdDoge1xuICAgICAgICAgIGNvdW50OiByYXRlTGltaXQuY291bnQsXG4gICAgICAgICAgbGltaXQ6IHJhdGVMaW1pdC5saW1pdCxcbiAgICAgICAgICB3aW5kb3c6IFwiMWhcIixcbiAgICAgICAgfSxcbiAgICAgIH0sIDQyOSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdXBzZXJ0UmVnaXN0cnlTdGF0dXMoc3VwYWJhc2UsIGNvbmZpZywgXCJydW5uaW5nXCIsIG51bGwpO1xuXG4gICAgdHJ5IHtcbiAgICAgIHJlc3BvbnNlID0gYXdhaXQgaGFuZGxlcihyZXEpO1xuICAgICAgcmVzcG9uc2VTdGF0dXMgPSByZXNwb25zZS5zdGF0dXM7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGVycm9yTWVzc2FnZSA9IGdldEVycm9yTWVzc2FnZShlcnJvcik7XG4gICAgICByZXNwb25zZVN0YXR1cyA9IDUwMDtcbiAgICAgIHJlc3BvbnNlID0ganNvblJlc3BvbnNlKHsgZXJyb3I6IGVycm9yTWVzc2FnZSB9LCA1MDApO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXR1cyA9IHJlc3BvbnNlU3RhdHVzIDwgNDAwID8gXCJhY3RpdmVcIiA6IFwiZXJyb3JcIjtcbiAgICBpZiAoc3RhdHVzID09PSBcImVycm9yXCIgJiYgIWVycm9yTWVzc2FnZSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYm9keSA9IGF3YWl0IHJlc3BvbnNlLmNsb25lKCkuanNvbigpO1xuICAgICAgICBpZiAoaXNSZWNvcmQoYm9keSkgJiYgdHlwZW9mIGJvZHkuZXJyb3IgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgICBlcnJvck1lc3NhZ2UgPSBib2R5LmVycm9yO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgZXJyb3JNZXNzYWdlID0gYEhUVFAgJHtyZXNwb25zZVN0YXR1c31gO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHVwc2VydFJlZ2lzdHJ5U3RhdHVzKHN1cGFiYXNlLCBjb25maWcsIHN0YXR1cywgZXJyb3JNZXNzYWdlKTtcbiAgICBhd2FpdCBsb2dFeGVjdXRpb24oc3VwYWJhc2UsIGNvbmZpZywge1xuICAgICAgZGVhbElkOiBleHRyYWN0RGVhbElkKHBheWxvYWQpLFxuICAgICAgc3RhdHVzLFxuICAgICAgZXJyb3JNZXNzYWdlLFxuICAgICAgZXhlY3V0aW9uVGltZU1zOiBEYXRlLm5vdygpIC0gc3RhcnRlZEF0LFxuICAgICAgdmFsaWRhdGlvblBhc3NlZDogdHJ1ZSxcbiAgICAgIHZhbGlkYXRpb25FcnJvcnM6IFtdLFxuICAgICAgcmVxdWVzdFBheWxvYWQ6IHBheWxvYWQsXG4gICAgICByZXNwb25zZVN0YXR1cyxcbiAgICB9KTtcbiAgICBhd2FpdCBsb2dVc2FnZU1ldHJpYyhzdXBhYmFzZSwgY29uZmlnLCByZXNwb25zZVN0YXR1cyk7XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH07XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsU0FBUyxZQUFZLFFBQVEsdUNBQXVDO0FBZ0RwRSxTQUFT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
// denoCacheMetadata=1247057741388305365,15930142902202185417