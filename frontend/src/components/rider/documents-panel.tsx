"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Clock, Eye, FileUp, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { fetchFileUrl, useServerHealth } from "@/lib/server";
import { cn } from "@/lib/utils";
import type { DocumentType, DocumentsOverview, RiderDocument } from "@/lib/types";

const STATUS: Record<RiderDocument["status"], { label: string; icon: typeof Clock; className: string }> = {
  pending: { label: "In review", icon: Clock, className: "border-amber-400/30 bg-amber-400/10 text-amber-200" },
  approved: { label: "Approved", icon: CheckCircle2, className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" },
  rejected: { label: "Rejected", icon: XCircle, className: "border-red-400/30 bg-red-400/10 text-red-200" },
};

const HINT: Record<DocumentType, string> = {
  license: "Both sides readable, not expired",
  registration: "Vehicle registration certificate (blue book / smart card)",
  photo: "A clear photo of your face, no sunglasses",
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

function UploadButton({ docType, replacing, onUploaded }: { docType: DocumentType; replacing: boolean; onUploaded: () => void }) {
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
    form.append("file", file);
    setBusy(true);
    try {
      await api("/api/rider/documents", { method: "POST", body: form });
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
        {busy ? <Loader2 className="animate-spin" /> : <FileUp />} {replacing ? "Replace" : "Upload"}
      </Button>
    </>
  );
}

export function DocumentsPanel() {
  const { data, mutate } = useSWR<DocumentsOverview>("/api/rider/documents", fetcher);
  if (!data) return null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {data.ready
          ? "All documents are approved."
          : "Upload all three documents. An admin reviews them before you can go online. JPG, PNG, WebP or PDF."}
      </p>
      {data.required.map(({ doc_type, label, document: doc }) => {
        const st = doc ? STATUS[doc.status] : null;
        return (
          <div key={doc_type} className={cn("space-y-2 rounded-xl border p-3", doc?.status === "rejected" && "border-red-400/40")}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">{HINT[doc_type]}</div>
              </div>
              {st ? (
                <Badge variant="outline" className={st.className}>
                  <st.icon className="size-3" /> {st.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  Missing
                </Badge>
              )}
            </div>
            {doc?.status === "rejected" && doc.review_note && <p className="text-xs text-red-200">Reason: {doc.review_note}</p>}
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{doc ? `${doc.original_name} · ${formatDateTime(doc.uploaded_at)}` : "Not uploaded"}</span>
              <div className="flex shrink-0 gap-1.5">
                {doc && (
                  <Button size="sm" variant="ghost" onClick={() => void openDocument(doc)} aria-label={`View ${label}`}>
                    <Eye />
                  </Button>
                )}
                {doc?.status !== "approved" && <UploadButton docType={doc_type} replacing={!!doc} onUploaded={() => void mutate()} />}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
