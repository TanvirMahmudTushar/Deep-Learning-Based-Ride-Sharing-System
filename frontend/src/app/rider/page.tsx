"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { FileCheck2, FileWarning, Loader2, LocateFixed, LocateOff, Lock, MapPin, RefreshCw, ShieldAlert } from "lucide-react";
import { PortalShell } from "@/components/app-shell";
import { RideMap, type MapCircle, type MapLine, type MapMarker } from "@/components/map/ride-map";
import { BottomSheet } from "@/components/rider/bottom-sheet";
import { AvailabilityToggle } from "@/components/rider/availability-toggle";
import { DemandHintsCard, demandCircleColor } from "@/components/rider/demand-hints-card";
import { OPEN_PROFILE_EVENT } from "@/components/rider/rider-profile";
import { ActiveTripCard, CollectCard, OfferCard, run } from "@/components/rider/trip-cards";
import { Stat, VehicleIcon, VehicleTag } from "@/components/ride-bits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SPRING_BOUNCY, SPRING_UI } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { api, fetcher } from "@/lib/api";
import { formatTaka, VEHICLE_COLOR, plural } from "@/lib/format";
import { haversineKm, toTuple } from "@/lib/geo";
import { useLiveInterval } from "@/lib/realtime";
import { useServerHealth } from "@/lib/server";
import { useGeolocation, type GeoFix } from "@/lib/use-geolocation";
import type { Offer, RiderDemandHints, RiderDemandZone, RiderMe, Trip } from "@/lib/types";

const ROUTE_COLOR = "#e8e8e3";
/** Send a fix when moved this far, or at least this often while standing still (keeps the rider "fresh"). */
const MIN_MOVE_M = 10;
const MIN_GAP_MS = 4000;
const HEARTBEAT_MS = 20000;

function sendFix(fix: GeoFix) {
  return api<RiderMe>("/api/rider/location", { json: { lat: fix.lat, lng: fix.lng, speed_kmh: fix.speedKmh, accuracy_m: Math.round(fix.accuracy) } });
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
              ? "Tap the map to set where you are"
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

function openProfile(section?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT, { detail: section }));
}

