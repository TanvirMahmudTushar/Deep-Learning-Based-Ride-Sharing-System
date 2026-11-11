"use client";

import { useState } from "react";
import { CloudRain, MapPin, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatKm, timeAgo, VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiderDemandHints, RiderDemandZone } from "@/lib/types";

const DEMAND_BADGE: Record<RiderDemandZone["demand_level"], { label: string; className: string }> = {
  "very high": { label: "Very high", className: "border-orange-400/40 bg-orange-400/15 text-orange-200" },
  high: { label: "High", className: "border-amber-400/40 bg-amber-400/15 text-amber-200" },
  normal: { label: "Normal", className: "border-border bg-muted/60 text-muted-foreground" },
  low: { label: "Low", className: "border-border bg-muted/30 text-muted-foreground" },
};

export function demandCircleColor(level: RiderDemandZone["demand_level"]): string {
  switch (level) {
    case "very high":
      return "#f97316";
    case "high":
      return "#eab308";
    case "normal":
      return "#c3c2b7";
    default:
      return "#64748b";
  }
}

export function DemandHintsCard({
  hints,
  selectedZoneId,
  onSelectZone,
}: {
  hints: RiderDemandHints;
  selectedZoneId: number | null;
  onSelectZone: (zone: RiderDemandZone | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? hints.zones : hints.zones.slice(0, 3);

  if (hints.zones.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <TrendingUp className="size-4 shrink-0 text-amber-300" />
            <span>Demand hints · next hour</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Expected {VEHICLE_LABEL[hints.vehicle_type].toLowerCase()} requests
            {hints.generated_at ? ` · updated ${timeAgo(hints.generated_at)}` : ""}
          </p>
        </div>
        {hints.raining && (
          <Badge variant="outline" className="shrink-0 border-sky-400/30 bg-sky-400/10 text-[10px] text-sky-200">
            <CloudRain className="size-3" /> +15% rain
          </Badge>
        )}
      </div>

      <ul className="space-y-2">
        {visible.map((z) => {
          const badge = DEMAND_BADGE[z.demand_level];
          const selected = selectedZoneId === z.zone_id;
          return (
            <li key={z.zone_id}>
              <button
                type="button"
                onClick={() => onSelectZone(selected ? null : z)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected ? "border-amber-400/60 bg-amber-400/10" : "hover:bg-muted/50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{z.zone}</span>
                    {z.estimated_multiplier > 1 && (
                      <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-amber-200">
                        {z.estimated_multiplier.toFixed(1)}x
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">~{z.expected_requests.toFixed(1)} req/hr</span>
                    <span>·</span>
                    <span className="tabular-nums">
                      {z.free_riders} free {z.free_riders === 1 ? "rider" : "riders"}
                    </span>
                    {z.distance_km != null && (
                      <>
                        <span>·</span>
                        <span className="tabular-nums">{formatKm(z.distance_km)} away</span>
                      </>
                    )}
                  </div>
                </div>
                <Badge variant="outline" className={cn("shrink-0 text-[10px]", badge.className)}>
                  {badge.label}
                </Badge>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Tap an area to highlight it on the map</span>
        {hints.zones.length > 3 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show top 3" : `Show all ${hints.zones.length}`}
          </Button>
        )}
      </div>
    </div>
  );
}

