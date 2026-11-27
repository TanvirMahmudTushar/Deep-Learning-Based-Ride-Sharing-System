"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle, Ban, Bot, Check, HandCoins, Loader2, Phone, Scale, ShieldCheck, User } from "lucide-react";
import { CountBadge, Stat, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fetcher } from "@/lib/api";
import { VEHICLE_COLOR, formatDateTime, formatTaka, plural } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminCancelFee, OpenPaymentRow, PaymentResolutionAction, PaymentsOverview } from "@/lib/types";

type Balance = PaymentsOverview["balances"][number];
type VehicleCategory = "all" | "car" | "bike" | "other";

const CATEGORY_META: { key: VehicleCategory; label: string; dotColor?: string }[] = [
  { key: "all", label: "All" },
  { key: "car", label: "Car", dotColor: VEHICLE_COLOR.car },
  { key: "bike", label: "Bike", dotColor: VEHICLE_COLOR.bike },
  { key: "other", label: "Other", dotColor: VEHICLE_COLOR.cng },
];

function getVehicleCategory(vehicleType: Balance["vehicle_type"]): Exclude<VehicleCategory, "all"> {
  if (vehicleType === "car") return "car";
  if (vehicleType === "bike") return "bike";
  return "other";
}

function summarizeBalances(rows: Balance[]) {
  return rows.reduce(
    (acc, b) => {
      acc.gross_collected += b.gross_collected;
      acc.rider_earnings += b.rider_earnings;
      acc.commission_total += b.commission_total;
      acc.settled += b.settled;
      acc.commission_due += Math.max(0, b.commission_due);
      return acc;
    },
    { gross_collected: 0, rider_earnings: 0, commission_total: 0, settled: 0, commission_due: 0 },
  );
}

