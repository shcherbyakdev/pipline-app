# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Providers (the paying side; both channels equal, confirmed 2026-08-28):**
  - Solo appointment providers and small businesses (freelancers, tutors, therapists, small salons) whose clients book time with a person.
  - Space operators (rehearsal and recording studios, meeting rooms, makerspaces, gear) who rent by the hour, night or day.
  - Small teams up to ten bookable people or units are in scope; enterprises are not.
  - Situation: they run the business alone or with a few people, have no IT help, set up on desktop and check bookings on a phone, and want to stop taking bookings over DMs and spreadsheets. Market: Poland first, then nearby EU; validation interviews target Kraków and Warsaw space operators.
- **Clients (the booking side):** the provider's customers, usually arriving on a phone from a link in a bio, a message, or a widget embedded on the provider's site. They book without an account and later cancel or reschedule from an emailed link.
- **Staff members** of a Team-plan org (bookable people). Secondary; role enforcement is still deferred.

## Product Purpose

Booklo gives a provider a hosted booking page at `/<handle>` (plus `/<handle>/spaces`, per-person pages and an embeddable widget) where a client picks a service or a space and a time. Confirmations, reminders, cancellation and rescheduling run over email. The provider runs everything from an admin app: Bookings (week grid, timeline, list), Services, Spaces with units, Team, one Availability page for people and hourly spaces, a Booking page builder, Website embed, Settings and Billing.

It exists because appointment scheduling is priced at zero by payment- and marketplace-subsidised incumbents (Square, Fresha, Cal.com, Booksy) while space booking is priced honestly (Skedda-style, no free tier), and no small-operator product does both well.

Success for a provider: claim a name, add a service or space, set hours, and be bookable within minutes; then bookings arrive with no double bookings and no back-and-forth. Business goal: first ten paying customers, then $1-3k MRR.

## Positioning

One page, one calendar and one widget for **both** a person's time (appointments) and a unit's time (spaces by hour, night or day). Free appointment tools cannot model spaces (units, check-in and check-out, hourly grids, deposits); space tools do not sell a person's time. Booklo runs both on the same DST-safe slot engine and the same database exclusion constraint, so "no double bookings" is a database fact rather than a UI promise. The claim flow is one step from a name to a live page.

## Operating Context

- Provider journey: claim a handle on the landing page, one-step onboarding (Appointments, Spaces or both), welcome checklist in admin (add a service or space, set hours, share the link). Shares the link or embeds the iframe widget (`public/embed.js`, `?embed=1` with postMessage resize). Watches the week grid or timeline, adds walk-ins by hand, keeps a clients directory.
- Client journey: opens the page on a phone, picks a service or space (duration on an increment grid for hourly spaces; check-in and check-out for nightly or daily ones), picks a time, enters name and email, receives a confirmation with cancel and reschedule links, then a reminder. Token links, no login.
- Email is the only channel (Resend in production, Mailpit locally). No SMS. No Google Calendar sync yet (skipped for the MVP; planned as a Pro feature).
- Spaces have units (individual rooms or items); a unit is auto-assigned to the booking. Hourly spaces render on the week calendar; nightly and daily spaces on the timeline.
- Money: Booklo subscriptions bill through Stripe Managed Payments so Booklo is never seller of record. Client deposits are planned through Stripe Connect Express (slice H4), gated on the validation interviews. Today public prices are labels and clients pay at the venue.
- Environments: local Supabase stack; test environment at booklo-five.vercel.app with continuous deployment; intended public domain booklo.co (the claim bar reads `booklo.co/your-name`). Production domain not yet live. [inferred from code and specs]

## Capabilities and Constraints

Confirmed capabilities: handle-based public pages with cross-links between the appointments and spaces pages; per-channel and per-person embeds; booking page builder with sections and templates whose previews follow real data; services with duration, buffer and price label; spaces with units, photos, prices and terms; availability rules and date overrides per person or hourly space, seeded Mon-Fri 9-5 for new accounts; team with per-person pages; week calendar and drag-to-pan timeline; clients directory; walk-ins and admin moves; reminder emails; plans Free, Pro and Team with entitlement caps; owner-only `/utils` back office for feature flags and comps.

