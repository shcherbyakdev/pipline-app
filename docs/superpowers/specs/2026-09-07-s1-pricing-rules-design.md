# S1 — Pricing rules for hourly spaces

Date: 2026-09-07. Roadmap slice S1 (`2026-09-07-studio-ops-roadmap-design.md`, order fixed by `2026-09-07-d1-decision.md`). Design approved in chat 2026-09-07; approach A of three (JSONB rules + JSONB line snapshot).

## Goal

A studio's published price list becomes the price the client is quoted, accepted and booked at — computed once, in the database, and itemised on the booking. From the 46-studio sheet, the shapes that must be expressible: a rate that depends on booking length (1 h 140 → ≥2 h 120 zł/h; or a total per duration: 1 h 197, 2 h 247, 3 h 347…), night/weekend surcharges (+25 % between 22:00 and 08:00), a per-person surcharge above an included count with a cap (+10 zł/person over 5, max 10), and priced extras by the hour or the piece (lamp 50 zł/h, backdrop 15 zł/pc, assistant 200 zł/h).

**Scope: hourly offerings only.** Nightly and daily spaces keep the H3 one-rate model untouched (ruling 2026-09-07).

## What exists (H3, 0057/0058)

`rental_offerings.price_cents` + `pricing_mode ('per_unit'|'flat')`, deposit policy (`deposit_type`, `deposit_value`), `cancel_window_min`, `terms_text`. `rental_total_cents(mode, price, units)` and `rental_deposit_cents(type, value, total)` in SQL, mirrored display-only by `src/features/rentals/pricing.ts`. The hourly RPCs snapshot `price_cents`, `currency`, `deposit_cents`, `terms_accepted_at` on `bookings`. The hourly widget shows a computed total on each duration pill. All of that stays; S1 layers on top and is inert when the new column is NULL.

## Data model (migration 0078)

### `rental_offerings.pricing jsonb` — NULL for every existing row and for nights/days

```jsonc
{
  "bands": [                                   // 1–8, ascending unique fromMin
    { "fromMin": 60,  "perHourCents": 14000 },  // 1 h and up: 140 zł/h
    { "fromMin": 90,  "totalCents": 19500 },    // exactly 1.5 h: 195 zł (a band may fix a total instead of a rate)
    { "fromMin": 120, "perHourCents": 12000 }   // 2 h and up: 120 zł/h for the WHOLE booking
  ],
  "surcharges": [                              // 0–4
    { "label": "Noc", "pct": 25, "days": [0,1,2,3,4,5,6], "from": "22:00", "to": "08:00" }
  ],
  "people": { "included": 5, "extraCents": 1000, "max": 10 },   // or absent
  "extras": [                                  // 0–12
    { "id": "arri", "label": "ARRI 2 kW", "unit": "hour",  "priceCents": 5000, "maxQty": 2 },
    { "id": "tlo",  "label": "Tło kartonowe", "unit": "piece", "priceCents": 1500, "maxQty": 10 }
  ]
}
```

Rules, enforced by a zod schema (`rentals/pricing-rules.ts`) on write and by a SQL CHECK `jsonb_typeof(pricing) = 'object'` plus the quote function's own refusals:
- `bands[0].fromMin ≤ min_duration_min` so every allowed duration has a band; each band has exactly one of `perHourCents` / `totalCents`; cents are integers 0–100 000 000.
- `surcharges[].pct` 1–200; `days` is a non-empty subset of 0–6 (0 = Sunday, matching `availability.weekdaysShort`); `from`/`to` are `HH:MM` and differ; `to < from` means the window crosses midnight. `days` names the day the window **starts** on.
- `people.included ≥ 0`, `extraCents ≥ 0`, `max ≥ included`, `max ≤ 500`.
- `extras[].id` is a slug unique within the offering (`^[a-z0-9-]{1,32}$`, generated once when the row is added and kept across relabels, never shown); `unit` ∈ `hour | piece`; `maxQty` 1–99; labels ≤ 60 characters.
- When `pricing` is set for an hourly offering, `pricing_mode` and `price_cents` are ignored for quoting (kept for the NULL fallback and for nights/days).

### `bookings.lines jsonb`, `bookings.people int`

`lines` is the itemised quote the booking was made at — **the one money record** that S3 (fees, refunds) and S7 (after-session charges) append to. `price_cents` remains the total of the lines. Each line:

