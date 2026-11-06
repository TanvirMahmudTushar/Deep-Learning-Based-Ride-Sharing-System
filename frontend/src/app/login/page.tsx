"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { AuthFrame } from "@/components/auth-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useServerHealth } from "@/lib/server";
import { saveSession } from "@/lib/session";
import type { AuthResponse } from "@/lib/types";

const DEMO = [
  { label: "Passenger", email: "user@ride.local", password: "user123" },
  { label: "Rider", email: "rider@ride.local", password: "rider123" },
  { label: "Admin", email: "admin@ride.local", password: "admin123" },
];

// `?as=` only changes the wording. Which portal opens always comes from the account's real role.
const HEADINGS: Record<string, { title: string; description: string }> = {
  user: { title: "Passenger log in", description: "Log in to book a ride and track your trips." },
  rider: { title: "Rider log in", description: "Log in to go online and take trip offers." },
  admin: { title: "Admin log in", description: "For platform staff. Admin accounts can't be created through sign-up." },
};
const DEFAULT_HEADING = { title: "Log in", description: "Passengers, riders and admins use the same login." };

function LoginForm() {
  const as = useSearchParams().get("as") ?? "";
  const heading = HEADINGS[as] ?? DEFAULT_HEADING;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: health } = useServerHealth();

  async function login(e: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      // AuthFrame sends the user to their portal as soon as the session is saved.
      saveSession(await api<AuthResponse>("/api/auth/login", { json: { email: e, password: p } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  }

  function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    void login(email, password);
  }

  return (
    <AuthFrame>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Log in
            </Button>
          </CardContent>
        </form>
        <CardFooter className="flex-col items-stretch gap-3 pt-2">
          {health?.demo_mode && (
            <>
              <div className="text-xs text-muted-foreground">Demo mode: use a demo account</div>
              <div className="grid grid-cols-3 gap-2">
                {DEMO.map((d) => (
                  <Button key={d.email} variant="outline" size="sm" disabled={busy} onClick={() => void login(d.email, d.password)}>
                    {d.label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {as !== "admin" && (
            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link href={as === "rider" ? "/register?as=rider" : "/register"} className="text-foreground underline-offset-4 hover:underline">
                Create an account
              </Link>
            </p>
          )}
        </CardFooter>
      </Card>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
