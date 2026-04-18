import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type NotificationItem = {
  id: string;
  deal_id: string | null;
  action: string | null;
  agent: string | null;
  created_at: string | null;
  payload: Record<string, unknown> | null;
  // derived
  title: string | null;
  address: string | null;
  priority: "high" | "standard";
};

type NotificationsResponse = {
  items: NotificationItem[];
  unread_count: number;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deriveTitle(action: string | null, payload: Record<string, unknown> | null): string | null {
  if (!action) return null;
  // Try to pull a human-readable title from common payload shapes
  if (payload) {
    const msg = payload.message ?? payload.title ?? payload.summary ?? payload.description;
    if (typeof msg === "string" && msg.trim().length > 0) return msg.trim().slice(0, 120);
  }
  return action.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function deriveAddress(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const addr = payload.address ?? payload.deal_address;
  if (typeof addr === "string") return addr;
  const deal = isRecord(payload.deal) ? payload.deal : null;
  if (deal && typeof deal.address === "string") return deal.address;
  return null;
}

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceKey ?? anonKey;

  if (!supabaseUrl || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  try {
    const supabase = createClient(supabaseUrl, key);

    const { data, error } = await supabase
      .from("ai_actions")
      .select("id, deal_id, action, agent, created_at, payload")
      .in("action", [
        "deal_alert",
        "high_priority_alert",
        "notification_sent",
        "high_priority_notification",
        "deal_score_high",
        "new_deal_flagged",
      ])
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);

    const items: NotificationItem[] = (data ?? []).map((row) => {
      const payload = isRecord(row.payload) ? row.payload : null;
      const isHigh =
        row.action === "high_priority_alert" ||
        row.action === "high_priority_notification" ||
        row.action === "deal_score_high";

      return {
        id: String(row.id),
        deal_id: row.deal_id ?? null,
        action: row.action ?? null,
        agent: row.agent ?? null,
        created_at: row.created_at ?? null,
        payload,
        title: deriveTitle(row.action ?? null, payload),
        address: deriveAddress(payload),
        priority: isHigh ? "high" : "standard",
      };
    });

    return NextResponse.json({
      items,
      unread_count: items.length,
    } satisfies NotificationsResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
