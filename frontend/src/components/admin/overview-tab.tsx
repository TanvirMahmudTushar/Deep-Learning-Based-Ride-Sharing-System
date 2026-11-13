"use client";

import useSWR from "swr";
import { useState } from "react";
import { CloudRain, LocateFixed, Sun, X } from "lucide-react";
import { RideMap, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { Stat, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatKm, formatMinutes, formatPercent, formatTaka, timeAgo, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminStats, LiveData, VehicleType } from "@/lib/types";

export function OverviewTab() {
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const statsInterval = useLiveInterval(3000, 30000);
  const { data: stats } = useSWR<AdminStats>("/api/admin/stats", fetcher, { refreshInterval: statsInterval });
  const { data: live } = useSWR<LiveData>("/api/admin/trips/live", fetcher, { refreshInterval: 2000 });
  const trips = live?.trips ?? [];
  const selectedTrip = trips.find((trip) => trip.id === selectedTripId);
  const selectedEta = selectedTrip?.status === "accepted"
    ? selectedTrip.live_eta_min ?? selectedTrip.pickup_eta_min ?? selectedTrip.predicted_eta_min
    : selectedTrip?.live_eta_min ?? selectedTrip?.predicted_eta_min;

  const markers: MapMarker[] = (live?.riders ?? []).map((r) => ({
    id: r.id,
    kind: "rider",
    position: [r.lat, r.lng],
    vehicleType: r.vehicle_type,
    busy: r.busy,
    live: r.busy,
    label: `${r.vehicle_type ? VEHICLE_LABEL[r.vehicle_type] : "Rider"} · ${r.busy ? "on a trip" : "available"}`,
  }));
  const visibleTrips = selectedTrip ? [selectedTrip] : trips;
  for (const trip of visibleTrips) {
    markers.push({ id: `${trip.id}-pickup`, kind: "pickup", position: toTuple(trip.pickup), label: trip.pickup_address });
    markers.push({ id: `${trip.id}-drop`, kind: "drop", position: toTuple(trip.drop), label: trip.drop_address });
    if (
      selectedTrip &&
      trip.rider?.lat != null &&
      trip.rider.lng != null &&
      !markers.some((marker) => marker.id === trip.rider?.id)
    ) {
      markers.push({
        id: trip.rider.id,
        kind: "rider",
        position: [trip.rider.lat, trip.rider.lng],
        vehicleType: trip.vehicle_type,
        busy: true,
        live: true,
        label: `${trip.rider.full_name} · current position`,
      });
    }
  }
  const lines: MapLine[] = selectedTrip
    ? [
        ...(selectedTrip.approach.length > 1
          ? [{ id: `${selectedTrip.id}-approach`, points: selectedTrip.approach, color: VEHICLE_COLOR[selectedTrip.vehicle_type], weight: 3, dashed: true }]
          : []),
        ...(selectedTrip.route.length > 1
          ? [{ id: `${selectedTrip.id}-route`, points: selectedTrip.route, color: VEHICLE_COLOR[selectedTrip.vehicle_type], weight: 5 }]
          : []),
        ...(selectedTrip.gps_trace.length > 1
          ? [{ id: `${selectedTrip.id}-trace`, points: selectedTrip.gps_trace, color: "#e879f9", weight: 4 }]
          : []),
      ]
    : trips.map((trip) => ({
        id: trip.id,
        points: trip.route,
        color: VEHICLE_COLOR[trip.vehicle_type],
        weight: 3,
        dashed: trip.status === "requested",
      }));
  const fitTo: [number, number][] = selectedTrip
    ? [
        ...selectedTrip.route,
        ...selectedTrip.approach,
        ...selectedTrip.gps_trace,
        toTuple(selectedTrip.pickup),
        toTuple(selectedTrip.drop),
      ]
    : [
        ...trips.flatMap((trip) => [...trip.route, ...trip.approach, toTuple(trip.pickup), toTuple(trip.drop)]),
        ...(live?.riders ?? []).map((rider) => [rider.lat, rider.lng] as [number, number]),
      ];
  return (
    <div className="space-y-4">
      {!stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Trips today" value={stats.trips_today} hint={`${stats.completed_today} completed`} />
          <Stat label="Active trips" value={stats.active_trips} hint={`${stats.busy_riders} of ${stats.online_riders} online riders busy`} />
          <Stat label="Revenue today" value={formatTaka(stats.revenue_today)} />
          <Stat
            label="Open safety alerts"
            value={stats.open_alerts}
            hint={stats.pending_riders ? `${stats.pending_riders} rider${stats.pending_riders > 1 ? "s" : ""} awaiting verification` : "No riders awaiting verification"}
          />
          <Stat
            label="Cancellation rate · 7 days"
            value={formatPercent(stats.cancel_rate_7d)}
            hint={`Rider ${formatPercent(stats.rider_cancel_rate_7d)} · Passenger ${formatPercent(stats.passenger_cancel_rate_7d)}`}
          />
          <Stat label="Avg pickup wait · 7 days" value={formatMinutes(stats.avg_pickup_wait_min_7d)} hint="Measured from request to rider arrival" />
          <Stat
            label="ETA error · 7 days"
            value={stats.eta_mae_min_7d == null ? "—" : `${stats.eta_mae_min_7d} min MAE`}
            hint={`RMSE ${stats.eta_rmse_min_7d == null ? "—" : `${stats.eta_rmse_min_7d} min`}`}
          />
          <Stat
            label="Weather · Dhaka"
            value={
              stats.weather ? (
                <span className="inline-flex items-center gap-2">
                  {stats.weather.raining ? <CloudRain className="size-5" /> : <Sun className="size-5" />}
                  {Math.round(stats.weather.temperature_c)}°C
                </span>
              ) : (
                "—"
              )
            }
            hint={stats.weather ? `${stats.weather.precipitation_mm} mm rain this hour` : "Open-Meteo unavailable"}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="overflow-hidden py-0">
          <div className="flex flex-wrap items-center gap-4 border-b px-4 py-3 text-sm">
            <span className="font-medium">Live map</span>
            {(["bike", "cng", "car"] as VehicleType[]).map((vt) => (
              <span key={vt} className="inline-flex items-center gap-1.5 text-muted-foreground">
                <VehicleTag type={vt} /> {stats?.online_by_type[vt] ?? 0} online
              </span>
            ))}
            <span className="text-xs text-muted-foreground">Pulsing dots are on a trip</span>
          </div>
          <div className="h-115">
            <RideMap markers={markers} lines={lines} fitTo={fitTo} fitKey={selectedTrip ? `trip-${selectedTrip.id}` : "all-trips"} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedTrip ? "Trip details" : "Active trips"}</CardTitle>
                <CardDescription>{selectedTrip ? `Requested ${formatDateTime(selectedTrip.requested_at)}` : "Live updates · select a trip to inspect"}</CardDescription>
              </div>
              {selectedTrip && (
                <Button variant="outline" size="sm" onClick={() => setSelectedTripId(null)}>
                  <X aria-hidden /> All trips
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="max-h-115 space-y-2 overflow-y-auto">
            {!selectedTrip && trips.length === 0 && <p className="text-sm text-muted-foreground">No active trips right now.</p>}
            {!selectedTrip && trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                aria-pressed={selectedTripId === trip.id}
                onClick={() => setSelectedTripId(trip.id)}
                className="w-full space-y-1.5 rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-2">
                  <VehicleTag type={trip.vehicle_type} />
                  <TripStatusBadge status={trip.status} />
                </div>
                <div className="truncate text-muted-foreground">
                  {trip.pickup_address} → {trip.drop_address}
                </div>
                <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
                  <span>{trip.rider?.full_name ?? "Matching…"} · {trip.passenger_name}</span>
                  <span>ETA {formatMinutes(trip.status === "accepted" ? trip.pickup_eta_min ?? trip.predicted_eta_min : trip.predicted_eta_min)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatTaka(trip.fare_final ?? trip.fare_estimate)}</span>
                  <span>{timeAgo(trip.requested_at)}</span>
                </div>
              </button>
            ))}
            {selectedTrip && (
              <div className="space-y-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <VehicleTag type={selectedTrip.vehicle_type} />
                  <TripStatusBadge status={selectedTrip.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
                  <div>
                    <div className="text-xs text-muted-foreground">Live ETA</div>
                    <div className="font-medium tabular-nums">{formatMinutes(selectedEta)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Fare</div>
                    <div className="font-medium tabular-nums">{formatTaka(selectedTrip.fare_final ?? selectedTrip.fare_estimate)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Distance</div>
                    <div className="font-medium tabular-nums">{formatKm(selectedTrip.distance_km)}</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="font-medium">Pickup</div>
                    <div className="text-muted-foreground">{selectedTrip.pickup_address}</div>
                    <div className="text-xs text-muted-foreground">{selectedTrip.pickup.lat.toFixed(5)}, {selectedTrip.pickup.lng.toFixed(5)}</div>
                  </div>
                  <div>
                    <div className="font-medium">Dropoff</div>
                    <div className="text-muted-foreground">{selectedTrip.drop_address}</div>
                    <div className="text-xs text-muted-foreground">{selectedTrip.drop.lat.toFixed(5)}, {selectedTrip.drop.lng.toFixed(5)}</div>
                  </div>
                </div>
                <div className="space-y-1 rounded-lg border p-3">
                  <div><span className="text-muted-foreground">Rider: </span>{selectedTrip.rider?.full_name ?? "Not assigned"}</div>
                  <div><span className="text-muted-foreground">Passenger: </span>{selectedTrip.passenger_name}</div>
                </div>
                <div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <LocateFixed className="size-4 shrink-0" aria-hidden />
                  {selectedTrip.gps_trace.length
                    ? `Showing ${selectedTrip.gps_trace.length} recorded GPS fix${selectedTrip.gps_trace.length === 1 ? "" : "es"}`
                    : "No GPS trace recorded yet"}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {selectedTrip.approach.length > 1 && <span>Dashed: rider approach</span>}
                  {selectedTrip.route.length > 1 && <span>Solid: planned route</span>}
                  {selectedTrip.gps_trace.length > 1 && <span className="text-fuchsia-300">Pink: GPS trace</span>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
