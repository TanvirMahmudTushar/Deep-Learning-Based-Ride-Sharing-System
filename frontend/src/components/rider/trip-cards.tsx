"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Banknote, Check, Clock, Loader2, MapPin, Navigation, Phone, ShieldAlert, Star, X } from "lucide-react";
import { TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { TripChat } from "@/components/trip-chat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
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

      {/* Clearly separated Reject & Accept buttons */}
      <div className="grid grid-cols-2 gap-4 pt-0.5">
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={!!busy}
          className="h-12 border-red-400/40 text-red-300 hover:bg-red-500/15 hover:text-red-200"
          onClick={() => respond("decline")}
        >
          {busy === "decline" ? <Loader2 className="animate-spin" /> : <X className="size-4" />} Reject
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={!!busy}
          className="h-12 bg-emerald-500 font-semibold text-emerald-950 hover:bg-emerald-400"
          onClick={() => respond("accept")}
        >
          {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check className="size-4" />} Accept
        </Button>
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
  const target = trip.status === "accepted" ? trip.pickup : trip.drop;
  const distanceKm = position ? haversineKm(position, target) : null;
  const far = distanceKm != null && distanceKm > FAR_KM;

  async function act(path: string, success: string, json?: unknown) {
    setBusy(true);
    await run(() => api(`/api/rider/trips/${trip.id}/${path}`, json === undefined ? { method: "POST" } : { json }), success);
    setBusy(false);
    setConfirmFar(false);
    onChanged();
  }

  function startOrComplete() {
    if (far && !confirmFar && !trip.auto_drive) {
      setConfirmFar(true);
      return;
    }
    if (trip.status === "accepted") void act("start", "Trip started");
    else void act("complete", "Trip completed. Collect the cash.");
  }

  const navUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${position ? `${position.lat},${position.lng}` : ""};${target.lat},${target.lng}`;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <TripStatusBadge status={trip.status} />
        <span className="text-right">
          <span className="block font-semibold tabular-nums">{formatTaka(Math.max(0, trip.fare_estimate + (trip.fee_adjustment ?? 0)))} cash</span>
          {!!trip.fee_adjustment && (
            <span className="block text-xs text-muted-foreground">
              {trip.fee_adjustment > 0 ? `incl. ${formatTaka(trip.fee_adjustment)} earlier fee` : `after ${formatTaka(-trip.fee_adjustment)} credit`}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground">Passenger</div>
          <div className="font-medium">{trip.passenger_name}</div>
        </div>
        {trip.passenger_phone && (
          <Button variant="outline" size="icon" asChild>
            <a href={`tel:${trip.passenger_phone}`} aria-label="Call passenger">
              <Phone />
            </a>
          </Button>
        )}
      </div>
      <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
        <div className="text-xs text-muted-foreground">{trip.status === "accepted" ? "Go to pickup" : "Drop-off"}</div>
        <div className="font-medium">{trip.status === "accepted" ? trip.pickup_address : trip.drop_address}</div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{distanceKm != null ? `${formatKm(distanceKm)} away (straight line)` : "Waiting for your location…"}</span>
          <a href={navUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
            <MapPin className="size-3" /> Directions
          </a>
        </div>
        {trip.status === "accepted" && trip.arrived_at && <div className="text-xs text-emerald-300">You&apos;re at the pickup. The passenger has been told.</div>}
      </div>
      <TripChat basePath={`/api/rider/trips/${trip.id}`} otherName={trip.passenger_name.split(" ")[0]} canSend />
      {trip.has_alert && (
        <Alert>
          <ShieldAlert />
          <AlertTitle>Safety check raised</AlertTitle>
          <AlertDescription>Your route was flagged for admin review. Stay on the planned route.</AlertDescription>
        </Alert>
      )}
      {canAutoDrive && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
          <div>
            <Label htmlFor="auto-drive" className="text-sm">
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
        <p className="text-xs text-amber-200">
          You are {formatKm(distanceKm)} from the {trip.status === "accepted" ? "pickup" : "drop-off"}. Tap again to {trip.status === "accepted" ? "start" : "complete"} anyway.
        </p>
      )}
      {confirmCancel && trip.status === "accepted" && (
        <p className="text-xs text-red-300">
          Cancelling an accepted ride raises your cancellation rate. Tap again to confirm cancel.
        </p>
      )}
      <div className={trip.status === "accepted" ? "grid grid-cols-2 gap-3" : ""}>
        {trip.status === "accepted" && (
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (!confirmCancel) {
                setConfirmCancel(true);
                return;
              }
              setConfirmCancel(false);
              void act("cancel", "Trip cancelled");
            }}
          >
            {confirmCancel ? "Confirm cancel" : "Cancel"}
          </Button>
        )}
        <Button className="w-full" disabled={busy} onClick={startOrComplete}>
          {busy ? <Loader2 className="animate-spin" /> : trip.status === "accepted" ? <Navigation /> : <Check />}
          {confirmFar ? "Yes, " : ""}
          {trip.status === "accepted" ? "Start trip" : "Complete trip"}
        </Button>
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
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await run(() => api(`/api/rider/trips/${trip.id}/collect`, { method: "POST" }), "Cash confirmed");
          setBusy(false);
          onDone();
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Check />} Cash received
      </Button>
    </div>
  );
}
