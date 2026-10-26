"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { VEHICLE_COLOR } from "@/lib/format";
import type { RideMapProps } from "./types";

const DHAKA: [number, number] = [23.7808, 90.4093];

const pinIcon = (kind: "pickup" | "drop" | "place", text: string) =>
  L.divIcon({
    className: "",
    html: `<div class="map-pin map-pin-${kind}" style="width:26px;height:26px">${text}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

const placeInitial = (label?: string) => {
  const ch = label?.trim()[0]?.toUpperCase() ?? "";
  return /[A-Z0-9]/.test(ch) ? ch : "•";
};

const riderIcon = (color: string, busy: boolean, live: boolean) => {
  const size = live ? 20 : 14;
  return L.divIcon({
    className: "",
    html: `<div class="map-rider ${busy ? "map-rider-busy" : ""} ${live ? "map-rider-live" : ""}" style="position:relative;background:${color};color:${color};width:${size}px;height:${size}px"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

function FitBounds({ points, fitKey }: { points: [number, number][]; fitKey?: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 14));
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
    // Refit only when the key changes, not on every live position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (p: { lat: number; lng: number }) => void }) {
  useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function RideMapInner({ markers = [], lines = [], circles = [], fitTo, fitKey, onMapClick, className }: RideMapProps) {
  const icons = useMemo(
    () =>
      markers.map((m) =>
        m.kind === "rider"
          ? riderIcon(m.vehicleType ? VEHICLE_COLOR[m.vehicleType] : "#aaa", !!m.busy, !!m.live)
          : m.kind === "place"
            ? pinIcon("place", placeInitial(m.label))
            : pinIcon(m.kind, m.kind === "pickup" ? "A" : "B"),
      ),
    [markers],
  );

  // Next.js hides routes with <Activity> instead of unmounting them. Hiding runs react-leaflet's
  // cleanup (map.remove()) but keeps its state, so on return it would draw into a destroyed map.
  // Bumping the key while hidden makes the page come back with a fresh MapContainer.
  const [generation, setGeneration] = useState(0);
  useLayoutEffect(() => () => setGeneration((g) => g + 1), []);

  return (
    <MapContainer
      key={generation}
      center={DHAKA}
      zoom={12}
      className={className}
      style={{ height: "100%", width: "100%" }}
      zoomControl
      attributionControl
    >
      {/* Standard OSM tiles (no API key), darkened in CSS via .map-tiles-dark. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="map-tiles-dark"
        maxZoom={19}
      />
      {circles.map((c) => (
        <CircleMarker
          key={c.id}
          center={c.center}
          radius={c.radius}
          pathOptions={{ color: c.color, weight: 2, fillColor: c.color, fillOpacity: 0.28 }}
        >
          {c.label && <Tooltip direction="top">{c.label}</Tooltip>}
        </CircleMarker>
      ))}
      {lines.map((l) =>
        l.points.length > 1 ? (
          <Polyline
            key={l.id}
            positions={l.points}
            pathOptions={{ color: l.color, weight: l.weight ?? 4, opacity: 0.9, dashArray: l.dashed ? "6 8" : undefined, lineCap: "round" }}
          />
        ) : null,
      )}
      {markers.map((m, i) => (
        <Marker key={m.id} position={m.position} icon={icons[i]} eventHandlers={m.onClick ? { click: m.onClick } : undefined}>
          {m.label && <Tooltip direction="top" offset={[0, -10]}>{m.label}</Tooltip>}
        </Marker>
      ))}
      {fitTo && <FitBounds points={fitTo} fitKey={fitKey} />}
      {onMapClick && <ClickHandler onClick={onMapClick} />}
    </MapContainer>
  );
}
