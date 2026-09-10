import { formatMoney } from "@/lib/money";
import type { Translator, UnitsT } from "@/i18n/translator";
import { formatCancelWindow } from "./cancel-policy";
import { formatDurationLabel } from "./hourly";
import { headlinePrice } from "./pricing";
import type { OfferingRow } from "./queries";

type SpacesT = Translator<"spaces">;

/* The space page's settings read as three closed rows, each summarising
   what is SAVED (the row's props, refreshed by the save's revalidate) —
   never what is half-typed inside, so a closed row is always true. */

export function bookingSummary(o: OfferingRow, t: SpacesT, tu: UnitsT): string {
  const parts: string[] = [t(`mode.${o.rangeMode}`)];
  if (o.rangeMode === "hours") {
    parts.push(
      t("schedule.hours", {
        min: formatDurationLabel(o.minDurationMin!, tu),
        max: formatDurationLabel(o.maxDurationMin!, tu),
        step: o.slotIncrementMin!,
      }),
    );
    if (o.turnoverMin > 0) parts.push(t("summary.gap", { gap: formatDurationLabel(o.turnoverMin, tu) }));
  } else {
    parts.push(t(`schedule.${o.rangeMode}`, { start: o.startTime!, end: o.endTime! }));
    const unit = o.rangeMode === "nights" ? "nights" : "days";
    if (o.minStay > 1) parts.push(t("summary.minStay", { length: tu(unit, { count: o.minStay }) }));
    if (o.maxStay !== null) parts.push(t("summary.maxStay", { length: tu(unit, { count: o.maxStay }) }));
    if (o.turnoverDays > 0) parts.push(t("summary.gap", { gap: tu("days", { count: o.turnoverDays }) }));
  }
  return parts.join(" · ");
}

export function priceSummary(o: OfferingRow, currency: string, t: SpacesT, tu: UnitsT): string {
  const parts: string[] = [headlinePrice(o, currency, tu) ?? t("form.unpriced")];
  if (o.pricing !== null) {
    parts.push(t("summary.byLength", { count: o.pricing.bands.length }));
    if (o.pricing.surcharges.length > 0) parts.push(t("summary.surcharges", { count: o.pricing.surcharges.length }));
    if (o.pricing.people) parts.push(t("summary.people", { count: o.pricing.people.included }));
    if (o.pricing.extras.length > 0) parts.push(t("summary.extras", { count: o.pricing.extras.length }));
  }
  return parts.join(" · ");
}

export function rulesSummary(o: OfferingRow, currency: string, t: SpacesT, tu: UnitsT): string {
  const parts: string[] = [t(o.requiresApproval ? "summary.approval" : "summary.instant")];
  switch (o.depositType) {
    case "fixed":
      parts.push(t("summary.deposit", { amount: formatMoney(o.depositValue ?? 0, currency) }));
      break;
    case "percent":
      parts.push(t("summary.deposit", { amount: `${o.depositValue ?? 0}%` }));
      break;
    case "full":
      parts.push(t("summary.depositFull"));
      break;
    default:
      parts.push(t("summary.noDeposit"));
  }
  parts.push(
    o.cancelPolicy.length === 0 ? t("summary.freeCancel") : t("summary.cancelTiers", { count: o.cancelPolicy.length }),
  );
  const noticeMin = o.rangeMode === "hours" ? o.minNoticeMin : o.minNoticeDays * 1440;
  if (noticeMin > 0) parts.push(t("summary.notice", { lead: formatCancelWindow(noticeMin, tu) }));
  parts.push(t("summary.window", { count: o.bookingWindowDays }));
  if (o.unitCount > 1 && o.unitSelection === "client_picks") parts.push(t("summary.clientPicks"));
  if (o.termsText) parts.push(t("summary.terms"));
  return parts.join(" · ");
}

/** Lengths (minutes) the hourly selects offer. */
export const LENGTH_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 1440] as const;
export const GAP_OPTIONS = [0, 15, 30, 45, 60, 90, 120] as const;
export const NOTICE_OPTIONS = [0, 60, 120, 240, 720, 1440, 2880, 4320, 10080] as const;

/** `base` on the increment's grid, plus the stored value when it is off the
    grid — an edit must show what is saved, never snap it silently. */
export function durationOptions(incrementMin: number, current: number, base: readonly number[] = LENGTH_OPTIONS): number[] {
  const on = base.filter((m) => m % incrementMin === 0);
  return on.includes(current) ? on : [...on, current].sort((a, b) => a - b);
}

/** `base` plus the stored value (the guard above, without a grid). */
export function withCurrent(base: readonly number[], current: number): number[] {
  return base.includes(current) ? [...base] : [...base, current].sort((a, b) => a - b);
}

/** The nearest grid value at or above `value` — changing the increment
    must not leave min/max off-grid (the server refuses HOURS_GRID_MSG). */
export function snapToIncrement(value: number, incrementMin: number): number {
  return Math.min(1440, Math.max(incrementMin, Math.ceil(value / incrementMin) * incrementMin));
}
