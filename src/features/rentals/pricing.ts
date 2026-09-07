// Display-only mirror of the SQL money helpers in 0058
// (rental_total_cents / rental_deposit_cents). The RPCs are authoritative —
// this exists so flows, admin and emails can render the same numbers.
import { formatMoney } from "@/lib/money";
import type { UnitsT } from "@/i18n/translator";
import { stayLength, type RangeMode } from "./range";
import { formatDurationLabel } from "./hourly";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import type { ExtraPick, Line, PricingRules } from "./pricing-rules";

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
  i: { totalCents: number | null; depositCents: number | null; currency: string | null; cancelWindowMin: number; lines?: Line[] | null },
  t: UnitsT,
): string[] {
  const lines: string[] = [];
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
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

// ---------- S1: the quote (mirror of public.rental_quote_hours, 0078).
// Every rule here has a line-for-line twin in the SQL; the lockstep test
// (pricing-quote.integration.test.ts) fails if they drift.

export type QuoteOffering = { pricing: PricingRules | null; priceCents: number | null; pricingMode: PricingMode };

const MIN = 60_000;

function minutesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? Math.round((e - s) / MIN) : 0;
}

export function quoteHours(
  o: QuoteOffering,
  startsAt: Date,
  durationMin: number,
  people: number | null,
  extras: ExtraPick[],
  timeZone: string,
): Line[] {
  const lines: Line[] = [];
  const hours = durationMin / 60;
  // 1. Base.
  if (o.pricing === null) {
    const total = totalCents({ priceCents: o.priceCents, pricingMode: o.pricingMode, depositType: "none", depositValue: null }, hours);
    if (total === null) return [];
    return [{ kind: "base", qty: hours, unitCents: o.pricingMode === "flat" ? null : o.priceCents, cents: total }];
  }
  const band = [...o.pricing.bands].reverse().find((b) => b.fromMin <= durationMin);
  if (!band) throw new Error("quote_band");
  const baseCents = band.totalCents !== undefined ? band.totalCents : Math.round(band.perHourCents! * hours);
  lines.push({ kind: "base", qty: hours, unitCents: band.totalCents !== undefined ? null : band.perHourCents!, cents: baseCents });
  // 2. Surcharges — pro-rata by overlapping minutes, on the base only.
  const start = startsAt.getTime();
  const end = start + durationMin * MIN;
  const firstDay = dateInZone(new Date(start - 24 * 60 * MIN), timeZone);
  const lastDay = dateInZone(new Date(end), timeZone);
  for (const s of o.pricing.surcharges) {
    let overlap = 0;
    for (let d = firstDay; d <= lastDay; d = nextDay(d)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (!s.days.includes(dow)) continue;
      const wStart = wallTimeToUtc(d, s.from, timeZone).getTime();
      const wEnd = wallTimeToUtc(s.to < s.from ? nextDay(d) : d, s.to, timeZone).getTime();
      overlap += minutesOverlap(start, end, wStart, wEnd);
    }
    if (overlap === 0) continue;
    lines.push({ kind: "surcharge", qty: overlap, unitCents: null, cents: Math.round((baseCents * s.pct) / 100 * overlap / durationMin), label: s.label, pct: s.pct });
  }
  // 3. People.
  if (o.pricing.people) {
    const p = o.pricing.people;
    const n = people ?? p.included;
    if (n > p.max) throw new Error("quote_people");
    const qty = Math.max(0, n - p.included);
    if (qty > 0) lines.push({ kind: "people", qty, unitCents: p.extraCents, cents: qty * p.extraCents });
  }
  // 4. Extras.
  const seen = new Set<string>();
  for (const pick of extras) {
    const def = o.pricing.extras.find((e) => e.id === pick.id);
    if (!def || seen.has(pick.id) || pick.qty < 1 || pick.qty > def.maxQty) throw new Error("quote_extra");
    seen.add(pick.id);
    const cents = def.unit === "hour" ? Math.round(def.priceCents * pick.qty * hours) : def.priceCents * pick.qty;
    lines.push({ kind: "extra", qty: pick.qty, unitCents: def.priceCents, cents, extraId: def.id, label: def.label, unit: def.unit });
  }
  return lines;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function sumLines(lines: Line[]): number {
  return lines.reduce((acc, l) => acc + l.cents, 0);
}

/** One line of the breakdown in the viewer's language; the studio's own
    label where a line has one. The amount is appended by moneyInfoLines. */
export function formatLine(l: Line, currency: string, t: UnitsT): string {
  switch (l.kind) {
    case "base":
      return l.unitCents === null
        ? formatDurationLabel(Math.round(l.qty * 60), t)
        : t("line.base", { hours: formatDurationLabel(Math.round(l.qty * 60), t), rate: formatMoney(l.unitCents, currency) });
    case "surcharge":
      return t("line.surcharge", { label: l.label, pct: l.pct });
    case "people":
      return t("line.people", { count: l.qty, each: formatMoney(l.unitCents, currency) });
    case "extra":
      return t("line.extra", { label: l.label, qty: l.qty });
  }
}

/** The card/list/header price. Rules → the cheapest hourly band, prefixed
    "from"; totals-only rules → the first band's total for its hours; no
    rules → the H3 label. */
export function headlinePrice(
  o: QuoteOffering & { rangeMode: RangeMode },
  currency: string,
  t: UnitsT,
): string | null {
  if (o.rangeMode !== "hours" || o.pricing === null) return formatOfferingPrice(o, currency, t);
  const hourly = o.pricing.bands.filter((b) => b.perHourCents !== undefined).map((b) => b.perHourCents!);
  if (hourly.length > 0) return t("fromPerHour", { amount: formatMoney(Math.min(...hourly), currency) });
  const first = o.pricing.bands[0];
  return t("totalFor", { amount: formatMoney(first.totalCents!, currency), length: formatDurationLabel(first.fromMin, t) });
}
