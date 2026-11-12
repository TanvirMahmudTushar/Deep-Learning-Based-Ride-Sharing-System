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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { timeAgo, VEHICLE_COLOR } from "@/lib/format";
import type { DemandModelComparisonEntry, Forecasts, ModelInfo, VehicleType } from "@/lib/types";

const hourlyConfig = {
  forecast: { label: "Forecast", color: "#8f8e88" },
  actual: { label: "Actual requests", color: "#e8e8e3" },
} satisfies ChartConfig;

const zoneConfig = {
  bike: { label: "Bike", color: VEHICLE_COLOR.bike },
  cng: { label: "CNG", color: VEHICLE_COLOR.cng },
  car: { label: "Car", color: VEHICLE_COLOR.car },
} satisfies ChartConfig;

const vehicleLabels: Record<VehicleType, string> = { bike: "Bike", cng: "CNG", car: "Car" };

function isVehicleFilter(value: string): value is "all" | VehicleType {
  return value === "all" || value === "bike" || value === "cng" || value === "car";
}

function predictionTotal(entry: DemandModelComparisonEntry, vehicle: "all" | VehicleType) {
  if (!entry.predictions_by_vehicle) return null;
  return vehicle === "all"
    ? Object.values(entry.predictions_by_vehicle).reduce((total, count) => total + count, 0)
    : entry.predictions_by_vehicle[vehicle];
}

