# Booklo Landing Page — Design

**Date:** 2026-08-16
**Status:** Approved (brainstorm with Andrii)
**Branch:** `worktree-landing-page` (worktree, based on `main` after PR #25). Independent of the S3 branch.

## Goal

Replace the stale root page (`src/app/page.tsx`, "RolloutOS — One workflow. Hundreds of locations.") with a marketing landing page for **Booklo**, the scheduling product: a booking page + embeddable widget for solo providers and their clients. Minimal, clear, self-explanatory, styled after the reference set — mollie.com (closest), qount.io, provet.com, ruul.io — and following SaaS landing best practices (short outcome-led headline, product visible above the fold, one primary CTA chosen by time-to-value, plain-language copy).

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Product name | **Booklo** — held in one config constant, not scattered in copy |
| Primary CTA | **Sign up** (`/signup`) — value is reachable in minutes, so no demo path |
| Product visuals | **Live-coded mock components** (static React "screenshots" built with the app's design tokens); no PNG assets |
| Social proof | **Omitted entirely** — no logos, quotes, or stats until real ones exist |
| Theme | **Light-only** landing (all references are light); the app remains dark |
| Unshipped features | **Not advertised.** Google Calendar sync (S4) is absent from the page |
| Pricing copy | FAQ states "free during early access"; no pricing section |

## Reference synthesis

Common shape across the four references (Mollie weighted most):

- Sticky, minimal nav: wordmark, 3–4 anchor links, ghost login + primary CTA.
- Hero: benefit headline under ~8 words, one-sentence sub, dual CTAs (primary + explore), and a **real product mockup** card beside the copy.
- Numbered 3-step "how it works".
- Feature cards: subtle 8–12px radii, hairline borders, generous whitespace, no gradients or heavy shadows.
- One full-width product/dashboard module.
- FAQ, then a final CTA repeating the headline, then a multi-column footer.

Best-practice sources consulted: Studio Maydit (2026 landing best practices), Alf Design Group (hero sections), Orbix (SaaS website practices), Veza Digital (examples). Headline < 8 words; product above the fold; single-path primary CTA; 5th–7th grade reading level; social proof only when genuine.

## Architecture

### Routing

- New route group `src/app/(marketing)/` containing `layout.tsx` and `page.tsx`. The route group serves `/`.
- **Delete** `src/app/page.tsx` (route conflict otherwise; it is the stale stub).
- The marketing `layout.tsx` exports its own `metadata` (title `Booklo — Booking page & widget for solo providers`, description, OpenGraph title/description/type). The root layout (`src/app/layout.tsx`, still titled RolloutOS) is **not modified** — the S3 branch lives under it and a rename is a separate sweep.

### Module layout

```
src/features/marketing/
  site.ts                       # name, tagline, nav links, CTA hrefs, feature + FAQ + step copy (plain data)
  site.test.ts                  # link/route + copy guards (see Testing)
  components/
    marketing-nav.tsx
    hero.tsx
    how-it-works.tsx
    feature-grid.tsx
    product-showcase.tsx        # admin week-calendar mock + bullets
    embed-showcase.tsx          # snippet mock + copy
    faq.tsx                     # native <details>/<summary>
    final-cta.tsx
    marketing-footer.tsx
    mocks/
      booking-card-mock.tsx     # service → slot picker → confirm, static
      calendar-mock.tsx         # week grid with a few colored bookings, static
      embed-snippet-mock.tsx    # <script … async> block, static
```

All components are **server components** (no state) except none is required: the FAQ uses native `<details>`, so the page ships zero client JS beyond Next's runtime. Mocks are decorative: `aria-hidden="true"` with the surrounding section carrying the accessible copy.

### Theme scoping

`src/app/layout.tsx` hard-codes `class="dark"` on `<html>` and `globals.css` defines `@custom-variant dark (&:is(.dark *))`. To render the landing light without touching the root layout:

- Add a `.light { … }` block to `globals.css` that re-declares the same token set as `:root` (light values). CSS custom properties resolve from the **nearest ancestor** that declares them, so a `.light` wrapper in the marketing layout overrides the html-level dark tokens for everything inside it, regardless of selector specificity.
- The marketing layout wraps children in `<div className="light bg-background text-foreground min-h-full">`.
- Landing components use **tokens only** and **no `dark:` utilities** (the `dark:` variant would still match because `<html>` has `.dark`). Shared UI primitives (`Button`) are used only in variants whose `dark:` overrides are harmless on light tokens (`default`, `ghost`, `secondary`); if `outline` looks wrong, use `secondary`.
- `color-scheme: light` is set on the wrapper so native controls (details marker, scrollbars) render light.

## Page structure and copy

1. **Nav** (sticky, `backdrop-blur`, hairline bottom border): "Booklo" wordmark → `/`; anchors *How it works* `#how-it-works`, *Features* `#features`, *FAQ* `#faq`; **Log in** (ghost → `/login`); **Get started** (primary → `/signup`). Below `md`: wordmark + the two buttons only (anchors hidden — page is one scroll).
2. **Hero** (2-col ≥ `lg`, stacked below): eyebrow "Scheduling for solo providers"; H1 **"Let clients book you in seconds."**; sub "A booking page and embeddable widget for solo providers. No client accounts, no double bookings — confirmations, reminders and rescheduling handled for you."; CTAs **Get started free** → `/signup`, **See how it works** → `#how-it-works`; small line under CTAs: "Free during early access · No credit card". Right column: `BookingCardMock`.
3. **How it works** (`#how-it-works`, 3 numbered columns 01/02/03): *Set your services and weekly hours* · *Share your link or embed the widget* · *Clients pick a slot; you both get confirmations*. Each with 1–2 sentences.
4. **Features** (`#features`, 6 cards, lucide icon + title + 1–2 lines): Hosted booking page · Embed on any site · Double-booking impossible · Self-serve cancel & reschedule · Automatic reminders · Your brand (logo, color, welcome text).
5. **Product module**: heading "Your week, at a glance"; `CalendarMock` full-width in a bordered card; three bullets (see every booking, block time, create walk-in bookings).
6. **Embed module**: 2-col — copy ("Paste one line. The widget resizes itself.") + `EmbedSnippetMock`; note that the same page works standalone at `booklo.example/book/your-handle` (rendered as illustrative, not a real domain).
7. **FAQ** (`#faq`, native `<details>`): Do clients need an account? · Can I embed it on my site? · What happens if two people pick the same slot? · How do clients cancel or reschedule? · What data do you store about clients? (name, email, optional note — nothing else) · What does it cost? (free during early access).
8. **Final CTA**: H2 repeats the headline; **Get started free** → `/signup`, **Log in** → `/login`.
9. **Footer**: wordmark + one-line description; columns *Product* (How it works, Features, FAQ anchors), *Account* (Log in, Sign up), *Legal* (Privacy, Terms — `href="#"` placeholders, visually normal); "© 2026 Booklo".

All copy lives in `site.ts` as typed data; components are presentational.

## Visual style

- Light neutral background (`--background`), dark charcoal headings (`--foreground`), muted body (`--muted-foreground`); **teal `--primary` as the single accent** (buttons, step numerals, icon tint, calendar mock accents).
- Inter (already loaded), tight tracking on headings; H1 ~56–64px desktop / ~36–40px mobile; body 16–18px.
- Radii 8–12px, hairline `--border`, no gradients, no drop-shadow drama; mocks sit in bordered cards on `--card`.
- Section vertical spacing 96–128px desktop, 64–80px mobile; content max-width ~1152px (`max-w-6xl`).
- Alternating single-column and multi-column blocks for rhythm (Mollie's "vertical rhythm").
- The `frontend-design` skill is loaded during implementation to keep the result intentional rather than template-default.

## Accessibility & responsiveness

- One `<h1>`; sections use `<section aria-labelledby>` with `<h2>`; skip-link not needed (single scroll, nav is small).
- Anchor navigation with `scroll-margin-top` on targets so the sticky nav doesn't cover headings.
- Buttons/links have visible focus (existing `Button` styles); contrast checked on light tokens.
- Mocks `aria-hidden`; no information exists only inside a mock.
- Layout: single column < `lg`, 2-col hero and embed ≥ `lg`; feature grid 1/2/3 columns.

## Testing & verification

Repo convention is node-env Vitest with pure-logic tests (no RTL). Tests:

- `site.test.ts`: every internal href in nav/CTAs/footer is either an in-page anchor or a route that exists under `src/app` (checks for `(auth)/login`, `(auth)/signup` directories); feature/FAQ/step arrays are non-empty with unique titles; copy guard: no feature or FAQ text mentions "Google" / "calendar sync" (unshipped S4).
- `npm run verify` (lint + typecheck + unit tests) green.
- `next build` succeeds (route group takes `/`, no conflicting `page.tsx`).
- Visual QA via the `run` skill: screenshots of `/` at desktop and mobile widths, light rendering confirmed inside the dark-html app; keyboard tab through nav → CTAs → FAQ; anchors land below the sticky nav.

## Out of scope

Pricing page, blog/resources, waitlist capture, analytics, i18n, dark variant of the landing, renaming RolloutOS in the root layout / DB, Google Calendar (S4) messaging, hamburger mobile menu.
