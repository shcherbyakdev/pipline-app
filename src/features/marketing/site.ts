// Marketing copy and links for the Booklo landing page. Plain data — no React —
// so it can be unit-tested and reused by every marketing component.

export const SITE = {
  name: "Booklo",
  tagline: "Booking page & widget for solo providers",
  description:
    "Booklo gives freelancers and small businesses a hosted booking page and an embeddable widget. Clients book without an account; confirmations, reminders and rescheduling are handled for you.",
  eyebrow: "Scheduling for solo providers",
  headline: "Let clients book you in seconds.",
  subheadline:
    "A booking page and embeddable widget for solo providers. No client accounts, no double bookings — confirmations, reminders and rescheduling handled for you.",
  heroNote: "Free during early access · No credit card",
  links: { home: "/", login: "/login", signup: "/signup" },
  anchors: { how: "#how-it-works", features: "#features", faq: "#faq" },
} as const;

export type NavLink = { label: string; href: string };

export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: SITE.anchors.how },
  { label: "Features", href: SITE.anchors.features },
  { label: "FAQ", href: SITE.anchors.faq },
];

export type Step = { number: "01" | "02" | "03"; title: string; body: string };

export const STEPS: Step[] = [
  {
    number: "01",
    title: "Set your services and weekly hours",
    body: "Add what you offer, how long it takes and when you're available. Buffers, notice and daily limits are one setting each.",
  },
  {
    number: "02",
    title: "Share your link or embed the widget",
    body: "Every account gets a hosted booking page. Paste one line to embed it on your own site — it resizes itself.",
  },
  {
    number: "03",
    title: "Clients pick a slot; you both get confirmations",
    body: "They see only the times that are really free. Confirmation and reminder emails go out automatically.",
  },
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
  { question: "What does it cost?", answer: "Booklo is free during early access. We'll announce pricing well before anything changes, and early users will hear first." },
];

export type FooterColumn = { heading: string; links: NavLink[] };

export const FOOTER_COLUMNS: FooterColumn[] = [
  { heading: "Product", links: NAV_LINKS },
  {
    heading: "Account",
    links: [
      { label: "Log in", href: SITE.links.login },
      { label: "Sign up", href: SITE.links.signup },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

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
