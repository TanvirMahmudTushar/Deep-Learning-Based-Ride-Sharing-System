"use client";

import type { VehicleType } from "@/lib/types";

/** Hands a booking ("ride again", a frequent destination) from the dashboard to the ride page. */
export interface BookingPrefill {
  pickup?: { lat: number; lng: number; label: string };
  drop?: { lat: number; lng: number; label: string };
  vehicleType?: VehicleType;
}

const KEY = "ride.prefill";

export function setPrefill(p: BookingPrefill) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

/** Read without removing, so it is safe inside useState initializers (which may run twice in dev). */
export function readPrefill(): BookingPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BookingPrefill) : null;
  } catch {
    return null;
  }
}

export function clearPrefill() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
