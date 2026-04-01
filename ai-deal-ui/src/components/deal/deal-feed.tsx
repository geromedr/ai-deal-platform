"use client";

import { useEffect, useState } from "react";
import { AlertCircle, RefreshCcw, Signal } from "lucide-react";

import { DealCard } from "@/components/deal/deal-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDealFeed, type DealFeedItem } from "@/lib/api/getDealFeed";

export default function DealFeed() {
  const [deals, setDeals] = useState<DealFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDeals() {
    setLoading(true);
    setError(null);

    try {
      const data = await getDealFeed();
      console.log("DEALS:", data);
      setDeals(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load deals.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDeals();
  }, []);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
        <section className="overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.22),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] p-6 shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Badge variant="outline" className="bg-background/70">
                Live Supabase Feed
              </Badge>
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
                  <span className="font-medium">{deals.length}</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => void loadDeals()}
                >
                  <RefreshCcw className="size-3.5" />
                  Refresh feed
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

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
              <Button onClick={() => void loadDeals()}>Retry</Button>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && deals.length === 0 ? (
          <Card className="border-border/70 bg-card/90">
            <CardContent className="py-8 text-center">
              <p className="text-lg font-medium">No deals returned.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Check the `get-deal-feed` function response and your Supabase
                environment variables.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {!loading && !error && deals.length > 0 ? (
          <section className="grid gap-4">
            {deals.map((deal) => (
              <DealCard key={deal.deal_id} deal={deal} />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
