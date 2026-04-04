# API Reference

All functionality is exposed through Supabase Edge Functions.

Base endpoint:

`/functions/v1/{agent-name}`

Validation:

- endpoints return `400` for missing or malformed required inputs
- endpoints return `500` for downstream or infrastructure failures
- resilient orchestration endpoints may return `200` with warnings when cached
  data is reused, optional stages are skipped, or partial data is returned
  safely
- all agents now run a shared pre-execution validation step before handler logic
  and log a standardized `agent_execution` audit record to `ai_actions`

## Example: site-intelligence-agent

POST `/functions/v1/site-intelligence-agent`

Validation notes:

- `deal_id` must be a non-empty UUID
- `address` is required
- `site_intelligence.raw_data` is written with the aggregated orchestration
  payload when the hosted schema is aligned; legacy hosted rows still complete
  successfully with a warning-only fallback if that column is unavailable
- post-ranking downstream execution is delegated to `rule-engine-agent`; final
  report generation still falls back to `REPORT_TRIGGER_SCORE_THRESHOLD` in the
  function environment if rule evaluation fails
- bootstrap, planning fallback, cached-data fallback, and pipeline logging
  issues are returned in `warnings` / `results` instead of crashing the request
  when partial execution can continue
- top-level responses include an `orchestration` summary for post-intelligence,
  post-ranking, and report decisions

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

- current hosted alignment target includes `raw_data jsonb` and
  `updated_at timestamptz`
- `raw_data` stores the aggregated site-intelligence orchestration payload when
  available
- legacy hosted rows without `raw_data` remain readable and do not block
  orchestration
- `knowledge_context` is not part of `site_intelligence`; it is used by
  comparable-sales persistence

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
- empty rule sets return
  `No rules configured for event; default fallback rule set loaded`
- `deal_feed` upserts run only on `post-ranking` and `post-financial`
- when a matched rule includes high-quality score, margin, or low-risk clauses,
  the function upserts a `deal_feed` row keyed by `deal_id + trigger_event`
- after a `deal_feed` row is persisted, `notification-agent` is invoked with the
  row payload to log a `deal_alert`

Dispatcher deduplication notes:

- event dispatch dedupe now uses `deal_id + event + context_hash`
- `context_hash` is derived deterministically from `score`, `zoning`, `yield`,
  and `financials`
- identical context is skipped, changed context is allowed to re-run
- older `ai_actions` records without `context_hash` still use legacy
  `deal_id + event` fallback until hashed history exists for that event
- `deal_feed` also enforces `deal_id + trigger_event` uniqueness, so qualifying
  re-runs update the existing feed entry instead of creating duplicates
- `notification-agent` evaluates each subscribed user independently and
  throttles to at most one `deal_alert` per deal per user in the configured
  timeframe

## Example: notification-agent

POST `/functions/v1/notification-agent`

Validation notes:

