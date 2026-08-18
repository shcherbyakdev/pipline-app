// Pure fake-Stripe emulator core (plan §7.6/§7.7, Global Constraints). No
// env, no I/O, no clock reads — every entry point takes `now` as an
// argument so it is deterministic under test. The dev checkout/portal pages
// (a later task) turn admin clicks into calls here, then hand the resulting
// `BillingEvent[]` to `applyBillingEvents`, the exact path a real Stripe
// webhook would take — so walking every scenario locally exercises the same
// projection code production does.
import type { Interval, PaidPlanId } from "./plans";
import { TEAM_INCLUDED_SEATS } from "./plans";
import type { OrgSubscriptionRow } from "./entitlements";
import type { BillingEvent, BillingEventType, BillingSubscription } from "./provider";

// ---------- Test cards (Global Constraints) ----------

export type CardVerdict = "ok" | "declined" | "insufficient_funds" | "past_due_first_charge" | "invalid";

const KNOWN_CARDS: Record<string, CardVerdict> = {
  "4242424242424242": "ok",
  "4000000000000002": "declined",
  "4000000000009995": "insufficient_funds",
  "4000000000000341": "past_due_first_charge",
};

/** Standard mod-10 check, doubling every second digit from the right. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** MM/YY or MM/YYYY, strictly not-yet-expired as of `now` (the end of the
    expiry month still counts as valid — a card expiring "this month" works
    all month). */
function expiryValid(exp: string, now: Date): boolean {
  const m = /^(\d{2})\/(\d{2}|\d{4})$/.exec(exp);
  if (!m) return false;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return false;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  // First instant of the month AFTER expiry, UTC: `now` must be strictly
  // before it for the card to still be usable this month.
  const firstOfNextMonth = Date.UTC(year, month, 1);
  return now.getTime() < firstOfNextMonth;
}

function cvcValid(cvc: string): boolean {
  return /^\d{3,4}$/.test(cvc);
}

export function classifyTestCard(input: { number: string; exp: string; cvc: string }, now: Date): CardVerdict {
  const digits = input.number.replace(/\s+/g, "");
  if (!/^\d{16}$/.test(digits)) return "invalid";
  if (!expiryValid(input.exp, now)) return "invalid";
  if (!cvcValid(input.cvc)) return "invalid";
  const known = KNOWN_CARDS[digits];
  if (known) return known;
  return luhnValid(digits) ? "ok" : "invalid";
}

// ---------- Period math ----------

/** +1 calendar month / +1 calendar year, clamping the day-of-month into the
    target month when it doesn't have that many days (Jan 31 → Feb 28/29,
    Feb 29 → Feb 28 a year later). Pure UTC arithmetic — never touches the
    host's local timezone. */
export function addInterval(from: Date, interval: Interval): Date {
  const day = from.getUTCDate();
  const targetYear = from.getUTCFullYear() + (interval === "year" ? 1 : 0);
  const targetMonth = from.getUTCMonth() + (interval === "month" ? 1 : 0);
  // Overflow of targetMonth (11 + 1 = 12) is exactly what Date.UTC normalises
  // by rolling into the next year, so no manual carry is needed here — only
  // the day-of-month clamp below needs a resolved (year, month) pair first.
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(Date.UTC(
    targetYear, targetMonth, clampedDay,
    from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds(),
  ));
}

// ---------- Ids ----------

export function fakeIds(orgId: string): { customer: string; subscription: string } {
  return { customer: `cus_fake_${orgId}`, subscription: `sub_fake_${orgId}` };
}

function seatsFor(plan: PaidPlanId): number {
  return plan === "team" ? TEAM_INCLUDED_SEATS : 1;
}

// ---------- Row / event shapes ----------

/** The dev pages' view of an org's subscription: everything
    `applyBillingEvents` needs to identify the row, plus the fields already
    on `org_subscriptions` (spec-shaped, camelCase). Structurally identical
    to `BillingSubscription` — same fields, same names — so a row can be
    used directly as one and adjusted per action. */
export type FakeRow = OrgSubscriptionRow & { providerCustomerId: string; providerSubscriptionId: string };

function eventId(action: string, orgId: string, now: Date): string {
  return `fake-${action}-${orgId}-${now.getTime()}`;
}

function buildEvent(
  action: string, orgId: string, now: Date, type: BillingEventType,
  subscription: BillingSubscription, occurredAt: Date = now,
): BillingEvent {
  return {
    provider: "fake",
    providerEventId: eventId(action, orgId, now),
    occurredAt: occurredAt.toISOString(),
    orgId,
    type,
    subscription,
    raw: { emulator: action },
  };
}

// ---------- Checkout ----------

export function checkoutEvents(i: {
  orgId: string; plan: PaidPlanId; interval: Interval; now: Date;
  existingCustomerId?: string; firstChargeFails?: boolean;
}): BillingEvent[] {
  const ids = fakeIds(i.orgId);
  const subscription: BillingSubscription = {
    providerCustomerId: i.existingCustomerId ?? ids.customer,
    providerSubscriptionId: ids.subscription,
    plan: i.plan,
    interval: i.interval,
    seats: seatsFor(i.plan),
    status: i.firstChargeFails ? "past_due" : "active",
    currentPeriodEnd: addInterval(i.now, i.interval).toISOString(),
    cancelAtPeriodEnd: false,
  };
  return [buildEvent("checkout", i.orgId, i.now, "subscription_created", subscription)];
}

