"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Ban, Bot, Clock3, FileSearch, ShieldCheck, UsersRound } from "lucide-react";
import { DocumentReviewDialog } from "@/components/admin/document-review";
import { RatingText, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminRider } from "@/lib/types";

const STATUS_STYLE: Record<AdminRider["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  verified: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  suspended: "border-red-400/30 bg-red-400/10 text-red-200",
};

export function RidersTab() {
  const [filter, setFilter] = useState("all");
  const key = filter === "all" ? "/api/admin/riders" : `/api/admin/riders?status_filter=${filter}`;
  const { data: riders, mutate } = useSWR<AdminRider[]>(key, fetcher, { refreshInterval: useLiveInterval(5000, 30000) });
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<AdminRider | null>(null);

  async function suspend(r: AdminRider) {
    setBusy(r.id);
    try {
      await api(`/api/admin/riders/${r.id}/suspend`, { method: "POST" });
      toast.success(`${r.full_name} suspended`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
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
              Rider management
            </div>
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Rider verification</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Review rider documents, verify accounts, and manage access to the platform.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-background/80 px-3 py-2 text-sm text-muted-foreground">
            <UsersRound className="size-4" />
            <span className="font-medium tabular-nums text-foreground">{riders?.length ?? "—"}</span>
            <span>{filter === "all" ? "riders" : `${filter} riders`}</span>
          </div>
        </div>
      </section>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h3 className="font-medium">Rider accounts</h3>
            <p className="text-xs text-muted-foreground">Select a rider to inspect submitted documents.</p>
          </div>
          <Tabs value={filter} onValueChange={setFilter} className="w-full sm:w-auto">
            <TabsList className="grid w-full grid-cols-4 sm:flex sm:w-fit">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="pending" className="px-1 text-xs sm:px-1.5 sm:text-sm">Pending</TabsTrigger>
              <TabsTrigger value="verified" className="px-1 text-xs sm:px-1.5 sm:text-sm">Verified</TabsTrigger>
              <TabsTrigger value="suspended" className="px-1 text-xs sm:px-1.5 sm:text-sm">Suspended</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="space-y-3 p-3 xl:hidden">
          {!riders && Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-3 rounded-lg border p-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
          {riders?.length === 0 && (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <span className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                <UsersRound className="size-5" />
              </span>
              <p className="font-medium">No {filter === "all" ? "" : `${filter} `}riders found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {filter === "pending" ? "New verification requests will appear here." : "Try another status filter to find rider accounts."}
              </p>
            </div>
          )}
          {riders?.map((r) => (
            <article key={r.id} className="space-y-3 rounded-lg border bg-background p-3.5">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {r.full_name.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      <span className="break-words">{r.full_name}</span>
                      {r.is_simulated && (
                        <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                          <Bot className="size-3" /> sim
                        </Badge>
                      )}
                    </div>
                    <p className="break-all text-xs text-muted-foreground">
                      {r.is_simulated ? "Simulated rider" : r.email}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={`shrink-0 capitalize ${STATUS_STYLE[r.status]}`}>
                  {r.status}
                </Badge>
              </div>

              {r.status === "pending" && (
                <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock3 className="size-3.5" />
                  {r.documents_ready ? "Documents approved" : "Documents to review"}
                </p>
              )}

              <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-y py-3 text-sm">
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Vehicle</p>
                  {r.vehicle ? (
                    <>
                      <VehicleTag type={r.vehicle.vehicle_type} />
                      <p className="break-words text-xs text-muted-foreground">
                        {r.vehicle.model} · <span className="font-mono">{r.vehicle.plate_no}</span>
                      </p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No vehicle</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Licence</p>
                  <p className="break-all font-mono text-xs">{r.license_no}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Availability</p>
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`size-2 rounded-full ${
                        r.is_online ? (r.busy ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40"
                      }`}
                      aria-hidden
                    />
                    <span>{r.is_online ? (r.busy ? "On a trip" : "Online") : "Offline"}</span>
                  </span>
                </div>
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Rating</p>
                  <RatingText rating={r.rating} count={r.rating_count} />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {!r.is_simulated && (
                  <Button
                    size="sm"
                    className="flex-1"
                    variant={r.status === "verified" ? "outline" : "default"}
                    onClick={() => setReviewing(r)}
                  >
                    <FileSearch /> {r.status === "verified" ? "Documents" : "Review documents"}
                  </Button>
                )}
                {r.status === "verified" && (
                  <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => suspend(r)}>
                    <Ban /> Suspend
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Joined {formatDateTime(r.joined_at)}</p>
            </article>
          ))}
        </div>
        <div className="hidden xl:block">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow className="bg-muted/10 hover:bg-muted/10">
              <TableHead>Rider</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Licence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Availability</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!riders && Array.from({ length: 4 }, (_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7} className="py-3">
                  <Skeleton className="h-8 w-full" />
                </TableCell>
              </TableRow>
            ))}
            {riders?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-14 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center">
                    <span className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
                      <UsersRound className="size-5" />
                    </span>
                    <p className="font-medium">No {filter === "all" ? "" : `${filter} `}riders found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {filter === "pending" ? "New verification requests will appear here." : "Try another status filter to find rider accounts."}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {riders?.map((r) => (
              <TableRow key={r.id} className="group">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {r.full_name.trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="truncate">{r.full_name}</span>
                        {r.is_simulated && (
                          <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                            <Bot className="size-3" /> sim
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {r.is_simulated ? "Simulated rider" : r.email}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Joined {formatDateTime(r.joined_at)}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {r.vehicle ? (
                    <div>
                      <VehicleTag type={r.vehicle.vehicle_type} />
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {r.vehicle.model} · <span className="font-mono">{r.vehicle.plate_no}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">No vehicle</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.license_no}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_STYLE[r.status]}>
                    {r.status}
                  </Badge>
                  {r.status === "pending" && (
                    <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="size-3" />
                      {r.documents_ready ? "Documents approved" : "Documents to review"}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2 text-sm">
                    <span
                      className={`size-2 rounded-full ${
                        r.is_online ? (r.busy ? "bg-amber-500" : "bg-emerald-500") : "bg-muted-foreground/40"
                      }`}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">
                      {r.is_online ? (r.busy ? "On a trip" : "Online") : "Offline"}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-sm">
                  <RatingText rating={r.rating} count={r.rating_count} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {!r.is_simulated && (
                      <Button size="sm" variant={r.status === "verified" ? "ghost" : "default"} onClick={() => setReviewing(r)}>
                        <FileSearch /> {r.status === "verified" ? "Documents" : "Review"}
                      </Button>
                    )}
                    {r.status === "verified" && (
                      <Button size="sm" variant="ghost" disabled={busy === r.id} onClick={() => suspend(r)}>
                        <Ban /> Suspend
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Card>
      <DocumentReviewDialog rider={reviewing} onOpenChange={(open) => !open && setReviewing(null)} onChanged={() => void mutate()} />
    </div>
  );
}