- `deal_feed_id` and `deal_id` must be non-empty UUIDs
- `trigger_event` and `summary` are required
- notifications are matched against `user_preferences`, low-priority alerts are
  suppressed unless the user's `notification_level` allows them, and each
  decision is logged into `ai_actions`

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
  ],
  "deliveries": [
    {
      "channel": "email",
      "status": "delivered",
      "reason": "Email alert sent",
      "attempts": 1
    },
    {
      "channel": "webhook",
      "status": "delivered",
      "reason": "Webhook alert sent",
      "attempts": 1
    }
  ]
}
```

Notes:

- `notification_type` is classified as `high_priority` when
  `priority_score >= 85` or `score >= 80`; otherwise it is `standard`
- duplicate notification attempts still deduplicate on `deal_feed_id`
- successful notifications increment `deal_performance.notifications_sent`
- external email and webhook delivery run only for `high_priority` notifications
- email delivery expects `NOTIFICATION_EMAIL_API_URL`,
  `NOTIFICATION_EMAIL_FROM`, and `NOTIFICATION_EMAIL_TO`; API auth can be
  supplied with `NOTIFICATION_EMAIL_API_KEY`
- webhook delivery uses `NOTIFICATION_WEBHOOK_URL`, supports `structured` or
  `slack` payload formatting via `NOTIFICATION_WEBHOOK_FORMAT`, and retries
  failures using `NOTIFICATION_WEBHOOK_MAX_RETRIES`
- rule-engine policy can queue high-impact downstream actions into
  `approval_queue` instead of executing them immediately when rule payloads set
  `requires_approval`, `approval_required`, or `route_to_approval_queue`

## Example: system-health-check

POST `/functions/v1/system-health-check`

Request:

```json
{}
```

Response:

```json
{
  "success": true,
  "status": "healthy",
  "checked_at": "2026-03-25T00:00:00.000Z",
  "checks": [
    {
      "component": "database",
      "status": "healthy",
      "error_message": null
    },
    {
      "component": "rule-engine-agent",
      "status": "healthy",
      "error_message": null
    }
  ]
}
```

Notes:

- writes one upserted status row per component into `system_health`
- checks `agent_registry` freshness for key agents plus database, `ai_actions`,
  and `deal_feed` activity
- returns `healthy`, `warning`, or `error` based on the worst component state

## Example: get-operator-summary

POST `/functions/v1/get-operator-summary`

Request:

```json
{}
```

Response:

```json
{
  "success": true,
  "total_active_deals": 14,
  "total_high_priority_deals": 3,
  "recent_notifications_count": 7,
  "pending_retries_count": 1,
  "latest_system_health_status": "healthy",
  "latest_generated_reports_count": 5,
  "latest_system_health_checked_at": "2026-03-25T00:00:00.000Z"
}
```

Notes:

- response shape is flat and null-safe
- recent notifications use the last 24 hours
- generated reports count uses the report index over the recent reporting window

## Example: get-usage-summary

POST `/functions/v1/get-usage-summary`

Request:

```json
{}
```

Response:

```json
{
  "success": true,
  "generated_at": "2026-03-26T00:00:00.000Z",
  "windows": {
    "last_24_hours": [
      {
        "agent_name": "rule-engine-agent",
        "calls": 42,
        "estimated_cost": 0
      }
    ],
    "last_7_days": [
      {
        "agent_name": "notification-agent",
        "calls": 210,
        "estimated_cost": 0
      }
    ]
  }
}
```

Notes:

- usage is aggregated from `usage_metrics`
- `estimated_cost` uses configured per-call estimates when available and
  otherwise falls back to `0`, while `calls` remains the primary meter

## Example: update-system-settings

POST `/functions/v1/update-system-settings`

Request:

```json
{
  "system_enabled": false,
  "note": "Temporarily disabled for maintenance."
}
```

Response:

```json
{
  "success": true,
  "settings": {
    "setting_key": "global",
    "system_enabled": false
  }
}
```

Notes:

- updates the single `system_settings` row keyed by `global`
- shared runtime checks this flag before agent execution and returns `503` when
  disabled

## Example: approve-approval-queue

POST `/functions/v1/approve-approval-queue`

Request:

```json
{
  "approval_id": "11111111-1111-1111-1111-111111111111",
  "decision": "approved",
  "operator_note": "Approved from dashboard."
}
```

Response:

```json
{
  "success": true,
  "approval": {
    "id": "11111111-1111-1111-1111-111111111111",
    "status": "executed"
  },
  "execution_result": {
    "success": true,
    "action": "deal-report-agent"
  }
}
```

Notes:

- `decision` must be `approved` or `rejected`
- approved requests execute the queued downstream edge function stored in
  `approval_queue.payload.action`

## Example: cleanup

POST `/functions/v1/cleanup`

Request:

```json
{
  "usage_metrics_retention_days": 30,
  "realtime_retention_days": 7
}
```

Response:

```json
{
  "success": true,
  "cleaned_at": "2026-03-26T00:00:00.000Z",
  "result": {
    "usage_metrics_deleted": 10,
    "realtime_events_deleted": 45,
    "retry_rows_failed": 2
  }
}
```

Notes:

- trims aged `usage_metrics` and `deal_feed_realtime_fallback` rows
- marks exhausted `agent_retry_queue` rows as `failed`

## Example: internal-ops-dashboard

GET `/functions/v1/internal-ops-dashboard`

Notes:

- serves the lightweight internal operator UI
- the page provides feed filtering, approval execution, outcome updates,
  notification filtering, health/retry/funnel summaries, usage cards, and manual
  triggers for health-check, cleanup, report generation, and system
  enable/disable

## Example: allocate-capital

POST `/functions/v1/allocate-capital`

Request:

```json
{
  "capital_pool": 5000000,
  "max_deals": 3,
  "allocation_status": "proposed",
  "minimum_priority_score": 70
}
```

Response:

```json
{
  "success": true,
  "capital_pool": 5000000,
  "allocation_status": "proposed",
  "allocated_count": 3,
  "allocations": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "allocated_amount": 1900000,
      "allocation_status": "proposed",
      "expected_return": 0.22,
      "created_at": "2026-03-25T00:00:00.000Z",
      "updated_at": "2026-03-25T00:00:00.000Z"
    }
  ]
}
```

Notes:

- `capital_pool` is required and must be positive
- eligible deals are selected from the highest `priority_score` values in
  `deal_feed`
- duplicate allocations are prevented by both pre-filtering existing
  `capital_allocations` rows and a unique constraint on
  `capital_allocations.deal_id`
- each allocation run is logged to `ai_actions` with action `capital_allocated`

## Example: update-deal-outcome

POST `/functions/v1/update-deal-outcome`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "outcome_type": "won",
  "actual_return": 0.22,
  "duration_days": 95,
  "notes": "Approved and closed after lender diligence."
}
```

