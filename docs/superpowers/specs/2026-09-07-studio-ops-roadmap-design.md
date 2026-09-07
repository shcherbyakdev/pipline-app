# Studio Operations — Roadmap

Date: 2026-09-07. Follows `2026-09-07-studio-ops-concept.md` (the decision brief). Supersedes H4–H6 of `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`; its H0 becomes Phase 0 here. Not an engineering backlog: each slice gets its own spec + plan when its gate opens.

## Decision

Booklo becomes **booking operations for multi-room photo/content studios** that sell combinations (rooms, whole-studio, shared equipment, people-count) with prepayment, holds, tiered cancellation and after-session charges. Spaces channel only; XOR preserved; appointments frozen. Nothing in Phase 1 is built before Phase 0's gates say so.

## Assumptions (state them, don't hide them)

- The founder works on Booklo most days. Recent slices (H2, H3, notifications, member/space pages) each landed in 1–3 days; money and webhook slices take 1–2 weeks because of testing. Timeboxes below use that velocity and are ranges, not commitments.
- Phase 0 needs founder time, not code: interviews in Kraków/Warsaw in person.
- Migration numbering is assigned at plan time (memory: next free 0078 — verify against `supabase/`).
- Polish is a launch requirement for a Polish buyer; if Phase 0 sends the product international-only, the Polish slice is dropped, not delayed.

## What already exists that the plan must not rebuild

| Capability | Where | Gap the roadmap fills |
|---|---|---|
| Spaces with units; DB `EXCLUDE` per unit; hourly `stepMin` / tail overflow; nights/days ranges | H1–H2, R1–R2 | Composite resources (whole-studio ⊃ units, shared equipment) |
| `priceCents` per hour/night/day or flat; SQL `rental_total_cents` (0058) | H3 | Duration tiers, people surcharge, weekday/time rules, extras |
| Deposit **policy** none/fixed/percent/full; `rental_deposit_cents`; "pay at venue" lines in confirm, manage page, emails | H3 | **Collection** (a policy is not a payment) |
| `cancelWindowMin` (one free-cancel window), `termsText` + accept checkbox | H3 | Tiered windows with % consequences; reschedule/extend recompute |
| Approval flow; walk-ins; admin moves; reschedule; token manage links | PR #86, R2, S-slices | Holds with expiry as a first-class state |
| Email (Resend) + Web Push; per-org reminder lead; reminder drain cron | PR #128 | Reuse the drain for hold expiry; notify on balance due |
| Overview with pending requests and year heatmap | 2026-09-01 | The daily action list (holds expiring, balances due, changes to confirm) |
| `next-intl`, `en.json` + `uk.json`, org and per-booking locale | i18n waves 0–4 | `pl.json` |
| Entitlements per bookable resource (Free 2 / Pro 5 / Team 10); Stripe Managed Payments for Booklo's own subscription; Founder ribbon | billing slices | Per-location studio plan; second Stripe relationship (Connect) |
| Google Calendar sync built, unreleased (needs app verification) | PR #129 | Release path only, as a paid-plan feature — not in the pilot cut |
| CSV import (legacy fire-safety domain, papaparse in deps) | 2026-08-11 plan | Re-point at future bookings for migration |

## Phases

### Phase 0 — Gates (no product code) · 3–4 weeks

| Step | Output | Gate |
|---|---|---|
| **S0.1 List** — Google Maps + Instagram, seven cities, "studio fotograficzne do wynajęcia"; record rooms, published rules, visible booking tool | A sheet; the **count of eligible studios** (≥3 rooms, combinations, prepayment rules) | Feeds every other gate |
| **S0.2 Interviews** — 8–12 multi-room studios, ≥4 on Bookero/Calendesk, ≥3 manual; the question set from the brief §10 (hours/week, incidents in 90 days, tool + spend, combinations, who does the work, price ladder, switching question) | Interview notes + a tally sheet | **G1**: ≥5/10 report ≥1 costly incident a month *or* ≥3 h/week, *and* ≥4 sell combinations |
| **S0.3 Competitor trials** — Bookero, Calendesk, AllBooked, hands-on with one scripted studio (4 rooms + whole-studio + a shared lamp + 100% prepay + 72/48h tiers + overtime) | A comparison table: can they do (i) room + shared equipment with conflict check, (ii) whole-studio blocking rooms, (iii) partial deposit + balance, (iv) after-session charges; what export exists | **G3 kill rule**: if Bookero or Calendesk does (i)–(iv) at ≤200 PLN, the Polish price hypothesis is dead |
| **S0.4 Rails** — Stripe Connect Express test-mode onboarding for a Polish sole trader; P24 + BLIK on a Checkout session; the pending accountant questions | A tested path or a documented blocker | **G4** |
| **S0.5 Observation** — half a day on site (or a screen-share of tool + inbox) with 2–3 interviewees who bite | The real booking states and where they break | **G2**: fits the lifecycle in the brief §4; needs no more than the six additions |

Allowed code in Phase 0 (small, useful whatever the outcome): the **public booking flow and client emails in Polish** (`public.*` and email namespaces only, admin stays English) so interviewees see their client's experience in their client's language. Nothing else from Phase 1.

**Decision point D1** (end of Phase 0), recorded in a dated note:
1. Go / no-go on the studio direction (failure-signal table in the brief §11 decides the alternative).
2. Geography and band: Poland 349–499 PLN net, international $99–149, or both.
3. Which Phase 1 slices the pilots need on day one versus day thirty (default order below).
4. Rail: Connect Express, or a principle change.

