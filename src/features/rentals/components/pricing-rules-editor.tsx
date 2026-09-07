"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeCombobox } from "@/features/scheduling/components/time-combobox";
import { TIME_OPTIONS } from "@/features/scheduling/time-options";
import type { Extra, PricingRules, Surcharge } from "@/features/rentals/pricing-rules";
import { cn } from "@/lib/utils";

/* A decimal field that survives being typed in. A controlled
   `type="number"` round-tripped through cents cannot hold a half-typed
   number: the HTML sanitiser reports "" for "89.", so the state took 0 and
   "89.50" landed as 0.50. This keeps the raw string while the field is
   being edited and commits once — on blur or Enter — normalising "," to
   ".". `value` and the committed number are both in display units (major
   currency, or hours for a band's start), so the caller does the ×100 / ×60. */
function DecimalInput({
  value, min = 0, onCommit, ...rest
}: { value: number; min?: number; onCommit: (v: number) => void } & Omit<
  React.ComponentProps<typeof Input>,
  "value" | "min" | "onChange" | "onBlur" | "onKeyDown"
>) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.trim().replace(",", "."));
    if (draft.trim() !== "" && Number.isFinite(n) && n >= min) onCommit(n);
    setDraft(null);
  };
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
      }}
    />
  );
}

function RowRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} className="shrink-0">
      <X className="size-4" />
    </Button>
  );
}

/* The four row editors of the Pricing section for an hourly space (spec
   2026-09-07 §Admin). Controlled: the form owns the value and posts it as
   one `pricing` object; every amount is typed in major units and stored in
   cents. Row idiom follows the availability day-interval editor: add,
   remove, no drag. */
