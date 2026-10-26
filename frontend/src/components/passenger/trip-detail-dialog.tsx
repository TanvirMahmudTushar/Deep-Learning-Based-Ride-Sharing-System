"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { Flag, RotateCcw, ShieldAlert } from "lucide-react";
import { RideMap } from "@/components/map/ride-map";
import { FareBreakdownView, PaymentStatus, RateForm, ReportForm } from "@/components/passenger/trip-parts";
import { RatingText, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatKm, formatMinutes, formatTaka } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import { setPrefill } from "@/lib/prefill";
import type { Trip } from "@/lib/types";

function Timeline({ trip }: { trip: Trip }) {
  const steps: [string, string | null][] = [
    ["Requested", trip.requested_at],
    ["Rider accepted", trip.accepted_at],
    ["Picked up", trip.started_at],
    [trip.status === "cancelled" ? "Cancelled" : "Arrived", trip.completed_at],
  ];
  return (
    <ol className="space-y-2 text-sm">
      {steps
        .filter(([, at]) => at)
        .map(([label, at]) => (
          <li key={label} className="flex items-center gap-3">
            <span className="size-1.5 rounded-full bg-muted-foreground" />
            <span className="flex-1 text-muted-foreground">{label}</span>
            <span className="tabular-nums">{formatDateTime(at)}</span>
          </li>
        ))}
    </ol>
  );
}

function Body({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const router = useRouter();
  const [reporting, setReporting] = useState(false);
  const ended = trip.status === "completed" || trip.status === "cancelled";

  function rideAgain() {
    setPrefill({
      pickup: { ...trip.pickup, label: trip.pickup_address },
      drop: { ...trip.drop, label: trip.drop_address },
      vehicleType: trip.vehicle_type,
    });
    router.push("/user");
  }

  return (
    <div className="space-y-5">
      <div className="h-52 overflow-hidden rounded-lg border">
        <RideMap
          lines={[{ id: "route", points: trip.route, color: "#e8e8e3" }]}
          markers={[
            { id: "a", kind: "pickup", position: toTuple(trip.pickup), label: trip.pickup_address },
            { id: "b", kind: "drop", position: toTuple(trip.drop), label: trip.drop_address },
          ]}
          fitTo={trip.route.length > 1 ? trip.route : [toTuple(trip.pickup), toTuple(trip.drop)]}
          fitKey={trip.id}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <TripStatusBadge status={trip.status} />
        <span className="flex items-center gap-3 text-sm">
          <VehicleTag type={trip.vehicle_type} />
          <span className="text-muted-foreground">{formatKm(trip.distance_km)}</span>
          {trip.actual_duration_min != null && <span className="text-muted-foreground">{formatMinutes(trip.actual_duration_min)}</span>}
        </span>
      </div>

      <div className="space-y-1.5 text-sm">
        <div className="flex gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" /> {trip.pickup_address}
        </div>
        <div className="flex gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full border-2 border-foreground" /> {trip.drop_address}
        </div>
      </div>

      {trip.cancel_reason && <p className="text-sm text-muted-foreground">{trip.cancel_reason}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Timeline</h3>
          <Timeline trip={trip} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">{trip.status === "completed" ? "Receipt" : "Quoted fare"}</h3>
          {trip.fare_breakdown ? (
            <FareBreakdownView breakdown={trip.fare_breakdown} />
          ) : (
            <p className="text-sm">{formatTaka(trip.fare_final ?? trip.fare_estimate)}</p>
          )}
        </div>
      </div>

      {trip.payment && <PaymentStatus payment={trip.payment} />}

      {trip.rider && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <div>
            <div className="font-medium">{trip.rider.full_name}</div>
            <div className="text-xs text-muted-foreground">
              {trip.rider.vehicle ? `${trip.rider.vehicle.model} · ${trip.rider.vehicle.plate_no}` : ""}
            </div>
          </div>
          <RatingText rating={trip.rider.rating} count={trip.rider.rating_count} />
        </div>
      )}

      {trip.status === "completed" &&
        (trip.rating == null ? (
          <RateForm tripId={trip.id} riderName={trip.rider?.full_name} onDone={onChanged} />
        ) : (
          <div className="text-sm">
            <span className="text-muted-foreground">You rated this ride </span>
            <RatingText rating={trip.rating} />
            {trip.rating_comment && <p className="mt-1 text-muted-foreground">“{trip.rating_comment}”</p>}
          </div>
        ))}

      {trip.has_alert && (
        <p className="flex items-center gap-2 text-sm text-amber-200">
          <ShieldAlert className="size-4" /> Our safety system reviewed this trip.
        </p>
      )}

      {reporting && <ReportForm tripId={trip.id} onDone={() => setReporting(false)} />}

      {ended && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={rideAgain}>
            <RotateCcw /> Ride again
          </Button>
          {!reporting && (
            <Button variant="outline" onClick={() => setReporting(true)}>
              <Flag /> Report a problem
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function TripDetailDialog({ tripId, onOpenChange, onChanged }: { tripId: string | null; onOpenChange: (open: boolean) => void; onChanged?: () => void }) {
  const { data: trip, mutate } = useSWR<Trip>(tripId ? `/api/trips/${tripId}` : null, fetcher);

  return (
    <Dialog open={!!tripId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Trip details</DialogTitle>
          <DialogDescription>{trip ? formatDateTime(trip.requested_at) : "Loading…"}</DialogDescription>
        </DialogHeader>
        {trip && trip.id === tripId ? (
          <Body
            trip={trip}
            onChanged={() => {
              void mutate();
              onChanged?.();
            }}
          />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-52" />
            <Skeleton className="h-24" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
