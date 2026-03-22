import { serve } from "https://deno.land/std/http/server.ts"

serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 })
    }

    const {
      suburbs,
      minLandArea = 800
    } = await req.json()

    if (!Array.isArray(suburbs) || suburbs.length === 0) {
      return new Response(JSON.stringify({ error: "Missing suburbs[]" }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const domainApiKey = Deno.env.get("DOMAIN_API_KEY")!

    const discovered = []

    for (const suburb of suburbs) {
      const searchRes = await fetch(
        "https://api.domain.com.au/v1/listings/residential/_search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": domainApiKey
          },
          body: JSON.stringify({
            listingType: "Sale",
            locations: [{ suburb }],
            pageSize: 50
          })
        }
      )

      const listings = await searchRes.json()

      const candidates = (Array.isArray(listings) ? listings : [])
        .map((item: Record<string, unknown>) => {
          const addressParts = item.addressParts as Record<string, unknown> | undefined
          const landArea = Number(item.landArea || 0)

          return {
            source: "domain",
            external_id: String(item.id || crypto.randomUUID()),
            address: String(item.address || ""),
            suburb: String(addressParts?.suburb || suburb),
            state: String(addressParts?.state || "NSW"),
            postcode: String(addressParts?.postcode || ""),
            price_text: String(item.priceDetails?.displayPrice || ""),
            property_type: String(item.propertyTypes?.[0] || ""),
            land_area: landArea,
            url: String(item.listingSlug ? `https://www.domain.com.au/${item.listingSlug}` : ""),
            headline: String(item.headline || ""),
            raw_data: item
          }
        })
        .filter((x) => x.address && x.land_area >= minLandArea)

      if (candidates.length > 0) {
        await fetch(`${supabaseUrl}/functions/v1/site-discovery-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`
          },
          body: JSON.stringify({ candidates })
        })
      }

      discovered.push({
        suburb,
        candidate_count: candidates.length
      })
    }

    return new Response(JSON.stringify({
      success: true,
      discovered
    }), {
      headers: { "Content-Type": "application/json" }
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})