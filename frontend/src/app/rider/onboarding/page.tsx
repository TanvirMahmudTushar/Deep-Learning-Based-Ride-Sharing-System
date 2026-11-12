"use client";

import { useRouter } from "next/navigation";
import { Suspense, lazy, useEffect, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Car, FileText, Loader2, ShieldCheck } from "lucide-react";
import { PortalShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SPRING_UI } from "@/components/ui/motion";
import { fetcher } from "@/lib/api";
import { useLiveInterval } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import type { RiderMe } from "@/lib/types";

const VehicleStep = lazy(() => import("@/components/rider/onboarding/vehicle-step").then((m) => ({ default: m.VehicleStep })));
const DocumentsStep = lazy(() => import("@/components/rider/onboarding/documents-step").then((m) => ({ default: m.DocumentsStep })));
const VerificationStatusCard = lazy(() =>
  import("@/components/rider/onboarding/verification-status-card").then((m) => ({ default: m.VerificationStatusCard })),
);

type Step = "vehicle" | "documents" | "status";

const STEPS: { key: Step; label: string; icon: typeof Car }[] = [
  { key: "vehicle", label: "Vehicle", icon: Car },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "status", label: "Verification", icon: ShieldCheck },
];

function OnboardingContent() {
  const router = useRouter();
  const interval = useLiveInterval(5000, 30000);
  const { data: me, mutate } = useSWR<RiderMe>("/api/rider/me", fetcher, { refreshInterval: interval });
  const [step, setStep] = useState<Step | null>(null);

  useEffect(() => {
    if (me?.status === "verified") {
      router.replace("/rider");
    }
  }, [me?.status, router]);

  if (!me || me.status === "verified") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasVehicle = !!me.vehicle && !!me.license_no;
  const activeStep: Step = step ?? (hasVehicle ? "documents" : "vehicle");

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => router.push("/rider")}>
            <ArrowLeft className="size-4" /> Back to Rider Portal
          </Button>
          <span className="text-xs font-medium text-muted-foreground">Rider Onboarding</span>
        </div>

        {/* Spring-animated step bar */}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {STEPS.map((s) => {
            const active = activeStep === s.key;
            const Icon = s.icon;
            const locked = s.key !== "vehicle" && !hasVehicle;
            return (
              <button
                key={s.key}
                type="button"
                disabled={locked}
                onClick={() => setStep(s.key)}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors active:scale-[0.97] disabled:opacity-45",
                  active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="onboarding-step-pill"
                    transition={SPRING_UI}
                    className="absolute inset-0 rounded-lg bg-primary shadow-sm"
                  />
                )}
                <Icon className="relative z-10 size-3.5 shrink-0" />
                <span className="relative z-10 truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI}>
          <Card className="overflow-hidden border-border/80 shadow-xl">
            <CardHeader>
              <CardTitle className="text-lg">
                {activeStep === "vehicle"
                  ? "Vehicle & Licence Details"
                  : activeStep === "documents"
                    ? "Upload Required Documents"
                    : "Background Verification Status"}
              </CardTitle>
              <CardDescription>
                {activeStep === "vehicle"
                  ? "Choose your vehicle type and enter registration details."
                  : activeStep === "documents"
                    ? "Upload your driving licence, vehicle insurance, registration, and photo."
                    : "Track your verification progress. The rider app unlocks once verified."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <div className="flex justify-center py-10">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <AnimatePresence mode="wait">
                  {activeStep === "vehicle" && (
                    <VehicleStep
                      key="vehicle"
                      me={me}
                      onSaved={(updated) => {
                        void mutate(updated, false);
                        setStep("documents");
                      }}
                    />
                  )}
                  {activeStep === "documents" && <DocumentsStep key="documents" onNext={() => setStep("status")} />}
                  {activeStep === "status" && (
                    <VerificationStatusCard
                      key="status"
                      me={me}
                      onRefresh={async () => {
                        await mutate();
                      }}
                      onEditStep={(target) => setStep(target)}
                      onEnterApp={() => router.replace("/rider")}
                    />
                  )}
                </AnimatePresence>
              </Suspense>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

export default function RiderOnboardingPage() {
  return (
    <PortalShell role="rider">
      {() => <OnboardingContent />}
    </PortalShell>
  );
}

