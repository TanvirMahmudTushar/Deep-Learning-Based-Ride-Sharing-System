"use client";

import { Suspense, lazy, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { motion } from "framer-motion";
import { ArrowRight, Camera, Eye, Loader2 } from "lucide-react";
import { HINT, STATUS, UploadButton, openDocument } from "@/components/rider/documents-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SPRING_UI } from "@/components/ui/motion";
import { Switch } from "@/components/ui/switch";
import { fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentsOverview } from "@/lib/types";

const SelfieCaptureDialog = lazy(() =>
  import("@/components/rider/selfie-capture-dialog").then((m) => ({ default: m.SelfieCaptureDialog })),
);

export function DocumentsStep({ onNext }: { onNext: () => void }) {
  const { data, mutate } = useSWR<DocumentsOverview>("/api/rider/documents", fetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [useAsProfile, setUseAsProfile] = useState(true);

  if (!data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const uploadedCount = data.required.filter((r) => r.document !== null).length;
  const photoDoc = data.required.find((r) => r.doc_type === "photo")?.document ?? null;

  function refreshAll() {
    void mutate();
    void globalMutate("/api/rider/me");
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={SPRING_UI}
      className="space-y-4"
    >
      <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-3.5 py-2.5 text-xs">
        <span className="text-muted-foreground">Upload licence, insurance, registration &amp; clear face selfie</span>
        <span className="font-semibold">
          {uploadedCount}/{data.required.length} uploaded
        </span>
      </div>

      <div className="space-y-3">
        {data.required.map(({ doc_type, label, document: doc }, idx) => {
          const st = doc ? STATUS[doc.status] : null;
          const isPhoto = doc_type === "photo";
          return (
            <motion.div
              key={doc_type}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING_UI, delay: idx * 0.04 }}
              className={cn(
                "space-y-2.5 rounded-2xl border p-3.5 transition-colors",
                doc?.status === "rejected" && "border-red-400/40 bg-red-500/5",
                doc?.status === "approved" && "border-emerald-400/30 bg-emerald-500/5",
                isPhoto && !doc && "border-primary/40 bg-primary/5",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    <span>{label}</span>
                    {isPhoto && (
                      <Badge variant="outline" className="border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] text-primary">
                        Mandatory
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{HINT[doc_type]}</div>
                </div>
                {st ? (
                  <Badge variant="outline" className={st.className}>
                    <st.icon className="size-3" /> {st.label}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Required
                  </Badge>
                )}
              </div>

              {isPhoto && doc?.status !== "approved" && (
                <div className="flex items-center justify-between gap-2 rounded-xl border bg-background/60 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Use selfie/photo as my profile photo</span>
                  <Switch checked={useAsProfile} onCheckedChange={setUseAsProfile} aria-label="Use as profile photo" />
                </div>
              )}

              {doc?.status === "rejected" && doc.review_note && <p className="text-xs text-red-200">Reason: {doc.review_note}</p>}

              <div className="flex items-center justify-between gap-2 pt-0.5">
                <span className="truncate text-xs text-muted-foreground">
                  {doc ? `${doc.original_name} · ${formatDateTime(doc.uploaded_at)}` : "JPG, PNG, WebP or PDF"}
                </span>
                <div className="flex shrink-0 gap-1.5">
                  {doc && (
                    <Button size="sm" variant="ghost" onClick={() => void openDocument(doc)} aria-label={`View ${label}`}>
                      <Eye />
                    </Button>
                  )}
                  {isPhoto && doc?.status !== "approved" && (
                    <Button size="sm" variant="default" onClick={() => setSelfieOpen(true)}>
                      <Camera /> Take Selfie
                    </Button>
                  )}
                  {doc?.status !== "approved" && (
                    <UploadButton
                      docType={doc_type}
                      replacing={!!doc || isPhoto}
                      useAsProfilePhoto={isPhoto && useAsProfile}
                      onUploaded={refreshAll}
                    />
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {!photoDoc && (
        <p className="text-center text-xs text-amber-300">Please take a selfie or upload a clear face photo before continuing.</p>
      )}

      <Button type="button" size="lg" className="h-11 w-full" disabled={!photoDoc} onClick={onNext}>
        Check Verification Status
        <ArrowRight />
      </Button>

      <Suspense fallback={null}>
        {selfieOpen && <SelfieCaptureDialog open={selfieOpen} onOpenChange={setSelfieOpen} onUploaded={refreshAll} />}
      </Suspense>
    </motion.div>
  );
}