function RiderPortal() {
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [manual, setManual] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [selectedZone, setSelectedZone] = useState<RiderDemandZone | null>(null);
  const [blocked, setBlocked] = useState<{ title: string; message: string } | null>(null);
  const interval = useLiveInterval(3000, 30000);
  const { data: health } = useServerHealth();
  const { data: me, mutate: refreshMe } = useSWR<RiderMe>("/api/rider/me", fetcher, { refreshInterval: interval });
  const { data: active, mutate: refreshActive } = useSWR<Trip | null>("/api/rider/active", fetcher, { refreshInterval: interval });
  const { data: offer, mutate: refreshOffer } = useSWR<Offer | null>(me?.is_online && !active ? "/api/rider/offer" : null, fetcher, {
    refreshInterval: interval,
  });
  const { data: toCollect, mutate: refreshCollect } = useSWR<Trip | null>("/api/rider/pending-payment", fetcher);

  // ---- device GPS -------------------------------------------------------------------------
  const verified = me?.status === "verified";
  const incomplete = !!me && (!me.vehicle || !me.license_no?.trim());
  const needsOnboarding = !!me && !verified && incomplete;
  const lockedOut = !!me && !verified;

  useEffect(() => {
    if (needsOnboarding) {
      router.replace("/rider/onboarding");
    }
  }, [needsOnboarding, router]);
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
    const minGap = active ? 2500 : MIN_GAP_MS;
    const minMove = active ? 5 : MIN_MOVE_M;
    const heartbeat = active ? 7000 : HEARTBEAT_MS;
    const moved = prev ? haversineKm(prev, fix) * 1000 : Infinity;
    if (prev && (now - prev.at < minGap || (moved < minMove && now - prev.at < heartbeat))) return;
    lastSent.current = { lat: fix.lat, lng: fix.lng, at: now };
    sendFix(fix).then(applyLocationUpdate).catch(() => undefined);
  }, [geo.fix, sharing, gpsWanted, active]);

  useEffect(() => {
    if (!sharing || !gpsWanted) return;
    const intervalTime = active ? 7000 : HEARTBEAT_MS;
    const id = setInterval(() => {
      const fix = latestFix.current;
      if (!fix) return;
      lastSent.current = { lat: fix.lat, lng: fix.lng, at: Date.now() };
      sendFix(fix).then(applyLocationUpdate).catch(() => undefined);
    }, intervalTime);
    return () => clearInterval(id);
  }, [sharing, gpsWanted, active]);

  // With a manual position there is no GPS stream, so keep re-sending the chosen spot. Without this the
  // backend sees the rider go quiet and drops them from matching and from passengers' maps after two minutes.
  const spotLat = me?.lat;
  const spotLng = me?.lng;
  useEffect(() => {
    if (!sharing || !manual || active?.auto_drive || spotLat == null || spotLng == null) return;
    const id = setInterval(() => {
      api<RiderMe>("/api/rider/location", { json: { lat: spotLat, lng: spotLng } }).then(applyLocationUpdate).catch(() => undefined);
    }, active ? 7000 : HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [sharing, manual, active, spotLat, spotLng]);

  const offerId = offer?.trip.id;
  const [seenOfferId, setSeenOfferId] = useState<string | undefined>();
  if (offerId !== seenOfferId) {
    setSeenOfferId(offerId);
    if (offerId) setSheetOpen(false); // let the map + floating offer pill take focus
  }

  const activeId = active?.id;
  const [seenActiveId, setSeenActiveId] = useState<string | undefined>();
  if (activeId !== seenActiveId) {
    setSeenActiveId(activeId);
    if (activeId) setSheetOpen(true); // open sheet for the active trip controls
  }

  const sheetBodyRef = useRef<HTMLDivElement>(null);
  const sheetStopRef = useRef<HTMLDivElement>(null);
  const [measuredSheetHeight, setMeasuredSheetHeight] = useState<number | null>(null);
  const clampToIdlePrompt = !!me && verified && !active && !offer && !toCollect;
  // Only meaningful while the sheet is clamped to the idle prompt.
  const idleSheetHeight = clampToIdlePrompt ? measuredSheetHeight : null;

  useEffect(() => {
    if (!clampToIdlePrompt) return;
    const body = sheetBodyRef.current;
    const stop = sheetStopRef.current;
    if (!body || !stop) return;
    const measure = () => {
      // 104px = drag handle (32px) + sheet header (72px); stop.offsetTop includes top/bottom 16px padding.
      setMeasuredSheetHeight(104 + stop.offsetTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, [clampToIdlePrompt, incomplete, me?.is_online, geo.status, manual]);

  const refreshAll = () => {
    void refreshMe();
    void refreshActive();
    void refreshOffer();
    void refreshCollect();
  };

  const applyLocationUpdate = (updated: RiderMe) => {
    void refreshMe(updated, { revalidate: false });
    if (updated.live_eta_min !== undefined) {
      void refreshActive(
        (cur) => (cur ? { ...cur, live_eta_min: updated.live_eta_min ?? cur.live_eta_min } : cur),
        { revalidate: false },
      );
    }
  };

  const canGoOnline = !!me && verified && !incomplete;

  /** Going online needs a verified account with vehicle and licence details; otherwise explain why. */
  function requestOnline(online: boolean) {
    if (online && me && !canGoOnline) {
      if (me.status === "suspended") {
        setBlocked({ title: "Account suspended", message: "Your account is suspended, so you can't go online. Contact support to restore access." });
      } else if (!verified) {
        setBlocked({
          title: "Waiting for verification",
          message: "An admin still needs to verify your account before you can go online. You'll get a notice as soon as it's done.",
        });
      } else {
        setBlocked({
          title: "Finish vehicle & licence setup",
          message: "Add your vehicle and driving licence details before going online.",
        });
      }
      return;
    }
    void setOnline(online);
  }

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
    await refreshMe(); // keep the switch busy until the new state is in, so the knob never flickers back
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
  const hintsKey = verified
    ? position
      ? `/api/rider/demand-hints?lat=${position.lat.toFixed(3)}&lng=${position.lng.toFixed(3)}`
      : "/api/rider/demand-hints"
    : null;
  const { data: hints } = useSWR<RiderDemandHints>(hintsKey, fetcher, { refreshInterval: 60000 });

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const circles: MapCircle[] = [];
  const shownTrip = active ?? offer?.trip ?? null;
  if (shownTrip) {
    markers.push({ id: "pickup", kind: "pickup", position: toTuple(shownTrip.pickup), label: shownTrip.pickup_address });
    markers.push({ id: "drop", kind: "drop", position: toTuple(shownTrip.drop), label: shownTrip.drop_address });

    if (active?.status === "accepted") {
      // Approach to pickup is the primary navigation leg
      if (active.approach && active.approach.length > 0) {
        lines.push({ id: "approach", points: active.approach, color: VEHICLE_COLOR[active.vehicle_type] ?? "#38bdf8", weight: 5 });
      }
      // Drop-off route is drawn dashed as the upcoming leg
      lines.push({ id: "route", points: shownTrip.route, color: "#9ca3af", dashed: true, weight: 3 });
    } else if (active?.status === "ongoing") {
      // Drop-off route is the primary active navigation leg
      lines.push({ id: "route", points: shownTrip.route, color: VEHICLE_COLOR[active.vehicle_type] ?? "#22c55e", weight: 5 });
    } else {
      lines.push({ id: "route", points: shownTrip.route, color: ROUTE_COLOR, weight: 4 });
    }
  } else if (hints?.zones.length) {
    const maxReq = Math.max(...hints.zones.map((z) => z.expected_requests), 0.1);
    for (const z of hints.zones) {
      if (z.expected_requests <= 0 && selectedZone?.zone_id !== z.zone_id) continue;
      const isSelected = selectedZone?.zone_id === z.zone_id;
      circles.push({
        id: `demand-${z.zone_id}`,
        center: [z.lat, z.lng],
        radius: isSelected ? 28 : 8 + 18 * Math.sqrt(z.expected_requests / maxReq),
        color: isSelected ? "#f97316" : demandCircleColor(z.demand_level),
        label: `${z.zone}: ~${z.expected_requests.toFixed(1)} req/hr · ${z.free_riders} free`,
      });
    }
  }
  if (position) markers.push({ id: "me", kind: "rider", position: toTuple(position), vehicleType: me?.vehicle?.vehicle_type, live: me?.is_online, label: "You" });

  let fitTo: [number, number][] = [];
  if (active?.status === "accepted") {
    // Zoom focus on rider and pickup point during approach/arrival
    fitTo = [
      toTuple(active.pickup),
      ...(position ? [toTuple(position)] : active.approach?.length ? [active.approach[0] as [number, number]] : []),
    ];
  } else if (active?.status === "ongoing") {
    // Zoom focus on rider and drop-off point during ongoing trip
    fitTo = [
      toTuple(active.drop),
      ...(position ? [toTuple(position)] : [toTuple(active.pickup)]),
    ];
  } else if (shownTrip) {
    fitTo = [toTuple(shownTrip.pickup), toTuple(shownTrip.drop), ...(position ? [toTuple(position)] : [])];
  } else if (selectedZone) {
    fitTo = [[selectedZone.lat, selectedZone.lng], ...(position ? [toTuple(position)] : [])];
  } else if (position) {
    fitTo = [toTuple(position)];
  }

  const fitKey = active
    ? `${active.id}-${active.status}-${active.arrived_at ? "arrived" : "heading"}`
    : shownTrip
      ? `${shownTrip.id}-${shownTrip.status}`
      : selectedZone
        ? `zone-${selectedZone.zone_id}`
        : position
          ? "me"
          : "none";

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className={lockedOut ? "pointer-events-none absolute inset-0 select-none blur-md transition-[filter] duration-300" : "absolute inset-0"}>
        {/* Layer 0: the map fills everything; every other element floats above it. */}
        <section className="absolute inset-0 isolate z-0">
          <RideMap markers={markers} lines={lines} circles={circles} fitTo={fitTo} fitKey={fitKey} onMapClick={onMapClick} />
        </section>

        {/* Floating online toggle, independent of the panel. */}
        {me && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-20 px-3 md:pr-3 md:pl-[calc(26.25rem+0.75rem)]">
            <AvailabilityToggle
              className="pointer-events-auto w-full"
              online={me.is_online}
              busy={toggling}
              disabled={!!active}
              hint={
                active
                  ? "Finish your current trip to go offline"
                  : incomplete
                    ? "Finish vehicle & licence setup to go online"
                    : !canGoOnline
                      ? "Verification required to go online"
                      : undefined
              }
              onChange={requestOnline}
            />
          </div>
        )}
        {me && !offer && (manual || !position) && (
          <div className="pointer-events-none absolute top-20 left-1/2 z-20 -translate-x-1/2 md:left-[calc(50%+13rem)]">
            <Badge variant="outline" className="bg-background/90 backdrop-blur">
              {manual ? "Tap the map to set your position" : "Waiting for GPS…"}
            </Badge>
          </div>
        )}

        {/* Incoming ride request floating pill over the map */}
        {me && !active && offer && (
          <div className="pointer-events-none absolute inset-x-3 top-20 z-30 md:right-3 md:left-[calc(26.25rem+0.75rem)] md:max-w-md">
            <OfferCard key={offer.trip.id} offer={offer} me={me} onDone={refreshAll} className="pointer-events-auto" />
          </div>
        )}

        <BottomSheet
          expanded={sheetOpen}
          onExpandedChange={setSheetOpen}
          mobileHeight={clampToIdlePrompt ? idleSheetHeight : null}
          header={
            me && (
              <div className="flex h-16 items-center gap-3 rounded-xl border bg-card px-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                  {me.vehicle && <VehicleIcon type={me.vehicle.vehicle_type} className="size-5" style={{ color: VEHICLE_COLOR[me.vehicle.vehicle_type] }} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{me.full_name}</div>
                  <div className="truncate text-xs text-muted-foreground">{me.vehicle ? `${me.vehicle.model} · ${me.vehicle.plate_no}` : "No vehicle"}</div>
                </div>
              </div>
            )
          }
        >
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div ref={sheetBodyRef} className="relative space-y-4 p-4">
            {!me && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />}
            {me && (
              <>
                {me.status === "pending" && (
                  <Alert>
                    <FileWarning />
                    <AlertTitle>Waiting for verification</AlertTitle>
                    <AlertDescription>
                      An admin will verify your account shortly. You can add your documents any time, but they aren&apos;t required.
                    </AlertDescription>
                  </Alert>
                )}
                {me.status === "suspended" && (
                  <Alert variant="destructive">
                    <AlertTitle>Account suspended</AlertTitle>
                    <AlertDescription>Contact support to restore access.</AlertDescription>
                  </Alert>
                )}
                {incomplete && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <FileWarning className="text-amber-400" />
                    <AlertTitle>Finish vehicle &amp; licence setup</AlertTitle>
                    <AlertDescription className="space-y-3">
                      <p>Add your vehicle and driving licence details before you can get verified or go online.</p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-10 w-full sm:w-auto"
                        onClick={() => (verified ? openProfile("vehicle") : router.push("/rider/onboarding"))}
                      >
                        <FileCheck2 /> {verified ? "Add Vehicle & Licence" : "Finish Setup"}
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {verified && <GpsStatus status={geo.status} fix={geo.fix} manual={manual} onManual={setManual} />}

                {/* Instantaneous data modules for rider home screen */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Stat
                      label="Today's Earnings"
                      value={formatTaka(me.earnings_today)}
                      hint="After platform cut"
                    />
                    <Stat
                      label="Completed Today"
                      value={plural(me.trips_today ?? 0, "ride")}
                      hint={`${me.trips_completed} lifetime`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => openProfile("earnings")}
                    className="w-full text-right text-xs font-medium text-primary hover:underline"
                  >
                    View daily &amp; weekly earnings summary →
                  </button>
                </div>

                {toCollect && <CollectCard trip={toCollect} onDone={refreshAll} />}
                {active && <ActiveTripCard trip={active} position={position} canAutoDrive={!!health?.simulator} onChanged={refreshAll} />}
                {!active && !offer && me.is_online && (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Waiting for trip requests near you…
                  </div>
                )}
                {!me.is_online && verified && !incomplete && !active && (
                  <p className="text-sm text-muted-foreground">
                    Go online to receive requests for <VehicleTag type={me.vehicle?.vehicle_type ?? "bike"} className="inline-flex" /> rides.
                  </p>
                )}
                <div ref={sheetStopRef} aria-hidden className="h-0" />
                {!active && !offer && verified && hints && (
                  <DemandHintsCard
                    hints={hints}
                    selectedZoneId={selectedZone?.zone_id ?? null}
                    onSelectZone={setSelectedZone}
                  />
                )}
              </>
            )}
          </div>
        </div>
        </BottomSheet>
      </div>

      {/* Lockout overlay until rider passes verification */}
      <AnimatePresence>
        {lockedOut && me && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING_UI}
            className="absolute inset-0 z-40 flex items-center justify-center bg-background/65 p-4 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.93, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={SPRING_UI}
              className="w-full max-w-md space-y-4 rounded-2xl border bg-card/95 p-6 shadow-2xl"
            >
              <div className="flex items-start gap-3.5">
                <motion.span
                  initial={{ scale: 0.7 }}
                  animate={{ scale: 1 }}
                  transition={SPRING_BOUNCY}
                  className={
                    me.status === "suspended"
                      ? "grid size-12 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-400"
                      : "grid size-12 shrink-0 place-items-center rounded-full bg-amber-500/15 text-amber-300"
                  }
                >
                  {me.status === "suspended" ? <ShieldAlert className="size-6" /> : <Lock className="size-6" />}
                </motion.span>
                <div className="min-w-0 space-y-1">
                  <h2 className="text-lg font-bold">
                    {me.status === "suspended"
                      ? "Account suspended"
                      : incomplete
                        ? "Finish vehicle & licence setup"
                        : "You haven't been verified yet"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {me.status === "suspended"
                      ? "Your rider account is currently suspended. Contact support to restore access."
                      : incomplete
                        ? "Add your vehicle and driving licence details so an admin can verify your account and you can go online."
                        : "Add your vehicle details. The rider app unlocks once an admin verifies you. Documents are optional."}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-1 sm:flex-row">
                <Button type="button" className="h-12 min-h-12 w-full text-base sm:w-auto sm:flex-1" onClick={() => router.push("/rider/onboarding")}>
                  <FileCheck2 /> Vehicle &amp; Documents
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 min-h-12 w-full text-base sm:w-auto sm:flex-1"
                  disabled={refreshingStatus}
                  onClick={() => {
                    setRefreshingStatus(true);
                    void refreshMe()
                      .then((updated) => {
                        if (updated?.status === "verified") {
                          toast.success("Account verified! Welcome to Cholo.");
                        } else {
                          toast.info("Still waiting for admin verification");
                        }
                      })
                      .finally(() => setRefreshingStatus(false));
                  }}
                >
                  <RefreshCw className={refreshingStatus ? "animate-spin" : undefined} />
                  {refreshingStatus ? "Checking…" : "Check Status"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={blocked !== null} onOpenChange={(o) => !o && setBlocked(null)}>
        <DialogContent>
          <DialogHeader>
            <span className="grid size-11 place-items-center rounded-full bg-amber-400/15 text-amber-300">
              <ShieldAlert className="size-6" />
            </span>
            <DialogTitle className="text-lg">{blocked?.title}</DialogTitle>
            <DialogDescription>{blocked?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            {incomplete && (
              <Button
                className="w-full sm:w-auto"
                onClick={() => {
                  setBlocked(null);
                  if (verified) {
                    openProfile("vehicle");
                  } else {
                    router.push("/rider/onboarding");
                  }
                }}
              >
                <FileCheck2 /> {verified ? "Add Vehicle & Licence" : "Finish Setup"}
              </Button>
            )}
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setBlocked(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function RiderPage() {
  return <PortalShell role="rider">{() => <RiderPortal />}</PortalShell>;
}
