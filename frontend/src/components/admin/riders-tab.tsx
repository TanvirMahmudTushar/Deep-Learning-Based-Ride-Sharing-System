"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Ban, Bot, FileSearch } from "lucide-react";
import { DocumentReviewDialog } from "@/components/admin/document-review";
import { RatingText, VehicleTag } from "@/components/ride-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="verified">Verified</TabsTrigger>
          <TabsTrigger value="suspended">Suspended</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
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
            {riders?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No riders in this list.
                </TableCell>
              </TableRow>
            )}
            {riders?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {r.full_name}
                    {r.is_simulated && (
                      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                        <Bot className="size-3" /> sim
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.is_simulated ? "Simulated rider" : r.email} · joined {formatDateTime(r.joined_at)}
                  </div>
                </TableCell>
                <TableCell>
                  {r.vehicle ? (
                    <div>
                      <VehicleTag type={r.vehicle.vehicle_type} />
                      <div className="text-xs text-muted-foreground">
                        {r.vehicle.model} · <span className="font-mono">{r.vehicle.plate_no}</span>
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.license_no}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_STYLE[r.status]}>
                    {r.status}
                  </Badge>
                  {r.status === "pending" && (
                    <div className="mt-1 text-xs text-muted-foreground">{r.documents_ready ? "Documents approved" : "Documents to review"}</div>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.is_online ? (r.busy ? "On a trip" : "Online") : "Offline"}</TableCell>
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
      </Card>
      <DocumentReviewDialog rider={reviewing} onOpenChange={(open) => !open && setReviewing(null)} onChanged={() => void mutate()} />
    </div>
  );
}
