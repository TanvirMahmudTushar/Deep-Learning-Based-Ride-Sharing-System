"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Clock, ShieldOff } from "lucide-react";
import { AlertsTab } from "@/components/admin/alerts-tab";
import { LiveTrips } from "@/components/admin/live-trips";
import { PortalShell } from "@/components/app-shell";
import { CountBadge } from "@/components/ride-bits";
import { TripHistory } from "@/components/trip-history";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetcher } from "@/lib/api";
import { useLiveInterval } from "@/lib/realtime";
import type { Profile, SafetyAlert, Trip } from "@/lib/types";

function NoAccess({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <main className="grid flex-1 place-items-center p-6 text-center">
      <div className="max-w-md space-y-3">
        <div className="flex justify-center text-muted-foreground">{icon}</div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-pretty text-muted-foreground">{body}</p>
      </div>
    </main>
  );
}

function RecentTrips() {
  const { data: trips } = useSWR<Trip[]>("/api/admin/trips/recent", fetcher, { refreshInterval: useLiveInterval(10000, 30000) });
  return <TripHistory trips={trips} empty="No trips yet." />;
}

function SupportDesk() {
  const [tab, setTab] = useState("alerts");
  const { data: open } = useSWR<SafetyAlert[]>("/api/admin/alerts?status_filter=open", fetcher, { refreshInterval: useLiveInterval(5000, 30000) });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full max-w-7xl gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Support</h1>
          <TabsList>
            <TabsTrigger value="alerts">
              Safety and reports <CountBadge n={open?.length} />
            </TabsTrigger>
            <TabsTrigger value="live">Live trips</TabsTrigger>
            <TabsTrigger value="recent">Recent trips</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="alerts">
          <AlertsTab />
        </TabsContent>
        <TabsContent value="live">
          <LiveTrips />
        </TabsContent>
        <TabsContent value="recent">
          <RecentTrips />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function SupportPortal() {
  // Checked from the server, so the page opens as soon as an admin approves and closes when access is removed.
  const { data: me } = useSWR<Profile>("/api/auth/me", fetcher, { refreshInterval: 5000 });

  if (!me) {
    return (
      <main className="flex-1 p-6">
        <Skeleton className="h-96" />
      </main>
    );
  }
  if (me.approval_status === "approved") return <SupportDesk />;
  if (me.approval_status === "revoked") {
    return <NoAccess icon={<ShieldOff className="size-8" />} title="Your access has been removed" body="An admin has removed your support access. Contact them if you think this is a mistake." />;
  }
  return <NoAccess icon={<Clock className="size-8" />} title="Waiting for admin approval" body="Support agents can see other people's trips, so an admin has to approve you first. This page opens by itself once you're approved." />;
}

export default function SupportPage() {
  return <PortalShell role="support">{() => <SupportPortal />}</PortalShell>;
}
