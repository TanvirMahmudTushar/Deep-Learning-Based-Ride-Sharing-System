"use client";

import { Check, Loader2, Phone, Radar, Share2, Siren, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FareBreakdownView, PaymentStatus, RateForm } from "@/components/passenger/trip-parts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { RatingText, TripStatusBadge, VehicleIcon, VehicleTag } from "@/components/ride-bits";
import { api } from "@/lib/api";
import { formatKm, formatMinutes, formatTaka, VEHICLE_LABEL } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import { cn } from "@/lib/utils";
import type { Trip } from "@/lib/types";

const STEPS = [
  { key: "requested", label: "Matching" },
  { key: "accepted", label: "Pickup" },
  { key: "ongoing", label: "On trip" },
  { key: "completed", label: "Arrived" },
] as const;

/** Bangladesh national emergency number. */
const EMERGENCY_NUMBER = "999";

function Steps({ status }: { status: Trip["status"] }) {
  const current = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Trip progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className="space-y-1.5">
          <div className={cn("h-1 rounded-full", i <= current ? "bg-foreground" : "bg-muted")} />
          <div className={cn("text-[11px]", i === current ? "text-foreground" : "text-muted-foreground")}>{s.label}</div>
        </li>
      ))}
    </ol>
  );
}

function TripSummary({ trip }: { trip: Trip }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-3">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-foreground" />
        <span className="text-muted-foreground">{trip.pickup_address}</span>
      </div>
      <div className="flex gap-3">
        <span className="mt-1 size-2 shrink-0 rounded-full border-2 border-foreground" />
        <span className="text-muted-foreground">{trip.drop_address}</span>
      </div>
      <div className="flex justify-between border-t pt-2">
        <VehicleTag type={trip.vehicle_type} />
        <span className="tabular-nums">
          {formatKm(trip.distance_km)} · <span className="font-semibold">{formatTaka(trip.fare_final ?? trip.fare_estimate)}</span>
        </span>
      </div>
      {trip.price_reason && <p className="text-xs text-muted-foreground">{trip.price_reason}</p>}
    </div>
  );
}

