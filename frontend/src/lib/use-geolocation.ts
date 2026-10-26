"use client";

import { useEffect, useState } from "react";

export interface GeoFix {
  lat: number;
  lng: number;
  /** Radius of uncertainty in metres. */
  accuracy: number;
  /** km/h from the device, when it reports one. */
  speedKmh: number | null;
  at: number;
}

export type GeoStatus = "off" | "locating" | "active" | "denied" | "unavailable" | "unsupported";

const supported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

export function toFix(pos: GeolocationPosition): GeoFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    speedKmh: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : null,
    at: pos.timestamp,
  };
}

/** Continuous device location while `enabled`. Browsers require a secure context (https or localhost). */
export function useGeolocation(enabled: boolean): { status: GeoStatus; fix: GeoFix | null; error: string | null } {
  const [state, setState] = useState<{ status: GeoStatus; fix: GeoFix | null; error: string | null }>({ status: "locating", fix: null, error: null });

  useEffect(() => {
    if (!enabled || !supported()) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setState({ status: "active", fix: toFix(pos), error: null }),
      (err) => setState((s) => ({ ...s, status: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable", error: err.message })),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  if (!enabled) return { status: "off", fix: null, error: null };
  if (!supported()) return { status: "unsupported", fix: null, error: "This browser has no location support" };
  return state;
}

/** One-shot location for "use my location". */
export function getCurrentFix(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!supported()) return reject(new Error("This browser has no location support"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toFix(pos)),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "Location permission was denied" : "Could not get your location")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}
