import type { VehicleType } from "@/lib/types";

export interface MapMarker {
  id: string;
  position: [number, number];
  /** "place" is a saved place: a neutral pin showing the label's first letter. */
  kind: "pickup" | "drop" | "rider" | "place";
  vehicleType?: VehicleType | null;
  busy?: boolean;
  /** The rider being tracked: larger dot with a pulse. */
  live?: boolean;
  label?: string;
  onClick?: () => void;
}

export interface MapLine {
  id: string;
  points: [number, number][];
  color: string;
  dashed?: boolean;
  weight?: number;
}

export interface MapCircle {
  id: string;
  center: [number, number];
  radius: number;
  color: string;
  label?: string;
}

export interface RideMapProps {
  markers?: MapMarker[];
  lines?: MapLine[];
  circles?: MapCircle[];
  /** Points to fit the view to; refit happens when `fitKey` changes. */
  fitTo?: [number, number][];
  fitKey?: string;
  onMapClick?: (p: { lat: number; lng: number }) => void;
  className?: string;
}
