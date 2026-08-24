# Resource Booking Pivot — Vision & Roadmap

**Date:** 2026-08-24
**Status:** Approved (brainstorm with Andrii)
**Type:** Umbrella vision + roadmap. Each slice below gets its own spec → plan cycle before implementation.

## Decision

Booklo's identity changes from "booking page for solo providers" to **"booking for anything with a schedule — rooms, studios, gear, and people."** The lead product is **hourly resource booking with deposits**; appointments remain a first-class mode, not legacy. The parked rentals engine (R1 #34, R2 #36) is un-parked and extended with an hourly mode; deposits arrive via Stripe Connect.

Rejected alternatives:

- *Stay in appointments and out-feature the incumbents* — the segment's market price is structurally $0: Square Appointments (free solo, monetizes processing), Fresha (free, monetizes 2.19%+ processing and 20% of a marketplace client's first visit), Cal.com (free, open source, 41k stars), Booksy (~50M users, monetizes marketplace/ads). Three of the four don't sell software at all; a $12 scheduler cannot win against products whose owners earn elsewhere. Booklo's own `FORBIDDEN_COPY` (no payments, no calendar sync) marks the gap.
- *Money layer alone (deposits on appointments)* — deposits are rational on a €200 studio day and absurd on a €20 haircut; Square/Fresha bundle them free. Not enough to justify a subscription by itself. Its deposit mechanics survive as a component of this pivot.
- *AI booking infrastructure (API + MCP for voice agents)* — real technical moat (atomic slot writes vs. Google Calendar's double-booking under agent retries), but it makes Booklo an invisible component sold to developers against an open-source incumbent. Deferred as a later **channel**, never the identity.

## Why resource booking

- **The price is honest.** Skedda charges $99–199 per *space* per month, annual-only, no free tier, 12,000 customers. Nobody gives resource-hours away because there is no marketplace or processing volume worth subsidizing.
- **Per-resource pricing scales.** A solo provider has one calendar and can be charged once; a studio has six rooms. Customer economics grow with ours.
- **Free incumbents cannot follow.** Square/Fresha/Calendly data models are person-and-service or meeting-shaped. Resource-hours with turnover, variable duration and multi-day ranges is not a bolt-on.
- **The booking is worth real money**, so deposits, terms and cancellation windows — the features worth paying for — are rational.
- **It fits Andrii.** Sellable in person in Poland (studios can be visited; 500 freelancers cannot). Stores a room, a time, a name — the standing no-sensitive-personal-data constraint survives intact.
- **Target price point:** the slice *below* Skedda — spaces priced out of $99/space, currently on Google Calendar + Messenger + bank transfer.

## Buyer

Independent hourly-let spaces with 1–8 bookable things: photo/podcast/rehearsal studios, treatment and therapy rooms sublet by the hour, dance and workshop rooms, makerspaces, small event spaces. Nights/days rentals (gear, campers) stay supported as shipped but are not the marketing lead.

## Product definition

A space owner signs up, chooses what they book (org modes, the written R3 spec), defines **offerings** (Studio A…) with units, hourly rates, opening hours and a deposit policy, and shares the same public page / embed / `/{handle}` short link that exists today. Clients pick a duration and a start time, accept the terms, pay the deposit if required (Stripe Checkout, provider's own Stripe account), and manage the booking via the existing tokenized email links.

## Architecture

### The engine crossing (hourly mode)

`RANGE_MODES` gains a third value: `nights | days | hours`. The mode is the code fork:

- `nights`/`days` → today's `daterange` path (`rental_unit_is_free`, R1/R2 range picker) — unchanged.
- `hours` → the **existing DST-safe appointments slot engine** (`src/features/scheduling/slots.ts`) run against a resource, and the `tstzrange` EXCLUDE guard.

`slots.ts` is already generic — it knows nothing about staff. Mapping for a resource:

| `SlotInput` field | Source for an hourly offering |
|---|---|
| `durationMin` | client-chosen length (see below) |
| `bufferAfterMin` | turnover/cleanup between bookings |
| `minNoticeMin` / `bookingWindowDays` | existing offering columns |
| `rules` / `exceptions` | resource opening hours (below) |
| `busy` | confirmed + pending bookings on that unit |

No new slot engine. `bookings.starts_at/ends_at` are already `timestamptz` and rentals already write them — no new booking columns for the hourly case itself.

### Variable duration

Hourly offerings gain `slot_increment_min`, `min_duration_min`, `max_duration_min` ("from 1h, in 30-min steps, up to 8h"). The client picks a length; the engine runs with `durationMin` = that length, start times on the increment grid. No rate-card table, no new engine path.

### Resource opening hours

`availability_rules` / `availability_exceptions` gain a nullable `rental_offering_id` beside `staff_id`, with a CHECK enforcing exactly-one-of (the `bookings_kind` idiom from 0037). This reuses the availability editor UI, its loader, and the engine wholesale. Hours live at the **offering** level ("both studios open Mon–Sat 9–21"); per-unit overrides are deliberately excluded until asked for.

### Payment holds

The EXCLUDE guard currently covers `status = 'confirmed'` only. With deposits, a slot must be held during Stripe Checkout:

- New status `pending_payment` + column `hold_expires_at`.
- Partial EXCLUDE extended to `status IN ('confirmed','pending_payment')`.
- Expiry release rides the existing drain cron (`/api/scheduling/drain` gains a job; same secret, same set-before-act claim idiom as `reminder_sent_at`).

### Money split (two Stripe relationships)

- **Booklo's subscriptions:** unchanged — Stripe **Managed Payments** as Merchant of Record (JDG constraint, decided 2026-08-18).
- **Client deposits:** Stripe **Connect Express** in a **second Stripe account** (Managed Payments does not support Connect). The provider is the merchant of record for their deposit; Booklo is the platform with a **0% application fee** — the pitch against Fresha/Square's transaction taxes. Card data never touches Booklo. Refund rules key off the offering's cancellation window through the existing manage-token flow.

### Deliberately unchanged

Auth, orgs, branding, booking-page builder, embed widget, clients, email transport, reminder drain, billing seam, the whole appointments engine, `/{handle}` claim flow. `getBusyIntervals` keeps excluding rentals — a booked room never blocks a person's calendar (R1 ruling stands).

### Rendering ruling

Hourly rental bookings render on the existing **week calendar** like appointments; the R2 timeline remains for nights/days. No hourly timeline.

## Booklo's own pricing

`PLANS` moves from per-seat to **per-resource** (a bookable staff member and a rental unit both count). Exact shape and prices are H5's spec (working sketch: Free = 1 resource · Pro ≈ $29 for 3 · + per extra resource); the principle — charge per bookable thing, undercut Skedda's $99/space by an order of magnitude, 0% on transactions — is decided here.

## Slice roadmap

Migrations: 0050–0052 are taken (staff grants, handles, audit); this roadmap starts at **0053**. The R3 memory note "R3 starts at 0050" is superseded.

| Slice | Scope | Migration | Depends on |
|---|---|---|---|
| **H0 — Validation (parallel track, no code)** | List 20 hourly-let spaces in Kraków/Warsaw, talk to 10. Eight questions: booking today, double-booking stories, no-show cost, deposit practice, willingness to pay. **Kill-gate for H4:** <3 of 10 naming deposits as a real pain → rethink the Connect slice (rest of roadmap survives). | — | — |
| **H1 — Org modes** | Execute the already-approved R3 spec+plan (`2026-08-17-rentals-r3-*`): `offers_appointments`/`offers_rentals`, onboarding picker, nav restore, per-org flag flip. Renumber to 0053; rebase-review against main (booking-page builder, audit hardening landed since). | 0053 | — |
| **H2 — Hourly mode** | `range_mode='hours'`; increment/min/max duration columns; resource opening hours (+ editor reuse); public duration-picker → time-grid in widget + booking page; week-calendar rendering. Fold in the two R2 deferrals that bite hourly: timeline turnover-padding, picker request-ordering guard. | 0054 | H1 |
| **H3 — Prices & terms (no Stripe)** | `price_cents` + currency on offerings (per-hour and flat), deposit policy (`none \| deposit(amount\|%) \| full`), cancellation window, terms text + accept checkbox. Display end-to-end; collection = "pay at the venue". Replaces `price_label` for rentals. Makes demos sellable to H0 interviewees. | 0055 | H2 |
| **H4 — Deposits via Stripe Connect** | Connect Express onboarding in Settings (second Stripe account); Checkout session when policy requires payment; `pending_payment` + `hold_expires_at` + EXCLUDE extension + drain release; webhook-confirmed transitions; refunds per cancellation window. | 0056 | H3 + H0 gate |
| **H5 — Repositioning** | Landing, onboarding, pricing copy for the space-owner buyer; per-resource `PLANS`; appointments demoted to "also books people"; `FORBIDDEN_COPY` updated (drop "stripe"/"payment" after H4). Spec can start once H2 screenshots exist. | — | H2 (overlaps H3/H4) |
| **H6 — Launch + first 10 customers** | Existing launch-infra spec (booklo.co, SMTP, drain cron, HIBP) + in-person sales from H0's list; founder pricing for first orgs. | — | H4, H5 |

First sellable demo: end of H3.

## Deliberately deferred

Pooled capacity (N interchangeable seats), per-unit opening-hour overrides, dynamic pricing, marketplace/discovery, the AI-agent API (later channel), gear/multi-day marketing push, GCal sync for resources, SMS reminders.

## Open questions (to resolve in slice specs)

1. **Connect Express availability/KYC in PL for the target businesses** — verify before H4's spec; Paddle has no Connect equivalent, so a failure here forces a rethink (part of the H0 gate).
2. **Currency:** PLN-first vs multi-currency at H3 (deposit amounts must match the provider's Stripe settlement currency by H4).
3. **Per-resource plan shape and prices** — H5's spec, informed by H0 answers on willingness to pay.
4. **Second Stripe account logistics** (separate JDG registration details, webhook endpoints, env separation) — H4's spec; accountant question list already pending.

## Sources (desk research 2026-08-24)

Calendly positioning/pricing (calendly.com; meetings, Callie/Notetaker, $15k enterprise floor), Skedda pricing (frontdeskreview.com, getapp.com), Fresha/Booksy/Square models (twizzlo.com, glossystack.com, lokal360.pl), Cal.com traction (cal.com, contabo.com), no-show economics (biz.booksy.com, schedulingkit.com, serviceagent.ai), class/membership segment saturation (arlo.co, pembee.app), court-booking saturation (anolla.com, wakesys.com), creator storefronts (stan.store). Desk research only — H0 exists because the fire-safety pivot's premise was inverted by exactly this gap (see `2026-08-11-market-stress-test-and-repositioning-design.md`).
