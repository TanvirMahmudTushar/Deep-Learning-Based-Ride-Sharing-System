"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SPRING_BOUNCY, SPRING_UI } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const OTP_LENGTH = 6;

export function OtpVerifyStep({
  phone,
  busy,
  error,
  onBack,
  onResend,
  onVerify,
}: {
  phone: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onResend: () => Promise<void>;
  onVerify: (otp: string) => Promise<void>;
}) {
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [cooldown, setCooldown] = useState(30);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const code = digits.join("");
  const complete = code.length === OTP_LENGTH && digits.every((d) => /^\d$/.test(d));

  function updateDigit(idx: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      setDigits((prev) => prev.map((d, i) => (i === idx ? "" : d)));
      return;
    }
    const next = [...digits];
    for (let i = 0; i < clean.length && idx + i < OTP_LENGTH; i++) {
      next[idx + i] = clean[i];
    }
    setDigits(next);
    const focusAt = Math.min(OTP_LENGTH - 1, idx + clean.length);
    inputsRef.current[focusAt]?.focus();
  }

  function handleKeyDown(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowLeft" && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    } else if (e.key === "ArrowRight" && idx < OTP_LENGTH - 1) {
      inputsRef.current[idx + 1]?.focus();
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    inputsRef.current[Math.min(OTP_LENGTH - 1, pasted.length)]?.focus();
  }

  async function handleResend() {
    setResending(true);
    try {
      await onResend();
      setCooldown(30);
    } finally {
      setResending(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.98 }}
      transition={SPRING_UI}
      className="space-y-5"
    >
      <div className="flex items-start gap-3 rounded-xl border bg-muted/40 p-3.5">
        <motion.span
          initial={{ scale: 0.7 }}
          animate={{ scale: 1 }}
          transition={SPRING_BOUNCY}
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
        >
          <ShieldCheck className="size-5" />
        </motion.span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Verify your phone number</div>
          <p className="text-xs text-muted-foreground">
            Enter the 6-digit code sent to <span className="font-medium text-foreground">{phone}</span>.
          </p>
          <p className="mt-1 text-[11px] font-medium text-amber-400">
            Testing mode: use <code className="rounded bg-amber-400/15 px-1 py-0.5 font-mono">000000</code>
          </p>
        </div>
      </div>

      {error && (
        <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} transition={{ duration: 0.35 }}>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </motion.div>
      )}

      <div className="flex justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <motion.input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={d}
            onChange={(e) => updateDigit(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            whileFocus={{ scale: 1.05 }}
            transition={SPRING_UI}
            aria-label={`Digit ${i + 1}`}
            className={cn(
              "h-12 w-10 rounded-xl border bg-background text-center font-mono text-lg font-bold outline-none transition-colors sm:h-13 sm:w-11",
              d ? "border-primary ring-2 ring-primary/20" : "border-input",
              "focus:border-primary focus:ring-3 focus:ring-primary/25",
            )}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        <Button type="button" size="lg" className="h-11 w-full" disabled={!complete || busy} onClick={() => void onVerify(code)}>
          {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Verify &amp; Create Account
        </Button>

        <div className="flex items-center justify-between gap-2 text-xs">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={busy}>
            <ArrowLeft className="size-3.5" /> Edit details
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={cooldown > 0 || resending || busy} onClick={() => void handleResend()}>
            {resending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