Response:

```json
{
  "success": true,
  "outcome": {
    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "outcome_type": "won",
    "actual_return": 0.22,
    "duration_days": 95,
    "notes": "Approved and closed after lender diligence.",
    "created_at": "2026-03-25T00:00:00.000Z"
  },
  "deal_performance": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "outcomes_recorded": 2,
    "last_outcome_type": "won",
    "last_actual_return": 0.22,
    "average_actual_return": 0.19,
    "average_duration_days": 88.5,
    "last_outcome_recorded_at": "2026-03-25T00:00:00.000Z"
  },
  "scoring_feedback": {
    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "outcome_type": "won",
    "adjustment_factor": 0.041,
    "created_at": "2026-03-25T00:00:00.000Z",
    "updated_at": "2026-03-25T00:00:00.000Z"
  }
}
```

Notes:

- `deal_id` must be a valid UUID and `outcome_type` must be one of `won`,
  `lost`, or `in_progress`
- each call appends a row to `deal_outcomes`, then recomputes aggregate outcome
  metrics in `deal_performance`
- when `actual_return` is supplied, the function compares predicted vs actual
  performance, stores bounded weight adjustments in `scoring_feedback`, and
  keeps score and penalty multipliers within safe limits
- each successful update is logged to `ai_actions` with action
  `deal_outcome_updated`

## Example: get-deal-funnel

POST `/functions/v1/get-deal-funnel`

Request:

```json
{}
```

Response:

```json
{
  "success": true,
  "generated_at": "2026-03-25T00:00:00.000Z",
  "total_deals": 20,
  "stages": [
    {
      "stage": "active",
      "count": 10,
      "conversion_rate_from_previous": null,
      "average_time_days": 12.4
    },
    {
      "stage": "reviewing",
      "count": 7,
      "conversion_rate_from_previous": 70,
      "average_time_days": 8.1
    }
  ],
  "conversion_rates": [
    {
      "from_stage": "active",
      "to_stage": "reviewing",
      "conversion_rate": 70
    }
  ]
}
```

Notes:

- reports the lifecycle funnel for `active`, `reviewing`, `approved`, `funded`,
  and `completed` deals
- conversion rates are calculated from the immediately preceding stage
- average time per stage is derived from `deals.created_at` plus `ai_actions`
  `status_transition` timestamps
- the response is flat, JSON-safe, and intended for dashboard consumption

## Example: add-deal-knowledge-link

