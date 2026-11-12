"use client";

import { useState } from "react";
import useSWR from "swr";
import { motion } from "framer-motion";
import { CheckCircle2, Clock, RefreshCw, ShieldAlert, ShieldCheck, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPRING_BOUNCY, SPRING_UI } from "@/components/ui/motion";
import { fetcher } from "@/lib/api";
import { VEHICLE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentsOverview, RiderMe } from "@/lib/types";

export function VerificationStatusCard({
  me,
  onRefresh,
  onEnterApp,
  onEditStep,
}: {
  me: RiderMe;
  onRefresh: () => Promise<void>;
  onEnterApp: () => void;
  onEditStep: (step: "vehicle" | "documents") => void;
}) {
  const { data: docs, mutate: refreshDocs } = useSWR<DocumentsOverview>("/api/rider/documents", fetcher);
  const [checking, setChecking] = useState(false);

  const hasVehicle = !!me.vehicle && !!me.license_no;
  const uploadedCount = docs ? docs.required.filter((d) => d.document !== null).length : 0;
  const totalDocs = docs ? docs.required.length : 4;
  const allUploaded = docs ? uploadedCount === totalDocs : false;
  const verified = me.status === "verified";
  const suspended = me.status === "suspended";

  const steps = [
    { label: "Account & Phone OTP", done: true, detail: "Verified" },
    {
      label: "Vehicle Details",
      done: hasVehicle,
      detail: me.vehicle ? `${VEHICLE_LABEL[me.vehicle.vehicle_type]} · ${me.vehicle.plate_no}` : "Pending",
    },
    {
      label: "Documents Uploaded",
      done: allUploaded,
      detail: me.documents_ready ? "All approved" : `${uploadedCount}/${totalDocs} uploaded`,
    },
    {
      label: "Background & Admin Verification",
      done: verified,
      detail: verified ? "Verified" : suspended ? "Suspended" : "In review",
    },
  ];

  async function handleRefresh() {
    setChecking(true);
    try {
      await Promise.all([onRefresh(), refreshDocs()]);
      toast.success(verified ? "Your account is verified!" : "Status refreshed");
    } finally {
      setChecking(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING_UI}
      className="space-y-5"
    >
      <div
        className={cn(
          "flex items-start gap-3.5 rounded-2xl border p-4",
          verified
            ? "border-emerald-400/35 bg-emerald-500/10"
            : suspended
              ? "border-red-400/40 bg-red-500/10"
              : "border-amber-400/35 bg-amber-500/10",
        )}
      >
        <motion.span
          initial={{ scale: 0.7 }}
          animate={{ scale: 1 }}
          transition={SPRING_BOUNCY}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full",
            verified ? "bg-emerald-500/20 text-emerald-300" : suspended ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300",
          )}
        >
          {verified ? <ShieldCheck className="size-6" /> : suspended ? <ShieldAlert className="size-6" /> : <Clock className="size-6" />}
        </motion.span>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              {verified ? "Background verification complete" : suspended ? "Account suspended" : "Verification in progress"}
            </h3>
            <Badge variant="outline" className="capitalize">
              {me.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {verified
              ? "Your vehicle and documents are approved. You can now unlock the rider app and start accepting trips."
              : suspended
                ? "Your account has been suspended. Please contact support."
                : "Until an admin completes your background & document check, the rider app remains locked."}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        {steps.map((s, idx) => (
          <motion.div
            key={s.label}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING_UI, delay: idx * 0.05 }}
            className="flex items-center justify-between gap-3 rounded-xl border bg-card/60 px-3.5 py-2.5"
          >
            <div className="flex items-center gap-2.5">
              {s.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
              ) : (
                <Clock className="size-4 shrink-0 text-amber-400" />
              )}
              <span className="text-sm font-medium">{s.label}</span>
            </div>
            <span className="text-xs text-muted-foreground">{s.detail}</span>
          </motion.div>
        ))}
      </div>

      {!verified && (
        <div className="grid grid-cols-2 gap-2.5">
          <Button type="button" variant="outline" onClick={() => onEditStep("vehicle")}>
            Edit Vehicle
          </Button>
          <Button type="button" variant="outline" onClick={() => onEditStep("documents")}>
            Manage Docs
          </Button>
        </div>
      )}

      {verified ? (
        <Button type="button" size="lg" className="h-11 w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onEnterApp}>
          <Unlock /> Open Rider App
        </Button>
      ) : (
        <Button type="button" size="lg" className="h-11 w-full" disabled={checking} onClick={() => void handleRefresh()}>
          <RefreshCw className={cn(checking && "animate-spin")} />
          {checking ? "Checking…" : "Refresh Verification Status"}
        </Button>
      )}
    </motion.div>
  );
}

