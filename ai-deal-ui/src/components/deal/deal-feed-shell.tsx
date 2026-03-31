"use client";

import Link from "next/link";
import { ArrowRight, LayoutDashboard, Search, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const pipelineCards = [
  {
    title: "Deal Feed",
    value: "12 new signals",
    detail: "Ranking-ready opportunities waiting for triage.",
  },
  {
    title: "Workspace",
    value: "4 active reviews",
    detail: "Deals with open diligence, risk, or capital actions.",
  },
  {
    title: "AI Sync",
    value: "Figma MCP ready",
    detail: "Design references can map into implementation work.",
  },
];

export function DealFeedShell() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.22),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] p-6 shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)] sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <Badge variant="outline" className="bg-background/70">
              AI Deal Platform
            </Badge>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                Deal Feed command layer for sourcing, review, and design sync.
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground">
                This placeholder screen establishes the dashboard shell for the
                upcoming Deal Feed UI and links through to a dedicated workspace
                route.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/workspace"
              className={buttonVariants({ size: "lg" })}
            >
              Open Workspace
              <ArrowRight className="size-4" />
            </Link>
            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="lg" />}>
                Configure Feed
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Deal Feed setup placeholder</DialogTitle>
                  <DialogDescription>
                    Hook Supabase filters, saved views, and search parameters
                    into this dialog as the next UI step.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <Input placeholder="Minimum score, suburb, or strategy" />
                  <Input placeholder="Assigned analyst or pipeline tag" />
                </div>
                <DialogFooter showCloseButton>
                  <Button>Save View</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {pipelineCards.map((card) => (
          <Card key={card.title} className="border-border/70 bg-card/90">
            <CardHeader>
              <CardTitle>{card.title}</CardTitle>
              <CardDescription>{card.detail}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight">
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Tabs defaultValue="feed" className="gap-4">
        <TabsList>
          <TabsTrigger value="feed">Deal Feed</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="design">Design Sync</TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LayoutDashboard className="size-4 text-primary" />
                Placeholder Deal Feed container
              </CardTitle>
              <CardDescription>
                Use this panel for ranked deals, saved filters, realtime feed
                updates, and shortlist actions.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {[
                "High-priority coastal site signal",
                "Off-market infill opportunity",
                "Follow-up required after planning review",
              ].map((item, index) => (
                <div
                  key={item}
                  className="flex items-center justify-between rounded-xl border border-border/70 bg-background/75 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{item}</p>
                    <p className="text-sm text-muted-foreground">
                      Placeholder card {index + 1} for live deal feed data.
                    </p>
                  </div>
                  <Badge>{index === 0 ? "Hot" : "Queued"}</Badge>
                </div>
              ))}
            </CardContent>
            <CardFooter className="justify-between">
              <span className="text-sm text-muted-foreground">
                Connect `get-deal-feed` and realtime subscriptions next.
              </span>
              <Link
                href="/workspace"
                className={buttonVariants({ variant: "ghost" })}
              >
                Review workspace
              </Link>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="workspace">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="size-4 text-primary" />
                Deal Workspace route
              </CardTitle>
              <CardDescription>
                The `/workspace` route is scaffolded and ready for detail panels,
                notes, and AI-assisted review flows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/workspace" className={buttonVariants()}>
                Open /workspace
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="design">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                Figma MCP integration placeholder
              </CardTitle>
              <CardDescription>
                Reserve this surface for linked frames, component parity, and
                design-to-code sync status once the Figma plugin is available in
                the local Codex install.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