POST `/functions/v1/add-deal-knowledge-link`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "document_type": "market_report",
  "source_ref": "knowledge://market-report-q1-2026",
  "summary": "Quarterly market report linked to the deal."
}
```

Response:

```json
{
  "success": true,
  "id": "77777777-7777-7777-7777-777777777777",
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "document_type": "market_report",
  "source_ref": "knowledge://market-report-q1-2026",
  "summary": "Quarterly market report linked to the deal.",
  "metadata": {},
  "created_at": "2026-03-25T00:00:00.000Z"
}
```

## Example: get-deal-reports

POST `/functions/v1/get-deal-reports`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "report_type": "deal_pack",
  "limit": 10
}
```

Response:

```json
{
  "success": true,
  "limit": 10,
  "filters": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "report_type": "deal_pack",
    "created_at": null
  },
  "items": [
    {
      "id": "88888888-8888-8888-8888-888888888888",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "report_type": "deal_pack",
      "source_agent": "generate-deal-pack",
      "source_action": "deal_pack_generated",
      "created_at": "2026-03-25T00:00:00.000Z",
      "summary": "12 Marine Parade, Kingscliff, NSW, 2487",
      "content": {}
    }
  ]
}
```

Notes:

- defaults to most recent first
- uses `report_index` as the stable source and falls back to legacy report
  `ai_actions` rows when needed

## Example: get-deal

POST `/functions/v1/get-deal`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "deal": {
    "id": "11111111-1111-1111-1111-111111111111",
    "address": "12 Marine Parade, Kingscliff NSW 2487"
  },
  "tasks": [],
  "communications": [],
  "financials": [],
  "risks": [],
  "deal_terms": {
    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "sponsor_fee_pct": 2,
    "equity_split": {
      "investor_pct": 80,
      "sponsor_pct": 20
    },
    "preferred_return_pct": 8,
    "notes": "Simple pari passu equity split after sponsor fee.",
    "metadata": {},
    "created_at": "2026-03-29T00:00:00.000Z",
    "updated_at": "2026-03-29T00:00:00.000Z"
  },
  "investors": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "relationship_stage": "contacted",
      "notes": "Initial discussion complete.",
      "metadata": {},
      "created_at": "2026-03-29T00:00:00.000Z",
      "updated_at": "2026-03-29T00:00:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "investor_pipeline": [
    {
      "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "pipeline_status": "contacted",
      "last_contacted_at": "2026-03-29T09:30:00.000Z",
      "next_follow_up_at": "2026-04-02T10:00:00.000Z",
      "notes": "Requested updated underwriting and target raise summary.",
      "metadata": {
        "owner": "capital-team"
      },
      "created_at": "2026-03-29T00:00:00.000Z",
      "updated_at": "2026-03-29T09:30:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "investor_communications": [
    {
      "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "communication_type": "email",
      "direction": "outbound",
      "subject": "Kingscliff deal overview",
      "summary": "Sent the latest deal snapshot and requested feedback on appetite and timing.",
      "status": "sent",
      "metadata": {},
      "communicated_at": "2026-03-29T09:30:00.000Z",
      "created_at": "2026-03-29T09:30:00.000Z",
      "updated_at": "2026-03-29T09:30:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "status": "active"
      }
    }
  ],
  "capital_allocations": [
    {
      "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "committed_amount": 2500000,
      "allocation_pct": 25,
      "status": "soft_commit",
      "notes": "Indicative commitment pending final IC sign-off.",
      "metadata": {
        "source": "capital-team"
      },
      "created_at": "2026-03-29T12:00:00.000Z",
      "updated_at": "2026-03-29T12:00:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "capital_summary": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "capital_target": 6500000,
    "total_committed": 0,
    "total_soft_commit": 2500000,
    "remaining_capital": 6500000,
    "investor_count": 1,
    "committed_investor_count": 0,
    "soft_commit_investor_count": 1,
    "pipeline_new_count": 0,
    "pipeline_contacted_count": 1,
    "pipeline_interested_count": 0,
    "pipeline_negotiating_count": 0,
    "pipeline_committed_count": 0,
    "pipeline_passed_count": 0,
    "pipeline_archived_count": 0,
    "pipeline_summary": {
      "new": 0,
      "contacted": 1,
      "interested": 0,
      "negotiating": 0,
      "committed": 0,
      "passed": 0,
      "archived": 0
    }
  },
  "investor_matches": [
    {
      "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "match_score": 87,
      "match_band": "strong",
      "strategy_score": 35,
      "budget_score": 20,
      "risk_score": 20,
      "location_score": 12,
      "match_reasons": {
        "strategy": {
          "matched": true
        },
        "budget": {
          "matched": false
        },
        "risk": {
          "matched": true
        },
        "location": {
          "matched": true
        }
      },
      "deal_snapshot": {
        "strategy": "hold-and-develop",
        "state": "NSW",
        "suburb": "Kingscliff",
        "deal_size": 6489840,
        "target_margin": 0.5673,
        "risk_band": "opportunistic"
      },
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active",
        "preferred_strategies": [
          "hold-and-develop"
        ],
        "risk_profile": "opportunistic",
        "preferred_states": [
          "NSW"
        ],
        "preferred_suburbs": [],
        "min_target_margin_pct": 18
      }
    }
  ],
  "suggested_investor_actions": [
    {
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "action_type": "contact_investor",
      "reason": "Investor match score 79 is at or above threshold 50.",
      "match_score": 79,
      "match_band": "strong",
      "threshold": 50,
      "current_pipeline_status": "new",
      "target_pipeline_status": "contacted",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "status": "active"
      }
    }
  ]
}
```

Notes:

- `deal_id` must be a valid UUID
- `investors` returns deal-specific relationship rows with nested base investor
  details from `investors`
- `deal_terms` is a nullable additive field that returns the current stored
  terms record directly when defined
- `investor_pipeline` is an additive CRM field sourced from
  `investor_deal_pipeline`, with one row per investor-deal pair
- `investor_communications` is an additive context field returning recent
  deal-linked communication summaries from `investor_communications`
- `capital_allocations` is an additive field sourced from
  `deal_capital_allocations`, returning per-investor commitment tracking for the
  deal
- `capital_summary` is an additive derived field sourced from
  `deal_capital_summary`, exposing raise totals, remaining capital, investor
  counts, and pipeline counts in one deterministic object
- `investor_matches` is an additive field sourced from `deal_investor_matches`;
  `get-deal` refreshes those rows first through `refresh_deal_investor_matches`
- matching is deterministic and limited to stored strategy, deal-size,
  margin/risk, and location signals

## Example: get-deal-context

POST `/functions/v1/get-deal-context`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111"
}
```

