"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatKm, formatMinutes, formatTaka } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FareBreakdown, TripPayment } from "@/lib/types";

/** Receipt-style fare lines. Values are the ones stored at booking time. */
export function FareBreakdownView({ breakdown, className }: { breakdown: FareBreakdown; className?: string }) {
  const rows: [string, string, number][] = [
    ["Base fare", "", breakdown.base],
    ["Distance", `${formatKm(breakdown.distance_km)} × ৳${breakdown.per_km}`, breakdown.distance],
    ["Time", `${formatMinutes(breakdown.eta_min)} × ৳${breakdown.per_min}`, breakdown.time],
  ];
  return (
    <dl className={cn("space-y-1.5 text-sm", className)}>
      {rows.map(([label, hint, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            {label} {hint && <span className="text-xs">({hint})</span>}
          </dt>
          <dd className="tabular-nums">{formatTaka(value)}</dd>
        </div>
      ))}
      {breakdown.min_fare_applied && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Minimum fare applied</dt>
          <dd className="tabular-nums">{formatTaka(breakdown.min_fare)}</dd>
        </div>
      )}
      {breakdown.demand_surcharge > 0 && (
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Demand ({breakdown.multiplier}x)</dt>
          <dd className="tabular-nums">+{formatTaka(breakdown.demand_surcharge)}</dd>
        </div>
      )}
      <div className="flex justify-between gap-3 border-t pt-1.5 font-medium">
        <dt>Total</dt>
        <dd className="tabular-nums">{formatTaka(breakdown.total)}</dd>
      </div>
    </dl>
  );
}

const PAYMENT_TEXT: Record<TripPayment["status"], { label: string; className: string }> = {
  pending: { label: "Pay in cash to your rider", className: "border-amber-400/30 bg-amber-400/10 text-amber-100" },
  collected: { label: "Paid in cash", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" },
  disputed: { label: "Payment under review", className: "border-red-400/30 bg-red-400/10 text-red-100" },
};

export function PaymentStatus({ payment }: { payment: TripPayment }) {
  const t = PAYMENT_TEXT[payment.status];
  return (
    <div className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm", t.className)}>
      <span>{t.label}</span>
      <span className="font-semibold tabular-nums">{formatTaka(payment.amount)}</span>
    </div>
  );
}

export function RateForm({ tripId, riderName, onDone, onSkip }: { tripId: string; riderName?: string; onDone: () => void; onSkip?: () => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api(`/api/trips/${tripId}/rate`, { json: { stars, comment } });
      toast.success("Thanks for rating your ride");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save rating");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="text-sm font-medium">Rate {riderName ?? "your rider"}</div>
      <div className="flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} stars`} onClick={() => setStars(n)}>
            <Star className={cn("size-7 transition-colors", n <= stars ? "fill-amber-300 text-amber-300" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      <Textarea placeholder="Anything to add? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
      <div className="flex gap-2">
        {onSkip && (
          <Button variant="ghost" className="flex-1" onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button className="flex-1" disabled={stars === 0 || saving} onClick={submit}>
          {saving && <Loader2 className="animate-spin" />} Submit rating
        </Button>
      </div>
    </div>
  );
}

const CATEGORIES = [
  { value: "safety", label: "Safety concern" },
  { value: "driving", label: "Unsafe or poor driving" },
  { value: "rider_behaviour", label: "Rider behaviour" },
  { value: "fare", label: "Fare problem" },
  { value: "lost_item", label: "Lost item" },
  { value: "other", label: "Something else" },
];

export function ReportForm({ tripId, onDone }: { tripId: string; onDone: () => void }) {
  const [category, setCategory] = useState("safety");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      await api(`/api/trips/${tripId}/report`, { json: { category, note } });
      toast.success("Report sent. Our team will follow up.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send report");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-2">
        <Label>What went wrong?</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea placeholder="Tell us what happened" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      <Button className="w-full" disabled={note.trim().length < 3 || saving} onClick={submit}>
        {saving && <Loader2 className="animate-spin" />} Send report
      </Button>
    </div>
  );
}
