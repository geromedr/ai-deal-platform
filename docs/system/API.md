# API Reference

All functionality is exposed through Supabase Edge Functions.

Base endpoint:

`/functions/v1/{agent-name}`

Validation:

- endpoints return `400` for missing or malformed required inputs
- endpoints return `500` for downstream or infrastructure failures
- orchestration endpoints may return `200` with warnings when cached data is reused after a refresh failure

## Example: site-intelligence-agent

POST `/functions/v1/site-intelligence-agent`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "address": "12 Marine Parade, Kingscliff NSW 2487",
  "force_refresh": true,
  "use_comparable_sales": true
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "address": "12 Marine Parade, Kingscliff NSW 2487",
  "pipeline_completed": true,
  "completed_stages": [
    "zoning-agent",
    "flood-agent",
    "height-agent",
    "fsr-agent",
    "heritage-agent",
    "comparable-sales-agent",
    "yield-agent",
    "financial-engine-agent",
    "parcel-ranking-agent",
    "deal-report-agent"
  ],
  "failed_stages": [],
  "critical_failed_stages": [],
  "skipped_stages": [
    "comparable-sales-agent"
  ],
  "warnings": [
    "comparable-sales-agent refresh failed; existing comparable estimate reused: OPENAI_API_KEY not set"
  ],
  "final_report": {
    "success": true,
    "deal_id": "11111111-1111-1111-1111-111111111111"
  }
}
```

## Example: email-agent

POST `/functions/v1/email-agent`

Request:

```json
{
  "sender": "agent@realestate.com",
  "subject": "Potential development site",
  "body": "Look at 12 Marine Parade Kingscliff",
  "deal_id": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "status": "processed",
  "thread_id": "uuid",
  "aiDecision": {},
  "detectedAddress": "12 Marine Parade Kingscliff NSW"
}
```

## Example: create-task

POST `/functions/v1/create-task`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "title": "Review zoning controls",
  "description": "Confirm zoning, FSR, and height controls for the site.",
  "assigned_to": "acquisitions",
  "due_date": "2026-03-29"
}
```

Response:

```json
{
  "success": true,
  "task": {
    "id": "uuid",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "title": "Review zoning controls",
    "status": "open"
  }
}
```

## Example: agent-orchestrator

POST `/functions/v1/agent-orchestrator`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "aiDecision": {
    "summary": "Create follow-up task and log communication.",
    "actions": [
      {
        "action": "task_create",
        "details": {
          "title": "Review comparable sales evidence",
          "description": "Assess recent nearby apartment sales and confirm pricing assumptions.",
          "assigned_to": "acquisitions",
          "due_date": "2026-03-26"
        }
      }
    ]
  }
}
```

Response:

```json
{
  "success": true,
  "summary": "Create follow-up task and log communication.",
  "results": [
    {
      "action": "task_create",
      "success": true,
      "error": null
    }
  ]
}
```

## Example: test-agent

POST `/functions/v1/test-agent`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "message": "Run test-agent health check"
}
```

Response:

```json
{
  "status": "success",
  "agent": "test-agent",
  "received_at": "2026-03-22T00:00:00.000Z",
  "input": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "message": "Run test-agent health check"
  }
}
```

## Example: comparable-sales-agent

POST `/functions/v1/comparable-sales-agent`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "radius_km": 5,
  "dwelling_type": "apartment"
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "estimate_id": "uuid",
  "estimated_sale_price_per_sqm": 12500,
  "currency": "AUD",
  "comparables": []
}
```

## Example: yield-agent

POST `/functions/v1/yield-agent`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "use_comparable_sales": true
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "site_area": 1200,
  "fsr": 1.8,
  "max_gfa": 2160,
  "estimated_units": 24,
  "sale_price_per_sqm": 12500,
  "sale_price_source": "comparable-sales-agent",
  "comparable_sales_estimate": {
    "estimated_sale_price_per_sqm": 12500,
    "currency": "AUD",
    "rationale": "Nearby apartment projects indicate premium coastal pricing.",
    "created_at": "2026-03-22T00:00:00.000Z"
  },
  "estimated_revenue": 27000000,
  "estimated_build_cost": 9072000,
  "estimated_profit": 17928000
}
```

## Example: financial-engine-agent

POST `/functions/v1/financial-engine-agent`

