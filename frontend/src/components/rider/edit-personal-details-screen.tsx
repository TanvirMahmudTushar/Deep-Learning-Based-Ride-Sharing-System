"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ChevronLeft, IdCard, KeyRound, Loader2, Mail, Phone, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RiderMe } from "@/lib/types";

export function EditPersonalDetailsScreen({
  me,
  onBack,
  onSaved,
}: {
  me: RiderMe;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [closing, setClosing] = useState(false);
  const [email, setEmail] = useState(me.email);
  const [phone, setPhone] = useState(me.phone);
  const [currentPassword, setCurrentPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== me.email.toLowerCase();

  function close() {
    setClosing(true);
    setTimeout(onBack, 220);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (emailChanged && !currentPassword) {
      toast.error("Current password is required to change your email");
      return;
    }
    setSaving(true);
    try {
      await api<RiderMe>("/api/rider/contact", {
        method: "PATCH",
        json: {
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          ...(emailChanged ? { current_password: currentPassword } : {}),
        },
      });
      toast.success("Personal details updated");
      await onSaved();
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update personal details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit personal details"
      className={cn(
        "fixed inset-0 z-[3010] flex flex-col overflow-hidden bg-background",
        closing ? "subpage-wipe-out" : "subpage-wipe-in",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
          <ChevronLeft />
        </Button>
        <h1 className="text-base font-semibold">Edit Personal Details</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <form onSubmit={handleSubmit} className="mx-auto w-full max-w-lg space-y-6">
          <div className="space-y-4 rounded-xl border p-4">
            {/* Non-editable License */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <IdCard className="size-3.5" /> Driving Licence Number (Cannot be changed)
              </Label>
              <Input value={me.license_no} disabled className="cursor-not-allowed bg-muted/60 opacity-80" />
              <p className="text-xs text-muted-foreground">
                Your licence is verified with official records and cannot be modified. Contact support if details changed.
              </p>
            </div>

            {/* Non-editable Full Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Full Name (From verified ID)</Label>
              <Input value={me.full_name} disabled className="cursor-not-allowed bg-muted/60 opacity-80" />
            </div>

            {/* Editable Phone */}
            <div className="space-y-1.5">
              <Label htmlFor="rider-phone" className="flex items-center gap-1.5">
                <Phone className="size-3.5 text-muted-foreground" /> Phone Number
              </Label>
              <Input
                id="rider-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+8801XXXXXXXXX"
                required
              />
            </div>

            {/* Editable Email */}
            <div className="space-y-1.5">
              <Label htmlFor="rider-email" className="flex items-center gap-1.5">
                <Mail className="size-3.5 text-muted-foreground" /> Email Address
              </Label>
              <Input
                id="rider-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="rider@example.com"
                required
              />
            </div>

            {/* Current Password - only if email changed */}
            {emailChanged && (
              <div className="space-y-1.5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
                <Label htmlFor="current-pw" className="flex items-center gap-1.5 text-amber-200">
                  <KeyRound className="size-3.5" /> Confirm Current Password
                </Label>
                <Input
                  id="current-pw"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password to change email"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Since your email is used for sign-in, verifying your password is required.
                </p>
              </div>
            )}
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? <Loader2 className="animate-spin" /> : <Save className="size-4" />} Save Changes
          </Button>
        </form>
      </div>
    </div>
  );
}

