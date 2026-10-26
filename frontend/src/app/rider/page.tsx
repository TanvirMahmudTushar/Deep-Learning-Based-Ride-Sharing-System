"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { FileWarning, Loader2, LocateFixed, LocateOff, MapPin } from "lucide-react";
import { PortalShell } from "@/components/app-shell";
import { RideMap, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { DocumentsPanel } from "@/components/rider/documents-panel";
import { EarningsPanel } from "@/components/rider/earnings-panel";
import { ActiveTripCard, CollectCard, OfferCard, run } from "@/components/rider/trip-cards";
import { RatingText, Stat, VehicleIcon, VehicleTag } from "@/components/ride-bits";
import { TripHistory } from "@/components/trip-history";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fetcher } from "@/lib/api";
import { formatPercent, formatTaka, VEHICLE_COLOR } from "@/lib/format";
import { haversineKm, toTuple } from "@/lib/geo";
import { useLiveInterval } from "@/lib/realtime";
import { useServerHealth } from "@/lib/server";
import { useGeolocation, type GeoFix } from "@/lib/use-geolocation";
import type { Offer, RiderMe, Trip } from "@/lib/types";

const ROUTE_COLOR = "#e8e8e3";
/** Send a fix when moved this far, or at least this often while standing still (keeps the rider "fresh"). */
const MIN_MOVE_M = 10;
const MIN_GAP_MS = 4000;
const HEARTBEAT_MS = 20000;

function sendFix(fix: GeoFix) {
  return api("/api/rider/location", { json: { lat: fix.lat, lng: fix.lng, speed_kmh: fix.speedKmh, accuracy_m: Math.round(fix.accuracy) } });
}

function GpsStatus({ status, fix, manual, onManual }: { status: string; fix: GeoFix | null; manual: boolean; onManual: (v: boolean) => void }) {
  const ok = !manual && status === "active" && fix;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
      <div className="flex min-w-0 items-center gap-2.5">
        {ok ? <LocateFixed className="size-4 shrink-0 text-emerald-300" /> : manual ? <MapPin className="size-4 shrink-0" /> : <LocateOff className="size-4 shrink-0 text-amber-300" />}
        <div className="min-w-0">
          <div className="font-medium">
            {manual
              ? "Manual position"
              : status === "active"
                ? "GPS on"
                : status === "locating"
                  ? "Finding your location…"
                  : status === "denied"
                    ? "Location permission denied"
                    : "GPS unavailable"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {manual
              ? "Click the map to set where you are"
              : ok
                ? `Accurate to about ${Math.round(fix.accuracy)} m`
                : status === "denied"
                  ? "Allow location for this site in your browser, or use manual position"
                  : "Location needs https (or localhost) and a device with GPS"}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">Manual</span>
        <Switch checked={manual} onCheckedChange={onManual} aria-label="Use manual position" />
      </div>
    </div>
  );
}

