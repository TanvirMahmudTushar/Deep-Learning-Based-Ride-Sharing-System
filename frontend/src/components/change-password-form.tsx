"use client";

import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { saveSession } from "@/lib/session";
import type { AuthResponse } from "@/lib/types";

export const PASSWORD_MIN_LENGTH = 8;

export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const id = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // Changing the password signs out older tokens, so keep the new one for this device.
      saveSession(await api<AuthResponse>("/api/auth/password", { json: { current_password: current, new_password: next } }));
      toast.success("Password changed. Other devices have been logged out.");
      setCurrent("");
      setNext("");
      setConfirm("");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${id}-current`}>Current password</Label>
        <Input id={`${id}-current`} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-new`}>New password</Label>
        <Input
          id={`${id}-new`}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={72}
          autoComplete="new-password"
        />
        <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-confirm`}>Confirm new password</Label>
        <Input
          id={`${id}-confirm`}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          autoComplete="new-password"
          aria-invalid={mismatch}
        />
        {mismatch && <p className="text-xs text-destructive">Passwords do not match.</p>}
      </div>
      <Button type="submit" variant="secondary" disabled={saving || mismatch || next.length < PASSWORD_MIN_LENGTH}>
        {saving && <Loader2 className="animate-spin" />} Change password
      </Button>
    </form>
  );
}
