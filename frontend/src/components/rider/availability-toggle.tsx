"use client";

import { Loader2, Power } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The driver's primary control: a large, full-width online/offline switch.
 * Rendered outside the scrolling tab content so it stays reachable on every tab.
 */
export function AvailabilityToggle({
  online,
  busy,
  disabled,
  hint,
  onChange,
}: {
  online: boolean;
  busy: boolean;
  disabled: boolean;
  /** Shown instead of the default subtitle, e.g. why the toggle is locked. */
  hint?: string;
  onChange: (online: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label={online ? "You are online. Tap to go offline" : "You are offline. Tap to go online"}
      disabled={disabled || busy}
      onClick={() => onChange(!online)}
      className={cn(
        "relative flex h-16 w-full touch-manipulation items-center rounded-full border-2 p-1.5 text-left transition-colors select-none",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-60",
        online ? "flex-row-reverse border-emerald-400/60 bg-emerald-500/20" : "border-border bg-muted/60",
      )}
    >
      <span
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-full transition-all duration-300",
          online ? "bg-emerald-400 text-emerald-950" : "bg-foreground/90 text-background",
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Power className="size-6" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col px-4 leading-tight">
        <span className={cn("text-lg font-semibold", online ? "text-emerald-300" : "text-foreground")}>
          {busy ? (online ? "Going offline…" : "Going online…") : online ? "You're online" : "You're offline"}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {hint ?? (online ? "Tap to stop receiving requests" : "Tap to start receiving requests")}
        </span>
      </span>
    </button>
  );
}
