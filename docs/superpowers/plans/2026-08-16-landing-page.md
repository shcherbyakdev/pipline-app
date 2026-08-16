# Booklo Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stale root page with a light, minimal, Mollie-style marketing landing page for **Booklo** (booking page + embeddable widget for solo providers), per spec `docs/superpowers/specs/2026-08-16-landing-page-design.md`.

**Architecture:** New `src/app/(marketing)/` route group serving `/` with its own layout (metadata + `.light` token scope); all copy as typed data in `src/features/marketing/site.ts`; presentational server components in `src/features/marketing/components/`; three static "live-coded" product mocks under `components/mocks/`. Zero client components (FAQ uses native `<details>`).

**Tech Stack:** Next.js App Router (this Next has breaking changes — READ `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md` §Route groups and `14-metadata-and-og-images.md` before touching `src/app`), Tailwind v4 with the repo's oklch tokens in `src/app/globals.css`, `src/components/ui/button.tsx` (`buttonVariants` for link-styled buttons), `lucide-react` icons, Vitest (node env, `npm run test`).

**Spec:** `docs/superpowers/specs/2026-08-16-landing-page-design.md`

## Global Constraints

- Work on branch `worktree-landing-page` in the worktree at `.claude/worktrees/landing-page` (already created; based on `main` after PR #25). Do not touch the S3 branch or the root `src/app/layout.tsx`.
- Product name is **Booklo**, referenced only via `SITE.name` from `site.ts` — never hard-coded in component JSX.
- Primary CTA is sign-up (`/signup`); secondary auth link is `/login`. Anchors: `#how-it-works`, `#features`, `#faq`.
- **No social proof** (no logos, testimonials, stats). **No unshipped features**: nothing on the page mentions Google / calendar sync / payments.
- Landing is **light-only**: components use design tokens only (`bg-background`, `text-foreground`, `text-muted-foreground`, `bg-card`, `border-border`, `bg-primary`, `text-primary`, `bg-muted`) and **no `dark:` utilities**. `Button` variants allowed: `default`, `ghost`, `secondary` (their `dark:` overrides are harmless). Do not use `outline`.
- Link-styled buttons follow the repo idiom: `<Link href="…" className={cn(buttonVariants({ variant, size }))}>` (see `src/app/(dashboard)/bookings/page.tsx:34`).
- Mocks are decorative: root element has `aria-hidden="true"`; no information lives only inside a mock.
- Visual language: 8–12px radii (`rounded-lg`/`rounded-xl`), hairline `border-border`, no gradients, no heavy shadows, teal `--primary` is the single accent, `max-w-6xl` content width, section spacing `py-20 md:py-28`.
- Run `npm run verify` (lint + typecheck + unit tests) before every commit. After the final task run `graphify update .`.
- Commit messages: conventional prefix, end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Site config as typed data + guard tests

**Files:**
- Create: `src/features/marketing/site.ts`
- Test: `src/features/marketing/site.test.ts`

**Interfaces:**
- Produces (used by every later task):
  ```ts
  export const SITE: { name: string; tagline: string; description: string; headline: string; subheadline: string; heroNote: string; eyebrow: string; links: { login: "/login"; signup: "/signup"; home: "/" }; anchors: { how: "#how-it-works"; features: "#features"; faq: "#faq" } };
  export type NavLink = { label: string; href: string };
  export const NAV_LINKS: NavLink[];
  export type Step = { number: "01" | "02" | "03"; title: string; body: string };
  export const STEPS: Step[];
  export type FeatureIcon = "globe" | "code" | "calendar-check" | "refresh" | "bell" | "palette";
  export type Feature = { icon: FeatureIcon; title: string; body: string };
  export const FEATURES: Feature[];
  export type FaqItem = { question: string; answer: string };
  export const FAQ: FaqItem[];
  export type FooterColumn = { heading: string; links: NavLink[] };
  export const FOOTER_COLUMNS: FooterColumn[];
  export const FORBIDDEN_COPY: readonly string[]; // words that must not appear (unshipped features)
  export function allInternalHrefs(): string[]; // every href from NAV_LINKS, SITE.links, FOOTER_COLUMNS
  ```

- [ ] **Step 1: Write the failing tests**

`src/features/marketing/site.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  SITE,
  NAV_LINKS,
  STEPS,
  FEATURES,
  FAQ,
  FOOTER_COLUMNS,
  FORBIDDEN_COPY,
  allInternalHrefs,
} from "./site";

// Route hrefs → the app directory that must exist for them (route groups omitted from URL).
const ROUTE_DIRS: Record<string, string> = {
  "/": "src/app/(marketing)",
  "/login": "src/app/(auth)/login",
  "/signup": "src/app/(auth)/signup",
};

describe("site config", () => {
  it("names the product Booklo", () => {
    expect(SITE.name).toBe("Booklo");
  });

  it("every internal href is an in-page anchor or an existing route", () => {
    for (const href of allInternalHrefs()) {
      if (href.startsWith("#")) continue;
      const dir = ROUTE_DIRS[href];
      expect(dir, `no route mapping for ${href}`).toBeDefined();
      expect(existsSync(join(process.cwd(), dir, "page.tsx")), `${dir}/page.tsx missing`).toBe(true);
    }
  });

  it("anchors used in nav exist as section ids", () => {
    const anchors = Object.values(SITE.anchors);
    for (const l of NAV_LINKS) expect(anchors).toContain(l.href);
  });

  it("has three numbered steps, six unique features, ≥5 FAQ items", () => {
    expect(STEPS.map((s) => s.number)).toEqual(["01", "02", "03"]);
    expect(FEATURES).toHaveLength(6);
    expect(new Set(FEATURES.map((f) => f.title)).size).toBe(6);
    expect(FAQ.length).toBeGreaterThanOrEqual(5);
    expect(new Set(FAQ.map((f) => f.question)).size).toBe(FAQ.length);
  });

  it("never advertises unshipped features", () => {
    const corpus = [
      SITE.headline, SITE.subheadline, SITE.tagline, SITE.description, SITE.heroNote,
      ...STEPS.flatMap((s) => [s.title, s.body]),
      ...FEATURES.flatMap((f) => [f.title, f.body]),
      ...FAQ.flatMap((f) => [f.question, f.answer]),
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });

  it("headline is short and outcome-led (≤ 8 words)", () => {
    expect(SITE.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/marketing/site.test.ts`
Expected: FAIL — `Cannot find module './site'`.

- [ ] **Step 3: Write `site.ts`**

```ts
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
  { question: "What data do you store about my clients?", answer: "Name, email and an optional note — nothing else. No documents, no payment details, no accounts." },
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
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/marketing/site.test.ts`
Expected: the "existing route" test FAILS only on `/` (`src/app/(marketing)/page.tsx` missing) — every other test PASSES. That one failure is expected until Task 2; do not weaken the test.

- [ ] **Step 5: Commit (test intentionally red on the `/` route only)**

```bash
git add src/features/marketing/site.ts src/features/marketing/site.test.ts
git commit -m "feat: landing — Booklo site copy/config with guard tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Route group, light token scope, metadata; delete stale root page

**Files:**
- Create: `src/app/(marketing)/layout.tsx`, `src/app/(marketing)/page.tsx`
- Delete: `src/app/page.tsx`
- Modify: `src/app/globals.css` (add `.light` block after the `.dark` block, before `@layer base`)

**Interfaces:**
- Produces: `/` route rendering inside `<div class="light …">`; `page.tsx` renders `<Hero />` etc. in later tasks — for now a placeholder H1 from `SITE.headline`.

- [ ] **Step 1: Add the `.light` token scope**

In `src/app/globals.css`, immediately after the closing `}` of the `.dark { … }` block, add a block that mirrors `:root` exactly (copy the values from the `:root` block in the same file — they must stay identical to `:root`):

```css
/* Light scope for surfaces rendered under the dark <html> (marketing landing).
   Custom properties resolve from the nearest ancestor, so this wins over
   `.dark` on <html> regardless of specificity. Keep in sync with :root. */
