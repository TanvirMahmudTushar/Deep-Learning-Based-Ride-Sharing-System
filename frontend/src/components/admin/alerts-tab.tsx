"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, MapPinned, MessageSquareWarning, Phone, Siren, Sparkles, Timer, UserCheck } from "lucide-react";
import { RideMap } from "@/components/map/ride-map";
import { TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, fetcher } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { AlertSummary, SafetyAlert } from "@/lib/types";

export const ALERT_TYPE_LABEL: Record<SafetyAlert["alert_type"], string> = {
  route_deviation: "Route deviation",
  long_stop: "Long stop",
  sos: "Passenger SOS",
  report: "Passenger report",
};

const isPassengerRaised = (a: SafetyAlert) => a.alert_type === "sos" || a.alert_type === "report";

export const ALERT_STATUS_STYLE: Record<SafetyAlert["status"], string> = {
  open: "border-red-400/30 bg-red-400/10 text-red-200",
  reviewed: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  closed: "border-border bg-muted text-muted-foreground",
};

export function AlertIcon({ type }: { type: SafetyAlert["alert_type"] }) {
  if (type === "sos") return <Siren className="size-4 text-red-300" />;
  if (type === "report") return <MessageSquareWarning className="size-4" />;
  return type === "route_deviation" ? <MapPinned className="size-4" /> : <Timer className="size-4" />;
}

const categoryLabel = (c?: string) => (c ? c.replace(/_/g, " ") : "other");

