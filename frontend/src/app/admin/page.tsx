"use client";

import { useState } from "react";
import useSWR from "swr";
import { PortalShell } from "@/components/app-shell";
import { AlertsTab } from "@/components/admin/alerts-tab";
import { DemandTab } from "@/components/admin/demand-tab";
import { OverviewTab } from "@/components/admin/overview-tab";
import { PaymentsTab } from "@/components/admin/payments-tab";
import { PricingTab } from "@/components/admin/pricing-tab";
import { RidersTab } from "@/components/admin/riders-tab";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetcher } from "@/lib/api";
import { useLiveInterval } from "@/lib/realtime";
import type { AdminStats } from "@/lib/types";

function CountBadge({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <Badge variant="secondary" className="ml-1 h-4 min-w-4 px-1 text-[10px] tabular-nums">
      {n}
    </Badge>
  );
}

function AdminDashboard() {
  const [tab, setTab] = useState("overview");
  const { data: stats } = useSWR<AdminStats>("/api/admin/stats", fetcher, { refreshInterval: useLiveInterval(5000, 30000) });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full max-w-7xl gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Operations</h1>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="riders">
              Riders <CountBadge n={stats?.pending_riders} />
            </TabsTrigger>
            <TabsTrigger value="alerts">
              Safety <CountBadge n={stats?.open_alerts} />
            </TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="demand">Demand</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="riders">
          <RidersTab />
        </TabsContent>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="demand">
          <DemandTab />
        </TabsContent>
        <TabsContent value="pricing">
          <PricingTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}

export default function AdminPage() {
  return <PortalShell role="admin">{() => <AdminDashboard />}</PortalShell>;
}
