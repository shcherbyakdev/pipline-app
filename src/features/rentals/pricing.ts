// Display-only mirror of the SQL money helpers in 0058
// (rental_total_cents / rental_deposit_cents). The RPCs are authoritative —
// this exists so flows, admin and emails can render the same numbers.
import { formatMoney } from "@/lib/money";
import type { UnitsT } from "@/i18n/translator";
import { stayLength, type RangeMode } from "./range";
import { formatDurationLabel } from "./hourly";

export type PricingMode = "per_unit" | "flat";
export type DepositType = "none" | "fixed" | "percent" | "full";
export type MoneyFields = {
  priceCents: number | null;
  pricingMode: PricingMode;
  depositType: DepositType;
  depositValue: number | null;
};

// Units for nights/days stays; hours callers pass durationMin / 60 directly.
export function stayUnits(rangeMode: "nights" | "days", startDate: string, endDate: string): number {
  return stayLength(rangeMode, startDate, endDate);
}

export function totalCents(m: MoneyFields, units: number): number | null {
  if (m.priceCents === null) return null;
  return m.pricingMode === "flat" ? m.priceCents : Math.round(m.priceCents * units);
}

export function depositCents(m: MoneyFields, total: number | null): number | null {
  switch (m.depositType) {
    case "none": return null;
    case "full": return total;
    case "percent":
      return total === null ? null : Math.round((total * (m.depositValue ?? 0)) / 100);
    case "fixed":
      if (m.depositValue === null) return null;
      return total === null ? m.depositValue : Math.min(m.depositValue, total);
  }
}

const PER_UNIT = { hours: "perHour", nights: "perNight", days: "perDay" } as const satisfies Record<RangeMode, string>;

// Every helper below takes the `public.units` translator (i18n spec §5):
// components hand in useTranslations("public.units"), server code
// getTranslations({ locale, namespace: "public.units" }) — so the widget,
// the page-builder sections, the manage page and the emails render the same
// words from one implementation, in the surface's own language.
export function formatOfferingPrice(
  o: { priceCents: number | null; pricingMode: PricingMode; rangeMode: RangeMode },
  currency: string,
  t: UnitsT,
): string | null {
  if (o.priceCents === null) return null;
  const amount = formatMoney(o.priceCents, currency);
  return o.pricingMode === "flat" ? amount : t(PER_UNIT[o.rangeMode], { amount });
}

export function formatCancelWindow(min: number, t: UnitsT): string {
  if (min % 1440 === 0) return t("days", { count: min / 1440 });
  const h = min / 60;
  return t("hours", { count: Number.isInteger(h) ? h : Math.round(h * 10) / 10 });
}

// Shared copy for the confirm step, the manage page and both emails. The
// first line is the total whenever there is one (booking-money-summary.tsx
// emphasises it by position).
export function moneyInfoLines(
  i: { totalCents: number | null; depositCents: number | null; currency: string | null; cancelWindowMin: number },
  t: UnitsT,
): string[] {
  const lines: string[] = [];
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
  if (lines.length > 0) lines.push(t("payAtVenue"));
  if (i.cancelWindowMin > 0) lines.push(t("freeCancellation", { window: formatCancelWindow(i.cancelWindowMin, t) }));
  return lines;
}

/** The "how much" hint beside a rental's price: hourly → its duration range,
    nights/days → the minimum stay when it is more than one, else nothing.
    Shared by the widget's offering cards and the page-builder Spaces section
    so the two never drift. */
export function stayHint(
  o: { rangeMode: RangeMode; minStay: number; minDurationMin: number | null; maxDurationMin: number | null },
  t: UnitsT,
): string | null {
  if (o.rangeMode === "hours") {
    return o.minDurationMin !== null && o.maxDurationMin !== null
      ? `${formatDurationLabel(o.minDurationMin, t)}–${formatDurationLabel(o.maxDurationMin, t)}`
      : null;
  }
  return o.minStay > 1 ? t(o.rangeMode === "nights" ? "minNights" : "minDays", { count: o.minStay }) : null;
}
