"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ArrowRight, MapPin } from "lucide-react";
import { RatingText, Stat, VehicleTag } from "@/components/ride-bits";
import { TripHistory } from "@/components/trip-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatKm, formatMinutes, formatTaka, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { setPrefill } from "@/lib/prefill";
import type { PassengerSummary, Trip, VehicleType } from "@/lib/types";

// One series, so one neutral ink: blue/orange/aqua are reserved for vehicle identity across the app.
const spendConfig = { spent: { label: "Spent (৳)", color: "#c3c2b7" } } satisfies ChartConfig;

function weekLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function OverviewTab({ onOpenTrip }: { onOpenTrip: (id: string) => void }) {
  const router = useRouter();
  const { data: s } = useSWR<PassengerSummary>("/api/passenger/summary", fetcher);
  const { data: recent } = useSWR<Trip[]>("/api/trips?limit=5", fetcher);

  if (!s) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (s.trips_total === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-12 text-center">
          <MapPin className="mx-auto size-6 text-muted-foreground" />
          <p className="font-medium">No rides yet</p>
          <p className="text-sm text-muted-foreground">Your spending, trips and favourite places will show up here after your first ride.</p>
          <Button asChild>
            <Link href="/user">Book your first ride</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const weekly = s.weekly.map((w) => ({ ...w, label: weekLabel(w.week_start) }));
  const vehicleTotal = Object.values(s.by_vehicle).reduce((a, b) => a + b, 0) || 1;

  function bookTo(d: PassengerSummary["top_destinations"][number]) {
    setPrefill({ drop: { lat: d.lat, lng: d.lng, label: d.address }, vehicleType: d.vehicle_type });
    router.push("/user");
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Rides completed" value={s.trips_completed} hint={`${s.rides_this_month} this month`} />
        <Stat label="Total spent" value={formatTaka(s.spent_total)} hint={`${formatTaka(s.spent_this_month)} this month`} />
        <Stat label="Average fare" value={formatTaka(s.avg_fare)} />
        <Stat label="Distance travelled" value={formatKm(s.distance_km_total)} hint={`${formatMinutes(s.minutes_total)} on the road`} />
        <Stat label="Your average rating" value={<RatingText rating={s.avg_rating_given} />} hint="Stars you gave riders" />
        <Stat label="Cancelled" value={s.trips_cancelled} hint={`${s.cancelled_by_you} by you`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Weekly spending</CardTitle>
            <CardDescription>Completed rides over the last 12 weeks · weeks start on Saturday</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={spendConfig} className="aspect-auto h-60 w-full">
              <BarChart data={weekly} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval={1} tickMargin={8} fontSize={11} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v: number) => (v >= 1000 ? `৳${Math.round(v / 100) / 10}k` : `৳${v}`)}
                  fontSize={11}
                />
                <ChartTooltip
                  cursor={{ fillOpacity: 0.08 }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => {
                        const row = payload?.[0]?.payload as (typeof weekly)[number] | undefined;
                        return row ? `Week of ${row.label} · ${row.rides} ride${row.rides === 1 ? "" : "s"}` : "";
                      }}
                    />
                  }
                />
                <Bar dataKey="spent" fill="var(--color-spent)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rides by vehicle</CardTitle>
            <CardDescription>
              {s.favorite_vehicle ? `You ride ${VEHICLE_LABEL[s.favorite_vehicle]} most` : "Completed rides"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(["bike", "cng", "car"] as VehicleType[]).map((vt) => {
              const n = s.by_vehicle[vt];
              const pct = Math.round((n / vehicleTotal) * 100);
              return (
                <div key={vt} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <VehicleTag type={vt} />
                    <span className="tabular-nums text-muted-foreground">
                      {n} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: VEHICLE_COLOR[vt] }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Frequent destinations</CardTitle>
            <CardDescription>Book again in one tap</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {s.top_destinations.map((d) => (
              <div key={d.address} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                <MapPin className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{d.address}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.trips} ride{d.trips === 1 ? "" : "s"} · last by {VEHICLE_LABEL[d.vehicle_type]}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => bookTo(d)}>
                  Book <ArrowRight />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent trips</CardTitle>
            <CardDescription>Select a trip for its receipt and details</CardDescription>
          </CardHeader>
          <CardContent>
            <TripHistory trips={recent} empty="No trips yet." onSelect={(t) => onOpenTrip(t.id)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
