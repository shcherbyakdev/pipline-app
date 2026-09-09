// Marketing copy and links for the Booklo landing page. Plain data — no React —
// so it can be unit-tested and reused by every marketing component.

import { FLAG_DEFAULTS } from "@/lib/flags";
import { FOUNDER_PRICE_FACTOR, formatUsd, PLANS, type PlanId } from "@/lib/billing/plans";
import { SPACES } from "@/features/orgs/vocab";

const BILLING_ON = FLAG_DEFAULTS.billing; // no org on the marketing site: the environment default, by design

/* The landing sells Booklo to multi-room photo and content studios (roadmap
   2026-09-07, S9): rooms, the whole studio and shared gear booked from one
   page, prices computed from the studio's rules, deposits held and
   collected, changes and after-session charges settled on the same
   booking, and one morning list of what needs a human. The appointments
   channel runs but is not marketed here (it keeps one FAQ line). */
export const SITE = {
  name: "Booklo",
  tagline: "Booking software for multi-room studios",
  description:
    "Booklo is booking software for photo and content studios with more than one room. Clients book rooms, the whole studio or shared gear from one page. Booklo works out the price from your rules, takes the deposit, handles changes and overtime, and shows you what needs attention each morning.",
  headline: "Studio bookings, settled.",
  subheadline:
    "Clients book a room, the whole studio or gear. Booklo works out the price, takes the deposit and handles changes.",
  // Flag-conditional (lib/flags.ts): while billing is off there IS no paid
  // ladder to contrast a "Free plan" with, and /pricing 404s — so the note
  // says what is actually true today. Flipping the flag flips the copy.
  heroNote: BILLING_ON ? "Free plan · No credit card" : "Free during early access · No credit card",
  links: { home: "/", login: "/login", signup: "/signup", pricing: "/pricing", waitlist: "/waitlist" },
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
    heading: "Up and running in three steps",
    sub: "Nothing to install, no setup call.",
  },
  money: {
    heading: "The money stays with the booking.",
    sub: "Price, deposit, changes and extra charges all live on the same booking, under your rules. Scroll through one.",
  },
  compound: {
    heading: "Rooms, the whole studio, shared gear.",
    sub: "Sell them together. Booklo knows a whole-studio booking blocks every room, and that one lamp can only be in one room at a time.",
  },
  morning: {
    heading: "Every morning, one list.",
    sub: "Holds about to expire, requests to approve, balances to collect, changes to confirm. Emailed at 8:00 and on your phone.",
  },
  features: {
    heading: "Everything else a studio needs",
    sub: "Included from day one.",
  },
  faq: { heading: "Common questions" },
} as const;

/** The Premium section (spec 2026-09-01-premium-waitlist-design.md): while
    billing is off, the upgrade path is the waitlist, and the landing says
    so. The perks are Pro's limits in the customer's words; the one number
    reads from PLANS so it can never drift from the gate. Same flag rule as
    SITE.heroNote: once billing is live this section retires in favour of
    /pricing, and PREMIUM.shown says so. */
