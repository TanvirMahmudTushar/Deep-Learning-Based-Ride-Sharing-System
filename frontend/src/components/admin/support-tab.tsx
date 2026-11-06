"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Ban, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminSupportAgent } from "@/lib/types";

const STATUS_STYLE: Record<AdminSupportAgent["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  revoked: "border-red-400/30 bg-red-400/10 text-red-200",
};

const STATUS_LABEL: Record<AdminSupportAgent["status"], string> = { pending: "Pending", approved: "Approved", revoked: "Access removed" };

export function SupportTab() {
  const { data: agents, mutate } = useSWR<AdminSupportAgent[]>("/api/admin/support-agents", fetcher, { refreshInterval: useLiveInterval(5000, 30000) });
  const [busy, setBusy] = useState<string | null>(null);

  async function act(agent: AdminSupportAgent, action: "approve" | "revoke") {
    setBusy(agent.id);
    try {
      await api(`/api/admin/support-agents/${agent.id}/${action}`, { method: "POST" });
      toast.success(action === "approve" ? `${agent.full_name} approved` : `Access removed for ${agent.full_name}`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Approved agents can see live and recent trips, including passenger and rider names, trip addresses and rider phone numbers, and can work on safety alerts and reports. They can&apos;t open pricing, payments, revenue, demand or rider documents.
      </p>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No support agents have signed up yet.
                </TableCell>
              </TableRow>
            )}
            {agents?.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="font-medium">{a.full_name}</div>
                  <div className="text-xs text-muted-foreground">{a.email}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{a.phone}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDateTime(a.joined_at)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_STYLE[a.status]}>
                    {STATUS_LABEL[a.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {a.status !== "approved" && (
                      <Button size="sm" disabled={busy === a.id} onClick={() => act(a, "approve")}>
                        <Check /> Approve
                      </Button>
                    )}
                    {a.status === "approved" && (
                      <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => act(a, "revoke")}>
                        <Ban /> Remove access
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