Response:

```json
{
  "deal": {
    "id": "11111111-1111-1111-1111-111111111111",
    "status": "reviewing"
  },
  "tasks": [],
  "communications": [],
  "financials": [],
  "risks": [],
  "deal_terms": {
    "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "sponsor_fee_pct": 2,
    "equity_split": {
      "investor_pct": 80,
      "sponsor_pct": 20
    },
    "preferred_return_pct": 8,
    "notes": "Simple pari passu equity split after sponsor fee.",
    "metadata": {},
    "created_at": "2026-03-29T00:00:00.000Z",
    "updated_at": "2026-03-29T00:00:00.000Z"
  },
  "investors": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "relationship_stage": "qualified",
      "notes": null,
      "metadata": {},
      "created_at": "2026-03-29T00:00:00.000Z",
      "updated_at": "2026-03-29T00:00:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "investor_pipeline": [
    {
      "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "pipeline_status": "interested",
      "last_contacted_at": "2026-03-29T09:30:00.000Z",
      "next_follow_up_at": "2026-04-02T10:00:00.000Z",
      "notes": "Awaiting IC feedback after first pass.",
      "metadata": {},
      "created_at": "2026-03-29T00:00:00.000Z",
      "updated_at": "2026-03-29T09:30:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "investor_communications": [
    {
      "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "communication_type": "call",
      "direction": "inbound",
      "subject": "Harbour Capital diligence call",
      "summary": "Investor requested updated comparables and confirmation on equity split assumptions.",
      "status": "received",
      "metadata": {},
      "communicated_at": "2026-03-29T11:00:00.000Z",
      "created_at": "2026-03-29T11:00:00.000Z",
      "updated_at": "2026-03-29T11:00:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "status": "active"
      }
    }
  ],
  "capital_allocations": [
    {
      "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "committed_amount": 3000000,
      "allocation_pct": 30,
      "status": "hard_commit",
      "notes": "Approved at IC and reserved in current raise.",
      "metadata": {},
      "created_at": "2026-03-29T12:00:00.000Z",
      "updated_at": "2026-03-29T15:00:00.000Z",
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active"
      }
    }
  ],
  "capital_summary": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "capital_target": 6500000,
    "total_committed": 3000000,
    "total_soft_commit": 0,
    "remaining_capital": 3500000,
    "investor_count": 1,
    "committed_investor_count": 1,
    "soft_commit_investor_count": 0,
    "pipeline_new_count": 0,
    "pipeline_contacted_count": 0,
    "pipeline_interested_count": 1,
    "pipeline_negotiating_count": 0,
    "pipeline_committed_count": 0,
    "pipeline_passed_count": 0,
    "pipeline_archived_count": 0,
    "pipeline_summary": {
      "new": 0,
      "contacted": 0,
      "interested": 1,
      "negotiating": 0,
      "committed": 0,
      "passed": 0,
      "archived": 0
    }
  },
  "investor_matches": [
    {
      "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "deal_id": "11111111-1111-1111-1111-111111111111",
      "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "match_score": 87,
      "match_band": "strong",
      "strategy_score": 35,
      "budget_score": 20,
      "risk_score": 20,
      "location_score": 12,
      "match_reasons": {
        "strategy": {
          "matched": true
        },
        "budget": {
          "matched": false
        },
        "risk": {
          "matched": true
        },
        "location": {
          "matched": true
        }
      },
      "deal_snapshot": {
        "strategy": "hold-and-develop",
        "state": "NSW",
        "suburb": "Kingscliff",
        "deal_size": 6489840,
        "target_margin": 0.5673,
        "risk_band": "opportunistic"
      },
      "investor": {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "investor_name": "Harbour Capital",
        "investor_type": "fund",
        "capital_min": 1000000,
        "capital_max": 5000000,
        "status": "active",
        "preferred_strategies": [
          "hold-and-develop"
        ],
        "risk_profile": "opportunistic",
        "preferred_states": [
          "NSW"
        ],
        "preferred_suburbs": [],
        "min_target_margin_pct": 18
      }
    }
  ]
}
```

