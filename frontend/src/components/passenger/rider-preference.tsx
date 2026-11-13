"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Ban, Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, fetcher } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PassengerRiders, RiderPreferenceKind } from "@/lib/types";

export const RIDERS_KEY = "/api/passenger/riders";

/** The passenger's favourite and blocked riders, shared by every place that shows them. */
export function usePassengerRiders() {
  return useSWR<PassengerRiders>(RIDERS_KEY, fetcher);
}

export async function setRiderPreference(riderId: string, kind: RiderPreferenceKind | null, reason = "") {
  if (kind === null) await api(`${RIDERS_KEY}/${riderId}`, { method: "DELETE" });
  else await api(`${RIDERS_KEY}/${riderId}`, { method: "PUT", json: { kind, reason } });
}

/**
 * Favourite and block buttons for the rider of a finished trip. `canFavourite` is false for a
 * cancelled trip: a favourite needs a completed ride, but a rider who cancelled can still be blocked.
 */
export function RiderPreferenceControls({ riderId, riderName, canFavourite }: { riderId: string; riderName: string; canFavourite: boolean }) {
  const { data, mutate } = usePassengerRiders();
  const [busy, setBusy] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState("");
  const first = riderName.split(" ")[0];
  const current: RiderPreferenceKind | null = data?.favourites.some((r) => r.rider_id === riderId)
    ? "favourite"
    : data?.blocked.some((r) => r.rider_id === riderId)
      ? "blocked"
      : null;

  async function change(kind: RiderPreferenceKind | null, why = "") {
    setBusy(true);
    try {
      await setRiderPreference(riderId, kind, why);
      await mutate();
      toast.success(
        kind === "favourite"
          ? `${first} is a favourite. They'll get your requests first when they're nearby.`
          : kind === "blocked"
            ? `${first} is blocked. They won't be offered your rides again.`
            : current === "blocked"
              ? `${first} is unblocked`
              : `${first} removed from favourites`,
      );
      setBlockOpen(false);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update this rider");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  if (current === "blocked") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
        <span className="text-muted-foreground">You blocked {first}. They won&apos;t be offered your rides.</span>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void change(null)}>
          Unblock
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canFavourite && (
          <Button
            size="sm"
            variant={current === "favourite" ? "secondary" : "outline"}
            disabled={busy}
            aria-pressed={current === "favourite"}
            onClick={() => void change(current === "favourite" ? null : "favourite")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Heart className={cn(current === "favourite" && "fill-rose-500 text-rose-500")} />}
            {current === "favourite" ? "Favourite rider" : `Add ${first} to favourites`}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => setBlockOpen(true)}>
          <Ban /> Block {first}
        </Button>
      </div>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Block {first}?</DialogTitle>
            <DialogDescription>
              {first} won&apos;t be offered your rides again. They aren&apos;t told. You can unblock them any time from Riders in your dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="block-reason">Reason (optional, only you and our team see it)</Label>
            <Input id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void change("blocked", reason)}>
              {busy && <Loader2 className="animate-spin" />} Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
