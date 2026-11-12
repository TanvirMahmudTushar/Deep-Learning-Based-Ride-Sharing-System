"use client";

import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Ban, Bot, FileSearch, Loader2, RotateCcw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { DocumentReviewDialog } from "@/components/admin/document-review";
import { RatingText } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { formatDateTime, formatPercent, formatTaka, VEHICLE_LABEL } from "@/lib/format";
import type { AdminAccount, AdminAccountPage, AdminAccountTripPage, AdminRider } from "@/lib/types";
import { useLiveInterval } from "@/lib/realtime";

const PAGE_SIZE = 50;
const TRIP_PAGE_SIZE = 20;

const STATUS_STYLE: Record<AdminAccount["status"], string> = {
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  verified: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  suspended: "border-red-400/30 bg-red-400/10 text-red-200",
};

function statusLabel(status: AdminAccount["status"]): string {
  return status === "pending" ? "Pending verification" : status === "verified" ? "Verified" : status;
}

function accountAsRider(account: AdminAccount): AdminRider | null {
  if (account.role !== "rider" || !account.rider_id || !account.license_no) return null;
  return {
    id: account.rider_id,
    full_name: account.full_name,
    email: account.email,
    phone: account.phone,
    license_no: account.license_no,
    status: account.status === "suspended" ? "suspended" : account.rider_verification_status ?? "pending",
    is_online: account.is_online,
    is_simulated: account.is_simulated,
    busy: account.busy,
    lat: account.lat,
    lng: account.lng,
    rating: account.rating,
    rating_count: account.rating_count,
    vehicle: account.vehicle,
    joined_at: account.joined_at,
    documents_ready: account.documents_ready,
  };
}

