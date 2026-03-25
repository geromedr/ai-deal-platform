import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

type DashboardRequest = {
  action?: string;
  payload?: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function classifyNotificationType(row: Record<string, unknown>) {
  const action = typeof row.action === "string" ? row.action : "";
  const payload = typeof row.payload === "object" && row.payload !== null
    ? row.payload as Record<string, unknown>
    : {};
  const payloadType = typeof payload.type === "string" ? payload.type : "";

  if (payloadType === "deal_alert" || action.includes("deal_alert")) return "deal_alert";
  if (action.includes("report")) return "report";
  if (action.includes("task") || action.includes("approval")) return "task";
  return "task";
}

function inferNotificationSuccess(row: Record<string, unknown>) {
  if (typeof row.success === "boolean") return row.success;

  const action = typeof row.action === "string" ? row.action : "";
  if (action.includes("failed") || action.includes("error")) return false;

  const payload = typeof row.payload === "object" && row.payload !== null
    ? row.payload as Record<string, unknown>
    : {};
  const status = typeof payload.status === "string" ? payload.status.toLowerCase() : "";
  if (status === "failed" || status === "error") return false;

  return true;
}

async function invokeFunction(
  supabaseUrl: string,
  serviceKey: string,
  name: string,
  payload: Record<string, unknown> = {},
) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
      "apikey": serviceKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error)
        : `Function ${name} failed with status ${response.status}`,
    );
  }

  return body;
}

function summarizeUsageRows(
  rows: Array<Record<string, unknown>>,
  cutoffIso: string,
) {
  const summary = new Map<string, { agent_name: string; calls: number; estimated_cost: number }>();

  for (const row of rows) {
    const agentName = typeof row.agent_name === "string" ? row.agent_name : null;
    const timestamp = typeof row.timestamp === "string" ? row.timestamp : null;
    if (!agentName || !timestamp || timestamp < cutoffIso) continue;

    const current = summary.get(agentName) ?? {
      agent_name: agentName,
      calls: 0,
      estimated_cost: 0,
    };
    const calls = typeof row.calls === "number" ? row.calls : Number(row.calls ?? 0);
    const estimatedCost = typeof row.estimated_cost === "number"
      ? row.estimated_cost
      : Number(row.estimated_cost ?? 0);

    current.calls += Number.isFinite(calls) ? calls : 0;
    current.estimated_cost += Number.isFinite(estimatedCost) ? estimatedCost : 0;
    summary.set(agentName, current);
  }

  return Array.from(summary.values()).sort((left, right) => right.calls - left.calls);
}

