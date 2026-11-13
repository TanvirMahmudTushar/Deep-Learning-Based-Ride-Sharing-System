"use client";

import { useEffect, useState } from "react";
import useSWRInfinite from "swr/infinite";
import { Search, X } from "lucide-react";
import { StaffTripDialog } from "@/components/support/trip-detail-dialog";
import { TripHistory } from "@/components/trip-history";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetcher } from "@/lib/api";
import { STATUS_LABEL, VEHICLE_LABEL } from "@/lib/format";
import type { TripPage, TripStatus, VehicleType } from "@/lib/types";

const PAGE_SIZE = 50;
const STATUSES = Object.keys(STATUS_LABEL) as TripStatus[];
const VEHICLES = Object.keys(VEHICLE_LABEL) as VehicleType[];

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** All trips for the support desk: search by passenger, rider or plate, filter, page back, and open one. */
export function TripsTab() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [vehicle, setVehicle] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const q = useDebounced(query.trim(), 300);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status_filter", status);
  if (vehicle !== "all") params.set("vehicle_type", vehicle);
  if (from) params.set("date_from", from);
  if (to) params.set("date_to", to);
  const filters = params.toString();

  const { data, size, setSize, isValidating } = useSWRInfinite<TripPage>(
    (index, previous: TripPage | null) =>
      previous && !previous.has_more ? null : `/api/admin/trips/recent?${filters}${filters ? "&" : ""}offset=${index * PAGE_SIZE}&limit=${PAGE_SIZE}`,
    fetcher,
  );
  const trips = data?.flatMap((p) => p.trips);
  const hasMore = !!data?.[data.length - 1]?.has_more;
  const filtered = !!(q || status !== "all" || vehicle !== "all" || from || to);

  function clear() {
    setQuery("");
    setStatus("all");
    setVehicle("all");
    setFrom("");
    setTo("");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_140px_150px_150px_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="trip-search">Search</Label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="trip-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Passenger, rider or plate number" className="pl-8" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Vehicle</Label>
          <Select value={vehicle} onValueChange={setVehicle}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any vehicle</SelectItem>
              {VEHICLES.map((v) => (
                <SelectItem key={v} value={v}>
                  {VEHICLE_LABEL[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trip-from">From</Label>
          <Input id="trip-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trip-to">To</Label>
          <Input id="trip-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button variant="ghost" disabled={!filtered} onClick={clear}>
          <X /> Clear
        </Button>
      </div>

      <TripHistory trips={trips} empty={filtered ? "No trips match these filters." : "No trips yet."} onSelect={(t) => setOpenTrip(t.id)} showPeople />

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={isValidating} onClick={() => void setSize(size + 1)}>
            Show older trips
          </Button>
        </div>
      )}

      <StaffTripDialog tripId={openTrip} onOpenChange={(open) => !open && setOpenTrip(null)} />
    </div>
  );
}