.light {
  color-scheme: light;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.62 0.12 187);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}
```
(Sidebar/chart/status tokens are not used by the landing; omit them.)

- [ ] **Step 2: Create the marketing layout**

`src/app/(marketing)/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { SITE } from "@/features/marketing/site";

export const metadata: Metadata = {
  title: `${SITE.name} — ${SITE.tagline}`,
  description: SITE.description,
  openGraph: {
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    type: "website",
  },
};

export default function MarketingLayout({ children }: LayoutProps<"/">) {
  // `.light` re-declares the design tokens so the landing renders light
  // beneath the app's dark <html>. Landing components use tokens only and
  // never `dark:` utilities (see spec: Theme scoping).
  return (
    <div className="light bg-background text-foreground flex min-h-full flex-1 flex-col">
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Create the page (placeholder body) and delete the stale root page**

`src/app/(marketing)/page.tsx`:
```tsx
import { SITE } from "@/features/marketing/site";

export default function LandingPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-24">
      <h1 className="text-5xl font-semibold tracking-tight">{SITE.headline}</h1>
    </main>
  );
}
```
Then: `git rm src/app/page.tsx`

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: lint/typecheck pass; all `site.test.ts` tests now PASS (the `/` route exists).
Run: `npx next build 2>&1 | tail -20`
Expected: build succeeds; route table lists `○ /` once (no "two parallel pages resolve to /" error).
Run the dev server (`npm run dev`) and open `http://localhost:3000/` — page background is white with dark text (light scope works under the dark html), headline visible. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css "src/app/(marketing)" && git rm -q src/app/page.tsx
git commit -m "feat: landing — (marketing) route group, light token scope, metadata; drop stale root page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Nav and footer

**Files:**
- Create: `src/features/marketing/components/marketing-nav.tsx`, `src/features/marketing/components/marketing-footer.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `SITE`, `NAV_LINKS`, `FOOTER_COLUMNS` from `site.ts`; `buttonVariants` from `@/components/ui/button`; `cn` from `@/lib/utils`.
- Produces: `<MarketingNav />`, `<MarketingFooter />` (no props).

- [ ] **Step 1: Nav**

`marketing-nav.tsx`:
```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE } from "@/features/marketing/site";

export function MarketingNav() {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href={SITE.links.home} className="text-lg font-semibold tracking-tight">
          {SITE.name}
        </Link>
        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link href={SITE.links.login} className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
            Log in
          </Link>
          <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "px-4")}>
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 2: Footer**

