import { createClient } from "https://esm.sh/@supabase/supabase-js";

type FieldType = "string" | "number" | "boolean" | "array" | "object";

export type RequiredField =
  | string
  | {
      name: string;
      type?: FieldType;
      uuid?: boolean;
      allowEmptyString?: boolean;
      minItems?: number;
    };

export type AgentHandlerConfig = {
  agentName: string;
  version?: string;
  requiredFields?: RequiredField[];
  validate?: (payload: Record<string, unknown>) => string[];
  logExecution?: boolean;
  allowWhenDisabled?: boolean;
  skipRateLimit?: boolean;
  skipUsageTracking?: boolean;
};

type ExecutionLogInput = {
  dealId: string | null;
  status: "active" | "error";
  errorMessage: string | null;
  executionTimeMs: number;
  validationPassed: boolean;
  validationErrors: string[];
  requestPayload: Record<string, unknown>;
  responseStatus: number;
};

type SupabaseClientLike = any;

type SystemSettingsRow = {
  system_enabled?: boolean | null;
};

type AgentRateLimitRow = {
  agent_name?: string | null;
  max_calls_per_hour?: number | null;
  enabled?: boolean | null;
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
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }
  return "Unknown error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function parseRequestPayload(req: Request): Promise<Record<string, unknown>> {
  const rawBody = await req.clone().text();
  const trimmed = rawBody.trim();

  if (!trimmed) return {};

  const parsed = JSON.parse(trimmed);
  return isRecord(parsed) ? parsed : {};
}

function normalizeFieldConfig(field: RequiredField) {
  return typeof field === "string"
    ? { name: field, type: undefined, uuid: false, allowEmptyString: false, minItems: 0 }
    : {
        name: field.name,
        type: field.type,
        uuid: field.uuid ?? false,
        allowEmptyString: field.allowEmptyString ?? false,
        minItems: field.minItems ?? 0,
      };
}

function validatePayload(
  payload: Record<string, unknown>,
  requiredFields: RequiredField[],
) {
  const errors: string[] = [];

  for (const field of requiredFields) {
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

function extractDealId(payload: Record<string, unknown>) {
  const candidate = payload.deal_id;
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : null;
}

function getRuntimeVersion(config: AgentHandlerConfig) {
  const configured = config.version?.trim();
  if (configured) return configured;

  const envVersion = Deno.env.get("AGENT_RUNTIME_VERSION")?.trim();
  if (envVersion) return envVersion;

  return "2026-03-25";
}

function createServiceClient(): SupabaseClientLike | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

function toEnvKey(agentName: string) {
  return agentName.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
}

function getDefaultRateLimitPerHour() {
  const value = Number(Deno.env.get("DEFAULT_AGENT_MAX_CALLS_PER_HOUR") ?? "120");
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 120;
}

function getEstimatedCallCost(agentName: string) {
  const specificValue = Number(
    Deno.env.get(`AGENT_ESTIMATED_COST_${toEnvKey(agentName)}`) ?? "",
  );
  if (Number.isFinite(specificValue) && specificValue >= 0) {
    return specificValue;
  }

  const defaultValue = Number(Deno.env.get("DEFAULT_AGENT_ESTIMATED_COST") ?? "0");
  return Number.isFinite(defaultValue) && defaultValue >= 0 ? defaultValue : 0;
}

async function readSystemEnabled(
  supabase: SupabaseClientLike | null,
) {
  if (!supabase) return true;

  const { data, error } = await supabase
    .from("system_settings")
    .select("system_enabled")
    .eq("setting_key", "global")
    .maybeSingle();

  if (error) {
    console.warn("system settings lookup failed", { error: error.message });
    return true;
  }

  return (data as SystemSettingsRow | null)?.system_enabled !== false;
}

async function getAgentRateLimit(
  supabase: SupabaseClientLike | null,
  config: AgentHandlerConfig,
) {
  if (!supabase) return null;

  const defaultRateLimit = getDefaultRateLimitPerHour();
  const { data, error } = await supabase
    .from("agent_rate_limits")
    .upsert(
      {
        agent_name: config.agentName,
        max_calls_per_hour: defaultRateLimit,
        enabled: true,
      },
      { onConflict: "agent_name" },
    )
    .select("agent_name, max_calls_per_hour, enabled")
    .single();

  if (error) {
    console.warn("agent rate limit lookup failed", {
      agent: config.agentName,
      error: error.message,
    });
    return null;
  }

  return data as AgentRateLimitRow | null;
}

async function isRateLimited(
  supabase: SupabaseClientLike | null,
  config: AgentHandlerConfig,
) {
  if (!supabase || config.skipRateLimit) {
    return { limited: false, count: 0, limit: null as number | null };
  }

  const rateLimitRow = await getAgentRateLimit(supabase, config);
  const enabled = rateLimitRow?.enabled !== false;
  const limit = typeof rateLimitRow?.max_calls_per_hour === "number"
    ? Math.trunc(rateLimitRow.max_calls_per_hour)
    : null;

  if (!enabled || !limit || limit <= 0) {
    return { limited: false, count: 0, limit };
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("usage_metrics")
    .select("calls")
    .eq("agent_name", config.agentName)
    .gte("timestamp", cutoff);

  if (error) {
    console.warn("usage metrics lookup failed", {
      agent: config.agentName,
      error: error.message,
    });
    return { limited: false, count: 0, limit };
  }

  const count = (data ?? []).reduce((sum: number, row: { calls?: unknown }) => {
    const calls = typeof row.calls === "number" ? row.calls : Number(row.calls ?? 0);
    return sum + (Number.isFinite(calls) ? calls : 0);
  }, 0);

  return {
    limited: count >= limit,
    count,
    limit,
  };
}

async function logUsageMetric(
  supabase: SupabaseClientLike | null,
  config: AgentHandlerConfig,
  responseStatus: number,
) {
  if (!supabase || config.skipUsageTracking || responseStatus >= 500) return;

  const { error } = await supabase.from("usage_metrics").insert({
    agent_name: config.agentName,
    calls: 1,
    estimated_cost: getEstimatedCallCost(config.agentName),
    timestamp: new Date().toISOString(),
  });

  if (error) {
    console.warn("usage metric insert failed", {
      agent: config.agentName,
      error: error.message,
    });
  }
}

async function upsertRegistryStatus(
  supabase: SupabaseClientLike | null,
  config: AgentHandlerConfig,
  status: "running" | "active" | "error",
  errorMessage: string | null,
) {
  if (!supabase) return;

  const { error } = await supabase.from("agent_registry").upsert(
    {
      agent_name: config.agentName,
      version: getRuntimeVersion(config),
      status,
      last_run: new Date().toISOString(),
      last_error: errorMessage,
    },
    { onConflict: "agent_name" },
  );

  if (error) {
    console.warn("agent-registry upsert failed", {
      agent: config.agentName,
      status,
      error: error.message,
    });
  }
}

async function logExecution(
  supabase: SupabaseClientLike | null,
  config: AgentHandlerConfig,
  input: ExecutionLogInput,
) {
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
        required_fields: (config.requiredFields ?? []).map((field) =>
          typeof field === "string" ? field : field.name
        ),
      },
      request: {
        deal_id: input.dealId,
      },
      response: {
        status: input.responseStatus,
      },
    },
    execution_time_ms: input.executionTimeMs,
    success: input.status === "active",
    error_context: input.errorMessage
      ? {
          message: input.errorMessage,
          response_status: input.responseStatus,
          request_payload: input.requestPayload,
        }
      : null,
  });

  if (error) {
    console.warn("agent execution audit failed", {
      agent: config.agentName,
      error: error.message,
    });
  }
}

