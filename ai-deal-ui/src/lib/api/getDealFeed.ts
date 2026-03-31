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

export async function getDealFeed(): Promise<DealFeedItem[]> {
  console.log("CALLING DEAL FEED");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL + "/functions/v1/get-deal-feed";
  console.log("URL:", url);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: "Bearer " + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ limit: 20 }),
  });

  console.log("STATUS:", res.status);

  const text = await res.text();
  console.log("RAW RESPONSE:", text);

  try {
    const json = JSON.parse(text) as { items?: DealFeedItem[] };
    return json.items || [];
  } catch (e) {
    console.error("JSON PARSE ERROR");
    return [];
  }
}
