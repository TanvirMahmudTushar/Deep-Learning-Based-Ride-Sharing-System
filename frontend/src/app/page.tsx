"use client";

import Link from "next/link";
import { BrainCircuit, Gauge, ShieldAlert, TrendingUp, UserRound, Bike, LayoutDashboard } from "lucide-react";
import { Brand } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useServerHealth } from "@/lib/server";
import { homeFor, useSession } from "@/lib/session";

const FEATURES = [
  { icon: TrendingUp, title: "Demand forecasting", text: "Requests per zone for the next hour position riders ahead of peaks and keep surge pricing smooth." },
  { icon: Gauge, title: "ETA prediction", text: "Trip and pickup times from road distance, vehicle type and time of day." },
  { icon: BrainCircuit, title: "Cancellation-aware matching", text: "Riders are ranked by pickup time plus their predicted chance of cancelling." },
  { icon: ShieldAlert, title: "Trip anomaly detection", text: "Live GPS is checked against the planned route; detours and long stops raise alerts." },
];

const PORTALS = [
  { href: "/user", icon: UserRound, title: "Passenger", text: "Book a bike, CNG or car, see why the fare is what it is, and track the ride live.", demo: "user@ride.local / user123" },
  { href: "/rider", icon: Bike, title: "Rider", text: "Go online, accept trip offers, navigate and complete trips.", demo: "rider@ride.local / rider123" },
  { href: "/admin", icon: LayoutDashboard, title: "Admin", text: "Verify riders, watch live trips, review safety alerts and demand forecasts.", demo: "admin@ride.local / admin123" },
];

export default function Home() {
  const session = useSession();
  const { data: health } = useServerHealth();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center border-b px-4 sm:px-6">
        <Brand />
        <div className="ml-auto flex gap-2">
          {session.status === "authenticated" ? (
            <Button asChild>
              <Link href={homeFor(session.profile.role)}>Open my portal</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/login">Log in</Link>
              </Button>
              <Button asChild>
                <Link href="/register">Sign up</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-20">
        <section className="max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">Ride-sharing for Dhaka · bike · CNG · car</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Shorter waits, fewer cancellations, fares you can understand.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground text-pretty">
            A research prototype in which learned models drive dispatch, arrival times and safety checks. Each model is measured against a simple
            baseline, so the gain from deep learning is shown, not assumed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/login">{health?.demo_mode ? "Try the demo" : "Log in"}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/register">Create an account</Link>
            </Button>
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-5">
              <f.icon className="size-5 text-muted-foreground" />
              <h3 className="mt-3 font-medium">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight">Three portals</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {PORTALS.map((p) => (
              <Card key={p.href}>
                <CardHeader>
                  <p.icon className="size-5 text-muted-foreground" />
                  <CardTitle className="mt-2">{p.title}</CardTitle>
                  <CardDescription>{p.text}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {health?.demo_mode && <p className="font-mono text-xs text-muted-foreground">Demo: {p.demo}</p>}
                  <Button variant="secondary" className="w-full" asChild>
                    <Link href={p.href}>Open {p.title.toLowerCase()} portal</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Research prototype · cash payments only · map data © OpenStreetMap contributors · search by Nominatim
      </footer>
    </div>
  );
}
