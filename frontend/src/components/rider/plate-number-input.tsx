"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SPRING_UI } from "@/components/ui/motion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRTA_CLASS_CODES, BRTA_REGIONS, formatPlate, parsePlate, type BrtaRegion } from "@/lib/brta";
import { cn } from "@/lib/utils";
import type { VehicleType } from "@/lib/types";

const BN_DIGITS: Record<string, string> = {
  "0": "০",
  "1": "১",
  "2": "২",
  "3": "৩",
  "4": "৪",
  "5": "৫",
  "6": "৬",
  "7": "৭",
  "8": "৮",
  "9": "৯",
  "-": "-",
};

function toBengaliDigits(str: string): string {
  return str
    .split("")
    .map((ch) => BN_DIGITS[ch] ?? ch)
    .join("");
}

export function PlateNumberInput({
  value,
  onChange,
  vehicleType,
  name = "plate_no",
  required = true,
  className,
}: {
  value?: string;
  onChange?: (plate: string) => void;
  vehicleType: VehicleType;
  name?: string;
  required?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const parsed = useMemo(() => parsePlate(value || "", vehicleType), [value, vehicleType]);

  const [region, setRegion] = useState(parsed.region);
  const [classCode, setClassCode] = useState(parsed.classCode);
  const [number6, setNumber6] = useState(parsed.number6);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const availableClasses = BRTA_CLASS_CODES[vehicleType] || BRTA_CLASS_CODES.bike;

  // When vehicleType changes, ensure classCode is valid for that type
  useEffect(() => {
    const valid = availableClasses.some((c) => c.code === classCode);
    if (!valid && availableClasses[0]) {
      const nextClass = availableClasses[0].code;
      setClassCode(nextClass);
      const nextPlate = formatPlate(region, nextClass, number6);
      onChange?.(nextPlate);
    }
  }, [vehicleType, availableClasses, classCode, region, number6, onChange]);

  // Sync state if external value changes drastically
  useEffect(() => {
    if (!value) return;
    const p = parsePlate(value, vehicleType);
    setRegion(p.region);
    setClassCode(p.classCode);
    setNumber6(p.number6);
  }, [value, vehicleType]);

  const filteredRegions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return BRTA_REGIONS;
    return BRTA_REGIONS.filter(
      (r) => r.code.toLowerCase().includes(q) || r.bengali.includes(q),
    );
  }, [searchQuery]);

  const currentRegion = BRTA_REGIONS.find((r) => r.code === region) || BRTA_REGIONS[0];
  const currentClass = availableClasses.find((c) => c.code === classCode) || availableClasses[0];

  function handleRegionSelect(r: BrtaRegion) {
    setRegion(r.code);
    setSelectorOpen(false);
    setSearchQuery("");
    const nextPlate = formatPlate(r.code, classCode, number6);
    onChange?.(nextPlate);
  }

  function handleClassSelect(cCode: string) {
    setClassCode(cCode);
    const nextPlate = formatPlate(region, cCode, number6);
    onChange?.(nextPlate);
  }

  function handleNumberChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    setNumber6(formatted);
    const nextPlate = formatPlate(region, classCode, formatted);
    onChange?.(nextPlate);
  }

  const fullPlate = formatPlate(region, classCode, number6);
  const bnLine1 = `${currentRegion.bengali}-${currentClass?.bengali || ""}`.trim();
  const bnLine2 = toBengaliDigits(number6 || "১১-২৪০৮");

  return (
    <div className={cn("space-y-3", className)}>
      {/* Hidden input for FormData form submission */}
      <input type="hidden" name={name} value={fullPlate} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-12">
        {/* Dropdown 1: Region */}
        <div className="space-y-1.5 sm:col-span-5">
          <Label className="text-xs text-muted-foreground">Region</Label>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSelectorOpen(true)}
            className="h-10 w-full justify-between px-3 text-left font-normal"
          >
            <span className="truncate text-xs sm:text-sm">
              {currentRegion.code} ({currentRegion.bengali})
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </div>

        {/* Dropdown 2: Vehicle Class Code */}
        <div className="space-y-1.5 sm:col-span-3">
          <Label className="text-xs text-muted-foreground">Class</Label>
          <Select value={classCode} onValueChange={handleClassSelect}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableClasses.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} ({c.bengali})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Textfield 3: Six-digit number with auto-inserted hyphen */}
        <div className="space-y-1.5 sm:col-span-4">
          <Label htmlFor={`${inputId}-plate-num`} className="text-xs text-muted-foreground">
            Plate Number
          </Label>
          <Input
            id={`${inputId}-plate-num`}
            type="text"
            inputMode="numeric"
            maxLength={7}
            value={number6}
            onChange={(e) => handleNumberChange(e.target.value)}
            required={required}
            className="h-10 text-center font-mono text-sm tracking-wider"
          />
        </div>
      </div>

      {/* Visual Bangladesh BRTA License Plate Preview (Realistic physical plate design) */}
      <div className="flex justify-center py-1">
        <div className="relative flex w-60 sm:w-68 flex-col items-center justify-center rounded-xl border-[2.5px] border-black bg-white px-3 py-2 sm:py-2.5 shadow-md select-none">
          {/* Top metallic screw heads */}
          <span
            aria-hidden="true"
            className="absolute top-2 left-4 size-2.5 rounded-full border border-zinc-400 bg-gradient-to-br from-zinc-100 to-zinc-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]"
          />
          <span
            aria-hidden="true"
            className="absolute top-2 right-4 size-2.5 rounded-full border border-zinc-400 bg-gradient-to-br from-zinc-100 to-zinc-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)]"
          />

          {/* Line 1: Region and class identifier */}
          <div
            style={{ fontFamily: 'var(--font-solaiman-lipi), "SolaimanLipi", sans-serif' }}
            className="font-solaiman-lipi text-center font-bold text-black tracking-normal text-2xl sm:text-[1.75rem] leading-[1.15]"
          >
            {bnLine1}
          </div>

          {/* Line 2: Six-digit number in Bengali */}
          <div
            style={{ fontFamily: 'var(--font-solaiman-lipi), "SolaimanLipi", sans-serif' }}
            className="font-solaiman-lipi text-center font-bold text-black tracking-wider text-2xl sm:text-[1.75rem] leading-[1.15]"
          >
            {bnLine2}
          </div>
        </div>
      </div>

      {/* Searchable Region Dialog */}
      <Dialog open={selectorOpen} onOpenChange={setSelectorOpen}>
        <DialogContent className="max-w-md p-0">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle className="text-base">Select BRTA Region</DialogTitle>
          </DialogHeader>

          <div className="p-4 pt-0">
            <div className="relative mb-3">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search region (e.g. Dhaka, ঢাকা)..."
                className="h-10 pr-9 pl-9 text-sm"
                autoFocus
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto overscroll-contain rounded-lg border divide-y">
              {filteredRegions.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No matching region found.
                </div>
              ) : (
                filteredRegions.map((r) => {
                  const active = r.code === region;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => handleRegionSelect(r)}
                      className={cn(
                        "flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/60 sm:text-sm",
                        active && "bg-primary/10 font-semibold text-primary",
                      )}
                    >
                      <span>
                        {r.code} <span className="text-muted-foreground font-normal">({r.bengali})</span>
                      </span>
                      {active && <Check className="size-4 text-primary" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

