"use client";

import { Suspense, lazy, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Camera, CheckCircle2, Clock, Eye, FileUp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { fetchFileUrl, useServerHealth } from "@/lib/server";
import { cn } from "@/lib/utils";
import type { DocumentType, DocumentsOverview, RiderDocument } from "@/lib/types";

const SelfieCaptureDialog = lazy(() =>
  import("@/components/rider/selfie-capture-dialog").then((m) => ({ default: m.SelfieCaptureDialog })),
);

export const STATUS: Record<RiderDocument["status"], { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "In review", icon: Clock, className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  approved: { label: "Approved", icon: CheckCircle2, className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  rejected: { label: "Rejected", icon: XCircle, className: "border-red-400/30 bg-red-400/10 text-red-200" },
};

export const HINT: Record<DocumentType, string> = {
  license: "Both sides readable, not expired",
  insurance: "Valid vehicle insurance policy certificate",
  registration: "Vehicle registration certificate (blue book / smart card)",
  photo: "A clear photo or selfie of your face, no sunglasses",
  vehicle_photo: "The whole vehicle with the number plate readable",
};

export async function openDocument(doc: RiderDocument) {
  try {
    const url = await fetchFileUrl(`/api/documents/${doc.id}/file`);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Could not open the file");
  }
}

export function UploadButton({
  docType,
  replacing,
  label,
  onUploaded,
  endpoint = "/api/rider/documents",
  useAsProfilePhoto = false,
}: {
  docType: DocumentType;
  replacing: boolean;
  label?: string;
  onUploaded: () => void;
  endpoint?: string;
  useAsProfilePhoto?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data: health } = useServerHealth();

  async function upload(file: File) {
    const limit = (health?.max_upload_mb ?? 5) * 1024 * 1024;
    if (file.size > limit) {
      toast.error(`Files must be under ${health?.max_upload_mb ?? 5} MB`);
      return;
    }
    const form = new FormData();
    form.append("doc_type", docType);
    if (docType === "photo" && useAsProfilePhoto) {
      form.append("use_as_profile_photo", "true");
    }
    form.append("file", file);
    setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: form });
      toast.success("Uploaded. An admin will review it shortly.");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
      />
      <Button size="sm" variant={replacing ? "outline" : "default"} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} {label ?? (replacing ? "Replace" : "Upload")}
      </Button>
    </>
  );
}

export function DocumentsPanel() {
  const { data, mutate } = useSWR<DocumentsOverview>("/api/rider/documents", fetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [useAsProfile, setUseAsProfile] = useState(true);
  if (!data) return null;

  const refreshAll = () => {
    void mutate();
    void globalMutate("/api/rider/me");
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Optional for demo: licence, insurance, registration &amp; face selfie (JPG, PNG, WebP or PDF, up to the size limit shown when you upload).
      </p>
      {data.required.map(({ doc_type, label, document: doc }) => {
        const st = doc ? STATUS[doc.status] : null;
        const isPhoto = doc_type === "photo";
        return (
          <div key={doc_type} className={cn("space-y-2 rounded-xl border p-3", doc?.status === "rejected" && "border-red-400/40")}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{HINT[doc_type]}</div>
              </div>
              {st ? (
                <Badge variant="outline" className={cn("shrink-0 whitespace-nowrap", st.className)}>
                  <st.icon className="size-3" /> {st.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 whitespace-nowrap text-muted-foreground">
                  Not added
                </Badge>
              )}
            </div>
            {isPhoto && (
              <div className="flex items-center justify-between gap-2 rounded-xl border bg-background/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">Use selfie/photo as my profile photo</span>
                <Switch checked={useAsProfile} onCheckedChange={setUseAsProfile} aria-label="Use as profile photo" />
              </div>
            )}
            {doc?.status === "rejected" && doc.review_note && <p className="text-xs text-red-200">Reason: {doc.review_note}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-muted-foreground">{doc ? `${doc.original_name} · ${formatDateTime(doc.uploaded_at)}` : "Not uploaded"}</span>
              <div className="flex shrink-0 gap-1.5">
                {doc && (
                  <Button size="sm" variant="ghost" onClick={() => void openDocument(doc)} aria-label={`View ${label}`}>
                    <Eye />
                  </Button>
                )}
                {isPhoto && (
                  <Button size="sm" variant="default" onClick={() => setSelfieOpen(true)}>
                    <Camera /> Take Selfie
                  </Button>
                )}
                <UploadButton
                  docType={doc_type}
                  replacing={!!doc || isPhoto}
                  label={doc?.status === "approved" ? "Renew" : undefined}
                  useAsProfilePhoto={isPhoto && useAsProfile}
                  onUploaded={refreshAll}
                />
              </div>
            </div>
          </div>
        );
      })}
      <Suspense fallback={null}>
        {selfieOpen && (
          <SelfieCaptureDialog
            open={selfieOpen}
            onOpenChange={setSelfieOpen}
            onUploaded={refreshAll}
            useAsProfile={useAsProfile}
            onUseAsProfileChange={setUseAsProfile}
          />
        )}
      </Suspense>
    </div>
  );
}
