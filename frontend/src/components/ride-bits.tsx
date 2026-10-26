"use client";

import { Bike, Car, CarTaxiFront, Star } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import type { TripStatus, VehicleType } from "@/lib/types";

const ICONS = { bike: Bike, cng: CarTaxiFront, car: Car } as const;

export function VehicleIcon({ type, className, ...props }: { type: VehicleType } & ComponentProps<typeof Bike>) {
  const Icon = ICONS[type];
  return <Icon className={className} {...props} />;
}

/** Vehicle chip: colored dot carries identity, the text label is always present. */
export function VehicleTag({ type, className }: { type: VehicleType; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span className="size-2 rounded-full" style={{ background: VEHICLE_COLOR[type] }} aria-hidden />
      {VEHICLE_LABEL[type]}
    </span>
  );
}

const STATUS_STYLE: Record<TripStatus, string> = {
  requested: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  accepted: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  ongoing: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  completed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-red-400/30 bg-red-400/10 text-red-200",
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLE[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function RatingText({ rating, count }: { rating: number | null; count?: number }) {
  if (rating == null) return <span className="text-muted-foreground">New</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="size-3.5 fill-amber-300 text-amber-300" aria-hidden />
      {rating.toFixed(1)}
      {count != null && <span className="text-muted-foreground">({count})</span>}
    </span>
  );
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