export function DemandTab() {
  const [horizon, setHorizon] = useState<15 | 30 | 60>(60);
  const [vehicle, setVehicle] = useState<"all" | VehicleType>("all");
  const { data, mutate } = useSWR<Forecasts>(`/api/admin/forecasts?horizon_minutes=${horizon}`, fetcher, {
    refreshInterval: 60000,
  });
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

  const hourly = data.hourly.map((point) => ({
    hourLabel: `${String(point.hour).padStart(2, "0")}:00`,
    forecast: vehicle === "all" ? point.forecast : point.forecast_by_vehicle[vehicle],
    actual:
      point.actual_by_vehicle === null
        ? null
        : vehicle === "all"
          ? point.actual
          : point.actual_by_vehicle[vehicle],
  }));
  const zones = data.zones
    .map((zone) => ({
      ...zone,
      display_total: vehicle === "all" ? zone.total : zone[vehicle],
      display_free_riders: vehicle === "all" ? zone.free_riders : zone.free_riders_by_type[vehicle],
    }))
    .sort((a, b) => b.display_total - a.display_total);
  const maxTotal = Math.max(...zones.map((zone) => zone.display_total), 0.01);
  const circles: MapCircle[] = zones.map((zone) => ({
    id: String(zone.zone_id),
    center: [zone.lat, zone.lng],
    radius: 8 + 26 * Math.sqrt(zone.display_total / maxTotal),
    color: vehicle === "all" ? "#c3c2b7" : VEHICLE_COLOR[vehicle],
    label: `${zone.zone}: ${zone.display_total.toFixed(1)} expected · ${zone.display_free_riders} free ${
      vehicle === "all" ? "riders" : `${vehicleLabels[vehicle]} riders`
    }`,
  }));
  const comparison = data.model_comparison;
  const demandModels = [comparison.baseline, comparison.deep_learning];

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
        <div className="flex items-center gap-2">
          <span>Horizon</span>
          <Select
            value={String(horizon)}
            onValueChange={(value) => {
              if (value === "15") setHorizon(15);
              else if (value === "30") setHorizon(30);
              else if (value === "60") setHorizon(60);
            }}
          >
            <SelectTrigger aria-label="Forecast horizon" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="60">60 minutes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span>Vehicle</span>
          <Select
            value={vehicle}
            onValueChange={(value) => {
              if (isVehicleFilter(value)) setVehicle(value);
            }}
          >
            <SelectTrigger aria-label="Filter by vehicle type" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vehicles</SelectItem>
              <SelectItem value="bike">Bike</SelectItem>
              <SelectItem value="cng">CNG</SelectItem>
              <SelectItem value="car">Car</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={refresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Refit & refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Requests per hour today</CardTitle>
            <CardDescription>
              {vehicle === "all" ? "All vehicles" : vehicleLabels[vehicle]} · forecast vs actual so far
            </CardDescription>
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
            <CardTitle>Expected requests · next {horizon} minutes</CardTitle>
            <CardDescription>
              {vehicle === "all" ? "Per zone, stacked by vehicle type" : `Per zone · ${vehicleLabels[vehicle]}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={zoneConfig} className="aspect-auto h-72 w-full">
              <BarChart data={zones} layout="vertical" margin={{ left: 4, right: 12 }} barCategoryGap={4}>
                <CartesianGrid horizontal={false} strokeOpacity={0.4} />
                <XAxis type="number" tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="zone" tickLine={false} axisLine={false} width={92} interval={0} fontSize={11} />
                <ChartTooltip cursor={{ fillOpacity: 0.08 }} content={<ChartTooltipContent />} />
                {vehicle === "all" && <ChartLegend itemSorter={null} content={<ChartLegendContent />} />}
                {vehicle === "all" ? (
                  <>
                    <Bar dataKey="bike" stackId="v" fill="var(--color-bike)" stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="cng" stackId="v" fill="var(--color-cng)" stroke="var(--card)" strokeWidth={2} />
                    <Bar dataKey="car" stackId="v" fill="var(--color-car)" stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} />
                  </>
                ) : (
                  <Bar dataKey={vehicle} fill={`var(--color-${vehicle})`} radius={[0, 4, 4, 0]} />
                )}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="border-b px-4 py-3 text-sm">
            <span className="font-medium">Demand map</span>
            <span className="ml-2 text-muted-foreground">
              Circle size = {vehicle === "all" ? "all vehicles" : vehicleLabels[vehicle]} requests · next {horizon} min
            </span>
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
                {vehicle === "all" ? (
                  <>
                    <TableHead className="text-right">Bike</TableHead>
                    <TableHead className="text-right">CNG</TableHead>
                    <TableHead className="text-right">Car</TableHead>
                  </>
                ) : (
                  <TableHead className="text-right">{vehicleLabels[vehicle]}</TableHead>
                )}
                {vehicle === "all" && <TableHead className="text-right">Total</TableHead>}
                <TableHead className="text-right">
                  {vehicle === "all" ? "Free riders" : `${vehicleLabels[vehicle]} free riders`}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.zone_id}>
                  <TableCell className="font-medium">{zone.zone}</TableCell>
                  {vehicle === "all" ? (
                    <>
                      <TableCell className="text-right tabular-nums">{zone.bike.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{zone.cng.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums">{zone.car.toFixed(1)}</TableCell>
                    </>
                  ) : (
                    <TableCell className="text-right tabular-nums">{zone[vehicle].toFixed(1)}</TableCell>
                  )}
                  {vehicle === "all" && (
                    <TableCell className="text-right font-medium tabular-nums">{zone.display_total.toFixed(1)}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">{zone.display_free_riders}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-4" /> Demand model comparison
          </CardTitle>
          <CardDescription>
            Forecast totals use the selected horizon and vehicle filter. MAE/RMSE compare completed hourly forecasts with
            today&apos;s observed requests; they are live indicators, not a held-out benchmark.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {demandModels.map((entry) => {
            const prediction = predictionTotal(entry, vehicle);
            const metrics =
              entry.metrics === null
                ? null
                : vehicle === "all"
                  ? entry.metrics.all
                  : entry.metrics.by_vehicle[vehicle];
            const isFallback = entry.kind === "baseline" && comparison.deep_learning.status === "pending";
            return (
              <div key={entry.kind} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.kind === "baseline" ? "Historical baseline" : "Deep learning"}</span>
                  <Badge variant={entry.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                    {isFallback ? "Fallback active" : entry.status}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{entry.name ?? "No model registered"}</div>
                <div className="text-sm">
                  Forecast:{" "}
                  <span className="font-medium tabular-nums">
                    {prediction === null ? "Unavailable" : `${prediction.toFixed(1)} requests`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {metrics && metrics.evaluated_hours > 0
                    ? `MAE ${metrics.mae?.toFixed(2) ?? "—"} · RMSE ${metrics.rmse?.toFixed(2) ?? "—"} · ${metrics.evaluated_hours} completed hours`
                    : "Forecast accuracy metrics are not available yet."}
                </div>
                {entry.kind === "deep-learning" && entry.status === "pending" && (
                  <p className="text-xs text-muted-foreground">
                    No trained deep-learning demand model is registered; the historical baseline remains active.
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other prediction models in use</CardTitle>
          <CardDescription>Registered model implementations behind the ETA, cancellation, and anomaly services.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {models
            ?.filter((modelInfo) => modelInfo.component !== "demand")
            .map((modelInfo) => (
              <div key={modelInfo.component} className="space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{modelInfo.component}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {modelInfo.kind}
                  </Badge>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{modelInfo.name}</div>
                <p className="text-xs text-muted-foreground">{modelInfo.description}</p>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
