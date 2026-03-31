import Link from "next/link";
import { ArrowLeft, FolderKanban } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function WorkspacePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-6 py-10 sm:px-10">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Badge variant="outline">Workspace</Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            Deal Workspace placeholder
          </h1>
          <p className="text-muted-foreground">
            Add the selected deal summary, diligence tabs, AI notes, and capital
            actions here.
          </p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </div>

      <Card className="border-border/70 bg-card/95">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="size-4 text-primary" />
            Workspace route is live
          </CardTitle>
          <CardDescription>
            This route exists so the Deal Feed can navigate into a dedicated
            review surface immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Suggested next widgets for this screen:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Selected deal header with status and scoring context</li>
            <li>Tabbed detail panes for tasks, risks, and investor activity</li>
            <li>AI action rail wired to the existing Supabase functions</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
