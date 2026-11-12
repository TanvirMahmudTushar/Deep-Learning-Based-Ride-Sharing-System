"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, type Transition } from "framer-motion";
import { cn } from "@/lib/utils";

/** Tactile spring curves with mass and momentum instead of rigid linear easing. */
export const SPRING_UI: Transition = { type: "spring", stiffness: 420, damping: 32, mass: 0.8 };
export const SPRING_GENTLE: Transition = { type: "spring", stiffness: 300, damping: 28, mass: 0.9 };
export const SPRING_BOUNCY: Transition = { type: "spring", stiffness: 460, damping: 24, mass: 0.75 };

export function SpringButton({
  children,
  className,
  disabled,
  onClick,
  type = "button",
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
}) {
  return (
    <motion.button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={SPRING_UI}
      className={cn(className)}
    >
      {children}
    </motion.button>
  );
}

export function AnimatedPopup({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence mode="wait">
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 8 }}
          transition={SPRING_UI}
          className={cn(className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