function RiderPortal() {
  const [tab, setTab] = useState("work");
  const [toggling, setToggling] = useState(false);
  const [manual, setManual] = useState(false);
  const interval = useLiveInterval(3000, 30000);
  const { data: health } = useServerHealth();
  const { data: me, mutate: refreshMe } = useSWR<RiderMe>("/api/rider/me", fetcher, { refreshInterval: interval });
  const { data: active, mutate: refreshActive } = useSWR<Trip | null>("/api/rider/active", fetcher, { refreshInterval: interval });
  const { data: offer, mutate: refreshOffer } = useSWR<Offer | null>(me?.is_online && !active ? "/api/rider/offer" : null, fetcher, {
    refreshInterval: interval,
  });
  const { data: toCollect, mutate: refreshCollect } = useSWR<Trip | null>("/api/rider/pending-payment", fetcher);
  const { data: history } = useSWR<Trip[]>(tab === "history" ? "/api/rider/trips" : null, fetcher);

  // ---- device GPS -------------------------------------------------------------------------
  const verified = me?.status === "verified";
  const gpsWanted = !!verified && !manual && !active?.auto_drive;
  const geo = useGeolocation(gpsWanted);
  const sharing = !!me && (me.is_online || !!active); // never track an offline rider
  const lastSent = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const latestFix = useRef<GeoFix | null>(null);

  useEffect(() => {
    latestFix.current = geo.fix;
    const fix = geo.fix;
    if (!sharing || !gpsWanted || !fix) return;
    const prev = lastSent.current;
    const now = Date.now();
    const moved = prev ? haversineKm(prev, fix) * 1000 : Infinity;
    if (prev && (now - prev.at < MIN_GAP_MS || (moved < MIN_MOVE_M && now - prev.at < HEARTBEAT_MS))) return;
    lastSent.current = { lat: fix.lat, lng: fix.lng, at: now };
    sendFix(fix).catch(() => undefined);
  }, [geo.fix, sharing, gpsWanted]);

  useEffect(() => {
    if (!sharing || !gpsWanted) return;
    const id = setInterval(() => {
      const fix = latestFix.current;
      if (!fix) return;
      lastSent.current = { lat: fix.lat, lng: fix.lng, at: Date.now() };
      sendFix(fix).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [sharing, gpsWanted]);

  const refreshAll = () => {
    void refreshMe();
    void refreshActive();
    void refreshOffer();
    void refreshCollect();
  };

  async function setOnline(online: boolean) {
    setToggling(true);
    const fix = geo.fix;
    const ok = await run(
      () => api("/api/rider/online", { json: { is_online: online, ...(online && fix && !manual ? { lat: fix.lat, lng: fix.lng } : {}) } }),
      online ? "You are online" : "You are offline",
    );
    if (ok && online && fix && !manual) {
      lastSent.current = { lat: fix.lat, lng: fix.lng, at: Date.now() };
      sendFix(fix).catch(() => undefined);
    }
    setToggling(false);
    refreshAll();
  }

  async function onMapClick(p: { lat: number; lng: number }) {
    if (!manual) {
      if (gpsWanted) toast("Your position comes from GPS. Turn on Manual to set it on the map.");
      return;
    }
    if (active?.auto_drive) return;
    const ok = await run(() => api("/api/rider/location", { json: { lat: p.lat, lng: p.lng } }));
    if (ok) refreshAll();
  }

  // ---- map ----------------------------------------------------------------------------------
  const position = !manual && geo.fix ? { lat: geo.fix.lat, lng: geo.fix.lng } : me?.lat != null && me.lng != null ? { lat: me.lat, lng: me.lng } : null;
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const shownTrip = active ?? offer?.trip ?? null;
  if (shownTrip) {
    markers.push({ id: "pickup", kind: "pickup", position: toTuple(shownTrip.pickup), label: shownTrip.pickup_address });
    markers.push({ id: "drop", kind: "drop", position: toTuple(shownTrip.drop), label: shownTrip.drop_address });
    lines.push({ id: "route", points: shownTrip.route, color: ROUTE_COLOR });
    if (active?.status === "accepted") lines.push({ id: "approach", points: active.approach, color: VEHICLE_COLOR[active.vehicle_type], dashed: true, weight: 3 });
  }
  if (position) markers.push({ id: "me", kind: "rider", position: toTuple(position), vehicleType: me?.vehicle?.vehicle_type, live: me?.is_online, label: "You" });
  const fitTo: [number, number][] = shownTrip
    ? [toTuple(shownTrip.pickup), toTuple(shownTrip.drop), ...(position ? [toTuple(position)] : [])]
    : position
      ? [toTuple(position)]
      : [];
  const fitKey = shownTrip ? `${shownTrip.id}-${shownTrip.status}` : position ? "me" : "none";
  const needsDocs = me && !me.is_simulated && !me.documents_ready;

  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
      <aside className="flex min-h-0 w-full flex-col border-t md:w-105 md:border-t-0 md:border-r">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b px-4 py-3">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="work">Work</TabsTrigger>
              <TabsTrigger value="earnings">Earnings</TabsTrigger>
              <TabsTrigger value="documents">
                Documents
                {needsDocs && <span className="ml-1 size-1.5 rounded-full bg-amber-400" />}
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <TabsContent value="work" className="mt-0 space-y-4">
              {!me && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
              {me && (
                <>
                  <div className="flex items-center gap-3 rounded-xl border p-4">
                    <span className="grid size-11 place-items-center rounded-full bg-muted">
                      {me.vehicle && <VehicleIcon type={me.vehicle.vehicle_type} className="size-5" style={{ color: VEHICLE_COLOR[me.vehicle.vehicle_type] }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{me.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{me.vehicle ? `${me.vehicle.model} · ${me.vehicle.plate_no}` : "No vehicle"}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Switch checked={me.is_online} disabled={toggling || !verified || !!active} onCheckedChange={setOnline} aria-label="Online" />
                      <span className="text-xs text-muted-foreground">{me.is_online ? "Online" : "Offline"}</span>
                    </div>
                  </div>

                  {me.status === "pending" && (
                    <Alert>
                      <FileWarning />
                      <AlertTitle>Waiting for verification</AlertTitle>
                      <AlertDescription>
                        {me.documents_ready
                          ? "Your documents are approved. An admin will verify your account shortly."
                          : `Upload and get these approved: ${me.missing_documents.join(", ")}.`}
                        {!me.documents_ready && (
                          <Button size="sm" variant="link" className="h-auto p-0" onClick={() => setTab("documents")}>
                            Go to documents
                          </Button>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  {me.status === "suspended" && (
                    <Alert variant="destructive">
                      <AlertTitle>Account suspended</AlertTitle>
                      <AlertDescription>Contact support to restore access.</AlertDescription>
                    </Alert>
                  )}
                  {verified && <GpsStatus status={geo.status} fix={geo.fix} manual={manual} onManual={setManual} />}

                  {toCollect && <CollectCard trip={toCollect} onDone={refreshAll} />}
                  {active && <ActiveTripCard trip={active} position={position} canAutoDrive={!!health?.simulator} onChanged={refreshAll} />}
                  {!active && offer && <OfferCard key={offer.trip.id} offer={offer} me={me} onDone={refreshAll} />}
                  {!active && !offer && me.is_online && (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Waiting for trip requests near you…
                    </div>
                  )}
                  {!me.is_online && verified && !active && (
                    <p className="text-sm text-muted-foreground">
                      Go online to receive requests for <VehicleTag type={me.vehicle?.vehicle_type ?? "bike"} className="inline-flex" /> rides.
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <Stat label="Earnings today" value={formatTaka(me.earnings_today)} hint="After commission" />
                    <Stat label="Trips completed" value={me.trips_completed} />
                    <Stat label="Rating" value={<RatingText rating={me.rating} count={me.rating_count} />} />
                    <Stat label="Cancel rate" value={formatPercent(me.cancel_rate)} hint="Lower rates rank you higher" />
                  </div>
                  {me.commission_due > 0 && (
                    <button type="button" onClick={() => setTab("earnings")} className="w-full text-left text-xs text-muted-foreground hover:text-foreground">
                      Commission owed to the platform: <span className="font-medium text-foreground">{formatTaka(me.commission_due)}</span>
                    </button>
                  )}
                </>
              )}
            </TabsContent>
            <TabsContent value="earnings" className="mt-0">
              <EarningsPanel />
            </TabsContent>
            <TabsContent value="documents" className="mt-0">
              <DocumentsPanel />
            </TabsContent>
            <TabsContent value="history" className="mt-0">
              <TripHistory trips={history} empty="No trips yet." />
            </TabsContent>
          </div>
        </Tabs>
      </aside>
      <section className="relative h-[42dvh] shrink-0 md:h-auto md:flex-1">
        <RideMap markers={markers} lines={lines} fitTo={fitTo} fitKey={fitKey} onMapClick={onMapClick} />
        {me && (manual || !position) && (
          <div className="pointer-events-none absolute top-3 left-1/2 z-500 -translate-x-1/2">
            <Badge variant="outline" className="bg-background/90 backdrop-blur">
              {manual ? "Click the map to set your position" : "Waiting for GPS…"}
            </Badge>
          </div>
        )}
      </section>
    </div>
  );
}

export default function RiderPage() {
  return <PortalShell role="rider">{() => <RiderPortal />}</PortalShell>;
}
