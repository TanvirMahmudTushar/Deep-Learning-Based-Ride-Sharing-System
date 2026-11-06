"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, Check, Clock, Loader2, MapPin, Navigation, Phone, ShieldAlert, X } from "lucide-react";
import { TripStatusBadge } from "@/components/ride-bits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { formatKm, formatTaka } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
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

function Stops({ trip }: { trip: Trip }) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex gap-2">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground" /> {trip.pickup_address}
      </div>
      <div className="flex gap-2">
        <span className="mt-1.5 size-2 shrink-0 rounded-full border-2 border-foreground" /> {trip.drop_address}
      </div>
    </div>
  );
}

export function OfferCard({ offer, me, onDone }: { offer: Offer; me: RiderMe; onDone: () => void }) {
  const now = useNow(500);
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const left = Math.max(0, (new Date(offer.expires_at).getTime() - now) / 1000);
  const t = offer.trip;

  async function respond(kind: "accept" | "decline") {
    setBusy(kind);
    await run(() => api(`/api/rider/offers/${t.id}/${kind}`, { method: "POST" }), kind === "accept" ? "Trip accepted. Head to the pickup." : undefined);
    setBusy(null);
    onDone();
  }

  return (
    <div className="space-y-4 rounded-xl border border-ring/60 bg-accent/30 p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium">New trip request</span>
        <span className="inline-flex items-center gap-1 text-sm tabular-nums text-muted-foreground">
          <Clock className="size-3.5" /> {Math.ceil(left)}s
        </span>
      </div>
      <Progress value={(left / OFFER_SECONDS) * 100} className="h-1" />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold tabular-nums">{formatTaka(t.fare_estimate)}</div>
          <div className="text-xs text-muted-foreground">Cash fare</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums">{formatKm(offer.pickup_distance_km)}</div>
          <div className="text-xs text-muted-foreground">To pickup</div>
        </div>
        <div>
          <div className="text-lg font-semibold tabular-nums">{formatKm(t.distance_km)}</div>
          <div className="text-xs text-muted-foreground">Trip</div>
        </div>
      </div>
      <Stops trip={t} />
      {t.price_multiplier > 1 && <p className="text-xs text-amber-200">High demand: {t.price_multiplier}x fare</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={!!busy} onClick={() => respond("decline")}>
          {busy === "decline" ? <Loader2 className="animate-spin" /> : <X />} Decline
        </Button>
        <Button disabled={!!busy} onClick={() => respond("accept")}>
          {busy === "accept" ? <Loader2 className="animate-spin" /> : <Check />} Accept
        </Button>
      </div>
      {me.vehicle && <p className="text-center text-xs text-muted-foreground">Offers match your vehicle type ({me.vehicle.vehicle_type.toUpperCase()}).</p>}
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
        <span className="font-semibold tabular-nums">{formatTaka(trip.fare_estimate)} cash</span>
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
      <div className={trip.status === "accepted" ? "grid grid-cols-2 gap-2" : ""}>
        {trip.status === "accepted" && (
          <Button variant="destructive" disabled={busy} onClick={() => act("cancel", "Trip cancelled")}>
            Cancel
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
