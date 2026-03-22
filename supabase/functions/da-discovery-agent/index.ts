import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"

type DiscoveryRequest = {
  source?: string
  jurisdiction?: string
  statuses?: string[]
  limit?: number
}

type MockPlanningApplication = {
  application_id: string
  address: string
  suburb: string
  state: string
  postcode: string
  development_type: string
  application_status: string
  lodgement_date: string
  estimated_dwellings?: number
}

type SiteCandidate = {
  source: string
  external_id: string
  address: string
  suburb: string
  state: string
  postcode: string
  property_type: string
  headline: string
  raw_data: Record<string, unknown>
}

const MOCK_APPLICATIONS: MockPlanningApplication[] = [
  {
    application_id: "da-mock-001",
    address: "120 Marine Parade, Kingscliff NSW 2487",
    suburb: "Kingscliff",
    state: "NSW",
    postcode: "2487",
    development_type: "Apartments",
    application_status: "In Assessment",
    lodgement_date: "2026-03-15",
    estimated_dwellings: 42
  },
  {
    application_id: "da-mock-002",
    address: "18-22 Wharf Street, Tweed Heads NSW 2485",
    suburb: "Tweed Heads",
    state: "NSW",
    postcode: "2485",
    development_type: "Multi-dwelling housing",
    application_status: "Lodged",
    lodgement_date: "2026-03-11",
    estimated_dwellings: 16
  },
  {
    application_id: "da-mock-003",
    address: "75 Boomerang Drive, Cudgen NSW 2487",
    suburb: "Cudgen",
    state: "NSW",
    postcode: "2487",
    development_type: "Detached dwelling",
    application_status: "In Assessment",
    lodgement_date: "2026-03-10",
    estimated_dwellings: 1
  },
  {
    application_id: "da-mock-004",
    address: "9 Bells Boulevard, Kingscliff NSW 2487",
    suburb: "Kingscliff",
    state: "NSW",
    postcode: "2487",
    development_type: "Shop top housing",
    application_status: "Determined",
    lodgement_date: "2026-03-08",
    estimated_dwellings: 24
  }
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function normaliseStatuses(statuses: unknown) {
  if (!Array.isArray(statuses)) return ["Lodged", "In Assessment"]

  const cleaned = statuses
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())

  return cleaned.length > 0 ? cleaned : ["Lodged", "In Assessment"]
}

function validateRequest(payload: DiscoveryRequest) {
  if (typeof payload.source !== "string" || payload.source.trim().length === 0) {
    return "source is required"
  }

  if (
    payload.jurisdiction !== undefined &&
    (typeof payload.jurisdiction !== "string" || payload.jurisdiction.trim().length === 0)
  ) {
    return "jurisdiction must be a non-empty string"
  }

  if (
    payload.statuses !== undefined &&
    !(
      Array.isArray(payload.statuses) &&
      payload.statuses.every((value) => typeof value === "string" && value.trim().length > 0)
    )
  ) {
    return "statuses must be an array of non-empty strings"
  }

  if (
    payload.limit !== undefined &&
    !(typeof payload.limit === "number" && Number.isFinite(payload.limit) && payload.limit > 0)
  ) {
    return "limit must be a positive number"
  }

  return null
}

function isTargetDevelopmentType(developmentType: string) {
  const value = developmentType.toLowerCase()
  return value.includes("apartment") || value.includes("multi-dwelling")
}

async function fetchPlanningPortalData(request: DiscoveryRequest) {
  // V1 intentionally uses a mock dataset. Keep the async boundary so a real API can replace this later.
  const source = request.source || "mock-nsw-planning-portal"

  console.log("da-discovery-agent fetching planning data", {
    source,
    jurisdiction: request.jurisdiction || "NSW"
  })

  return MOCK_APPLICATIONS
}

function mapToSiteCandidates(applications: MockPlanningApplication[]) {
  return applications.map((application): SiteCandidate => ({
    source: "da-discovery-agent",
    external_id: application.application_id,
    address: application.address,
    suburb: application.suburb,
    state: application.state,
    postcode: application.postcode,
    property_type: application.development_type,
    headline: `${application.development_type} - ${application.application_status}`,
    raw_data: application as unknown as Record<string, unknown>
  }))
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  try {
    let payload: DiscoveryRequest

    try {
      payload = await req.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !serviceKey) {
      return jsonResponse({ error: "Supabase environment variables not set" }, 500)
    }

    const validationError = validateRequest(payload)
    if (validationError) {
      return jsonResponse({ error: validationError }, 400)
    }

    const statuses = normaliseStatuses(payload.statuses)
    const limit = payload.limit ?? 10

    console.log("da-discovery-agent request received", {
      source: payload.source || "mock-nsw-planning-portal",
      jurisdiction: payload.jurisdiction || "NSW",
      statuses,
      limit
    })

    const supabase = createClient(supabaseUrl, serviceKey)
    const planningApplications = await fetchPlanningPortalData(payload)

    const filteredApplications = planningApplications
      .filter((application) => statuses.includes(application.application_status))
      .filter((application) => isTargetDevelopmentType(application.development_type))
      .slice(0, limit)

    const candidates = mapToSiteCandidates(filteredApplications)

    let siteDiscoveryResult: unknown = {
      success: true,
      processed: 0,
      results: []
    }

    if (candidates.length > 0) {
      const siteDiscoveryResponse = await fetch(`${supabaseUrl}/functions/v1/site-discovery-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": serviceKey
        },
        body: JSON.stringify({ candidates })
      })

      const responseText = await siteDiscoveryResponse.text()

      try {
        siteDiscoveryResult = JSON.parse(responseText)
      } catch {
        siteDiscoveryResult = {
          success: false,
          error: "Invalid response from site-discovery-agent",
          raw_response: responseText
        }
      }

      const discoveryResults =
        typeof siteDiscoveryResult === "object" && siteDiscoveryResult !== null
          ? (siteDiscoveryResult as { results?: Array<{ error?: string }> }).results
          : null
      const allCandidatesFailed =
        Array.isArray(discoveryResults) &&
        discoveryResults.length > 0 &&
        discoveryResults.every((result) => typeof result?.error === "string")

      if (!siteDiscoveryResponse.ok || allCandidatesFailed) {
        return jsonResponse({
          error: "site-discovery-agent failed",
          site_discovery_result: siteDiscoveryResult
        }, 500)
      }
    }

    await supabase.from("ai_actions").insert({
      agent: "da-discovery-agent",
      action: "planning_opportunities_discovered",
      payload: {
        source: payload.source || "mock-nsw-planning-portal",
        jurisdiction: payload.jurisdiction || "NSW",
        statuses,
        limit,
        scanned_count: planningApplications.length,
        matched_count: filteredApplications.length,
        forwarded_count: candidates.length
      },
      source: "mock-planning-data"
    })

    console.log("da-discovery-agent processing complete", {
      scanned_count: planningApplications.length,
      matched_count: filteredApplications.length,
      forwarded_count: candidates.length
    })

    return jsonResponse({
      success: true,
      source: payload.source || "mock-nsw-planning-portal",
      jurisdiction: payload.jurisdiction || "NSW",
      scanned_count: planningApplications.length,
      matched_count: filteredApplications.length,
      forwarded_count: candidates.length,
      applications: filteredApplications.map((application) => ({
        address: application.address,
        development_type: application.development_type,
        application_status: application.application_status
      })),
      site_discovery_result: siteDiscoveryResult
    })
  } catch (error) {
    console.error("da-discovery-agent failed", error)

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error"
    }, 500)
  }
})