export function createAgentHandler(
  config: AgentHandlerConfig,
  handler: (req: Request) => Promise<Response>,
) {
  return async (req: Request) => {
    const startedAt = Date.now();
    const supabase = createServiceClient();
    let payload: Record<string, unknown> = {};
    let validationErrors: string[] = [];
    let responseStatus = 500;
    let response: Response | null = null;
    let errorMessage: string | null = null;

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      payload = await parseRequestPayload(req);
    } catch {
      validationErrors = ["Invalid JSON body"];
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
        responseStatus,
      });
      return jsonResponse({ error: "Invalid JSON body" }, 400);
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
        responseStatus,
      });
      return jsonResponse(
        {
          error: validationErrors[0],
          validation_errors: validationErrors,
          received: payload,
        },
        400,
      );
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
        responseStatus,
      });
      return jsonResponse({
        error: errorMessage,
        system_enabled: false,
      }, 503);
    }

    const rateLimit = await isRateLimited(supabase, config);
    if (rateLimit.limited) {
      responseStatus = 429;
      errorMessage =
        `Rate limit exceeded for ${config.agentName}: ${rateLimit.count}/${rateLimit.limit} calls in the last hour`;
      await upsertRegistryStatus(supabase, config, "error", errorMessage);
      await logExecution(supabase, config, {
        dealId: extractDealId(payload),
        status: "error",
        errorMessage,
        executionTimeMs: Date.now() - startedAt,
        validationPassed: true,
        validationErrors: [],
        requestPayload: payload,
        responseStatus,
      });
      return jsonResponse({
        error: errorMessage,
        rate_limit: {
          count: rateLimit.count,
          limit: rateLimit.limit,
          window: "1h",
        },
      }, 429);
    }

    await upsertRegistryStatus(supabase, config, "running", null);

    try {
      response = await handler(req);
      responseStatus = response.status;
    } catch (error) {
      errorMessage = getErrorMessage(error);
      responseStatus = 500;
      response = jsonResponse({ error: errorMessage }, 500);
    }

    const status = responseStatus < 400 ? "active" : "error";
    if (status === "error" && !errorMessage) {
      try {
        const body = await response.clone().json();
        if (isRecord(body) && typeof body.error === "string") {
          errorMessage = body.error;
        }
      } catch {
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
      responseStatus,
    });
    await logUsageMetric(supabase, config, responseStatus);

    return response;
  };
}
