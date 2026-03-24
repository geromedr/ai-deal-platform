# API Reference

All functionality is exposed through Supabase Edge Functions.

Base endpoint:

`/functions/v1/{agent-name}`

Validation:

- endpoints return `400` for missing or malformed required inputs
- endpoints return `500` for downstream or infrastructure failures
- resilient orchestration endpoints may return `200` with warnings when cached data is reused, optional stages are skipped, or partial data is returned safely

## Example: site-intelligence-agent

POST `/functions/v1/site-intelligence-agent`

Validation notes:
- `deal_id` must be a non-empty UUID
- `address` is required
- `site_intelligence.raw_data` is written with the aggregated orchestration payload when the hosted schema is aligned; legacy hosted rows still complete successfully with a warning-only fallback if that column is unavailable
- post-ranking downstream execution is delegated to `rule-engine-agent`; final report generation still falls back to `REPORT_TRIGGER_SCORE_THRESHOLD` in the function environment if rule evaluation fails
- bootstrap, planning fallback, cached-data fallback, and pipeline logging issues are returned in `warnings` / `results` instead of crashing the request when partial execution can continue
- top-level responses include an `orchestration` summary for post-intelligence, post-ranking, and report decisions

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
  "ranking_score": 40,
  "report_trigger_threshold": 50,
  "report_triggered": false,
  "report_trigger_reason": "Skipped because no post-ranking rule matched parcel score 40",
  "orchestration": {
    "post_intelligence": {
      "event": "post-intelligence",
      "success": true,
      "skipped": false,
      "reason": "post-intelligence event dispatched"
    },
    "post_ranking": {
      "event": "post-ranking",
      "success": true,
      "skipped": false,
      "reason": "post-ranking event dispatched"
    },
    "report": {
      "triggered": false,
      "reason": "Skipped because no post-ranking rule matched parcel score 40",
      "fallback_threshold": 50
    }
  },
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
    "rule-engine-agent",
    "deal-report-agent"
  ],
  "failed_stages": [],
  "critical_failed_stages": [],
  "skipped_stages": [
    "comparable-sales-agent",
    "deal-report-agent"
  ],
  "warnings": [
    "comparable-sales-agent refresh failed; existing comparable estimate reused: OPENAI_API_KEY not set"
  ],
  "final_report": null
}
```

`site_intelligence` schema notes:
- current hosted alignment target includes `raw_data jsonb` and `updated_at timestamptz`
- `raw_data` stores the aggregated site-intelligence orchestration payload when available
- legacy hosted rows without `raw_data` remain readable and do not block orchestration
- `knowledge_context` is not part of `site_intelligence`; it is used by comparable-sales persistence

## Example: rule-engine-agent

POST `/functions/v1/rule-engine-agent`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "event": "post-ranking"
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "event": "post-ranking",
  "context": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "event": "post-ranking",
    "score": 82,
    "zoning": "R4",
    "zoning_density": "high-density",
    "flood_risk": "Low",
    "yield": 24,
    "financials": 0.19
  },
  "executed_actions": [
    {
      "source_rule_id": "uuid",
      "event": "post-ranking",
      "condition": "score != null AND score >= 75",
      "action": "deal-report-agent",
      "priority": 1,
      "success": true,
      "skipped": false,
      "reason": "score != null => true AND 82 >= 75 => true",
      "error": null
    }
  ],
  "deal_feed_entry": {
    "id": "44444444-4444-4444-4444-444444444444",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "score": 82,
    "trigger_event": "post-ranking",
    "summary": "High-quality deal matched: score 82, margin 19.0%, risk Low",
    "status": "pending"
  },
  "notification_result": {
    "success": true,
    "skipped": false,
    "reason": null,
    "error": null
  },
  "skipped_rules": [],
  "warnings": []
}
```

Rule evaluation notes:
- supported operators: `>`, `<`, `>=`, `<=`, `==`, `!=`
- supported conjunction: `AND`
- null-safe rules such as `financials != null AND financials > 0.2` are valid
- empty rule sets return `No rules configured for event; default fallback rule set loaded`
- `deal_feed` upserts run only on `post-ranking` and `post-financial`
- when a matched rule includes high-quality score, margin, or low-risk clauses, the function upserts a `deal_feed` row keyed by `deal_id + trigger_event`
- after a `deal_feed` row is persisted, `notification-agent` is invoked with the row payload to log a `deal_alert`

