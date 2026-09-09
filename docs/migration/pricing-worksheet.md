# Pricing worksheet — from Bookero / Calendesk to Booklo

Fill this in with the studio before touching Booklo. One row per rule the studio publishes today (price list, regulamin, booking page). The right-hand column says where the rule lives in Booklo; the last column is what you type in. Every row should end up either mapped or consciously dropped.

Studio: ______________________  Old tool: Bookero / Calendesk / email+Instagram  Date: __________

## 1. Rooms and what they sell

| Old-tool concept | Booklo | Notes |
|---|---|---|
| A bookable room | **Space** → Room (`/rentals/new`), hours mode | One space per room with its own price and hours. |
| Several identical rooms or stations sold as one thing | One space, split into **units** (space page → Units) | The client is auto-assigned; the tape chart shows one lane per unit. |
| Whole studio / multi-room hire | **Space** → Whole studio, *Includes* = the rooms | Booking it blocks every included room, and any room booking blocks it. Its own price and hours. |
| Lamp, smoke machine, projector sold per hour or per session, shared between rooms | **Space** → Equipment, *How many items*, price per hour or per booking | Never bookable alone; offered as an add-on on every room. One item cannot be in two rooms at once. |
| Make-up room bookable on its own | A Room space | If it is only ever sold with a room, make it Equipment with one item instead. |
| Backdrops, paper by the metre, assistant by the hour | **Pricing rules → Extras** on the room (per hour / per piece, max quantity) | Not exclusive: no unit, no conflict check. |

Rooms:

| Old name | Booklo space name | Kind (Room / Whole studio / Equipment) | Units / items | Includes (whole studio only) |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

## 2. Time rules (per space, Session section)

| Old-tool concept | Booklo field | Value to type |
|---|---|---|
| Minimum booking (e.g. 1 h, 2 h) | Min duration | |
| Longest booking allowed | Max duration | |
| Time grid (bookings start every 30 / 60 min) | Increment | |
| "55-minute hours" | Increment 60, min 60 — Booklo bills clock time; put the 5-minute changeover in *Turnover* if it must block the room | |
| Cleaning / reset gap after a booking | Turnover (minutes) | |
| Earliest a client may book (e.g. 2 h before) | Minimum notice (minutes) | |
| How far ahead the calendar opens | Booking window (days) | |
| Opening hours per weekday | **Availability** page → the space's week | Set BEFORE importing: rows outside hours are refused. |
| Closed dates, renovations | Space page → Unavailable dates | |

## 3. Money rules (per space, Pricing + Rules sections)

| Old-tool concept | Booklo field | Value to type |
|---|---|---|
| One hourly rate | Price per hour (flat) | |
| First hour X, every next hour Y | **Pricing rules → Bands**: from 0 min at X/h, from 120 min at Y/h (or a total for a fixed package) | |
| Half-day / full-day package price | Band with a *total* (e.g. from 240 min, total Z) | |
| Weekend / evening surcharge (+20 % Sat–Sun, after 18:00) | **Pricing rules → Surcharges**: %, weekdays, from–to | |
| Included people, extra person fee, hard maximum | **Pricing rules → People**: included / extra / max | |
| Priced extras | **Pricing rules → Extras** (see §1) | |
| Deposit: none / fixed amount / % / full prepayment | **Rules → Deposit** type + value | Bookero "100% online at booking" = *full*. |
| How long an unpaid reservation is held | Settings → Payments → *Hold for* (30 min / 1 h / 3 h / 24 h) | Org-wide, not per space. |
| Cancellation ladder (>72 h free, 48–72 h 50 %, <48 h 100 %) | **Rules → Cancellation policy** tiers | One reschedule allowed ≥48 h → same ladder applies; Booklo recomputes price on a move. |
| Regulamin / house rules the client must accept | **Rules → Terms** | Checkbox required on the public page when set. |
| Manual approval of every request | Space → *Require approval* | |
| Overtime per 30 min, extra cleaning, damage, confetti fee | Not a rule — **After-session charges** on the booking (detail dialog → Charges) | Collected by link or cash, or written off. |
| Pet deposit, key deposit | Either a fixed Deposit on the space or an after-session charge — decide per studio | |

Prices:

| Space | Flat rate / bands | Surcharges | People | Extras | Deposit | Cancellation tiers | Terms? | Approval? |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |

## 4. Things Booklo does differently — say them out loud

- **Prices are computed from rules at booking time and snapshotted.** A migrated booking is priced by the *new* rules; if the client paid a different amount in the old tool, import it as `paid=yes` (settled as a manual payment for the new price) or `paid=no` and fix the balance by hand.
- **Holds are timed and auto-expire**; there is no "reservation without payment" that lingers.
- **Equipment is exclusive.** Two rooms cannot both take the only lamp for the same hour — check how many physical items the studio really owns.
- **After-session money is added to the same booking**, not invoiced separately. Invoicing itself is out of scope (hand-off to Fakturownia/inFakt later).
- **Per-room equipment lists, equipment bookable alone, and nights/days pricing for a photo studio are not supported** — flag them here if the studio sells them: ______________________

## 5. Dropped rules

| Old rule | Why it does not carry over | Studio agreed (initials) |
|---|---|---|
| | | |
