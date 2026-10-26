"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Brand } from "@/components/app-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useServerHealth } from "@/lib/server";
import { homeFor, saveSession } from "@/lib/session";
import type { AuthResponse } from "@/lib/types";

const DEMO = [
  { label: "Passenger", email: "user@ride.local", password: "user123" },
  { label: "Rider", email: "rider@ride.local", password: "rider123" },
  { label: "Admin", email: "admin@ride.local", password: "admin123" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: health } = useServerHealth();

  async function login(e: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      const session = await api<AuthResponse>("/api/auth/login", { json: { email: e, password: p } });
      saveSession(session);
      router.replace(homeFor(session.profile.role));
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
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center border-b px-4 sm:px-6">
        <Brand />
      </header>
      <main className="grid flex-1 place-items-center px-4 py-10">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">Log in</CardTitle>
            <CardDescription>Passengers, riders and admins use the same login.</CardDescription>
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
            <p className="text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
                Create an account
              </Link>
            </p>
          </CardFooter>
        </Card>
      </main>
    </div>
  );
}