export function PricingRulesEditor({
  value, onChange, currency, minDurationMin,
}: {
  value: PricingRules | null;
  onChange: (next: PricingRules | null) => void;
  currency: string;
  minDurationMin: number;
}) {
  const t = useTranslations("spaces.form.pricing");
  const tw = useTranslations("availability");
  const weekdays = tw("weekdaysShort").split(" "); // Sun … Sat (0…6)
  const rules = value;
  const set = (patch: Partial<PricingRules>) => onChange({ ...(rules ?? { bands: [], surcharges: [], extras: [] }), ...patch });
  // The first band's start mirrors Min duration (its input is disabled), so
  // it has to follow the live value: lowering Min duration otherwise left a
  // band the schema refuses and no way to edit it back.
  React.useEffect(() => {
    if (rules !== null && rules.bands[0] !== undefined && rules.bands[0].fromMin !== minDurationMin) {
      onChange({ ...rules, bands: rules.bands.map((b, i) => (i === 0 ? { ...b, fromMin: minDurationMin } : b)) });
    }
  }, [minDurationMin, rules, onChange]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Label htmlFor="pricing-rules-on">{t("useRules")}</Label>
          <span className="text-muted-foreground text-xs">{t("useRulesHint")}</span>
        </div>
        <Switch
          id="pricing-rules-on"
          checked={rules !== null}
          onCheckedChange={(on) => onChange(on ? { bands: [{ fromMin: minDurationMin, perHourCents: 0 }], surcharges: [], extras: [] } : null)}
        />
      </div>
      {rules === null ? null : (
        <>
          {/* Rates by length */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("bands.title")}</legend>
            {rules.bands.map((b, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
                <span className="text-muted-foreground text-xs">{t("bands.from")}</span>
                <DecimalInput aria-label={t("bands.fromAria", { n: i + 1 })} min={0.5} value={b.fromMin / 60}
                  disabled={i === 0}
                  onCommit={(v) => set({ bands: rules.bands.map((x, j) => j === i ? { ...x, fromMin: Math.round(v * 60) } : x) })} />
                <select aria-label={t("bands.kindAria", { n: i + 1 })} className={nativeSelectClass}
                  value={b.totalCents !== undefined ? "total" : "perHour"}
                  onChange={(e) => set({ bands: rules.bands.map((x, j) => j === i
                    ? (e.target.value === "total" ? { fromMin: x.fromMin, totalCents: x.perHourCents ?? 0 } : { fromMin: x.fromMin, perHourCents: x.totalCents ?? 0 })
                    : x) })}>
                  <option value="perHour">{t("bands.perHour", { currency })}</option>
                  <option value="total">{t("bands.total", { currency })}</option>
                </select>
                <DecimalInput aria-label={t("bands.amountAria", { n: i + 1 })}
                  value={(b.totalCents ?? b.perHourCents ?? 0) / 100}
                  onCommit={(v) => set({ bands: rules.bands.map((x, j) => j === i
                    ? (x.totalCents !== undefined ? { ...x, totalCents: Math.round(v * 100) } : { ...x, perHourCents: Math.round(v * 100) })
                    : x) })} />
                {i === 0 ? <span /> : <RowRemove label={t("bands.remove", { n: i + 1 })} onClick={() => set({ bands: rules.bands.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            {rules.bands.length < 8 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => set({ bands: [...rules.bands, { fromMin: (rules.bands.at(-1)?.fromMin ?? minDurationMin) + 60, perHourCents: rules.bands.at(-1)?.perHourCents ?? 0 }] })}>
                {t("bands.add")}
              </Button>
            ) : null}
          </fieldset>

          {/* Surcharges */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("surcharges.title")}</legend>
            {rules.surcharges.map((s, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <Input aria-label={t("surcharges.labelAria", { n: i + 1 })} maxLength={60} placeholder={t("surcharges.labelPlaceholder")} value={s.label}
                    onChange={(e) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs">+</span>
                    <Input aria-label={t("surcharges.pctAria", { n: i + 1 })} type="number" min={1} max={200} className="w-20" value={s.pct}
                      onChange={(e) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x) })} />
                    <span className="text-muted-foreground text-xs">{t("surcharges.pctSuffix")}</span>
                  </div>
                  <RowRemove label={t("surcharges.remove", { n: i + 1 })} onClick={() => set({ surcharges: rules.surcharges.filter((_, j) => j !== i) })} />
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label={t("surcharges.days")}>
                  {weekdays.map((name, dow) => (
                    <button key={dow} type="button" aria-pressed={s.days.includes(dow)}
                      className={cn("rounded-md border px-2 py-1 text-xs", s.days.includes(dow) ? "bg-foreground text-background" : "text-muted-foreground")}
                      onClick={() => set({ surcharges: rules.surcharges.map((x, j) => j === i
                        ? { ...x, days: x.days.includes(dow) ? (x.days.length > 1 ? x.days.filter((d) => d !== dow) : x.days) : [...x.days, dow].sort() } : x) })}>
                      {name}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TimeCombobox id={`surcharge-${i}-from`} label={t("surcharges.from")} value={s.from} options={TIME_OPTIONS}
                    onCommit={(v) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, from: v } : x) })} />
                  <TimeCombobox id={`surcharge-${i}-to`} label={t("surcharges.to")} value={s.to} options={TIME_OPTIONS}
                    onCommit={(v) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, to: v } : x) })} />
                </div>
              </div>
            ))}
            {rules.surcharges.length < 4 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => set({ surcharges: [...rules.surcharges, { label: t("surcharges.labelPlaceholder"), pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" } satisfies Surcharge] })}>
                {t("surcharges.add")}
              </Button>
            ) : null}
          </fieldset>

          {/* People */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("people.title")}</legend>
            <div className="flex items-center justify-end gap-3">
              <Switch aria-label={t("people.title")} checked={rules.people !== undefined}
                onCheckedChange={(on) => set({ people: on ? { included: 5, extraCents: 0, max: 10 } : undefined })} />
            </div>
            {rules.people ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-included">{t("people.included")}</Label>
                  <Input id="people-included" type="number" min={0} max={500} value={rules.people.included}
                    onChange={(e) => set({ people: { ...rules.people!, included: Number(e.target.value) } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-extra">{t("people.extra", { currency })}</Label>
                  <DecimalInput id="people-extra" value={rules.people.extraCents / 100}
                    onCommit={(v) => set({ people: { ...rules.people!, extraCents: Math.round(v * 100) } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-max">{t("people.max")}</Label>
                  <Input id="people-max" type="number" min={0} max={500} value={rules.people.max}
                    onChange={(e) => set({ people: { ...rules.people!, max: Number(e.target.value) } })} />
                </div>
              </div>
            ) : null}
          </fieldset>

          {/* Extras */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("extras.title")}</legend>
            {rules.extras.map((x, i) => (
              <div key={x.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2">
                <Input aria-label={t("extras.labelAria", { n: i + 1 })} maxLength={60} placeholder={t("extras.labelPlaceholder")} value={x.label}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, label: e.target.value } : y) })} />
                <select aria-label={t("extras.unitAria", { n: i + 1 })} className={nativeSelectClass} value={x.unit}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, unit: e.target.value as Extra["unit"] } : y) })}>
                  <option value="hour">{t("extras.perHour")}</option>
                  <option value="piece">{t("extras.perPiece")}</option>
                </select>
                <DecimalInput aria-label={t("extras.priceAria", { n: i + 1 })} className="w-24" value={x.priceCents / 100}
                  onCommit={(v) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, priceCents: Math.round(v * 100) } : y) })} />
                <Input aria-label={t("extras.maxAria", { n: i + 1 })} type="number" min={1} max={99} className="w-16" value={x.maxQty}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, maxQty: Number(e.target.value) } : y) })} />
                <RowRemove label={t("extras.remove", { n: i + 1 })} onClick={() => set({ extras: rules.extras.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {rules.extras.length < 12 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => {
                  // A fresh id once; a later relabel keeps it (existing bookings' lines reference it).
                  const n = rules.extras.length + 1;
                  const id = `extra-${n}-${Date.now().toString(36)}`.slice(0, 32);
                  set({ extras: [...rules.extras, { id, label: t("extras.labelPlaceholder"), unit: "hour", priceCents: 0, maxQty: 1 }] });
                }}>
                {t("extras.add")}
              </Button>
            ) : null}
          </fieldset>
        </>
      )}
    </div>
  );
}
