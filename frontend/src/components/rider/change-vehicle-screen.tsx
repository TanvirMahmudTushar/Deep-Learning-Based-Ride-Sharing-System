"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Eye,
  FileCheck2,
  FileUp,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { VehicleIcon, VehicleTag } from "@/components/ride-bits";
import { openDocument } from "@/components/rider/documents-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fetcher } from "@/lib/api";
import { formatDateTime, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import { useServerHealth } from "@/lib/server";
import { cn } from "@/lib/utils";
import type { DocumentType, RiderMe, VehicleChange, VehicleType } from "@/lib/types";

const CHANGE_STATUS_BADGE = {
  pending: { label: "Pending Admin Approval", icon: Clock, className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  approved: { label: "Approved", icon: CheckCircle2, className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  rejected: { label: "Rejected", icon: XCircle, className: "border-red-400/30 bg-red-400/10 text-red-200" },
};

function UploadDocButton({
  docType,
  replacing,
  onUploaded,
}: {
  docType: DocumentType;
  replacing: boolean;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { data: health } = useServerHealth();

  async function handleFile(file: File) {
    const limit = (health?.max_upload_mb ?? 5) * 1024 * 1024;
    if (file.size > limit) {
      toast.error(`File must be under ${health?.max_upload_mb ?? 5} MB`);
      return;
    }
    const form = new FormData();
    form.append("doc_type", docType);
    form.append("file", file);
    setBusy(true);
    try {
      await api("/api/rider/vehicle-change/documents", { method: "POST", body: form });
      toast.success("Document uploaded successfully");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="cursor-pointer">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && void handleFile(e.target.files[0])}
      />
      <Button size="sm" variant={replacing ? "outline" : "default"} asChild disabled={busy}>
        <span>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FileUp className="size-3.5" />}
          {replacing ? "Replace" : "Upload"}
        </span>
      </Button>
    </label>
  );
}

export function ChangeVehicleScreen({
  me,
  onBack,
  onSuccess,
}: {
  me: RiderMe;
  onBack: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const [closing, setClosing] = useState(false);
  const [vehicleType, setVehicleType] = useState<VehicleType>(me.vehicle?.vehicle_type ?? "bike");
  const [plateNo, setPlateNo] = useState("");
  const [model, setModel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { data: change, mutate: refreshChange, isLoading } = useSWR<VehicleChange | null>(
    "/api/rider/vehicle-change",
    fetcher,
  );

  function close() {
    setClosing(true);
    setTimeout(onBack, 220);
  }

  async function handleStartChange(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/rider/vehicle-change", {
        method: "POST",
        json: {
          vehicle_type: vehicleType,
          plate_no: plateNo.trim().toUpperCase(),
          model: model.trim(),
        },
      });
      toast.success("Vehicle change request created. Please upload the required documents.");
      await refreshChange();
      await onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to request vehicle change");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelChange() {
    if (!confirm("Are you sure you want to cancel this pending vehicle change?")) return;
    setCancelling(true);
    try {
      await api("/api/rider/vehicle-change", { method: "DELETE" });
      toast.success("Vehicle change request cancelled");
      await refreshChange();
      await onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel request");
    } finally {
      setCancelling(false);
    }
  }

  const isPending = change?.status === "pending";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change vehicle details"
      className={cn(
        "fixed inset-0 z-[3010] flex flex-col overflow-hidden bg-background",
        closing ? "subpage-wipe-out" : "subpage-wipe-in",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
          <ChevronLeft />
        </Button>
        <h1 className="text-base font-semibold">Change Vehicle Details</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="mx-auto w-full max-w-lg space-y-6">
          {/* Important Info Notice */}
          <Alert className="border-amber-400/30 bg-amber-400/5">
            <AlertTriangle className="size-4 text-amber-300" />
            <AlertTitle className="text-amber-200">Re-verification Required</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              A vehicle’s plate and registration are tied together. Changing details replaces your vehicle.
              The change won’t apply immediately: you must upload the new registration certificate and photo
              for admin approval. Until approved, you may continue driving your current verified vehicle.
            </AlertDescription>
          </Alert>

          {/* Current Vehicle Summary */}
          <div className="space-y-2 rounded-xl border p-4">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Current Active Vehicle
            </div>
            {me.vehicle ? (
              <div className="flex items-center gap-3">
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
                <VehicleTag type={me.vehicle.vehicle_type} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active vehicle assigned.</p>
            )}
          </div>

          {isLoading ? (
            <Skeleton className="h-48" />
          ) : isPending && change ? (
            /* Active Pending Vehicle Change & Document Uploads */
            <div className="space-y-4 rounded-xl border border-amber-400/40 bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Vehicle Change Request</h2>
                  <p className="text-xs text-muted-foreground">Submitted {formatDateTime(change.created_at)}</p>
                </div>
                <Badge variant="outline" className={CHANGE_STATUS_BADGE.pending.className}>
                  <Clock className="size-3" /> Pending Review
                </Badge>
              </div>

              {/* Proposed vehicle info */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted">
                  <VehicleIcon
                    type={change.vehicle_type}
                    className="size-5"
                    style={{ color: VEHICLE_COLOR[change.vehicle_type] }}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{change.model}</div>
                  <div className="truncate text-xs text-muted-foreground">Plate: {change.plate_no}</div>
                </div>
                <VehicleTag type={change.vehicle_type} />
              </div>

              {/* Document upload checklist */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Required Proof for New Vehicle
                </div>
                {change.documents.map((item) => {
                  const doc = item.document;
                  return (
                    <div
                      key={item.doc_type}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {doc ? `${doc.original_name} · Uploaded` : "Missing upload"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {doc && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void openDocument(doc)}
                            aria-label={`View ${item.label}`}
                          >
                            <Eye className="size-4" />
                          </Button>
                        )}
                        <UploadDocButton
                          docType={item.doc_type}
                          replacing={!!doc}
                          onUploaded={() => void refreshChange()}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {change.documents_complete ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-300 border border-emerald-500/20">
                  <CheckCircle2 className="size-4 shrink-0" />
                  All required documents uploaded. Waiting for admin verification.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300 border border-amber-500/20">
                  <AlertCircle className="size-4 shrink-0" />
                  Please upload both registration and vehicle photo above so admins can review.
                </div>
              )}

              <Button
                variant="outline"
                className="w-full text-red-300 hover:text-red-200"
                disabled={cancelling}
                onClick={handleCancelChange}
              >
                {cancelling ? <Loader2 className="animate-spin" /> : <XCircle className="size-4" />}
                Cancel This Request
              </Button>
            </div>
          ) : (
            /* New Request Form */
            <form onSubmit={handleStartChange} className="space-y-4 rounded-xl border p-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Register New Vehicle</h2>
                <p className="text-xs text-muted-foreground">
                  Enter the vehicle&apos;s details to start the change process.
                </p>
              </div>

              {change?.status === "rejected" && change.review_note && (
                <Alert variant="destructive">
                  <XCircle className="size-4" />
                  <AlertTitle>Previous request was rejected</AlertTitle>
                  <AlertDescription className="text-xs">
                    Reason: {change.review_note}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="new-vehicle-type">Vehicle Type</Label>
                <Select
                  value={vehicleType}
                  onValueChange={(v) => setVehicleType(v as VehicleType)}
                >
                  <SelectTrigger id="new-vehicle-type" className="w-full">
                    <SelectValue placeholder="Select vehicle type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bike">Bike (Motorcycle)</SelectItem>
                    <SelectItem value="cng">CNG (Auto-rickshaw)</SelectItem>
                    <SelectItem value="car">Car</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-vehicle-model">Vehicle Model / Make</Label>
                <Input
                  id="new-vehicle-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. Yamaha FZ-S / Bajaj RE / Toyota Axio"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="new-vehicle-plate">Number Plate</Label>
                <Input
                  id="new-vehicle-plate"
                  value={plateNo}
                  onChange={(e) => setPlateNo(e.target.value)}
                  placeholder="e.g. DHAKA METRO-HA-12-3456"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Must be unique and match official registration papers.
                </p>
              </div>

              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? <Loader2 className="animate-spin" /> : <Plus className="size-4" />}
                Submit &amp; Proceed to Upload Papers
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

