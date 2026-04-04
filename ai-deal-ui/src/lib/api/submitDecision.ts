export type DealDecision = "BUY" | "REVIEW" | "PASS";

type SubmitDecisionParams = {
  deal_id: string;
  decision: DealDecision;
};

type SubmitDecisionResponse = {
  success: boolean;
  deal_id: string;
  decision: DealDecision;
  action_id?: string | null;
  persistence_mode?: "requested_columns" | "fallback_columns";
  message?: string;
};

export async function submitDecision({
  deal_id,
  decision,
}: SubmitDecisionParams): Promise<SubmitDecisionResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase environment variables are not configured.");
  }

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/submit-decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ deal_id, decision }),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
        : "Failed to submit decision"
    );
  }

  if (!res.ok) {
    const text = await res.text();
    console.error("submit-decision failed response body:", text);
    throw new Error(text);
  }

  const payload = (await res.json().catch(() => null)) as
    | SubmitDecisionResponse
    | null;

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    throw new Error("submit-decision returned an invalid response");
  }

  return payload as SubmitDecisionResponse;
}
