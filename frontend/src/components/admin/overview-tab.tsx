"use client";

import useSWR from "swr";
import { CloudRain, Sun } from "lucide-react";
import { RideMap, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { Stat, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatMinutes, formatPercent, formatTaka, timeAgo, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminStats, LiveData, VehicleType } from "@/lib/types";

export function OverviewTab() {
  const interval = useLiveInterval(3000, 30000);
  const { data: stats } = useSWR<AdminStats>("/api/admin/stats", fetcher, { refreshInterval: interval });
  const { data: live } = useSWR<LiveData>("/api/admin/trips/live", fetcher, { refreshInterval: interval });

  const markers: MapMarker[] = (live?.riders ?? []).map((r) => ({
    id: r.id,
    kind: "rider",
    position: [r.lat, r.lng],
    vehicleType: r.vehicle_type,
    busy: false,
    live: r.busy,
    label: `${r.vehicle_type ? VEHICLE_LABEL[r.vehicle_type] : "Rider"} · ${r.busy ? "on a trip" : "available"}`,
  }));
  const lines: MapLine[] = (live?.trips ?? []).map((t) => ({
    id: t.id,
    points: t.route,
    color: VEHICLE_COLOR[t.vehicle_type],
    weight: 3,
    dashed: t.status === "requested",
  }));
  for (const t of live?.trips ?? []) {
    markers.push({ id: `${t.id}-drop`, kind: "drop", position: toTuple(t.drop), label: t.drop_address });
  }

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
          <Stat label="Cancellation rate · 7 days" value={formatPercent(stats.cancel_rate_7d)} hint={`${formatPercent(stats.rider_cancel_rate_7d)} by riders`} />
          <Stat label="Avg pickup wait · 7 days" value={formatMinutes(stats.avg_pickup_wait_min_7d)} />
          <Stat label="ETA error (MAE) · 7 days" value={stats.eta_mae_min_7d == null ? "—" : `${stats.eta_mae_min_7d} min`} hint="Baseline model; DL target is lower" />
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
            <RideMap markers={markers} lines={lines} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active trips</CardTitle>
            <CardDescription>Live via WebSocket</CardDescription>
          </CardHeader>
          <CardContent className="max-h-115 space-y-2 overflow-y-auto">
            {live?.trips.length === 0 && <p className="text-sm text-muted-foreground">No active trips right now.</p>}
            {live?.trips.map((t) => (
              <div key={t.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <VehicleTag type={t.vehicle_type} />
                  <TripStatusBadge status={t.status} />
                </div>
                <div className="truncate text-muted-foreground">
                  {t.pickup_address} → {t.drop_address}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.rider?.full_name ?? "Matching…"}</span>
                  <span>
                    {formatTaka(t.fare_estimate)} · {timeAgo(t.requested_at)}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
