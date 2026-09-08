"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createOffering, updateOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import type { DepositType } from "@/features/rentals/pricing";
import { pricingRulesFor, OFFERING_KINDS, type PricingRules, type OfferingKind } from "@/features/rentals/pricing-rules";
import { cancelPolicySchema, type CancelPolicy } from "@/features/rentals/cancel-policy";
import { Button } from "@/components/ui/button";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { dialogBareInputClass } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {children}
    </h3>
  );
}

/* A space's settings, on a page (there is no dialog): the whole of
   /rentals/new, and the Settings section of /rentals/[id]. On the space's
   page the name and description live in the header (space-header.tsx) and
   never travel through here. Step, min/max and deposit type/value are
   checked together, so this stays one form with one Save. A create goes
   back to the list. */
export function OfferingForm({
  offering,
  currency,
  rooms = [],
}: {
  offering?: OfferingRow;
  currency: string;
  /** S6: the org's hourly rooms a composite can include — plain spaces
      only (no nesting), never the composite itself. */
  rooms?: { id: string; name: string }[];
}) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const tu = useTranslations("public.units");
  const router = useRouter();
  const isEdit = Boolean(offering);
  // Seeded ONCE. A save revalidates the page, which hands this form a fresh
  // row — and a `defaultValue` that changes under a live uncontrolled input
  // is ambiguous: React ignores it for a field the user has touched, and
  // Base UI warns. The fields already show what was just saved, so the
  // defaults are frozen at mount and the live prop is used only where the
  // page genuinely changes underneath (the save target, and the render
  // branches below). Remounting instead was rejected on the space page: it
  // would drop an edit in flight elsewhere in the form.
  const [seed] = React.useState(offering);

  const [pending, startTransition] = React.useTransition();
  // Controlled so the render branch (Stay section fields) and the payload
  // built in onSubmit always agree on which fields are on the page —
  // switching modes mid-form unmounts the other branch's inputs, so a
  // stale field is never in the submitted FormData.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>(
    offering?.rangeMode ?? "nights",
  );
  // S6: what this space IS — picked once, on create (the settings form has
  // no `kind` at all). A composite and an equipment space are always hourly
  // and always auto-assigned (0084's CHECK), so the kind drives the render
  // branch rather than the "Booked by" select.
  const [kind, setKind] = React.useState<OfferingKind>(offering?.kind ?? "space");
  const [componentIds, setComponentIds] = React.useState<string[]>(offering?.componentIds ?? []);
  // Drives the min/max duration inputs' `step` so it tracks the increment
  // select live, not just at mount.
  const [slotIncrementMin, setSlotIncrementMin] = React.useState<number>(
    offering?.slotIncrementMin ?? OFFERING_DEFAULTS.hours.slotIncrementMin,
  );
  // Controlled so PricingRulesEditor's first band always follows the live
  // value, not just the one at mount.
  const [minDurationMin, setMinDurationMin] = React.useState<number>(
    offering?.minDurationMin ?? OFFERING_DEFAULTS.hours.minDurationMin,
  );
  // S1: null = the flat Price/Pricing-mode grid above applies; rules make
  // that pair inert (submitted as priceCents: null, pricingMode: "per_unit").
  const [pricing, setPricing] = React.useState<PricingRules | null>(
    offering?.pricing ?? null,
  );
  // S3: the tiered editor is controlled the same way — the form owns the
  // value and posts it as one `cancelPolicy` array (Task 7).
  const [cancelPolicy, setCancelPolicy] = React.useState<CancelPolicy>(
    offering?.cancelPolicy ?? [],
  );
  // Controlled so the deposit-value input's semantics (amount vs. percent)
  // and its very presence (none/full take no value) track the select live.
  const [depositType, setDepositType] = React.useState<DepositType>(
    offering?.depositType ?? "none",
  );
  // Controlled switches (the one checked-control idiom, ui/switch.tsx) —
  // Base UI's Switch is a button, so the values travel in state, not FormData.
  const [active, setActive] = React.useState(offering?.active ?? true);
  const [requiresApproval, setRequiresApproval] = React.useState(
    offering?.requiresApproval ?? false,
  );

  const isEquipment = kind === "equipment";
  const effectiveRangeMode: RangeMode = kind === "space" ? rangeMode : "hours";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // The name and description travel only on create; on the space's page
    // the header owns them (updateOfferingInput is strict about it).
    const identity = offering
      ? {}
      : {
          name: String(fd.get("name") ?? "").trim(),
          description: String(fd.get("description") ?? "").trim() || undefined,
        };
    if ("name" in identity && identity.name === "") return;
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
      ...identity,
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      unitSelection: String(fd.get("unitSelection") ?? "auto"),
      active,
      requiresApproval,
      priceCents: price === "" ? null : Math.round(Number(price) * 100),
      pricingMode: String(fd.get("pricingMode") ?? "per_unit"),
      depositType,
      depositValue,
      cancelPolicy,
      termsText: termsText === "" ? undefined : termsText,
    };
    // The hours Zod branch is `.strict()` — only that mode's own fields go
    // in, or parsing fails (schema.ts). S6's kind and itemCount are
    // create-only: the settings schema refuses them outright.
    const createOnly = isEdit ? {} : { kind };
    const payload = isEquipment
      ? {
          // Equipment answers one question — how much, and how many of it.
          // Everything the form doesn't show is filled with its default here
          // rather than left to a stale field from another kind.
          ...common,
          rangeMode: "hours" as const,
          ...createOnly,
          ...(isEdit ? {} : { itemCount: Number(fd.get("itemCount") ?? 1) }),
          slotIncrementMin: OFFERING_DEFAULTS.hours.slotIncrementMin,
          minDurationMin: OFFERING_DEFAULTS.hours.minDurationMin,
          maxDurationMin: OFFERING_DEFAULTS.hours.maxDurationMin,
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
            ...createOnly,
            // A composite's save replaces the rooms it includes; every other
            // space omits the key (the settings schema wants >= 1 or nothing).
            ...(kind === "composite"
              ? { componentIds, unitSelection: "auto" as const }
              : {}),
            slotIncrementMin: Number(fd.get("slotIncrementMin")),
            minDurationMin: Number(fd.get("minDurationMin")),
            maxDurationMin: Number(fd.get("maxDurationMin")),
            turnoverMin: Number(fd.get("turnoverMin")),
            minNoticeMin: Number(fd.get("minNoticeMin")),
            pricing,
            // Rules replace the flat price — the two models must never
            // disagree on the row (the Price/Pricing-mode grid isn't even
            // rendered once rules are on).
            ...(pricing !== null
              ? { priceCents: null, pricingMode: "per_unit" as const }
              : {}),
          }
        : {
            ...common,
            rangeMode,
            startTime: String(fd.get("startTime") ?? ""),
            endTime: String(fd.get("endTime") ?? ""),
            minStay: Number(fd.get("minStay")),
            maxStay:
              String(fd.get("maxStay") ?? "").trim() === ""
                ? null
                : Number(fd.get("maxStay")),
            turnoverDays: Number(fd.get("turnoverDays")),
            minNoticeDays: Number(fd.get("minNoticeDays")),
          };
    // A composite that includes nothing blocks nothing — the server refuses
    // it too (schema.ts), but only generically.
    if (kind === "composite" && componentIds.length === 0) {
      toast.error(t("form.includesRequired"));
      return;
    }
    // The rules are the one part of this form the server can only refuse
    // with a generic message (they arrive as one JSON blob), so they are
    // checked here and reported with the offending field. The zod messages
    // are English developer strings — deliberate for this slice.
    if (!isEquipment && effectiveRangeMode === "hours" && pricing !== null) {
      const parsed = pricingRulesFor(minDurationMin).safeParse(pricing);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        toast.error(
          t("form.pricing.invalid", {
            issue: `${issue.path.join(" › ")} — ${issue.message}`,
          }),
        );
        return;
      }
    }
    // Same story as the pricing rules above: a duplicate lead is the one
    // thing the server can only refuse generically — caught here first.
    if (!cancelPolicySchema.safeParse(cancelPolicy).success) {
      toast.error(t("form.cancelPolicyInvalid"));
      return;
    }
    startTransition(async () => {
      const result = isEdit
        ? await updateOffering({ id: offering!.id, ...payload })
        : await createOffering(payload);
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      // A notice means the space saved but its default hours did not: an
      // hourly space with no week offers nothing — a warning, not "Saved",
      // so the owner knows to visit Availability.
      if (result.notice) toastRefusal(result.notice, result.upgrade, "warning");
      else toast.success(isEdit ? tc("saved") : t("form.created"));
      if (!isEdit) router.push("/rentals");
    });
  };

  return (
        <form onSubmit={onSubmit} className="flex max-w-lg flex-col">
          <div className="flex flex-col">
            {isEdit ? null : (
              <>
                <input
                  aria-label={tc("name")}
                  name="name"
                  required
                  maxLength={200}
                  placeholder={t("form.namePlaceholder")}
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
              </>
            )}
            <div className={cn("flex flex-col gap-4", !isEdit && "mt-6")}>
              {/* S6: what this space is, before anything else — the answer
                  renames or removes half the fields below. Set once: an
                  existing space's kind is a fact its bookings depend on. */}
              {isEdit ? null : (
                <div className="flex flex-col gap-2">
                  <Label id="offering-kind-label">{t("form.kind.label")}</Label>
                  <div
                    role="radiogroup"
                    aria-labelledby="offering-kind-label"
                    className="grid grid-cols-3 gap-2"
                  >
                    {OFFERING_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        onClick={() => setKind(k)}
                        className={cn(
                          "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm",
                          kind === k ? "border-brand ring-brand/30 ring-2" : "border-border hover:bg-muted/40",
                        )}
                      >
                        <span className="font-medium">{t(`form.kind.${k}`)}</span>
                        <span className="text-muted-foreground text-xs">{t(`form.kind.${k}Hint`)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Equipment is bought by the item, not booked by the hour:
                  it rides a room booking, so none of the schedule fields
                  below apply to it (the payload fills their defaults). */}
              {isEquipment ? null : (
                <React.Fragment key="bookable">
                {/* The structural choice first: "Booked by" renames half the
                    other fields (Per night / check-in / sessions), so it must
                    be picked before any of them is shown. */}
                <SectionHeading>
                  {effectiveRangeMode === "hours" ? t("form.section.session") : t("form.section.stay")}
                </SectionHeading>
                {/* A composite or an equipment space is hourly by definition
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
                      <option value="nights">{t("form.mode.nights")}</option>
                      <option value="days">{t("form.mode.days")}</option>
                      <option value="hours">{t("form.mode.hours")}</option>
                    </select>
                  </div>
                ) : null}
                {/* Keyed per mode: without keys React reuses the same-position
                    uncontrolled inputs across branches (Min stay's "1" would
                    survive into Min duration and fail its step validation) —
                    a mode switch must remount the whole branch. */}
                {effectiveRangeMode === "hours" ? (
                  <React.Fragment key="hours">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-slot-increment">
                        {t("form.slotIncrement")}
                      </Label>
                      <select
                        id="offering-slot-increment"
                        name="slotIncrementMin"
                        className={selectClass}
                        value={slotIncrementMin}
                        onChange={(e) =>
                          setSlotIncrementMin(Number(e.target.value))
                        }
                      >
                        {/* Guards an existing offering whose increment isn't one of
                        the three common values — editing must not silently
                        snap it to 15. */}
                        {!INCREMENT_OPTIONS.includes(slotIncrementMin) ? (
                          <option value={slotIncrementMin}>
                            {tu("minutes", { count: slotIncrementMin })}
                          </option>
                        ) : null}
                        {INCREMENT_OPTIONS.map((m) => (
                          <option key={m} value={m}>
                            {tu("minutes", { count: m })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-min-duration">
                          {t("form.minDuration")}
                        </Label>
                        {/* No `min` here: the HTML step-validation base is `min`
                        (falling back to 0 when absent), so `min={5}` +
                        `step={slotIncrementMin}` would only accept
                        5, 5+step, 5+2·step… — disjoint from the Zod branch's
                        multiples-of-increment-from-0 grid, so no real value
                        (e.g. 60/240 with a 15/30/60 increment) could ever pass
                        native validation. The 5-minute floor is still
                        enforced server-side by hoursFields's `.min(5)`. */}
                        <Input
                          id="offering-min-duration"
                          name="minDurationMin"
                          type="number"
                          required
                          max={1440}
                          step={slotIncrementMin}
                          value={minDurationMin}
                          onChange={(e) => setMinDurationMin(Number(e.target.value))}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-max-duration">
                          {t("form.maxDuration")}
                        </Label>
                        <Input
                          id="offering-max-duration"
                          name="maxDurationMin"
                          type="number"
                          required
                          max={1440}
                          step={slotIncrementMin}
                          defaultValue={
                            seed?.maxDurationMin ??
                            OFFERING_DEFAULTS.hours.maxDurationMin
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-turnover-min">
                          {t("form.turnoverMinutes")}
                        </Label>
                        <Input
                          id="offering-turnover-min"
                          name="turnoverMin"
                          type="number"
                          min={0}
                          max={1440}
                          defaultValue={seed?.turnoverMin ?? 0}
                        />
                      </div>
                    </div>
                  </React.Fragment>
                ) : (
                  <React.Fragment key="stay">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-start-time">{t("form.startTime")}</Label>
                        <TimeField
                          id="offering-start-time"
                          name="startTime"
                          label={t("form.startTime")}
                          defaultValue={
                            seed?.startTime ??
                            OFFERING_DEFAULTS.stay.startTime
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-end-time">{t("form.endTime")}</Label>
                        <TimeField
                          id="offering-end-time"
                          name="endTime"
                          label={t("form.endTime")}
                          defaultValue={
                            seed?.endTime ?? OFFERING_DEFAULTS.stay.endTime
                          }
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-min-stay">{t("form.minStay")}</Label>
                        <Input
                          id="offering-min-stay"
                          name="minStay"
                          type="number"
                          required
                          min={1}
                          max={365}
                          defaultValue={
                            seed?.minStay ?? OFFERING_DEFAULTS.stay.minStay
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-max-stay">{t("form.maxStay")}</Label>
                        <Input
                          id="offering-max-stay"
                          name="maxStay"
                          type="number"
                          min={1}
                          max={365}
                          placeholder={t("form.unlimited")}
                          defaultValue={seed?.maxStay ?? ""}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="offering-turnover">{t("form.turnoverDays")}</Label>
                        <Input
                          id="offering-turnover"
                          name="turnoverDays"
                          type="number"
                          min={0}
                          max={30}
                          defaultValue={seed?.turnoverDays ?? 0}
                        />
                      </div>
                    </div>
                  </React.Fragment>
                )}
                {kind === "composite" ? (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="text-sm font-medium">{t("form.includes")}</legend>
                    {rooms.length === 0 ? (
                      <p className="text-muted-foreground text-xs">{t("form.includesEmpty")}</p>
                    ) : null}
                    {rooms.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={componentIds.includes(r.id)}
                          onCheckedChange={(checked) =>
                            setComponentIds(
                              checked === true
                                ? [...componentIds, r.id]
                                : componentIds.filter((id) => id !== r.id),
                            )
                          }
                        />
                        {r.name}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                </React.Fragment>
              )}

              <SectionHeading>{t("form.section.pricing")}</SectionHeading>
              {/* Rules replace the flat price for an hourly space — the grid
                  below is meaningless once they're on, so it's hidden rather
                  than submitted-and-ignored (onSubmit sends priceCents: null,
                  pricingMode: "per_unit" for that case). */}
              {isEquipment || effectiveRangeMode !== "hours" || pricing === null ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-price">{t("form.price", { currency })}</Label>
                    <Input
                      id="offering-price"
                      name="price"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={t("form.unpriced")}
                      defaultValue={
                        seed?.priceCents != null
                          ? seed.priceCents / 100
                          : ""
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-pricing-mode">{t("form.pricingMode")}</Label>
                    <select
                      id="offering-pricing-mode"
                      name="pricingMode"
                      className={selectClass}
                      defaultValue={seed?.pricingMode ?? "per_unit"}
                    >
                      <option value="per_unit">
                        {effectiveRangeMode === "hours"
                          ? t("form.perHour")
                          : effectiveRangeMode === "nights"
                            ? t("form.perNight")
                            : t("form.perDay")}
                      </option>
                      {/* An item is charged per booking, not per stay. */}
                      <option value="flat">
                        {isEquipment ? t("form.perBooking") : t("form.flat")}
                      </option>
                    </select>
                  </div>
                </div>
              ) : null}
              {!isEquipment && effectiveRangeMode === "hours" ? (
                <PricingRulesEditor
                  value={pricing}
                  onChange={setPricing}
                  currency={currency}
                  minDurationMin={minDurationMin}
                />
              ) : null}

              {isEquipment && !isEdit ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-item-count">{t("form.itemCount")}</Label>
                  <Input
                    id="offering-item-count"
                    name="itemCount"
                    type="number"
                    required
                    min={1}
                    max={99}
                    defaultValue={1}
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="offering-active">{tc("active")}</Label>
                <Switch
                  id="offering-active"
                  checked={active}
                  onCheckedChange={setActive}
                />
              </div>
              {isEquipment ? null : (
                <React.Fragment key="policy">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <Label htmlFor="offering-requires-approval">
                      {t("form.requireApproval")}
                    </Label>
                    <span className="text-muted-foreground text-xs">
                      {t("form.requireApprovalHint")}
                    </span>
                  </div>
                  <Switch
                    id="offering-requires-approval"
                    checked={requiresApproval}
                    onCheckedChange={setRequiresApproval}
                  />
                </div>

                {/* Everything below is policy fine print with safe defaults —
                    collapsed on create so the modal opens scannable, open on
                    edit so no stored value hides. Native <details>: closed
                    fields stay in the DOM, so FormData still submits them. */}
                <details className="group flex flex-col" open={isEdit}>
                  <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium tracking-wide uppercase select-none [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden
                      className="size-3.5 transition-transform group-open:rotate-90"
                    />
                    {t("form.rules")}
                  </summary>
                  <div className="mt-4 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-deposit-type">{t("form.deposit")}</Label>
                    <select
                      id="offering-deposit-type"
                      name="depositType"
                      className={selectClass}
                      value={depositType}
                      onChange={(e) =>
                        setDepositType(e.target.value as DepositType)
                      }
                    >
                      <option value="none">{t("form.depositNone")}</option>
                      <option value="fixed">{t("form.depositFixed")}</option>
                      <option value="percent">{t("form.depositPercent")}</option>
                      <option value="full">{t("form.depositFull")}</option>
                    </select>
                  </div>
                  {depositType === "fixed" ? (
                    <div key="dep-fixed" className="flex flex-col gap-2">
                      <Label htmlFor="offering-deposit-value">
                        {t("form.depositAmount", { currency })}
                      </Label>
                      <Input
                        id="offering-deposit-value"
                        name="depositValue"
                        type="number"
                        min={0}
                        step="0.01"
                        defaultValue={
                          seed?.depositType === "fixed" &&
                          seed.depositValue != null
                            ? seed.depositValue / 100
                            : ""
                        }
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
                        defaultValue={
                          seed?.depositType === "percent" &&
                          seed.depositValue != null
                            ? seed.depositValue
                            : ""
                        }
                      />
                    </div>
                  ) : null}
                </div>
                <CancelPolicyEditor value={cancelPolicy} onChange={setCancelPolicy} rangeMode={effectiveRangeMode} />
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-terms">{t("form.terms")}</Label>
                  <Textarea
                    id="offering-terms"
                    name="termsText"
                    rows={4}
                    maxLength={10000}
                    defaultValue={seed?.termsText ?? ""}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {effectiveRangeMode === "hours" ? (
                    <div key="notice-min" className="flex flex-col gap-2">
                      <Label htmlFor="offering-min-notice-min">
                        {t("form.minNoticeMinutes")}
                      </Label>
                      <Input
                        id="offering-min-notice-min"
                        name="minNoticeMin"
                        type="number"
                        min={0}
                        max={43200}
                        defaultValue={seed?.minNoticeMin ?? 0}
                      />
                    </div>
                  ) : (
                    <div key="notice-days" className="flex flex-col gap-2">
                      <Label htmlFor="offering-min-notice">
                        {t("form.minNoticeDays")}
                      </Label>
                      <Input
                        id="offering-min-notice"
                        name="minNoticeDays"
                        type="number"
                        min={0}
                        max={365}
                        defaultValue={seed?.minNoticeDays ?? 0}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-booking-window">
                      {t("form.bookingWindow")}
                    </Label>
                    <Input
                      id="offering-booking-window"
                      name="bookingWindowDays"
                      type="number"
                      min={1}
                      max={730}
                      defaultValue={seed?.bookingWindowDays ?? 180}
                    />
                  </div>
                </div>
                {/* Only a split space has units to choose between; a new or
                    single-unit space keeps its setting quietly. */}
                {(offering?.unitCount ?? 0) > 1 ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-unit-selection">{t("form.unitSelection")}</Label>
                    <select
                      id="offering-unit-selection"
                      name="unitSelection"
                      className={selectClass}
                      defaultValue={seed?.unitSelection ?? "auto"}
                    >
                      <option value="auto">{t("form.unitAuto")}</option>
                      <option value="client_picks">{t("form.unitClientPicks")}</option>
                    </select>
                  </div>
                ) : (
                  <input type="hidden" name="unitSelection" value={offering?.unitSelection ?? "auto"} />
                )}
                  </div>
                </details>
                </React.Fragment>
              )}
            </div>
          </div>
          <div className="mt-6">
            <Button type="submit" size="sm" variant="brand" disabled={pending}>
              {pending
                ? isEdit
                  ? tc("saving")
                  : tc("creating")
                : isEdit
                  ? tc("save")
                  : t("form.create")}
            </Button>
          </div>
        </form>
  );
}
