"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowDownNarrowWide, ArrowUpNarrowWide, RefreshCcw, Search, Signal } from "lucide-react";

import { DealCard } from "@/components/deal/deal-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDealFeed, type DealFeedItem } from "@/lib/api/getDealFeed";

type FeedFilter = "all" | "active" | "archived";
type SortField = "score" | "priority" | "date";
type SortDir = "desc" | "asc";

function sortDeals(items: DealFeedItem[], field: SortField, dir: SortDir): DealFeedItem[] {
  const multiplier = dir === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    let av: number, bv: number;
    if (field === "score") {
      av = a.score ?? 0;
      bv = b.score ?? 0;
    } else if (field === "priority") {
      av = a.priority_score ?? 0;
      bv = b.priority_score ?? 0;
    } else {
      av = a.created_at ? new Date(a.created_at).getTime() : 0;
      bv = b.created_at ? new Date(b.created_at).getTime() : 0;
    }
    return (av - bv) * multiplier;
  });
}

export default function DealFeed() {
  const [deals, setDeals] = useState<DealFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<FeedFilter>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const dedupedDeals = Array.from(new Map(deals.map((deal) => [deal.deal_id, deal])).values());

  const feedStats = useMemo(() => {
    const deduped = Array.from(new Map(deals.map((d) => [d.deal_id, d])).values());
    const total = deduped.length;
    const highConviction = deduped.filter((d) => (d.score ?? 0) >= 85).length;
    const scores = deduped.map((d) => d.score).filter((s): s is number => s !== null);
    const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const strategyCounts: Record<string, number> = {};
    deduped.forEach((d) => {
      const s = (d.strategy ?? "unknown").toLowerCase().replace(/[_-]/g, " ");
      strategyCounts[s] = (strategyCounts[s] ?? 0) + 1;
    });
    const topStrategies = Object.entries(strategyCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return { total, highConviction, avgScore, topStrategies };
  }, [deals]);

  const visibleDeals = useMemo(() => {
    let result = dedupedDeals;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (d) =>
          (d.address ?? "").toLowerCase().includes(q) ||
          (d.deal_name ?? "").toLowerCase().includes(q) ||
          (d.suburb ?? "").toLowerCase().includes(q) ||
          (d.state ?? "").toLowerCase().includes(q),
      );
    }
    return sortDeals(result, sortField, sortDir);
    // dedupedDeals is derived — intentionally omit from deps to avoid stale closure issues;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, search, sortField, sortDir]);

  const loadDeals = useCallback(async (nextFilter: FeedFilter) => {
    setLoading(true);
    setError(null);

    try {
      const stageFilter =
        nextFilter === "all" ? null : nextFilter === "active" ? "active" : "archived";
      const data = await getDealFeed(stageFilter);
      setDeals(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load deals.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeals(selectedFilter);
  }, [loadDeals, selectedFilter]);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
        <section className="overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.22),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] p-6 shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-background/70">
                  Live Supabase Feed
                </Badge>
              </div>
              <div className="space-y-2">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  Ranked deals for triage, approval, and allocation.
                </h1>
                <p className="max-w-xl text-base leading-7 text-muted-foreground">
                  Connected to the `get-deal-feed` function and structured for
                  the next workflow layer.
                </p>
              </div>
            </div>
            <Card className="min-w-[260px] border-border/70 bg-background/75 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Signal className="size-4 text-primary" />
                  Feed status
                </CardTitle>
                <CardDescription>
                  Current client-side fetch state from Supabase Edge Functions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">State</span>
                  <Badge variant={error ? "destructive" : loading ? "secondary" : "default"}>
                    {error ? "Error" : loading ? "Loading" : "Ready"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Visible deals</span>
                  <span className="font-medium">{visibleDeals.length}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={selectedFilter === "all" ? "default" : "outline"}
                    onClick={() => setSelectedFilter("all")}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedFilter === "active" ? "default" : "outline"}
                    onClick={() => setSelectedFilter("active")}
                  >
                    Active
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedFilter === "archived" ? "default" : "outline"}
                    onClick={() => setSelectedFilter("archived")}
                  >
                    Archived
                  </Button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => void loadDeals(selectedFilter)}
                >
                  <RefreshCcw className="size-3.5" />
                  Refresh feed
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Stats bar */}
        {!loading && !error && feedStats.total > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-background/80 px-5 py-3 text-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Total</span>
              <span className="font-semibold text-foreground">{feedStats.total}</span>
            </div>
            <div className="h-3 w-px bg-border/70" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">High conviction</span>
              <span className="font-semibold text-foreground">{feedStats.highConviction}</span>
            </div>
            <div className="h-3 w-px bg-border/70" />
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Avg score</span>
              <span className="font-semibold text-foreground">
                {feedStats.avgScore !== null ? feedStats.avgScore : "—"}
              </span>
            </div>
            {feedStats.topStrategies.length > 0 ? (
              <>
                <div className="h-3 w-px bg-border/70 hidden sm:block" />
                <div className="hidden sm:flex items-center gap-2 flex-wrap">
                  {feedStats.topStrategies.map(([strategy, count]) => (
                    <span
                      key={strategy}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground capitalize"
                    >
                      {strategy}
                      <span className="font-medium text-foreground">{count}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Search + Sort toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by address, suburb…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-border/70 bg-background/80 py-2 pl-8 pr-3.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Sort field */}
          <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background/80 p-1">
            {(["score", "priority", "date"] as SortField[]).map((f) => (
              <button
                key={f}
                onClick={() => setSortField(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                  sortField === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Sort direction */}
          <button
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            title={sortDir === "desc" ? "Descending" : "Ascending"}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
          >
            {sortDir === "desc" ? (
              <ArrowDownNarrowWide className="size-4" />
            ) : (
              <ArrowUpNarrowWide className="size-4" />
            )}
          </button>
        </div>

        {loading ? (
          <div className="grid gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index} className="border-border/70 bg-card/80">
                <CardContent className="space-y-3 py-6">
                  <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                  <div className="h-20 animate-pulse rounded-xl bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 size-4 text-destructive" />
                <div>
                  <p className="font-medium text-foreground">Unable to load deal feed</p>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
              </div>
              <Button onClick={() => void loadDeals(selectedFilter)}>Retry</Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && visibleDeals.length === 0 ? (
          <Card className="border-border/70 bg-card/90">
            <CardContent className="py-8 text-center">
              <p className="text-lg font-medium">
                {search.trim() ? "No deals match your search." : "No deals returned."}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {search.trim()
                  ? "Try a different address, suburb, or state."
                  : "Check the `get-deal-feed` function response and your Supabase environment variables."}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && visibleDeals.length > 0 ? (
          <section className="grid gap-4">
            {visibleDeals.map((deal, index) => (
              <DealCard
                key={deal.deal_id}
                deal={deal}
                filter={selectedFilter}
                allIds={visibleDeals.map((d) => d.deal_id)}
                index={index}
              />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
