"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { BrainCircuit, CloudRain, Loader2, RefreshCw } from "lucide-react";
import { RideMap, type MapCircle } from "@/components/map/ride-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { timeAgo, VEHICLE_COLOR } from "@/lib/format";
import type { Forecasts, ModelInfo } from "@/lib/types";

// Forecast vs observed is told apart by line style (dashed vs solid) as well as ink, never color alone.
const hourlyConfig = {
  forecast: { label: "Forecast", color: "#8f8e88" },
  actual: { label: "Actual requests", color: "#e8e8e3" },
} satisfies ChartConfig;

const zoneConfig = {
  bike: { label: "Bike", color: VEHICLE_COLOR.bike },
  cng: { label: "CNG", color: VEHICLE_COLOR.cng },
  car: { label: "Car", color: VEHICLE_COLOR.car },
} satisfies ChartConfig;

export function DemandTab() {
  const { data, mutate } = useSWR<Forecasts>("/api/admin/forecasts", fetcher, { refreshInterval: 60000 });
  const { data: models } = useSWR<ModelInfo[]>("/api/models", fetcher);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await api("/api/admin/forecasts/refresh", { method: "POST" });
      await mutate();
      toast.success("Forecasts refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const hourly = data.hourly.map((h) => ({ ...h, hourLabel: `${String(h.hour).padStart(2, "0")}:00` }));
  const zones = [...data.zones].sort((a, b) => b.total - a.total);
  const maxTotal = Math.max(...zones.map((z) => z.total), 0.01);
  const circles: MapCircle[] = zones.map((z) => ({
    id: String(z.zone_id),
    center: [z.lat, z.lng],
    radius: 8 + 26 * Math.sqrt(z.total / maxTotal),
    color: "#c3c2b7",
    label: `${z.zone}: ${z.total.toFixed(1)} expected · ${z.free_riders} free riders`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant="secondary" className="font-mono">
          {data.model}
        </Badge>
        <span>Generated {timeAgo(data.generated_at)}</span>
        {data.raining && (
          <span className="inline-flex items-center gap-1">
            <CloudRain className="size-4" /> Raining: +15% demand
          </span>
        )}
        <Button size="sm" variant="outline" className="ml-auto" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refit & refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requests per hour today</CardTitle>
            <CardDescription>All zones and vehicle types · forecast vs actual so far</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={hourlyConfig} className="aspect-auto h-72 w-full">
              <LineChart data={hourly} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="hourLabel" tickLine={false} axisLine={false} interval={3} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <ChartTooltip cursor={{ strokeOpacity: 0.4 }} content={<ChartTooltipContent indicator="line" />} />
                <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
                <Line dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line dataKey="actual" stroke="var(--color-actual)" strokeWidth={2} dot={false} connectNulls={false} />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expected requests · next hour</CardTitle>
            <CardDescription>Per zone, stacked by vehicle type</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={zoneConfig} className="aspect-auto h-72 w-full">
              <BarChart data={zones} layout="vertical" margin={{ left: 4, right: 12 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} strokeOpacity={0.4} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="zone" tickLine={false} axisLine={false} width={92} interval={0} fontSize={11} />
                <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={<ChartTooltipContent />} />
                <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
                <Bar dataKey="bike" stackId="v" fill="var(--color-bike)" stroke="var(--card)" strokeWidth={2} />
                <Bar dataKey="cng" stackId="v" fill="var(--color-cng)" stroke="var(--card)" strokeWidth={2} />
                <Bar dataKey="car" stackId="v" fill="var(--color-car)" stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b px-4 py-3 text-sm">
            <span className="font-medium">Demand map</span>
            <span className="ml-2 text-muted-foreground">Circle size = expected requests next hour</span>
          </div>
          <div className="h-95">
            <RideMap circles={circles} />
          </div>
        </Card>

        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zone</TableHead>
                <TableHead className="text-right">Bike</TableHead>
                <TableHead className="text-right">CNG</TableHead>
                <TableHead className="text-right">Car</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Free riders</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((z) => (
                <TableRow key={z.zone_id}>
                  <TableCell className="font-medium">{z.zone}</TableCell>
                  <TableCell className="text-right tabular-nums">{z.bike.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{z.cng.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{z.car.toFixed(1)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{z.total.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums">{z.free_riders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-4" /> Prediction models in use
          </CardTitle>
          <CardDescription>Baselines from the evaluation plan. Trained deep learning models replace them behind the same interface.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {models?.map((m) => (
            <div key={m.component} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium capitalize">{m.component}</span>
                <Badge variant="outline" className="text-[10px]">
                  {m.kind}
                </Badge>
              </div>
              <div className="font-mono text-xs text-muted-foreground">{m.name}</div>
              <p className="text-xs text-muted-foreground">{m.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