Notes:

- response shape remains deal-context focused, with investor links added as an
  additive field
- `deal_terms` is returned as a nullable additive field so callers can answer
  "what are the terms of this deal?" from persisted data alone
- `investor_pipeline` is returned as an additive CRM layer so callers can see
  current investor status and follow-up timing without inferring it from
  `deal_investors`
- `investor_communications` is returned as an additive recent-summary layer for
  investor-facing context tied to the deal
- `capital_allocations` is returned as an additive commitment layer so callers
  can answer "who has committed what to this deal?" directly from stored rows
- `capital_summary` is returned as an additive derived layer so callers can
  answer "how much is raised, how much is left, how many investors are
  committed, and what is the pipeline status?" without recomputing totals
  client-side
- `investor_matches` is returned as an additive field after `get-deal-context`
  refreshes deterministic scores for all active investors
- `suggested_investor_actions` is returned as an additive deterministic action
  layer, currently suggesting `contact_investor` only when `match_score >= 50`
  and the investor is still at pipeline status `new`
- query failures across deal, task, communication, financial, risk, or investor
  reads now return explicit errors instead of partial silent nulls

## Example: investor-actions

POST `/functions/v1/investor-actions`

Validation notes:

- `deal_id` must be a non-empty UUID
- `action_type` is required unless `suggest_only` is `true`
- the only supported `action_type` is `contact_investor`
- `investor_id` is required for action execution and must be a valid UUID
- execution is deterministic and limited to logging `investor_communications`,
  updating `investor_deal_pipeline`, and writing an `ai_actions` audit row

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "action_type": "contact_investor",
  "communication_type": "note",
  "direction": "outbound",
  "subject": "Investor outreach",
  "summary": "Initial outbound investor outreach logged by the action layer.",
  "suggestion_threshold": 50
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "action_executed": true,
  "result": {
    "action_type": "contact_investor",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "pipeline_transition": {
      "from": "new",
      "to": "contacted"
    },
    "communication": {
      "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "status": "logged",
      "summary": "Initial outbound investor outreach logged by the action layer."
    },
    "pipeline": {
      "id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
      "pipeline_status": "contacted",
      "last_contacted_at": "2026-03-29T00:00:00.000Z"
    }
  },
  "matched_suggestion": {
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "action_type": "contact_investor",
    "match_score": 79,
    "threshold": 50,
    "current_pipeline_status": "new",
    "target_pipeline_status": "contacted"
  },
  "remaining_suggestions": []
}
```

Suggestion-only request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "suggest_only": true,
  "suggestion_threshold": 50
}
```

