// Marketing copy and links for the Booklo landing page. Plain data — no React —
// so it can be unit-tested and reused by every marketing component.

import { FLAG_DEFAULTS } from "@/lib/flags";
import { FOUNDER_PRICE_FACTOR, formatUsd, PLANS, type PlanId } from "@/lib/billing/plans";
import { SPACES } from "@/features/orgs/vocab";

const BILLING_ON = FLAG_DEFAULTS.billing; // no org on the marketing site: the environment default, by design

/* The landing sells Booklo to studio owners and landlords: people who rent
   out spaces and equipment (copy 2026-09-10). It is one hero
   (interfacecraft.dev-referenced, 2026-09-09): the eyebrow, the title, the
   sub, the claim bar and the product. The appointments channel runs but is
   not marketed. */
export const SITE = {
  name: "Booklo",
  // The page title's suffix and the hero's eyebrow.
  tagline: "Booking software for studio owners and landlords",
  description:
    "Booklo is booking software for studio owners and landlords. Clients book your spaces and equipment online. Booklo calculates prices using your rates, collects deposits, and keeps booking changes and extra charges together.",
  headline: "Your spaces, bookings, and payments. In one place.",
  subheadline:
    "Let clients book your spaces and equipment online. Booklo calculates prices using your rates, collects deposits, and keeps booking changes and extra charges together.",
  // Flag-conditional (lib/flags.ts): while billing is off there IS no paid
  // ladder to contrast a "Free plan" with, and /pricing 404s — so the note
  // says what is actually true today. Flipping the flag flips the copy.
  heroNote: BILLING_ON ? "Free plan · No credit card required" : "Free during early access · No credit card required",
  links: { home: "/", login: "/login", signup: "/signup", pricing: "/pricing", waitlist: "/waitlist" },
} as const;

/** Call-to-action button labels. */
export const CTA = {
  login: "Log in",
  getStarted: "Get started",
  /** The page's closing action (and what the claim bar does, in full). */
  createPage: "Create your booking page",
  dashboard: "Dashboard",
} as const;

/** Info-only cookie notice (marketing pages). Only essential cookies exist,
    which need no consent, so there is nothing to accept or reject: a note,
    a policy link and one dismiss button. */
export const COOKIE_NOTICE = {
  text: "Booklo only uses essential cookies, like the one that keeps you signed in. No tracking.",
  policy: "Privacy policy",
  dismiss: "Got it",
} as const;

/** The claim bar (the hero's one input). The status line is assembled from these:
    `taken(url)` + ". " + (`tryPrefix` + suggestion | `tryAnother`). */
export const CLAIM = {
  placeholder: "your-studio",
  button: "Claim",
  hint: "3-50 characters: letters, numbers, dashes.",
  taken: (url: string) => `${url} is taken`,
  tryPrefix: "Try ",
  tryAnother: "try another name",
  unavailable: "That name can't be used. Try another.",
  checkFailed: "Couldn't check right now. You can still continue.",
} as const;

export type NavLink = { label: string; href: string };

/** Under the hero: how it is used, five steps on a pinned stage that
    advance as the visitor scrolls (components/how-it-works.tsx draws a
    small product card for each). */
export type HowStep = { title: string; body: string };
export const HOW_LABEL = "How it works";
export const HOW_HEADING = "Set up your spaces. Share your link. Take bookings.";
export const HOW_SUB = "Add your spaces, availability, and rates. Clients choose a space and time, then pay a deposit to confirm their booking.";
export const HOW_STEPS: HowStep[] = [
  { title: "Set up your rooms", body: "Add each room, the whole studio and shared gear. Set prices from your rules: first hour, longer tiers, weekends." },
  { title: "Share your page", body: "Send your link or put the widget on your own site. Clients book with a name and an email." },
  { title: "Clients book and pay", body: "They pick a room and hours. The deposit holds the slot until your deadline." },
  { title: "Changes handle themselves", body: "Moves and cancellations follow your terms. Overtime is added to the same booking." },
  { title: "Start the day with a list", body: "Every morning at 8:00: holds expiring, requests waiting, balances due." },
];

