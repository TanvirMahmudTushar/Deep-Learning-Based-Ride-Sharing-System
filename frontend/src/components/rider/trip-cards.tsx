"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Banknote, Check, Clock, ExternalLink, Loader2, MapPin, Navigation, Navigation2, Phone, ShieldAlert, Star, X } from "lucide-react";
import { TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { TripChat } from "@/components/trip-chat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { SPRING_BOUNCY, SPRING_UI } from "@/components/ui/motion";
import { api } from "@/lib/api";
import { formatKm, formatMinutes, formatTaka } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { LatLng, Offer, RiderMe, Trip } from "@/lib/types";

const OFFER_SECONDS = 30;
/** Start/complete further than this from the pickup/drop-off asks for a second tap. */
const FAR_KM = 0.3;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export async function run(action: () => Promise<unknown>, success?: string) {
  try {
    await action();
    if (success) toast.success(success);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Something went wrong");
    return false;
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function OfferCard({
  offer,
  me,
  onDone,
  className,
}: {
  offer: Offer;
  me: RiderMe;
  onDone: () => void;
  className?: string;
}) {
  const now = useNow(500);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const expiredFired = useRef(false);
  const left = Math.max(0, (new Date(offer.expires_at).getTime() - now) / 1000);
  const t = offer.trip;

  useEffect(() => {
    expiredFired.current = false;
  }, [offer.trip.id, offer.expires_at]);

  useEffect(() => {
    if (left <= 0 && !busy && !expiredFired.current) {
      expiredFired.current = true;
      onDone();
    }
  }, [left, busy, onDone]);

  async function respond(kind: "accept" | "decline") {
    setBusy(kind);
    await run(
      () => api(`/api/rider/offers/${t.id}/${kind}`, { method: "POST" }),
      kind === "accept" ? "Trip accepted. Head to the pickup." : "Request rejected",
    );
    setBusy(null);
    onDone();
  }

  return (
    <div className={cn("space-y-3 rounded-2xl border border-ring/60 bg-background/95 p-4 shadow-2xl backdrop-blur-md", className)}>
      {/* Top countdown & vehicle row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Incoming request</span>
          {me.vehicle && <VehicleTag type={me.vehicle.vehicle_type} className="text-xs" />}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
          <Clock className="size-3" /> {Math.ceil(left)}s
        </span>
      </div>
      <Progress value={(left / OFFER_SECONDS) * 100} className="h-1.5" />

      {/* Passenger photo, name, rating, distance + big fare */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-12 shrink-0 border border-border">
            <AvatarImage src={t.passenger_photo ?? undefined} alt={t.passenger_name} />
            <AvatarFallback className="text-sm font-semibold">{initials(t.passenger_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{t.passenger_name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1 text-foreground">
                <Star className="size-3.5 fill-amber-300 text-amber-300" aria-hidden />
                {t.passenger_rating != null ? t.passenger_rating.toFixed(1) : "New"}
                {t.passenger_rating_count ? <span className="text-muted-foreground">({t.passenger_rating_count})</span> : null}
              </span>
              <span>·</span>
              <span className="tabular-nums">
                {formatKm(offer.pickup_distance_km)} away
                {t.pickup_eta_min != null ? ` · ~${formatMinutes(t.pickup_eta_min)}` : ""}
              </span>
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold leading-none tracking-tight tabular-nums">{formatTaka(t.fare_estimate)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t.price_multiplier > 1 ? (
              <span className="font-medium text-amber-300">{t.price_multiplier}x surge</span>
            ) : (
              <span>Cash · {formatKm(t.distance_km)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Pickup & Destination */}
      <div className="space-y-1.5 rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] text-muted-foreground">Pickup · </span>
            <span className="font-medium">{t.pickup_address}</span>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-1.5 size-2 shrink-0 rounded-full border-2 border-foreground" />
          <div className="min-w-0 flex-1">
            <span className="text-[11px] text-muted-foreground">Destination · </span>
            <span className="font-medium">{t.drop_address}</span>
          </div>
        </div>
      </div>

      {/* Clearly separated Reject & Accept buttons with spring press */}
      <div className="grid grid-cols-2 gap-4 pt-0.5">
        <motion.div whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} transition={SPRING_UI}>
          <Button
            type="button"
            size="lg"
            variant="outline"
            disabled={!!busy}
            className="h-12 w-full border-red-400/40 text-red-300 hover:bg-red-500/15 hover:text-red-200"
            onClick={() => respond("decline")}
          >
            {busy === "decline" ? <Loader2 className="animate-spin" /> : <X className="size-4" />} Reject
          </Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} transition={SPRING_UI}>
          <Button
            type="button"
            size="lg"
            disabled={!!busy}
            className="h-12 w-full bg-emerald-500 font-semibold text-emerald-950 hover:bg-emerald-400"
            onClick={() => respond("accept")}
          >
            {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check className="size-4" />} Accept
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

export function ActiveTripCard({
  trip,
  position,
  canAutoDrive,
  onChanged,
}: {
  trip: Trip;
  position: LatLng | null;
  canAutoDrive: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmFar, setConfirmFar] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Status steps:
  // 1. to_pickup (accepted && !trip.arrived_at)
  // 2. at_pickup (accepted && trip.arrived_at)
  // 3. ongoing (ongoing)
  const stage =
    trip.status === "accepted"
      ? trip.arrived_at
        ? "at_pickup"
        : "to_pickup"
      : trip.status === "ongoing"
        ? "ongoing"
        : "other";

  const target = stage === "ongoing" ? trip.drop : trip.pickup;
  const distanceKm = position ? haversineKm(position, target) : null;
  const far = distanceKm != null && distanceKm > FAR_KM;

  async function act(path: string, success: string, json?: unknown) {
    setBusy(true);
    await run(() => api(`/api/rider/trips/${trip.id}/${path}`, json === undefined ? { method: "POST" } : { json }), success);
    setBusy(false);
    setConfirmFar(false);
    onChanged();
  }

  function handleAction() {
    if (far && !confirmFar && !trip.auto_drive && (stage === "to_pickup" || stage === "ongoing")) {
      setConfirmFar(true);
      return;
    }
    if (stage === "to_pickup") {
      void act("arrived", "Arrived at pickup. Passenger notified.");
    } else if (stage === "at_pickup") {
      void act("start", "Trip started. Heading to destination.");
    } else if (stage === "ongoing") {
      void act("complete", "Trip completed. Collect the cash.");
    }
  }

  const gmapsNavUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
  const osmNavUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${position ? `${position.lat},${position.lng}` : ""};${target.lat},${target.lng}`;

  const etaDisplay =
    stage === "to_pickup"
      ? (trip.live_eta_min ?? trip.pickup_eta_min)
      : (trip.live_eta_min ?? trip.predicted_eta_min);

  return (
    <div className="space-y-4 rounded-xl border p-4 shadow-sm bg-card">
      {/* 3-Step Navigation Stepper */}
      <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
        <div
          className={cn(
            "rounded-lg py-1.5 px-1 border transition-all",
            stage === "to_pickup"
              ? "bg-primary/10 border-primary font-semibold text-primary shadow-xs"
              : trip.arrived_at || stage === "ongoing"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium"
                : "border-border/60 text-muted-foreground"
          )}
        >
          1. Heading to Pickup
        </div>
        <div
          className={cn(
            "rounded-lg py-1.5 px-1 border transition-all",
            stage === "at_pickup"
              ? "bg-emerald-500/15 border-emerald-500 font-semibold text-emerald-400 shadow-xs"
              : stage === "ongoing"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 font-medium"
                : "border-border/60 text-muted-foreground"
          )}
        >
          2. At Pickup
        </div>
        <div
          className={cn(
            "rounded-lg py-1.5 px-1 border transition-all",
            stage === "ongoing"
              ? "bg-primary/10 border-primary font-semibold text-primary shadow-xs"
              : "border-border/60 text-muted-foreground"
          )}
        >
          3. On Trip
        </div>
      </div>

      <div className="flex items-center justify-between">
        <TripStatusBadge status={trip.status} />
        <span className="text-right">
          <span className="block font-semibold tabular-nums text-base">{formatTaka(Math.max(0, trip.fare_estimate + (trip.fee_adjustment ?? 0)))} cash</span>
          {!!trip.fee_adjustment && (
            <span className="block text-xs text-muted-foreground">
              {trip.fee_adjustment > 0 ? `incl. ${formatTaka(trip.fee_adjustment)} earlier fee` : `after ${formatTaka(-trip.fee_adjustment)} credit`}
            </span>
          )}
        </span>
      </div>

      {/* Passenger Details & Quick Contact */}
      <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="size-10 shrink-0 border">
            <AvatarImage src={trip.passenger_photo ?? undefined} alt={trip.passenger_name} />
            <AvatarFallback className="text-xs font-semibold">{initials(trip.passenger_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground">Passenger</div>
            <div className="truncate font-medium">{trip.passenger_name}</div>
          </div>
        </div>
        {trip.passenger_phone && (
          <motion.div whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} transition={SPRING_UI}>
            <Button variant="outline" size="icon" className="size-9 rounded-full" asChild>
              <a href={`tel:${trip.passenger_phone}`} aria-label="Call passenger">
                <Phone className="size-4" />
              </a>
            </Button>
          </motion.div>
        )}
      </div>

      {/* Route & Navigation Target Card */}
      <div className="space-y-2 rounded-xl bg-muted/50 p-3.5 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {stage === "ongoing" ? "Destination Drop-off" : stage === "at_pickup" ? "Pickup Point (Arrived)" : "Go to Pickup"}
          </span>
          <span className="text-xs font-medium tabular-nums text-foreground">
            {distanceKm != null ? `${formatKm(distanceKm)} away` : "Locating…"}
            {etaDisplay != null ? ` · ~${formatMinutes(etaDisplay)}` : ""}
          </span>
        </div>
        <div className="font-medium leading-snug">
          {stage === "ongoing" ? trip.drop_address : trip.pickup_address}
        </div>

        {/* Turn-by-Turn External Navigation Links */}
        <div className="flex items-center gap-2 pt-1">
          <motion.a
            href={gmapsNavUrl}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_UI}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-background border px-3 py-2 text-xs font-semibold shadow-xs hover:bg-muted"
          >
            <Navigation2 className="size-3.5 text-primary" /> Navigate (Google Maps)
          </motion.a>
          <motion.a
            href={osmNavUrl}
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING_UI}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-background border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted"
            title="OpenStreetMap directions"
          >
            OSM <ExternalLink className="size-3" />
          </motion.a>
        </div>

        {stage === "at_pickup" && (
          <div className="mt-1 flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2 text-xs text-emerald-400">
            <Check className="size-4 shrink-0" />
            <span>You&apos;re at pickup! Passenger has been notified.</span>
          </div>
        )}
      </div>

      <TripChat basePath={`/api/rider/trips/${trip.id}`} otherName={trip.passenger_name.split(" ")[0]} canSend />

      {trip.has_alert && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Safety check raised</AlertTitle>
          <AlertDescription>Your route or stop duration was flagged for review. Please proceed safely along the route.</AlertDescription>
        </Alert>
      )}

      {canAutoDrive && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
          <div>
            <Label htmlFor="auto-drive" className="text-sm font-medium">
              Auto-drive (demo simulator)
            </Label>
            <p className="text-xs text-muted-foreground">{trip.auto_drive ? "The simulator is driving the route." : "Let the simulator drive this trip."}</p>
          </div>
          <Switch
            id="auto-drive"
            checked={trip.auto_drive}
            disabled={busy}
            onCheckedChange={(v) => act("auto-drive", v ? "Auto-drive on" : "Auto-drive off", { enabled: v })}
          />
        </div>
      )}

      {confirmFar && (
        <p className="text-xs font-medium text-amber-300">
          You are {formatKm(distanceKm)} from the {stage === "ongoing" ? "drop-off" : "pickup"}. Tap again to confirm.
        </p>
      )}

      {confirmCancel && trip.status === "accepted" && (
        <p className="text-xs font-medium text-red-300">
          Cancelling an accepted ride raises your cancellation rate. Tap again to confirm cancel.
        </p>
      )}

      {/* Primary Status Step Action Button */}
      <div className={trip.status === "accepted" ? "grid grid-cols-3 gap-2" : "w-full"}>
        {trip.status === "accepted" && (
          <motion.div whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} transition={SPRING_UI}>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              className="h-12 w-full font-medium"
              onClick={() => {
                if (!confirmCancel) {
                  setConfirmCancel(true);
                  return;
                }
                setConfirmCancel(false);
                void act("cancel", "Trip cancelled");
              }}
            >
              {confirmCancel ? "Confirm" : "Cancel"}
            </Button>
          </motion.div>
        )}

        <motion.div
          className={trip.status === "accepted" ? "col-span-2" : "w-full"}
          whileTap={{ scale: 0.97 }}
          whileHover={{ y: -1 }}
          transition={SPRING_UI}
        >
          <Button
            type="button"
            className={cn(
              "h-12 w-full font-semibold text-base shadow-sm",
              stage === "to_pickup" && "bg-emerald-500 text-emerald-950 hover:bg-emerald-400",
              stage === "at_pickup" && "bg-primary text-primary-foreground hover:bg-primary/90",
              stage === "ongoing" && "bg-emerald-600 text-white hover:bg-emerald-500"
            )}
            disabled={busy}
            onClick={handleAction}
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" />
            ) : stage === "to_pickup" ? (
              <>
                <MapPin className="size-5 mr-1.5" />
                {confirmFar ? "Confirm Arrival" : "I Have Arrived"}
              </>
            ) : stage === "at_pickup" ? (
              <>
                <Navigation className="size-5 mr-1.5" />
                {confirmFar ? "Confirm Start" : "Start Trip"}
              </>
            ) : (
              <>
                <Check className="size-5 mr-1.5" />
                {confirmFar ? "Confirm Complete" : "Complete Trip"}
              </>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

export function CollectCard({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const p = trip.payment!;
  return (
    <div className="space-y-3 rounded-xl border border-emerald-400/40 bg-emerald-400/5 p-4">
      <div className="flex items-center gap-2 font-medium">
        <Banknote className="size-5 text-emerald-300" /> Collect cash from {trip.passenger_name}
      </div>
      <div className="text-3xl font-semibold tabular-nums">{formatTaka(p.amount)}</div>
      <p className="text-xs text-muted-foreground">
        Your earning {formatTaka(p.rider_earning)} · platform commission {formatTaka(p.commission)} (settled later)
      </p>
      {!!trip.fee_adjustment && (
        <p className="text-xs text-muted-foreground">
          {trip.fee_adjustment > 0
            ? `Includes a ${formatTaka(trip.fee_adjustment)} late-cancellation fee from the passenger's earlier ride. It goes to the platform, not your earning.`
            : `The passenger had a ${formatTaka(-trip.fee_adjustment)} credit. The platform covers it, so your earning is unchanged.`}
        </p>
      )}
      <motion.div whileTap={{ scale: 0.97 }} whileHover={{ y: -1 }} transition={SPRING_UI}>
        <Button
          type="button"
          className="h-12 w-full font-semibold text-base bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await run(() => api(`/api/rider/trips/${trip.id}/collect`, { method: "POST" }), "Cash confirmed");
            setBusy(false);
            onDone();
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Check className="mr-1.5 size-5" />} Cash received
        </Button>
      </motion.div>
    </div>
  );
}