function SettlementDialog({ balance, onOpenChange, onSaved }: { balance: Balance | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  // null = untouched: use the amount the rider owes.
  const [amount, setAmount] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const value = amount ?? String(Math.max(0, balance?.commission_due ?? 0));

  function close() {
    setAmount(null);
    setNote("");
    onOpenChange(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!balance) return;
    setSaving(true);
    try {
      await api(`/api/admin/riders/${balance.rider_id}/settlements`, { json: { amount: Number(value), note } });
      toast.success(`Recorded ${formatTaka(Number(value))} from ${balance.full_name}`);
      onSaved();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record settlement");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!balance} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Record settlement</DialogTitle>
            <DialogDescription>
              {balance?.full_name} owes {formatTaka(Math.max(0, balance?.commission_due ?? 0))} in commission from cash trips.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="settle-amount">Amount received (৳)</Label>
            <Input
              id="settle-amount"
              type="number"
              min={1}
              step="1"
              required
              value={value}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settle-note">Note</Label>
            <Input id="settle-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="bKash TrxID, cash at office…" maxLength={200} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Record
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const RESOLUTION_META: Record<
  PaymentResolutionAction,
  { label: string; description: string; noteRequired: boolean; notePlaceholder: string; successLabel: string }
> = {
  mark_settled: {
    label: "Mark settled",
    description: "Confirm that cash has been collected from the passenger and add it to the rider's ledger.",
    noteRequired: false,
    notePlaceholder: "Confirmed with rider and passenger…",
    successLabel: "Payment marked as settled",
  },
  resolve_dispute: {
    label: "Resolve dispute",
    description: "Close the passenger's fare dispute and mark the payment as collected.",
    noteRequired: true,
    notePlaceholder: "Verified fare with both parties, dispute closed…",
    successLabel: "Dispute resolved",
  },
  apply_adjustment: {
    label: "Adjust fare",
    description: "Update the final collected fare and recalculate platform commission and rider earning.",
    noteRequired: true,
    notePlaceholder: "Reason for fare adjustment…",
    successLabel: "Fare adjusted and settled",
  },
  waive_balance: {
    label: "Waive balance",
    description: "Write off this unpaid or disputed balance (commission and rider earning become ৳0).",
    noteRequired: true,
    notePlaceholder: "Reason for waiving balance…",
    successLabel: "Balance waived",
  },
};

function PaymentResolutionDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { payment: OpenPaymentRow; action: PaymentResolutionAction } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [action, setAction] = useState<PaymentResolutionAction>("mark_settled");
  const [note, setNote] = useState("");
  const [adjustedAmount, setAdjustedAmount] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [lastTargetId, setLastTargetId] = useState<string | null>(null);
  const [lastTargetAction, setLastTargetAction] = useState<PaymentResolutionAction | null>(null);
  if (target && (target.payment.id !== lastTargetId || target.action !== lastTargetAction)) {
    setLastTargetId(target.payment.id);
    setLastTargetAction(target.action);
    setAction(target.action);
    setAdjustedAmount(String(Math.max(0, target.payment.amount)));
    setNote("");
  }

  function close() {
    setNote("");
    setAdjustedAmount("");
    setLastTargetId(null);
    setLastTargetAction(null);
    onClose();
  }

  if (!target) return null;
  const p = target.payment;
  const meta = RESOLUTION_META[action];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (meta.noteRequired && !note.trim()) {
      toast.error("Please enter an audit note");
      return;
    }
    if (action === "apply_adjustment") {
      const parsed = Number(adjustedAmount);
      if (Number.isNaN(parsed) || parsed < 0) {
        toast.error("Enter a valid adjusted amount");
        return;
      }
    }
    setSaving(true);
    try {
      await api(`/api/admin/payments/${p.id}/resolve`, {
        method: "POST",
        json: {
          action,
          note: note.trim(),
          adjusted_amount: action === "apply_adjustment" ? Number(adjustedAmount) : undefined,
        },
      });
      toast.success(meta.successLabel);
      onSaved();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resolve payment");
    } finally {
      setSaving(false);
    }
  }

  const availableActions: PaymentResolutionAction[] =
    p.status === "disputed"
      ? ["resolve_dispute", "apply_adjustment", "waive_balance", "mark_settled"]
      : ["mark_settled", "apply_adjustment", "waive_balance"];

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{meta.label}</DialogTitle>
            <DialogDescription>{meta.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-xs">
            <div className="flex items-center justify-between gap-2 font-medium text-foreground">
              <span className="truncate">
                {p.pickup_address} → {p.drop_address}
              </span>
              <span className="shrink-0 tabular-nums">{formatTaka(p.amount)}</span>
            </div>
            <div className="text-muted-foreground">
              Rider: {p.rider_name} ({p.rider_phone || "No phone"}) · Passenger: {p.passenger_name} ({p.passenger_phone || "No phone"})
            </div>
            {p.dispute_note && (
              <div className="rounded bg-red-400/10 px-2 py-1 text-red-200">
                Dispute{p.dispute_reason ? ` (${p.dispute_reason})` : ""}: {p.dispute_note}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Resolution action</Label>
            <div className="flex flex-wrap gap-1.5">
              {availableActions.map((a) => (
                <Button key={a} type="button" size="xs" variant={action === a ? "default" : "outline"} onClick={() => setAction(a)}>
                  {RESOLUTION_META[a].label}
                </Button>
              ))}
            </div>
          </div>

          {action === "apply_adjustment" && (
            <div className="space-y-2">
              <Label htmlFor="adjust-amount">Adjusted fare amount (৳)</Label>
              <Input
                id="adjust-amount"
                type="number"
                min={0}
                step="1"
                required
                value={adjustedAmount}
                onChange={(e) => setAdjustedAmount(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="resolve-note">
              Audit note {meta.noteRequired ? <span className="text-red-300">*</span> : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Input
              id="resolve-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={meta.notePlaceholder}
              required={meta.noteRequired}
              maxLength={500}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />} Confirm {meta.label.toLowerCase()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentsTab() {
  const { data, mutate } = useSWR<PaymentsOverview>("/api/admin/payments", fetcher, { refreshInterval: useLiveInterval(10000, 60000) });
  const [settling, setSettling] = useState<Balance | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<{ payment: OpenPaymentRow; action: PaymentResolutionAction } | null>(null);
  const [category, setCategory] = useState<VehicleCategory>("all");

  if (!data) return <Skeleton className="h-96" />;

  const grouped: Record<Exclude<VehicleCategory, "all">, Balance[]> = { car: [], bike: [], other: [] };
  for (const b of data.balances) {
    grouped[getVehicleCategory(b.vehicle_type)].push(b);
  }
  const visibleBalances = category === "all" ? data.balances : grouped[category];
  const visibleTotals = summarizeBalances(visibleBalances);
  const categoryCounts: Record<VehicleCategory, number> = {
    all: data.balances.length,
    car: grouped.car.length,
    bike: grouped.bike.length,
    other: grouped.other.length,
  };
  const activeMeta = CATEGORY_META.find((c) => c.key === category)!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fares collected today" value={formatTaka(data.today.gross)} hint={`${plural(data.today.trips, "trip")} · ${formatTaka(data.today.commission)} commission`} />
        <Stat label="Last 7 days" value={formatTaka(data.week.gross)} hint={`${formatTaka(data.week.commission)} commission`} />
        <Stat label="This month" value={formatTaka(data.month.gross)} hint={`${formatTaka(data.month.commission)} commission`} />
        <Stat label="Commission outstanding" value={formatTaka(data.commission_outstanding)} hint="Held by riders as cash" />
      </div>

      {data.open_payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>Cash not yet confirmed by the rider, or disputed by the passenger</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.open_payments.map((p) => (
              <div key={p.id} className="space-y-2.5 rounded-lg border p-3.5 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant="outline" className={p.status === "disputed" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}>
                      {p.status}
                    </Badge>
                    <VehicleTag type={p.vehicle_type} className="text-xs" />
                    <span className="truncate font-medium">
                      {p.pickup_address} → {p.drop_address}
                    </span>
                    <span className="text-xs text-muted-foreground">({p.distance_km.toFixed(1)} km)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{formatDateTime(p.created_at)}</span>
                    <span className="font-semibold tabular-nums">{formatTaka(p.amount)}</span>
                  </div>
                </div>

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5">
                    <User className="size-3.5 text-foreground" />
                    <span className="font-medium text-foreground">Rider:</span>
                    <span>{p.rider_name}</span>
                    {p.rider_is_simulated && <Bot className="size-3.5 text-muted-foreground" aria-label="Simulated rider" />}
                    {p.rider_phone && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        · <Phone className="size-3" /> {p.rider_phone}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5">
                    <User className="size-3.5 text-foreground" />
                    <span className="font-medium text-foreground">Passenger:</span>
                    <span>{p.passenger_name}</span>
                    {p.passenger_phone && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        · <Phone className="size-3" /> {p.passenger_phone}
                      </span>
                    )}
                  </div>
                </div>

                {(p.status === "disputed" || p.dispute_note) && (
                  <div className="flex items-start gap-2 rounded-md border border-red-400/20 bg-red-400/10 px-2.5 py-2 text-xs text-red-200">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <div>
                      <span className="font-medium">Dispute{p.dispute_reason ? ` (${p.dispute_reason})` : ""}: </span>
                      <span>{p.dispute_note || "Passenger reported a fare issue."}</span>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
                  {p.status === "disputed" ? (
                    <Button size="sm" variant="default" onClick={() => setResolutionTarget({ payment: p, action: "resolve_dispute" })}>
                      <ShieldCheck /> Resolve dispute
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setResolutionTarget({ payment: p, action: "mark_settled" })}>
                      <Check /> Mark settled
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setResolutionTarget({ payment: p, action: "apply_adjustment" })}>
                    <Scale /> Adjust fare
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResolutionTarget({ payment: p, action: "waive_balance" })}>
                    <Ban /> Waive balance
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Rider cash &amp; settlements</CardTitle>
              <CardDescription>Cash collected, rider earnings, commission, and settlement status by vehicle category</CardDescription>
            </div>
            <Tabs value={category} onValueChange={(v) => setCategory(v as VehicleCategory)} className="w-full sm:w-auto">
              <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
                {CATEGORY_META.map((c) => (
                  <TabsTrigger key={c.key} value={c.key} className="gap-1.5 px-2.5 py-1 text-xs sm:text-sm">
                    {c.dotColor && <span className="size-2 shrink-0 rounded-full" style={{ background: c.dotColor }} aria-hidden />}
                    <span>{c.label}</span>
                    <CountBadge n={categoryCounts[c.key]} />
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {category === "all" && data.balances.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {CATEGORY_META.filter((c): c is { key: Exclude<VehicleCategory, "all">; label: string; dotColor?: string } => c.key !== "all").map((c) => {
                const rows = grouped[c.key];
                const sub = summarizeBalances(rows);
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className="flex flex-col gap-1 rounded-lg border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        {c.dotColor && <span className="size-2 rounded-full" style={{ background: c.dotColor }} aria-hidden />}
                        {c.label}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{plural(rows.length, "rider")}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        Cash <span className="font-medium text-foreground tabular-nums">{formatTaka(sub.gross_collected)}</span>
                      </span>
                      <span>
                        Due <span className="font-semibold text-foreground tabular-nums">{formatTaka(sub.commission_due)}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardHeader>

        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rider</TableHead>
                <TableHead className="text-right">Cash collected</TableHead>
                <TableHead className="text-right">Rider earnings</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Settled</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleBalances.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {data.balances.length === 0 ? "No cash trips yet." : `No ${activeMeta.label.toLowerCase()} riders with cash trips yet.`}
                  </TableCell>
                </TableRow>
              )}
              {visibleBalances.map((b) => (
                <TableRow key={b.rider_id}>
                  <TableCell>
                    <div className="flex items-center gap-2 font-medium">
                      {b.full_name}
                      {b.is_simulated && <Bot className="size-3.5 text-muted-foreground" aria-label="Simulated rider" />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.vehicle_type ? (
                        <VehicleTag type={b.vehicle_type} className="text-xs" />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="size-2 rounded-full bg-muted-foreground/50" aria-hidden />
                          Other
                        </span>
                      )}{" "}
                      · {plural(b.collected_trips, "trip")}
                      {b.pending_confirmations > 0 && ` · ${b.pending_confirmations} unconfirmed`}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(b.gross_collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(b.rider_earnings)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(b.commission_total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(b.settled)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatTaka(Math.max(0, b.commission_due))}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" disabled={b.commission_due <= 0} onClick={() => setSettling(b)}>
                      <HandCoins /> Settle
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            {visibleBalances.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">
                    {category === "all" ? "All riders total" : `${activeMeta.label} subtotal`} ({plural(visibleBalances.length, "rider")})
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(visibleTotals.gross_collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(visibleTotals.rider_earnings)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(visibleTotals.commission_total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTaka(visibleTotals.settled)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatTaka(visibleTotals.commission_due)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {data.settlements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent settlements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {data.settlements.map((s) => (
              <div key={s.id} className="flex justify-between rounded-lg bg-muted/50 px-3 py-2">
                <span>
                  {s.rider_name}
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateTime(s.created_at)}
                    {s.note && ` · ${s.note}`}
                  </span>
                </span>
                <span className="tabular-nums">{formatTaka(s.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <CancelFeesCard />

      <SettlementDialog balance={settling} onOpenChange={(open) => !open && setSettling(null)} onSaved={() => void mutate()} />
      <PaymentResolutionDialog target={resolutionTarget} onClose={() => setResolutionTarget(null)} onSaved={() => void mutate()} />
    </div>
  );
}

const FEE_STATUS: Record<AdminCancelFee["status"], string> = {
  owed: "Owed",
  paid: "Paid",
  waived: "Waived",
  credited: "Refunded as credit",
  credit_used: "Credit used",
};

/** Late-cancellation fees, with a waive button: dropping a fee still owed, or refunding a paid one as credit. */
function CancelFeesCard() {
  const { data: fees, mutate } = useSWR<AdminCancelFee[]>("/api/admin/cancel-fees", fetcher);
  const [busy, setBusy] = useState<string | null>(null);

  async function waive(fee: AdminCancelFee) {
    setBusy(fee.trip_id);
    try {
      const res = await api<{ status: AdminCancelFee["status"] }>(`/api/admin/trips/${fee.trip_id}/cancel-fee/waive`, { method: "POST" });
      toast.success(res.status === "credited" ? `${fee.passenger_name} gets a ${formatTaka(fee.fee)} credit on their next ride` : "Fee waived");
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not waive the fee");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Late-cancellation fees</CardTitle>
        <CardDescription>Added to the passenger&apos;s next ride. Waiving a paid fee refunds it as credit on their next ride.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {fees?.length === 0 && <p className="text-muted-foreground">No late cancellations yet.</p>}
        {fees?.map((f) => (
          <div key={f.trip_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="min-w-0">
              {f.passenger_name}
              <span className="text-muted-foreground">
                {" "}
                · {formatDateTime(f.cancelled_at)} · {f.cancel_reason?.replace("Cancelled by passenger: ", "") ?? "No reason"}
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular-nums">{formatTaka(f.fee)}</span>
              <Badge variant="outline">{FEE_STATUS[f.status]}</Badge>
              {(f.status === "owed" || f.status === "paid") && (
                <Button size="xs" variant="secondary" disabled={busy === f.trip_id} onClick={() => void waive(f)}>
                  {f.status === "owed" ? "Waive" : "Refund as credit"}
                </Button>
              )}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