```jsonc
{ "kind": "base",      "qty": 3,  "unitCents": 12000, "cents": 36000 }                          // qty = hours; unitCents NULL for a fixed-total band
{ "kind": "surcharge", "qty": 60, "unitCents": null,  "cents": 3000, "label": "Noc", "pct": 25 } // qty = overlap minutes
{ "kind": "people",    "qty": 2,  "unitCents": 1000,  "cents": 2000 }                           // qty = people above the included count
{ "kind": "extra",     "qty": 1,  "unitCents": 5000,  "cents": 15000, "extraId": "arri", "label": "ARRI 2 kW", "unit": "hour" }
```

Lines carry numbers and the studio's own words (`label` on surcharges and extras, as the studio typed them), never a translated sentence: every surface renders "3 h × 120 zł", "Noc +25 %", "2 extra people × 10 zł" from `kind` + numbers in its own locale, so a Ukrainian client and the Polish studio read the same record. `people` is NULL when the offering has no `people` rule.

Bookings made before 0078 keep `lines = NULL`; every reader treats NULL as "no breakdown, show the total only" — the H3 rendering.

## The quote

### `public.rental_quote_hours(p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb) returns jsonb`

`security definer`, `set search_path = ''`, revoked from every role, callable only from the RPCs below. `p_extras` is `[{ "id": "arri", "qty": 1 }]`. Steps, in the org's timezone:

1. **Base.** If `pricing` is NULL: one `base` line from `rental_total_cents(pricing_mode, price_cents, p_duration_min / 60.0)`; if that is NULL (unpriced offering) return `[]`. Otherwise the applicable band is the last one with `fromMin ≤ p_duration_min`; `cents = totalCents` or `round(perHourCents × p_duration_min / 60.0)`; `qty = p_duration_min / 60.0`, `unitCents = perHourCents` (NULL for a fixed total). No band → `raise 'quote_band'`.
2. **Surcharges.** For each surcharge, for each local calendar day `d` from the day before the booking starts to the day it ends, if `extract(dow from d) ∈ days`, the window is `[d + from, d + to]` (or `[d + from, d + 1 + to]` when it crosses midnight); `overlap = minutes of (window ∩ booking)`. `cents = round(base.cents × pct / 100.0 × overlap / p_duration_min)`; a surcharge with zero overlap emits no line. Surcharges stack additively on the base (never on each other).
3. **People.** Only when `pricing.people` is set: `p_people` NULL → treated as `included`; `p_people > max` → `raise 'quote_people'`; `qty = greatest(0, p_people − included)`; a zero qty emits no line.
4. **Extras.** Each `{id, qty}`: unknown id or `qty > maxQty` or `qty < 1` → `raise 'quote_extra'`; `hour` → `cents = round(priceCents × qty × p_duration_min / 60.0)`, `piece` → `cents = priceCents × qty`. Duplicate ids are refused.
5. Every `cents` is rounded to an integer at line level; all amounts are non-negative, so SQL `round()` (half away from zero) and JS `Math.round` (half up) agree. The function returns the array; the caller sums it.

Deposit stays `rental_deposit_cents(deposit_type, deposit_value, total)`.

### TypeScript mirror — `src/features/rentals/pricing.ts`

`quoteHours(offering, startsAt, durationMin, people, extras, timeZone): Line[]` implements the same five steps for the widget's per-pill totals and the live breakdown. `pricing.ts` already says "mirrored — keep in lockstep"; S1 makes that a test: `pricing-quote.integration.test.ts` runs the same fixture (≥ 12 cases: band edges at 59/60/61 and 119/120 min; a fixed-total band; a window crossing midnight; a booking crossing midnight into a non-surcharge day; a Sunday-only window; people at/below/above included and above max; each extra unit; duplicate ids; the NULL-pricing fallback; an unpriced offering) through `rental_quote_hours` and `quoteHours` and asserts identical lines. Prices on the pills are therefore never wrong by more than what that fixture fails to cover.

## RPC deltas (0078, `create or replace`, bodies copied verbatim from their latest migration with only these edits)

| RPC | Latest body | Delta |
|---|---|---|
| `create_rental_booking_hours` (public) | 0062 | new params `p_people int, p_extras jsonb` (signature change → `drop` + recreate + regrant to `service_role`); replace the `rental_total_cents` line with `v_lines := rental_quote_hours(…)`, `v_total := sum`; insert `lines`, `people` |
| `create_rental_booking_hours_admin` | 0058 | same computation with `p_people = NULL`, `p_extras = '[]'` — walk-ins are priced at base + surcharges; the admin adds extras later through S7's lines editor |
| `reschedule_rental_hours_apply` (core behind the client and admin hourly reschedules) | 0070 | re-quote at the new `starts_at`/duration with the booking's own `people` and the `extra` lines' `{extraId, qty}`; rewrite `lines`, `price_cents`, `deposit_cents` |
| `resolve_booking_token` | 0070 | return type gains `lines jsonb, people int` (drop + recreate + regrant to `anon, service_role`) |

