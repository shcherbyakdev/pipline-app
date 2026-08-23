// Single source of truth for what the pricing page shows and what the code
// enforces (spec §3/§7.3). Change a number here, nowhere else — the
// billing_mrr view (0043) mirrors these prices and says so.
export type PlanId = "free" | "pro" | "team";
export type PaidPlanId = Exclude<PlanId, "free">;
export type Interval = "month" | "year";

export type PlanLimits = {
  /** Staff members the PUBLIC page may offer (Team: = seats). */
  bookableStaff: number;
  /** Services the PUBLIC page may offer; null = unlimited. */
  publicServices: number | null;
  /** Reminder emails are sent for the first N bookings made each month; null = unlimited. */
  reminderBookingsPerMonth: number | null;
  /** May the org hide "Powered by Booklo"? */
  hideBadge: boolean;
  // Flags for follow-up slices; nothing reads them yet.
  customReminders: boolean;
  gcalSync: boolean;
  intakeQuestions: boolean;
  /** Which booking-page sections may be published: "basic" = header, booking,
      about, links (a link-in-bio page); "all" = the whole catalogue. Every
      plan is "all" for now — the gate is wired so flipping it is a one-line change. */
  pageSections: "basic" | "all";
};

export type PlanDef = {
  id: PlanId;
  name: string;
  blurb: string;
  /** USD, list price. yearly = total per year. */
  monthly: number;
  yearly: number;
  limits: PlanLimits;
};

export const TEAM_INCLUDED_SEATS = 5;

const PAID_LIMITS = { hideBadge: true, customReminders: true, gcalSync: true, intakeQuestions: true, pageSections: "all" } as const;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", name: "Free", blurb: "Everything a solo provider needs to take bookings.",
    monthly: 0, yearly: 0,
    limits: { bookableStaff: 1, publicServices: 3, reminderBookingsPerMonth: 30,
      hideBadge: false, customReminders: false, gcalSync: false, intakeQuestions: false, pageSections: "all" },
  },
  pro: {
    id: "pro", name: "Pro", blurb: "Your brand, unlimited services, reminders for every booking.",
    monthly: 12, yearly: 108,
    limits: { bookableStaff: 1, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
  team: {
    id: "team", name: "Team", blurb: "Up to five team members, each bookable, auto-assigned.",
    monthly: 29, yearly: 288,
    limits: { bookableStaff: TEAM_INCLUDED_SEATS, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
};

export const PAID_PLANS: readonly PaidPlanId[] = ["pro", "team"];

export function isPaidPlan(id: string): id is PaidPlanId {
  return id === "pro" || id === "team";
}

export function pricePerMonth(plan: PaidPlanId, interval: Interval): number {
  return interval === "month" ? PLANS[plan].monthly : PLANS[plan].yearly / 12;
}

/** Mirrors the Stripe coupon: 33.3 % off Pro monthly, forever. Monthly only —
    the coupon does not touch the yearly price. */
export const FOUNDER_PRICE_FACTOR = 2 / 3;

/** Whole dollars stay whole ($9, not $9.00); anything else keeps its cents.
    Rounds to cents first, so a derived price carrying float noise
    (12 * 2/3 = 7.999…) still reads as the dollar amount it is. */
export function formatUsd(amount: number): string {
  const cents = Math.round(amount * 100);
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Share of the list price the yearly plan saves, e.g. 0.25 → "save 25%". */
export function yearlySaving(plan: PaidPlanId): number {
  return 1 - PLANS[plan].yearly / (PLANS[plan].monthly * 12);
}
