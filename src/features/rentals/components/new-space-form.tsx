"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createOffering } from "@/features/rentals/actions";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import type { OfferingKind } from "@/features/rentals/pricing-rules";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const MODES: readonly RangeMode[] = ["hours", "nights", "days"];

/* /rentals/new: the fewest fields that make one bookable space — name, how
   it's booked, price — the onboarding wizard's payload (wizard-forms.tsx
   SpaceStepForm): zod fills every other default, and the space's own page
   is where the rest gets refined, so a create lands there, not on the
   list. The kind (room / whole studio / equipment) comes from the URL, so
   only a studio that asked for a package or an add-on sees their one extra
   field; a plain room is never asked "what is it?". */
export function NewSpaceForm({
  kind,
  currency,
  rooms,
}: {
  kind: OfferingKind;
  currency: string;
  /** S6: the org's hourly rooms a whole studio can include. */
  rooms: { id: string; name: string }[];
}) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  // Hourly first: the product's common case (studios, rooms by the hour),
  // and the wizard's default too, so the two create paths agree.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("hours");
  const [componentIds, setComponentIds] = React.useState<string[]>([]);
  const effectiveMode: RangeMode = kind === "space" ? rangeMode : "hours";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const description = String(fd.get("description") ?? "").trim() || undefined;
    const price = String(fd.get("price") ?? "").trim();
    const priceCents = price === "" ? null : Math.round(Number(price) * 100);
    if (kind === "composite" && componentIds.length === 0) {
      toast.error(t("form.includesRequired"));
      return;
    }
    const base = { name, description, priceCents };
    // The stay branch is `.strict()` — no `kind` there (schema.ts).
    const payload =
      effectiveMode === "hours"
        ? {
            ...base,
            rangeMode: "hours" as const,
            ...OFFERING_DEFAULTS.hours,
            kind,
            ...(kind === "composite" ? { componentIds } : {}),
            ...(kind === "equipment" ? { itemCount: Number(fd.get("itemCount") ?? 1) } : {}),
          }
        : { ...base, rangeMode: effectiveMode, ...OFFERING_DEFAULTS.stay };
    startTransition(async () => {
      const result = await createOffering(payload);
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      // A notice means the space saved but its default hours did not — a
      // warning on the way to its page, where the rail says so too.
      if (result.notice) toastRefusal(result.notice, result.upgrade, "warning");
      else toast.success(t("form.created"));
      router.push(result.id ? `/rentals/${result.id}` : "/rentals");
    });
  };

  const priceUnit =
    effectiveMode === "hours" ? t("form.perHour") : effectiveMode === "nights" ? t("form.perNight") : t("form.perDay");

  return (
    <form onSubmit={onSubmit} className="flex max-w-lg flex-col gap-6">
      <div className="flex flex-col">
        <input
          aria-label={tc("name")}
          name="name"
          required
          maxLength={200}
          placeholder={t(`form.namePlaceholder.${kind}`)}
          className={cn(dialogBareInputClass, "text-[15px] font-medium")}
          autoFocus
        />
        <textarea
          aria-label={t("form.description")}
          name="description"
          maxLength={2000}
          rows={2}
          placeholder={t("form.descriptionPlaceholder")}
          className={cn(dialogBareInputClass, "mt-3 resize-none text-sm")}
        />
      </div>

      {kind === "space" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("form.bookedBy")}</legend>
          {/* The wizard's mode cards: a native radio per card, so the group
              is one tab stop and the arrows move the choice. */}
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const selected = rangeMode === m;
              return (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                    selected ? "border-brand ring-brand/30 ring-2" : "border-border hover:bg-muted/40",
                  )}
                >
                  <input
                    type="radio"
                    name="rangeMode"
                    value={m}
                    className="sr-only"
                    checked={selected}
                    onChange={() => setRangeMode(m)}
                  />
                  <span className="font-medium">{t(`mode.${m}`)}</span>
                  <span className="text-muted-foreground text-xs">{t(`form.modeHint.${m}`)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {kind === "composite" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("form.includes")}</legend>
          {rooms.length === 0 ? <p className="text-muted-foreground text-xs">{t("form.includesEmpty")}</p> : null}
          {rooms.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={componentIds.includes(r.id)}
                onCheckedChange={(checked) =>
                  setComponentIds(
                    checked === true ? [...componentIds, r.id] : componentIds.filter((id) => id !== r.id),
                  )
                }
              />
              {r.name}
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="offering-price">{t("form.price", { currency })}</Label>
          <div className="flex items-center gap-2">
            <Input id="offering-price" name="price" type="number" min={0} step="0.01" inputMode="decimal" placeholder={t("form.unpriced")} />
            <span className="text-muted-foreground shrink-0 text-sm">{priceUnit.toLowerCase()}</span>
          </div>
        </div>
        {kind === "equipment" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="offering-item-count">{t("form.itemCount")}</Label>
            <Input id="offering-item-count" name="itemCount" type="number" required min={1} max={99} defaultValue={1} />
          </div>
        ) : null}
      </div>

      <div>
        <Button type="submit" size="sm" variant="brand" disabled={pending || (kind === "composite" && rooms.length === 0)}>
          {pending ? tc("creating") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
