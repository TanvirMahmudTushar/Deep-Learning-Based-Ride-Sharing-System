"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Bell,
  BellOff,
  BellRing,
  Bike,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Edit2,
  FileCheck2,
  History,
  IdCard,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ChangePasswordForm } from "@/components/change-password-form";
import { RatingText, Stat, VehicleIcon, VehicleTag } from "@/components/ride-bits";
import { ChangeVehicleScreen } from "@/components/rider/change-vehicle-screen";
import { DocumentsScreen } from "@/components/rider/documents-screen";
import { EditPersonalDetailsScreen } from "@/components/rider/edit-personal-details-screen";
import { TripHistory } from "@/components/trip-history";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetcher } from "@/lib/api";
import { formatPercent, formatTaka, VEHICLE_COLOR } from "@/lib/format";
import { useNotificationPermission } from "@/lib/notifications";
import { clearSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { RiderEarnings, RiderMe, Trip, VehicleChange } from "@/lib/types";

export const OPEN_PROFILE_EVENT = "rider:open-profile";

const STATUS_BADGE: Record<RiderMe["status"], { label: string; className: string }> = {
  verified: { label: "Verified", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  pending: { label: "Pending verification", className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  suspended: { label: "Suspended", className: "border-red-400/30 bg-red-400/10 text-red-200" },
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function Section({
  id,
  icon,
  title,
  action,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 scroll-mt-16 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {icon} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value || "—"}</div>
      </div>
    </div>
  );
}

function NotificationRow() {
  const { permission, request } = useNotificationPermission();
  if (permission === "unsupported") return null;
  const Icon = permission === "granted" ? BellRing : permission === "denied" ? BellOff : Bell;
  const text = permission === "granted" ? "On" : permission === "denied" ? "Blocked in browser settings" : "Off";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Trip notifications</div>
        <div className="text-xs text-muted-foreground">{text}</div>
      </div>
      {permission === "default" && (
        <Button size="sm" variant="outline" onClick={request}>
          Turn on
        </Button>
      )}
    </div>
  );
}

/** Full-screen rider profile. Slides in from the right (right-to-left wipe) over the home screen; vertical scrolling only. */
export function RiderProfile({ onClose, initialSection }: { onClose: () => void; initialSection?: string }) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [activeSubscreen, setActiveSubscreen] = useState<"edit-personal" | "change-vehicle" | "documents" | null>(
    initialSection === "documents" ? "documents" : null,
  );
  const scroller = useRef<HTMLDivElement>(null);

  const { data: me, mutate: refreshMe } = useSWR<RiderMe>("/api/rider/me", fetcher);
  const { data: earnings } = useSWR<RiderEarnings>("/api/rider/earnings", fetcher);
  const { data: vehicleChange } = useSWR<VehicleChange | null>("/api/rider/vehicle-change", fetcher);
  const { data: history } = useSWR<Trip[]>("/api/rider/trips", fetcher);

  function close() {
    setClosing(true);
    setTimeout(onClose, 260);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeSubscreen) {
          setActiveSubscreen(null);
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubscreen]);

  useEffect(() => {
    if (!initialSection || initialSection === "documents") return;
    const t = setTimeout(() => document.getElementById(initialSection)?.scrollIntoView({ behavior: "smooth" }), 350);
    return () => clearTimeout(t);
  }, [initialSection]);

  const status = me ? STATUS_BADGE[me.status] : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rider profile"
      className={cn(
        "fixed inset-0 z-[3000] flex flex-col overflow-hidden bg-background",
        closing ? "profile-wipe-out" : "profile-wipe-in",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
          <ChevronLeft />
        </Button>
        <h1 className="text-base font-semibold">Profile</h1>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none">
        <div className="mx-auto w-full min-w-0 max-w-xl space-y-8 break-words px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          {!me ? (
            <div className="space-y-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : (
            <>
              {/* Identity & Overall stats */}
              <div className="flex flex-col items-center gap-3 text-center">
                <Avatar className="size-24">
                  <AvatarFallback className="text-3xl">{initials(me.full_name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 max-w-full">
                  <div className="text-xl font-semibold">{me.full_name}</div>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
                    <RatingText rating={me.rating} count={me.rating_count} />
                  </div>
                </div>
                {status && (
                  <Badge variant="outline" className={status.className}>
                    <ShieldCheck className="size-3" /> {status.label}
                  </Badge>
                )}
                {me.status === "pending" && !me.documents_ready && (
                  <p className="text-xs text-amber-200">Still needed: {me.missing_documents.join(", ")}</p>
                )}
              </div>

              {/* Lifetime Performance Overview */}
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Total completed" value={`${me.trips_completed} trips`} />
                <Stat label="Rating" value={<RatingText rating={me.rating} count={me.rating_count} />} />
                <Stat label="Cancel rate" value={formatPercent(me.cancel_rate)} hint="Lower rates rank you higher" />
                <Stat
                  label="Commission due"
                  value={formatTaka(Math.max(0, me.commission_due))}
                  hint="Owed to platform"
                />
              </div>

              {/* Section 1: Personal Details with Edit button */}
              <Section
                id="personal"
                icon={<IdCard />}
                title="Personal Details"
                action={
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1.5 text-xs text-primary"
                    onClick={() => setActiveSubscreen("edit-personal")}
                  >
                    <Edit2 className="size-3.5" /> Edit
                  </Button>
                }
              >
                <div className="divide-y rounded-xl border">
                  <InfoRow icon={<Mail />} label="Email Address" value={me.email} />
                  <InfoRow icon={<Phone />} label="Phone Number" value={me.phone} />
                  <InfoRow
                    icon={<IdCard />}
                    label="Driving Licence Number (Fixed)"
                    value={
                      <span className="flex items-center gap-1.5">
                        {me.license_no}
                        <Badge variant="outline" className="text-[10px] py-0 px-1 text-muted-foreground">
                          Verified
                        </Badge>
                      </span>
                    }
                  />
                </div>
              </Section>

              {/* Section 2: Vehicle Details with Change Vehicle Details button */}
              <Section
                id="vehicle"
                icon={me.vehicle ? <VehicleIcon type={me.vehicle.vehicle_type} /> : <Bike />}
                title="Vehicle Details"
                action={
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setActiveSubscreen("change-vehicle")}
                  >
                    <RefreshCw className="size-3.5" /> Change Vehicle
                  </Button>
                }
              >
                {me.vehicle ? (
                  <div className="space-y-3">
                    <div className="flex min-w-0 items-center gap-3 rounded-xl border p-4">
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted">
                        <VehicleIcon
                          type={me.vehicle.vehicle_type}
                          className="size-5"
                          style={{ color: VEHICLE_COLOR[me.vehicle.vehicle_type] }}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{me.vehicle.model}</div>
                        <div className="truncate text-xs text-muted-foreground">Plate: {me.vehicle.plate_no}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <VehicleTag type={me.vehicle.vehicle_type} className="text-xs" />
                        <span className="text-xs text-emerald-300">Verified</span>
                      </div>
                    </div>

                    {/* Pending vehicle change alert banner if exists */}
                    {vehicleChange && vehicleChange.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => setActiveSubscreen("change-vehicle")}
                        className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-left text-xs transition-colors hover:bg-amber-400/15"
                      >
                        <div className="flex items-center gap-2">
                          <Clock className="size-4 shrink-0 text-amber-300" />
                          <div>
                            <span className="font-semibold text-amber-200">Vehicle Change Pending Review</span>
                            <div className="text-muted-foreground">
                              Requested {vehicleChange.model} ({vehicleChange.plate_no})
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center">
                    <p className="text-sm text-muted-foreground">No vehicle registered yet.</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveSubscreen("change-vehicle")}
                    >
                      Register a vehicle
                    </Button>
                  </div>
                )}
              </Section>

              {/* Section 3: Overview Earnings Data (week, month, commission) */}
              <Section id="earnings" icon={<CreditCard />} title="Earnings Overview">
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label="Last 7 days"
                    value={earnings ? formatTaka(earnings.week.earnings) : "—"}
                    hint={earnings ? `${earnings.week.trips} trips` : undefined}
                  />
                  <Stat
                    label="This month"
                    value={earnings ? formatTaka(earnings.month.earnings) : "—"}
                    hint={earnings ? `${earnings.month.trips} trips` : undefined}
                  />
                </div>

                {earnings && (
                  <div className="space-y-2 rounded-xl border p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Platform commission balance</span>
                      <span className="text-base font-semibold tabular-nums">
                        {formatTaka(Math.max(0, earnings.balance.commission_due))}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Platform share: {formatTaka(earnings.balance.commission_total)} total ·{" "}
                      {formatTaka(earnings.balance.settled)} settled to date.
                    </p>
                  </div>
                )}
              </Section>

              {/* Section 4: Documents (Now a menu item navigating to DocumentsScreen) */}
              <Section id="documents" icon={<FileCheck2 />} title="Documents &amp; Verification">
                <button
                  type="button"
                  onClick={() => setActiveSubscreen("documents")}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                      <FileCheck2 className="size-5 text-muted-foreground" />
                    </span>
                    <div>
                      <div className="text-sm font-medium">Licence &amp; Identity Documents</div>
                      <div className="text-xs text-muted-foreground">
                        {me.documents_ready
                          ? "All required documents are approved"
                          : me.missing_documents.length > 0
                            ? `Missing: ${me.missing_documents.join(", ")}`
                            : "Under admin review"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {me.documents_ready ? (
                      <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                        Approved
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-200">
                        Action Needed
                      </Badge>
                    )}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </button>
              </Section>

              {/* Section 5: Trip history */}
              <Section id="history" icon={<History />} title="Trip History">
                <TripHistory trips={history} empty="No trips yet." />
              </Section>

              {/* Section 6: Account & settings */}
              <Section id="account" icon={<KeyRound />} title="Account &amp; Security">
                <div className="divide-y rounded-xl border">
                  <NotificationRow />
                  <button
                    type="button"
                    onClick={() => setChangingPassword((v) => !v)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
                  >
                    <KeyRound className="size-4 text-muted-foreground" /> Change password
                  </button>
                  {changingPassword && (
                    <div className="space-y-2 p-4">
                      <p className="text-xs text-muted-foreground">Changing it logs you out on your other devices.</p>
                      <ChangePasswordForm onDone={() => setChangingPassword(false)} />
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full text-red-300 hover:text-red-200"
                  onClick={() => {
                    clearSession();
                    router.replace("/login");
                  }}
                >
                  <LogOut className="size-4" /> Log out
                </Button>
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Slide-in Subpages */}
      {activeSubscreen === "edit-personal" && me && (
        <EditPersonalDetailsScreen
          me={me}
          onBack={() => setActiveSubscreen(null)}
          onSaved={async () => {
            await refreshMe();
          }}
        />
      )}

      {activeSubscreen === "change-vehicle" && me && (
        <ChangeVehicleScreen
          me={me}
          onBack={() => setActiveSubscreen(null)}
          onSuccess={async () => {
            await refreshMe();
          }}
        />
      )}

      {activeSubscreen === "documents" && (
        <DocumentsScreen onBack={() => setActiveSubscreen(null)} />
      )}
    </div>,
    document.body,
  );
}
