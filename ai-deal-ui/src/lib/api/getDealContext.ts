type RecordLike = Record<string, unknown>;

type DealContextResponse = {
  deal: RecordLike | null;
  feed: RecordLike | null;
  tasks: RecordLike[];
  financials: RecordLike[];
  risks: RecordLike[];
  site_intelligence: RecordLike | null;
  communications: RecordLike[];
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

  const empty: DealContextResponse = {
    deal: null,
    feed: null,
    tasks: [],
    financials: [],
    risks: [],
    site_intelligence: null,
    communications: [],
  };

  if (!supabaseUrl || !anonKey) {
    console.error("getDealContext: missing env vars (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    return empty;
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
      return empty;
    }

    const record = asRecord(payload);
    const deal = record ? asRecord(record.deal) : null;
    const feed = record ? asRecord(record.feed) : null;
    const tasks = record ? asRecordArray(record.tasks) : [];
    const financials = record ? asRecordArray(record.financials) : [];
    const risks = record ? asRecordArray(record.risks) : [];
    const siteIntelligence = record ? asRecord(record.site_intelligence) : null;
    const communications = record ? asRecordArray(record.communications) : [];


    return { deal, feed, tasks, financials, risks, site_intelligence: siteIntelligence, communications };
  } catch (error) {
    console.error(
      "get-deal-context request failed:",
      error instanceof Error ? error.message : "Failed to load deal",
    );
    return empty;
  }
}