Notes:

- repeated `contact_investor` executions progress the same investor
  deterministically through `new -> contacted -> interested -> negotiating`
- the action layer only writes pipeline statuses from the valid transition set
  `new`, `contacted`, `interested`, and `negotiating`
- suggestion generation is deterministic and only returns `contact_investor` for
  investors whose `deal_investor_matches.match_score` is at or above the
  threshold while pipeline status is still `new`
- database failures are returned as structured JSON with `success: false`,
  `error: true`, a top-level `message`, and `details.step` describing the
  failing operation instead of an uncaught function crash
- the function does not send messages, create automation loops, or modify
  external systems

Failure response example:

```json
{
  "success": false,
  "error": true,
  "message": "Failed to update investor pipeline",
  "details": {
    "step": "upsert_investor_deal_pipeline",
    "reason": "null value in column \"updated_at\" violates not-null constraint",
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "status": "contacted",
    "communication_id": "cccccccc-cccc-cccc-cccc-cccccccccccc"
  },
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "action_executed": false
}
```

## Example: investor-outreach

POST `/functions/v1/investor-outreach`

Validation notes:

- `deal_id` and `investor_id` are required and must be valid UUIDs
- the function loads current deal, investor, financial, and risk context from
  Supabase and returns a deterministic draft only
- no outbound email, SMS, or webhook delivery occurs

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "investor_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
}
```

Response:

```json
{
  "subject": "Hold And Develop | Kingscliff, NSW | 19% target margin",
  "message": "Hi Harbour Capital,\n\nSharing a hold-and-develop deal in Kingscliff, NSW that fits your hold-and-develop focus.\n\nTL;DR\n- Deal: High-quality coastal site; 12 Marine Parade, Kingscliff NSW 2487; estimated 24 units.\n- Returns: Target margin 19% with projected profit $8.5M on GDV $45M.\n- Risk: Medium risk flagged: Flood overlay diligence.\n\nIf this fits your current mandate, I can share the full deal pack and walk through the assumptions."
}
```

Notes:

- personalization is intentionally light and only uses stored strategy and
  location preferences when available
- message structure is fixed: hook, 3-bullet TL;DR, and call to action
- the function is designed to generate a ready-to-send draft per deal/investor
  pair without logging an outbound send

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
- optional filters: `score` is treated as a minimum score, `status` filters by
  exact lifecycle status, and `user_id` applies `user_preferences` when present
- default sort is `priority_score desc`; ties fall back to `created_at desc`
- `priority_score` uses bounded weighted logic: base score + margin
  contribution - flood/open-risk penalties, with optional latest
  `scoring_feedback.adjusted_weights` applied when feedback exists
- archived rows are excluded unless `status` is explicitly supplied
- each returned deal increments `deal_performance.views` and updates
  `last_viewed_at`

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
- `score` is the composite ranking score derived from `priority_score`, `views`,
  and `actions_taken`
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
- each generated report is logged to `ai_actions` with action
  `weekly_deal_report_generated`

## Example: generate-deal-pack

POST `/functions/v1/generate-deal-pack`

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
  "deal_pack": {
    "generated_at": "2026-03-24T00:00:00.000Z",
    "format": "deal-pack.v1",
    "pdf_ready": true,
    "deal_id": "11111111-1111-1111-1111-111111111111",
    "deal_summary": {
      "address": "12 Marine Parade, Kingscliff, NSW, 2487",
      "status": "reviewing",
      "stage": "opportunity"
    },
    "financials": {
      "latest_snapshot": {
        "category": "financial-engine"
      }
    },
    "risks": [],
    "comparable_context": [],
    "render_hints": {
      "document_title": "Deal Pack - 12 Marine Parade, Kingscliff, NSW, 2487",
      "sections": [
        "deal_summary",
        "financials",
        "risks",
        "comparable_context"
      ]
    }
  }
}
```

