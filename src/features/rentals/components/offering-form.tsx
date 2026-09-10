"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { updateOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import type { RangeMode } from "@/features/rentals/range";
import type { DepositType } from "@/features/rentals/pricing";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { pricingRulesFor, type PricingRules } from "@/features/rentals/pricing-rules";
import { cancelPolicySchema, formatCancelWindow, type CancelPolicy } from "@/features/rentals/cancel-policy";
import {
  GAP_OPTIONS,
  NOTICE_OPTIONS,
  bookingSummary,
  durationOptions,
  priceSummary,
  rulesSummary,
  snapToIncrement,
  withCurrent,
} from "@/features/rentals/settings-summary";
import { Button } from "@/components/ui/button";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { TIME_OPTIONS } from "@/features/scheduling/time-options";
import { TimeCombobox } from "@/features/scheduling/components/time-combobox";
import { PricingRulesEditor } from "./pricing-rules-editor";
import { CancelPolicyEditor } from "./cancel-policy-editor";

const selectClass = nativeSelectClass;

/* TimeCombobox in an uncontrolled form: the combobox is controlled, so the
   hidden input carries its value into the FormData under the old name. The
   surrounding fragment is keyed per mode, so defaultValue-style seeding via
   useState stays correct across mode switches. */
function TimeField({ id, name, label, defaultValue }: { id: string; name: string; label: string; defaultValue: string }) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <TimeCombobox id={id} label={label} value={value} options={TIME_OPTIONS} onCommit={setValue} className="w-full" />
    </>
  );
}

const INCREMENT_OPTIONS = [15, 30, 60];

/* One settings row: closed, it reads its saved values as a sentence; open,
   it is the editor. Native <details>, so closed fields stay in the DOM and
   FormData still submits them (the one-form-one-Save contract below). */
