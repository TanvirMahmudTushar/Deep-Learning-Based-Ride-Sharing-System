"use client";

import useSWR from "swr";
import { Star } from "lucide-react";
import { VehicleTag } from "@/components/ride-bits";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PassengerReview } from "@/lib/types";

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-4", i <= n ? "fill-amber-300 text-amber-300" : "text-muted-foreground/40")} />
      ))}
    </span>
  );
}

/** Every rating the passenger has given, newest first. */
export function ReviewsTab({ onOpenTrip }: { onOpenTrip: (id: string) => void }) {
  const { data: reviews } = useSWR<PassengerReview[]>("/api/passenger/reviews", fetcher);

  if (!reviews) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (reviews.length === 0) {
    return <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">You haven&apos;t rated any rides yet. You can rate a ride from its trip details once it&apos;s finished.</p>;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {reviews.map((r) => (
        <Card
          key={r.trip_id}
          role="button"
          tabIndex={0}
          onClick={() => onOpenTrip(r.trip_id)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenTrip(r.trip_id)}
          className="cursor-pointer gap-2 p-4 transition-colors hover:bg-accent/30"
        >
          <div className="flex items-center justify-between gap-2">
            <Stars n={r.stars} />
            <span className="text-xs text-muted-foreground">{formatDateTime(r.requested_at)}</span>
          </div>
          {r.comment ? <p className="text-sm text-pretty">“{r.comment}”</p> : <p className="text-sm text-muted-foreground">No comment</p>}
          <div className="truncate text-xs text-muted-foreground">
            {r.pickup_address} → {r.drop_address}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <VehicleTag type={r.vehicle_type} className="text-xs" />
            {r.rider_name && <span>Rider: {r.rider_name}</span>}
          </div>
        </Card>
      ))}
    </div>
  );
}
