import { createClient as createBaseClient } from "https://esm.sh/@supabase/supabase-js";

type RecordedOperation = {
  method: string;
  args: unknown[];
};

type QueryContext = {
  kind: "table" | "rpc";
  source: string;
  operations: RecordedOperation[];
};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (error && typeof error === "object") {
    return { ...(error as Record<string, unknown>) };
  }

  return error;
}

function cloneArgs(args: unknown[]) {
  return args.map((arg) => {
    if (arg instanceof Date) return arg.toISOString();
    return arg;
  });
}

function logQueryStart(context: QueryContext) {
  console.log("[supabase-debug] query:start", {
    kind: context.kind,
    source: context.source,
    operations: context.operations.map((operation) => ({
      method: operation.method,
      args: cloneArgs(operation.args),
    })),
  });
}

function logQueryResult(
  context: QueryContext,
  result: {
    data?: unknown;
    error?: unknown;
    count?: unknown;
    status?: unknown;
    statusText?: unknown;
  },
  fullRows?: unknown,
) {
  const payload = {
    kind: context.kind,
    source: context.source,
    operations: context.operations.map((operation) => ({
      method: operation.method,
      args: cloneArgs(operation.args),
    })),
    count: result.count ?? null,
    status: result.status ?? null,
    statusText: result.statusText ?? null,
    data: result.data ?? null,
    full_rows: fullRows ?? null,
    error: result.error ? serializeError(result.error) : null,
  };

  if (result.error) {
    console.error("[supabase-debug] query:error", payload);
    return;
  }

  console.log("[supabase-debug] query:result", payload);
}

function isReadOnlySelectQuery(operations: RecordedOperation[]) {
  const writeMethods = new Set(["insert", "upsert", "update", "delete", "rpc"]);
  if (operations.some((operation) => writeMethods.has(operation.method))) return false;
  return operations.some((operation) => operation.method === "select");
}

function canReplayFullRows(operations: RecordedOperation[]) {
  const selectOperation = operations.find((operation) => operation.method === "select");
  if (!selectOperation) return false;

  const options = selectOperation.args[1];
  if (options && typeof options === "object" && "head" in (options as Record<string, unknown>)) {
    return (options as Record<string, unknown>).head !== true;
  }

  return true;
}

async function fetchFullRowsForDebug(
  client: any,
  table: string,
  operations: RecordedOperation[],
) {
  if (!isReadOnlySelectQuery(operations) || !canReplayFullRows(operations)) {
    return null;
  }

  try {
    let builder = typeof client.__debugOriginalFrom === "function"
      ? client.__debugOriginalFrom.call(client, table)
      : client.from(table);

    for (const operation of operations) {
      if (operation.method === "select") {
        const nextArgs = [...operation.args];
        nextArgs[0] = "*";
        builder = builder.select(...nextArgs);
        continue;
      }

      const method = builder[operation.method];
      if (typeof method !== "function") continue;
      builder = method.apply(builder, operation.args);
    }

    const result = await builder;
    if (result?.error) {
      console.error("[supabase-debug] query:full-rows-error", {
        table,
        operations: operations.map((operation) => ({
          method: operation.method,
          args: cloneArgs(operation.args),
        })),
        error: serializeError(result.error),
      });
      return null;
    }

    return result?.data ?? null;
  } catch (error) {
    console.error("[supabase-debug] query:full-rows-exception", {
      table,
      operations: operations.map((operation) => ({
        method: operation.method,
        args: cloneArgs(operation.args),
      })),
      error: serializeError(error),
    });
    return null;
  }
}

function wrapQueryBuilder(client: any, builder: any, context: QueryContext): any {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === "then") {
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
          logQueryStart(context);
          return Promise.resolve(target).then(async (result) => {
            const fullRows = context.kind === "table"
              ? await fetchFullRowsForDebug(client, context.source, context.operations)
              : null;
            logQueryResult(context, result as Record<string, unknown>, fullRows);
            return onFulfilled ? onFulfilled(result) : result;
          }, (error) => {
            console.error("[supabase-debug] query:exception", {
              kind: context.kind,
              source: context.source,
              operations: context.operations.map((operation) => ({
                method: operation.method,
                args: cloneArgs(operation.args),
              })),
              error: serializeError(error),
            });
            if (onRejected) return onRejected(error);
            throw error;
          });
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        const nextContext: QueryContext = {
          ...context,
          operations: [...context.operations, { method: String(prop), args }],
        };

        const result = value.apply(target, args);
        if (result && typeof result === "object") {
          return wrapQueryBuilder(client, result, nextContext);
        }

        return result;
      };
    },
  });
}

function wrapRpcCall(target: any, fn: string, args?: Record<string, unknown>, options?: Record<string, unknown>) {
  const context: QueryContext = {
    kind: "rpc",
    source: fn,
    operations: [
      {
        method: "rpc",
        args: [args ?? null, options ?? null],
      },
    ],
  };

  logQueryStart(context);
  return Promise.resolve(target.__debugOriginalRpc(fn, args, options)).then((result) => {
    logQueryResult(context, result as Record<string, unknown>);
    return result;
  }).catch((error) => {
    console.error("[supabase-debug] query:exception", {
      kind: context.kind,
      source: context.source,
      operations: context.operations.map((operation) => ({
        method: operation.method,
        args: cloneArgs(operation.args),
      })),
      error: serializeError(error),
    });
    throw error;
  });
}

let patched = false;

function patchSupabaseClient() {
  if (patched) return;

  const sampleClient = createBaseClient("http://localhost", "debug-key");
  const clientPrototype = Object.getPrototypeOf(sampleClient);

  if (!clientPrototype.__debugOriginalFrom) {
    clientPrototype.__debugOriginalFrom = clientPrototype.from;
    clientPrototype.from = function (table: string) {
      const builder = clientPrototype.__debugOriginalFrom.call(this, table);
      return wrapQueryBuilder(this, builder, {
        kind: "table",
        source: table,
        operations: [],
      });
    };
  }

  if (!clientPrototype.__debugOriginalRpc) {
    clientPrototype.__debugOriginalRpc = clientPrototype.rpc;
    clientPrototype.rpc = function (
      fn: string,
      args?: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) {
      return wrapRpcCall(this, fn, args, options);
    };
  }

  patched = true;
}

patchSupabaseClient();

export const createClient = createBaseClient;
