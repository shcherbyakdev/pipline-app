// Display-only mirror of the SQL money helpers in 0058
// (rental_total_cents / rental_deposit_cents). The RPCs are authoritative —
// this exists so flows, admin and emails can render the same numbers.
import { formatMoney } from "@/lib/money";
import { daysBetween, type RangeMode } from "./range";

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
  const n = daysBetween(startDate, endDate);
  return rangeMode === "nights" ? n : n + 1;
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

const UNIT_WORD: Record<RangeMode, string> = { hours: "hour", nights: "night", days: "day" };

export function formatOfferingPrice(
  o: { priceCents: number | null; pricingMode: PricingMode; rangeMode: RangeMode },
  currency: string,
): string | null {
  if (o.priceCents === null) return null;
  const amount = formatMoney(o.priceCents, currency);
  return o.pricingMode === "flat" ? amount : `${amount} / ${UNIT_WORD[o.rangeMode]}`;
}

export function formatCancelWindow(min: number): string {
  if (min % 1440 === 0) {
    const d = min / 1440;
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  const h = min / 60;
  const n = Number.isInteger(h) ? String(h) : String(Math.round(h * 10) / 10);
  return `${n} ${h === 1 ? "hour" : "hours"}`;
}

// Shared copy for the confirm step, the manage page and both emails.
export function moneyInfoLines(i: {
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  cancelWindowMin: number;
}): string[] {
  const lines: string[] = [];
  if (i.totalCents !== null && i.currency) lines.push(`Total: ${formatMoney(i.totalCents, i.currency)}`);
  if (i.depositCents !== null && i.currency) lines.push(`Deposit due: ${formatMoney(i.depositCents, i.currency)}`);
  if (lines.length > 0) lines.push("Payment: pay at the venue");
  if (i.cancelWindowMin > 0) lines.push(`Free cancellation until ${formatCancelWindow(i.cancelWindowMin)} before start`);
  return lines;
}
