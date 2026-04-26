import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js"
import { createAgentHandler } from "../_shared/agent-runtime.ts";
import { requireEnv } from "../_shared/utils.ts";

serve(createAgentHandler({ agentName: "get-deal-timeline", requiredFields: [{ name: "deal_id", type: "string", uuid: true }] }, async (req) => {

  try {

    const { deal_id } = await req.json()

    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    )

    // Utility agents that fire on every page load — exclude from the timeline
    // so it only shows meaningful pipeline and workflow events.
    const READ_AGENTS = [
      "get-deal-timeline",
      "get-deal-context",
      "get-deal",
      "get-deal-feed",
      "get-deal-reports",
      "get-agent-rules",
      "get-top-deals",
      "get-operator-summary",
      "get-usage-summary",
      "get-deal-funnel",
      "search-knowledge",
      "system-health-check",
    ]

    // Query source tables directly — avoids relying on the deal_activity_feed view
    // whose column aliases may differ on the hosted database.
    const [
      { data: aiActions },
      { data: feedRows },
      { data: taskRows },
      { data: riskRows },
      { data: finRows },
    ] = await Promise.all([
      supabase
        .from("ai_actions")
        .select("id, deal_id, agent, action, source, created_at")
        .eq("deal_id", deal_id)
        .not("agent", "in", `(${READ_AGENTS.map(a => `"${a}"`).join(",")})`)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("deal_feed")
        .select("id, deal_id, trigger_event, summary, score, created_at")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, deal_id, title, description, status, created_at")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("risks")
        .select("id, deal_id, title, description, severity, created_at")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false }),
      supabase
        .from("financial_snapshots")
        .select("id, deal_id, category, notes, created_at")
        .eq("deal_id", deal_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ])

    type TimelineItem = {
      id: string;
      deal_id: string;
      event_type: string;
      title: string;
      description: string | null;
      agent: string | null;
      created_at: string;
    }

    const toStr = (v: unknown) => (typeof v === "string" && v ? v : null)
    const toTitle = (s: string | null) =>
      s ? s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null

    const events: TimelineItem[] = []

    // Pipeline run events (richest signal — show at top of each run)
    for (const r of feedRows ?? []) {
      events.push({
        id: `feed-${r.id}`,
        deal_id: r.deal_id,
        event_type: "pipeline_run",
        title: toTitle(toStr(r.trigger_event)) ?? "Pipeline Run",
        description: toStr(r.summary),
        agent: r.score != null ? `Score: ${r.score}` : null,
        created_at: r.created_at,
      })
    }

    // AI agent execution entries
    for (const r of aiActions ?? []) {
      const agentName = toStr(r.agent)
      const action = toStr(r.action)
      events.push({
        id: `ai-${r.id}`,
        deal_id: r.deal_id,
        event_type: "ai_action",
        title: toTitle(agentName) ?? toTitle(action) ?? "Agent Action",
        description: toTitle(action) !== toTitle(agentName) ? toTitle(action) : null,
        agent: agentName,
        created_at: r.created_at,
      })
    }

    // Tasks
    for (const r of taskRows ?? []) {
      events.push({
        id: `task-${r.id}`,
        deal_id: r.deal_id,
        event_type: "task",
        title: toStr(r.title) ?? "Task",
        description: toStr(r.description),
        agent: toStr(r.status),
        created_at: r.created_at,
      })
    }

    // Risks
    for (const r of riskRows ?? []) {
      events.push({
        id: `risk-${r.id}`,
        deal_id: r.deal_id,
        event_type: "risk",
        title: toStr(r.title) ?? "Risk",
        description: toStr(r.description),
        agent: toStr(r.severity),
        created_at: r.created_at,
      })
    }

    // Financial snapshots
    for (const r of finRows ?? []) {
      events.push({
        id: `fin-${r.id}`,
        deal_id: r.deal_id,
        event_type: "analysis",
        title: toTitle(toStr(r.category)) ?? "Financial Snapshot",
        description: toStr(r.notes),
        agent: null,
        created_at: r.created_at,
      })
    }

    // Sort newest-first
    events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return new Response(
      JSON.stringify({ success: true, timeline: events }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500 }
    )
  }

}));
