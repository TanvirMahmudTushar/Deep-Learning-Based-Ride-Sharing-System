"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, lazy, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bike, Headphones, Loader2, User } from "lucide-react";
import { toast } from "sonner";
import { AuthFrame } from "@/components/auth-frame";
import { PASSWORD_MIN_LENGTH } from "@/components/change-password-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPRING_UI } from "@/components/ui/motion";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import type { AuthResponse } from "@/lib/types";

const OtpVerifyStep = lazy(() => import("@/components/auth/otp-verify-step").then((m) => ({ default: m.OtpVerifyStep })));

type SignupRole = "user" | "rider" | "support";

const ROLE_OPTIONS: { value: SignupRole; label: string; icon: typeof User }[] = [
  { value: "user", label: "I need rides", icon: User },
  { value: "rider", label: "I want to drive", icon: Bike },
  { value: "support", label: "Support staff", icon: Headphones },
];

interface DraftAccount {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  role: SignupRole;
}

function RegisterForm() {
  const as = useSearchParams().get("as");
  const [role, setRole] = useState<SignupRole>(as === "rider" || as === "support" ? as : "user");
  const [step, setStep] = useState<"details" | "otp">("details");
  const [draft, setDraft] = useState<DraftAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmitDetails(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const field = (k: string) => String(form.get(k) ?? "").trim();
    const nextDraft: DraftAccount = {
      full_name: field("full_name"),
      email: field("email"),
      phone: field("phone"),
      // Sent exactly as typed: login doesn't trim, so spaces here must stay part of the password.
      password: String(form.get("password") ?? ""),
      role,
    };
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/otp/request", { json: { email: nextDraft.email, phone: nextDraft.phone } });
      setDraft(nextDraft);
      setStep("otp");
      toast.success("Verification code sent to your phone");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send verification code");
    } finally {
      setBusy(false);
    }
  }

  async function onResendOtp() {
    if (!draft) return;
    setError(null);
    await api("/api/auth/otp/request", { json: { email: draft.email, phone: draft.phone } });
    toast.success("Verification code re-sent");
  }

  async function onVerifyAndCreate(otp: string) {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/otp/verify", { json: { phone: draft.phone, otp } });
      const auth = await api<AuthResponse>("/api/auth/register", {
        json: { ...draft, otp },
      });
      toast.success("Account verified and created!");
      saveSession(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className="w-full max-w-md">
        <Card className="overflow-hidden border-border/80 shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">{step === "details" ? "Create an account" : "Confirm your number"}</CardTitle>
            <CardDescription>
              {step === "details"
                ? role === "rider"
                  ? "Create your account first, then add your vehicle & documents."
                  : role === "support"
                    ? "An admin reviews support agents before they can start."
                    : "Sign up with your email and phone number."
                : "One quick step to verify your phone before finishing."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait">
              {step === "details" ? (
                <motion.div
                  key="details"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={SPRING_UI}
                >
                  {/* Spring-animated role switcher with clear active pill color */}
                  <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Account role">
                    {ROLE_OPTIONS.map((opt) => {
                      const active = role === opt.value;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setRole(opt.value)}
                          className={cn(
                            "relative flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors active:scale-[0.97] sm:text-sm",
                            active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {active && (
                            <motion.span
                              layoutId="register-role-pill"
                              transition={SPRING_UI}
                              className="absolute inset-0 rounded-lg bg-primary shadow-sm"
                            />
                          )}
                          <Icon className="relative z-10 size-3.5 shrink-0" />
                          <span className="relative z-10 truncate">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <form onSubmit={onSubmitDetails} className="space-y-4">
                    {error && (
                      <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="full_name">Full name</Label>
                      <Input id="full_name" name="full_name" required minLength={2} defaultValue={draft?.full_name ?? ""} autoComplete="name" />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" type="email" required defaultValue={draft?.email ?? ""} autoComplete="email" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          required
                          minLength={6}
                          defaultValue={draft?.phone ?? ""}
                          placeholder="+8801…"
                          autoComplete="tel"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        required
                        minLength={PASSWORD_MIN_LENGTH}
                        maxLength={72}
                        defaultValue={draft?.password ?? ""}
                        autoComplete="new-password"
                      />
                      <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
                    </div>

                    <AnimatePresence initial={false}>
                      {role === "support" && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={SPRING_UI}
                          className="overflow-hidden rounded-lg border p-3 text-sm text-muted-foreground"
                        >
                          You can log in straight away, but you won&apos;t see any trips or reports until an admin approves your account.
                        </motion.p>
                      )}
                      {role === "rider" && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={SPRING_UI}
                          className="overflow-hidden rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs text-muted-foreground"
                        >
                          Next: verify your phone via OTP, then submit your vehicle details and documents for verification.
                        </motion.p>
                      )}
                    </AnimatePresence>

                    <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>
                      {busy && <Loader2 className="animate-spin" />} Continue
                    </Button>
                    <p className="text-center text-sm text-muted-foreground">
                      Already registered?{" "}
                      <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                        Log in
                      </Link>
                    </p>
                  </form>
                </motion.div>
              ) : (
                <Suspense
                  fallback={
                    <div className="flex justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  }
                >
                  <OtpVerifyStep
                    key="otp"
                    phone={draft?.phone ?? ""}
                    busy={busy}
                    error={error}
                    onBack={() => {
                      setError(null);
                      setStep("details");
                    }}
                    onResend={onResendOtp}
                    onVerify={onVerifyAndCreate}
                  />
                </Suspense>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </AuthFrame>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
