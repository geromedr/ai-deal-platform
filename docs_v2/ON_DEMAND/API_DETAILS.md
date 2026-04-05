# API DETAILS

Load this document only when endpoint-level request and response detail is required.

## COVERAGE

Detailed endpoint contracts currently live in legacy `docs/system/API.md`. The active endpoint groups are:

- orchestration and rules
- discovery
- planning intelligence
- feasibility
- deal context and reporting
- investor and capital
- operations and safety

## API CONTRACT RULES

- Keep request validation explicit.
- Keep response shapes JSON-safe and predictable.
- Preserve backwards compatibility when existing callers depend on a shape.
- Return warnings explicitly when safe partial results are allowed.
- Use structured error responses for invalid input and downstream failures.

## HIGH-VALUE ENDPOINT FAMILIES

Core orchestration:
- `site-intelligence-agent`
- `event-dispatcher`
- `rule-engine-agent`
- `notification-agent`

Deal context and reporting:
- `get-deal`
- `get-deal-context`
- `get-deal-feed`
- `deal-report-agent`
- `generate-deal-report`
- `generate-deal-pack`
- `get-deal-reports`

Investor and capital:
- `investor-actions`
- `investor-outreach`
- `allocate-capital`
- `get-deal-funnel`
- `update-deal-outcome`

Operations:
- `system-health-check`
- `get-operator-summary`
- `get-usage-summary`
- `update-system-settings`
- `approve-approval-queue`
- `cleanup`

## WHEN TO LOAD

Load this document when changing endpoint I/O, validating callers, or reviewing compatibility risk. Otherwise stay on the default load pair.
