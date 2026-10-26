"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Brand } from "@/components/app-shell";
import { VehicleIcon } from "@/components/ride-bits";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { VEHICLE_LABEL } from "@/lib/format";
import { homeFor, saveSession } from "@/lib/session";
import type { AuthResponse, VehicleType } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<"user" | "rider">("user");
  const [vehicleType, setVehicleType] = useState<VehicleType>("bike");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const field = (k: string) => String(form.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const session = await api<AuthResponse>("/api/auth/register", {
        json: {
          full_name: field("full_name"),
          email: field("email"),
          phone: field("phone"),
          password: field("password"),
          role,
          ...(role === "rider"
            ? { license_no: field("license_no"), vehicle_type: vehicleType, plate_no: field("plate_no"), vehicle_model: field("vehicle_model") }
            : {}),
        },
      });
      saveSession(session);
      router.replace(homeFor(session.profile.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center border-b px-4 sm:px-6">
        <Brand />
      </header>
      <main className="grid flex-1 place-items-center px-4 py-10">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>Riders are reviewed by an admin before they can go online.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={role} onValueChange={(v) => setRole(v as "user" | "rider")} className="mb-5">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="user">I need rides</TabsTrigger>
                <TabsTrigger value="rider">I want to drive</TabsTrigger>
              </TabsList>
            </Tabs>
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" name="full_name" required minLength={2} autoComplete="name" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" name="phone" type="tel" required minLength={6} placeholder="+8801…" autoComplete="tel" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required minLength={6} autoComplete="new-password" />
              </div>

              {role === "rider" && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="space-y-2">
                    <Label>Vehicle type</Label>
                    <Select value={vehicleType} onValueChange={(v) => setVehicleType(v as VehicleType)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["bike", "cng", "car"] as const).map((vt) => (
                          <SelectItem key={vt} value={vt}>
                            <VehicleIcon type={vt} /> {VEHICLE_LABEL[vt]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="vehicle_model">Model</Label>
                      <Input id="vehicle_model" name="vehicle_model" required placeholder="Yamaha FZ-S" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plate_no">Plate number</Label>
                      <Input id="plate_no" name="plate_no" required placeholder="DHAKA METRO-HA 12-3456" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="license_no">Driving licence number</Label>
                    <Input id="license_no" name="license_no" required />
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Create account
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already registered?{" "}
                <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                  Log in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