Dispatcher deduplication notes:
- event dispatch dedupe now uses `deal_id + event + context_hash`
- `context_hash` is derived deterministically from `score`, `zoning`, `yield`, and `financials`
- identical context is skipped, changed context is allowed to re-run
- older `ai_actions` records without `context_hash` still use legacy `deal_id + event` fallback until hashed history exists for that event
- `deal_feed` also enforces `deal_id + trigger_event` uniqueness, so qualifying re-runs update the existing feed entry instead of creating duplicates
- `notification-agent` evaluates each subscribed user independently and throttles to at most one `deal_alert` per deal per user in the configured timeframe

## Example: notification-agent

POST `/functions/v1/notification-agent`

Validation notes:
- `deal_feed_id` and `deal_id` must be non-empty UUIDs
- `trigger_event` and `summary` are required
- notifications are matched against `user_preferences`, low-priority alerts are suppressed unless the user's `notification_level` allows them, and each decision is logged into `ai_actions`

Request:

```json
{
  "deal_feed_id": "44444444-4444-4444-4444-444444444444",
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "score": 82,
  "priority_score": 91.4,
  "trigger_event": "post-ranking",
  "summary": "High-quality deal matched: score 82, margin 19.0%, risk Low"
}
```

Response:

```json
{
  "success": true,
  "skipped": false,
  "notification_type": "high_priority",
  "notifications": [
    {
      "id": "55555555-5555-5555-5555-555555555555",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "agent": "notification-agent",
      "action": "deal_alert",
      "source": "deal_feed",
      "payload": {
        "type": "deal_alert",
        "user_id": "66666666-6666-6666-6666-666666666666",
        "notification_type": "high_priority",
        "deal_feed_id": "44444444-4444-4444-4444-444444444444",
        "deal_id": "11111111-1111-1111-1111-111111111111",
        "score": 82,
        "priority_score": 91.4,
        "trigger_event": "post-ranking",
        "summary": "High-quality deal matched: score 82, margin 19.0%, risk Low"
      }
    }
  ],
  "decisions": [
    {
      "user_id": "66666666-6666-6666-6666-666666666666",
      "decision": "sent",
      "reason": "Preference matched",
      "notification_level": "high_priority_only"
    }
  ]
}
```

Notes:
- `notification_type` is classified as `high_priority` when `priority_score >= 85` or `score >= 80`; otherwise it is `standard`
- duplicate notification attempts still deduplicate on `deal_feed_id`
- successful notifications increment `deal_performance.notifications_sent`

## Example: get-deal-feed

POST `/functions/v1/get-deal-feed`

Request:

```json
{
  "limit": 20,
  "score": 60,
  "status": "pending",
  "sort_by": "priority_score",
  "user_id": "66666666-6666-6666-6666-666666666666"
}
```

Response:

```json
{
  "success": true,
  "limit": 20,
  "filters": {
    "score": 60,
    "status": "pending",
    "user_id": "66666666-6666-6666-6666-666666666666"
  },
  "applied_preferences": {
    "user_id": "66666666-6666-6666-6666-666666666666",
    "min_score": 60,
    "preferred_strategy": "hold-and-develop",
    "notification_level": "high_priority_only"
  },
  "sort_by": "priority_score",
  "items": [
    {
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "score": 82,
      "priority_score": 91.4,
      "trigger_event": "post-ranking",
      "summary": "High-quality deal matched: score 82, margin 19.0%, risk Low",
      "created_at": "2026-03-24T00:00:00.000Z",
      "status": "pending",
      "address": "12 Marine Parade, Kingscliff NSW 2487",
      "suburb": "Kingscliff",
      "strategy": "hold-and-develop",
      "stage": "opportunity"
    }
  ]
}
```

Notes:
- default `limit` is `20`
- optional filters: `score` is treated as a minimum score, `status` filters by exact lifecycle status, and `user_id` applies `user_preferences` when present
- default sort is `priority_score desc`; ties fall back to `created_at desc`
- `priority_score` uses simple weighted logic: base score + margin contribution - flood/open-risk penalties
- archived rows are excluded unless `status` is explicitly supplied
- each returned deal increments `deal_performance.views` and updates `last_viewed_at`

