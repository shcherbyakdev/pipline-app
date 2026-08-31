// Marketing copy and links for the Booklo landing page. Plain data — no React —
// so it can be unit-tested and reused by every marketing component.

import { FLAG_DEFAULTS } from "@/lib/flags";
import { FOUNDER_PRICE_FACTOR, formatUsd, PLANS, type PlanId } from "@/lib/billing/plans";
import { SPACES } from "@/features/orgs/vocab";

const BILLING_ON = FLAG_DEFAULTS.billing; // no org on the marketing site: the environment default, by design

export const SITE = {
  name: "Booklo",
  tagline: "Booking page & widget for appointments and spaces",
  description:
    "Booklo gives solo providers and small businesses a hosted booking page and an embeddable widget: for appointments, and for spaces like rooms, studios and gear booked by the hour or night. Clients book without an account; confirmations, reminders and rescheduling are handled for you.",
  // Two lines; `markedWord` is the word in the second line the hero draws a
  // marker stroke behind (the promise).
  headline: ["Your booking page.", "Claimed in a minute."],
  markedWord: "Claimed",
  subheadline: "Appointments and spaces on one page. Clients pick a time, you both get the email. No accounts, no double bookings.",
  /** Under the claim bar: three product truths, as words (there are no
      metrics to show and none may be invented). */
  truths: ["No client accounts", "No double bookings", "Live in a minute"],
  // Flag-conditional (lib/flags.ts): while billing is off there IS no paid
  // ladder to contrast a "Free plan" with, and /pricing 404s — so the note
  // says what is actually true today. Flipping the flag flips the copy.
  heroNote: BILLING_ON ? "Free plan · No credit card" : "Free during early access · No credit card",
  links: { home: "/", login: "/login", signup: "/signup", pricing: "/pricing" },
  anchors: { how: "#how-it-works", features: "#features", faq: "#faq" },
} as const;

/** `#features` → `features`, so a section's `id` and the nav href that targets it share one source. */
export function anchorId(anchor: string): string {
  if (!anchor.startsWith("#")) throw new Error(`anchor must start with "#": ${anchor}`);
  return anchor.slice(1);
}

/** Section headings, sub-lines and body copy. Components stay presentational. */
export const SECTIONS = {
  how: {
    eyebrow: "How it works",
    heading: "From your name to your first booking",
    sub: "Three steps. Nothing to install, no setup call.",
  },
  features: {
    eyebrow: "Features",
    heading: "Everything a booking page should do",
    sub: "Nothing you have to configure twice.",
  },
  faq: { eyebrow: "FAQ", heading: "Questions, answered" },
} as const;

/** Call-to-action button labels. */
export const CTA = {
  login: "Log in",
  getStarted: "Get started",
  getStartedFree: "Get started free",
  seeHow: "See how it works",
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

/** The claim bar (hero + final CTA). The status line is assembled from
    these: `taken(url)` + ". " + (`tryPrefix` + suggestion | `tryAnother`). */
export const CLAIM = {
  placeholder: "your-name",
  button: "Claim",
  hint: "3-50 characters: letters, numbers, dashes.",
  taken: (url: string) => `${url} is taken`,
  tryPrefix: "Try ",
  tryAnother: "try another name",
  unavailable: "That name can't be used. Try another.",
  checkFailed: "Couldn't check right now. You can still continue.",
} as const;

export const FINAL_CTA = {
  heading: "Claim your page.",
  sub: "Pick a name, add a service, set your hours. You're bookable.",
} as const;

/** The hero's tab pill: which channel the mockup previews. Labels come from
    the product's own vocabulary where it has one. */
export const HERO_TABS = [
  { id: "appointments", label: "Appointments" },
  { id: "spaces", label: SPACES.pickerTitle },
] as const satisfies ReadonlyArray<{ id: "appointments" | "spaces"; label: string }>;

/** Strip above the nav. Same flag rule as SITE.heroNote. */
export const ANNOUNCEMENT = {
  label: "Early access",
  text: BILLING_ON ? "Free plan for solo providers, no credit card." : "Free while we build, no credit card.",
  cta: "Claim your page",
} as const;

/** "Who it's for": a centred heading, then three staggered text blocks (the
    two things the page books, and both at once), each with the kinds of
    business it names. */
export type AudienceBlock = { title: string; body: string; groups: readonly string[] };
export const AUDIENCE = {
  eyebrow: "Who it's for",
  heading: "Built for people who sell their time, or their space.",
  sub: "Consultants and coaches, but also studios, rooms and gear that clients book by the hour or night. One page, one calendar.",
  blocks: [
    {
      title: "Your time",
      body: "Consultations, sessions, classes. Clients pick a slot on your calendar and the confirmation goes to both of you.",
      groups: ["Consultants", "Coaches", "Therapists", "Tutors", "Photographers"],
    },
    {
      title: "Your space",
      body: "Rooms, studios and gear, booked by the hour, night or day. Each space has units, so two clients never get the same room.",
      groups: ["Studios", "Coworking", "Rehearsal rooms", "Courts", "Gear rental"],
    },
    {
      title: "Or both, on one page",
      body: "One address, one calendar, one list of bookings. Clients see only real openings, whatever they are booking.",
      groups: [],
    },
  ] satisfies readonly AudienceBlock[],
} as const;

export type NavLink = { label: string; href: string };

// Home-anchored ("/#x", not "#x"): the nav and footer also render on
// /pricing, /privacy and /terms, where a bare anchor goes nowhere. On the
// landing itself the browser still scrolls in place (same path).
export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: `/${SITE.anchors.how}` },
  { label: "Features", href: `/${SITE.anchors.features}` },
  // Only listed once billing is live (lib/flags.ts) — while off, /pricing 404s
  // and nothing should link to it from the nav.
  ...(BILLING_ON ? [{ label: "Pricing", href: SITE.links.pricing }] : []),
  { label: "FAQ", href: `/${SITE.anchors.faq}` },
];

