"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRTA_CLASS_CODES, BRTA_REGIONS, formatPlate, parsePlate, toAsciiDigits, type BrtaRegion } from "@/lib/brta";
import { cn } from "@/lib/utils";
import type { VehicleType } from "@/lib/types";

/** Radix Select disallows empty-string item values, so use a sentinel for the blank option. */
const BLANK_CLASS = "__none__";

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
  const numberInputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parsePlate(value || "", vehicleType), [value, vehicleType]);

  // Nothing is selected until the rider picks it (or an existing plate is being edited).
  const [region, setRegion] = useState(value ? parsed.region : "");
  const [classCodeState, setClassCode] = useState(value ? parsed.classCode : "");
  const [number6, setNumber6] = useState(value ? parsed.number6 : "");
  const [lastEmitted, setLastEmitted] = useState<string | undefined>(value);
  const [touched, setTouched] = useState(false);

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const availableClasses = BRTA_CLASS_CODES[vehicleType] || BRTA_CLASS_CODES.bike;

  // Sync state only on external value changes (never wipe typed segments on vehicleType change or internal echo)
  const [synced, setSynced] = useState({ value, vehicleType });
  if (synced.value !== value || synced.vehicleType !== vehicleType) {
    const valueChanged = synced.value !== value;
    setSynced({ value, vehicleType });
    if (valueChanged && value !== lastEmitted) {
      setLastEmitted(value);
      if (value) {
        const p = parsePlate(value, vehicleType);
        setRegion(p.region);
        setClassCode(p.classCode);
        setNumber6(p.number6);
      } else {
        setRegion("");
        setClassCode("");
        setNumber6("");
      }
    }
  }

  // An empty class means "nothing selected yet". A chosen class must be valid for the vehicle type.
  const classIsValid = !classCodeState || availableClasses.some((c) => c.code === classCodeState);
  const classCode = classIsValid ? classCodeState : (availableClasses[0]?.code ?? classCodeState);

  function emitChange(nextRegion: string, nextClass: string, nextNum: string) {
    const nextPlate = formatPlate(nextRegion, nextClass, nextNum);
    setLastEmitted(nextPlate);
    onChange?.(nextPlate);
  }

  // Tell the parent about the corrected plate only when a chosen class had to be fixed.
  useEffect(() => {
    if (classCodeState && !classIsValid && availableClasses[0]) {
      const nextPlate = formatPlate(region, classCode, number6);
      setLastEmitted(nextPlate);
      onChange?.(nextPlate);
    }
  }, [classCodeState, classIsValid, availableClasses, classCode, region, number6, onChange]);

  const filteredRegions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return BRTA_REGIONS;
    return BRTA_REGIONS.filter(
      (r) => r.code.toLowerCase().includes(q) || r.bengali.includes(q),
    );
  }, [searchQuery]);

  const currentRegion = BRTA_REGIONS.find((r) => r.code === region) || null;
  const currentClass = availableClasses.find((c) => c.code === classCode) || null;

  function handleRegionSelect(r: BrtaRegion | null) {
    const code = r?.code ?? "";
    setRegion(code);
    setSelectorOpen(false);
    setSearchQuery("");
    emitChange(code, classCode, number6);
  }

  function handleClassSelect(cCode: string) {
    const next = cCode === BLANK_CLASS ? "" : cCode;
    setClassCode(next);
    emitChange(region, next, number6);
  }

  function handleNumberChange(raw: string) {
    const digits = toAsciiDigits(raw).replace(/\D/g, "").slice(0, 6);
    let formatted = digits;
    if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    setNumber6(formatted);
    emitChange(region, classCode, formatted);
  }

  const digits = toAsciiDigits(number6).replace(/\D/g, "");
  const hasAnyInput = !!(currentRegion || currentClass || digits.length > 0);
  const needsValidation = required || hasAnyInput;
  const fieldErrors: string[] = [];
  if (needsValidation) {
    if (!currentRegion) fieldErrors.push("Select a BRTA region.");
    if (!currentClass) fieldErrors.push("Select a vehicle class.");
    if (digits.length !== 6) {
      fieldErrors.push("Enter all 6 plate digits (e.g. 12-3456; Bengali digits ০-৯ are supported).");
    }
  }
  const validationMessage = fieldErrors[0] ?? "";
  const showFieldError = touched && !!validationMessage;

  useEffect(() => {
    numberInputRef.current?.setCustomValidity(validationMessage);
  }, [validationMessage]);

  const fullPlate = formatPlate(region, classCode, number6);
  const hasRegionOrClass = !!(currentRegion || currentClass);
  const bnLine1 = hasRegionOrClass
    ? [currentRegion?.bengali, currentClass?.bengali].filter(Boolean).join("-")
    : "— — —";
  const hasNumber = number6.length > 0;
  const bnLine2 = hasNumber ? toBengaliDigits(number6) : "— — — —";
  const previewReady = !!currentRegion && !!currentClass && hasNumber;

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
            aria-invalid={showFieldError && !currentRegion}
            className={cn(
              "h-10 w-full justify-between px-3 text-left font-normal",
              showFieldError && !currentRegion && "border-destructive",
            )}
          >
            <span className={cn("truncate text-xs sm:text-sm", !currentRegion && "text-muted-foreground")}>
              {currentRegion ? `${currentRegion.code} (${currentRegion.bengali})` : "Select region"}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </div>

        {/* Dropdown 2: Vehicle Class Code */}
        <div className="space-y-1.5 sm:col-span-3">
          <Label className="text-xs text-muted-foreground">Class</Label>
          <Select value={classCode || BLANK_CLASS} onValueChange={handleClassSelect}>
            <SelectTrigger
              aria-invalid={showFieldError && !currentClass}
              className={cn("h-10 w-full", showFieldError && !currentClass && "border-destructive")}
            >
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BLANK_CLASS}>Select...</SelectItem>
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
            ref={numberInputRef}
            id={`${inputId}-plate-num`}
            type="text"
            inputMode="numeric"
            maxLength={12}
            placeholder="12-3456"
            value={number6}
            onChange={(e) => handleNumberChange(e.target.value)}
            onBlur={() => setTouched(true)}
            onInvalid={(e) => {
              e.preventDefault();
              setTouched(true);
            }}
            aria-invalid={showFieldError && digits.length !== 6}
            aria-describedby={showFieldError ? `${inputId}-plate-error` : undefined}
            required={required}
            className={cn(
              "h-10 text-center font-mono text-sm tracking-wider",
              showFieldError && digits.length !== 6 && "border-destructive",
            )}
          />
        </div>
      </div>

      {showFieldError && (
        <p id={`${inputId}-plate-error`} role="alert" className="text-xs font-medium text-destructive">
          {fieldErrors.join(" ")}
        </p>
      )}

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

          {/* Line 1: Region and class identifier, blank until both are selected */}
          <div
            style={{ fontFamily: 'var(--font-solaiman-lipi), "SolaimanLipi", sans-serif' }}
            className={cn(
              "font-solaiman-lipi text-center font-bold text-black tracking-normal text-2xl sm:text-[1.75rem] leading-[1.15]",
              !currentRegion && "text-zinc-400",
            )}
          >
            {bnLine1}
          </div>

          {/* Line 2: Six-digit number in Bengali, or a neutral placeholder while empty */}
          <div
            style={{ fontFamily: 'var(--font-solaiman-lipi), "SolaimanLipi", sans-serif' }}
            className={cn(
              "font-solaiman-lipi text-center font-bold text-black tracking-wider text-2xl sm:text-[1.75rem] leading-[1.15]",
              !hasNumber && "text-zinc-400",
            )}
          >
            {bnLine2}
          </div>
        </div>
      </div>
      {!previewReady && (
        <p className="text-center text-xs text-muted-foreground">
          Select the region and class, then enter the plate number to preview it here.
        </p>
      )}

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
              <button
                type="button"
                onClick={() => handleRegionSelect(null)}
                className={cn(
                  "flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-muted/60 sm:text-sm",
                  !region && "bg-primary/10 font-semibold text-primary",
                )}
              >
                Select region
                {!region && <Check className="size-4 text-primary" />}
              </button>
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

