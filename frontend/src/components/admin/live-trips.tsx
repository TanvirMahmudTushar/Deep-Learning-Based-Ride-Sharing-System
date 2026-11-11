"use client";

import useSWR from "swr";
import { RideMap, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetcher } from "@/lib/api";
import { formatTaka, timeAgo, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import { useLiveInterval } from "@/lib/realtime";
import type { LiveData, VehicleType } from "@/lib/types";

/** Live map and active trip list, shared by the admin and support dashboards. */
export function LiveTrips() {
  const { data: live } = useSWR<LiveData>("/api/admin/trips/live", fetcher, { refreshInterval: useLiveInterval(3000, 30000) });

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
  const onlineCount = (vt: VehicleType) => live?.riders.filter((r) => r.vehicle_type === vt).length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-4 border-b px-4 py-3 text-sm">
          <span className="font-medium">Live map</span>
          {(["bike", "cng", "car"] as VehicleType[]).map((vt) => (
            <span key={vt} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <VehicleTag type={vt} /> {onlineCount(vt)} online
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
          <CardDescription>Updates automatically</CardDescription>
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
  );
}