// ---------- Portal actions ----------

export type FakeAction =
  | "cancel_at_period_end" | "resume" | "cancel_now"
  | "switch_pro" | "switch_team" | "switch_month" | "switch_year"
  | "fail_renewal" | "recover" | "advance_period";

export function actionEvents(action: FakeAction, row: FakeRow, orgId: string, now: Date): BillingEvent[] {
  switch (action) {
    case "cancel_at_period_end":
      return [buildEvent(action, orgId, now, "subscription_updated", { ...row, cancelAtPeriodEnd: true })];

    case "resume":
      return [buildEvent(action, orgId, now, "subscription_updated", { ...row, cancelAtPeriodEnd: false })];

    case "cancel_now":
      return [buildEvent(action, orgId, now, "subscription_expired", { ...row, status: "expired" })];

    case "switch_pro":
      return [buildEvent(action, orgId, now, "subscription_updated", { ...row, plan: "pro", seats: seatsFor("pro") })];

    case "switch_team":
      return [buildEvent(action, orgId, now, "subscription_updated", { ...row, plan: "team", seats: seatsFor("team") })];

    case "switch_month":
      return [buildEvent(action, orgId, now, "subscription_updated", {
        ...row, interval: "month", currentPeriodEnd: addInterval(now, "month").toISOString(),
      })];

    case "switch_year":
      return [buildEvent(action, orgId, now, "subscription_updated", {
        ...row, interval: "year", currentPeriodEnd: addInterval(now, "year").toISOString(),
      })];

    case "fail_renewal":
      return [buildEvent(action, orgId, now, "payment_failed", { ...row, status: "past_due" })];

    case "recover":
      return [buildEvent(action, orgId, now, "payment_recovered", {
        ...row, status: "active", currentPeriodEnd: addInterval(now, row.interval).toISOString(),
      })];

    case "advance_period": {
      // The anchor is the OLD period end, not `now` — Stripe's renewal (or
      // dunning-exhausted expiry) happens exactly at the period boundary,
      // which may already be behind `now` if nobody clicked "advance" until
      // later. `occurredAt` must still never precede `now` (the injected
      // instant of this click) or the ordering guard in apply_billing_event
      // (0043, `provider_updated_at <= incoming`) could read it as stale
      // against a row already touched by something more recent.
      const anchor = row.currentPeriodEnd ? new Date(row.currentPeriodEnd) : now;
      const occurredAt = new Date(Math.max(anchor.getTime(), now.getTime()));
      if (row.cancelAtPeriodEnd || row.status === "past_due") {
        return [buildEvent(action, orgId, now, "subscription_expired", { ...row, status: "expired" }, occurredAt)];
      }
      return [buildEvent(action, orgId, now, "subscription_updated", {
        ...row, currentPeriodEnd: addInterval(anchor, row.interval).toISOString(),
      }, occurredAt)];
    }
  }
}

// ---------- Dev-portal action menu ----------

export const FAKE_ACTIONS: Array<{ id: FakeAction; label: string; hint: string; enabledWhen: (row: FakeRow) => boolean }> = [
  {
    id: "cancel_at_period_end", label: "Cancel at period end",
    hint: "Flags the subscription to stop renewing; access continues until the current period ends.",
    enabledWhen: (row) => (row.status === "active" || row.status === "past_due") && !row.cancelAtPeriodEnd,
  },
  {
    id: "resume", label: "Resume",
    hint: "Clears the cancel-at-period-end flag; the subscription keeps renewing.",
    enabledWhen: (row) => row.cancelAtPeriodEnd,
  },
  {
    id: "cancel_now", label: "Cancel now",
    hint: "Ends the subscription immediately, no matter what is left of the current period.",
    enabledWhen: (row) => row.status !== "expired",
  },
  {
    id: "switch_pro", label: "Switch to Pro",
    hint: "Moves a Team subscription to Pro, keeping the same interval and period end.",
    enabledWhen: (row) => row.plan === "team",
  },
  {
    id: "switch_team", label: "Switch to Team",
    hint: "Moves a Pro subscription to Team, keeping the same interval and period end.",
    enabledWhen: (row) => row.plan === "pro",
  },
  {
    id: "switch_month", label: "Switch to monthly",
    hint: "Moves a yearly subscription to monthly billing; the period resets from now.",
    enabledWhen: (row) => row.interval === "year",
  },
  {
    id: "switch_year", label: "Switch to yearly",
    hint: "Moves a monthly subscription to yearly billing; the period resets from now.",
    enabledWhen: (row) => row.interval === "month",
  },
  {
    id: "fail_renewal", label: "Fail next renewal",
    hint: "Simulates a declined renewal charge; the subscription goes past_due.",
    enabledWhen: (row) => row.status === "active",
  },
  {
    id: "recover", label: "Recover payment",
    hint: "Simulates a successful retry; the subscription goes active and the period rolls from now.",
    enabledWhen: (row) => row.status === "past_due",
  },
  {
    id: "advance_period", label: "Advance period",
    hint: "Jumps to the current period's end: renews (or expires, if cancelling or past_due).",
    enabledWhen: (row) => row.status !== "expired",
  },
];
