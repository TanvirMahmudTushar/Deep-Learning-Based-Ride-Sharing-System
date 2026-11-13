"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Heart } from "lucide-react";
import { RatingText, VehicleTag } from "@/components/ride-bits";
import { setRiderPreference, usePassengerRiders } from "@/components/passenger/rider-preference";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import type { PassengerRiderEntry } from "@/lib/types";

function RiderRow({ r, action, busy, onAction }: { r: PassengerRiderEntry; action: string; busy: boolean; onAction: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 font-medium">
          {r.name}
          {r.vehicle_type && <VehicleTag type={r.vehicle_type} className="text-xs font-normal" />}
        </div>
        <div className="text-xs text-muted-foreground">
          {[r.vehicle_model, r.trips_together ? `${r.trips_together} ${r.trips_together === 1 ? "ride" : "rides"} together` : null, r.last_trip_at ? `last ${formatDateTime(r.last_trip_at)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {r.reason && <div className="text-xs text-muted-foreground">Reason: {r.reason}</div>}
      </div>
      <div className="flex items-center gap-3">
        <RatingText rating={r.rating} />
        <Button size="sm" variant="outline" disabled={busy} onClick={onAction}>
          {action}
        </Button>
      </div>
    </div>
  );
}

/** Favourite and blocked riders, with remove and unblock. */
export function RidersTab() {
  const { data, mutate } = usePassengerRiders();
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(r: PassengerRiderEntry) {
    setBusy(r.rider_id);
    try {
      await setRiderPreference(r.rider_id, null);
      await mutate();
      toast.success(r.kind === "blocked" ? `${r.name} is unblocked` : `${r.name} removed from favourites`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update this rider");
    } finally {
      setBusy(null);
    }
  }

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Heart className="size-4 fill-rose-500 text-rose-500" /> Favourite riders
          </CardTitle>
          <CardDescription>When a favourite is nearby and free, they get your ride request first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.favourites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No favourites yet. After a ride, open it in Trips and tap &quot;Add to favourites&quot;.</p>
          ) : (
            data.favourites.map((r) => <RiderRow key={r.rider_id} r={r} action="Remove" busy={busy === r.rider_id} onAction={() => void remove(r)} />)
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="size-4" /> Blocked riders
          </CardTitle>
          <CardDescription>Blocked riders are never offered your rides. They aren&apos;t told.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.blocked.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven&apos;t blocked anyone.</p>
          ) : (
            data.blocked.map((r) => <RiderRow key={r.rider_id} r={r} action="Unblock" busy={busy === r.rider_id} onAction={() => void remove(r)} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
