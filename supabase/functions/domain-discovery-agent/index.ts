import { serve } from "https://deno.land/std/http/server.ts"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { requireEnv } from "../_shared/utils.ts";

// Domain API v1 residential search response shape
// Each element in the array is:
// { type: "PropertyListing", listing: { id, headline, slug, propertyDetails: { ... }, priceDetails: { ... } } }
// or
// { type: "Project", project: { ... } }

type DomainAddress = {
  suburb?: string;
  state?: string;
  postcode?: string;
  displayAddress?: string;
};

type DomainPropertyDetails = {
  propertyType?: string;
  landArea?: number;
  address?: DomainAddress;
  allPropertyTypes?: string[];
};

type DomainListing = {
  id?: number;
  headline?: string;
  slug?: string;
  propertyDetails?: DomainPropertyDetails;
  priceDetails?: { displayPrice?: string };
};

type DomainSearchResult = {
  type?: string;
  listing?: DomainListing;
};

serve(createAgentHandler({ agentName: "domain-discovery-agent" }, async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
    }

    const {
      suburbs,
      minLandArea = 600,
    } = await req.json()

    if (!Array.isArray(suburbs) || suburbs.length === 0) {
      return new Response(JSON.stringify({ error: "Missing suburbs[]" }), { status: 400 })
    }

    const supabaseUrl = requireEnv("SUPABASE_URL")
    const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    const domainApiKey = requireEnv("DOMAIN_API_KEY")

    const discovered = []

    for (const suburb of suburbs) {
      const searchRes = await fetch(
        "https://api.domain.com.au/v1/listings/residential/_search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": domainApiKey,
          },
          body: JSON.stringify({
            listingType: "Sale",
            locations: [{ suburb, state: "NSW" }],
            propertyTypes: ["Land", "NewLand", "House", "Townhouse"],
            pageSize: 50,
          }),
        }
      )

      if (!searchRes.ok) {
        const errText = await searchRes.text()
        discovered.push({ suburb, candidate_count: 0, error: `Domain API ${searchRes.status}: ${errText}` })
        continue
      }

      const results: DomainSearchResult[] = await searchRes.json()
      const listings = Array.isArray(results) ? results : []

      const propertyListings = listings.filter((r) => r.type === "PropertyListing" && r.listing)

      // Debug: sample land area values from first 3 results to diagnose field mapping
      const debugSample = propertyListings.slice(0, 3).map((r) => {
        const l = r.listing!
        const pd = l.propertyDetails ?? {}
        return {
          id: l.id,
          headline: l.headline,
          landArea_direct: (pd as Record<string, unknown>).landArea,
          landArea_typed: pd.landArea,
          propertyType: pd.propertyType,
          allPropertyTypes: pd.allPropertyTypes,
          addressKeys: Object.keys(pd.address ?? {}),
          pdKeys: Object.keys(pd),
          listingKeys: Object.keys(l),
        }
      })

      const candidates = propertyListings
        .map((r) => {
          const l = r.listing!
          const pd = l.propertyDetails ?? {}
          const addr = pd.address ?? {}
          const landArea = typeof pd.landArea === "number" ? pd.landArea : 0

          return {
            source: "domain",
            external_id: String(l.id ?? crypto.randomUUID()),
            address: addr.displayAddress ?? "",
            suburb: addr.suburb ?? suburb,
            state: addr.state ?? "NSW",
            postcode: addr.postcode ?? "",
            price_text: l.priceDetails?.displayPrice ?? "",
            property_type: pd.propertyType ?? pd.allPropertyTypes?.[0] ?? "",
            land_area: landArea,
            url: l.slug ? `https://www.domain.com.au/${l.slug}` : "",
            headline: l.headline ?? "",
            raw_data: l,
          }
        })
        .filter((x) => x.address && x.land_area >= minLandArea)

      if (candidates.length > 0) {
        await fetch(`${supabaseUrl}/functions/v1/site-discovery-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ candidates }),
        })
      }

      discovered.push({
        suburb,
        candidate_count: candidates.length,
        total_returned: listings.length,
        property_listings: propertyListings.length,
        debug_sample: debugSample,
      } as typeof discovered[number])
    }

    return new Response(JSON.stringify({ success: true, discovered }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 })
  }
}));
