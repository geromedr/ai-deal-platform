"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Pencil, RefreshCcw, X, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateTimeShort } from "@/lib/utils/format";
import type { ApprovalQueueItem, ApprovalQueueListResponse } from "@/app/api/approval-queue/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmailPayload = {
  to?: string;
  subject?: string;
  body?: string;
  from_name?: string;
  preview?: string;
  action?: string;
  action_payload?: Record<string, unknown>;
};

type ActionResult =
  | { type: "success"; message: string }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractEmail(payload: Record<string, unknown>): EmailPayload {
  // Drafts may store fields directly or nested under action_payload
  const ap =
    typeof payload.action_payload === "object" && payload.action_payload !== null
      ? (payload.action_payload as Record<string, unknown>)
      : {};

  return {
    to: (payload.to ?? ap.to ?? "") as string,
    subject: (payload.subject ?? ap.subject ?? "(No subject)") as string,
    body: (payload.body ?? ap.body ?? ap.text ?? "") as string,
    from_name: (payload.from_name ?? ap.from_name ?? "") as string,
    preview: (payload.preview ?? "") as string,
    action: (payload.action ?? "") as string,
    action_payload: ap,
  };
}

// ---------------------------------------------------------------------------
// EmailDraftCard
// ---------------------------------------------------------------------------

function EmailDraftCard({
  item,
  onRefresh,
}: {
  item: ApprovalQueueItem;
  onRefresh: () => void;
}) {
  const email = extractEmail(item.payload);

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSubject, setEditSubject] = useState(email.subject ?? "");
  const [editBody, setEditBody] = useState(email.body ?? "");
  const [rejectNote, setRejectNote] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [actioned, setActioned] = useState(false);

  async function submitDecision(
    decision: "approved" | "rejected",
    operatorNote?: string,
  ) {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/approve-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approval_id: item.id,
          decision,
          ...(operatorNote ? { operator_note: operatorNote } : {}),
        }),
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (json.error) throw new Error(json.error);
      setResult({
        type: "success",
        message: decision === "approved" ? "Email approved for sending." : "Draft rejected.",
      });
      setActioned(true);
      setTimeout(() => onRefresh(), 1500);
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : "Action failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAndApprove() {
    setBusy(true);
    setResult(null);
    try {
      // Patch the payload with edited content first
      const patchRes = await fetch("/api/approval-queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approval_id: item.id,
          payload_patch: {
            subject: editSubject,
            body: editBody,
            action_payload: {
              ...email.action_payload,
              subject: editSubject,
              body: editBody,
            },
          },
        }),
      });
      const patchJson = (await patchRes.json()) as { success?: boolean; error?: string };
      if (patchJson.error) throw new Error(patchJson.error);

      // Then approve
      await submitDecision("approved", "Edited by operator before approval.");
    } catch (err) {
      setResult({
        type: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
      setBusy(false);
    }
  }

  if (actioned && result?.type === "success") {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-green-600" />
        <span>{result.message}</span>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4 space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-foreground text-sm truncate">
            {email.subject || "(No subject)"}
          </p>
          {email.to ? (
            <p className="text-xs text-muted-foreground">
              To: <span className="font-medium text-foreground/80">{email.to}</span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="text-xs">
            {item.requested_by_agent}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {formatDateTimeShort(item.created_at)}
          </span>
        </div>
      </div>

      {/* Body preview / editor */}
      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Subject</label>
            <input
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Body</label>
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40 resize-y font-mono"
            />
          </div>
        </div>
      ) : (
        <>
          {email.preview ? (
            <p className="text-xs text-muted-foreground italic">{email.preview}</p>
          ) : null}
          {email.body ? (
            <>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {expanded ? "Hide email body" : "Show email body"}
              </button>
              {expanded ? (
                <pre className="mt-1 max-h-64 overflow-auto rounded-xl border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                  {email.body}
                </pre>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {/* Reject form */}
      {showRejectForm ? (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground block">
            Rejection reason (optional)
          </label>
          <input
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="e.g. Tone needs adjustment, resend after review"
            className="w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void submitDecision("rejected", rejectNote || undefined)}
            >
              <XCircle className="size-3.5" />
              Confirm reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowRejectForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* Result banner */}
      {result && !actioned ? (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
          result.type === "error"
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-green-200 bg-green-50/60 text-green-800"
        }`}>
          {result.type === "error"
            ? <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
          {result.message}
        </div>
      ) : null}

      {/* Action bar */}
      {!showRejectForm && !actioned ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {editing ? (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void handleSaveAndApprove()}
              >
                <CheckCircle2 className="size-3.5" />
                {busy ? "Saving…" : "Save & Approve"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setEditSubject(email.subject ?? "");
                  setEditBody(email.body ?? "");
                }}
              >
                <X className="size-3.5" />
                Discard edits
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void submitDecision("approved")}
              >
                <CheckCircle2 className="size-3.5" />
                {busy ? "Approving…" : "Approve"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setShowRejectForm(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <XCircle className="size-3.5" />
                Reject
              </Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OutboundEmailPanel
// ---------------------------------------------------------------------------

type OutboundEmailPanelProps = {
  dealId: string;
  onCountChange?: (count: number) => void;
};

export default function OutboundEmailPanel({
  dealId,
  onCountChange,
}: OutboundEmailPanelProps) {
  const [data, setData] = useState<ApprovalQueueListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(
      `/api/approval-queue?deal_id=${encodeURIComponent(dealId)}&approval_type=outbound_email&status=pending`,
    )
      .then(async (res) => {
        const json = await res
          .json()
          .catch(() => { throw new Error(`Request failed (${res.status})`); }) as ApprovalQueueListResponse & { error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
        return json;
      })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          onCountChange?.(result.total);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load email drafts");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dealId, onCountChange]);

  useEffect(() => {
    const cancel = load();
    return cancel;
  }, [load]);

  const items = data?.items ?? [];

  return (
    <Card className="border-border/70 bg-card/95">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4 text-primary" />
              Outbound Email Drafts
            </CardTitle>
            <CardDescription>
              Agent-drafted emails awaiting your approval before sending.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => load()}
            disabled={loading}
          >
            <RefreshCcw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-3 animate-pulse" aria-label="Loading email drafts">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-border/50 bg-muted/30 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <div className="h-3.5 w-2/3 rounded bg-muted" />
                    <div className="h-2.5 w-1/3 rounded bg-muted/70" />
                  </div>
                  <div className="h-5 w-20 rounded-full bg-muted shrink-0" />
                </div>
                <div className="h-2.5 w-16 rounded bg-muted/50" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/50 px-4 py-6 text-center text-sm text-muted-foreground">
            <Mail className="mx-auto mb-2 size-5 opacity-40" />
            <p className="font-medium text-foreground/70">No pending email drafts</p>
            <p className="mt-1">
              When agents prepare outbound emails for this deal, they will appear
              here for your review before anything is sent.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <EmailDraftCard key={item.id} item={item} onRefresh={load} />
          ))
        )}
      </CardContent>
    </Card>
  );
}
