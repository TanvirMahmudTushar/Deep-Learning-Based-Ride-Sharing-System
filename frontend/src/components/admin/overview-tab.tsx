"use client";

import useSWR from "swr";
import { CloudRain, Sun } from "lucide-react";
import { LiveTrips } from "@/components/admin/live-trips";
import { Stat } from "@/components/ride-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatMinutes, formatPercent, formatTaka } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminStats } from "@/lib/types";

export function OverviewTab() {
  const { data: stats } = useSWR<AdminStats>("/api/admin/stats", fetcher, { refreshInterval: useLiveInterval(3000, 30000) });

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

      <LiveTrips />
    </div>
  );
}