### Phase 1 — Pilot cut · 4–6 weeks after D1

Sequence is by what a pilot needs to leave Bookero on day one. Each row becomes one spec + plan.

| Slice | Content | Depends on | Pilot needs it |
|---|---|---|---|
| **S1 Pricing rules** | Duration tiers (first hour vs. 2+), people-count surcharge with a cap, weekday/time rules, extras with their own unit (per hour / per day / per piece). SQL stays authoritative (extend 0058's helpers); the widget shows the computed total before the client commits. | — | Day 1 |
| **S2 Holds + collection** | `pending_payment` with `hold_expires_at` occupying the slot under `EXCLUDE`; expiry via the existing drain; Connect Express onboarding in Settings; Checkout session when the policy requires payment (P24/BLIK/card); webhook-confirmed transitions; the provider is the merchant, Booklo never holds client money. (Was H4.) | S1, G4 | Day 1 |
| **S3 Change consequences** | Replace the single `cancelWindowMin` with tiers (e.g. >72h free · 48–72h 50% · <48h 100%); reschedule and extend recompute price and balance; refund or fee per tier through Connect; emails and the manage page show the consequence before the client confirms. | S1, S2 | Day 1 |
| **S4 Daily action list** | The studio's home: holds expiring today, requests waiting for approval, balances due, changes to confirm, sessions ending soon (for overtime). Built on the Overview requests section; push + email digest reuse PR #128. | S2, S3 | Day 1 |
| **S5 Polish** | `pl.json` across admin, public and email; PLN formatting; handle normalisation already transliterates. Skipped if D1 says international-only. | — | Day 1 (PL) |
| **S6 Compound resources** | Whole-studio as a composite that blocks every unit; shared equipment as units of an equipment space attached to a booking; one booking, several resource rows, `EXCLUDE` on each. | S1 | Day 1 for a pilot that sells combinations, else day 30 |
| **S7 After-session charges** | Line items on a booking (overtime in 30-min blocks, extra people, cleaning, damage); balance due; a collect link (Checkout) or write-off; settled state; shows up in S4. | S2, S4 | Day 30 |
| **S8 Migration kit** | CSV import of future bookings (re-point the legacy importer), a pricing worksheet that maps Bookero/Calendesk rules onto S1, the parallel-run checklist. Manual for pilot 1; tooling only if pilot 2 needs it. | S1 | Onboarding |

Exit: one pilot studio live on Booklo with real bookings, prepayment collected into the studio's own account, and a week of clean S4 mornings.

### Phase 2 — Paid pilots (G5) · 30 days live + decision at month 3

- Three studios from S0.2, paying 50% of the D1 band from day one; migration done with them (S8, by hand).
- Weekly 20-minute check-in; an incident log per pilot (what fell through, what they did in Bookero/Instagram instead, what they asked for).
- Promote any "later" item that is blocking a pilot (SMS, calendar sync release, invoicing hand-off) into a slice; do not add anything a pilot did not ask for.

**Decision point D2** (month 3): ask for full price. **G5 pass**: ≥2 of 3 stay past 30 days, ≥1 pays the full band. Otherwise the brief's §11 table picks the shift (reprice, international-only, or stop).

### Phase 3 — Launch for studios · after D2

| Slice | Content | Depends on |
|---|---|---|
| **S9 Repositioning** | Landing and onboarding for the studio buyer; pricing page per location (up to 10 rooms/units); Founder price for pilots; `FORBIDDEN_COPY` updated once collection ships (drop "payment"; keep "google/calendar sync" until S11). Was H5. | D2 |
| **S10 Domain + ops** | booklo.co live (launch-infra spec: DMARC, SMTP, HIBP, drain cron); monitoring for webhooks and hold expiry. Was H6. | S2 |
| **S11 Paid-plan extras** | Google Calendar release (app verification path already documented); invoicing hand-off to a KSeF-compliant provider (Fakturownia/inFakt) instead of native invoicing; SMS as a pass-through cost. Each only if a pilot asked. | Pilot evidence |
| **S12 First ten** | Outreach from the S0.1 list at full price with assisted migration; stop at twenty customers and re-plan support before going further. | S9, S10 |

## Frozen and parked

- **Appointments channel**: frozen (runs, tested, unmarketed). Revisit at D2.
- Rehearsal studios, shared therapy rooms, memberships/credits, marketplace, native apps, smart locks, overnight accommodation, quote-to-contract venues: parked per the brief.
- XOR: preserved. Studio-owned photographer sessions are a D1 note (product-in-room or off-platform), not a schema change.

## Reconciliation with the 2026-08-24 roadmap

H0 → Phase 0 (now with kill rules) · H1–H3 → shipped, reused above · H4 → S2 · H5 → S9 (H5a/H5b already shipped the spaces surface and repositioning copy) · H6 → S10 + S12.

## Open items a slice spec must settle (from the brief §13)

Geography/band (D1) · rail and refunds (S2) · hold semantics after partial payment (S2) · appointments channel fate (D2) · studio-owned sessions under XOR (D1 note) · invoicing hand-off (S11) · migration tooling vs manual (S8) · onboarding fee and annual prepay (S9) · SMS (S11) · day-one vs day-thirty sequencing (D1).