async function loadDashboardData(
  supabaseUrl: string,
  serviceKey: string,
  payload: Record<string, unknown> = {},
) {
  const supabase = createClient(supabaseUrl, serviceKey);
  const minScore = typeof payload.score === "number" ? payload.score : Number(payload.score ?? NaN);
  const status = typeof payload.status === "string" && payload.status.trim().length > 0
    ? payload.status.trim()
    : null;

  let feedQuery = supabase
    .from("deal_feed")
    .select("deal_id, score, priority_score, summary, trigger_event, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (Number.isFinite(minScore)) {
    feedQuery = feedQuery.gte("score", minScore);
  }

  if (status) {
    feedQuery = feedQuery.eq("status", status);
  } else {
    feedQuery = feedQuery.neq("status", "archived");
  }

  const [
    feedResult,
    fallbackResult,
    approvalsResult,
    notificationsResult,
    systemSettingsResult,
    retryQueueResult,
    healthSummary,
    usageSummary,
    operatorSummary,
  ] = await Promise.all([
    feedQuery,
    supabase
      .from("deal_feed_realtime_fallback")
      .select("deal_id, change_type, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("approval_queue")
      .select("id, deal_id, approval_type, status, requested_by_agent, payload, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("ai_actions")
      .select("id, deal_id, agent, action, created_at, payload")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("system_settings")
      .select("setting_key, system_enabled, metadata, updated_at")
      .eq("setting_key", "global")
      .maybeSingle(),
    supabase
      .from("agent_retry_queue")
      .select("id, agent_name, operation, status, retry_count, max_retries, last_error, next_retry_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("system_health")
      .select("component, status, error_message, last_checked")
      .order("last_checked", { ascending: false })
      .limit(20),
    supabase
      .from("usage_metrics")
      .select("agent_name, calls, estimated_cost, timestamp")
      .gte("timestamp", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("timestamp", { ascending: false }),
    supabase
      .from("deals")
      .select("id, status")
      .in("status", ["active", "reviewing", "approved", "funded", "completed"]),
  ]);

  if (feedResult.error) throw new Error(feedResult.error.message);
  if (fallbackResult.error) throw new Error(fallbackResult.error.message);
  if (approvalsResult.error) throw new Error(approvalsResult.error.message);
  if (notificationsResult.error) throw new Error(notificationsResult.error.message);
  if (systemSettingsResult.error) throw new Error(systemSettingsResult.error.message);
  if (retryQueueResult.error) throw new Error(retryQueueResult.error.message);
  if (healthSummary.error) throw new Error(healthSummary.error.message);
  if (usageSummary.error) throw new Error(usageSummary.error.message);
  if (operatorSummary.error) throw new Error(operatorSummary.error.message);

  const dealIds = Array.from(
    new Set((feedResult.data ?? [])
      .map((row) => typeof row.deal_id === "string" ? row.deal_id : null)
      .filter((value): value is string => value !== null)),
  );

  const { data: dealRows, error: dealError } = dealIds.length > 0
    ? await supabase.from("deals").select("id, stage").in("id", dealIds)
    : { data: [], error: null };

  if (dealError) throw new Error(dealError.message);

  const stageByDeal = new Map<string, string | null>();
  for (const row of dealRows ?? []) {
    if (typeof row.id === "string") {
      stageByDeal.set(row.id, typeof row.stage === "string" ? row.stage : null);
    }
  }

  const changeTypeByDeal = new Map<string, string | null>();
  for (const row of fallbackResult.data ?? []) {
    if (typeof row.deal_id === "string" && !changeTypeByDeal.has(row.deal_id)) {
      changeTypeByDeal.set(
        row.deal_id,
        typeof row.change_type === "string" ? row.change_type : null,
      );
    }
  }

  const feed = (feedResult.data ?? []).map((row) => ({
    deal_id: row.deal_id,
    priority_score: row.priority_score,
    summary: row.summary,
    stage: stageByDeal.get(String(row.deal_id)) ?? null,
    status: row.status,
    trigger_event: row.trigger_event,
    change_type: changeTypeByDeal.get(String(row.deal_id)) ?? "sync",
    score: row.score,
    updated_at: row.updated_at,
  }));

  const notifications = (notificationsResult.data ?? []).map((row) => ({
    id: row.id,
    deal_id: row.deal_id,
    agent: row.agent,
    action: row.action,
    type: classifyNotificationType(row as Record<string, unknown>),
    success: inferNotificationSuccess(row as Record<string, unknown>),
    created_at: row.created_at,
    payload: row.payload,
  }));

  const latestHealthTimestamp = typeof healthSummary.data?.[0]?.last_checked === "string"
    ? healthSummary.data[0].last_checked
    : null;
  const latestHealthChecks = latestHealthTimestamp
    ? (healthSummary.data ?? []).filter((row) => row.last_checked === latestHealthTimestamp)
    : [];

  const stageCounts = {
    active: 0,
    reviewing: 0,
    approved: 0,
    funded: 0,
    completed: 0,
  };
  for (const row of operatorSummary.data ?? []) {
    const statusValue = typeof row.status === "string" ? row.status : null;
    if (statusValue && statusValue in stageCounts) {
      stageCounts[statusValue as keyof typeof stageCounts] += 1;
    }
  }

  const usageRows = usageSummary.data ?? [];
  const usage = {
    success: true,
    generated_at: new Date().toISOString(),
    windows: {
      last_24_hours: summarizeUsageRows(
        usageRows as Array<Record<string, unknown>>,
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      ),
      last_7_days: summarizeUsageRows(
        usageRows as Array<Record<string, unknown>>,
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      ),
    },
  };

  const operatorSummaryData = {
    success: true,
    total_active_deals: stageCounts.active,
    total_high_priority_deals: feed.filter((row) =>
      Number(row.priority_score ?? 0) >= 85 || Number(row.score ?? 0) >= 80
    ).length,
    recent_notifications_count: notifications.filter((row) => {
      const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : 0;
      return createdAt >= Date.now() - 24 * 60 * 60 * 1000;
    }).length,
    pending_retries_count: (retryQueueResult.data ?? []).filter((row) =>
      row.status === "queued" || row.status === "retrying"
    ).length,
    latest_system_health_status: latestHealthChecks.some((row) => row.status === "error")
      ? "error"
      : latestHealthChecks.some((row) => row.status === "warning")
      ? "warning"
      : latestHealthChecks.length > 0
      ? "healthy"
      : null,
    latest_generated_reports_count: notifications.filter((row) => row.type === "report").length,
    latest_system_health_checked_at: latestHealthTimestamp,
  };

  const funnel = {
    success: true,
    generated_at: new Date().toISOString(),
    total_deals: Object.values(stageCounts).reduce((sum, value) => sum + value, 0),
    stages: Object.entries(stageCounts).map(([stage, count]) => ({
      stage,
      count,
      conversion_rate_from_previous: null,
      average_time_days: null,
    })),
  };

  return {
    success: true,
    generated_at: new Date().toISOString(),
    system_settings: systemSettingsResult.data,
    feed,
    approvals: approvalsResult.data ?? [],
    notifications,
    retry_queue: retryQueueResult.data ?? [],
    system_health: {
      success: true,
      status: operatorSummaryData.latest_system_health_status,
      checks: latestHealthChecks,
    },
    funnel,
    usage,
    operator_summary: operatorSummaryData,
  };
}

function renderDashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Deal Platform Operator Dashboard</title>
  <style>
    :root {
      --bg: #f2eee7;
      --panel: rgba(255,255,255,0.86);
      --ink: #13212f;
      --muted: #66788a;
      --accent: #be5b38;
      --accent-2: #1f6f78;
      --border: rgba(19,33,47,0.12);
      --good: #1f7a4c;
      --bad: #a03131;
      --warn: #9a6d14;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(190,91,56,0.18), transparent 24rem),
        radial-gradient(circle at top right, rgba(31,111,120,0.22), transparent 28rem),
        linear-gradient(180deg, #f7f2eb 0%, var(--bg) 100%);
      color: var(--ink);
    }
    main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-end;
      margin-bottom: 20px;
    }
    h1, h2 { margin: 0 0 8px; font-weight: 700; letter-spacing: 0.02em; }
    p { margin: 0; color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 18px;
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 32px rgba(19,33,47,0.08);
    }
    .span-12 { grid-column: span 12; }
    .span-7 { grid-column: span 7; }
    .span-5 { grid-column: span 5; }
    .span-6 { grid-column: span 6; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .card {
      padding: 12px;
      border-radius: 14px;
      background: rgba(255,255,255,0.72);
      border: 1px solid var(--border);
    }
    .card strong {
      display: block;
      font-size: 1.4rem;
      margin-top: 4px;
    }
    .toolbar, form {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
      align-items: center;
    }
    input, select, button, textarea {
      border-radius: 10px;
      border: 1px solid var(--border);
      padding: 10px 12px;
      font: inherit;
      color: var(--ink);
      background: rgba(255,255,255,0.9);
    }
    textarea { min-height: 76px; width: 100%; }
    button {
      cursor: pointer;
      background: var(--ink);
      color: white;
      border: none;
    }
    button.secondary { background: var(--accent-2); }
    button.warning { background: var(--accent); }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
      font-size: 0.94rem;
    }
    th, td {
      text-align: left;
      padding: 10px 8px;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 0.8rem;
      background: rgba(19,33,47,0.08);
    }
    .pill.good { color: var(--good); background: rgba(31,122,76,0.12); }
    .pill.bad { color: var(--bad); background: rgba(160,49,49,0.12); }
    .pill.warn { color: var(--warn); background: rgba(154,109,20,0.12); }
    .mono { font-family: "Courier New", monospace; font-size: 0.88rem; }
    .stack { display: grid; gap: 12px; }
    .log {
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255,255,255,0.72);
      border: 1px solid var(--border);
    }
    .status { margin-top: 12px; min-height: 20px; color: var(--muted); }
    @media (max-width: 960px) {
      .span-7, .span-5, .span-6, .span-12 { grid-column: span 12; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div>
        <h1>Operator Control Surface</h1>
        <p>Internal UI for feed triage, approvals, notifications, health, usage, and safety controls.</p>
      </div>
      <button id="refreshButton" class="secondary">Refresh Dashboard</button>
    </section>

    <div class="grid">
      <section class="panel span-12">
        <h2>Platform Summary</h2>
        <div id="summaryCards" class="cards"></div>
      </section>

      <section class="panel span-7">
        <h2>Deal Feed</h2>
        <div class="toolbar">
          <input id="feedScore" type="number" placeholder="Minimum score">
          <select id="feedStatus">
            <option value="">All statuses</option>
            <option value="active">active</option>
            <option value="stale">stale</option>
            <option value="archived">archived</option>
          </select>
          <button id="applyFeedFilters">Apply Filters</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Deal</th>
              <th>Priority</th>
              <th>Summary</th>
              <th>Stage</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody id="feedTable"></tbody>
        </table>
      </section>

      <section class="panel span-5">
        <h2>Action Panel</h2>
        <div class="stack">
          <form id="allocateForm">
            <input name="capital_pool" type="number" min="1" step="1" placeholder="Capital pool" required>
            <input name="max_deals" type="number" min="1" step="1" placeholder="Max deals">
            <button type="submit">Allocate Capital</button>
          </form>
          <form id="outcomeForm">
            <input name="deal_id" class="mono" placeholder="Deal UUID" required>
            <select name="outcome_type" required>
              <option value="won">won</option>
              <option value="lost">lost</option>
              <option value="in_progress">in_progress</option>
            </select>
            <input name="actual_return" type="number" step="0.01" placeholder="Actual return">
            <input name="duration_days" type="number" step="1" placeholder="Duration days">
            <button type="submit">Update Outcome</button>
          </form>
          <div>
            <select id="approvalSelect"></select>
            <button id="approveSelected">Approve Selected Request</button>
          </div>
        </div>
      </section>

      <section class="panel span-6">
        <h2>Notification Dashboard</h2>
        <div class="toolbar">
          <select id="notificationType">
            <option value="">All types</option>
            <option value="deal_alert">deal_alert</option>
            <option value="task">task</option>
            <option value="report">report</option>
          </select>
        </div>
        <div id="notificationList" class="stack"></div>
      </section>

      <section class="panel span-6">
        <h2>Operator Controls</h2>
        <div class="cards" id="healthCards"></div>
        <div class="toolbar">
          <button id="runHealth">System Health Check</button>
          <button id="runCleanup" class="warning">Cleanup</button>
          <button id="runReport" class="secondary">Generate Report</button>
        </div>
        <div class="toolbar">
          <button id="disableSystem" class="warning">Disable System</button>
          <button id="enableSystem" class="secondary">Enable System</button>
        </div>
        <div id="funnelList" class="stack" style="margin-top:12px;"></div>
      </section>

      <section class="panel span-12">
        <h2>Usage Summary</h2>
        <div id="usageRows" class="cards"></div>
      </section>
    </div>

    <div id="statusMessage" class="status"></div>
  </main>

  <script>
    const state = { dashboard: null };

    async function postAction(action, payload = {}) {
      const response = await fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      return data;
    }

    function pill(status) {
      const tone = status === 'healthy' || status === true || status === 'active' || status === 'executed'
        ? 'good'
        : status === 'warning' || status === 'stale'
        ? 'warn'
        : 'bad';
      const label = String(status);
      return '<span class="pill ' + tone + '">' + label + '</span>';
    }

    function setStatus(message) {
      document.getElementById('statusMessage').textContent = message;
    }

    function renderSummary(data) {
      const cards = [
        ['Active deals', data.operator_summary.total_active_deals ?? 0],
        ['High priority', data.operator_summary.total_high_priority_deals ?? 0],
        ['Pending retries', data.operator_summary.pending_retries_count ?? 0],
        ['Reports', data.operator_summary.latest_generated_reports_count ?? 0],
        ['System enabled', data.system_settings?.system_enabled === false ? 'No' : 'Yes'],
      ];
      document.getElementById('summaryCards').innerHTML = cards.map(([label, value]) =>
        '<div class="card"><span>' + label + '</span><strong>' + value + '</strong></div>'
      ).join('');
    }

    function renderFeed(data) {
      document.getElementById('feedTable').innerHTML = data.feed.map((row) =>
        '<tr>' +
          '<td class="mono">' + row.deal_id + '</td>' +
          '<td>' + (row.priority_score ?? '-') + '</td>' +
          '<td>' + (row.summary ?? '-') + '<div class="pill">' + (row.status ?? '-') + '</div></td>' +
          '<td>' + (row.stage ?? '-') + '</td>' +
          '<td>' + (row.change_type ?? '-') + '</td>' +
        '</tr>'
      ).join('');
    }

    function renderApprovals(data) {
      const select = document.getElementById('approvalSelect');
      const pending = data.approvals.filter((row) => row.status === 'pending');
      select.innerHTML = pending.length
        ? pending.map((row) => '<option value="' + row.id + '">' + row.approval_type + ' | ' + row.deal_id + '</option>').join('')
        : '<option value="">No pending approvals</option>';
    }

    function renderNotifications(data) {
      const selectedType = document.getElementById('notificationType').value;
      const rows = data.notifications.filter((row) => !selectedType || row.type === selectedType);
      document.getElementById('notificationList').innerHTML = rows.map((row) =>
        '<div class="log">' +
          '<div><strong>' + row.type + '</strong> ' + pill(row.success) + '</div>' +
          '<div>' + row.agent + ' / ' + row.action + '</div>' +
          '<div class="mono">' + (row.deal_id ?? 'no-deal') + '</div>' +
          '<div>' + row.created_at + '</div>' +
        '</div>'
      ).join('');
    }

    function renderOperator(data) {
      const checks = data.system_health.checks || [];
      document.getElementById('healthCards').innerHTML = checks.map((row) =>
        '<div class="card"><span>' + row.component + '</span><strong>' + pill(row.status) + '</strong></div>'
      ).join('');
      document.getElementById('funnelList').innerHTML = (data.funnel.stages || []).map((row) =>
        '<div class="log">' + row.stage + ': ' + row.count + ' deals, avg ' + (row.average_time_days ?? '-') + ' days</div>'
      ).join('');
    }

    function renderUsage(data) {
      const rows = data.usage.windows?.last_24_hours || [];
      document.getElementById('usageRows').innerHTML = rows.map((row) =>
        '<div class="card"><span>' + row.agent_name + '</span><strong>' + row.calls + ' calls</strong><div>$' + row.estimated_cost.toFixed(4) + ' est.</div></div>'
      ).join('');
    }

    function renderAll(data) {
      state.dashboard = data;
      renderSummary(data);
      renderFeed(data);
      renderApprovals(data);
      renderNotifications(data);
      renderOperator(data);
      renderUsage(data);
      setStatus('Last refreshed at ' + data.generated_at);
    }

    async function refresh(payload = {}) {
      setStatus('Refreshing dashboard...');
      const data = await postAction('bootstrap', payload);
      renderAll(data);
    }

    document.getElementById('refreshButton').addEventListener('click', () => refresh());
    document.getElementById('applyFeedFilters').addEventListener('click', () => {
      refresh({
        score: document.getElementById('feedScore').value || undefined,
        status: document.getElementById('feedStatus').value || undefined,
      }).catch((error) => setStatus(error.message));
    });
    document.getElementById('notificationType').addEventListener('change', () => {
      if (state.dashboard) renderNotifications(state.dashboard);
    });
    document.getElementById('allocateForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await postAction('allocate-capital', Object.fromEntries(form.entries()));
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('outcomeForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      try {
        await postAction('update-deal-outcome', Object.fromEntries(form.entries()));
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('approveSelected').addEventListener('click', async () => {
      const approvalId = document.getElementById('approvalSelect').value;
      if (!approvalId) return;
      try {
        await postAction('approve-queue', { approval_id: approvalId, decision: 'approved' });
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('runHealth').addEventListener('click', async () => {
      try {
        await postAction('run-health-check', {});
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('runCleanup').addEventListener('click', async () => {
      try {
        await postAction('cleanup', {});
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('runReport').addEventListener('click', async () => {
      try {
        await postAction('generate-report', {});
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('disableSystem').addEventListener('click', async () => {
      try {
        await postAction('toggle-system', { system_enabled: false, note: 'Disabled from dashboard' });
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });
    document.getElementById('enableSystem').addEventListener('click', async () => {
      try {
        await postAction('toggle-system', { system_enabled: true, note: 'Enabled from dashboard' });
        await refresh();
      } catch (error) {
        setStatus(error.message);
      }
    });

    refresh().catch((error) => setStatus(error.message));
  </script>
</body>
</html>`;
}

serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Supabase environment variables not set" }, 500);
  }

  if (req.method === "GET") {
    return htmlResponse(renderDashboardHtml());
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json() as DashboardRequest;
    const action = typeof body.action === "string" ? body.action : "";
    const payload = typeof body.payload === "object" && body.payload !== null
      ? body.payload as Record<string, unknown>
      : {};

    if (action === "bootstrap") {
      return jsonResponse(await loadDashboardData(supabaseUrl, serviceKey, payload));
    }

    if (action === "allocate-capital") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "allocate-capital", {
        capital_pool: Number(payload.capital_pool ?? 0),
        max_deals: Number(payload.max_deals ?? 5),
      }));
    }

    if (action === "update-deal-outcome") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "update-deal-outcome", {
        deal_id: payload.deal_id,
        outcome_type: payload.outcome_type,
        actual_return: payload.actual_return === "" ? undefined : Number(payload.actual_return),
        duration_days: payload.duration_days === "" ? undefined : Number(payload.duration_days),
      }));
    }

    if (action === "approve-queue") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "approve-approval-queue", payload));
    }

    if (action === "run-health-check") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "system-health-check", {}));
    }

    if (action === "cleanup") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "cleanup", payload));
    }

    if (action === "generate-report") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "generate-deal-report", { days: 7 }));
    }

    if (action === "toggle-system") {
      return jsonResponse(await invokeFunction(supabaseUrl, serviceKey, "update-system-settings", payload));
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    return jsonResponse({ error: getErrorMessage(error) }, 500);
  }
});
