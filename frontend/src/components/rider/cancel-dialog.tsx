"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RiderCancelReason, Trip } from "@/lib/types";

const NO_SHOW_WAIT_MS = 300_000;

const RIDER_REASONS: { value: RiderCancelReason; label: string }[] = [
  { value: "passenger_no_show", label: "Passenger didn't show up" },
  { value: "unreachable_pickup", label: "Pickup location unreachable" },
  { value: "vehicle_issue", label: "Vehicle issue" },
  { value: "safety_concern", label: "Safety concern" },
  { value: "too_many_passengers", label: "Too many passengers / luggage" },
  { value: "other", label: "Other reason" },
];

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RiderCancelDialog({
  trip,
  open,
  onOpenChange,
  onCancelled,
}: {
  trip: Trip;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState<RiderCancelReason>(trip.arrived_at ? "passenger_no_show" : "unreachable_pickup");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const arrivedAtMs = trip.arrived_at ? Date.parse(trip.arrived_at) : null;
  const now = useNow(open && arrivedAtMs != null);
  const remainingMs = arrivedAtMs != null ? Math.max(0, arrivedAtMs + NO_SHOW_WAIT_MS - now) : NO_SHOW_WAIT_MS;
  const noShowPenaltyFree = arrivedAtMs != null && remainingMs === 0;

  async function submitCancel() {
    setBusy(true);
    try {
      await api(`/api/rider/trips/${trip.id}/cancel`, { json: { reason, note } });
      toast.success("Trip cancelled");
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel trip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this trip?</DialogTitle>
          <DialogDescription>Select a reason so we can keep matching fair.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          {arrivedAtMs == null ? (
            <p className="text-xs text-muted-foreground">
              Arrive at pickup and wait 5:00 for a penalty-free passenger no-show cancellation.
            </p>
          ) : remainingMs > 0 ? (
            <Alert>
              <AlertDescription className="text-xs">
                Wait <span className="font-semibold text-foreground tabular-nums">{mmss(remainingMs)}</span> more at pickup for a penalty-free no-show cancellation.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
              5:00 wait complete — passenger no-show will not affect your cancel rate.
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reason</Label>
            <div className="grid gap-1.5">
              {RIDER_REASONS.map((r) => {
                const selected = reason === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                      selected ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span>{r.label}</span>
                    {r.value === "passenger_no_show" && noShowPenaltyFree && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Penalty-free
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rider-cancel-note">Note (optional)</Label>
            <Input
              id="rider-cancel-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={120}
              placeholder="Optional details…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep trip
          </Button>
          <Button variant="destructive" onClick={() => void submitCancel()} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Confirm cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
