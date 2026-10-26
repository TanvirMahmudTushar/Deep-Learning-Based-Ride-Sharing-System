"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Leaflet touches `window` on import, so the map only renders in the browser.
export const RideMap = dynamic(() => import("./ride-map-inner"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

export type { MapCircle, MapLine, MapMarker, RideMapProps } from "./types";
