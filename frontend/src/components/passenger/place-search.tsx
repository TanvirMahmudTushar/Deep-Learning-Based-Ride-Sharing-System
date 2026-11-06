"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2, LocateFixed, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getCurrentFix } from "@/lib/use-geolocation";
import type { GeoResult } from "@/lib/types";
import type { PlacePoint } from "./booking-panel";

/**
 * Address search on submit (Enter or the button), never per keystroke: the public Nominatim server's
 * usage policy does not allow search-as-you-type.
 */
export function PlaceSearch({ target, onPick }: { target: "pickup" | "drop"; onPick: (which: "pickup" | "drop", p: PlacePoint) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setSearching(true);
    try {
      setResults(await api<GeoResult[]>(`/api/geo/search?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function useMyLocation() {
    setLocating(true);
    try {
      const fix = await getCurrentFix();
      const { label } = await api<{ label: string }>(`/api/geo/reverse?lat=${fix.lat}&lng=${fix.lng}`).catch(() => ({ label: "My location" }));
      onPick("pickup", { lat: fix.lat, lng: fix.lng, label });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not get your location");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${target === "pickup" ? "pickup" : "destination"} (e.g. Bashundhara City)`}
            className="pl-8"
            aria-label="Search for a place"
            maxLength={120}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={searching || q.trim().length < 3}>
          {searching ? <Loader2 className="animate-spin" /> : "Search"}
        </Button>
      </form>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-xs text-muted-foreground" onClick={useMyLocation} disabled={locating}>
        {locating ? <Loader2 className="animate-spin" /> : <LocateFixed />} Use my current location as pickup
      </Button>

      {results && (
        <div className="rounded-lg border">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No places found. Try a landmark or area name, or click the map.</p>
          ) : (
            <ul className="max-h-60 divide-y overflow-y-auto">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 p-2.5 text-left text-sm hover:bg-accent/40"
                    onClick={() => {
                      onPick(target, { lat: r.lat, lng: r.lng, label: r.label });
                      setResults(null);
                      setQ("");
                    }}
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate">{r.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.address}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t px-2.5 py-1.5 text-[10px] text-muted-foreground">Search by OpenStreetMap Nominatim</p>
        </div>
      )}
    </div>
  );
}
