import type { TripStatus, VehicleType } from "@/lib/types";

export const VEHICLE_LABEL: Record<VehicleType, string> = { bike: "Bike", cng: "CNG", car: "Car" };

export const VEHICLE_BLURB: Record<VehicleType, string> = {
  bike: "Fastest through traffic · 1 seat",
  cng: "Three-wheeler · up to 3 seats",
  car: "Air-conditioned · up to 4 seats",
};

/** Identity colors per vehicle type (validated categorical slots 1-3 for the dark surface). */
export const VEHICLE_COLOR: Record<VehicleType, string> = {
  bike: "#3987e5",
  cng: "#d95926",
  car: "#199e70",
};

export const STATUS_LABEL: Record<TripStatus, string> = {
  requested: "Finding rider",
  accepted: "Rider on the way",
  ongoing: "On trip",
  completed: "Completed",
  cancelled: "Cancelled",
};

const taka = new Intl.NumberFormat("en-BD", { maximumFractionDigits: 0 });

export function formatTaka(value: number | null | undefined): string {
  return value == null ? "—" : `৳${taka.format(value)}`;
}

export function formatMinutes(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value < 1) return "<1 min";
  if (value < 60) return `${Math.round(value)} min`;
  return `${Math.floor(value / 60)} h ${Math.round(value % 60)} min`;
}

export function formatKm(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)} km`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