export function alertDetailText(a: Pick<SafetyAlert, "alert_type" | "details">) {
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

function waitingFor(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (60 * 24))} days`;
}

/** How much work is waiting: open alerts by type, how many nobody owns, and the longest wait. */
function QueueSummary() {
  const { data: s } = useSWR<AlertSummary>("/api/admin/alerts/summary", fetcher, { refreshInterval: useLiveInterval(5000, 30000) });
  if (!s) return null;
  const chips: [string, number, boolean][] = [
    ["SOS", s.by_type.sos, s.by_type.sos > 0],
    ["Reports", s.by_type.report, false],
    ["Route deviations", s.by_type.route_deviation, false],
    ["Long stops", s.by_type.long_stop, false],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
      <span className="font-medium">{s.open_total} open</span>
      {chips.map(([label, n, urgent]) => (
        <Badge key={label} variant="outline" className={cn("gap-1 tabular-nums", urgent && "border-red-400/40 bg-red-400/10 text-red-200")}>
          {label} {n}
        </Badge>
      ))}
      <span className="text-muted-foreground">· {s.unassigned} not taken yet</span>
      {s.oldest_open_minutes != null && <span className="text-muted-foreground">· oldest waiting {waitingFor(s.oldest_open_minutes)}</span>}
    </div>
  );
}

function Ownership({ alert, busy, onAction }: { alert: SafetyAlert; busy: boolean; onAction: (path: "claim" | "release") => void }) {
  const session = useSession();
  const me = session.status === "authenticated" ? session.profile : null;
  const owner = alert.assigned_to;
  const mine = !!owner && owner.id === me?.id;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <span className="inline-flex items-center gap-2 text-muted-foreground">
        <UserCheck className="size-4" />
        {!owner ? "Nobody is handling this yet" : mine ? "You're handling this" : `${owner.name} is handling this`}
      </span>
      {!owner && (
        <Button size="sm" disabled={busy} onClick={() => onAction("claim")}>
          Take ownership
        </Button>
      )}
      {mine && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("release")}>
          Release
        </Button>
      )}
      {owner && !mine && me?.role === "admin" && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("claim")}>
          Take over
        </Button>
      )}
    </div>
  );
}

function Notes({ alert, busy, onPost }: { alert: SafetyAlert; busy: boolean; onPost: (body: string, forPassenger: boolean) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const canReply = alert.alert_type === "report";

  async function post(forPassenger: boolean) {
    if (await onPost(text, forPassenger)) setText("");
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">Notes</div>
      {alert.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
      <ul className="space-y-2">
        {alert.notes.map((n) => (
          <li key={n.id} className={cn("space-y-1 rounded-md p-2 text-sm", n.for_passenger ? "bg-sky-400/10" : "bg-muted/50")}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{n.author_name}</span>
              <span>{n.author_role === "admin" ? "Admin" : "Support"}</span>
              <span>· {formatDateTime(n.created_at)}</span>
              <Badge variant="outline" className="ml-auto text-[10px]">
                {n.for_passenger ? "Sent to passenger" : "Internal"}
              </Badge>
            </div>
            <p className="whitespace-pre-wrap text-pretty">{n.body}</p>
          </li>
        ))}
      </ul>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={canReply ? "Add an internal note, or write a reply to the passenger" : "Add an internal note"}
        maxLength={2000}
        rows={3}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => void post(false)}>
          Add internal note
        </Button>
        {canReply && (
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void post(true)}>
            Send reply to passenger
          </Button>
        )}
      </div>
      {canReply && <p className="text-xs text-muted-foreground">The passenger sees replies and the report&apos;s status, never internal notes or who wrote the reply.</p>}
    </div>
  );
}

export function AlertsTab() {
  const [filter, setFilter] = useState("open");
  const key = filter === "all" ? "/api/admin/alerts" : `/api/admin/alerts?status_filter=${filter}`;
  const { data: alerts, mutate } = useSWR<SafetyAlert[]>(key, fetcher, { refreshInterval: useLiveInterval(4000, 30000) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = alerts?.find((a) => a.id === selectedId) ?? alerts?.[0] ?? null;

  async function call(path: string, label: string, json?: unknown): Promise<boolean> {
    if (!selected) return false;
    setBusy(label);
    try {
      await api(`/api/admin/alerts/${selected.id}/${path}`, json === undefined ? { method: "POST" } : { json });
      setSelectedId(selected.id);
      await mutate();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <QueueSummary />
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
              No {filter === "all" ? "" : `${filter} `}alerts. New passenger SOS alerts, reports and safety alerts appear here.
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
                a.alert_type === "sos" && a.status === "open" && "border-red-400/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium">
                  <AlertIcon type={a.alert_type} /> {ALERT_TYPE_LABEL[a.alert_type]}
                </span>
                <Badge variant="outline" className={ALERT_STATUS_STYLE[a.status]}>
                  {a.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">{alertDetailText(a)}</div>
              <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                <VehicleTag type={a.vehicle_type} className="text-xs" />
                <span className="truncate">
                  {a.assigned_to ? `${a.assigned_to.name} · ` : ""}
                  {timeAgo(a.created_at)}
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
                  <AlertIcon type={selected.alert_type} /> {ALERT_TYPE_LABEL[selected.alert_type]}
                </CardTitle>
                <TripStatusBadge status={selected.trip_status} />
              </div>
              <CardDescription className="space-y-1">
                <span className="block">
                  {selected.pickup_address} → {selected.drop_address}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Passenger: {selected.passenger_name}</span>
                  {selected.rider_name && <span>Rider: {selected.rider_name}</span>}
                  {selected.rider_phone && (
                    <a href={`tel:${selected.rider_phone}`} className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline">
                      <Phone className="size-3.5" /> {selected.rider_phone}
                    </a>
                  )}
                </span>
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

              <Ownership alert={selected} busy={!!busy} onAction={(path) => void call(path, path)} />

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5" /> AI summary
                  </span>
                  {!selected.summary && (
                    <Button size="xs" variant="secondary" disabled={!!busy} onClick={() => void call("summarize", "summary")}>
                      {busy === "summary" && <Loader2 className="animate-spin" />} Summarize
                    </Button>
                  )}
                </div>
                <p className="text-sm text-pretty">{selected.summary ?? "Generate a short summary and recommended action for this alert."}</p>
              </div>

              <Notes alert={selected} busy={!!busy} onPost={(body, forPassenger) => call("notes", "note", { body, for_passenger: forPassenger })} />

              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {(["open", "reviewed", "closed"] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={selected.status === s ? "default" : "outline"}
                      disabled={!!busy || selected.status === s}
                      onClick={() => void call("status", s, { status: s })}
                    >
                      Mark {s}
                    </Button>
                  ))}
                </div>
                {selected.last_changed_by && <p className="text-xs text-muted-foreground">Status last changed by {selected.last_changed_by}</p>}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