function shareText(trip: Trip) {
  const r = trip.rider;
  const lines = [
    `I'm on a ${VEHICLE_LABEL[trip.vehicle_type]} ride: ${trip.pickup_address} → ${trip.drop_address}.`,
    r ? `Rider: ${r.full_name}${r.vehicle ? `, ${r.vehicle.model} (${r.vehicle.plate_no})` : ""}.` : "",
    r?.lat != null && r.lng != null ? `Current position: https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function SafetyControls({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function share() {
    const text = shareText(trip);
    try {
      if (navigator.share) {
        await navigator.share({ title: "My ride", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast.success("Trip details copied. Paste them to a friend or family member.");
    } catch {
      // The user closed the share sheet, or clipboard access was refused.
    }
  }

  async function sendSos() {
    setSending(true);
    try {
      await api(`/api/trips/${trip.id}/sos`, { json: { note } });
      setOpen(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not send the alert. Call ${EMERGENCY_NUMBER}.`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      {trip.sos_active && (
        <Alert variant="destructive">
          <Siren />
          <AlertTitle>Emergency alert sent</AlertTitle>
          <AlertDescription>
            Our safety team has your trip and live location. If you are in danger, call{" "}
            <a href={`tel:${EMERGENCY_NUMBER}`} className="font-semibold underline">
              {EMERGENCY_NUMBER}
            </a>
            .
          </AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={share}>
          <Share2 /> Share trip
        </Button>
        <Button variant="destructive" onClick={() => setOpen(true)} disabled={trip.sos_active}>
          <Siren /> {trip.sos_active ? "Alert sent" : "Emergency"}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send an emergency alert?</DialogTitle>
            <DialogDescription>
              Our safety team sees your trip, rider and live location immediately. For immediate danger, also call {EMERGENCY_NUMBER}.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="What's happening? (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" asChild>
              <a href={`tel:${EMERGENCY_NUMBER}`}>
                <Phone /> Call {EMERGENCY_NUMBER}
              </a>
            </Button>
            <Button variant="destructive" onClick={sendSos} disabled={sending}>
              {sending ? <Loader2 className="animate-spin" /> : <Siren />} Send alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TrackingPanel({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const rider = trip.rider;
  const riderPos = rider?.lat != null && rider.lng != null ? { lat: rider.lat, lng: rider.lng } : null;

  async function cancel() {
    setCancelling(true);
    try {
      await api(`/api/trips/${trip.id}/cancel`, { method: "POST" });
      toast("Ride cancelled");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <TripStatusBadge status={trip.status} />
        <span className="text-xs text-muted-foreground">Trip ETA {formatMinutes(trip.predicted_eta_min)}</span>
      </div>
      <Steps status={trip.status} />

      {trip.status === "requested" && (
        <div className="flex items-start gap-3 rounded-lg border p-4">
          <Radar className="mt-0.5 size-5 shrink-0 animate-pulse text-muted-foreground" />
          <div className="text-sm">
            <div className="font-medium">Finding the best {VEHICLE_LABEL[trip.vehicle_type]} rider…</div>
            <p className="mt-1 text-muted-foreground">Riders are ranked by pickup time and how likely they are to cancel, not just distance.</p>
          </div>
        </div>
      )}

      {trip.status === "accepted" && trip.arrived_at && (
        <Alert>
          <Check />
          <AlertTitle>Your rider has arrived</AlertTitle>
          <AlertDescription>Look for {rider?.vehicle ? rider.vehicle.plate_no : "your rider"} at the pickup point.</AlertDescription>
        </Alert>
      )}

      {rider && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-muted">
              {rider.vehicle && <VehicleIcon type={rider.vehicle.vehicle_type} className="size-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{rider.full_name}</div>
              <div className="text-xs text-muted-foreground">
                <RatingText rating={rider.rating} count={rider.rating_count} />
              </div>
            </div>
            <Button variant="outline" size="icon" asChild>
              <a href={`tel:${rider.phone}`} aria-label="Call rider">
                <Phone />
              </a>
            </Button>
          </div>
          {rider.vehicle && (
            <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
              <span>{rider.vehicle.model}</span>
              <span className="font-mono text-xs">{rider.vehicle.plate_no}</span>
            </div>
          )}
          {riderPos && trip.status === "accepted" && !trip.arrived_at && (
            <p className="text-sm text-muted-foreground">
              Rider is {formatKm(haversineKm(riderPos, trip.pickup))} away · estimated pickup {formatMinutes(trip.pickup_eta_min)}
            </p>
          )}
          {riderPos && trip.status === "ongoing" && (
            <p className="text-sm text-muted-foreground">{formatKm(haversineKm(riderPos, trip.drop))} to your destination</p>
          )}
        </div>
      )}

      {(trip.status === "accepted" || trip.status === "ongoing") && <SafetyControls trip={trip} onChanged={onChanged} />}

      <TripSummary trip={trip} />

      {(trip.status === "requested" || trip.status === "accepted") && (
        <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={cancel} disabled={cancelling}>
          {cancelling ? <Loader2 className="animate-spin" /> : <X />} Cancel ride
        </Button>
      )}
    </div>
  );
}

export function FinishedPanel({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  if (trip.status === "cancelled") {
    return (
      <div className="space-y-4">
        <TripStatusBadge status="cancelled" />
        <p className="text-sm text-muted-foreground">{trip.cancel_reason ?? "This ride was cancelled."}</p>
        <TripSummary trip={trip} />
        <Button className="w-full" onClick={onDone}>
          Book another ride
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
          <Check className="size-5" />
        </span>
        <div>
          <div className="font-medium">You have arrived</div>
          <div className="text-sm text-muted-foreground">
            {formatTaka(trip.fare_final)} · {formatMinutes(trip.actual_duration_min)} trip (predicted {formatMinutes(trip.predicted_eta_min)})
          </div>
        </div>
      </div>
      {trip.payment && <PaymentStatus payment={trip.payment} />}
      <TripSummary trip={trip} />
      {trip.fare_breakdown && (
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Receipt</div>
          <FareBreakdownView breakdown={trip.fare_breakdown} />
        </div>
      )}
      {trip.rating == null ? (
        <RateForm tripId={trip.id} riderName={trip.rider?.full_name} onDone={onDone} onSkip={onDone} />
      ) : (
        <Button className="w-full" onClick={onDone}>
          Book another ride
        </Button>
      )}
    </div>
  );
}