Nothing changes for `create_rental_booking` / `reschedule_rental_booking` (nights/days) or any appointment RPC.

`src/features/rentals/hourly-actions.ts` validates `people` and `extras` with zod before calling the RPC; the RPC's `quote_band` / `quote_people` / `quote_extra` sentinels map to `errors.rentals.quote` ("The price for that choice can't be worked out — pick again.") the same way `SLOT_TAKEN` maps today.

## Admin — the space form (`offering-form.tsx`, hourly spaces only)

The Pricing section's single "Price" field is replaced, for `rangeMode === "hours"`, by four row editors; nights/days keep the field.

- **Rates by length** — rows of `from [N] h → [zł/h | total zł] [amount]`; the first row's "from" is fixed to the space's minimum duration. At least one row.
- **Surcharges** — rows of `label · +[%] · days (seven toggles) · from [TimeCombobox] to [TimeCombobox]`.
- **People** — `included [n] · per extra person [zł] · max [n]`; empty = no people rule.
- **Extras** — rows of `label · [per hour | per piece] · [zł] · max [n]`.

Row editors follow the availability day-interval editor's idiom (add row, remove row, no drag). The form posts one `pricing` object; `patchOffering` / `createOffering` validate it with the zod schema and reject with field-level messages. Deposit, cancel window and terms stay where they are.

Headline price (spaces list row, space page header, the widget's offering card, the booking-page Spaces section): with `pricing` set, `formatOfferingPrice` shows the **lowest** per-hour rate among bands prefixed "from" (`public.units.fromPerHour`: "from {amount} / hour" · "od {amount} / godz." · "від {amount} / год"); a bands list with only fixed totals shows the first band's total for its hours.

## Widget — the hourly booking flow (`hourly-booking-flow.tsx`)

1. Duration pills come before the slot, so they show the **base** for that duration from `quoteHours` (band only); when the offering has surcharges the pill reads "od 240 zł" instead of "240 zł", because the night rate is not known until a slot is picked.
2. After the slot: a **People** stepper (only if `people` is set; default `included`, range 1…`max`, label "Osoby · do {included} w cenie") and an **Extras** list (only if `extras` exist; each with a quantity control up to `maxQty`, price per unit shown).
3. The confirm step shows the itemised lines and the total, then the existing deposit / "pay at the venue" / free-cancellation lines. `booking-money-summary.tsx` gains a `lines` prop; `moneyInfoLines` gains the line rendering so the manage page and both emails print the same breakdown.
4. Refusals from the RPC re-open the step with `errors.rentals.quote`.

Preview mode (the page builder's live previews) renders the controls with the seeded demo rules and never calls the RPC — as today.

## i18n

New keys in `en`, `uk`, `pl` (the parity test refuses a partial locale): the form labels (`spaces.form.pricing.*`), the widget controls (`public.widget.people`, `public.widget.extras`), line kinds (`public.units.line.*`), `public.units.fromPerHour`, `errors.rentals.quote`. Glossary: rate by length = "stawka za długość", surcharge = "dopłata", extra = "dodatek", included = "w cenie".

## Tests

- Unit (`pricing-rules.test.ts`): the zod schema — every rule above, with the failing field named.
- Unit (`pricing.test.ts`): `quoteHours` on the fixture; label formatting.
- Integration (`pricing-quote.integration.test.ts`): SQL ≡ TS on the fixture; `create_rental_booking_hours` snapshots `lines`/`people`/`price_cents`; reschedule re-quotes (Saturday-night → Tuesday-morning drops the surcharge); refusals (`people > max`, unknown extra, `qty > maxQty`); `pricing = NULL` keeps every 0058 case green; `resolve_booking_token` returns the lines.
- Existing tests: `hourly.test.ts`, `booking-rpc.integration.test.ts` unchanged and green.

## Out of scope (named so nobody builds them here)

Stock-aware extras and whole-studio bookings (S6); collection and holds (S2); tiered cancellation and reschedule fees (S3); after-session lines and the admin lines editor (S7); people/extras on the admin walk-in form (S7 covers it); hour bundles / karnety (parked); pricing rules for stays; per-unit price differences within one space (different rooms are different spaces, as today); VAT display (prices are whatever the studio enters, gross or net, as today).

## Migration note

0078 is the next free number (0077 is Google Calendar v2). One file: the two columns, the CHECK, `rental_quote_hours`, the four RPC bodies. Rollback = drop the function, the columns and the recreated RPC signatures back to their 0062/0056/0070 forms (kept in the file's footer comment).