function Section({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-3 select-none [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-muted-foreground text-xs">{summary}</span>
        </span>
        <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-4 pt-2 pb-5">{children}</div>
    </details>
  );
}

/** A number input followed by its unit, so the row reads as a sentence. */
function Suffixed({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {children}
      <span className="text-muted-foreground shrink-0 text-sm">{suffix}</span>
    </div>
  );
}

/* The Settings section of /rentals/[id] (a new space is new-space-form.tsx;
   the name and description live in the header, space-header.tsx). Three
   rows — Booking, Price, Booking rules — each closed by default and
   summarising what is saved; open one to change it. Step, min/max and
   deposit type/value are checked together, so this stays one form with one
   Save. `kind` is a fact of the row (set at create, never edited) and only
   picks the render branch: equipment answers one question — how much. */
export function OfferingForm({
  offering,
  currency,
  rooms,
}: {
  offering: OfferingRow;
  currency: string;
  /** S6: the org's hourly rooms a composite can include — plain spaces
      only (no nesting), never the composite itself. */
  rooms: { id: string; name: string }[];
}) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const tu = useTranslations("public.units");
  // Seeded ONCE. A save revalidates the page, which hands this form a fresh
  // row — and a `defaultValue` that changes under a live uncontrolled input
  // is ambiguous: React ignores it for a field the user has touched, and
  // Base UI warns. The fields already show what was just saved, so the
  // defaults are frozen at mount and the live prop is used only where the
  // page genuinely changes underneath (the save target, the row summaries
  // and the render branches below). Remounting instead was rejected on the
  // space page: it would drop an edit in flight elsewhere in the form.
  const [seed] = React.useState(offering);

  const [pending, startTransition] = React.useTransition();
  // Controlled so the render branch (Stay section fields) and the payload
  // built in onSubmit always agree on which fields are on the page —
  // switching modes mid-form unmounts the other branch's inputs, so a
  // stale field is never in the submitted FormData.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>(offering.rangeMode);
  const [componentIds, setComponentIds] = React.useState<string[]>(offering.componentIds);
  // The three hourly lengths are controlled together: changing the slot
  // size snaps min/max back onto its grid (the server refuses anything off
  // it), and the pricing editor's first band follows the live minimum.
  const [slotIncrementMin, setSlotIncrementMin] = React.useState<number>(offering.slotIncrementMin ?? 30);
  const [minDurationMin, setMinDurationMin] = React.useState<number>(offering.minDurationMin ?? 60);
  const [maxDurationMin, setMaxDurationMin] = React.useState<number>(offering.maxDurationMin ?? 240);
  // S1: null = the flat Price row applies; rules make that pair inert
  // (submitted as priceCents: null, pricingMode: "per_unit").
  const [pricing, setPricing] = React.useState<PricingRules | null>(offering.pricing);
  // S3: the tiered editor is controlled the same way — the form owns the
  // value and posts it as one `cancelPolicy` array.
  const [cancelPolicy, setCancelPolicy] = React.useState<CancelPolicy>(offering.cancelPolicy);
  // Controlled so the deposit-value input's semantics (amount vs. percent)
  // and its very presence (none/full take no value) track the select live.
  const [depositType, setDepositType] = React.useState<DepositType>(offering.depositType);
  // A controlled switch (the one checked-control idiom, ui/switch.tsx) —
  // Base UI's Switch is a button, so the value travels in state, not FormData.
  const [requiresApproval, setRequiresApproval] = React.useState(offering.requiresApproval);

  const kind = offering.kind;
  const isEquipment = kind === "equipment";
  const effectiveRangeMode: RangeMode = kind === "space" ? rangeMode : "hours";

  const onIncrement = (next: number) => {
    setSlotIncrementMin(next);
    setMinDurationMin(snapToIncrement(minDurationMin, next));
    setMaxDurationMin(snapToIncrement(maxDurationMin, next));
  };

  // A closed <details> hides its fields from the browser's validation UI
  // ("not focusable") and the submit dies silently — open the row first.
  const onInvalid = (e: React.FormEvent<HTMLFormElement>) => {
    const row = (e.target as HTMLElement).closest("details");
    if (row && !row.open) row.open = true;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const price = String(fd.get("price") ?? "").trim();
    const termsText = String(fd.get("termsText") ?? "").trim();
    const depositValueRaw = String(fd.get("depositValue") ?? "").trim();
    const depositValue =
      depositType === "fixed" || depositType === "percent"
        ? depositValueRaw === ""
          ? null
          : depositType === "fixed"
            ? Math.round(Number(depositValueRaw) * 100)
            : Math.round(Number(depositValueRaw))
        : null;
    const common = {
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      unitSelection: String(fd.get("unitSelection") ?? "auto"),
      // The header's switch owns this; the settings save carries it along
      // unchanged (the schema would default an absent flag to true).
      active: offering.active,
      requiresApproval,
      priceCents: price === "" ? null : Math.round(Number(price) * 100),
      pricingMode: String(fd.get("pricingMode") ?? "per_unit"),
      depositType,
      depositValue,
      cancelPolicy,
      termsText: termsText === "" ? undefined : termsText,
    };
    // Only rooms the Includes list actually renders: seeded from the links,
    // `componentIds` can hold a room that has since left hours mode, and
    // re-posting it makes every save raise (check_offering_component). The
    // DB refuses that flip now, so this only catches links made before it.
    const includes = componentIds.filter((id) => rooms.some((r) => r.id === id));
    // The hours Zod branch is `.strict()` — only that mode's own fields go
    // in, or parsing fails (schema.ts).
    const payload = isEquipment
      ? {
          // Equipment answers one question — how much. Everything the form
          // doesn't show is filled with its default here rather than left
          // to a stale field from another kind.
          ...common,
          rangeMode: "hours" as const,
          slotIncrementMin,
          minDurationMin,
          maxDurationMin,
          turnoverMin: 0,
          minNoticeMin: 0,
          pricing: null,
          requiresApproval: false,
          depositType: "none" as const,
          depositValue: null,
          cancelPolicy: [],
          termsText: undefined,
          bookingWindowDays: 180,
          unitSelection: "auto" as const,
        }
      : effectiveRangeMode === "hours"
        ? {
            ...common,
            rangeMode: "hours" as const,
            // A composite's save replaces the rooms it includes; every other
            // space omits the key (the settings schema wants >= 1 or nothing).
            ...(kind === "composite" ? { componentIds: includes, unitSelection: "auto" as const } : {}),
            slotIncrementMin,
            minDurationMin,
            maxDurationMin,
            turnoverMin: Number(fd.get("turnoverMin")),
            minNoticeMin: Number(fd.get("minNoticeMin")),
            pricing,
            // Rules replace the flat price — the two models must never
            // disagree on the row (the Price row isn't even rendered once
            // rules are on).
            ...(pricing !== null ? { priceCents: null, pricingMode: "per_unit" as const } : {}),
          }
        : {
            ...common,
            rangeMode,
            startTime: String(fd.get("startTime") ?? ""),
            endTime: String(fd.get("endTime") ?? ""),
            minStay: Number(fd.get("minStay")),
            maxStay: String(fd.get("maxStay") ?? "").trim() === "" ? null : Number(fd.get("maxStay")),
            turnoverDays: Number(fd.get("turnoverDays")),
            minNoticeDays: Number(fd.get("minNoticeDays")),
          };
    // The checks the server can only refuse generically, reported here
    // with the offending field instead.
    if (effectiveRangeMode === "hours" && maxDurationMin < minDurationMin) {
      toast.error(t("form.lengthOrder"));
      return;
    }
    // A composite that includes nothing blocks nothing — the server refuses
    // it too (schema.ts), but only generically.
    if (kind === "composite" && includes.length === 0) {
      toast.error(t("form.includesRequired"));
      return;
    }
    // The rules arrive as one JSON blob; the zod messages are English
    // developer strings — deliberate for this slice.
    if (!isEquipment && effectiveRangeMode === "hours" && pricing !== null) {
      const parsed = pricingRulesFor(minDurationMin).safeParse(pricing);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast.error(t("form.pricing.invalid", { issue: `${issue.path.join(" › ")} — ${issue.message}` }));
        return;
      }
    }
    // Same story: a duplicate lead is the one thing the server can only
    // refuse generically — caught here first.
    if (!cancelPolicySchema.safeParse(cancelPolicy).success) {
      toast.error(t("form.cancelPolicyInvalid"));
      return;
    }
    startTransition(async () => {
      const result = await updateOffering({ id: offering.id, ...payload });
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      // A notice means the space saved but its default hours did not: an
      // hourly space with no week offers nothing — a warning, not "Saved",
      // so the owner knows to visit Availability.
      if (result.notice) toastRefusal(result.notice, result.upgrade, "warning");
      else toast.success(tc("saved"));
    });
  };

  const unitLabel = (mode: RangeMode) =>
    mode === "hours" ? t("form.perHour") : mode === "nights" ? t("form.perNight") : t("form.perDay");

  return (
    <form onSubmit={onSubmit} onInvalidCapture={onInvalid} className="flex max-w-lg flex-col">
      <div className="divide-y border-y">
        {/* Equipment is bought by the item, not booked by the hour: it rides
            a room booking, so none of the schedule applies to it (the
            payload fills the defaults). */}
        {isEquipment ? null : (
          <Section title={t("form.section.booking")} summary={bookingSummary(offering, t, tu)}>
            {/* The structural choice first: "Booked by" renames half the
                other fields, so it must be picked before any of them. A
                composite or an equipment space is hourly by definition
                (0084's CHECK), so only a plain space is asked. */}
            {kind === "space" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-range-mode">{t("form.bookedBy")}</Label>
                <select
                  id="offering-range-mode"
                  name="rangeMode"
                  className={selectClass}
                  value={rangeMode}
                  onChange={(e) => setRangeMode(e.target.value as RangeMode)}
                >
                  <option value="hours">{t("mode.hours")}</option>
                  <option value="nights">{t("mode.nights")}</option>
                  <option value="days">{t("mode.days")}</option>
                </select>
              </div>
            ) : null}
            {/* Keyed per mode: without keys React reuses the same-position
                uncontrolled inputs across branches — a mode switch must
                remount the whole branch. */}
            {effectiveRangeMode === "hours" ? (
              <React.Fragment key="hours">
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-min-duration">{t("form.minDuration")}</Label>
                    <select
                      id="offering-min-duration"
                      name="minDurationMin"
                      className={selectClass}
                      value={minDurationMin}
                      onChange={(e) => setMinDurationMin(Number(e.target.value))}
                    >
                      {durationOptions(slotIncrementMin, minDurationMin).map((m) => (
                        <option key={m} value={m}>
                          {formatDurationLabel(m, tu)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-max-duration">{t("form.maxDuration")}</Label>
                    <select
                      id="offering-max-duration"
                      name="maxDurationMin"
                      className={selectClass}
                      value={maxDurationMin}
                      onChange={(e) => setMaxDurationMin(Number(e.target.value))}
                    >
                      {durationOptions(slotIncrementMin, maxDurationMin).map((m) => (
                        <option key={m} value={m}>
                          {formatDurationLabel(m, tu)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-slot-increment">{t("form.slotIncrement")}</Label>
                    <select
                      id="offering-slot-increment"
                      name="slotIncrementMin"
                      className={selectClass}
                      value={slotIncrementMin}
                      onChange={(e) => onIncrement(Number(e.target.value))}
                    >
                      {/* Guards an existing space whose increment isn't one
                          of the three common values — editing must not
                          silently snap it to 15. */}
                      {withCurrent(INCREMENT_OPTIONS, slotIncrementMin).map((m) => (
                        <option key={m} value={m}>
                          {tu("minutes", { count: m })}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-turnover-min">{t("form.turnoverMinutes")}</Label>
                  <select
                    id="offering-turnover-min"
                    name="turnoverMin"
                    className={selectClass}
                    defaultValue={seed.turnoverMin}
                  >
                    {withCurrent(GAP_OPTIONS, seed.turnoverMin).map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? t("form.noGap") : formatDurationLabel(m, tu)}
                      </option>
                    ))}
                  </select>
                </div>
              </React.Fragment>
            ) : (
              <React.Fragment key="stay">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-start-time">{t("form.startTime")}</Label>
                    <TimeField id="offering-start-time" name="startTime" label={t("form.startTime")} defaultValue={seed.startTime ?? "15:00"} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-end-time">{t("form.endTime")}</Label>
                    <TimeField id="offering-end-time" name="endTime" label={t("form.endTime")} defaultValue={seed.endTime ?? "11:00"} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-min-stay">{t("form.minStay")}</Label>
                    <Input id="offering-min-stay" name="minStay" type="number" required min={1} max={365} defaultValue={seed.minStay} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-max-stay">{t("form.maxStay")}</Label>
                    <Input id="offering-max-stay" name="maxStay" type="number" min={1} max={365} placeholder={t("form.unlimited")} defaultValue={seed.maxStay ?? ""} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-turnover">{t("form.turnoverDays")}</Label>
                    <Input id="offering-turnover" name="turnoverDays" type="number" required min={0} max={30} defaultValue={seed.turnoverDays} />
                  </div>
                </div>
              </React.Fragment>
            )}
            {kind === "composite" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t("form.includes")}</legend>
                {rooms.length === 0 ? <p className="text-muted-foreground text-xs">{t("form.includesEmpty")}</p> : null}
                {rooms.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={componentIds.includes(r.id)}
                      onCheckedChange={(checked) =>
                        setComponentIds(checked === true ? [...componentIds, r.id] : componentIds.filter((id) => id !== r.id))
                      }
                    />
                    {r.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </Section>
        )}

        <Section title={t("form.section.price")} summary={priceSummary(offering, currency, t, tu)}>
          {/* Rules replace the flat price for an hourly space — the row
              below is meaningless once they're on, so it's hidden rather
              than submitted-and-ignored. */}
          {isEquipment || effectiveRangeMode !== "hours" || pricing === null ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-price">{t("form.price", { currency })}</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="offering-price"
                  name="price"
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  placeholder={t("form.unpriced")}
                  defaultValue={seed.priceCents != null ? seed.priceCents / 100 : ""}
                />
                <select
                  aria-label={t("form.chargedPer")}
                  name="pricingMode"
                  className={selectClass}
                  defaultValue={seed.pricingMode}
                >
                  <option value="per_unit">{unitLabel(effectiveRangeMode)}</option>
                  {/* An item is charged per booking, not per stay. */}
                  <option value="flat">{isEquipment ? t("form.perBooking") : t("form.flat")}</option>
                </select>
              </div>
            </div>
          ) : null}
          {!isEquipment && effectiveRangeMode === "hours" ? (
            <PricingRulesEditor value={pricing} onChange={setPricing} currency={currency} minDurationMin={minDurationMin} />
          ) : null}
        </Section>

        {isEquipment ? null : (
          <Section title={t("form.section.rules")} summary={rulesSummary(offering, currency, t, tu)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <Label htmlFor="offering-requires-approval">{t("form.requireApproval")}</Label>
                <span className="text-muted-foreground text-xs">{t("form.requireApprovalHint")}</span>
              </div>
              <Switch id="offering-requires-approval" checked={requiresApproval} onCheckedChange={setRequiresApproval} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-deposit-type">{t("form.deposit")}</Label>
                <select
                  id="offering-deposit-type"
                  name="depositType"
                  className={selectClass}
                  value={depositType}
                  onChange={(e) => setDepositType(e.target.value as DepositType)}
                >
                  <option value="none">{t("form.depositNone")}</option>
                  <option value="fixed">{t("form.depositFixed")}</option>
                  <option value="percent">{t("form.depositPercent")}</option>
                  <option value="full">{t("form.depositFull")}</option>
                </select>
              </div>
              {depositType === "fixed" ? (
                <div key="dep-fixed" className="flex flex-col gap-2">
                  <Label htmlFor="offering-deposit-value">{t("form.depositAmount", { currency })}</Label>
                  <Input
                    id="offering-deposit-value"
                    name="depositValue"
                    type="number"
                    min={0}
                    step="0.01"
                    defaultValue={seed.depositType === "fixed" && seed.depositValue != null ? seed.depositValue / 100 : ""}
                  />
                </div>
              ) : depositType === "percent" ? (
                <div key="dep-percent" className="flex flex-col gap-2">
                  <Label htmlFor="offering-deposit-value">{t("form.depositPercentLabel")}</Label>
                  <Input
                    id="offering-deposit-value"
                    name="depositValue"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={seed.depositType === "percent" && seed.depositValue != null ? seed.depositValue : ""}
                  />
                </div>
              ) : null}
            </div>
            <CancelPolicyEditor value={cancelPolicy} onChange={setCancelPolicy} rangeMode={effectiveRangeMode} />
            <div className="grid grid-cols-2 gap-4">
              {effectiveRangeMode === "hours" ? (
                <div key="notice-min" className="flex flex-col gap-2">
                  <Label htmlFor="offering-min-notice-min">{t("form.minNotice")}</Label>
                  <select id="offering-min-notice-min" name="minNoticeMin" className={selectClass} defaultValue={seed.minNoticeMin}>
                    {withCurrent(NOTICE_OPTIONS, seed.minNoticeMin).map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? t("form.noMinimum") : t("form.ahead", { lead: formatCancelWindow(m, tu) })}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div key="notice-days" className="flex flex-col gap-2">
                  <Label htmlFor="offering-min-notice">{t("form.minNotice")}</Label>
                  <Suffixed suffix={t("form.minNoticeDays")}>
                    <Input id="offering-min-notice" name="minNoticeDays" type="number" required min={0} max={365} defaultValue={seed.minNoticeDays} />
                  </Suffixed>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-booking-window">{t("form.bookingWindow")}</Label>
                <Suffixed suffix={t("form.daysAhead")}>
                  <Input id="offering-booking-window" name="bookingWindowDays" type="number" required min={1} max={730} defaultValue={seed.bookingWindowDays} />
                </Suffixed>
              </div>
            </div>
            {/* Only a split space has units to choose between; a single-unit
                space keeps its setting quietly. */}
            {offering.unitCount > 1 ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-unit-selection">{t("form.unitSelection")}</Label>
                <select id="offering-unit-selection" name="unitSelection" className={selectClass} defaultValue={seed.unitSelection}>
                  <option value="auto">{t("form.unitAuto")}</option>
                  <option value="client_picks">{t("form.unitClientPicks")}</option>
                </select>
              </div>
            ) : (
              <input type="hidden" name="unitSelection" value={offering.unitSelection} />
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="offering-terms">{t("form.terms")}</Label>
              <Textarea id="offering-terms" name="termsText" rows={4} maxLength={10000} defaultValue={seed.termsText ?? ""} />
            </div>
          </Section>
        )}
      </div>
      <div className="mt-4">
        <Button type="submit" size="sm" variant="brand" disabled={pending}>
          {pending ? tc("saving") : tc("save")}
        </Button>
      </div>
    </form>
  );
}
