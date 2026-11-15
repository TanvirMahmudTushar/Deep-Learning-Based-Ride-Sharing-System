"use client";

import useSWR from "swr";
import { Phone } from "lucide-react";
import { ALERT_STATUS_STYLE, ALERT_TYPE_LABEL, AlertIcon, alertDetailText } from "@/components/admin/alerts-tab";
import { RideMap } from "@/components/map/ride-map";
import { RatingText, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatKm, formatMinutes, formatTaka } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import type { StaffTripDetail, Trip } from "@/lib/types";

const PAYMENT_LABEL: Record<string, string> = { pending: "Waiting for cash", collected: "Cash collected", disputed: "Disputed" };

function Timeline({ trip }: { trip: Trip }) {
  const steps: [string, string | null][] = [
    ["Requested", trip.requested_at],
    ["Rider accepted", trip.accepted_at],
    ["Rider arrived", trip.arrived_at],
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

function Body({ detail }: { detail: StaffTripDetail }) {
  const { trip, alerts } = detail;
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

      <div className="flex flex-wrap items-center justify-between gap-2">
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

      {trip.cancel_reason && (
        <p className="text-sm text-muted-foreground">
          {trip.cancelled_by ? `Cancelled by ${trip.cancelled_by === "user" ? "the passenger" : trip.cancelled_by === "rider" ? "the rider" : "the system"}: ` : ""}
          {trip.cancel_reason}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <div className="text-xs text-muted-foreground">Passenger</div>
          <div className="font-medium">{trip.passenger_name}</div>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
          <div className="text-xs text-muted-foreground">Rider</div>
          {trip.rider ? (
            <>
              <div className="font-medium">{trip.rider.full_name}</div>
              <div className="text-xs text-muted-foreground">{trip.rider.vehicle ? `${trip.rider.vehicle.model} · ${trip.rider.vehicle.plate_no}` : ""}</div>
              <a href={`tel:${trip.rider.phone}`} className="mt-1 inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline">
                <Phone className="size-3" /> {trip.rider.phone}
              </a>
            </>
          ) : (
            <div className="text-muted-foreground">No rider assigned</div>
          )}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Timeline</h3>
          <Timeline trip={trip} />
        </div>
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Fare and payment</h3>
          <p className="text-sm">{formatTaka(trip.fare_final ?? trip.fare_estimate)}</p>
          {trip.payment && <p className="text-sm text-muted-foreground">{PAYMENT_LABEL[trip.payment.status] ?? trip.payment.status}</p>}
          {trip.rating != null && (
            <div className="text-sm">
              <span className="text-muted-foreground">Passenger rated </span>
              <RatingText rating={trip.rating} />
              {trip.rating_comment && <p className="mt-1 text-muted-foreground">“{trip.rating_comment}”</p>}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Alerts on this trip</h3>
        {alerts.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="space-y-1 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium">
                  <AlertIcon type={a.alert_type} /> {ALERT_TYPE_LABEL[a.alert_type]}
                </span>
                <Badge variant="outline" className={ALERT_STATUS_STYLE[a.status]}>
                  {a.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{alertDetailText(a)}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateTime(a.created_at)}
                {a.assigned_to ? ` · ${a.assigned_to.name} is handling this` : ""}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** A trip as the support desk sees it. Leaves out commission, rider earnings and the passenger's phone number. */
export function StaffTripDialog({ tripId, onOpenChange }: { tripId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data } = useSWR<StaffTripDetail>(tripId ? `/api/admin/trips/${tripId}` : null, fetcher);

  return (
    <Dialog open={!!tripId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Trip details</DialogTitle>
          <DialogDescription>{data ? formatDateTime(data.trip.requested_at) : "Loading…"}</DialogDescription>
        </DialogHeader>
        {data && data.trip.id === tripId ? (
          <Body detail={data} />
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