`marketing-footer.tsx`:
```tsx
import Link from "next/link";
import { FOOTER_COLUMNS, SITE } from "@/features/marketing/site";

export function MarketingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <p className="text-lg font-semibold tracking-tight">{SITE.name}</p>
          <p className="text-muted-foreground mt-2 max-w-xs text-sm">{SITE.tagline}</p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.heading}>
            <p className="text-sm font-medium">{col.heading}</p>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith("#") ? (
                    <a href={l.href} className="text-muted-foreground hover:text-foreground text-sm">{l.label}</a>
                  ) : (
                    <Link href={l.href} className="text-muted-foreground hover:text-foreground text-sm">{l.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-6xl px-6 pb-8">
        <p className="text-muted-foreground text-xs">© 2026 {SITE.name}</p>
      </div>
    </footer>
  );
}
```
Note: `Link` typed routes may reject `"#"`; that's why placeholder/anchor hrefs use a plain `<a>`.

- [ ] **Step 3: Wire into the page**

`src/app/(marketing)/page.tsx`:
```tsx
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { SITE } from "@/features/marketing/site";

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-6xl px-6 py-24">
          <h1 className="text-5xl font-semibold tracking-tight">{SITE.headline}</h1>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
```

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: sticky nav with wordmark/links/buttons, footer columns render; below 768px the anchor links hide, the two buttons remain.

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — sticky nav and footer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Hero + booking-card mock

**Files:**
- Create: `src/features/marketing/components/mocks/booking-card-mock.tsx`, `src/features/marketing/components/hero.tsx`
- Modify: `src/app/(marketing)/page.tsx` (replace placeholder section with `<Hero />`)

**Interfaces:**
- Produces: `<Hero />`, `<BookingCardMock />` (no props, server components).

- [ ] **Step 1: Booking-card mock** — a static, three-panel impression of the real `/book/[handle]` flow (service → date/slot → confirm), tokens only, decorative:

`mocks/booking-card-mock.tsx`:
```tsx
import { Check } from "lucide-react";

const SERVICES = [
  { name: "Intro call", meta: "30 min · Free" },
  { name: "Consultation", meta: "60 min · €80" },
];
const DAYS = ["Mon 18", "Tue 19", "Wed 20", "Thu 21", "Fri 22"];
const SLOTS = ["09:00", "09:30", "10:30", "11:00", "14:00", "15:30"];

export function BookingCardMock() {
  return (
    <div aria-hidden="true" className="bg-card w-full max-w-md rounded-xl border p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="bg-primary/15 text-primary flex size-9 items-center justify-center rounded-lg text-sm font-semibold">A</div>
        <div>
          <p className="text-sm font-medium leading-tight">Anna Kovač — Coaching</p>
          <p className="text-muted-foreground text-xs">Times shown in your timezone</p>
        </div>
      </div>

      <div className="mt-5 space-y-2">
        {SERVICES.map((s, i) => (
          <div
            key={s.name}
            className={
              i === 1
                ? "border-primary bg-primary/5 flex items-center justify-between rounded-lg border px-3 py-2"
                : "flex items-center justify-between rounded-lg border px-3 py-2"
            }
          >
            <span className="text-sm font-medium">{s.name}</span>
            <span className="text-muted-foreground text-xs">{s.meta}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-5 gap-1">
        {DAYS.map((d, i) => (
          <div
            key={d}
            className={
              i === 2
                ? "bg-primary text-primary-foreground rounded-md py-1.5 text-center text-xs font-medium"
                : "bg-muted rounded-md py-1.5 text-center text-xs"
            }
          >
            {d}
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {SLOTS.map((t, i) => (
          <div
            key={t}
            className={
              i === 3
                ? "border-primary text-primary rounded-md border py-1.5 text-center text-xs font-medium"
                : "rounded-md border py-1.5 text-center text-xs"
            }
          >
            {t}
          </div>
        ))}
      </div>

      <div className="bg-primary text-primary-foreground mt-5 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium">
        <Check className="size-4" /> Confirm Wed 20 · 11:00
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Hero**

`hero.tsx`:
```tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SITE } from "@/features/marketing/site";
import { BookingCardMock } from "./mocks/booking-card-mock";