Validation notes:
- `deal_id` must be a non-empty UUID
- invalid or empty identifiers return `400`
- resilience mode returns `success: true` with partial `data`, `warnings`, and preserved top-level fields when downstream or optional data is unavailable

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "refresh_yield": true,
  "use_comparable_sales": true,
  "assumptions": {
    "build_cost_per_sqm": 4200,
    "contingency_rate": 0.07,
    "professional_fees_rate": 0.09,
    "marketing_rate": 0.035,
    "finance_rate": 0.05,
    "developer_margin_target_rate": 0.18
  }
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "address": "12 Marine Parade, Kingscliff NSW 2487",
  "planning_constraints": {
    "zoning": "R3 Medium Density Residential",
    "fsr": "1.8:1",
    "height_limit": "13m",
    "flood_risk": "Low",
    "heritage_status": null
  },
  "estimated_units": 24,
  "comparable_sales": {
    "id": "33333333-3333-3333-3333-333333333333",
    "estimated_sale_price_per_sqm": 12500,
    "currency": "AUD",
    "rationale": "Seed comparable pricing for local feasibility validation.",
    "nearby_developments": [
      {
        "project_name": "Kingscliff Beach Residences",
        "location": "Marine Parade, Kingscliff NSW",
        "dwelling_type": "apartments",
        "estimated_sale_price_per_sqm": 12400,
        "similarity_reason": "Comparable beachfront apartment product."
      }
    ]
  },
  "assumptions": {
    "build_cost_per_sqm": 4200,
    "contingency_rate": 0.07,
    "professional_fees_rate": 0.09,
    "marketing_rate": 0.035,
    "finance_rate": 0.05,
    "developer_margin_target_rate": 0.18,
    "price_per_sqm": 12500,
    "source": "comparable-sales-agent"
  },
  "revenue_estimate": 15000000,
  "cost_estimate": 6489840,
  "revenue": 15000000,
  "cost": 6489840,
  "profit": 8510160,
  "margin": 0.5673,
  "residual_land_value": 5810160
}
```

## Example: da-discovery-agent

POST `/functions/v1/da-discovery-agent`

Request:

```json
{
  "source": "mock-nsw-planning-portal",
  "jurisdiction": "NSW",
  "statuses": [
    "Lodged",
    "In Assessment"
  ],
  "limit": 10
}
```

## Example: parcel-ranking-agent

POST `/functions/v1/parcel-ranking-agent`

Validation notes:
- deal mode requires `deal_id` as a non-empty UUID
- batch mode should omit `deal_id` and use `limit` / `only_unranked`
- malformed deal IDs return `400` instead of falling through to batch mode

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "address": "12 Marine Parade, Kingscliff NSW 2487",
  "score": 54,
  "tier": "B",
  "breakdown": {
    "zoning": 16,
    "fsr": 3,
    "height": 2,
    "site_size": 6,
    "yield": 6,
    "financial": 1,
    "comparables": 5
  },
  "reasoning": "Medium-density zoning R3; Constrained FSR potential 0:1; Low height capacity 0m",
  "reason": "Medium-density zoning R3; Constrained FSR potential 0:1; Low height capacity 0m",
  "ranking_score": 54,
  "ranking_tier": "B"
}
```

Batch compatibility request:

```json
{
  "limit": 25,
  "only_unranked": false
}
```

## Example: deal-report-agent

POST `/functions/v1/deal-report-agent`

Validation notes:
- `deal_id` must be a non-empty UUID
- malformed identifiers return `400`
- unknown but well-formed deal IDs return `404`
- resilience mode keeps report generation alive with partial `data`, `warnings`, and preserved top-level fields when downstream agents fail

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "report": {
    "address": "12 Marine Parade, Kingscliff NSW 2487",
    "planning_controls": {
      "zoning": "R3",
      "fsr": "1.8:1",
      "height_limit": "13m",
      "flood_risk": "Low",
      "heritage_status": null
    },
    "development_potential": {
      "gfa": 2160,
      "units": 24
    },
    "feasibility": {
      "estimated_revenue": 23760000,
      "estimated_costs": 9072000,
      "projected_profit": 14688000,
      "margin": 0.6182,
      "residual_land_value": 10411200
    },
    "comparable_sales_summary": {
      "available": true,
      "estimated_sale_price_per_sqm": 12500,
      "currency": "AUD",
      "rationale": "Nearby apartment projects indicate premium coastal pricing.",
      "source": "comparable-sales-agent"
    },
    "opportunity_score": {
      "score": 68,
      "tier": "B",
      "reason": "Medium-density zoning R3; Strong projected margin; manageable flood profile"
    },
    "recommendation": "Strong",
    "reasoning": [
      "Planning controls show zoning R3 with FSR 1.8:1 and height 13m."
    ],
    "context": {
      "stage": "opportunity",
      "status": "active",
      "open_task_count": 2,
      "risk_count": 1,
      "latest_communication_summary": "Agent shared a medium-density coastal site for review."
    }
  },
  "human_readable_summary": "Investment-ready summary text",
  "summary_source": "ai-agent",
  "warnings": []
}
```

Response:

```json
{
  "success": true,
  "processed": 1,
  "top_sites": [
    {
      "address": "12 Marine Parade, Kingscliff NSW 2487",
      "score": 68,
      "tier": "B",
      "reason": "Medium-density zoning R3; Usable site size 1200sqm; manageable flood profile",
      "ranking_score": 68,
      "ranking_tier": "B"
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "source": "mock-nsw-planning-portal",
  "jurisdiction": "NSW",
  "scanned_count": 4,
  "matched_count": 2,
  "forwarded_count": 2,
  "applications": [
    {
      "address": "120 Marine Parade, Kingscliff NSW 2487",
      "development_type": "Apartments",
      "application_status": "In Assessment"
    }
  ],
  "site_discovery_result": {
    "success": true,
    "processed": 2
  }
}
```

## Core Endpoints

- `/agent-orchestrator`
- `/ai-agent`
- `/create-task`
- `/deal-agent`
- `/deal-intelligence`
- `/deal-report-agent`
- `/da-discovery-agent`
- `/email-agent`
- `/get-agent-rules`
- `/get-deal`
- `/get-deal-context`
- `/get-deal-timeline`
- `/log-communication`
- `/update-deal-stage`
- `/site-intelligence-agent`
- `/zoning-agent`
- `/flood-agent`
- `/height-agent`
- `/fsr-agent`
- `/heritage-agent`
- `/yield-agent`
- `/comparable-sales-agent`
- `/financial-engine-agent`
- `/domain-discovery-agent`
- `/planning-da-discovery-agent`
- `/site-discovery-agent`
- `/parcel-ranking-agent`
- `/add-financial-snapshot`
- `/add-knowledge-document`
- `/search-knowledge`
- `/test-agent`
