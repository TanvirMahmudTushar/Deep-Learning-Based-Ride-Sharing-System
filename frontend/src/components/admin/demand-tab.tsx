"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { BrainCircuit, CloudRain, Gauge, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { RideMap, type MapCircle } from "@/components/map/ride-map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { formatPercent, timeAgo, VEHICLE_COLOR } from "@/lib/format";
import { Stat } from "@/components/ride-bits";
import type { AdminStats, DemandModelComparisonEntry, Forecasts, ModelEvaluation, ModelInfo, SimulatorStatus, VehicleType } from "@/lib/types";

const hourlyConfig = {
  forecast: { label: "Forecast", color: "#8f8e88" },
  actual: { label: "Actual requests", color: "#e8e8e3" },
} satisfies ChartConfig;

const zoneConfig = {
  bike: { label: "Bike", color: VEHICLE_COLOR.bike },
  cng: { label: "CNG", color: VEHICLE_COLOR.cng },
  car: { label: "Car", color: VEHICLE_COLOR.car },
} satisfies ChartConfig;

const dailyTripConfig = {
  trips: { label: "Trips", color: "#8f8e88" },
  completed: { label: "Completed", color: "#78b99a" },
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

function improvementLabel(baseline: number | null | undefined, candidate: number | null | undefined) {
  if (baseline == null || candidate == null || baseline === 0) return null;
  const improvement = ((baseline - candidate) / baseline) * 100;
  return `${improvement >= 0 ? "+" : ""}${improvement.toFixed(1)}% ${improvement >= 0 ? "better" : "worse"}`;
}

export function DemandTab() {
  const [horizon, setHorizon] = useState<15 | 30 | 60>(60);
  const [vehicle, setVehicle] = useState<"all" | VehicleType>("all");
  const { data, mutate } = useSWR<Forecasts>(`/api/admin/forecasts?horizon_minutes=${horizon}`, fetcher, {
    refreshInterval: 60000,
  });
  const { data: models } = useSWR<ModelInfo[]>("/api/models", fetcher);
  const { data: stats } = useSWR<AdminStats>("/api/admin/stats", fetcher, { refreshInterval: 10000 });
  const { data: evaluation } = useSWR<ModelEvaluation>("/api/admin/model-evaluation", fetcher, { refreshInterval: 60000 });
  const { data: simulatorStatus, mutate: mutateSimulator } = useSWR<SimulatorStatus>("/api/admin/simulator", fetcher, {
    refreshInterval: 5000,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [simulatorDraft, setSimulatorDraft] = useState<{ speedup: number; anomaly_rate: number } | null>(null);
  const [savingSimulator, setSavingSimulator] = useState(false);

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

  async function applySimulatorControls() {
    if (!simulatorDraft) return;
    setSavingSimulator(true);
    try {
      const updated = await api<SimulatorStatus>("/api/admin/simulator", {
        method: "PUT",
        json: { speedup: simulatorDraft.speedup, anomaly_rate: simulatorDraft.anomaly_rate },
      });
      await mutateSimulator(updated, { revalidate: false });
      setSimulatorDraft(null);
      toast.success("Simulator controls updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Simulator update failed");
    } finally {
      setSavingSimulator(false);
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
  const dailyTrips = stats?.daily_trips ?? [];
  const tripCount = dailyTrips.reduce((sum, day) => sum + day.trips, 0);
  const completedCount = dailyTrips.reduce((sum, day) => sum + day.completed, 0);
  const avgTripsPerDay = dailyTrips.length ? tripCount / dailyTrips.length : null;
  const completionRate = tripCount ? completedCount / tripCount : null;
  const simulatorValues = simulatorDraft ?? simulatorStatus;
  const demandBaselineMetrics = comparison.baseline.metrics?.all;
  const demandModelMetrics = comparison.deep_learning.metrics?.all;
  const etaBaselineMetrics = evaluation?.eta.baseline;
  const etaRecordedMetrics = evaluation?.eta.recorded;
  const etaImprovement = etaBaselineMetrics?.samples && etaRecordedMetrics?.samples
    ? improvementLabel(etaBaselineMetrics.mae_min, etaRecordedMetrics.mae_min)
    : null;
  const demandImprovement = demandModelMetrics?.evaluated_hours
    ? improvementLabel(demandBaselineMetrics?.mae, demandModelMetrics.mae)
    : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Average pickup wait · 7 days"
          value={stats?.avg_pickup_wait_min_7d == null ? "—" : `${stats.avg_pickup_wait_min_7d} min`}
          hint="Measured from request to rider arrival"
        />
        <Stat
          label="Cancellation rate · 7 days"
          value={stats ? formatPercent(stats.cancel_rate_7d) : "—"}
          hint={`Rider ${stats ? formatPercent(stats.rider_cancel_rate_7d) : "—"} · Passenger ${stats ? formatPercent(stats.passenger_cancel_rate_7d) : "—"}`}
        />
        <Stat
          label="ETA error · 7 days"
          value={`MAE ${stats?.eta_mae_min_7d == null ? "—" : `${stats.eta_mae_min_7d} min`}`}
          hint={`RMSE ${stats?.eta_rmse_min_7d == null ? "—" : `${stats.eta_rmse_min_7d} min`}`}
        />
        <Stat
          label="Trips per day · 7 days"
          value={avgTripsPerDay == null ? "—" : avgTripsPerDay.toFixed(1)}
          hint={`Completion ${completionRate == null ? "—" : formatPercent(completionRate)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily trips</CardTitle>
          <CardDescription>Trips requested and completed per local calendar day.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats ? (
            <ChartContainer config={dailyTripConfig} className="aspect-auto h-56 w-full">
              <LineChart data={dailyTrips} margin={{ left: 0, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <ChartTooltip cursor={{ strokeOpacity: 0.4 }} content={<ChartTooltipContent indicator="line" />} />
                <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
                <Line dataKey="trips" stroke="var(--color-trips)" strokeWidth={2} dot={false} />
                <Line dataKey="completed" stroke="var(--color-completed)" strokeWidth={2} dot={false} />
              </LineChart>
            </ChartContainer>
          ) : (
            <Skeleton className="h-56 w-full" />
          )}
        </CardContent>
      </Card>

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
            <BrainCircuit className="size-4" /> Model evaluation vs. baseline
          </CardTitle>
          <CardDescription>
            ETA is measured against completed trips over 30 days; demand is measured against completed hourly forecasts.
            {comparison.deep_learning.status === "pending"
              ? " No trained deep-learning demand candidate is registered yet."
              : " The registered deep-learning candidate is compared with the historical baseline."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Baseline · MAE / RMSE</TableHead>
                  <TableHead>Current · MAE / RMSE</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">ETA prediction</div>
                    <div className="font-mono text-xs text-muted-foreground">{evaluation?.eta.baseline_name ?? "Loading baseline…"}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {etaBaselineMetrics
                      ? `${etaBaselineMetrics.mae_min ?? "—"} / ${etaBaselineMetrics.rmse_min ?? "—"} min · ${etaBaselineMetrics.samples} trips`
                      : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {etaRecordedMetrics
                      ? `${etaRecordedMetrics.mae_min ?? "—"} / ${etaRecordedMetrics.rmse_min ?? "—"} min · ${etaRecordedMetrics.samples} trips`
                      : "—"}
                    {evaluation && (
                      <div className="text-xs text-muted-foreground">
                        {evaluation.eta.recorded_model_name} · {evaluation.eta.recorded_model_kind}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {etaImprovement ? (
                      <Badge variant={etaImprovement.includes("worse") ? "destructive" : "secondary"}>{etaImprovement}</Badge>
                    ) : etaRecordedMetrics?.samples ? "No measurable delta" : "Insufficient data"}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <div className="font-medium">Demand forecast</div>
                    <div className="font-mono text-xs text-muted-foreground">{comparison.baseline.name ?? "Historical baseline"}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {demandBaselineMetrics?.evaluated_hours
                      ? `${demandBaselineMetrics.mae?.toFixed(2) ?? "—"} / ${demandBaselineMetrics.rmse?.toFixed(2) ?? "—"} · ${demandBaselineMetrics.evaluated_hours} hours`
                      : "—"}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {demandModelMetrics?.evaluated_hours
                      ? `${demandModelMetrics.mae?.toFixed(2) ?? "—"} / ${demandModelMetrics.rmse?.toFixed(2) ?? "—"} · ${demandModelMetrics.evaluated_hours} hours`
                      : "No trained model"}
                    {comparison.deep_learning.name && <div className="text-xs text-muted-foreground">{comparison.deep_learning.name}</div>}
                  </TableCell>
                  <TableCell>
                    {demandImprovement ? (
                      <Badge variant={demandImprovement.includes("worse") ? "destructive" : "secondary"}>
                        {demandImprovement}
                      </Badge>
                    ) : <Badge variant="outline">Pending</Badge>}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {demandModels.map((entry) => {
              const prediction = predictionTotal(entry, vehicle);
              const metrics =
                entry.metrics === null
                  ? null
                  : vehicle === "all"
                    ? entry.metrics.all
                    : entry.metrics.by_vehicle[vehicle];
              return (
                <div key={entry.kind} className="space-y-1 rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{entry.kind === "baseline" ? "Baseline forecast" : "Deep-learning candidate"}</span>
                    <Badge variant={entry.status === "active" ? "secondary" : "outline"} className="text-[10px]">
                      {entry.kind === "baseline" && comparison.deep_learning.status === "pending" ? "Active baseline" : entry.status}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {prediction === null ? "Forecast unavailable" : `${prediction.toFixed(1)} requests`} ·{" "}
                    {metrics && metrics.evaluated_hours > 0
                      ? `MAE ${metrics.mae?.toFixed(2) ?? "—"} · RMSE ${metrics.rmse?.toFixed(2) ?? "—"}`
                      : "No evaluation metrics"}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Cancellation and anomaly components currently have baseline implementations only; the backend does not have
            independent labeled outcomes for a fair model comparison.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Gauge className="size-4" /> Trip simulator controls</CardTitle>
          <CardDescription>Updates take effect on the next simulator tick; anomaly rate applies when trip plans are created.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={simulatorStatus?.running ? "secondary" : "outline"}>
              {simulatorStatus?.running ? <Play aria-hidden /> : <Pause aria-hidden />}
              {simulatorStatus ? (simulatorStatus.running ? "Running" : "Paused") : "Loading status"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {simulatorStatus?.active_simulated_trips ?? "—"} active simulated trips
            </span>
          </div>
          {simulatorValues ? (
            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="flex items-center justify-between">
                  Simulation speed-up <strong>{simulatorValues.speedup}x</strong>
                </span>
                <input
                  aria-label="Simulation speed-up"
                  className="w-full accent-primary"
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={simulatorValues.speedup}
                  disabled={!simulatorStatus || savingSimulator}
                  onChange={(event) =>
                    setSimulatorDraft({
                      speedup: Number(event.currentTarget.value),
                      anomaly_rate: simulatorValues.anomaly_rate,
                    })
                  }
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="flex items-center justify-between">
                  Anomaly rate <strong>{Math.round(simulatorValues.anomaly_rate * 100)}%</strong>
                </span>
                <input
                  aria-label="Anomaly rate"
                  className="w-full accent-primary"
                  type="range"
                  min="0"
                  max="50"
                  step="1"
                  value={Math.round(simulatorValues.anomaly_rate * 100)}
                  disabled={!simulatorStatus || savingSimulator}
                  onChange={(event) =>
                    setSimulatorDraft({
                      speedup: simulatorValues.speedup,
                      anomaly_rate: Number(event.currentTarget.value) / 100,
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
          <div className="flex justify-end">
            <Button onClick={applySimulatorControls} disabled={!simulatorDraft || savingSimulator}>
              {savingSimulator && <Loader2 className="animate-spin" />} Apply controls
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Baseline-only model components</CardTitle>
          <CardDescription>These models remain active until trained alternatives are registered.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {models
            ?.filter((modelInfo) => modelInfo.component !== "demand" && modelInfo.kind === "baseline")
            .map((modelInfo) => (
              <div key={modelInfo.component} className="space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{modelInfo.component}</span>
                  <Badge variant="outline" className="text-[10px]">{modelInfo.kind}</Badge>
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
