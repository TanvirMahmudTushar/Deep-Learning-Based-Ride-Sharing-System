"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { formatTaka } from "@/lib/format";
import type { CancelReason, Trip } from "@/lib/types";

const REASONS: { value: CancelReason; label: string }[] = [
  { value: "changed_plans", label: "My plans changed" },
  { value: "wait_too_long", label: "Waiting too long" },
  { value: "rider_not_moving", label: "Rider isn't moving" },
  { value: "wrong_pickup", label: "Wrong pickup location" },
  { value: "found_other_ride", label: "Found another ride" },
  { value: "price_too_high", label: "Price too high" },
  { value: "other", label: "Something else" },
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

/** What cancelling now costs, with a live countdown to the end of free cancellation. */
export function CancelPolicy({ trip }: { trip: Trip }) {
  const until = trip.free_cancel_until ? Date.parse(trip.free_cancel_until) : null;
  const now = useNow(until != null);
  if (trip.status === "requested") return <p className="text-sm text-muted-foreground">No rider has accepted yet, so cancelling is free.</p>;
  if (until == null || trip.late_cancel_fee == null) return null;
  if (now < until) {
    return (
      <p className="text-sm text-muted-foreground">
        Free to cancel for <span className="font-medium text-foreground tabular-nums">{mmss(until - now)}</span> more. After that, a{" "}
        {formatTaka(trip.late_cancel_fee)} fee is added to your next ride.
      </p>
    );
  }
  return (
    <Alert>
      <AlertDescription>
        Your rider is already on the way, so a {formatTaka(trip.late_cancel_fee)} late-cancellation fee will be added to your next ride.
      </AlertDescription>
    </Alert>
  );
}

export function CancelDialog({ trip, open, onOpenChange, onCancelled }: { trip: Trip; open: boolean; onOpenChange: (open: boolean) => void; onCancelled: () => void }) {
  const [reason, setReason] = useState<CancelReason>("changed_plans");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const done = await api<Trip>(`/api/trips/${trip.id}/cancel`, { json: { reason, note } });
      toast(done.cancel_fee ? `Ride cancelled. ${formatTaka(done.cancel_fee)} will be added to your next ride.` : "Ride cancelled");
      onOpenChange(false);
      onCancelled();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cancel this ride?</DialogTitle>
          <DialogDescription>Telling us why helps us improve matching.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <CancelPolicy trip={trip} />
          <div className="space-y-2">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as CancelReason)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cancel-note">Anything to add? (optional)</Label>
            <Input id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep my ride
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void cancel()}>
            {busy && <Loader2 className="animate-spin" />} Cancel ride
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
