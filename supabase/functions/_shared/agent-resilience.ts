import { createClient } from "https://esm.sh/@supabase/supabase-js";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

async function delay(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export type RetryOperationOptions = {
  supabase: any;
  agentName: string;
  dealId?: string | null;
  action: string;
  source?: string;
  maxAttempts: number;
  delayMs?: number;
  dedupeKey: string;
  payload?: Record<string, unknown>;
};

export async function runWithRetries<T>(
  operation: () => Promise<T>,
  options: RetryOperationOptions,
) {
  const attempts = Math.max(1, options.maxAttempts);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();

    try {
      const value = await operation();

      if (attempt > 1) {
        await options.supabase.from("ai_actions").insert({
          deal_id: options.dealId ?? null,
          agent: options.agentName,
          action: options.action,
          source: options.source ?? "retry_runtime",
          payload: {
            dedupe_key: options.dedupeKey,
            attempt,
            max_attempts: attempts,
            status: "recovered",
            ...(options.payload ?? {}),
          },
          execution_time_ms: Date.now() - startedAt,
          success: true,
          error_context: null,
        });
      }

      return {
        success: true,
        attempts: attempt,
        value,
      };
    } catch (error) {
      lastError = getErrorMessage(error);

      await options.supabase.from("ai_actions").insert({
        deal_id: options.dealId ?? null,
        agent: options.agentName,
        action: options.action,
        source: options.source ?? "retry_runtime",
        payload: {
          dedupe_key: options.dedupeKey,
          attempt,
          max_attempts: attempts,
          status: attempt >= attempts ? "exhausted" : "retrying",
          ...(options.payload ?? {}),
        },
        execution_time_ms: Date.now() - startedAt,
        success: false,
        error_context: {
          message: lastError,
          attempt,
          max_attempts: attempts,
        },
      });

      if (attempt < attempts) {
        await delay((options.delayMs ?? 250) * attempt);
      }
    }
  }

  return {
    success: false,
    attempts,
    error: lastError ?? "Unknown error",
  };
}

export async function queueRetryOperation(
  supabase: any,
  input: {
    agentName: string;
    operation: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    maxRetries?: number;
    lastError: string;
  },
) {
  const { error } = await supabase.from("agent_retry_queue").upsert(
    {
      agent_name: input.agentName,
      operation: input.operation,
      dedupe_key: input.dedupeKey,
      payload: input.payload,
      status: "queued",
      retry_count: 0,
      max_retries: input.maxRetries ?? 3,
      last_error: input.lastError,
      next_retry_at: new Date().toISOString(),
    },
    { onConflict: "dedupe_key" },
  );

  if (error) {
    throw new Error(error.message);
  }
}