/** Under the product: what it does, as short lines. Eight, two columns,
    one small glyph each (components/features.tsx maps `icon`). */
export type FeatureIcon = "price" | "deposit" | "change" | "charge" | "studio" | "morning" | "link" | "language";
export type Feature = { icon: FeatureIcon; title: string; body: string };
export const FEATURES_LABEL = "What it does";
export const FEATURES_HEADING = "Built for renting out spaces";
export const FEATURES_SUB = "Manage availability, flexible rates, deposits, and booking changes from one place.";
export const FEATURES: Feature[] = [
  { icon: "price", title: "Prices from your rules", body: "First hour and longer tiers, weekday or weekend, people, extras." },
  { icon: "deposit", title: "Deposits held, then paid", body: "A hold keeps the slot until your deadline. Paid, it's confirmed. Missed, it expires." },
  { icon: "change", title: "Changes with consequences", body: "Your cancellation tiers set the fee. Refunds are partial when your terms say so." },
  { icon: "charge", title: "After-session charges", body: "Overtime, extra people, cleaning: added to the same booking, one balance to pay." },
  { icon: "studio", title: "Whole studio and shared gear", body: "A whole-studio booking blocks every room. One lamp can't be in two rooms." },
  { icon: "morning", title: "Your morning list", body: "Holds expiring, requests waiting, balances due, changes to confirm. Emailed at 8:00." },
  { icon: "link", title: "No client accounts", body: "Clients book from your link or your own site, with a name and an email." },
  { icon: "language", title: "Polish and English", body: "Your page and every client email in the client's language. Your dashboard in yours." },
];

/** The page's last words, above the closing action (components/features.tsx). */
export const CLOSING = {
  heading: "Turn your spaces into bookable spaces.",
  sub: "Set your rates and availability, then give clients one link to book.",
} as const;

/** The footer's one line of links. */
export const FOOTER_LINKS: NavLink[] = [
  { label: CTA.login, href: SITE.links.login },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
];

/** One row of the pricing comparison table: a label plus one cell per plan,
    keyed by PlanId so a component can iterate the same COLUMNS array it uses
    for the header and index straight into the row (`row[id]`). */
export type PricingRow = Record<PlanId, string> & { label: string };

/** Mirrors the Stripe coupon via the same factor billing/plans.ts uses
    (FOUNDER_PRICE_FACTOR), so the number in this copy can never drift from
    what checkout actually charges. */
const FOUNDER_MONTHLY = formatUsd(PLANS.pro.monthly * FOUNDER_PRICE_FACTOR);

/** Pricing page copy (spec docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md).
    Rows are prose, not limits — the pricing table reads prices from PLANS
    (lib/billing/plans.ts) directly so a number never lives in two places. */
export const PRICING = {
  heading: "Simple pricing",
  sub: "Free for you and one more person, or two rooms. Pay when you need your brand, reminders for every booking or more bookable resources.",
  note: "Prices in USD. Taxes are handled at checkout.",
  rows: [
    // H5b: the one row that IS a limit reads it from PLANS so the number can
    // never drift from what the code enforces.
    {
      label: "Bookable resources — people and units",
      free: String(PLANS.free.limits.bookableResources),
      pro: String(PLANS.pro.limits.bookableResources),
      team: String(PLANS.team.limits.bookableResources),
    },
    { label: "Reminder emails", free: "First 30 bookings a month", pro: "Every booking", team: "Every booking" },
    { label: "Hosted page + website embed", free: "✓", pro: "✓", team: "✓" },
    { label: "Self-serve cancel & reschedule", free: "✓", pro: "✓", team: "✓" },
    { label: "Your logo, colours, welcome text", free: "✓", pro: "✓", team: "✓" },
    { label: "Remove “Powered by Booklo”", free: "—", pro: "✓", team: "✓" },
    { label: "Team layer: per-person links, “Anyone available”, colours", free: "—", pro: "—", team: "✓" },
  ] satisfies PricingRow[],
  founder: `Early-access accounts get Pro for ${FOUNDER_MONTHLY}/month, locked for life — look for the Founder ribbon in Billing.`,
  moreComing: "More is coming to Pro — early-access accounts hear first.",
} as const;