export const PREMIUM = {
  shown: !BILLING_ON,
  eyebrow: "Premium",
  heading: "Free while we build.",
  sub: "Every studio starts free. Join the Premium waitlist from your dashboard and get everything it unlocks now, at no cost.",
  perks: [
    `Up to ${PLANS.pro.limits.bookableResources} bookable rooms or units`,
    "Reminders for every booking",
    "No Booklo badge on your page",
  ],
  cta: "Join the waitlist",
  note: "Sign up or log in, then join from your dashboard.",
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

/** The claim bar (final CTA). The status line is assembled from these:
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

export const FINAL_CTA = {
  heading: "Claim your studio's page.",
  sub: "Pick a name, add your rooms, set your rules. You're bookable.",
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

/** The three steps: the title's first word is the verb. */
export type Step = { title: string; body: string };

export const STEPS: Step[] = [
  { title: "Add your rooms, gear and rules", body: "Rooms, whole-studio packages, shared equipment, prices, deposit and cancellation terms." },
  { title: "Share your page or embed it", body: "Every studio gets its own web address. One line of code puts the booking widget on your site." },
  { title: "Bookings run themselves", body: "Prices are worked out, deposits taken, changes repriced, overtime added. Each morning you see what still needs you." },
];

/** The money story (components/money.tsx): seven beats of one booking, read
    while the record beside them fills in. The chips are the terms a studio
    would publish. Sample values only. */
export type MoneyStep = { title: string; body: string; chips?: readonly string[] };
export const MONEY_STEPS: readonly MoneyStep[] = [
  { title: "Priced", body: "Room, duration, people and extras. The price comes from your rules and the client sees it before booking.", chips: ["2 h+ tier", "Weekend", "+2 people", "Profoto kit"] },
  { title: "Held", body: "A hold keeps the slot until your deadline. If the deposit doesn't arrive, the hold expires and the slot opens again.", chips: ["30% deposit", "4 h to pay"] },
  { title: "Paid", body: "The deposit arrives and the booking is confirmed. The money goes to your own account, not through Booklo." },
  { title: "Moved", body: "The client changes the date. Your cancellation tiers set the fee, and both of you see the new total.", chips: ["72 h free", "48 h 50%", "24 h 100%"] },
  { title: "Overtime", body: "The session runs long. The extra half hour is added to the same booking at your overtime rate." },
  { title: "Balance", body: "Everything after the deposit becomes one balance, with one link to pay it." },
  { title: "Collected", body: "Paid online, in cash, or written off. The record closes either way." },
] as const;

/** The features grid: six things included from day one, one icon each
    (components/features.tsx maps `icon` to a glyph). */
export type FeatureIcon = "no-account" | "guard" | "approve" | "notify" | "language" | "embed";
export type Feature = { icon: FeatureIcon; title: string; body: string };

export const FEATURES: Feature[] = [
  { icon: "no-account", title: "No client accounts", body: "Clients book from a link with their name and email. Everything else happens through links in their confirmation email." },
  { icon: "guard", title: "Double-booking impossible", body: "Rooms, the whole studio and shared gear are locked in the database. Two clients can never get the same hour." },
  { icon: "approve", title: "Requests you approve", body: "Events, big groups, unusual shoots: mark them as requests and they wait for your yes." },
  { icon: "notify", title: "Email and push", body: "Confirmations, reminders, expiring holds and the morning digest, by email and on your phone." },
  { icon: "language", title: "Polish and English", body: "Your page and every client email in the client's language. Your dashboard in yours." },
  { icon: "embed", title: "Embed anywhere", body: "One line of code puts the booking widget on your site. Page and widget templates match your brand." },
];

export type FaqItem = { question: string; answer: string };

export const FAQ: FaqItem[] = [
  { question: "Do my clients need an account?", answer: "No. They pick a room and a time, enter their name and email, pay the deposit and they're booked. Everything else happens through links in their confirmation email." },
  { question: "How does the deposit work?", answer: "You set the amount and the deadline. A hold keeps the slot while the client pays online. If the deadline passes, the hold expires and the slot opens again. Deposits go to your own account; Booklo never holds client money." },
  { question: "Can I rent the whole studio, or a room plus equipment?", answer: "Yes. A whole-studio booking blocks every room in it. Shared gear like a lamp or a backdrop is booked together with the room, each with its own price line." },
  { question: "What happens after the session?", answer: "Overtime, extra people, cleaning or damage are added to the same booking. The client gets one balance to pay online, or you settle it in cash or write it off." },
  { question: "What if a client moves or cancels?", answer: "Your tiers decide. For example: free until 72 hours before, half after that, the full amount inside 24 hours. The price and any refund are recalculated and both of you see the result." },
  { question: "What if two clients want the same room or lamp?", answer: "Only one booking can win. The other client sees the slot was just taken and gets fresh times. There is never a silent double booking." },
  { question: "Does it work in Polish?", answer: "Yes. Your page, the widget and every client email come in Polish or English, per client. Your dashboard is in the language you choose." },
  { question: "I also sell sessions with our photographer. Can I book those?", answer: "Yes. Booklo also has an appointments mode for booking a person's time, with the same page and widget. A workspace runs one mode or the other." },
  { question: "What data do you store about my clients?", answer: "Name, email and an optional note, nothing else. No documents, no card numbers, no accounts." },
  // Same flag rule as SITE.heroNote: the paid answer names plans that cannot
  // be bought and points at a /pricing that 404s until FLAG_DEFAULTS.billing flips.
  {
    question: "What does it cost?",
    answer: BILLING_ON
      ? "Free for you and one more person, or two rooms: two bookable resources, reminders for your first 30 bookings each month, unlimited services. Pro and Team add your brand, reminders for every booking and more bookable people and units; see Pricing."
      : "Booklo is free while we're in early access. Premium is coming: join the waitlist from your dashboard and use everything it unlocks now, at no cost. We'll announce pricing well before anything changes.",
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

/** Every internal href on the page (for route/anchor guard tests). `#` alone is a placeholder and skipped. */
export function allInternalHrefs(): string[] {
  const hrefs = [
    ...Object.values(SITE.links),
    ...NAV_LINKS.map((l) => l.href),
    ...FOOTER_COLUMNS.flatMap((c) => c.links.map((l) => l.href)),
  ];
  return [...new Set(hrefs)].filter((h) => h !== "#");
}
