"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import useSWR from "swr";
import { ArrowLeft, Printer } from "lucide-react";
import { PortalShell } from "@/components/app-shell";
import { FareBreakdownView } from "@/components/passenger/trip-parts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatKm, formatMinutes, formatTaka, VEHICLE_LABEL } from "@/lib/format";
import type { Trip } from "@/lib/types";

const PAYMENT_LABEL: Record<string, string> = { pending: "Not yet paid", collected: "Paid in cash", disputed: "Under review" };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground print:text-gray-600">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Receipt({ trip }: { trip: Trip }) {
  const adjustment = trip.fee_adjustment ?? 0;
  const fare = trip.fare_final ?? trip.fare_estimate;
  return (
    <article className="space-y-6 rounded-xl border bg-card p-6 print:border-gray-300 print:bg-white print:text-black">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold tracking-tight">Cholo</div>
          <div className="text-sm text-muted-foreground print:text-gray-600">Trip receipt</div>
        </div>
        <div className="text-right text-sm">
          <div>{formatDateTime(trip.requested_at)}</div>
          <div className="font-mono text-xs text-muted-foreground print:text-gray-600">#{trip.id.slice(0, 8).toUpperCase()}</div>
        </div>
      </header>

      <dl className="space-y-1.5">
        <Row label="From" value={trip.pickup_address} />
        <Row label="To" value={trip.drop_address} />
        <Row label="Vehicle" value={VEHICLE_LABEL[trip.vehicle_type]} />
        {trip.rider && <Row label="Rider" value={`${trip.rider.full_name}${trip.rider.vehicle ? ` · ${trip.rider.vehicle.plate_no}` : ""}`} />}
        <Row label="Distance" value={formatKm(trip.distance_km)} />
        {trip.actual_duration_min != null && <Row label="Duration" value={formatMinutes(trip.actual_duration_min)} />}
      </dl>

      <div className="space-y-2 border-t pt-4 print:border-gray-300">
        {trip.fare_breakdown ? <FareBreakdownView breakdown={trip.fare_breakdown} /> : <Row label="Fare" value={formatTaka(fare)} />}
        {adjustment !== 0 && (
          <Row label={adjustment > 0 ? "Late-cancellation fee from an earlier ride" : "Credit from an earlier ride"} value={`${adjustment > 0 ? "+" : "−"}${formatTaka(Math.abs(adjustment))}`} />
        )}
        <div className="flex justify-between border-t pt-2 text-base font-semibold print:border-gray-300">
          <span>Total</span>
          <span className="tabular-nums">{formatTaka(trip.payment?.amount ?? fare + adjustment)}</span>
        </div>
        {trip.payment && <p className="text-sm text-muted-foreground print:text-gray-600">{PAYMENT_LABEL[trip.payment.status] ?? trip.payment.status}</p>}
      </div>
    </article>
  );
}

function ReceiptPage() {
  const tripId = useSearchParams().get("trip");
  const { data: trip, error } = useSWR<Trip>(tripId ? `/api/trips/${tripId}` : null, fetcher);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-4 p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Button variant="ghost" asChild>
          <Link href="/user/dashboard">
            <ArrowLeft /> Back to my trips
          </Link>
        </Button>
        <Button onClick={() => window.print()} disabled={!trip || trip.status !== "completed"}>
          <Printer /> Print or save as PDF
        </Button>
      </div>
      {!tripId || error ? (
        <p className="text-sm text-muted-foreground">Receipt not found.</p>
      ) : !trip ? (
        <Skeleton className="h-96" />
      ) : trip.status !== "completed" ? (
        <p className="text-sm text-muted-foreground">Receipts are available once a trip is completed.</p>
      ) : (
        <Receipt trip={trip} />
      )}
    </main>
  );
}

export default function UserReceiptPage() {
  return (
    <PortalShell role="user">
      {() => (
        <Suspense>
          <ReceiptPage />
        </Suspense>
      )}
    </PortalShell>
  );
}
