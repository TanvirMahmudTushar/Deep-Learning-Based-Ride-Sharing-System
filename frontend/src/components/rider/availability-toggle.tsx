"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsRight, Loader2, Power } from "lucide-react";
import { cn } from "@/lib/utils";

const KNOB = 48; // px, matches size-12
const INSET = 4; // px, matches left-1 / top-1
const COMMIT = 0.6; // fraction of the track the knob must travel to count

/**
 * "Slide to unlock" style availability control. The power knob must be dragged across the
 * track to change state; a short drag springs back. Meant to float over the map.
 */
export function AvailabilityToggle({
  online,
  busy,
  disabled,
  hint,
  onChange,
  className,
}: {
  online: boolean;
  busy: boolean;
  disabled: boolean;
  /** Shown instead of the default subtitle, e.g. why the toggle is locked. */
  hint?: string;
  onChange: (online: boolean) => void;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; max: number } | null>(null);
  const [x, setX] = useState<number | null>(null); // knob offset from the offline end while dragging
  const [target, setTarget] = useState(online); // where the knob was released, held while the request runs

  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = busy ? target : online;
  const locked = disabled || busy;
  const travelMax = () => Math.max(1, width - KNOB - INSET * 2);

  function onPointerDown(e: React.PointerEvent) {
    if (locked) return;
    const max = travelMax();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX - (online ? max : 0), max };
    setX(online ? max : 0);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setX(Math.min(d.max, Math.max(0, e.clientX - d.startX)));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d || x === null) return;
    const wantOnline = x > d.max * (online ? 1 - COMMIT : COMMIT);
    setX(null);
    if (wantOnline !== online) {
      setTarget(wantOnline);
      onChange(wantOnline);
    }
  }

  const dragging = x !== null;
  const lookOnline = dragging ? x > travelMax() / 2 : shown;
  const knobStyle = { transform: `translateX(${dragging ? x : shown ? travelMax() : 0}px)` };

  return (
    <div
      ref={track}
      role="switch"
      aria-checked={online}
      aria-disabled={locked}
      aria-label={online ? "You are online. Slide to go offline" : "You are offline. Slide to go online"}
      tabIndex={locked ? -1 : 0}
      onKeyDown={(e) => {
        if (!locked && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setTarget(!online);
          onChange(!online);
        }
      }}
      className={cn(
        "relative h-14 w-full overflow-hidden rounded-full border-2 shadow-lg backdrop-blur select-none",
        "transition-[background-color,border-color,box-shadow] duration-500 ease-out",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        locked && !busy && "opacity-60",
        lookOnline ? "border-emerald-400/70 bg-emerald-950/90 shadow-emerald-500/20" : "border-border bg-card/95",
        className,
      )}
    >
      {/* label sits on the side opposite the knob */}
      <div
        className={cn(
          "pointer-events-none flex h-full min-w-0 flex-col justify-center leading-tight transition-[padding] duration-300 ease-out",
          lookOnline ? "pr-16 pl-5" : "pr-5 pl-16",
        )}
      >
        <span className={cn("flex items-center gap-1 text-base font-semibold transition-colors duration-300", lookOnline ? "text-emerald-300" : "text-foreground")}>
          {busy ? (target ? "Going online…" : "Going offline…") : lookOnline ? "You're online" : "You're offline"}
        </span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {hint ?? (
            <>
              {online ? "Slide to go offline" : "Slide to go online"}
              <ChevronsRight className={cn("size-3.5 animate-pulse", online && "rotate-180")} />
            </>
          )}
        </span>
      </div>

      {/* draggable knob */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={knobStyle}
        className={cn(
          "absolute top-1 left-1 grid size-12 touch-none place-items-center rounded-full shadow-md",
          locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing",
          !dragging && "transition-[transform,background-color,color] duration-300 ease-out",
          dragging && "transition-[background-color,color] duration-300",
          lookOnline ? "bg-emerald-400 text-emerald-950" : "bg-foreground text-background",
        )}
      >
        {busy ? <Loader2 className="size-6 animate-spin" /> : <Power className="size-6" />}
      </div>
    </div>
  );
}
