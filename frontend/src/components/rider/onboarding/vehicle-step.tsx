"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { VehicleIcon } from "@/components/ride-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPRING_UI } from "@/components/ui/motion";
import { api } from "@/lib/api";
import { VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RiderMe, VehicleType } from "@/lib/types";

const VEHICLES: { type: VehicleType; hint: string }[] = [
  { type: "bike", hint: "Fast solo rides" },
  { type: "cng", hint: "3-wheeler city" },
  { type: "car", hint: "AC / 4-seater" },
];

export function VehicleStep({ me, onSaved }: { me: RiderMe; onSaved: (updated: RiderMe) => void }) {
  const [vehicleType, setVehicleType] = useState<VehicleType>(me.vehicle?.vehicle_type ?? "bike");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const field = (k: string) => String(form.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const updated = await api<RiderMe>("/api/rider/onboarding/vehicle", {
        json: {
          vehicle_type: vehicleType,
          model: field("model"),
          plate_no: field("plate_no"),
          color: field("color"),
          registration_no: field("registration_no"),
          license_no: field("license_no"),
        },
      });
      toast.success("Vehicle details saved");
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save vehicle details");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.form
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={SPRING_UI}
      onSubmit={onSubmit}
      className="space-y-5"
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2.5">
        <Label>Select vehicle type</Label>
        <div className="grid grid-cols-3 gap-2.5">
          {VEHICLES.map(({ type, hint }) => {
            const active = vehicleType === type;
            return (
              <motion.button
                key={type}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                transition={SPRING_UI}
                onClick={() => setVehicleType(type)}
                className={cn(
                  "relative flex flex-col items-center gap-1.5 rounded-2xl border p-3.5 text-center transition-colors",
                  active ? "border-primary bg-primary/10 text-foreground shadow-sm" : "border-border bg-card/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="onboarding-vehicle-active"
                    transition={SPRING_UI}
                    className="absolute inset-0 rounded-2xl border-2 border-primary/80"
                  />
                )}
                <span className="relative z-10 grid size-10 place-items-center rounded-full bg-muted">
                  <VehicleIcon type={type} className="size-5" style={{ color: VEHICLE_COLOR[type] }} />
                </span>
                <span className="relative z-10 text-sm font-semibold">{VEHICLE_LABEL[type]}</span>
                <span className="relative z-10 text-[11px] text-muted-foreground">{hint}</span>
                {active && <CheckCircle2 className="absolute top-2 right-2 z-10 size-3.5 text-primary" />}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="model">Vehicle model</Label>
          <Input id="model" name="model" required minLength={2} defaultValue={me.vehicle?.model ?? ""} placeholder="Yamaha FZ-S" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="color">Vehicle color</Label>
          <Input id="color" name="color" required minLength={2} defaultValue={me.vehicle?.color ?? ""} placeholder="Matte Black" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="plate_no">Plate number</Label>
          <Input
            id="plate_no"
            name="plate_no"
            required
            minLength={3}
            defaultValue={me.vehicle?.plate_no ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="registration_no">Registration number</Label>
          <Input
            id="registration_no"
            name="registration_no"
            required
            minLength={3}
            defaultValue={me.vehicle?.registration_no ?? ""}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="license_no">Driving licence number</Label>
        <Input id="license_no" name="license_no" required minLength={2} defaultValue={me.license_no ?? ""} />
      </div>

      <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        Save &amp; Continue to Documents
        <ArrowRight />
      </Button>
    </motion.form>
  );
}

