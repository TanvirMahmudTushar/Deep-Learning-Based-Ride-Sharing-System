"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bot, Check, HandCoins, Loader2 } from "lucide-react";
import { Stat, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { formatDateTime, formatTaka } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import type { PaymentsOverview } from "@/lib/types";

type Balance = PaymentsOverview["balances"][number];

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

export function PaymentsTab() {
  const { data, mutate } = useSWR<PaymentsOverview>("/api/admin/payments", fetcher, { refreshInterval: useLiveInterval(10000, 60000) });
  const [settling, setSettling] = useState<Balance | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  async function resolve(id: string) {
    setResolving(id);
    try {
      await api(`/api/admin/payments/${id}/resolve`, { method: "POST" });
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update payment");
    } finally {
      setResolving(null);
    }
  }

  if (!data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Fares collected today" value={formatTaka(data.today.gross)} hint={`${data.today.trips} trips · ${formatTaka(data.today.commission)} commission`} />
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
          <CardContent className="space-y-2">
            {data.open_payments.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <Badge variant="outline" className={p.status === "disputed" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}>
                  {p.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate">
                  {p.pickup_address} → {p.drop_address}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(p.created_at)}</span>
                <span className="font-medium tabular-nums">{formatTaka(p.amount)}</span>
                <Button size="sm" variant="outline" disabled={resolving === p.id} onClick={() => resolve(p.id)}>
                  {resolving === p.id ? <Loader2 className="animate-spin" /> : <Check />} Mark collected
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="py-0">
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
            {data.balances.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No cash trips yet.
                </TableCell>
              </TableRow>
            )}
            {data.balances.map((b) => (
              <TableRow key={b.rider_id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {b.full_name}
                    {b.is_simulated && <Bot className="size-3.5 text-muted-foreground" aria-label="Simulated rider" />}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.vehicle_type && <VehicleTag type={b.vehicle_type} className="text-xs" />} {b.collected_trips} trips
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
        </Table>
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

      <SettlementDialog balance={settling} onOpenChange={(open) => !open && setSettling(null)} onSaved={() => void mutate()} />
    </div>
  );
}
