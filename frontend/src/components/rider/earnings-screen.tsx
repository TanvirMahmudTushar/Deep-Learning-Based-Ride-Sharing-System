"use client";

import { useState } from "react";
import { ChevronLeft, CreditCard } from "lucide-react";
import { EarningsPanel } from "@/components/rider/earnings-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function EarningsScreen({ onBack }: { onBack: () => void }) {
  const [closing, setClosing] = useState(false);

  function close() {
    setClosing(true);
    setTimeout(onBack, 220);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily and weekly earnings summary"
      className={cn(
        "fixed inset-0 z-[3010] flex flex-col overflow-hidden bg-background",
        closing ? "subpage-wipe-out" : "subpage-wipe-in",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
          <ChevronLeft />
        </Button>
        <h1 className="text-base font-semibold">Earnings Summary</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-x-none p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-lg space-y-4">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="size-4 text-muted-foreground" /> Daily &amp; Weekly Breakdown
            </h2>
            <p className="text-xs text-muted-foreground">
              Your net earnings after platform commission, daily totals over the last 7 days, and cash settlements.
            </p>
          </div>
          <EarningsPanel />
        </div>
      </div>
    </div>
  );
}

