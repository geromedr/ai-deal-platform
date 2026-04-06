export type DealFeedItem = {
  deal_id: string;
  summary: string | null;
  score: number | null;
  priority_score: number | null;
  status?: string | null;
  suburb?: string | null;
  state?: string | null;
  asset_type?: string | null;
  source_name?: string | null;
};

export async function getDealFeed(
  stageFilter: string | null = null,
): Promise<DealFeedItem[]> {
  const url = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/get-deal-feed",
  );

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ limit: 20, stageFilter }),
  });

  const json = (await res.json()) as { items?: DealFeedItem[] };
  return json.items || [];
}
