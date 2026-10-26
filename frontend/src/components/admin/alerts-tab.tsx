"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MapPinned, MessageSquareWarning, Siren, Sparkles, Timer } from "lucide-react";
import { RideMap } from "@/components/map/ride-map";
import { TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fetcher } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLiveInterval } from "@/lib/realtime";
import type { SafetyAlert } from "@/lib/types";

const TYPE_LABEL: Record<SafetyAlert["alert_type"], string> = {
  route_deviation: "Route deviation",
  long_stop: "Long stop",
  sos: "Passenger SOS",
  report: "Passenger report",
};

const isPassengerRaised = (a: SafetyAlert) => a.alert_type === "sos" || a.alert_type === "report";

const STATUS_STYLE: Record<SafetyAlert["status"], string> = {
  open: "border-red-400/30 bg-red-400/10 text-red-200",
  reviewed: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  closed: "border-border bg-muted text-muted-foreground",
};

function AlertIcon({ type }: { type: SafetyAlert["alert_type"] }) {
  if (type === "sos") return <Siren className="size-4 text-red-300" />;
  if (type === "report") return <MessageSquareWarning className="size-4" />;
  return type === "route_deviation" ? <MapPinned className="size-4" /> : <Timer className="size-4" />;
}

const categoryLabel = (c?: string) => (c ? c.replace(/_/g, " ") : "other");

function detailText(a: SafetyAlert) {
  switch (a.alert_type) {
    case "sos":
      return a.details.note ? `"${a.details.note}"` : `Emergency button pressed (${a.details.trip_status ?? "trip"})`;
    case "report":
      return `${categoryLabel(a.details.category)}: ${a.details.note ?? ""}`;
    case "route_deviation":
      return `${a.details.deviation_km ?? "?"} km off route at ${a.details.progress_pct ?? "?"}% of the trip`;
    default:
      return `Stopped ${a.details.stop_minutes ?? "?"} min at ${a.details.progress_pct ?? "?"}% of the trip`;
  }
}

export function AlertsTab() {
  const [filter, setFilter] = useState("open");
  const key = filter === "all" ? "/api/admin/alerts" : `/api/admin/alerts?status_filter=${filter}`;
  const { data: alerts, mutate } = useSWR<SafetyAlert[]>(key, fetcher, { refreshInterval: useLiveInterval(4000, 30000) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = alerts?.find((a) => a.id === selectedId) ?? alerts?.[0] ?? null;

  async function call(path: string, label: string, json?: unknown) {
    if (!selected) return;
    setBusy(label);
    try {
      await api(`/api/admin/alerts/${selected.id}/${path}`, json === undefined ? { method: "POST" } : { json });
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-2">
          {alerts?.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No {filter === "all" ? "" : filter} alerts. The simulator injects a detour or long stop into about 15% of demo trips.
            </p>
          )}
          {alerts?.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              className={cn(
                "w-full space-y-1.5 rounded-xl border p-3 text-left text-sm transition-colors",
                selected?.id === a.id ? "border-ring bg-accent/40" : "hover:bg-accent/20",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium">
                  <AlertIcon type={a.alert_type} /> {TYPE_LABEL[a.alert_type]}
                </span>
                <Badge variant="outline" className={STATUS_STYLE[a.status]}>
                  {a.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{detailText(a)}</div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <VehicleTag type={a.vehicle_type} className="text-xs" />
                <span>
                  score {a.anomaly_score.toFixed(2)} · {timeAgo(a.created_at)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <Card className="gap-0 overflow-hidden py-0">
            <div className="h-80">
              <RideMap
                lines={[{ id: "route", points: selected.route, color: "#e8e8e3" }]}
                markers={[
                  ...(selected.route.length
                    ? [
                        { id: "a", kind: "pickup" as const, position: selected.route[0] },
                        { id: "b", kind: "drop" as const, position: selected.route[selected.route.length - 1] },
                      ]
                    : []),
                  ...(selected.details.lat != null && selected.details.lng != null
                    ? [{ id: "where", kind: "rider" as const, position: [selected.details.lat, selected.details.lng] as [number, number], vehicleType: selected.vehicle_type, live: true, label: "Where the alert fired" }]
                    : []),
                ]}
                fitTo={[...selected.route, ...(selected.details.lat != null ? [[selected.details.lat, selected.details.lng!] as [number, number]] : [])]}
                fitKey={selected.id}
              />
            </div>
            <CardHeader className="pt-5">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <AlertIcon type={selected.alert_type} /> {TYPE_LABEL[selected.alert_type]}
                </CardTitle>
                <TripStatusBadge status={selected.trip_status} />
              </div>
              <CardDescription>
                {selected.pickup_address} → {selected.drop_address}
                {selected.rider_name && ` · rider ${selected.rider_name}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pb-5">
              {isPassengerRaised(selected) ? (
                <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {selected.alert_type === "sos" ? `Raised during the trip (${selected.details.trip_status})` : `Category: ${categoryLabel(selected.details.category)}`}
                  </div>
                  <p className="text-pretty">{selected.details.note || "No note from the passenger."}</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <div className="font-semibold tabular-nums">{selected.anomaly_score.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">Anomaly score (≥1 flags)</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <div className="font-semibold tabular-nums">
                      {selected.alert_type === "route_deviation" ? `${selected.details.deviation_km} km` : `${selected.details.stop_minutes} min`}
                    </div>
                    <div className="text-xs text-muted-foreground">{selected.alert_type === "route_deviation" ? "Off route" : "Stopped"}</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <div className="font-semibold tabular-nums">{selected.details.progress_pct}%</div>
                    <div className="text-xs text-muted-foreground">Trip progress</div>
                  </div>
                </div>
              )}

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5" /> AI summary
                  </span>
                  {!selected.summary && (
                    <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => call("summarize", "summary")}>
                      {busy === "summary" && <Loader2 className="animate-spin" />} Summarize
                    </Button>
                  )}
                </div>
                <p className="text-sm text-pretty">{selected.summary ?? "Generate a short summary and recommended action for this alert."}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(["open", "reviewed", "closed"] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={selected.status === s ? "default" : "outline"}
                    disabled={!!busy || selected.status === s}
                    onClick={() => call("status", s, { status: s })}
                  >
                    Mark {s}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
