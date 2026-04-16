"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SubmitDealRequest, SubmitDealResponse } from "@/app/api/submit-deal/route";

const PROPERTY_TYPES = [
  "residential",
  "commercial",
  "industrial",
  "mixed_use",
  "land",
  "other",
];

const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

type FormState = {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  property_type: string;
  price_text: string;
  land_area: string;
  url: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  address: "",
  suburb: "",
  state: "",
  postcode: "",
  property_type: "",
  price_text: "",
  land_area: "",
  url: "",
  notes: "",
};

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-border/70 bg-background px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20 disabled:opacity-50";

export default function NewDealPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitDealResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.address.trim()) return;

    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const payload: SubmitDealRequest = { address: form.address.trim() };
      if (form.suburb.trim()) payload.suburb = form.suburb.trim();
      if (form.state) payload.state = form.state;
      if (form.postcode.trim()) payload.postcode = form.postcode.trim();
      if (form.property_type) payload.property_type = form.property_type;
      if (form.price_text.trim()) payload.price_text = form.price_text.trim();
      if (form.land_area.trim()) {
        const n = Number(form.land_area.trim());
        if (Number.isFinite(n) && n > 0) payload.land_area = n;
      }
      if (form.url.trim()) payload.url = form.url.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();

      const res = await fetch("/api/submit-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = (await res.json()) as SubmitDealResponse;
      setResult(json);

      if (!json.success || json.error) {
        setError(json.error ?? "Submission failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  const succeeded = result?.success && result.deal_id;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,_#f6f4eb_0%,_#f2efe6_32%,_#ece8de_100%)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10 sm:px-10">

        {/* Header */}
        <section className="overflow-hidden rounded-[28px] border border-border/70 bg-[radial-gradient(circle_at_top_left,_rgba(205,220,57,0.22),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.96),_rgba(244,241,233,0.92))] p-6 shadow-[0_24px_80px_-48px_rgba(48,57,36,0.55)] sm:p-8">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background/80 px-2.5 text-sm font-medium hover:bg-muted"
              >
                <ArrowLeft className="size-4" />
                Dashboard
              </Link>
              <Badge variant="outline" className="bg-background/70">Manual Intake</Badge>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="mt-1 size-6 shrink-0 text-primary" />
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Submit New Deal
                </h1>
                <p className="mt-1 text-base leading-7 text-muted-foreground">
                  Enter a property address to kick off site discovery, planning intelligence, and feasibility analysis.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Success state */}
        {succeeded ? (
          <Card className="border-green-200 bg-green-50/60">
            <CardContent className="space-y-4 py-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
                <div className="space-y-1">
                  <p className="font-semibold text-green-900">Deal submitted successfully</p>
                  <p className="text-sm text-green-800">{result?.address}</p>
                  {result?.message ? (
                    <p className="text-sm text-green-700">{result.message}</p>
                  ) : null}
                  {result?.warnings && result.warnings.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {result.warnings.map((w, i) => (
                        <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {result?.deal_id ? (
                  <Button
                    size="sm"
                    onClick={() => router.push(`/deal/${result.deal_id}`)}
                  >
                    Open deal workspace
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setResult(null); setError(null); setForm(EMPTY_FORM); }}
                >
                  Submit another
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push("/")}>
                  Back to feed
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle>Property Details</CardTitle>
              <CardDescription>
                Only the street address is required. Additional details improve geocoding and initial analysis accuracy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">

                {/* Address — required */}
                <Field label="Street address" required hint="Full street address including number and street name.">
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="e.g. 42 Smith Street, Surry Hills NSW 2010"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                    disabled={submitting}
                    required
                  />
                </Field>

                {/* Suburb / State / Postcode */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Suburb">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="Surry Hills"
                      value={form.suburb}
                      onChange={(e) => set("suburb", e.target.value)}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="State">
                    <select
                      className={inputClass}
                      value={form.state}
                      onChange={(e) => set("state", e.target.value)}
                      disabled={submitting}
                    >
                      <option value="">Select…</option>
                      {AU_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Postcode">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="2010"
                      value={form.postcode}
                      onChange={(e) => set("postcode", e.target.value)}
                      disabled={submitting}
                      maxLength={4}
                    />
                  </Field>
                </div>

                {/* Property type + asking price */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Property type">
                    <select
                      className={inputClass}
                      value={form.property_type}
                      onChange={(e) => set("property_type", e.target.value)}
                      disabled={submitting}
                    >
                      <option value="">Select…</option>
                      {PROPERTY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Asking / indicative price" hint="Free-text, e.g. '$2.5M' or 'EOI'.">
                    <input
                      type="text"
                      className={inputClass}
                      placeholder="e.g. $2,500,000"
                      value={form.price_text}
                      onChange={(e) => set("price_text", e.target.value)}
                      disabled={submitting}
                    />
                  </Field>
                </div>

                {/* Land area + listing URL */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Land area (m²)">
                    <input
                      type="number"
                      className={inputClass}
                      placeholder="e.g. 650"
                      value={form.land_area}
                      onChange={(e) => set("land_area", e.target.value)}
                      disabled={submitting}
                      min={0}
                    />
                  </Field>
                  <Field label="Listing URL" hint="Domain, REA, or any external link.">
                    <input
                      type="url"
                      className={inputClass}
                      placeholder="https://…"
                      value={form.url}
                      onChange={(e) => set("url", e.target.value)}
                      disabled={submitting}
                    />
                  </Field>
                </div>

                {/* Notes */}
                <Field label="Notes" hint="Any additional context — agent comments, deal source, access constraints, etc.">
                  <textarea
                    className={`${inputClass} resize-none`}
                    rows={3}
                    placeholder="e.g. Off-market opportunity, vendor wants quick settlement…"
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    disabled={submitting}
                  />
                </Field>

                {/* Error */}
                {error ? (
                  <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {/* Submit */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    type="submit"
                    disabled={submitting || !form.address.trim()}
                    className="min-w-[140px]"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      "Submit deal"
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    This will trigger geocoding, planning intelligence, and feasibility analysis automatically.
                  </p>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

      </div>
    </main>
  );
}
