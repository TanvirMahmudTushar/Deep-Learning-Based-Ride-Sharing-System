"use client";

import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { Plus } from "lucide-react";
import { PortalShell } from "@/components/app-shell";
import { AccountTab } from "@/components/passenger/dashboard/account-tab";
import { OverviewTab } from "@/components/passenger/dashboard/overview";
import { PlacesTab } from "@/components/passenger/dashboard/places-tab";
import { TripsTab } from "@/components/passenger/dashboard/trips-tab";
import { PASSENGER_NAV } from "@/components/passenger/nav";
import { TripDetailDialog } from "@/components/passenger/trip-detail-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Profile } from "@/lib/types";

function PassengerDashboard({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState("overview");
  const [openTrip, setOpenTrip] = useState<string | null>(null);
  const { mutate } = useSWRConfig();

  // A rating or report changes summary and list data; refresh every trip-related key.
  const refreshTrips = () => void mutate((key) => typeof key === "string" && (key.startsWith("/api/trips") || key.startsWith("/api/passenger")));

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full max-w-7xl gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Hi, {profile.full_name.split(" ")[0]}</h1>
            <p className="text-sm text-muted-foreground">Your rides, spending and saved places</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="trips">Trips</TabsTrigger>
              <TabsTrigger value="places">Saved places</TabsTrigger>
              <TabsTrigger value="account">Account</TabsTrigger>
            </TabsList>
            <Button asChild>
              <Link href="/user">
                <Plus /> Book a ride
              </Link>
            </Button>
          </div>
        </div>
        <TabsContent value="overview">
          <OverviewTab onOpenTrip={setOpenTrip} />
        </TabsContent>
        <TabsContent value="trips">
          <TripsTab onOpenTrip={setOpenTrip} />
        </TabsContent>
        <TabsContent value="places">
          <PlacesTab />
        </TabsContent>
        <TabsContent value="account">
          <AccountTab profile={profile} />
        </TabsContent>
      </Tabs>
      <TripDetailDialog tripId={openTrip} onOpenChange={(open) => !open && setOpenTrip(null)} onChanged={refreshTrips} />
    </main>
  );
}

export default function PassengerDashboardPage() {
  return (
    <PortalShell role="user" nav={PASSENGER_NAV}>
      {(profile) => <PassengerDashboard profile={profile} />}
    </PortalShell>
  );
}
