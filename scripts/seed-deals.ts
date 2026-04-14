import { createClient } from "@supabase/supabase-js";

type SeedDeal = {
  id: string;
  address: string;
  suburb: string;
  state: string;
  price: number;
  stage: "new";
};

type DealInsert = {
  id: string;
  address: string;
  suburb: string;
  state: string;
  stage: "new";
  price?: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildSampleDeals(): SeedDeal[] {
  return [
    {
      id: crypto.randomUUID(),
      address: "12 Arbor Street",
      suburb: "Newtown",
      state: "NSW",
      price: 1250000,
      stage: "new",
    },
    {
      id: crypto.randomUUID(),
      address: "44 Harbour Road",
      suburb: "Fremantle",
      state: "WA",
      price: 980000,
      stage: "new",
    },
    {
      id: crypto.randomUUID(),
      address: "8 Kingfisher Lane",
      suburb: "South Brisbane",
      state: "QLD",
      price: 1465000,
      stage: "new",
    },
  ];
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const deals = buildSampleDeals();

  const requestedInsert: DealInsert[] = deals.map((deal) => ({
    id: deal.id,
    address: deal.address,
    suburb: deal.suburb,
    state: deal.state,
    stage: deal.stage,
    price: deal.price,
  }));

  const fallbackInsert: DealInsert[] = deals.map((deal) => ({
    id: deal.id,
    address: deal.address,
    suburb: deal.suburb,
    state: deal.state,
    stage: deal.stage,
  }));

  const tryInsert = async (rows: DealInsert[], includePrice: boolean) => {
    const columns = includePrice
      ? "id, address, suburb, state, stage, price"
      : "id, address, suburb, state, stage";
    return await supabase
      .from("deals")
      .insert(rows)
      .select(columns);
  };

  let { data, error } = await tryInsert(requestedInsert, true);

  if (error?.message.includes("price")) {
    console.warn(
      "The live deals table does not expose a price column; retrying without price in the row payload.",
    );
    ({ data, error } = await tryInsert(fallbackInsert, false));
  }

  if (error) {
    throw new Error(`Failed to insert seed deals: ${error.message}`);
  }

  const outputDeals = (data ?? []).map((deal, index) => ({
    ...deal,
    price:
      "price" in deal
        ? (deal as { price?: number }).price ?? deals[index]?.price
        : deals[index]?.price,
  }));

  console.log(
    JSON.stringify(
      {
        inserted: outputDeals.length,
        deals: outputDeals,
      },
      null,
      2,
    ),
  );
}

main().catch(console.error);
