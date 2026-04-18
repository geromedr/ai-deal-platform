"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Loader2, X } from "lucide-react";
import { timeAgo, sentenceCase } from "@/lib/utils/format";
import type { NotificationItem } from "@/app/api/notifications/route";

type NotificationsResponse = {
  items: NotificationItem[];
  unread_count: number;
  error?: string;
};

export default function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/notifications")
      .then(async (res) => {
        const json = (await res.json()) as NotificationsResponse;
        if (json.error) throw new Error(json.error);
        setItems(json.items ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  // Load on first open
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const visible = items.filter((i) => !dismissed.has(i.id));
  const highCount = visible.filter((i) => i.priority === "high").length;
  const badgeCount = visible.length;

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          open ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {badgeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[360px] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {highCount > 0 && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  {highCount} high priority
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {visible.length > 0 && (
                <button
                  onClick={() => setDismissed(new Set(items.map((i) => i.id)))}
                  className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
                  title="Dismiss all"
                >
                  <CheckCheck className="size-3.5" />
                  Clear
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                {error}
              </div>
            ) : visible.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications yet.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {visible.map((item) => (
                  <div
                    key={item.id}
                    className={`group relative flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40 ${
                      item.priority === "high" ? "border-l-2 border-l-destructive/60" : ""
                    }`}
                  >
                    {/* Dot */}
                    <div className="mt-1.5 flex shrink-0 flex-col items-center">
                      <div className={`size-2 rounded-full ${
                        item.priority === "high" ? "bg-destructive" : "bg-primary/60"
                      }`} />
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
                        {item.title ?? sentenceCase(item.action)}
                      </p>
                      {item.address && (
                        <p className="mt-0.5 text-xs text-muted-foreground truncate">{item.address}</p>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{timeAgo(item.created_at)}</span>
                        {item.deal_id && (
                          <Link
                            href={`/deal/${item.deal_id}`}
                            onClick={() => setOpen(false)}
                            className="text-[10px] text-primary hover:underline"
                          >
                            View deal →
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* Dismiss */}
                    <button
                      onClick={() => setDismissed((prev) => new Set([...prev, item.id]))}
                      className="invisible group-hover:visible absolute right-2 top-2 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {!loading && !error && (
            <div className="border-t border-border/70 px-4 py-2.5">
              <button
                onClick={load}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