Constraints:
- Solo builder. Never store sensitive personal data (identity documents, personal financial data); card data stays with Stripe. Token links never expose another person's personal data.
- English UI only for the foreseeable future (confirmed 2026-08-28). Handle normalisation transliterates Polish and other EU diacritics.
- Prices ($12 Pro, $29 Team, USD) are placeholders until willingness-to-pay interviews; billing is off per org by default; the landing says "Free during early access".
- The spaces channel sits behind a per-org `rentals` flag with an environment default.
- A legacy domain (programs, units, templates, chasing, portal) from the earlier fire-safety product is hidden from navigation; its code and tables remain. Not product surface.
- Terminology (binding): "Spaces" for rooms, studios and gear; "units" for the individual rooms or items; "Services" and "Appointments" for the person channel; "clients" for the people who book; "bookable resources" for people plus units. "Offering" and "rentals" never reach a provider's or client's eyes ("Gear rental" is allowed). Marketing `FORBIDDEN_COPY`: google, calendar sync, stripe, payment, offering, rentals, until those features ship.
- Stack is fixed: Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui on Base UI, Supabase with Drizzle, Hugeicons (lucide remains in older code), Vitest in a node environment (no DOM tests).
- Undecided: real prices; deposits (pending the interview kill-gate); whether the landing leads with spaces (currently deliberately both); a Polish UI is not planned.

## Brand Commitments

- Name **Booklo**. Mark (chosen 2026-08-28 from a six-face sheet, after symbol and custom-letter marks were rejected): the wordmark alone, "booklo" in Outfit Semibold tracked tight, no symbol, `src/features/marketing/components/booklo-mark.tsx`; the earlier pixel-b and the lime booked dot are retired. Tagline in code: "Booking page & widget for appointments and spaces". The handle URL (`booklo.co/<your-name>`) is the brand hero object.
- Voice as shipped: plain, concrete, short sentences; states what is true today ("Free during early access · No credit card"); no hype verbs. [inferred from `src/features/marketing/site.ts`; confirm before treating as binding]
- Free plan shows a "Powered by Booklo" badge on public pages; paid plans may hide it.
- On public pages and the widget the provider's brand leads (their accent colour and logo); Booklo's recedes.
- Marketing landing direction (2026-08-28, fourth cut the same day, references gumloop.com and family.co): product-first and soft. Warm off-white ground, soft grey panels, headlines in Inter at weight 500, black pill buttons, hairlines at low alpha, one layered shadow. Colour is semantic and lives in labels, dots and product fragments (appointments blue, spaces green, classes pink, stays orange), never in the chrome. Wordmark: "booklo" in Outfit Semibold, no symbol (chosen from a six-face sheet). The hero is a day filling up with bookings of every kind on a hairline axis (then the week and a stay), built as a component; the product is shown through built fragments, never screenshots, because the app UI will be restyled later. No cards around animations, nothing floats, no pointer in the hero. Motion follows Emil Kowalski principles; the page was audited against the taste skill (three-equal-cards, numbered eyebrows, zigzag triples, decorative dots and middle-dot separators removed). Earlier the same day: two teak.io-style "Grid-Paper Sheet" cuts, a Stripe/Notion-clean variant and a Linear-like light cut, all set aside.
- Earlier landing directions (dark Linear-like; light paper/ink/cobalt v3) are history, not commitments.

## Evidence on Hand

- **None** (confirmed 2026-08-28): no customers, testimonials, logos, case studies, press or usage figures. Validation interviews not yet held. Future work must not fabricate any of these; proof comes from product truth (features, guarantees) and the product itself.
- Real assets: the product UI (screenshots can be taken from the seeded demo org, `demo@rolloutos.local`), the mark, marketing copy in `src/features/marketing/site.ts`, plans in `src/lib/billing/plans.ts`, legal pages at `/terms` and `/privacy`.
- Reference screenshots, untracked at the repo root: `ref-calendly-*.jpeg`, `ref-plain-*.jpeg`, `teak-hero.jpeg`, `teak-full.jpeg`.

## Product Principles

1. Both channels are first-class: a surface that reads wrong for a room or for a person is wrong.
2. Claim to bookable in minutes: no setup call, nothing to install, defaults that already work.
3. Clients never need an account; links do the work (book, cancel, reschedule).
4. Say only what is true today. Plan limits shape the public offering, never delete data, and a client is never turned away.
5. Hold as little as possible: no sensitive data, money through the processor, the provider is the merchant.
