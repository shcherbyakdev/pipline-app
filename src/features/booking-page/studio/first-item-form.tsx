"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { createService } from "@/features/scheduling/actions";
import { createOffering } from "@/features/rentals/actions";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

export function FirstServiceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack?: () => void }) {
  const t = useTranslations("studio.starter");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
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
      try {
        const result = await createService(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onCreated();
      } catch (error) {
        console.error("[booking-page] first item threw:", error);
        setError(tErrors("generic"));
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{t("firstService.name")}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={t("firstService.namePlaceholder")} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={durationId}>{t("firstService.duration")}</Label>
          <select id={durationId} name="durationMin" defaultValue={60} className={selectClass}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} {tCommon("min")}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={priceId}>{t("firstService.price")}</Label>
          <Input id={priceId} name="priceLabel" maxLength={100} placeholder={t("firstService.pricePlaceholder", { currency })} />
        </div>
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{t("back")}</Button> : null}
        <Button type="submit" size="sm" disabled={pending}>{t("firstService.submit")}</Button>
      </div>
    </form>
  );
}

const MODES: readonly RangeMode[] = ["hours", "nights", "days"];
const PRICE_LABEL = { hours: "priceHour", nights: "priceNight", days: "priceDay" } as const;

export function FirstSpaceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack?: () => void }) {
  const t = useTranslations("studio.starter");
  const tErrors = useTranslations("errors");
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // A notice means the space saved but its first unit or hours did not (plan
  // cap): the page still needs a bookable unit, so hold the step instead of
  // advancing on a fading toast.
  const [notice, setNotice] = React.useState<string | null>(null);
  // Controlled: the price label and the payload branch both follow it.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("hours");
  const nameId = React.useId();
  const priceId = React.useId();

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
      try {
        const result = await createOffering(payload);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.notice) {
          setNotice(result.notice);
          return;
        }
        onCreated();
      } catch (error) {
        console.error("[booking-page] first item threw:", error);
        setError(tErrors("generic"));
      }
    });
  };

  if (notice) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{notice}</p>
        <p className="text-muted-foreground text-sm">{t("firstSpace.noticeHint")}</p>
        <div className="flex items-center justify-between gap-2">
          {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack}>{t("back")}</Button> : null}
          <Button type="button" size="sm" onClick={onCreated}>{t("continue")}</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{t("firstSpace.name")}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={t("firstSpace.namePlaceholder")} autoFocus />
      </div>
      {/* Native radios in label-cards (the onboarding picker's idiom). */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{t("firstSpace.bookedBy")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const selected = rangeMode === m;
            return (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-md border p-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                  selected ? "border-foreground/40 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <input type="radio" name="rangeMode" value={m} className="sr-only" checked={selected} onChange={() => setRangeMode(m)} />
                {t(`firstSpace.${m}`)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={priceId}>{t(`firstSpace.${PRICE_LABEL[rangeMode]}`, { currency })}</Label>
        <Input id={priceId} name="price" type="number" min={0} step="0.01" inputMode="decimal" />
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{t("back")}</Button> : null}
        <Button type="submit" size="sm" disabled={pending}>{t("firstSpace.submit")}</Button>
      </div>
    </form>
  );
}
