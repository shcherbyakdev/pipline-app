// Single source of truth for what the pricing page shows and what the code
// enforces (spec §3/§7.3). Change a number here, nowhere else — the
// billing_mrr view (0043) mirrors these prices and says so.
export type PlanId = "free" | "pro" | "team";
export type PaidPlanId = Exclude<PlanId, "free">;
export type Interval = "month" | "year";

export type PlanLimits = {
  /** Bookable things the PUBLIC page may offer (H5b): active people when the
      org offers appointments, plus active units of its spaces when it offers
      spaces — one budget, people first (lib/booking/bookable.ts
      limitPublicResources). Team: = seats (the org_subscriptions column keeps
      its name). */
  bookableResources: number;
  /** Services the PUBLIC page may offer; null = unlimited (every plan today). */
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
  /** English, for the marketing pricing table only (Wave 5 moves it); the
      admin reads `billing.plans.<id>.blurb` from the messages instead. */
  blurb: string;
  /** USD, list price. yearly = total per year. */
  monthly: number;
  yearly: number;
  limits: PlanLimits;
};

/** Team's included bookable resources (people + units). Written into
    org_subscriptions.seats by the Stripe mapping, the fake emulator and comp
    overrides; entitlementsFor reads it back for Team. */
export const TEAM_INCLUDED_RESOURCES = 10;

const PAID_LIMITS = { hideBadge: true, customReminders: true, gcalSync: true, intakeQuestions: true, pageSections: "all" } as const;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    // Two, not one (ruling 2026-09-01): you plus one team member is free —
    // the second addition is what the waitlist/Billing gate on. The budget is
    // still shared with units, so a spaces-only org gets two rooms.
    // Services are unlimited on every plan (ruling 2026-09-03): a Free page
    // that hides most of a menu is bad advertising, and it carries our badge.
    // The cap machinery stays (`publicServices` is still number | null).
    id: "free", name: "Free", blurb: "Everything two people — or two rooms — need to take bookings.",
    monthly: 0, yearly: 0,
    limits: { bookableResources: 2, publicServices: null, reminderBookingsPerMonth: 30,
      hideBadge: false, customReminders: false, gcalSync: false, intakeQuestions: false, pageSections: "all" },
  },
  pro: {
    // Five (ruling 2026-09-03): a one-person studio with four rooms, or a
    // five-room venue, fits in Pro. Three was one slot above Free.
    id: "pro", name: "Pro", blurb: "Your brand, reminders for every booking, up to five bookable people or units.",
    monthly: 12, yearly: 108,
    limits: { bookableResources: 5, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
  team: {
    id: "team", name: "Team", blurb: "Up to ten bookable people and units, auto-assigned.",
    monthly: 29, yearly: 288,
    limits: { bookableResources: TEAM_INCLUDED_RESOURCES, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
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
