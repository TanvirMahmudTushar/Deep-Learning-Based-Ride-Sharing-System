"use client";

import { ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingText, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { formatDateTime, formatKm, formatTaka } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Trip } from "@/lib/types";

export function TripHistory({ trips, empty, onSelect }: { trips: Trip[] | undefined; empty: string; onSelect?: (trip: Trip) => void }) {
  if (!trips) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  if (trips.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul className="space-y-2">
      {trips.map((t) => (
        <li
          key={t.id}
          className={cn("space-y-2 rounded-lg border p-3 text-sm", onSelect && "cursor-pointer transition-colors hover:bg-accent/30")}
          onClick={onSelect ? () => onSelect(t) : undefined}
          onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && onSelect(t) : undefined}
          tabIndex={onSelect ? 0 : undefined}
          role={onSelect ? "button" : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{formatDateTime(t.requested_at)}</span>
            <TripStatusBadge status={t.status} />
          </div>
          <div className="truncate">
            {t.pickup_address} <span className="text-muted-foreground">→</span> {t.drop_address}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-3">
              <VehicleTag type={t.vehicle_type} className="text-xs" />
              {formatKm(t.distance_km)}
              {t.rating != null && <RatingText rating={t.rating} />}
              {t.has_alert && (
                <span className="inline-flex items-center gap-1 text-amber-300">
                  <ShieldAlert className="size-3.5" /> Alert
                </span>
              )}
            </span>
            <span className="font-medium text-foreground tabular-nums">{formatTaka(t.fare_final ?? t.fare_estimate)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
