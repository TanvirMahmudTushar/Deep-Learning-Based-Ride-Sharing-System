"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
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

type SignupRole = "user" | "rider" | "support";

const ROLE_OPTIONS: { value: SignupRole; label: string; icon: typeof User }[] = [
  { value: "user", label: "I need rides", icon: User },
  { value: "rider", label: "I want to drive", icon: Bike },
  { value: "support", label: "Support staff", icon: Headphones },
];

function RegisterForm() {
  const as = useSearchParams().get("as");
  const [role, setRole] = useState<SignupRole>(as === "rider" || as === "support" ? as : "user");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    const field = (k: string) => String(form.get(k) ?? "").trim();
    setBusy(true);
    setError(null);
    try {
      const auth = await api<AuthResponse>("/api/auth/register", {
        json: {
          full_name: field("full_name"),
          email: field("email"),
          phone: field("phone"),
          // Sent exactly as typed: login doesn't trim, so spaces here must stay part of the password.
          password: String(form.get("password") ?? ""),
          role,
        },
      });
      toast.success("Account created!");
      saveSession(auth);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the account");
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className="w-full max-w-md">
        <Card className="overflow-hidden border-border/80 shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Create an account</CardTitle>
            <CardDescription>
              {role === "rider"
                ? "Create your account first, then add your vehicle & documents."
                : role === "support"
                  ? "Sign up and open the support desk straight away."
                  : "Sign up with your email and phone number."}
            </CardDescription>
          </CardHeader>
          <CardContent>
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

            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" name="full_name" required minLength={2} autoComplete="name" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    required
                    minLength={6}
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
                    You can log in straight away and open the support desk.
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
                    Next: submit your vehicle details and documents for verification.
                  </motion.p>
                )}
              </AnimatePresence>

              <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />} Create account
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already registered?{" "}
                <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                  Log in
                </Link>
              </p>
            </form>
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
