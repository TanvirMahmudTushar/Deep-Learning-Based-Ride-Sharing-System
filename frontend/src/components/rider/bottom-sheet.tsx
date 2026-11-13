"use client";

import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Height (px) of the strip that stays visible when the sheet is slid down. */
const HANDLE = 32;
const HEADER = 72;
const PEEK = HANDLE + HEADER;

/**
 * Mobile: a bottom sheet that floats over the map and can be dragged down (or tapped) to reveal it.
 * Desktop (md+): a fixed side panel on the left. Both sit above the map layer.
 */
export function BottomSheet({
  expanded,
  onExpandedChange,
  mobileHeight,
  header,
  children,
  className,
}: {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  /** Optional mobile sheet height (px); falls back to 68% when omitted. */
  mobileHeight?: number | null;
  /** Always visible, even when the sheet is slid down. */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ startY: number; base: number; max: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);
  const [offset, setOffset] = useState<number | null>(null); // live px offset while dragging

  function maxOffset() {
    return Math.max(0, (sheet.current?.offsetHeight ?? 0) - PEEK);
  }

  function onPointerDown(e: React.PointerEvent) {
    const max = maxOffset();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, base: expanded ? 0 : max, max, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (Math.abs(dy) > 4) d.moved = true;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt; // px/ms, positive = downwards
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    if (d.moved) setOffset(Math.min(d.max, Math.max(0, d.base + dy)));
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      onExpandedChange(!expanded); // a tap on the handle toggles
    } else {
      const pos = offset ?? d.base;
      onExpandedChange(Math.abs(d.v) > 0.4 ? d.v < 0 : pos < d.max / 2);
    }
    setOffset(null);
  }

  const style =
    offset !== null || mobileHeight
      ? {
          ...(mobileHeight ? { height: `${mobileHeight}px` } : {}),
          ...(offset !== null ? { transform: `translateY(${offset}px)` } : {}),
        }
      : undefined;

  return (
    <aside
      ref={sheet}
      style={style}
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex h-[68%] max-h-[75%] flex-col rounded-t-3xl border-t bg-background shadow-[0_-8px_30px_rgb(0_0_0/0.35)]",
        offset === null && "transition-transform duration-300 ease-out",
        offset === null && (expanded ? "translate-y-0" : "translate-y-[calc(100%-104px)]"),
        "md:inset-y-0 md:right-auto md:h-auto! md:max-h-none md:w-105 md:translate-y-0! md:transform-none! md:rounded-none md:border-t-0 md:border-r md:shadow-xl",
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={expanded ? "Slide panel down to see the map" : "Slide panel up"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onExpandedChange(!expanded)}
        className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing md:hidden"
      >
        <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
      </div>
      <div className="h-18 shrink-0 px-3 pb-2 md:h-auto md:pt-3">{header}</div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  );
}
