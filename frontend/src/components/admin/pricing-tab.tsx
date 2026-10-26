"use client";

import { useState, type FormEvent } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { VehicleIcon } from "@/components/ride-bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, fetcher } from "@/lib/api";
import { formatTaka, VEHICLE_COLOR, VEHICLE_LABEL } from "@/lib/format";
import type { PricingRule } from "@/lib/types";

const FIELDS: { key: keyof Omit<PricingRule, "id" | "vehicle_type">; label: string; step: string }[] = [
  { key: "base_fare", label: "Base fare (৳)", step: "1" },
  { key: "per_km", label: "Per km (৳)", step: "0.5" },
  { key: "per_min", label: "Per minute (৳)", step: "0.5" },
  { key: "min_fare", label: "Minimum fare (৳)", step: "1" },
  { key: "max_multiplier", label: "Max demand multiplier", step: "0.1" },
  { key: "commission_pct", label: "Platform commission (%)", step: "0.5" },
];

function RuleCard({ rule, onSaved }: { rule: PricingRule; onSaved: () => void }) {
  const [values, setValues] = useState(rule);
  const [saving, setSaving] = useState(false);
  const sample = Math.max(values.min_fare, values.base_fare + values.per_km * 8 + values.per_min * 25);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key]]));
      await api(`/api/admin/pricing/${rule.vehicle_type}`, { method: "PUT", json: body });
      toast.success(`${VEHICLE_LABEL[rule.vehicle_type]} pricing saved`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <VehicleIcon type={rule.vehicle_type} className="size-5" style={{ color: VEHICLE_COLOR[rule.vehicle_type] }} />
          {VEHICLE_LABEL[rule.vehicle_type]}
        </CardTitle>
        <CardDescription>8 km, 25 min trip: {formatTaka(sample)} at 1.0x, up to {formatTaka(sample * values.max_multiplier)}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid grid-cols-[1fr_110px] items-center gap-3">
              <Label htmlFor={`${rule.vehicle_type}-${f.key}`} className="text-sm font-normal text-muted-foreground">
                {f.label}
              </Label>
              <Input
                id={`${rule.vehicle_type}-${f.key}`}
                type="number"
                min={f.key === "max_multiplier" ? 1 : 0}
                max={f.key === "max_multiplier" ? 3 : f.key === "commission_pct" ? 50 : undefined}
                step={f.step}
                required
                className="text-right tabular-nums"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: Number(e.target.value) }))}
              />
            </div>
          ))}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PricingTab() {
  const { data: rules, mutate } = useSWR<PricingRule[]>("/api/admin/pricing", fetcher);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Fare = max(minimum, base + per km × distance + per minute × predicted ETA) × demand multiplier. The multiplier rises in 0.1 steps once expected
        requests exceed 1.2× the free riders nearby, and never passes the cap set here. Passengers pay riders in cash; the commission is the
        platform&apos;s share, which riders settle with an admin (Payments tab).
      </p>
      <div className="grid gap-4 md:grid-cols-3">{rules?.map((r) => <RuleCard key={r.id} rule={r} onSaved={() => void mutate()} />)}</div>
    </div>
  );
}