/** `word` is the one-word verb drawn in a marker stroke beside each step. */
export type Step = { number: "01" | "02" | "03"; word: string; title: string; body: string };

export const STEPS: Step[] = [
  { number: "01", word: "Add", title: "Add what you offer and when", body: "Services or spaces: how long they take, when you're open, how many units you have." },
  { number: "02", word: "Share", title: "Share your link or embed the widget", body: "Every account gets a page at its own address. One line embeds it on your site." },
  { number: "03", word: "Book", title: "Clients book; you both get confirmations", body: "They see only real openings. Confirmations and reminders go out on their own." },
];

/** Which product fragment illustrates a feature (components/mocks/feature-mocks.tsx). */
export type FeatureVisual = "page" | "spaces" | "slot-guard" | "manage" | "embed" | "reminder" | "brand";
export type Feature = { visual: FeatureVisual; title: string; body: string };

/** Order is layout order: the bento in features.tsx spans by `visual`. */
export const FEATURES: Feature[] = [
  { visual: "page", title: "Hosted booking page", body: "A clean, mobile-first page at your own address. Nothing to install, nothing to host." },
  { visual: "spaces", title: "Spaces by the hour or night", body: "Rooms, studios and gear on the same page. Clients pick a window or a stay; units never double up." },
  { visual: "slot-guard", title: "Double-booking impossible", body: "Slots and units are guarded in the database. Two people can never take the same time." },
  { visual: "manage", title: "Self-serve cancel & reschedule", body: "Clients manage their booking from a secure link in the email. No back-and-forth." },
  { visual: "embed", title: "Embed on any site", body: "One script tag. The widget sits inside your page and grows with its content." },
  { visual: "reminder", title: "Automatic reminders", body: "A reminder goes out before every booking, so fewer no-shows." },
  { visual: "brand", title: "Your brand", body: "Logo, brand colour and a welcome message. The page looks like yours, not ours." },
];

export type FaqItem = { question: string; answer: string };

export const FAQ: FaqItem[] = [
  { question: "Do my clients need an account?", answer: "No. They pick a time, enter a name and email, and they're booked. Everything else happens through links in their confirmation email." },
  { question: "Can I embed it on my own website?", answer: "Yes. Copy one script tag from your dashboard and paste it into any page. The widget adjusts its height automatically." },
  { question: "Can I rent out a room, a studio or gear?", answer: "Yes. Next to appointments, Booklo books spaces (rooms, studios and gear) by the hour, night or day, from the same page. Each space has units, so two clients can never get the same room." },
  { question: "What happens if two people pick the same slot?", answer: "Only one booking can win. The other person sees that the slot was just taken and is offered fresh times, never a silent double booking." },
  { question: "How do clients cancel or reschedule?", answer: "Their confirmation email contains a secure manage link. From there they can cancel or pick another slot; you get notified either way." },
  { question: "What data do you store about my clients?", answer: "Name, email and an optional note, nothing else. No documents, no card numbers, no accounts." },
  // Same flag rule as SITE.heroNote: the paid answer names plans that cannot
  // be bought and points at a /pricing that 404s until FLAG_DEFAULTS.billing flips.
  {
    question: "What does it cost?",
    answer: BILLING_ON
      ? "Free for one person or one room: one bookable resource, three services, reminders for your first 30 bookings each month. Pro and Team add your brand, unlimited services and more bookable people and units; see Pricing."
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
  sub: "Free for one person or one room. Pay when you need your brand, unlimited services or more bookable resources.",
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
    { value: "both", title: "Both", blurb: SPACES.pickerBothBlurb },
  ],
  next: "Continue",
  back: "Back",
  skip: "Skip",
  submit: "Create workspace",
  /* The wizard steps after the org exists (features/orgs/onboarding-steps.ts).
     Field labels come from STARTER.firstService/firstSpace — same forms,
     same words. */
  wizard: {
    mode: { heading: "What are you booking?", sub: "You can change this any time in Settings." },
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
  subBoth: "Add what you offer and set hours — then share your link.",
  setHours: "Set hours",
  copyLink: "Copy link",
  copied: "Copied",
  noHandle: "Your workspace is ready.",
  noHandleSub: "Pick a page address and you're bookable.",
  setUpPage: "Set up your booking page",
  dismiss: "Dismiss",
} as const;

/** Words that must not appear in marketing copy: features not shipped yet
    (google / calendar sync / stripe / payment — the last two leave after H4)
    and the retired channel words (H5b: "Spaces" is the word; "rentals" plural
    is the old channel, "Gear rental" the business type stays legal). */
export const FORBIDDEN_COPY = ["google", "calendar sync", "stripe", "payment", "offering", "rentals"] as const;

/** Every internal href on the page (for route/anchor guard tests). `#` alone is a placeholder and skipped. */
export function allInternalHrefs(): string[] {
  const hrefs = [
    ...Object.values(SITE.links),
    ...NAV_LINKS.map((l) => l.href),
    ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
  ];
  return [...new Set(hrefs)].filter((h) => h !== "#");
}

/** Under each step: four specifics, as short as a label. Shown beside the
    step in how-it-works.tsx; indexed like STEPS. */
export const STEP_POINTS: readonly (readonly string[])[] = [
  ["Services with buffers", "Spaces with units", "Hours per person or room", "Price labels and terms"],
  ["booklo.co/your-name", "One script tag", "Per-person links", "Your logo and colour"],
  ["Confirmation to both", "Reminder before", "Self-serve reschedule", "Walk-ins by hand"],
];
