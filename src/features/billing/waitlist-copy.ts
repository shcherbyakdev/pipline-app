// Copy for the premium waitlist surfaces (sidebar card, /waitlist page). Plain
// data — no React — shared by the components and testable like site.ts.
import { PLANS } from "@/lib/billing/plans";

/** What joining unlocks — Pro's limits, said in the customer's words. The
    one number reads from PLANS so it can never drift from the gate. */
export const WAITLIST_PERKS: readonly string[] = [
  `Up to ${PLANS.pro.limits.bookableResources} bookable people or units`,
  "Unlimited services on your booking page",
  "Reminders for every booking, not just the first 30 a month",
  "No “Powered by Booklo” badge on your page and emails",
];

export const WAITLIST = {
  cardTitle: "Premium waitlist",
  cardBody: "Your brand, unlimited services, more people and spaces. Free while we build.",
  cardCta: "Join the waitlist",
  intro: "Premium is on its way. Join the waitlist and use everything it unlocks now, free while we build.",
  heading: "Unlock Premium early",
  sub: "Join the waitlist and your workspace switches to Premium right away. No card, nothing to cancel.",
  join: "Join the waitlist",
  joining: "Joining…",
  joinedHeading: "You’re on the list",
  joinedSub: "Premium is unlocked for your workspace. We’ll email you before anything changes.",
  joinedJustNow: "Welcome aboard — everything below is yours now.",
  alreadyPremium: "Your plan already includes everything Premium unlocks.",
  error: "Couldn’t add you to the list right now. Please try again.",
  perksHeading: "What’s unlocked",
} as const;