export function Hero() {
  return (
    <section aria-labelledby="hero-heading" className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-20 pb-24 md:pt-28 lg:grid-cols-2">
      <div className="max-w-xl">
        <p className="text-primary text-sm font-medium">{SITE.eyebrow}</p>
        <h1 id="hero-heading" className="mt-4 text-4xl font-semibold tracking-tight text-balance md:text-6xl">
          {SITE.headline}
        </h1>
        <p className="text-muted-foreground mt-6 text-lg text-pretty">{SITE.subheadline}</p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>
            Get started free
          </Link>
          <a href={SITE.anchors.how} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-4 text-base")}>
            See how it works <ArrowRight className="size-4" />
          </a>
        </div>
        <p className="text-muted-foreground mt-4 text-sm">{SITE.heroNote}</p>
      </div>
      <div className="flex justify-center lg:justify-end">
        <BookingCardMock />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into page** — replace the placeholder `<section>` in `src/app/(marketing)/page.tsx` with `<Hero />` (import from `@/features/marketing/components/hero`); the `SITE` import in page.tsx becomes unused — remove it.

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: two-column hero ≥1024px, stacked below; mock renders light with teal accents; both CTAs keyboard-focusable with a visible ring.

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — hero with booking-page mock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: How-it-works steps + feature grid

**Files:**
- Create: `src/features/marketing/components/how-it-works.tsx`, `src/features/marketing/components/feature-grid.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `STEPS`, `FEATURES`, `FeatureIcon`, `SITE.anchors`.
- Produces: `<HowItWorks />` (section id `how-it-works`), `<FeatureGrid />` (section id `features`).

- [ ] **Step 1: How it works**

`how-it-works.tsx`:
```tsx
import { STEPS } from "@/features/marketing/site";

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <h2 id="how-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">How it works</h2>
        <p className="text-muted-foreground mt-3 max-w-xl">Three steps from sign-up to your first booking.</p>
        <ol className="mt-12 grid gap-10 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.number}>
              <span className="text-primary font-mono text-sm font-medium">{s.number}</span>
              <h3 className="mt-3 text-lg font-medium">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Feature grid** (icon map lives here, so `site.ts` stays React-free)

`feature-grid.tsx`:
```tsx
import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarCheck, CodeXml, Globe, Palette, RefreshCw } from "lucide-react";
import { FEATURES, type FeatureIcon } from "@/features/marketing/site";

const ICONS: Record<FeatureIcon, LucideIcon> = {
  globe: Globe,
  code: CodeXml,
  "calendar-check": CalendarCheck,
  refresh: RefreshCw,
  bell: BellRing,
  palette: Palette,
};

export function FeatureGrid() {
  return (
    <section id="features" aria-labelledby="features-heading" className="bg-muted/40 scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <h2 id="features-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Everything a booking page should do</h2>
        <p className="text-muted-foreground mt-3 max-w-xl">Nothing you have to configure twice.</p>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon];
            return (
              <li key={f.title} className="bg-card rounded-xl border p-6">
                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{f.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into page** after `<Hero />`: `<HowItWorks />`, `<FeatureGrid />`.

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: clicking "How it works" in nav scrolls so the heading sits below the sticky nav (`scroll-mt-20`); grid 1/2/3 columns.

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — how-it-works steps and feature grid

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Product showcase + calendar mock

**Files:**
- Create: `src/features/marketing/components/mocks/calendar-mock.tsx`, `src/features/marketing/components/product-showcase.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Produces: `<ProductShowcase />`, `<CalendarMock />`.

- [ ] **Step 1: Calendar mock** — a static Mon–Fri, 09:00–17:00 grid with four bookings and one blocked range, absolutely positioned by hour; tokens only.

`mocks/calendar-mock.tsx`:
```tsx
const DAYS = ["Mon 18", "Tue 19", "Wed 20", "Thu 21", "Fri 22"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16]; // 09:00–17:00
const ROW = 2.25; // rem per hour

type Item = { day: number; start: number; end: number; title: string; who?: string; kind: "booking" | "blocked" };
const ITEMS: Item[] = [
  { day: 0, start: 9.5, end: 10.5, title: "Consultation", who: "Mia Novak", kind: "booking" },
  { day: 1, start: 11, end: 11.5, title: "Intro call", who: "Tom Reyes", kind: "booking" },
  { day: 2, start: 14, end: 15, title: "Consultation", who: "Priya Nair", kind: "booking" },
  { day: 3, start: 12, end: 13, title: "Blocked", kind: "blocked" },
  { day: 4, start: 10, end: 11, title: "Consultation", who: "Jonas Berg", kind: "booking" },
];

export function CalendarMock() {
  const gridHeight = `${HOURS.length * ROW}rem`;
  return (
    <div aria-hidden="true" className="bg-card overflow-hidden rounded-xl border text-xs">
      <div className="grid grid-cols-[3rem_repeat(5,1fr)] border-b">
        <div />
        {DAYS.map((d, i) => (
          <div key={d} className={i === 2 ? "text-primary py-2 text-center font-medium" : "text-muted-foreground py-2 text-center"}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[3rem_repeat(5,1fr)]" style={{ height: gridHeight }}>
        <div className="relative">
          {HOURS.map((h, i) => (
            <span key={h} className="text-muted-foreground absolute right-2 -translate-y-1/2" style={{ top: `${i * ROW}rem` }}>
              {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {DAYS.map((_, day) => (
          <div key={day} className="relative border-l">
            {HOURS.map((h, i) => (
              <div key={h} className="absolute inset-x-0 border-t" style={{ top: `${i * ROW}rem` }} />
            ))}
            {ITEMS.filter((it) => it.day === day).map((it) => (
              <div
                key={it.title + it.start}
                className={
                  it.kind === "blocked"
                    ? "bg-muted text-muted-foreground absolute inset-x-1 rounded-md border border-dashed px-2 py-1"
                    : "bg-primary/10 text-foreground border-primary absolute inset-x-1 rounded-md border-l-2 px-2 py-1"
                }
                style={{ top: `${(it.start - HOURS[0]) * ROW}rem`, height: `${(it.end - it.start) * ROW}rem` }}
              >
                <p className="truncate font-medium">{it.title}</p>
                {it.who ? <p className="text-muted-foreground truncate">{it.who}</p> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Product showcase**

`product-showcase.tsx`:
```tsx
import { Check } from "lucide-react";
import { CalendarMock } from "./mocks/calendar-mock";

const POINTS = [
  "See every booking for the week at a glance",
  "Block time off with a drag — clients never see it",
  "Add walk-in or phone bookings in seconds",
];

export function ProductShowcase() {
  return (
    <section aria-labelledby="product-heading" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 md:py-28">
        <div className="max-w-xl">
          <h2 id="product-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Your week, at a glance</h2>
          <p className="text-muted-foreground mt-3">One calendar for everything that's booked, blocked or free.</p>
        </div>
        <div className="mt-10">
          <CalendarMock />
        </div>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-3 text-sm">
              <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into page** after `<FeatureGrid />`.

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: bookings sit at the right hours; on a 375px viewport the grid still fits (text-xs, no horizontal page scroll — if it overflows, wrap the mock in `overflow-x-auto`).

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — product showcase with week-calendar mock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Embed showcase + snippet mock

**Files:**
- Create: `src/features/marketing/components/mocks/embed-snippet-mock.tsx`, `src/features/marketing/components/embed-showcase.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Produces: `<EmbedShowcase />`, `<EmbedSnippetMock />`.

- [ ] **Step 1: Snippet mock** (illustrative snippet, not a real domain; a `<pre>` styled like a code card, decorative)

`mocks/embed-snippet-mock.tsx`:
```tsx
const LINES = [
  `<div id="booklo-widget"></div>`,
  `<script src="https://booklo.example/embed.js"`,
  `        data-handle="anna-kovac" async></script>`,
];

export function EmbedSnippetMock() {
  return (
    <div aria-hidden="true" className="bg-card overflow-hidden rounded-xl border">
      <div className="flex items-center gap-1.5 border-b px-4 py-2.5">
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        <span className="text-muted-foreground ml-2 text-xs">index.html</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6">
        {LINES.map((l, i) => (
          <div key={i} className="flex">
            <span className="text-muted-foreground w-6 shrink-0 select-none">{i + 1}</span>
            <span>{l}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Embed showcase**

`embed-showcase.tsx`:
```tsx
import { EmbedSnippetMock } from "./mocks/embed-snippet-mock";

export function EmbedShowcase() {
  return (
    <section aria-labelledby="embed-heading" className="bg-muted/40 border-t">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 md:py-28 lg:grid-cols-2">
        <div className="max-w-xl">
          <h2 id="embed-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Paste one line. The widget resizes itself.</h2>
          <p className="text-muted-foreground mt-4 leading-relaxed">
            Drop the snippet into any website builder or plain HTML page. The booking widget loads inside your page,
            adjusts its own height as clients move through the steps, and never asks them to leave your site.
          </p>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            Prefer a link? The same page works standalone at your own handle — share it in email, on social, or in your bio.
          </p>
        </div>
        <EmbedSnippetMock />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into page** after `<ProductShowcase />`.

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: two columns ≥1024px; snippet scrolls horizontally inside its card on narrow widths, page never scrolls sideways.

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — embed showcase with snippet mock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: FAQ + final CTA

**Files:**
- Create: `src/features/marketing/components/faq.tsx`, `src/features/marketing/components/final-cta.tsx`
- Modify: `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `FAQ`, `SITE`.
- Produces: `<Faq />` (section id `faq`), `<FinalCta />`.

- [ ] **Step 1: FAQ with native disclosure**

`faq.tsx`:
```tsx
import { ChevronDown } from "lucide-react";
import { FAQ } from "@/features/marketing/site";

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 border-t">
      <div className="mx-auto w-full max-w-3xl px-6 py-20 md:py-28">
        <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">Questions, answered</h2>
        <div className="mt-10 divide-y border-y">
          {FAQ.map((item) => (
            <details key={item.question} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {item.question}
                <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Final CTA**

`final-cta.tsx`:
```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SITE } from "@/features/marketing/site";

export function FinalCta() {
  return (
    <section aria-labelledby="cta-heading" className="bg-muted/40 border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 text-center md:py-28">
        <h2 id="cta-heading" className="text-3xl font-semibold tracking-tight text-balance md:text-5xl">{SITE.headline}</h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-md">{SITE.heroNote}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-base")}>
            Get started free
          </Link>
          <Link href={SITE.links.login} className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "h-11 px-4 text-base")}>
            Log in
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Wire into page** — final order in `src/app/(marketing)/page.tsx`:
```tsx
<MarketingNav />
<main className="flex-1">
  <Hero />
  <HowItWorks />
  <FeatureGrid />
  <ProductShowcase />
  <EmbedShowcase />
  <Faq />
  <FinalCta />
</main>
<MarketingFooter />
```

- [ ] **Step 4: Verify** — `npm run verify` green; dev server: `<details>` toggles by mouse and by Enter/Space on the focused summary; chevron rotates; only one `<h1>` on the page (`document.querySelectorAll("h1").length === 1` in the console).

- [ ] **Step 5: Commit**

```bash
git add src/features/marketing/components "src/app/(marketing)/page.tsx"
git commit -m "feat: landing — FAQ (native details) and final CTA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Visual QA, polish pass, build, graph update

**Files:**
- Modify: any `src/features/marketing/**` file that QA reveals needs a tweak; `docs/superpowers/plans/2026-08-16-landing-page.md` (execution-deviations appendix if any)

- [ ] **Step 1: Load the `frontend-design` skill** and review the rendered page against the spec's Visual style section: type scale (H1 ~56–64px desktop), spacing rhythm, single teal accent, hairline borders, no default-looking template feel. Make targeted class-level tweaks only; do not add libraries, gradients, or animations.

- [ ] **Step 2: Screenshots** — start `npm run dev`; capture `/` at 1440×900 and 390×844 (use the `run` skill / a browser). Check: light rendering under the dark html (no dark patches from `dark:` utilities — grep `src/features/marketing` for `dark:` and remove any hits), no horizontal page scroll on mobile, sticky nav doesn't cover anchor targets, focus rings visible tabbing nav → hero CTAs → FAQ summaries → footer links.

- [ ] **Step 3: Contrast** — with the light tokens, `text-muted-foreground` (oklch 0.556) on white is ~4.6:1; keep body copy at ≥14px. Step numerals in `text-primary` on white are decorative labels beside a black title, acceptable.

- [ ] **Step 4: Full verification**

Run: `npm run verify` — Expected: lint clean, typecheck clean, all unit tests pass (`site.test.ts` included).
Run: `npx next build 2>&1 | tail -20` — Expected: success; `/` is static (`○`).
Run: `grep -rn "dark:" src/features/marketing "src/app/(marketing)"` — Expected: no output.
Run: `grep -rni "google\|stripe" src/features/marketing "src/app/(marketing)"` — Expected: no output.

- [ ] **Step 5: Graph + commit**

```bash
graphify update .
git add -A
git commit -m "feat: landing — visual QA polish; graph update

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Record deviations** — if any step above diverged from the spec (e.g. an `overflow-x-auto` wrapper on the calendar mock, copy tweaks), append an "Execution deviations" section to this plan and commit it (`docs: landing plan — record execution deviations`).

---

## Self-review (done while writing)

- **Spec coverage:** routing/deletion (T2), light scope + metadata (T2), site data (T1), nav (T3), hero + booking mock (T4), how-it-works + features (T5), product module + calendar mock (T6), embed module + snippet mock (T7), FAQ + final CTA (T8), footer (T3), tests/verify/build/visual QA (T1, T9), a11y (`aria-labelledby`, `scroll-mt-20`, `aria-hidden` mocks, single h1) across tasks, out-of-scope items untouched.
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `SITE.links.{home,login,signup}`, `SITE.anchors.{how,features,faq}`, `FeatureIcon` union values match the `ICONS` map keys in T5, section ids match `SITE.anchors`, component names match their imports in T8's final page listing.
