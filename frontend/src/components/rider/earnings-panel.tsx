"use client";

import useSWR from "swr";
import { Stat, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatDateTime, formatTaka } from "@/lib/format";
import type { PaymentRow, RiderEarnings } from "@/lib/types";

const PAYMENT_BADGE: Record<PaymentRow["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  collected: "border-border bg-muted text-muted-foreground",
  disputed: "border-red-400/30 bg-red-400/10 text-red-200",
};

export function EarningsPanel() {
  const { data } = useSWR<RiderEarnings>("/api/rider/earnings", fetcher);
  if (!data) return <Skeleton className="h-64" />;
  const b = data.balance;
  const daily = data.daily ?? [];
  const maxDay = Math.max(...daily.map((d) => d.earnings), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Today" value={formatTaka(data.today.earnings)} hint={`${data.today.trips} trips`} />
        <Stat label="7 days" value={formatTaka(data.week.earnings)} hint={`${data.week.trips} trips`} />
        <Stat label="This month" value={formatTaka(data.month.earnings)} hint={`${data.month.trips} trips`} />
      </div>

      {daily.length > 0 && (
        <div className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Daily breakdown (last 7 days)</h3>
            <span className="text-xs text-muted-foreground tabular-nums">Gross {formatTaka(data.week.gross)}</span>
          </div>
          <ul className="space-y-2.5">
            {daily.map((d) => {
              const pct = d.earnings > 0 ? Math.max(6, Math.round((d.earnings / maxDay) * 100)) : 0;
              return (
                <li key={d.date} className="space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate">
                      <span className="font-medium">{d.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {d.trips} {d.trips === 1 ? "trip" : "trips"}
                      </span>
                    </div>
                    <span className="shrink-0 font-medium tabular-nums">{formatTaka(d.earnings)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    {pct > 0 && <div className="h-full rounded-full bg-emerald-400/80" style={{ width: `${pct}%` }} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="space-y-2 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Commission owed to the platform</span>
          <span className="text-lg font-semibold tabular-nums">{formatTaka(Math.max(0, b.commission_due))}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          You keep the cash from each trip. The platform&apos;s share ({formatTaka(b.commission_total)} so far) is settled with an admin;{" "}
          {formatTaka(b.settled)} paid to date.
        </p>
        {b.pending_confirmations > 0 && (
          <p className="text-xs text-amber-200">
            {b.pending_confirmations} trip{b.pending_confirmations > 1 ? "s" : ""} waiting for you to confirm the cash.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Recent trips</h3>
        {data.payments.length === 0 && <p className="text-sm text-muted-foreground">No paid trips yet.</p>}
        <ul className="space-y-2">
          {data.payments.map((p) => (
            <li key={p.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{formatDateTime(p.created_at)}</span>
                <Badge variant="outline" className={PAYMENT_BADGE[p.status]}>
                  {p.status === "collected" ? "Cash collected" : p.status}
                </Badge>
              </div>
              <div className="truncate">
                {p.pickup_address} <span className="text-muted-foreground">→</span> {p.drop_address}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <VehicleTag type={p.vehicle_type} className="text-xs" />
                <span className="tabular-nums">
                  Fare {formatTaka(p.amount)} − {p.commission_pct}% ={" "}
                  <span className="font-medium text-foreground">{formatTaka(p.rider_earning)}</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {data.settlements.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Settlements</h3>
          <ul className="space-y-1.5 text-sm">
            {data.settlements.map((s) => (
              <li key={s.id} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
                <span className="min-w-0 truncate text-muted-foreground">
                  {formatDateTime(s.created_at)}
                  {s.note && ` · ${s.note}`}
                </span>
                <span className="shrink-0 tabular-nums">{formatTaka(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
