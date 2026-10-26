"use client";

import { Loader2, MapPin, MousePointerClick, TrendingUp, Users } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { VehicleIcon } from "@/components/ride-bits";
import { placeIcon } from "@/components/passenger/place-icon";
import { FareBreakdownView } from "@/components/passenger/trip-parts";
import { PlaceSearch } from "@/components/passenger/place-search";
import { cn } from "@/lib/utils";
import { formatKm, formatMinutes, formatTaka, VEHICLE_BLURB, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import type { Estimate, LatLng, SavedPlace, VehicleType, Zone } from "@/lib/types";

export interface PlacePoint extends LatLng {
  label: string;
  /** Set by a map click rather than an area pick. */
  pinned?: boolean;
}

interface Props {
  zones: Zone[];
  places: SavedPlace[];
  pickup: PlacePoint | null;
  drop: PlacePoint | null;
  target: "pickup" | "drop";
  onTarget: (t: "pickup" | "drop") => void;
  onPick: (which: "pickup" | "drop", p: PlacePoint) => void;
  onSwap: () => void;
  estimate: Estimate | undefined;
  estimateLoading: boolean;
  estimateError: string | null;
  vehicleType: VehicleType;
  onVehicleType: (v: VehicleType) => void;
  onBook: () => void;
  booking: boolean;
}

function PlaceField({
  which,
  point,
  zones,
  active,
  onTarget,
  onPick,
}: {
  which: "pickup" | "drop";
  point: PlacePoint | null;
  zones: Zone[];
  active: boolean;
  onTarget: () => void;
  onPick: (p: PlacePoint) => void;
}) {
  const zoneValue = zones.find((z) => point && z.lat === point.lat && z.lng === point.lng)?.id.toString() ?? "";
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-2.5 transition-colors",
        active ? "border-ring bg-accent/40" : "border-border",
      )}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
          which === "pickup" ? "bg-foreground text-background" : "border-2 border-foreground",
        )}
      >
        {which === "pickup" ? "A" : "B"}
      </span>
      <button type="button" onClick={onTarget} className="min-w-0 flex-1 text-left">
        <div className="text-xs text-muted-foreground">{which === "pickup" ? "Pickup" : "Drop-off"}</div>
        <div className={cn("truncate text-sm", !point && "text-muted-foreground")}>{point ? point.label : "Click the map or pick an area"}</div>
      </button>
      <Select
        value={zoneValue}
        onValueChange={(id) => {
          const z = zones.find((zz) => zz.id.toString() === id);
          if (z) onPick({ lat: z.lat, lng: z.lng, label: z.name });
        }}
      >
        <SelectTrigger size="sm" className="w-28 shrink-0" aria-label={`${which} area`}>
          <SelectValue placeholder="Area" />
        </SelectTrigger>
        <SelectContent>
          {zones.map((z) => (
            <SelectItem key={z.id} value={z.id.toString()}>
              {z.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BookingPanel(props: Props) {
  const { estimate, vehicleType } = props;
  const selected = estimate?.quotes.find((q) => q.vehicle_type === vehicleType);
  const ready = props.pickup && props.drop;

  return (
    <div className="space-y-4">
      <PlaceSearch target={props.target} onPick={props.onPick} />
      <div className="space-y-2">
        <PlaceField
          which="pickup"
          point={props.pickup}
          zones={props.zones}
          active={props.target === "pickup"}
          onTarget={() => props.onTarget("pickup")}
          onPick={(p) => props.onPick("pickup", p)}
        />
        <PlaceField
          which="drop"
          point={props.drop}
          zones={props.zones}
          active={props.target === "drop"}
          onTarget={() => props.onTarget("drop")}
          onPick={(p) => props.onPick("drop", p)}
        />
        {props.places.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Saved places">
            {props.places.map((pl) => {
              const Icon = placeIcon(pl.label);
              return (
                <button
                  key={pl.id}
                  type="button"
                  title={`Set ${props.target === "pickup" ? "pickup" : "drop-off"} to ${pl.address}`}
                  onClick={() => props.onPick(props.target, { lat: pl.lat, lng: pl.lng, label: pl.label })}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon className="size-3.5" /> {pl.label}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MousePointerClick className="size-3.5" /> Map clicks set the {props.target === "pickup" ? "pickup" : "drop-off"}
          </span>
          {ready && (
            <button type="button" className="underline-offset-4 hover:text-foreground hover:underline" onClick={props.onSwap}>
              Swap
            </button>
          )}
        </div>
      </div>

      {!ready && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <MapPin className="mx-auto mb-2 size-5" />
          Set a pickup and drop-off to see fares for bike, CNG and car.
        </div>
      )}

      {ready && props.estimateError && (
        <Alert variant="destructive">
          <AlertDescription>{props.estimateError}</AlertDescription>
        </Alert>
      )}

      {ready && !estimate && props.estimateLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-18" />
          ))}
        </div>
      )}

      {ready && estimate && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatKm(estimate.distance_km)} · {estimate.route_source === "osrm" ? "road route" : "approximate route"}
            </span>
            {props.estimateLoading && <Loader2 className="size-3.5 animate-spin" />}
          </div>
          <div className="space-y-2" role="radiogroup" aria-label="Vehicle type">
            {estimate.quotes.map((q) => {
              const isSelected = q.vehicle_type === vehicleType;
              const noRiders = q.nearest_pickup_eta_min == null;
              return (
                <button
                  key={q.vehicle_type}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => props.onVehicleType(q.vehicle_type)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                    isSelected ? "border-ring bg-accent/50" : "hover:bg-accent/30",
                  )}
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-lg"
                    style={{ background: `color-mix(in oklch, ${VEHICLE_COLOR[q.vehicle_type]} 22%, transparent)` }}
                  >
                    <VehicleIcon type={q.vehicle_type} className="size-5" style={{ color: VEHICLE_COLOR[q.vehicle_type] }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-medium">
                      {VEHICLE_LABEL[q.vehicle_type]}
                      {q.multiplier > 1 && (
                        <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 px-1.5 text-[10px] text-amber-200">
                          <TrendingUp className="size-3" /> {q.multiplier}x
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {noRiders ? "No riders nearby" : `Pickup in ${formatMinutes(q.nearest_pickup_eta_min)}`} · {formatMinutes(q.eta_min)} trip
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold tabular-nums">{formatTaka(q.fare)}</span>
                    {q.multiplier > 1 && <span className="block text-xs text-muted-foreground line-through">{formatTaka(q.base_fare)}</span>}
                  </span>
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="text-xs font-medium text-muted-foreground">Why this price</div>
              <p className="text-pretty">{selected.reason}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="size-3" /> Demand {selected.demand_level} · ~{selected.expected_requests} requests next hour
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" /> {selected.available_riders} {VEHICLE_LABEL[selected.vehicle_type]} riders nearby
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{VEHICLE_BLURB[selected.vehicle_type]}</p>
              <details className="group border-t pt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground select-none hover:text-foreground">Fare breakdown</summary>
                <FareBreakdownView breakdown={selected.breakdown} className="mt-2" />
              </details>
            </div>
          )}

          <Button size="lg" className="w-full" onClick={props.onBook} disabled={props.booking || !selected || selected.nearest_pickup_eta_min == null}>
            {props.booking && <Loader2 className="animate-spin" />}
            {selected?.nearest_pickup_eta_min == null
              ? `No ${selected ? VEHICLE_LABEL[selected.vehicle_type] : ""} riders available`
              : `Book ${VEHICLE_LABEL[vehicleType]} · ${formatTaka(selected.fare)}`}
          </Button>
        </>
      )}
    </div>
  );
}