## Example: get-top-deals

POST `/functions/v1/get-top-deals`

Request:

```json
{
  "limit": 10,
  "sort_by": "composite_score"
}
```

Response:

```json
{
  "success": true,
  "sort_by": "composite_score",
  "limit": 10,
  "items": [
    {
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "score": 102.5,
      "priority_score": 91.5,
      "views": 14,
      "actions_taken": 2
    }
  ]
}
```

Notes:
- default sort is `composite_score`
- `score` is the composite ranking score derived from `priority_score`, `views`, and `actions_taken`
- default limit is `10`

## Example: generate-deal-report

POST `/functions/v1/generate-deal-report`

Request:

```json
{
  "days": 7
}
```

Response:

```json
{
  "success": true,
  "report": {
    "generated_at": "2026-03-24T00:00:00.000Z",
    "period_start": "2026-03-17T00:00:00.000Z",
    "period_end": "2026-03-24T00:00:00.000Z",
    "new_deals": {
      "count": 3,
      "items": []
    },
    "improved_deals": {
      "count": 1,
      "items": []
    },
    "top_deals": {
      "count": 10,
      "items": []
    },
    "summary": {
      "total_new_deals": 3,
      "total_improved_deals": 1,
      "top_deal_ids": [
        "11111111-1111-1111-1111-111111111111"
      ]
    }
  }
}
```

Notes:
- the function summarises the trailing weekly window by default
- improved deals are sourced from `Re-evaluate feasibility` tasks
- each generated report is logged to `ai_actions` with action `weekly_deal_report_generated`

## Example: subscribe-deal-feed

POST `/functions/v1/subscribe-deal-feed`

Request:

```json
{
  "user_id": "66666666-6666-6666-6666-666666666666"
}
```

Response:

```json
{
  "success": true,
  "channel": {
    "topic": "deal-feed",
    "event": "deal_feed_change",
    "type": "broadcast"
  },
  "fallback": {
    "topic": "deal-feed-fallback",
    "event": "postgres_changes",
    "schema": "public",
    "table": "deal_feed_realtime_fallback"
  },
  "user_preferences": {
    "user_id": "66666666-6666-6666-6666-666666666666",
    "min_score": 60,
    "preferred_strategy": "hold-and-develop",
    "notification_level": "high_priority_only"
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
    "assigned_to": "acquisitions",
    "status": "open"
  },
  "compatibility_mode": "legacy",
  "duplicate": false,
  "warnings": [
    "tasks table used legacy owner column"
  ]
}
```

Duplicate handling notes:
- if an open task with the same `deal_id` and `title` already exists, the function returns `success: true`, `skipped: true`, and `duplicate: true`
- successful task creation increments `deal_performance.actions_taken`

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
      "error": null,
      "compatibility_mode": "legacy",
      "warning": "tasks table used legacy owner column"
    }
  ]
}
```

Compatibility notes:
- action-layer writes normalize legacy hosted `tasks` and `risks` schemas before returning results
- `get-agent-rules` normalizes both current `action_schema` rows and legacy `allowed_action` / `conditions` rows into the same rule payload consumed by `rule-engine-agent`

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
  "ranking_tier": "B",
  "event_dispatch": {
    "event": "post-ranking",
    "triggered": true,
    "duplicate": false,
    "skipped": false,
    "reason": null
  }
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
- `use_comparable_sales` is optional and defaults to `true`
- resilience mode keeps report generation alive with partial `data`, `warnings`, and preserved top-level fields when downstream agents, optional database reads, or action logging fail

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
- `/rule-engine-agent`
- `/ai-agent`
- `/create-task`
- `/deal-agent`
- `/deal-intelligence`
- `/deal-report-agent`
- `/da-discovery-agent`
- `/email-agent`
- `/get-agent-rules`
- `/get-deal`
- `/get-deal-feed`
- `/get-top-deals`
- `/get-deal-context`
- `/get-deal-timeline`
- `/generate-deal-report`
- `/log-communication`
- `/notification-agent`
- `/subscribe-deal-feed`
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