function AccountDetailsDialog({ account, onOpenChange }: { account: AdminAccount | null; onOpenChange: (open: boolean) => void }) {
  const [offset, setOffset] = useState(0);
  const historyKey = account ? `/api/admin/accounts/${account.id}/trips?limit=${TRIP_PAGE_SIZE}&offset=${offset}` : null;
  const { data: history, error, mutate } = useSWR<AdminAccountTripPage>(historyKey, fetcher);

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{account?.full_name ?? "Account details"}</DialogTitle>
          <DialogDescription>
            {account && `${account.role === "user" ? "Passenger" : "Rider"} · ${account.email} · ${statusLabel(account.status)}`}
          </DialogDescription>
        </DialogHeader>
        {account && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total trips" value={account.stats.trips_total} />
              <StatCard label="Completed" value={account.stats.trips_completed} />
              <StatCard label="Cancelled trips" value={account.stats.trips_cancelled} />
              <StatCard
                label="Cancelled by account"
                value={`${account.stats.account_cancellations} · ${formatPercent(account.stats.cancellation_rate)}`}
              />
            </div>
            <Card className="gap-0 py-0">
              <CardHeader className="px-4 pt-4">
                <CardTitle className="text-base">Trip history</CardTitle>
                <CardDescription>
                  Cancellation rate is account-initiated cancellations divided by trips associated with this account.
                  {history ? ` · ${history.total} trips` : ""}
                </CardDescription>
              </CardHeader>
              {error && <p role="alert" className="px-4 pb-3 text-sm text-destructive">Could not load trip history: {error.message}</p>}
              {!history && !error ? (
                <Skeleton className="m-4 h-40 w-auto" />
              ) : !history ? (
                <div className="px-4 pb-4">
                  <Button variant="outline" onClick={() => void mutate()}>Retry</Button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table className="min-w-[850px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Requested</TableHead>
                          <TableHead>Trip</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Distance</TableHead>
                          <TableHead className="text-right">Fare</TableHead>
                          <TableHead>Cancellation</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                              No trips found for this account.
                            </TableCell>
                          </TableRow>
                        ) : history.items.map((trip) => (
                          <TableRow key={trip.id}>
                            <TableCell className="whitespace-nowrap">{formatDateTime(trip.requested_at)}</TableCell>
                            <TableCell>
                              <div className="max-w-72 truncate text-sm" title={`${trip.pickup_address} → ${trip.drop_address}`}>
                                {trip.pickup_address} → {trip.drop_address}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {VEHICLE_LABEL[trip.vehicle_type]} · {trip.id.slice(0, 8)}
                              </div>
                            </TableCell>
                            <TableCell className="capitalize">{trip.status}</TableCell>
                            <TableCell className="text-right tabular-nums">{trip.distance_km.toFixed(1)} km</TableCell>
                            <TableCell className="text-right tabular-nums">{formatTaka(trip.fare_final ?? trip.fare_estimate)}</TableCell>
                            <TableCell className="max-w-56">
                              {trip.status === "cancelled" ? (
                                <>
                                  <div className="text-sm capitalize">{trip.cancelled_by ?? "Unknown"}</div>
                                  {trip.cancel_reason && <div className="truncate text-xs text-muted-foreground" title={trip.cancel_reason}>{trip.cancel_reason}</div>}
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {history.items.length > 0 && (
                    <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
                      <span>
                        Showing {offset + 1}–{offset + history.items.length} of {history.total}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - TRIP_PAGE_SIZE))}>
                          Previous
                        </Button>
                        <Button size="sm" variant="outline" disabled={!history.has_more} onClick={() => setOffset(offset + TRIP_PAGE_SIZE)}>
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function RidersTab() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<AdminRider | null>(null);
  const [inspecting, setInspecting] = useState<AdminAccount | null>(null);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (deferredSearch) params.set("search", deferredSearch);
  if (roleFilter !== "all") params.set("role_filter", roleFilter);
  if (statusFilter !== "all") params.set("status_filter", statusFilter);
  const key = `/api/admin/accounts?${params.toString()}`;
  const { data, error, mutate } = useSWR<AdminAccountPage>(key, fetcher, { refreshInterval: useLiveInterval(5000, 30000) });

  async function changeAccountStatus(account: AdminAccount) {
    const action = account.account_status === "suspended" ? "reactivate" : "suspend";
    setBusy(account.id);
    try {
      await api(`/api/admin/accounts/${account.id}/${action}`, { method: "POST" });
      toast.success(`${account.full_name} ${action === "suspend" ? "suspended" : "reactivated"}`);
      const refreshed = await mutate();
      const updated = refreshed?.items.find((item) => item.id === account.id);
      if (inspecting?.id === account.id) {
        setInspecting(
          updated ??
            ({
              ...account,
              account_status: action === "suspend" ? "suspended" : "active",
              status:
                action === "suspend"
                  ? "suspended"
                  : account.role === "rider"
                    ? account.rider_verification_status ?? "verified"
                    : "active",
            } satisfies AdminAccount),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update account");
    } finally {
      setBusy(null);
    }
  }

  function openDocuments(account: AdminAccount) {
    const rider = accountAsRider(account);
    if (rider) setReviewing(rider);
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-xl border bg-card px-5 py-5 sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute -right-8 -top-10 text-primary/[0.04]" aria-hidden>
          <ShieldCheck className="size-44" strokeWidth={1} />
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="size-3.5 text-emerald-500" />
              Account management
            </div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Users and riders</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search accounts, review rider verification, manage access, and inspect trip and cancellation history.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-background/80 px-3 py-2 text-sm text-muted-foreground">
            <UsersRound className="size-4" />
            <span className="font-medium tabular-nums text-foreground">{data?.total ?? "—"}</span>
            <span>matching accounts</span>
          </div>
        </div>
      </section>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:px-5">
          <div>
            <h3 className="font-medium">Account directory</h3>
            <p className="text-xs text-muted-foreground">Search name, email, licence number, or account ID.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_170px_190px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
                placeholder="Search accounts…"
                aria-label="Search accounts by name, email, licence number, or ID"
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={(value) => { setRoleFilter(value); setOffset(0); }}>
              <SelectTrigger aria-label="Filter by role" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="user">Passengers</SelectItem>
                <SelectItem value="rider">Riders</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setOffset(0); }}>
              <SelectTrigger aria-label="Filter by status" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending verification</SelectItem>
                <SelectItem value="verified">Verified riders</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && <p role="alert" className="p-4 text-sm text-destructive">Could not load accounts: {error.message}</p>}
        {!data && !error ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : !data ? (
          <div className="flex items-center justify-between gap-3 p-5 text-sm text-muted-foreground">
            <span>Account list is unavailable.</span>
            <Button variant="outline" onClick={() => void mutate()}>Retry</Button>
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <span className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <UsersRound className="size-5" />
            </span>
            <p className="font-medium">No accounts found</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different search or filter.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table className="min-w-[1050px]">
                <TableHeader>
                  <TableRow className="bg-muted/10 hover:bg-muted/10">
                    <TableHead>Account</TableHead>
                    <TableHead>Role / status</TableHead>
                    <TableHead>Rider details</TableHead>
                    <TableHead>Trip statistics</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div className="font-medium">{account.full_name}</div>
                        <div className="text-xs text-muted-foreground">{account.email}</div>
                        <div className="text-xs text-muted-foreground">{account.phone}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">Joined {formatDateTime(account.joined_at)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="mb-1 text-sm capitalize">{account.role === "user" ? "Passenger" : "Rider"}</div>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs capitalize ${STATUS_STYLE[account.status]}`}>
                          {statusLabel(account.status)}
                        </span>
                        {account.is_simulated && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Bot className="size-3" /> Simulated</div>}
                      </TableCell>
                      <TableCell>
                        {account.role === "rider" ? (
                          <>
                            <div>{account.vehicle ? VEHICLE_LABEL[account.vehicle.vehicle_type] : "No vehicle"}</div>
                            {account.vehicle && <div className="text-xs text-muted-foreground">{account.vehicle.model} · {account.vehicle.plate_no}</div>}
                            <div className="font-mono text-xs text-muted-foreground">Licence {account.license_no}</div>
                            <div className="text-xs text-muted-foreground">
                              {account.is_online ? (account.busy ? "On a trip" : "Online") : "Offline"} · {account.documents_ready ? "Documents ready" : "Documents incomplete"}
                            </div>
                            <RatingText rating={account.rating} count={account.rating_count} />
                          </>
                        ) : <span className="text-muted-foreground">Passenger account</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{account.stats.trips_completed} completed / {account.stats.trips_total} total</div>
                        <div className="text-xs text-muted-foreground">
                          {account.stats.trips_cancelled} cancelled · {account.stats.account_cancellations} by account ({formatPercent(account.stats.cancellation_rate)})
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => setInspecting(account)}>Inspect</Button>
                          {account.role === "rider" && !account.is_simulated && (
                            <Button size="sm" variant="ghost" onClick={() => openDocuments(account)}>
                              <FileSearch /> {account.status === "pending" ? "Review" : "Documents"}
                            </Button>
                          )}
                          {!account.is_simulated && (
                            <Button
                              size="sm"
                              variant={account.account_status === "suspended" ? "outline" : "ghost"}
                              disabled={busy === account.id}
                              onClick={() => void changeAccountStatus(account)}
                            >
                              {busy === account.id ? (
                                <Loader2 className="animate-spin" />
                              ) : account.account_status === "suspended" ? (
                                <RotateCcw />
                              ) : (
                                <Ban />
                              )}
                              {account.account_status === "suspended" ? "Reactivate" : "Suspend"}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                Showing {offset + 1}–{Math.min(offset + data.items.length, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <Button size="sm" variant="outline" disabled={offset + data.items.length >= data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <AccountDetailsDialog key={inspecting?.id ?? "closed"} account={inspecting} onOpenChange={(open) => !open && setInspecting(null)} />
      <DocumentReviewDialog rider={reviewing} onOpenChange={(open) => !open && setReviewing(null)} onChanged={() => void mutate()} />
    </div>
  );
}
