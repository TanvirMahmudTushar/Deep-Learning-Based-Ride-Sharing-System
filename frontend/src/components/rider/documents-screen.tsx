"use client";

import { useState } from "react";
import { ChevronLeft, FileCheck2 } from "lucide-react";
import { DocumentsPanel } from "@/components/rider/documents-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DocumentsScreen({ onBack }: { onBack: () => void }) {
  const [closing, setClosing] = useState(false);

  function close() {
    setClosing(true);
    setTimeout(onBack, 220);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Documents and verification"
      className={cn(
        "fixed inset-0 z-[3010] flex flex-col overflow-hidden bg-background",
        closing ? "subpage-wipe-out" : "subpage-wipe-in",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
          <ChevronLeft />
        </Button>
        <h1 className="text-base font-semibold">Documents &amp; Verification</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileCheck2 className="size-4 text-muted-foreground" /> Required Documents
            </h2>
            <p className="text-xs text-muted-foreground">
              Keep your official documents up to date. Verified documents are required to go online and receive rides.
            </p>
          </div>
          <DocumentsPanel />
        </div>
      </div>
    </div>
  );
}

