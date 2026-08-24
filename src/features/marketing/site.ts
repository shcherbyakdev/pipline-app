// Marketing copy and links for the Booklo landing page. Plain data — no React —
// so it can be unit-tested and reused by every marketing component.

import { FLAG_DEFAULTS } from "@/lib/flags";
import { FOUNDER_PRICE_FACTOR, formatUsd, PLANS, type PlanId } from "@/lib/billing/plans";

const BILLING_ON = FLAG_DEFAULTS.billing; // no org on the marketing site: the environment default, by design

export const SITE = {
  name: "Booklo",
  tagline: "Booking page & widget for solo providers",
  description:
    "Booklo gives freelancers and small businesses a hosted booking page and an embeddable widget. Clients book without an account; confirmations, reminders and rescheduling are handled for you.",
  // Two staggered lines; the last word of the second carries the highlight.
  headline: ["Your booking page.", "Claimed in a minute."],
  subheadline: "Clients pick a time, you both get the email. No accounts, no double bookings.",
  // Flag-conditional (lib/flags.ts): while billing is off there IS no paid
  // ladder to contrast a "Free plan" with, and /pricing 404s — so the note
  // says what is actually true today. Flipping the flag flips the copy.
  heroNote: BILLING_ON ? "Free plan · No credit card" : "Free during early access · No credit card",
  links: { home: "/", login: "/login", signup: "/signup", pricing: "/pricing" },
  anchors: { how: "#how-it-works", faq: "#faq" },
} as const;

/** `#features` → `features`, so a section's `id` and the nav href that targets it share one source. */
export function anchorId(anchor: string): string {
  if (!anchor.startsWith("#")) throw new Error(`anchor must start with "#": ${anchor}`);
  return anchor.slice(1);
}

/** Section headings, sub-lines and body copy. Components stay presentational. */
export const SECTIONS = {
  how: {
    heading: "How it works",
    sub: "Three steps from your name to your first booking.",
  },
  features: {
    heading: "Everything a booking page should do",
    sub: "Nothing you have to configure twice.",
  },
  product: {
    heading: "Your week, at a glance",
    sub: "One calendar for everything that’s booked, blocked or free.",
    points: [
      "See every booking for the week at a glance",
      "Block time off with a drag — clients never see it",
      "Add walk-in or phone bookings in seconds",
    ],
  },
  embed: {
    heading: "Paste one line. The widget resizes itself.",
    paragraphs: [
      "Drop the snippet into any website builder or plain HTML page. The booking widget loads inside your page, adjusts its own height as clients move through the steps, and never asks them to leave your site.",
      "Prefer a link? The same page works standalone at your own handle — share it in email, on social, or in your bio.",
    ],
  },
  faq: { heading: "Questions, answered" },
} as const;

/** Call-to-action button labels. */
export const CTA = {
  login: "Log in",
  getStarted: "Get started",
  getStartedFree: "Get started free",
  seeHow: "See how it works",
} as const;

/** The claim bar (hero + final CTA). The status line is assembled from
    these: `taken(url)` + " — " + (`tryPrefix` + suggestion | `tryAnother`). */
export const CLAIM = {
  placeholder: "your-name",
  button: "Claim",
  hint: "3–50 characters: letters, numbers, dashes.",
  taken: (url: string) => `${url} is taken`,
  tryPrefix: "try ",
  tryAnother: "try another name",
  unavailable: "That name can't be used — try another.",
  checkFailed: "Couldn't check right now — you can still continue.",
} as const;

export const FINAL_CTA = { heading: "Claim your page." } as const;

export type NavLink = { label: string; href: string };

export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: SITE.anchors.how },
  // Only listed once billing is live (lib/flags.ts) — while off, /pricing 404s
  // and nothing should link to it from the nav.
  ...(BILLING_ON ? [{ label: "Pricing", href: SITE.links.pricing }] : []),
  { label: "FAQ", href: SITE.anchors.faq },
];

export type Step = { number: "01" | "02" | "03"; title: string; body: string };

export const STEPS: Step[] = [
  { number: "01", title: "Set your services and hours", body: "What you offer, how long it takes, when you're free." },
  { number: "02", title: "Share your link or embed the widget", body: "Every account gets a page at its own address. One line embeds it on your site." },
  { number: "03", title: "Clients book; you both get confirmations", body: "They see only real openings. Confirmations and reminders go out on their own." },
];

