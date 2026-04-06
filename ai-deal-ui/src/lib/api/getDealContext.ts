type RecordLike = Record<string, unknown>;

type DealContextResponse = {
  deal: RecordLike | null;
  tasks: RecordLike[];
};

function asRecord(value: unknown): RecordLike | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordLike)
    : null;
}

function asRecordArray(value: unknown): RecordLike[] {
  return Array.isArray(value)
    ? value.filter((item): item is RecordLike => Boolean(asRecord(item)))
    : [];
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as RecordLike;

  return typeof record.error === "string" && record.error.trim().length > 0
    ? record.error
    : typeof record.message === "string" && record.message.trim().length > 0
      ? record.message
      : null;
}

export async function getDealContext(dealId: string): Promise<DealContextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    console.log("getDealContext tasks", []);
    return { deal: null, tasks: [] };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/get-deal-context`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ deal_id: dealId }),
      cache: "no-store",
    });

    const payload = (await res.json().catch(() => null)) as unknown;

    if (!res.ok) {
      console.error("get-deal-context failed:", getErrorMessage(payload) ?? "Failed to load deal");
      console.log("getDealContext tasks", []);
      return { deal: null, tasks: [] };
    }

    const record = asRecord(payload);
    const deal = record ? asRecord(record.deal) : null;
    const tasks = record ? asRecordArray(record.tasks) : [];

    console.log("getDealContext tasks", tasks);

    return { deal, tasks };
  } catch (error) {
    console.error(
      "get-deal-context request failed:",
      error instanceof Error ? error.message : "Failed to load deal",
    );
    console.log("getDealContext tasks", []);
    return { deal: null, tasks: [] };
  }
}
