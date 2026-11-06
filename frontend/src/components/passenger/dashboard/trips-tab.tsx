"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import { Loader2, ShieldAlert } from "lucide-react";
import { RatingText, TripStatusBadge, VehicleTag } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatKm, formatTaka } from "@/lib/format";
import type { Trip } from "@/lib/types";

const PAGE = 25;

export function TripsTab({ onOpenTrip }: { onOpenTrip: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const statusParam = filter === "all" ? "" : `&status_filter=${filter}`;
  const { data, size, setSize, isValidating } = useSWRInfinite<Trip[]>(
    (index, previous: Trip[] | null) => (previous && previous.length < PAGE ? null : `/api/trips?limit=${PAGE}&offset=${index * PAGE}${statusParam}`),
    fetcher,
  );
  const trips = data?.flat() ?? [];
  const done = !!data && data[data.length - 1].length < PAGE;

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead className="text-right">Distance</TableHead>
              <TableHead className="text-right">Fare</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Your rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data && trips.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No trips here.
                </TableCell>
              </TableRow>
            )}
            {trips.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() => onOpenTrip(t.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpenTrip(t.id)}
                tabIndex={0}
              >
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.requested_at)}</TableCell>
                <TableCell className="max-w-72">
                  <div className="truncate">
                    {t.pickup_address} → {t.drop_address}
                  </div>
                </TableCell>
                <TableCell>
                  <VehicleTag type={t.vehicle_type} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatKm(t.distance_km)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatTaka(t.fare_final ?? t.fare_estimate)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <TripStatusBadge status={t.status} />
                    {t.has_alert && <ShieldAlert className="size-3.5 text-amber-300" aria-label="Safety review" />}
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  {t.rating != null ? <RatingText rating={t.rating} /> : t.status === "completed" ? <span className="text-muted-foreground">Not rated</span> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {!done && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setSize(size + 1)} disabled={isValidating}>
            {isValidating && <Loader2 className="animate-spin" />} {data ? "Load more" : "Loading…"}
          </Button>
        </div>
      )}
    </div>
  );
}