Notes:

- `deal_id` must be a non-empty UUID
- the response is structured for future PDF conversion and logs
  `deal_pack_generated` to `ai_actions`

## Example: update-deal-stage

POST `/functions/v1/update-deal-stage`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "new_status": "reviewing",
  "transition_reason": "manual review started"
}
```

Response:

```json
{
  "success": true,
  "updated_deal": {
    "id": "11111111-1111-1111-1111-111111111111",
    "status": "reviewing"
  },
  "changes": {
    "status_changed": true,
    "stage_changed": false
  },
  "warnings": []
}
```

Notes:

- manual status transitions are validated against
  `active -> reviewing -> approved -> funded -> completed`
- the function still supports `new_stage` updates for existing callers
- `auto_evaluate: true` can be used to promote a deal to `approved` when all
  linked tasks are complete
- duplicate transition requests are returned as `success: true` with
  `skipped: true`

## Example: submit-decision

POST `/functions/v1/submit-decision`

Validation notes:

- `deal_id` must be a non-empty UUID for an existing deal
- `decision` must be one of `BUY`, `REVIEW`, or `PASS`
- the function writes a pending decision audit row into `ai_actions`

Request:

```json
{
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "decision": "REVIEW"
}
```

Response:

```json
{
  "success": true,
  "deal_id": "11111111-1111-1111-1111-111111111111",
  "decision": "REVIEW",
  "action_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "timestamp": "2026-04-05T00:00:00.000Z",
  "message": "Decision submitted successfully"
}
```

Notes:

- CORS preflight allows `POST, OPTIONS`
- the implementation inserts directly into `ai_actions` using the documented
  `deal_id`, `agent`, `action`, and `payload` columns

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

- if an open task with the same `deal_id` and `title` already exists, the
  function returns `success: true`, `skipped: true`, and `duplicate: true`
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

- action-layer writes normalize legacy hosted `tasks` and `risks` schemas before
  returning results
- `get-agent-rules` normalizes both current `action_schema` rows and legacy
  `allowed_action` / `conditions` rows into the same rule payload consumed by
  `rule-engine-agent`

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
- resilience mode returns `success: true` with partial `data`, `warnings`, and
  preserved top-level fields when downstream or optional data is unavailable

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
- resilience mode keeps report generation alive with partial `data`, `warnings`,
  and preserved top-level fields when downstream agents, optional database
  reads, or action logging fail

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
- `/get-deal-funnel`
- `/get-deal-reports`
- `/get-top-deals`
- `/investor-actions`
- `/investor-outreach`
- `/allocate-capital`
- `/get-deal-context`
- `/get-deal-timeline`
- `/generate-deal-report`
- `/generate-deal-pack`
- `/get-operator-summary`
- `/get-usage-summary`
- `/update-system-settings`
- `/approve-approval-queue`
- `/cleanup`
- `/internal-ops-dashboard`
- `/system-health-check`
- `/log-communication`
- `/notification-agent`
- `/subscribe-deal-feed`
- `/update-deal-outcome`
- `/update-deal-stage`
- `/submit-decision`
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
- `/add-deal-knowledge-link`
- `/add-knowledge-document`
- `/search-knowledge`
- `/system-health-check`
- `/test-agent`