export type FeatureIcon = "globe" | "code" | "calendar-check" | "refresh" | "bell" | "palette";
export type Feature = { icon: FeatureIcon; title: string; body: string };

export const FEATURES: Feature[] = [
  { icon: "globe", title: "Hosted booking page", body: "A clean, mobile-first page at your own handle. Nothing to install." },
  { icon: "code", title: "Embed on any site", body: "One script tag. The widget fits into your page and grows with its content." },
  { icon: "calendar-check", title: "Double-booking impossible", body: "Slots are guarded at the database level — two people can never take the same time." },
  { icon: "refresh", title: "Self-serve cancel & reschedule", body: "Clients manage their booking from a secure link in the email. No back-and-forth." },
  { icon: "bell", title: "Automatic reminders", body: "A reminder goes out before every appointment, so fewer no-shows." },
  { icon: "palette", title: "Your brand", body: "Logo, brand color and a welcome message — the page looks like yours, not ours." },
];

export type FaqItem = { question: string; answer: string };

export const FAQ: FaqItem[] = [
  { question: "Do my clients need an account?", answer: "No. They pick a time, enter a name and email, and they're booked. Everything else happens through links in their confirmation email." },
  { question: "Can I embed it on my own website?", answer: "Yes. Copy one script tag from your dashboard and paste it into any page. The widget adjusts its height automatically." },
  { question: "What happens if two people pick the same slot?", answer: "Only one booking can win. The other person sees that the slot was just taken and is offered fresh times — never a silent double booking." },
  { question: "How do clients cancel or reschedule?", answer: "Their confirmation email contains a secure manage link. From there they can cancel or pick another slot; you get notified either way." },
  { question: "What data do you store about my clients?", answer: "Name, email and an optional note — nothing else. No documents, no card numbers, no accounts." },
  // Same flag rule as SITE.heroNote: the paid answer names plans that cannot
  // be bought and points at a /pricing that 404s until FLAG_DEFAULTS.billing flips.
  {
    question: "What does it cost?",
    answer: BILLING_ON
      ? "Free for solo providers — one bookable person, three services, reminders for your first 30 bookings each month. Pro and Team add your brand, unlimited services and a team; see Pricing."
      : "Booklo is free during early access. We'll announce pricing well before anything changes, and early users will hear first.",
  },
];

export type FooterColumn = { heading: string; links: NavLink[] };

export const FOOTER_COLUMNS: FooterColumn[] = [
  { heading: "Product", links: NAV_LINKS },
  {
    heading: "Account",
    links: [
      { label: CTA.login, href: SITE.links.login },
      { label: "Sign up", href: SITE.links.signup },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
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
  sub: "Free for solo providers. Pay when you need your brand, unlimited services or a team.",
  note: "Prices in USD. Taxes are handled at checkout.",
  rows: [
    { label: "Publicly bookable team members", free: "1", pro: "1", team: "5" },
    { label: "Services on your booking page", free: "3", pro: "Unlimited", team: "Unlimited" },
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
  heading: "Claim your page",
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
    { value: "appointments", title: "Appointments", blurb: "Time on your calendar: consultations, sessions, classes." },
    { value: "rentals", title: "Rentals", blurb: "Things people book by the night or day: rooms, cars, equipment." },
    { value: "both", title: "Both", blurb: "You sell appointments and rentals." },
  ],
  submit: "Claim my page",
  submitting: "Claiming…",
  justTaken: "That name was just taken — pick another.",
} as const;

/** First screen after onboarding (/bookings?welcome=1). */
export const WELCOME = {
  owned: (url: string) => `${url} is yours.`,
  sub: "Add a service and set your hours to go live.",
  addService: "Add a service",
  copyLink: "Copy link",
  copied: "Copied",
  noHandle: "Your workspace is ready.",
  noHandleSub: "Pick a page address and you're bookable.",
  setUpPage: "Set up your booking page",
  dismiss: "Dismiss",
} as const;

/** Words that must not appear in marketing copy: features not shipped yet. */
export const FORBIDDEN_COPY = ["google", "calendar sync", "stripe", "payment"] as const;

/** Every internal href on the page (for route/anchor guard tests). `#` alone is a placeholder and skipped. */
export function allInternalHrefs(): string[] {
  const hrefs = [
    ...Object.values(SITE.links),
    ...NAV_LINKS.map((l) => l.href),
    ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
  ];
  return [...new Set(hrefs)].filter((h) => h !== "#");
}
