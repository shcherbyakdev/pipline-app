# Booklo → studio booking operations: concept and decision brief

Date: 2026-09-07. Author: product-strategy pass for the solo founder. Status: **decision-ready, pre-implementation**. Feeds a later implementation plan; it is not an engineering backlog.

Labels used throughout: **[Observed]** = read on a primary source today, cited. **[Inference]** = reasoning from observations; can be wrong. **[Recommendation]** = what to do. **(proposed)** marks anything Booklo does not ship today.

Browsing worked for every source except Jammed's pricing page (HTTP 403 twice; its per-room price comes from a search snippet and a third-party listing, so treat it as provisional).

---

## 1. Recommendation: MODIFY the leading direction

**Keep the job. Narrow the buyer. Change what justifies the price. Do not assume Poland alone supports $100–200.**

The leading direction ("booking operations for independent photo/content studios, 3–10 rooms; keep availability, status, price, collection, changes and outstanding actions consistent through the lifecycle") is the right *job*. It is the wrong *price story* as stated, because in Poland that job is already sold for roughly one-fifth of the target price:

- **[Observed]** Bookero Premium is 89.90 PLN net/month (~$23) and includes online payments through seven providers (PayU, Przelewy24, Tpay, Stripe…), automatic cancellation of unpaid bookings after a time limit you set, pricing rules by date range / weekday / time of day / number of people, invoicing integration, recurring bookings, and calendar sync. Standard is 49.90, Basic 19.90. ([pricing](https://www.bookero.pl/cennik), [pricing rules](https://www.bookero.pl/news/stworzenie-zaawansowanego-cennika-za-pomoca-regul-cen), [payment expiry](https://www.bookero.pl/news/sposoby-rozliczania-platnosci-w-ramach-rezerwacji-cyklicznych), [features](https://www.bookero.pl/funkcje))
- **[Observed]** Calendesk, the other Polish tool a sampled studio runs on, is 197 PLN net/month (Standard) and 347 (Pro). ([Calendesk pricing](https://calendesk.com/pl/cennik/))
- **[Observed]** Fly Studio — five rooms across two locations, a textbook "3–10 rooms" studio — takes bookings and prepayment through Bookero and publishes 72h/24h cancellation tiers, +20–25 zł per extra person, and 50 zł/h equipment. ([Fly Studio](https://www.flystudio.com.pl/rezerwacja/))
- **[Observed]** Backstage (Rzeszów) runs on Calendesk with 100% prepayment, a 4-hour hold that auto-cancels if unpaid, and 72h/48h cancellation tiers. ([Backstage terms](https://backstagerzeszow.com/regulamin))

**[Inference]** Hold → prepay → auto-expire → tiered cancellation — the spine of the illustrative workflow — is *table stakes* in Poland at 50–200 PLN/month. A studio on Bookero is not paying 4–8× more for a nicer version of the same spine. That a studio publishes these rules is evidence the rules exist, not that the studio is unhappy with its software (Fly Studio and Backstage are evidence of adoption, not dissatisfaction).

**So what could justify $100–200?** Only work the current tools visibly do not do, for buyers whose cost of getting it wrong is high:

- **[Observed]** Bookero's feature page lists services assigned to employees; it does not describe rooms as bookable resources, a booking that requires several resources at once (a room plus a shared lamp), add-ons, partial deposits, or post-booking charges. A Bookero blog post says the system can ensure "equipment such as a projector is reserved together with the room", so multi-resource may exist in some form. ([features](https://www.bookero.pl/funkcje), [blog](https://www.bookero.pl/news/system-rezerwacji-sal-konferencyjnych-dlaczego-go-potrzebujesz)) — **unverified either way; gate 3 must settle it.**
- **[Observed]** Internationally, the $99–199 tier is precisely this: AllBooked Core $99 (3 spaces), Business $149 (15 spaces, equipment rentals, pricing rules, invoicing), Advanced $199 (approval rules, memberships). ([AllBooked pricing](https://www.allbooked.com/pricing))
- **[Observed]** The sampled studios sell *combinations*: MILK has four rooms plus a two-station make-up room, a projector by the day, backgrounds by the piece, an assistant by the hour, first-hour vs 2+-hour prices, and per-person surcharges ([MILK prices](https://www.milkstudio.com.pl/cennik/)); Podwale 7 sells four rooms and whole-venue events for up to 120 people, quote only ([Podwale 7](https://podwale7.pl/oferta-pl)); Fly Studio shares named lamps across rooms at 50 zł/h.

**[Recommendation]** Reframe the product as **compound-booking operations for multi-room studios**: rooms, whole-studio, shared equipment and people-count sold together, with prepayment, holds, change rules and after-session charges kept consistent, and a daily list of what still needs a human. Price it against Calendesk Pro (347 PLN net) in Poland and against AllBooked Business ($149) abroad — which means **$100–200 is credible internationally and only at the top of the band (≈400–800 PLN) in Poland**. Use Poland as the interview and pilot lab because you can sit in the studio; decide the wallet geography after gate 3.

**Confidence.** Moderate that the *job* is real for multi-room studios: five of five sampled studios publish rules that match it, two run it on software, two run it by hand, one is unknown. Low-to-moderate that Polish studios will pay ≥400 PLN/month for it: no willingness-to-pay evidence, and the incumbent price anchors are low. Unknown how many eligible studios exist — nobody has counted, and this brief does not invent a number.

---

## 2. Segment comparison

| | Photo / content studios (multi-room) | Rehearsal studios | Shared therapy rooms |
|---|---|---|---|
| **Buyer economics [Observed]** | 119–220 zł/h gross per room; per-person surcharges 10–25 zł; equipment 50 zł/h; cleaning 100–200 zł; 100% prepayment common. (MILK, Tipi, Fly, Backstage) | Not verified in this pass. Brief's own finding: several Polish operators advertise low hourly prices. | 30–40 zł/h; fixed weekly blocks billed monthly (rate × hours × 4.26, e.g. 511.20 zł for a 4-hour block); occasional use 40 zł/h. ([Żmijewska](https://zofiazmijewska.pl/gabinety/)) |
| **Illustration only [Inference, assumptions stated]** | 4 rooms × 140 zł/h × 200 billed room-hours/month ≈ 28,000 zł gross. A 600 zł subscription is ~2% of gross, ~4 room-hours. Utilisation and margin are unknown. | Lower hourly rates ⇒ a $100+ tool is a larger share of gross than in photo studios. | 3 rooms; even fully let at 35 zł/h × 15h × 30 days ≈ 47,000 zł is a ceiling nobody hits; realistic gross is far lower. $150 is a visible line item. |
| **Current alternative [Observed]** | Bookero (Fly), Calendesk (Backstage), Instagram + invoice + 5-hour payment window (Tipi), quote by email (Podwale 7). | Jammed: $20/room/month, no booking fees, 30-day trial (provisional — pricing page 403'd; [SoftwareAdvice](https://www.softwareadvice.com/scheduling/jammed-profile/), [jammed.app](https://jammed.app/en-us/pricing/)). Bookero recurring bookings on Standard 49.90 PLN. | An online panel with tenant login (vendor not identified) plus manual monthly billing. |
| **Competition at $100–200** | AllBooked $99/$149/$199 (studios, therapy clinics, coworking). CourtReserve $199+ is clubs, irrelevant. Booqable $29–149 is gear rental. | Jammed reaches $100–200 only at 5–10 online rooms; it is built for exactly this. | Coworking/office tools (not surveyed); nothing studio-specific found. |
| **Switching difficulty [Inference]** | Medium: future bookings and pricing rules must move; clients need no account (Booklo) so no client migration. Studios on Bookero have Polish payment rails they will expect to keep. | High: Jammed owns the niche and recurring band slots create lock-in. | High for the wrong reason: the product needed is tenant billing (memberships/credits), which the brief deprioritises and Booklo's account-free model does not fit. |
| **Product gaps to fill (proposed)** | Computed prices; holds + collection; compound resources; change consequences; after-session charges; daily action list; Polish. | Recurring slots (not built), band accounts, low price. | Recurring blocks, monthly invoicing, tenant portal. |
| **Solo-founder feasibility** | Good: extends shipped Spaces/units/EXCLUDE/approval; the additions are bounded. Support at 10–20 studios is manageable. | Poor: price war with a $20/room specialist. | Poor: a different product (billing), a smaller wallet. |
| **Verdict** | **Pursue, modified** | Reject | Reject for this price; park |

---

## 3. Ideal customer profile (behavioural)

**Include an operator who does all of the following** [Recommendation, built on Observed rules]:

1. Sells **three or more distinct rooms or spaces from one address** *and* sells **combinations** — whole-studio hire, room + shared equipment, room + make-up room — so one booking can touch several resources. (MILK, Fly, Podwale 7 pattern.) Combination selling is the trigger, not room count.
2. Requires **prepayment with a deadline** and publishes **time-tiered cancellation** (72h / 48h / 24h with 50% / 100%). (Backstage, Fly, Tipi.)
3. Charges **after-session amounts** — overtime rounded to 30 minutes, extra people, cleaning, damage — and has to collect them. (Backstage, Fly, Tipi, MILK.)
4. Takes **some bookings that need a human decision**: events, commercial shoots, animals, groups over the cap, unusual materials. (Backstage confetti/glitter rule, Tipi animals rule, Podwale 7 events.)
5. The **owner or one manager personally handles bookings daily**, on a phone, across Instagram, email and a booking tool.
6. Already pays for Bookero/Calendesk-class software or runs on DMs + invoices — i.e. has a current alternative to compare against.

**Exclude**:

- Single-room studios (Tipi-shaped: one room, Instagram bookings, 5-hour payment window). Bookero at 19.90–49.90 PLN is right for them; they will not pay 10× more.
- Rehearsal rooms and music studios (Jammed's niche; recurring band slots).
- Venues that only quote and contract events (Podwale 7 today) — that is a sales tool, not booking operations. Include them only if they *also* sell hourly.
- Anyone whose deciding need is memberships/credits, SMS, or external calendar sync (not shipped; do not promise).
- Multi-location chains needing staff roles and permissions (role enforcement is deferred).
- Studios that sell their own photo sessions with a photographer as the main product (MILK's 848.70 zł portrait sessions) *if* that is the bulk of their bookings — that is a person's time and the XOR constraint keeps it out (see §9).

---

## 4. Future product description (internal brief)

> **Booklo for studios (proposed).** Booking operations for multi-room photo and content studios. Clients book a room, the whole studio, or a room plus shared equipment from the studio's page or widget, without an account. Booklo computes the price from the studio's rules (room, duration tiers, people, weekday, extras), holds the slot until a payment deadline, collects the prepayment, and expires the hold if it lapses. When a client changes a date or extends a session, the price, the balance and the instructions are recomputed under the studio's own cancellation tiers. After the session, overtime, extra people and cleaning are added to the same booking and collected or written off. Every morning the studio sees one list: holds expiring, requests waiting for approval, balances due, changes to confirm. Conflicts between rooms, the whole studio and shared equipment are enforced in the database for every resource Booklo knows about.
>
> The booking page stays the entry point. The subscription is justified by work removed and errors prevented, not by features.

---

## 5. Why a buyer would choose Booklo

**Proven today (in shipped code)**
- Account-free client booking with tokenised cancel/reschedule links.
- Spaces with units, photos, prices as labels, terms; availability rules and overrides; approval flow; walk-ins and admin moves; email confirmations and reminders; Web Push; client directory; page builder with live previews; English and Ukrainian.
- No double bookings among resources Booklo knows about, enforced by a Postgres exclusion constraint — *not* protection against reservations made outside Booklo.

**Hypotheses (proposed; each is a gate item)**
- **Compound bookings with database-level conflict enforcement**: whole-studio ⊃ rooms; shared equipment as its own exclusive resource. Bookero's public material does not describe this; AllBooked charges $149 for equipment rentals. → *Reason to choose, if gate 3 confirms Bookero/Calendesk lack it.*
- **Money stays consistent through changes**: computed price, hold, prepayment, change consequences, after-session charges, balance — on one record. No competitor surveyed describes an after-session charge flow; none was tested hands-on.
- **The daily action list** as the product's home screen.
- **Assisted migration** as part of the price (a service, not software).
- **Polish setup, booking and email** at parity with Bookero/Calendesk (today: not shipped; a hard requirement for a Polish buyer).

**Where competitors are ahead today** (say so internally; do not paper over it): online payments via Polish rails, SMS, calendar sync, invoicing integration, customer accounts for repeat business. Booklo ships none of these. The first three are "not available today" in the brief's own list.

**Versus each named alternative**
- *Bookero*: cheaper by 4–8×, Polish rails, timed holds already. Booklo wins only on compound bookings + lifecycle money + account-free clients, and only for studios that sell combinations.
- *Jammed*: per-room pricing, rehearsal focus. Not a photo-studio competitor in Poland; avoid its niche.
- *AllBooked*: the price anchor abroad. Booklo's edges: account-free booking (AllBooked's customer-account model is unverified), the action list, and a much narrower product that is faster to set up. AllBooked's edges: memberships, maps, approval rules, integrations, a decade of features.

---

## 6. Minimum complete workflow that could justify the subscription

**Exists today** — hosted page + widget; spaces with units, photos, terms, price labels; availability + overrides; booking with approval flow; walk-ins, admin moves, reschedule; token links; confirmations and reminders by email; Web Push; client directory; entitlements; en/uk.

**Necessary additions (proposed) — all six, or the subscription has no story**

1. **Computed price** at booking: room rate × duration tiers (first hour vs. subsequent), people-count surcharge, weekday/time rules, extras with their own unit (per hour / per day / per piece). Today prices are labels.
2. **Hold with deadline + prepayment collection**: the hold occupies the slot (the existing exclusion constraint), expires by a job, and the payment is collected by the provider's own processor account so Booklo never holds client money. Rail choice is an unresolved decision (§13).
3. **Compound resources**: a whole-studio booking blocks every room; shared equipment is a unit with its own exclusion; a booking can carry several resources. Extends the current space/unit model.
4. **Change consequences**: cancel/reschedule/extend under the studio's tiers → recomputed fee, refund or balance, and refreshed instructions in the email.
5. **After-session charges and settlement**: overtime, extra people, cleaning, damage on the same booking; balance due; collected, written off, or escalated.
6. **Polish** across setup, booking and email (next-intl is in place; add `pl.json` and PLN formatting) and **assisted migration** as an onboarding service.

**Later possibilities (do not build before a paying pilot asks)**: invoicing hand-off to Fakturownia/inFakt rather than native invoicing — Poland's mandatory KSeF e-invoicing makes native invoicing a trap for a solo founder (verify current KSeF status before deciding); SMS as a pass-through cost; external calendar sync (built, unreleased); quotes for events; staff roles.

---

## 7. Pricing hypotheses

**Unit charged [Recommendation]**: **per studio location**, with a cap on rooms/units (10, matching the Team plan's ten resources), unlimited bookings, unlimited services. Not per room (Jammed's model makes a 3-room studio cheap and a 10-room one expensive, and invites "keep rooms offline"). Not per booking (punishes success, muddles with payment fees). Payment processing fees pass through at cost to the provider's processor.

**Included**: computed pricing, holds + collection, compound resources, change rules, after-session charges, daily action list, email + push, Polish/English/Ukrainian, assisted migration at onboarding, one location. Support by email with a named human.

**Price bands (hypotheses, not evidence)**
- Poland: **349–499 PLN net/month**, anchored between Calendesk Standard (197) and Pro (347) with a reason to be above Pro. This is $85–125 — the bottom of the target, not the middle.
- International (EN, EU/UK): **$99–149/month**, at or under AllBooked Core/Business, positioned as narrower and faster.
- Onboarding: **one-time 500–1000 PLN migration fee, waived on annual prepay** — protects the founder's hours if a studio churns at month three.
- Early customers: founder price locked for life (the existing Founder ribbon mechanism) — but only *after* a full-price "yes".

**Do not** treat AllBooked's $99–199 or Calendesk's 197–347 as proof of Polish willingness to pay; they prove those vendors' price lists, nothing about switching.

**How to test willingness to pay**
1. In every interview, *after* walking the workflow, ask what they pay today and run a four-point price ladder (too cheap / bargain / getting expensive / too expensive) on the *monthly* number for the described product.
2. Ask the switching question directly: "What would have to be true for you to move off Bookero next month?" Record the answer verbatim.
3. Offer **three paid pilots**: 50% of the target band for three months, migration included, prototype-level features. Money changing hands before the build is the only WTP evidence that counts.
4. At month three, ask the pilot to pay full price. A "yes" from ≥1 of 3 is the first real data point.

---

## 8. Acquisition hypothesis

**[Observed]** Studios are findable: they publish prices, rules and their booking tool on public pages, and two of the five sampled route bookings through Instagram. **[Inference]** The owner answers those DMs.

**Plan (assumption-labelled, not a forecast)**
1. **Build the list** — Google Maps and Instagram for "studio fotograficzne do wynajęcia" in Warsaw, Kraków, Wrocław, Poznań, Gdańsk, Łódź, Rzeszów. Record rooms, published rules, and the booking tool visible in their pages. Sort by combination-selling + prepayment rules + ≥3 rooms. The count of eligible studios is *the first output*, not an input.
2. **Reach** — one specific message per studio that quotes their own rules back ("your 4-hour hold and 72/48h tiers, whole-studio hire and the shared lamp — that is exactly the flow") and asks for 30 minutes on site. In person in Kraków/Warsaw first (matches the existing H0 interview plan).
3. **Make switching practical** — assisted migration: import future bookings, rebuild pricing rules together on a call, run Booklo in parallel with Bookero for two weeks (Booklo page linked from Instagram; Bookero kept until the first month is clean), then switch the link.
4. **Planning arithmetic** (assumption): 100 studios listed → ~30 replies → ~10 interviews → 3 pilots → 1–2 paying. That is one founder-month of outreach for one or two customers; ten to twenty customers at 400–600 PLN is the $1–3k MRR goal already on record.

**Costs at this price**: onboarding one multi-room studio is several founder-hours; expect to be on call for the first weeks. Twenty customers is sustainable solo; fifty is not without tooling or help. The model is boutique by design.

---

## 9. Changes to principles, positioning and scope

**Positioning** moves from *"Booking page & widget for appointments and spaces"* (horizontal, free, Calendly-adjacent) to *"Booking operations for multi-room studios"* (vertical, paid). The hosted page and account-free client flow remain the entry point and the brand hero.

**Appointments channel [Recommendation]**: freeze — keep it running (shipped, tested), stop investing, stop marketing it. Do not delete; do not spend a week on it. Decide later whether it is a free top-of-funnel or retired.

**XOR constraint**: **preserve.** The studio ICP is spaces-only. Revisiting would cost the `0073` schema rule, mode/nav logic, page and widget composition, the shared resource budget, and every surface built under "reads wrong for a room or a person" — weeks of solo work for no evidenced demand. The one real edge — a studio selling its own photographer-led sessions (MILK) — is a person's time inside a room; handle it as the studio's own *product* booked into the room with a fixed price, or leave it off-platform. Unresolved decision, not a reason to reopen XOR.

**Principles, revised**
1. ~~Both channels are first-class~~ → **Spaces first.** A surface that reads wrong for a room is wrong.
2. ~~Claim to bookable in minutes~~ → keep for the page; for the studio buyer the promise is **"nothing falls through"**, and setup is assisted, not instant.
3. **Clients never need an account** — keep; a differentiator against the tenant-login model and (unverified) against AllBooked/Jammed.
4. Plan limits never turn a client away — keep.
5. Hold as little as possible; the provider is the merchant; money through the processor — keep; it is exactly the constraint under which holds and collection must be built.

**Scope**: Free tier is not for studios (trial + pilot instead). Marketing copy still must not mention Google, calendar sync, Stripe or payment capability as available until shipped. Polish localisation becomes a launch requirement for this buyer, reversing the "English only" ruling.

---

## 10. Evidence gates before implementation

| Gate | What must be established | Pass condition |
|---|---|---|
| **G1 Problem interviews** — 8–12 multi-room studios, ≥4 on Bookero/Calendesk, ≥3 manual | Hours per week on holds, payments, changes, after-charges; incidents in the last 90 days (double-booked combination, mishandled hold, uncollected overtime/cleaning); current tool and spend; whether they sell combinations; who does the work | ≥5 of 10 report ≥1 costly incident/month **or** ≥3 h/week, **and** ≥4 sell combinations |
| **G2 Workflow observation** — 2–3 studios, half a day on site or a screen-share of their tool and inbox | The real states a booking passes through and where it breaks | Observed states fit the §4 lifecycle and need no more than the six §6 additions |
| **G3 Hands-on competitor test** — trials of Bookero, Calendesk, AllBooked | Can they do (i) room + shared equipment in one booking with conflicts checked, (ii) whole-studio blocking rooms, (iii) partial deposit + balance, (iv) after-session charges? What does migration *out* of them look like? | If Bookero or Calendesk does (i)–(iv) at ≤200 PLN, the Polish price hypothesis is dead; keep only the international path or reject |
| **G4 Rails check** | Provider-side collection with Polish methods (Przelewy24/BLIK) under the "provider is merchant" principle; processor availability for Polish sole traders | A documented, tested path — or a change of principle, decided explicitly |
| **G5 Paid pilot** — 3 studios | Money before the build; one migrated; 30 days live on prototype features | ≥2 stay past 30 days; ≥1 pays full band at month three |

Order: G1 and G3 in parallel (two weeks), G2 with the interviewees who bite, G4 alongside, G5 only after G1–G4 pass. No feature work on §6 until G3 has an answer.

---

## 11. Failure signals and alternative shifts

| Signal | Meaning | Shift |
|---|---|---|
| G1: <30% report costly incidents; "Bookero is fine" | The job is served; the wedge is UX only | Reject the Polish ops thesis. Either go **international-only** (AllBooked-priced, English studios) or return to a cheap page and accept solo-unfriendly economics |
| G3: Bookero/Calendesk handle compound bookings and after-charges | Differentiation collapses to account-free + polish | Same as above; do not build §6 for Poland |
| Eligible list < ~60 studios nationwide | Boutique is too boutique | International from day one, Poland as lab only |
| Pilots refuse > 200 PLN | Band is wrong for Poland | Reprice to 149–249 PLN, need 3× the customers — check solo support load before agreeing |
| Pilots churn for missing SMS / calendar sync / invoicing | "Later" items are actually gates | Promote the one that killed the pilot into §6; re-run G5 |
| Studios keep quoting events by email despite the tool | The event side is a sales/contract job | Consider a quote-to-contract tool for venues (Podwale 7 shape) as a *separate* product decision, not a feature |
| Therapy-room operators keep asking | A tenant-billing market exists | Park it; it needs memberships/credits and monthly invoicing — a different product |

---

## 12. Concept brief (compact)

- **Buyer**: the owner-operator of a multi-room photo/content studio who sells rooms, whole-studio and shared equipment together, takes prepayment with deadlines, charges after the session, and handles bookings personally every day.
- **Costly recurring problem** (hypothesis to prove in G1): keeping price, hold, payment, changes and after-charges consistent across several resources and channels; each miss is a refund, a free day, an uncollected fee, or an hour of the owner's evening.
- **Product** (proposed): Booklo's account-free page and DB-enforced conflicts, extended with computed prices, holds + collection, compound resources, change consequences, after-session settlement, a daily action list, and Polish.
- **Reason to choose over Bookero/Calendesk/AllBooked**: compound bookings enforced in the database plus one money record through the whole lifecycle plus account-free clients — *if* G3 shows the incumbents lack it.
- **Price** (hypothesis): per location, up to 10 rooms/units, 349–499 PLN net in Poland, $99–149 abroad; migration fee waived on annual.
- **Acquisition**: a hand-built list of Polish studios, rule-quoting outreach, on-site interviews, assisted migration, three paid pilots.
- **Scope changes**: spaces first; appointments frozen; XOR preserved; Polish required; free tier not for studios.
- **Gates before code**: G1 interviews, G3 hands-on competitor test, G4 rails, G2 observation, G5 paid pilot — in that order.

## 13. Unresolved decisions an implementation plan must settle

1. **Geography and band** — Poland-only at 349–499 PLN, international at $99–149, or both from day one (two price lists, two support languages).
2. **Payment rail** — provider-side collection with Polish methods under "provider is merchant"; which processor, and whether Booklo ever touches a refund.
3. **Hold semantics** — a hold is a provisional booking occupying the slot under the exclusion constraint with an expiry job; what happens to a hold that expires after a partial payment.
4. **Appointments channel** — frozen, free funnel, or retired; and what the landing page says meanwhile.
5. **Studio-owned sessions** (person + room) under XOR — product-in-room, off-platform, or ignored.
6. **Invoicing** — hand-off to a Polish invoicing provider (KSeF-compliant) at launch, or none.
7. **Migration** — tooling (import from Bookero/Calendesk exports, if they exist) vs. manual per pilot.
8. **Onboarding fee and annual prepay** — whether to charge, and how it interacts with founder pricing.
9. **SMS** — pass-through or absent; several studios' clients are booking from a phone.
10. **Sequencing** — which of the six §6 additions the paid pilot needs on day one versus day thirty.
