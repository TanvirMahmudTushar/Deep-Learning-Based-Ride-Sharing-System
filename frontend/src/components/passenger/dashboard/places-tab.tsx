"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { RideMap, type MapMarker } from "@/components/map/ride-map";
import { placeIcon, QUICK_PLACE_LABELS } from "@/components/passenger/place-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, fetcher } from "@/lib/api";
import { setPrefill } from "@/lib/prefill";
import type { SavedPlace, Zone } from "@/lib/types";

export function PlacesTab() {
  const router = useRouter();
  const { data: places, mutate } = useSWR<SavedPlace[]>("/api/passenger/places", fetcher);
  const { data: zones = [] } = useSWR<Zone[]>("/api/zones", fetcher);
  const [label, setLabel] = useState("");
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!point) return;
    setSaving(true);
    try {
      await api("/api/passenger/places", { json: { label, ...point } });
      toast.success(`Saved "${label}"`);
      setLabel("");
      setPoint(null);
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save place");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: SavedPlace) {
    try {
      await api(`/api/passenger/places/${p.id}`, { method: "DELETE" });
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete place");
    }
  }

  function book(p: SavedPlace, as: "pickup" | "drop") {
    setPrefill({ [as]: { lat: p.lat, lng: p.lng, label: p.label } });
    router.push("/user");
  }

  const markers: MapMarker[] = [
    ...(places ?? []).map((p) => ({ id: p.id, kind: "place" as const, position: [p.lat, p.lng] as [number, number], label: p.label })),
    ...(point ? [{ id: "new", kind: "place" as const, position: [point.lat, point.lng] as [number, number], label: label || "+" }] : []),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Add a place</CardTitle>
            <CardDescription>Click the map to drop a pin, or pick an area.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="place-label">Name</Label>
                <Input id="place-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required placeholder="Home, Work, Mum's house…" />
                <div className="flex gap-2">
                  {QUICK_PLACE_LABELS.map((q) => (
                    <Button key={q.label} type="button" size="xs" variant="outline" onClick={() => setLabel(q.label)}>
                      <q.icon /> {q.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select
                  value=""
                  onValueChange={(id) => {
                    const z = zones.find((zz) => zz.id.toString() === id);
                    if (z) setPoint({ lat: z.lat, lng: z.lng });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={point ? `Pinned ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}` : "Choose an area or click the map"} />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id.toString()}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={!point || !label.trim() || saving}>
                {saving && <Loader2 className="animate-spin" />} Save place
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved places</CardTitle>
            <CardDescription>They appear as shortcuts when you book.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {places?.length === 0 && <p className="text-sm text-muted-foreground">No saved places yet.</p>}
            {places?.map((p) => {
              const Icon = placeIcon(p.label);
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm">
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{p.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{p.address}</div>
                  </div>
                  <Button size="xs" variant="secondary" onClick={() => book(p, "pickup")}>
                    From here
                  </Button>
                  <Button size="xs" variant="secondary" onClick={() => book(p, "drop")}>
                    Go here
                  </Button>
                  <Button size="icon-xs" variant="ghost" aria-label={`Delete ${p.label}`} onClick={() => remove(p)}>
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-96 overflow-hidden py-0">
        <RideMap
          markers={markers}
          onMapClick={setPoint}
          fitTo={places && places.length ? places.map((p) => [p.lat, p.lng] as [number, number]) : undefined}
          fitKey={places?.map((p) => p.id).join(",")}
        />
      </Card>
    </div>
  );
}
