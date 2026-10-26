"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { PortalShell } from "@/components/app-shell";
import { RideMap, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { AssistantPanel } from "@/components/passenger/assistant-panel";
import { BookingPanel, type PlacePoint } from "@/components/passenger/booking-panel";
import { PASSENGER_NAV } from "@/components/passenger/nav";
import { TripDetailDialog } from "@/components/passenger/trip-detail-dialog";
import { FinishedPanel, TrackingPanel } from "@/components/passenger/tracking-panel";
import { TripHistory } from "@/components/trip-history";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fetcher } from "@/lib/api";
import { VEHICLE_COLOR } from "@/lib/format";
import { toTuple } from "@/lib/geo";
import { clearPrefill, readPrefill } from "@/lib/prefill";
import { useLiveInterval } from "@/lib/realtime";
import type { BookingSuggestion, Estimate, SavedPlace, Trip, VehicleType, Zone } from "@/lib/types";

const ROUTE_COLOR = "#e8e8e3";

function estimateFetcher([path, pickup, drop]: [string, PlacePoint, PlacePoint]) {
  return api<Estimate>(path, { json: { pickup: { lat: pickup.lat, lng: pickup.lng }, drop: { lat: drop.lat, lng: drop.lng } } });
}

function PassengerPortal() {
  const [tab, setTab] = useState("ride");
  // A booking handed over from the dashboard ("ride again", saved place, frequent destination).
  const [pickup, setPickup] = useState<PlacePoint | null>(() => readPrefill()?.pickup ?? null);
  const [drop, setDrop] = useState<PlacePoint | null>(() => readPrefill()?.drop ?? null);
  const [target, setTarget] = useState<"pickup" | "drop">(() => (readPrefill()?.pickup && !readPrefill()?.drop ? "drop" : "pickup"));
  const [vehicleType, setVehicleType] = useState<VehicleType>(() => readPrefill()?.vehicleType ?? "bike");
  const [booking, setBooking] = useState(false);
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const lastActive = useRef<string | null>(null);

  useEffect(() => clearPrefill(), []);

  const { data: zones = [] } = useSWR<Zone[]>("/api/zones", fetcher);
  const { data: places = [] } = useSWR<SavedPlace[]>("/api/passenger/places", fetcher);
  const { data: history, mutate: refreshHistory } = useSWR<Trip[]>(tab === "history" ? "/api/trips" : null, fetcher);
  // Pushed over the WebSocket; polling is only a fallback (fast while the socket is down).
  const interval = useLiveInterval(2000, 20000);
  const { data: active, mutate: refreshActive } = useSWR<Trip | null>("/api/trips/active", fetcher, {
    refreshInterval: interval,
    onSuccess: (trip) => {
      // The active trip just ended: keep showing it for the payment, receipt and rating.
      if (!trip && lastActive.current) setFinishedId(lastActive.current);
      lastActive.current = trip?.id ?? null;
    },
  });
  // Stays fresh through "trip.updated" events (e.g. when the rider confirms the cash).
  const { data: finished = null } = useSWR<Trip>(!active && finishedId ? `/api/trips/${finishedId}` : null, fetcher);

  const estimateKey = !active && pickup && drop ? (["/api/trips/estimate", pickup, drop] as const) : null;
  const {
    data: estimate,
    error: estimateError,
    isLoading: estimateLoading,
    isValidating,
  } = useSWR(estimateKey, estimateFetcher, { keepPreviousData: true, refreshInterval: 30000, revalidateOnFocus: false });

  function pick(which: "pickup" | "drop", p: PlacePoint) {
    if (which === "pickup") {
      setPickup(p);
      if (!drop) setTarget("drop");
    } else {
      setDrop(p);
    }
  }

  function onMapClick(p: { lat: number; lng: number }) {
    if (active || finished) return;
    const which = target;
    pick(which, { ...p, label: `Pinned ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`, pinned: true });
    // Replace the coordinates with a street-level name once reverse geocoding answers.
    api<{ label: string }>(`/api/geo/reverse?lat=${p.lat}&lng=${p.lng}`)
      .then(({ label }) => {
        const named = (cur: PlacePoint | null) => (cur && cur.pinned && cur.lat === p.lat && cur.lng === p.lng ? { ...cur, label, pinned: false } : cur);
        if (which === "pickup") setPickup(named);
        else setDrop(named);
      })
      .catch(() => undefined);
  }

  const describe = (p: PlacePoint | null, address: string | undefined) => (p?.pinned && address ? { ...p, label: `Pinned · ${address}` } : p);

  async function book() {
    if (!pickup || !drop) return;
    setBooking(true);
    try {
      const trip = await api<Trip>("/api/trips", {
        json: {
          pickup: { lat: pickup.lat, lng: pickup.lng },
          drop: { lat: drop.lat, lng: drop.lng },
          vehicle_type: vehicleType,
          // Unnamed pins are described by the backend; searched or named places keep their label.
          pickup_address: pickup.pinned ? undefined : pickup.label,
          drop_address: drop.pinned ? undefined : drop.label,
        },
      });
      await refreshActive(trip, { revalidate: false });
      lastActive.current = trip.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setBooking(false);
    }
  }

  function applySuggestion(b: BookingSuggestion) {
    setPickup({ ...b.pickup, label: b.pickup_zone });
    setDrop({ ...b.drop, label: b.drop_zone });
    setVehicleType(b.vehicle_type);
    setTab("ride");
  }

  function doneWithFinished() {
    setFinishedId(null);
    setPickup(null);
    setDrop(null);
    setTarget("pickup");
    void refreshHistory();
  }

  // ----- map layers -----
  const shown = active ?? finished;
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  let fitTo: [number, number][] = [];
  let fitKey = "none";

  if (shown) {
    markers.push({ id: "pickup", kind: "pickup", position: toTuple(shown.pickup), label: shown.pickup_address });
    markers.push({ id: "drop", kind: "drop", position: toTuple(shown.drop), label: shown.drop_address });
    lines.push({ id: "route", points: shown.route, color: ROUTE_COLOR });
    if (shown.status === "accepted") lines.push({ id: "approach", points: shown.approach, color: VEHICLE_COLOR[shown.vehicle_type], dashed: true, weight: 3 });
    const r = shown.rider;
    if (r?.lat != null && r.lng != null && shown.status !== "completed" && shown.status !== "cancelled") {
      markers.push({ id: "rider", kind: "rider", position: [r.lat, r.lng], vehicleType: r.vehicle?.vehicle_type, live: true, label: r.full_name });
    }
    fitTo = [toTuple(shown.pickup), toTuple(shown.drop), ...(shown.status === "accepted" ? shown.approach.slice(0, 1) : [])];
    fitKey = `${shown.id}-${shown.status === "accepted" ? "a" : "t"}`;
  } else {
    if (pickup) markers.push({ id: "pickup", kind: "pickup", position: toTuple(pickup), label: pickup.label });
    if (drop) markers.push({ id: "drop", kind: "drop", position: toTuple(drop), label: drop.label });
    if (estimate && pickup && drop) lines.push({ id: "route", points: estimate.route, color: ROUTE_COLOR });
    fitTo = [pickup, drop].filter(Boolean).map((p) => toTuple(p!));
    fitKey = `${pickup?.lat},${pickup?.lng}|${drop?.lat},${drop?.lng}`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
      <aside className="flex min-h-0 w-full flex-col border-t md:w-105 md:border-t-0 md:border-r">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b px-4 py-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ride">Ride</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="assistant">Assistant</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <TabsContent value="ride" className="mt-0">
              {active ? (
                <TrackingPanel trip={active} onChanged={() => void refreshActive()} />
              ) : finished ? (
                <FinishedPanel trip={finished} onDone={doneWithFinished} />
              ) : (
                <BookingPanel
                  zones={zones}
                  places={places}
                  pickup={describe(pickup, estimate?.pickup_address)}
                  drop={describe(drop, estimate?.drop_address)}
                  target={target}
                  onTarget={setTarget}
                  onPick={pick}
                  onSwap={() => {
                    setPickup(drop);
                    setDrop(pickup);
                  }}
                  estimate={estimate}
                  estimateLoading={estimateLoading || isValidating}
                  estimateError={estimateError instanceof Error ? estimateError.message : null}
                  vehicleType={vehicleType}
                  onVehicleType={setVehicleType}
                  onBook={book}
                  booking={booking}
                />
              )}
            </TabsContent>
            <TabsContent value="history" className="mt-0">
              <TripHistory trips={history} empty="No rides yet." onSelect={(t) => setOpenTrip(t.id)} />
            </TabsContent>
            <TabsContent value="assistant" className="mt-0 h-full">
              <AssistantPanel onUseBooking={applySuggestion} />
            </TabsContent>
          </div>
        </Tabs>
      </aside>
      <section className="relative h-[42dvh] shrink-0 md:h-auto md:flex-1">
        <RideMap markers={markers} lines={lines} fitTo={fitTo} fitKey={fitKey} onMapClick={onMapClick} />
        {!shown && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-500 -translate-x-1/2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
            Click the map to set the {target === "pickup" ? "pickup (A)" : "drop-off (B)"}
          </div>
        )}
      </section>
      <TripDetailDialog tripId={openTrip} onOpenChange={(open) => !open && setOpenTrip(null)} onChanged={() => void refreshHistory()} />
    </div>
  );
}

export default function UserPage() {
  return (
    <PortalShell role="user" nav={PASSENGER_NAV}>
      {() => <PassengerPortal />}
    </PortalShell>
  );
}
