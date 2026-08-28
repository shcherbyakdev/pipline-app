"use client";

import * as React from "react";
import { toast } from "sonner";
import { createService } from "@/features/scheduling/actions";
import { createOffering } from "@/features/rentals/actions";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { STARTER } from "../copy";

/* The starter's second step (spec 2026-08-28 §5.3): the fewest fields that
   make one bookable thing, through the same actions the Services and
   Spaces pages use — zod fills every other default. `onCreated` fires only
   after the action said ok; the caller refreshes the route so the preview
   carries the real item. No skip (ruling 2): Back is the only other way
   out, and it leads to the type step, not the builder. */

// The native-<select> idiom shared by the booking forms (offering-dialog.tsx).
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="text-destructive text-sm">{message}</p> : null;
}

export function FirstServiceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack: () => void }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const nameId = React.useId();
  const durationId = React.useId();
  const priceId = React.useId();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const payload = { name, durationMin: Number(fd.get("durationMin")), priceLabel: priceLabel === "" ? undefined : priceLabel };
    setError(null);
    startTransition(async () => {
      const result = await createService(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{STARTER.firstService.name}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={STARTER.firstService.namePlaceholder} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={durationId}>{STARTER.firstService.duration}</Label>
          <select id={durationId} name="durationMin" defaultValue={60} className={selectClass}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={priceId}>{STARTER.firstService.price}</Label>
          <Input id={priceId} name="priceLabel" maxLength={100} placeholder={STARTER.firstService.pricePlaceholder(currency)} />
        </div>
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{STARTER.back}</Button>
        <Button type="submit" size="sm" disabled={pending}>{STARTER.firstService.submit}</Button>
      </div>
    </form>
  );
}

const MODES: ReadonlyArray<{ value: RangeMode; label: string; per: string }> = [
  { value: "hours", label: STARTER.firstSpace.hours, per: "hour" },
  { value: "nights", label: STARTER.firstSpace.nights, per: "night" },
  { value: "days", label: STARTER.firstSpace.days, per: "day" },
];

export function FirstSpaceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack: () => void }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // Controlled: the price label and the payload branch both follow it.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("hours");
  const nameId = React.useId();
  const priceId = React.useId();
  const per = MODES.find((m) => m.value === rangeMode)!.per;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const price = String(fd.get("price") ?? "").trim();
    const priceCents = price === "" ? null : Math.round(Number(price) * 100);
    // The zod branches are `.strict()` (schema.ts): only that mode's own
    // fields go in; every other field is a schema default.
    const payload =
      rangeMode === "hours"
        ? { name, rangeMode: "hours" as const, ...OFFERING_DEFAULTS.hours, priceCents }
        : { name, rangeMode, ...OFFERING_DEFAULTS.stay, priceCents };
    setError(null);
    startTransition(async () => {
      const result = await createOffering(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A notice means the space saved but its first unit or hours did not
      // (plan cap) — the page still needs it, so say so and carry on.
      if (result.notice) toast.warning(result.notice);
      onCreated();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{STARTER.firstSpace.name}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={STARTER.firstSpace.namePlaceholder} autoFocus />
      </div>
      {/* Native radios in label-cards (the onboarding picker's idiom). */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{STARTER.firstSpace.bookedBy}</legend>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const selected = rangeMode === m.value;
            return (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-md border p-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                  selected ? "border-foreground/40 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <input type="radio" name="rangeMode" value={m.value} className="sr-only" checked={selected} onChange={() => setRangeMode(m.value)} />
                {m.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={priceId}>{STARTER.firstSpace.price(per, currency)}</Label>
        <Input id={priceId} name="price" type="number" min={0} step="0.01" inputMode="decimal" />
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{STARTER.back}</Button>
        <Button type="submit" size="sm" disabled={pending}>{STARTER.firstSpace.submit}</Button>
      </div>
    </form>
  );
}