/** Onboarding ("Claim your page") copy. Lives here with the rest of the
    funnel copy so site.test.ts guards it like everything else. */
export const ONBOARDING = {
  heading: "Create your workspace",
  sub: "This is the address clients book you at. You can change it later.",
  nameLabel: "Your name or business",
  namePlaceholder: "Anna Studio",
  handleLabel: "Page address",
  handlePlaceholder: "your-name",
  handleHint: "3–50 characters: letters, numbers, dashes. Leave empty to choose later.",
  handleReserved: "That name can't be used — try another.",
  handleFree: (url: string) => `${url} is free`,
  handleTaken: (url: string) => `${url} is taken`,
  handleTakenSuggest: (suggestion: string) => `try ${suggestion}`,
  handleChecking: "Checking…",
  handleCheckFailed: "Couldn't check right now — you can still continue.",
  timezoneLabel: "Timezone",
  modeLegend: "What are you booking?",
  modeError: "Pick what you're booking.",
  modes: [
    { value: "rentals", title: SPACES.pickerTitle, blurb: SPACES.pickerBlurb },
    { value: "appointments", title: "Appointments", blurb: "Time on your calendar: consultations, sessions, classes." },
  ],
  next: "Continue",
  back: "Back",
  skip: "Skip",
  submit: "Create workspace",
  /* The wizard steps after the org exists (features/orgs/onboarding-steps.ts).
     Field labels come from STARTER.firstService/firstSpace — same forms,
     same words. */
  wizard: {
    mode: { heading: "What are you booking?", sub: "You can change this in Settings until you add your first service or space." },
    service: { heading: "Add your first service", sub: "What clients book with you. Add more on Services later." },
    space: { heading: "Add your first space", sub: "A room, studio or item clients book. Its first unit comes with it." },
    hours: {
      heading: "Your weekly hours",
      sub: "When clients can book you. We started you with Mon–Fri, 9–5.",
      save: "Save hours",
    },
    share: {
      heading: "Your page is live",
      sub: "Share the link anywhere clients find you.",
      /* /<handle> 404s while nothing is publicly bookable (D9's intentional
         404; app/[handle]/page.tsx) — never claim live, or offer a copyable
         link, before it actually resolves. */
      almostHeading: "Almost live",
      almostSub: "Add what clients book and your page opens at:",
      noHandle: "Your workspace is ready.",
      noHandleSub: "Pick a page address on Booking page and you're bookable.",
      setUpPage: "Set up your booking page",
      copyLink: "Copy link",
      copied: "Copied",
      finish: "Go to your bookings",
    },
  },
  submitting: "Creating…",
  justTaken: "That name was just taken — pick another.",
} as const;

/** First screen after onboarding (/bookings, until setup is done). One subtitle per
    mode; the checklist labels below are the chips' text (setup-checklist.ts). */
export const WELCOME = {
  owned: (url: string) => `${url} is yours.`,
  sub: "Add a service and set your hours to go live.",
  subRentals: "Add a space and its units to go live.",
  setHours: "Set hours",
  copyLink: "Copy link",
  copied: "Copied",
  noHandle: "Your workspace is ready.",
  noHandleSub: "Pick a page address and you're bookable.",
  setUpPage: "Set up your booking page",
  dismiss: "Dismiss",
} as const;

/** Words that must not appear in marketing copy: the provider's name
    (never marketed), the retired channel words (H5b: "Spaces" is the word;
    "rentals" plural is the old channel, "Gear rental" the business type
    stays legal) and "offering". "payment" left the list with S2 (holds and
    collection shipped, roadmap 2026-09-07 S9); "google / calendar sync"
    stays unmarketed until S11 and is guarded by the corpus test below. */
export const FORBIDDEN_COPY = ["stripe", "offering", "rentals", "google", "calendar sync"] as const;

/** Every internal href on the page (for the route guard test). */
export function allInternalHrefs(): string[] {
  return [...new Set([...Object.values(SITE.links), ...FOOTER_LINKS.map((l) => l.href)])];
}
