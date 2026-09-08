// Display-only mirror of the SQL money helpers in 0058
// (rental_total_cents / rental_deposit_cents). The RPCs are authoritative —
// this exists so flows, admin and emails can render the same numbers.
import { formatMoney } from "@/lib/money";
import type { UnitsT } from "@/i18n/translator";
import { stayLength, type RangeMode } from "./range";
import { formatDurationLabel } from "./hourly";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import type { ExtraPick, Line, PricingRules } from "./pricing-rules";
import { formatCancelPolicy, formatCancelWindow, type CancelPolicy } from "./cancel-policy";
// H3 callers still import the window formatter from here.
export { formatCancelWindow };

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

export type MoneyInfo = {
  totalCents: number | null;
  depositCents: number | null;
  currency: string | null;
  /** S3: the booking's own snapshot (the offering's tiers for a quote). */
  cancelPolicy: CancelPolicy | null;
  /** S3: the consequence the row carries — a cancellation fee on a dead row,
      an accumulated late-change fee on a live one. */
  feeCents?: number;
  lines?: Line[] | null;
  /** S2: what the committed row says was paid / refunded (never computed here). */
  paidCents?: number;
  refundedCents?: number;
  /** S2: the booking is a hold awaiting its deposit. */
  holding?: boolean;
  /** S2: the booking is dead (expired / cancelled / declined / rescheduled) —
      nobody is turning up, so the lines must not tell the client to bring money. */
  settled?: boolean;
  /** S7: after-session charges on the row, the write-off, and whether the
      org can take the balance online (wording of the balance line). */
  charges?: { label: string; qty: number; cents: number }[];
  writtenOffCents?: number;
  onlinePay?: boolean;
};

// Shared copy for the confirm step, the manage page and both emails. The
// quote's breakdown lines come first, one per line, and the total follows
// them (booking-money-summary.tsx relies on that order). S3: a fee prints
// right after the total and joins the balance ("due at the venue" = total +
// fee − paid). S2 states: a hold says "pay now"; a paid booking says what
// was paid and what is left for the venue; a refund prints last, before the
// policy line. A `settled` booking drops every "at the venue" / "deposit
// due" line and the policy line — nobody is coming, nothing is owed at the
// door, and the terms no longer apply.
export function moneyInfoLines(i: MoneyInfo, t: UnitsT): string[] {
  const lines: string[] = [];
  const paid = i.paidCents ?? 0;
  const refunded = i.refundedCents ?? 0;
  const fee = i.feeCents ?? 0;
  const charges = i.charges ?? [];
  const chargesTotal = charges.reduce((s, c) => s + c.cents, 0);
  const writtenOff = i.writtenOffCents ?? 0;
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (fee > 0 && i.currency) {
    lines.push(t(i.settled ? "cancellationFee" : "changeFee", { amount: formatMoney(fee, i.currency) }));
  }
  if (i.currency) {
    for (const c of charges) {
      lines.push(
        c.qty > 1
          ? t("chargeLineQty", { label: c.label, qty: c.qty, amount: formatMoney(c.cents, i.currency) })
          : t("chargeLine", { label: c.label, amount: formatMoney(c.cents, i.currency) }),
      );
    }
  }
  const held = Math.max(0, paid - refunded);
  const due = (i.totalCents ?? 0) + fee + chargesTotal - writtenOff - held;
  if (i.currency && paid > 0) {
    lines.push(t("paid", { amount: formatMoney(paid, i.currency) }));
    if (!i.settled && i.totalCents !== null && due > 0) {
      lines.push(t(i.onlinePay ? "balanceDue" : "balanceAtVenue", { amount: formatMoney(due, i.currency) }));
    }
  } else if (!i.settled) {
    if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
    if (i.holding && i.depositCents !== null && i.currency) lines.push(t("payNow", { amount: formatMoney(i.depositCents, i.currency) }));
    else if (lines.length > 0) {
      if (chargesTotal > 0 && i.currency && due > 0) lines.push(t(i.onlinePay ? "balanceDue" : "balanceAtVenue", { amount: formatMoney(due, i.currency) }));
      else lines.push(t("payAtVenue"));
    }
  }
  if (writtenOff > 0 && i.currency) lines.push(t("writtenOff", { amount: formatMoney(writtenOff, i.currency) }));
  if (i.currency && refunded > 0) lines.push(t("refund", { amount: formatMoney(refunded, i.currency) }));
  if (!i.settled) {
    const policy = formatCancelPolicy(i.cancelPolicy, t);
    if (policy) lines.push(policy);
  }
  return lines;
}

/** S3: what a reschedule to the candidate would mean, shown before the
    client confirms (both reschedule panels). `feeCents` is THIS move's tier
    fee, `priorFeeCents` what the row already carries from earlier moves;
    the balance counts both. Unpriced → nothing to say. */
export function changeLines(
  i: {
    newTotalCents: number | null;
    currency: string | null;
    feeCents: number;
    feePct: number;
    priorFeeCents: number;
    paidCents: number;
    refundedCents: number;
  },
  t: UnitsT,
): string[] {
  if (i.newTotalCents === null || !i.currency) return [];
  const lines = [t("newTotal", { amount: formatMoney(i.newTotalCents, i.currency) })];
  if (i.feeCents > 0) lines.push(t("changeFeePct", { amount: formatMoney(i.feeCents, i.currency), pct: i.feePct }));
  const held = Math.max(0, i.paidCents - i.refundedCents);
  const due = i.newTotalCents + i.priorFeeCents + i.feeCents - held;
  if (due < 0) lines.push(t("willRefund", { amount: formatMoney(-due, i.currency) }));
  else if (due > 0) lines.push(t("balanceAtVenue", { amount: formatMoney(due, i.currency) }));
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
    lines.push({ kind: "surcharge", qty: overlap, unitCents: null, cents: Math.round((baseCents * s.pct * overlap) / (100 * durationMin)), label: s.label, pct: s.pct });
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
