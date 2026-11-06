"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { ChangePasswordForm } from "@/components/change-password-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, fetcher } from "@/lib/api";
import { updateSessionProfile } from "@/lib/session";
import type { PassengerSummary, Profile } from "@/lib/types";

function ProfileForm({ profile }: { profile: Profile }) {
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== profile.full_name || phone.trim() !== profile.phone;

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api<Profile>("/api/auth/me", { method: "PATCH", json: { full_name: name, phone } });
      updateSessionProfile(updated);
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="acct-name">Full name</Label>
        <Input id="acct-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="acct-phone">Phone</Label>
        <Input id="acct-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required minLength={6} maxLength={32} autoComplete="tel" />
        <p className="text-xs text-muted-foreground">Shared with your rider during a trip.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="acct-email">Email</Label>
        <Input id="acct-email" value={profile.email} disabled />
      </div>
      <Button type="submit" disabled={!dirty || saving}>
        {saving && <Loader2 className="animate-spin" />} Save changes
      </Button>
    </form>
  );
}

export function AccountTab({ profile }: { profile: Profile }) {
  const { data: s } = useSWR<PassengerSummary>("/api/passenger/summary", fetcher);
  const since = s?.member_since ? new Date(s.member_since).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>{since ? `Riding with us since ${since}` : "Your account details"}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm key={`${profile.full_name}|${profile.phone}`} profile={profile} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it logs you out on your other devices.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
