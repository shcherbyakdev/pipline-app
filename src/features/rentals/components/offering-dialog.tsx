"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { toastRefusal } from "@/features/billing/refusal-toast";
import { createOffering, updateOffering } from "@/features/rentals/actions";
import type { OfferingRow } from "@/features/rentals/queries";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import type { DepositType } from "@/features/rentals/pricing";
import { Button } from "@/components/ui/button";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBreadcrumbHeader,
  DialogChip,
  DialogContent,
  DialogFooterBar,
  DialogTrigger,
  dialogBareInputClass,
  dialogPanelClass,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { TIME_OPTIONS } from "@/features/scheduling/time-options";
import { TimeCombobox } from "@/features/scheduling/components/time-combobox";

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

export function OfferingDialog({
  offering,
  currency,
}: {
  offering?: OfferingRow;
  currency: string;
}) {
  const t = useTranslations("spaces");
  const tc = useTranslations("common");
  const tu = useTranslations("public.units");
  const isEdit = Boolean(offering);
  const searchParams = useSearchParams();
  const router = useRouter();
  // Only the create trigger (rendered once, at page level) participates in the
  // `?new=1` URL-driven open — mirrors service-dialog.tsx. Edit dialogs are
  // per-row and only ever opened manually.
  const urlOpen = !isEdit && searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();
  // Controlled so the render branch (Stay section fields) and the payload
  // built in onSubmit always agree on which fields are on the page —
  // switching modes mid-form unmounts the other branch's inputs, so a
  // stale field is never in the submitted FormData.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>(
    offering?.rangeMode ?? "nights",
  );
  // Drives the min/max duration inputs' `step` so it tracks the increment
  // select live, not just at mount.
  const [slotIncrementMin, setSlotIncrementMin] = React.useState<number>(
    offering?.slotIncrementMin ?? OFFERING_DEFAULTS.hours.slotIncrementMin,
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

  const onOpenChange = (next: boolean) => {
    // The popup unmounts when closed, but these live here as controlled
    // state — put them back on reopen so a cancelled edit doesn't linger.
    if (next) {
      setRangeMode(offering?.rangeMode ?? "nights");
      setSlotIncrementMin(offering?.slotIncrementMin ?? OFFERING_DEFAULTS.hours.slotIncrementMin);
      setDepositType(offering?.depositType ?? "none");
      setActive(offering?.active ?? true);
      setRequiresApproval(offering?.requiresApproval ?? false);
    }
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/rentals");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const description = String(fd.get("description") ?? "").trim();
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
    const cancelWindowRaw = String(fd.get("cancelWindow") ?? "").trim();
    const cancelWindowMin =
      cancelWindowRaw === ""
        ? 0
        : Math.round(
            Number(cancelWindowRaw) * (rangeMode === "hours" ? 60 : 1440),
          );
    const common = {
      name,
      description: description === "" ? undefined : description,
      bookingWindowDays: Number(fd.get("bookingWindowDays")),
      unitSelection: String(fd.get("unitSelection") ?? "auto"),
      active,
      requiresApproval,
      priceCents: price === "" ? null : Math.round(Number(price) * 100),
      pricingMode: String(fd.get("pricingMode") ?? "per_unit"),
      depositType,
      depositValue,
      cancelWindowMin,
      termsText: termsText === "" ? undefined : termsText,
    };
    // The hours Zod branch is `.strict()` — only that mode's own fields go
    // in, or parsing fails (schema.ts).
    const payload =
      rangeMode === "hours"
        ? {
            ...common,
            rangeMode: "hours" as const,
            slotIncrementMin: Number(fd.get("slotIncrementMin")),
            minDurationMin: Number(fd.get("minDurationMin")),
            maxDurationMin: Number(fd.get("maxDurationMin")),
            turnoverMin: Number(fd.get("turnoverMin")),
            minNoticeMin: Number(fd.get("minNoticeMin")),
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
    startTransition(async () => {
      const result = isEdit
        ? await updateOffering({ id: offering!.id, ...payload })
        : await createOffering(payload);
      if (!result.ok) {
        toastRefusal(result.error, result.upgrade);
        return;
      }
      onOpenChange(false);
      // A notice means the space saved but its default hours did not: an
      // hourly space with no week offers nothing — a warning, not "Saved",
      // so the owner knows to visit Availability.
      if (result.notice) toastRefusal(result.notice, result.upgrade, "warning");
      else toast.success(isEdit ? tc("saved") : t("dialog.created"));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button size="sm" variant="outline">
              <Pencil className="size-4" /> {tc("edit")}
            </Button>
          ) : (
            <Button size="sm">
              <Plus className="size-4" /> {t("newButton")}
            </Button>
          )
        }
      />
      <DialogContent className={cn(dialogPanelClass, "sm:max-w-lg")}>
        <DialogBreadcrumbHeader
          chip={<DialogChip tone="space">{t("badge")}</DialogChip>}
        >
          {isEdit ? t("dialogTitle.edit") : t("dialogTitle.new")}
        </DialogBreadcrumbHeader>
        <form onSubmit={onSubmit} className="flex flex-col">
          <div className="flex flex-col px-5 pt-4 pb-6">
            <input
              aria-label={tc("name")}
              name="name"
              required
              maxLength={200}
              defaultValue={offering?.name}
              placeholder={t("dialog.namePlaceholder")}
              className={cn(dialogBareInputClass, "text-[15px] font-medium")}
              autoFocus
            />
            <textarea
              aria-label={t("dialog.description")}
              name="description"
              maxLength={2000}
              rows={2}
              defaultValue={offering?.description ?? ""}
              placeholder={t("dialog.descriptionPlaceholder")}
              className={cn(dialogBareInputClass, "mt-3 resize-none text-sm")}
            />
            <div className="mt-6 flex flex-col gap-4">
              {/* The structural choice first: "Booked by" renames half the
                  other fields (Per night / check-in / sessions), so it must
                  be picked before any of them is shown. */}
              <SectionHeading>
                {rangeMode === "hours" ? t("dialog.section.session") : t("dialog.section.stay")}
              </SectionHeading>
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-range-mode">{t("dialog.bookedBy")}</Label>
                <select
                  id="offering-range-mode"
                  name="rangeMode"
                  className={selectClass}
                  value={rangeMode}
                  onChange={(e) => setRangeMode(e.target.value as RangeMode)}
                >
                  <option value="nights">{t("dialog.mode.nights")}</option>
                  <option value="days">{t("dialog.mode.days")}</option>
                  <option value="hours">{t("dialog.mode.hours")}</option>
                </select>
              </div>
              {/* Keyed per mode: without keys React reuses the same-position
                  uncontrolled inputs across branches (Min stay's "1" would
                  survive into Min duration and fail its step validation) —
                  a mode switch must remount the whole branch. */}
              {rangeMode === "hours" ? (
                <React.Fragment key="hours">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offering-slot-increment">
                      {t("dialog.slotIncrement")}
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
                        {t("dialog.minDuration")}
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
                        defaultValue={
                          offering?.minDurationMin ??
                          OFFERING_DEFAULTS.hours.minDurationMin
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-max-duration">
                        {t("dialog.maxDuration")}
                      </Label>
                      <Input
                        id="offering-max-duration"
                        name="maxDurationMin"
                        type="number"
                        required
                        max={1440}
                        step={slotIncrementMin}
                        defaultValue={
                          offering?.maxDurationMin ??
                          OFFERING_DEFAULTS.hours.maxDurationMin
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-turnover-min">
                        {t("dialog.turnoverMinutes")}
                      </Label>
                      <Input
                        id="offering-turnover-min"
                        name="turnoverMin"
                        type="number"
                        min={0}
                        max={1440}
                        defaultValue={offering?.turnoverMin ?? 0}
                      />
                    </div>
                  </div>
                </React.Fragment>
              ) : (
                <React.Fragment key="stay">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-start-time">{t("dialog.startTime")}</Label>
                      <TimeField
                        id="offering-start-time"
                        name="startTime"
                        label={t("dialog.startTime")}
                        defaultValue={
                          offering?.startTime ??
                          OFFERING_DEFAULTS.stay.startTime
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-end-time">{t("dialog.endTime")}</Label>
                      <TimeField
                        id="offering-end-time"
                        name="endTime"
                        label={t("dialog.endTime")}
                        defaultValue={
                          offering?.endTime ?? OFFERING_DEFAULTS.stay.endTime
                        }
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-min-stay">{t("dialog.minStay")}</Label>
                      <Input
                        id="offering-min-stay"
                        name="minStay"
                        type="number"
                        required
                        min={1}
                        max={365}
                        defaultValue={
                          offering?.minStay ?? OFFERING_DEFAULTS.stay.minStay
                        }
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-max-stay">{t("dialog.maxStay")}</Label>
                      <Input
                        id="offering-max-stay"
                        name="maxStay"
                        type="number"
                        min={1}
                        max={365}
                        placeholder={t("dialog.unlimited")}
                        defaultValue={offering?.maxStay ?? ""}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="offering-turnover">{t("dialog.turnoverDays")}</Label>
                      <Input
                        id="offering-turnover"
                        name="turnoverDays"
                        type="number"
                        min={0}
                        max={30}
                        defaultValue={offering?.turnoverDays ?? 0}
                      />
                    </div>
                  </div>
                </React.Fragment>
              )}

              <SectionHeading>{t("dialog.section.pricing")}</SectionHeading>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-price">{t("dialog.price", { currency })}</Label>
                  <Input
                    id="offering-price"
                    name="price"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={t("dialog.unpriced")}
                    defaultValue={
                      offering?.priceCents != null
                        ? offering.priceCents / 100
                        : ""
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-pricing-mode">{t("dialog.pricingMode")}</Label>
                  <select
                    id="offering-pricing-mode"
                    name="pricingMode"
                    className={selectClass}
                    defaultValue={offering?.pricingMode ?? "per_unit"}
                  >
                    <option value="per_unit">
                      {rangeMode === "hours"
                        ? t("dialog.perHour")
                        : rangeMode === "nights"
                          ? t("dialog.perNight")
                          : t("dialog.perDay")}
                    </option>
                    <option value="flat">{t("dialog.flat")}</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="offering-active">{tc("active")}</Label>
                <Switch
                  id="offering-active"
                  checked={active}
                  onCheckedChange={setActive}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <Label htmlFor="offering-requires-approval">
                    {t("dialog.requireApproval")}
                  </Label>
                  <span className="text-muted-foreground text-xs">
                    {t("dialog.requireApprovalHint")}
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
                  {t("dialog.rules")}
                </summary>
                <div className="mt-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-deposit-type">{t("dialog.deposit")}</Label>
                  <select
                    id="offering-deposit-type"
                    name="depositType"
                    className={selectClass}
                    value={depositType}
                    onChange={(e) =>
                      setDepositType(e.target.value as DepositType)
                    }
                  >
                    <option value="none">{t("dialog.depositNone")}</option>
                    <option value="fixed">{t("dialog.depositFixed")}</option>
                    <option value="percent">{t("dialog.depositPercent")}</option>
                    <option value="full">{t("dialog.depositFull")}</option>
                  </select>
                </div>
                {depositType === "fixed" ? (
                  <div key="dep-fixed" className="flex flex-col gap-2">
                    <Label htmlFor="offering-deposit-value">
                      {t("dialog.depositAmount", { currency })}
                    </Label>
                    <Input
                      id="offering-deposit-value"
                      name="depositValue"
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={
                        offering?.depositType === "fixed" &&
                        offering.depositValue != null
                          ? offering.depositValue / 100
                          : ""
                      }
                    />
                  </div>
                ) : depositType === "percent" ? (
                  <div key="dep-percent" className="flex flex-col gap-2">
                    <Label htmlFor="offering-deposit-value">{t("dialog.depositPercentLabel")}</Label>
                    <Input
                      id="offering-deposit-value"
                      name="depositValue"
                      type="number"
                      min={1}
                      max={100}
                      defaultValue={
                        offering?.depositType === "percent" &&
                        offering.depositValue != null
                          ? offering.depositValue
                          : ""
                      }
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-cancel-window">
                  {rangeMode === "hours" ? t("dialog.cancelWindowHours") : t("dialog.cancelWindowDays")}
                </Label>
                <Input
                  id="offering-cancel-window"
                  name="cancelWindow"
                  type="number"
                  min={0}
                  placeholder={t("dialog.noWindow")}
                  defaultValue={
                    offering && offering.cancelWindowMin > 0
                      ? offering.rangeMode === "hours"
                        ? offering.cancelWindowMin / 60
                        : offering.cancelWindowMin / 1440
                      : ""
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="offering-terms">{t("dialog.terms")}</Label>
                <Textarea
                  id="offering-terms"
                  name="termsText"
                  rows={4}
                  maxLength={10000}
                  defaultValue={offering?.termsText ?? ""}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {rangeMode === "hours" ? (
                  <div key="notice-min" className="flex flex-col gap-2">
                    <Label htmlFor="offering-min-notice-min">
                      {t("dialog.minNoticeMinutes")}
                    </Label>
                    <Input
                      id="offering-min-notice-min"
                      name="minNoticeMin"
                      type="number"
                      min={0}
                      max={43200}
                      defaultValue={offering?.minNoticeMin ?? 0}
                    />
                  </div>
                ) : (
                  <div key="notice-days" className="flex flex-col gap-2">
                    <Label htmlFor="offering-min-notice">
                      {t("dialog.minNoticeDays")}
                    </Label>
                    <Input
                      id="offering-min-notice"
                      name="minNoticeDays"
                      type="number"
                      min={0}
                      max={365}
                      defaultValue={offering?.minNoticeDays ?? 0}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-booking-window">
                    {t("dialog.bookingWindow")}
                  </Label>
                  <Input
                    id="offering-booking-window"
                    name="bookingWindowDays"
                    type="number"
                    min={1}
                    max={730}
                    defaultValue={offering?.bookingWindowDays ?? 180}
                  />
                </div>
              </div>
              {/* Only a split space has units to choose between; a new or
                  single-unit space keeps its setting quietly. */}
              {(offering?.unitCount ?? 0) > 1 ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offering-unit-selection">{t("dialog.unitSelection")}</Label>
                  <select
                    id="offering-unit-selection"
                    name="unitSelection"
                    className={selectClass}
                    defaultValue={offering?.unitSelection ?? "auto"}
                  >
                    <option value="auto">{t("dialog.unitAuto")}</option>
                    <option value="client_picks">{t("dialog.unitClientPicks")}</option>
                  </select>
                </div>
              ) : (
                <input type="hidden" name="unitSelection" value={offering?.unitSelection ?? "auto"} />
              )}
                </div>
              </details>
            </div>
          </div>
          <DialogFooterBar>
            <Button type="submit" size="sm" variant="brand" disabled={pending}>
              {pending
                ? isEdit
                  ? tc("saving")
                  : tc("creating")
                : isEdit
                  ? tc("save")
                  : t("dialog.create")}
            </Button>
          </DialogFooterBar>
        </form>
      </DialogContent>
    </Dialog>
  );
}
