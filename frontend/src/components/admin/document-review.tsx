"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ExternalLink, FileText, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { fetchFileUrl } from "@/lib/server";
import type { AdminRider, DocumentsOverview, RiderDocument } from "@/lib/types";

const STATUS_STYLE: Record<RiderDocument["status"], string> = {
  pending: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  rejected: "border-red-400/30 bg-red-400/10 text-red-200",
};

/** Image preview loaded with the admin's token (document files are not public URLs). */
function Preview({ doc }: { doc: RiderDocument }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = doc.content_type.startsWith("image/");

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetchFileUrl(`/api/documents/${doc.id}/file`)
      .then((u) => {
        objectUrl = u;
        if (!revoked) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);

  if (!url) return <Skeleton className="h-40 w-full" />;
  return isImage ? (
    // eslint-disable-next-line @next/next/no-img-element -- object URL from an authenticated fetch
    <img src={url} alt={doc.label} className="max-h-56 w-full rounded-md border object-contain" />
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex h-24 items-center justify-center gap-2 rounded-md border text-sm hover:bg-accent/30">
      <FileText className="size-4" /> Open PDF <ExternalLink className="size-3" />
    </a>
  );
}

function DocumentRow({ label, doc, onReviewed }: { label: string; doc: RiderDocument | null; onReviewed: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function review(status: "approved" | "rejected") {
    setBusy(true);
    try {
      await api(`/api/admin/documents/${doc!.id}/review`, { json: { status, note } });
      setRejecting(false);
      setNote("");
      onReviewed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {doc ? (
          <Badge variant="outline" className={STATUS_STYLE[doc.status]}>
            {doc.status}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            not uploaded
          </Badge>
        )}
      </div>
      {doc && (
        <>
          <Preview doc={doc} />
          <div className="text-xs text-muted-foreground">
            {doc.original_name} · {(doc.size_bytes / 1024).toFixed(0)} KB · uploaded {formatDateTime(doc.uploaded_at)}
            {doc.review_note && ` · note: ${doc.review_note}`}
          </div>
          {rejecting ? (
            <div className="flex gap-2">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason shown to the rider" maxLength={300} autoFocus />
              <Button size="sm" variant="destructive" disabled={busy || !note.trim()} onClick={() => review("rejected")}>
                Reject
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || doc.status === "approved"} onClick={() => review("approved")}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} Approve
              </Button>
              <Button size="sm" variant="outline" disabled={busy || doc.status === "rejected"} onClick={() => setRejecting(true)}>
                <X /> Reject
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function DocumentReviewDialog({ rider, onOpenChange, onChanged }: { rider: AdminRider | null; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const { data, mutate } = useSWR<DocumentsOverview>(rider ? `/api/admin/riders/${rider.id}/documents` : null, fetcher);
  const [verifying, setVerifying] = useState(false);

  async function verify() {
    if (!rider) return;
    setVerifying(true);
    try {
      await api(`/api/admin/riders/${rider.id}/verify`, { method: "POST" });
      toast.success(`${rider.full_name} verified`);
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Dialog open={!!rider} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review {rider?.full_name}</DialogTitle>
          <DialogDescription>
            Licence {rider?.license_no}
            {rider?.vehicle && ` · ${rider.vehicle.model} · ${rider.vehicle.plate_no}`}
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {data.required.map((r) => (
              <DocumentRow
                key={r.doc_type}
                label={r.label}
                doc={r.document}
                onReviewed={() => {
                  void mutate();
                  onChanged();
                }}
              />
            ))}
          </div>
        )}
        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">{data && !data.ready ? `Still needed: ${data.missing.join(", ")}` : "All documents approved"}</span>
          {rider?.status !== "verified" && (
            <Button onClick={verify} disabled={verifying || !data?.ready}>
              {verifying && <Loader2 className="animate-spin" />} Verify rider
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
