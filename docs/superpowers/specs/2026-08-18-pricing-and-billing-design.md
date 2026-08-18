# Pricing & Billing — monetization strategy + billing slice

**Date:** 2026-08-18
**Status:** Draft — pending Andrii's review (strategy discussed in chat; plan ladder accepted, prices/limits are proposals)
**Type:** Strategy (why/what we charge for) + design of the first billing slice (how). Follow-up product slices (Google Calendar sync, intake questions, reminder schedules, SMS, deposits) get their own specs.
**Parent:** `2026-08-13-scheduling-pivot-vision-and-roadmap-design.md` ("No payments at MVP … Stripe is a later slice") and `2026-08-17-team-staff-design.md` (staff is the Team lever).
**Base:** `main` @ `fecf09e` (PR #39 merged; last migration `0041_staff_security.sql`; rentals parked behind `RENTALS_ENABLED`).

## 1. Goal

Turn Booklo from "free during early access" into a product that earns **$1–3k MRR as the first target, with a ladder that scales** without re-architecting. Solo builder, no marketing budget, no sensitive-data appetite (card data must never touch our servers).

Success for this slice: a Free / Pro / Team ladder is live, a provider can upgrade and manage their subscription self-serve, plan limits are enforced server-side, and MRR is readable from SQL.

## 2. Market position (why the ladder looks like this)

The floor in this category is **free**: Calendly Free, Setmore Free, Square Appointments Free, Fresha (no subscription), Google/Microsoft Bookings bundled. "A booking page exists" is worth $0. What providers *pay* for, in order: more staff/calendars, fewer no-shows (reminders, SMS, deposits), their own brand (no vendor badge), calendar sync, volume.

Verified anchors (2026): Calendly Standard $12/seat monthly ($10 annual), Teams $20 ($16 annual); Acuity Emerging $16, Growing $27 (SMS, up to 6 staff), Powerhouse $49; SimplyBook.me Free = 50 bookings/mo, Basic ≈ $10, Standard ≈ $25 (500 bookings).

Booklo's differentiators today: no client accounts, DB-guaranteed no double-booking, self-resizing embed, multi-staff with in-DB auto-assign, brand basics, minimal data. Its gap for a paid solo tier: Google Calendar sync (S4 was skipped) — table stakes for consultants/coaches, less so for salons/studios where staff count is the lever. Hence: **Team is the paid lever from day one; Pro gets its headline feature (Google Calendar) in the next slice.**

## 3. Plan ladder

USD list prices; Stripe (as Merchant of Record) can present local currency via Adaptive Pricing. All numbers are proposals Andrii can change without touching the design — they live in one constants module (§7.3).

| | **Free** | **Pro** — $12/mo · $9/mo annual ($108/yr) | **Team** — $29/mo · $24/mo annual (5 staff incl.) |
|---|---|---|---|
| Publicly bookable staff | 1 (primary) | 1 | 5 (extra seats +$5/staff — follow-up, see §8) |
| Publicly offered services | 3 | unlimited | unlimited |
| Bookings / month | reminders for the first **30**; confirmations always | unlimited | unlimited |
| Hosted page + embed | ✅ (deliberately free — it is the distribution) | ✅ | ✅ |
| Cancel/reschedule links, double-book guard, confirmations | ✅ never gated | ✅ | ✅ |
| Reminder | 1 fixed (24h) | custom schedule 🔨 | same |
| "Powered by Booklo" on page + emails | shown | removable | removable |
| Brand basics (logo, colour, welcome, theme) | ✅ | ✅ | ✅ |
| Google Calendar 2-way sync | — | ✅ 🔨 | ✅ |
| Intake questions per service | — | ✅ 🔨 | ✅ |
| Team layer (per-staff pages, "Anyone available", staff colours/filter/notices) | — | — | ✅ (shipped, #39) |
| Staff logins & permissions | — | — | 🔨 later |
| SMS reminders | — | metered add-on 🔨 | same |
| Deposits (Stripe Checkout) | — | 🔨 later; ~1 % platform fee on Free, 0 % Pro/Team | same |

🔨 = not shipped; not gated by this slice (the entitlement flags exist so the follow-up slices only read them).

**Founder price:** Pro at **$8/mo, locked for life**, for the first 100 orgs — offered to every org created before the public launch date, honouring the landing's "early users will hear first". Implemented as a Stripe `forever` coupon + promotion code with `max_redemptions: 100`, applied server-side at checkout (§7.6); no schema.

**Rejected models** (kept for the record):
- *Per-seat only* — zero uplift on the core solo persona.
- *Per-booking pricing* — unpredictable for the customer, metering + invoicing pain for us; kept only for the SMS add-on later.
- *Take-rate only* (Fresha/Square) — needs payments first; becomes an *extra* lever with the deposits slice, never the base.
- *Lifetime deal / AppSumo* — cash now, no compounding, heavy support; the Founder price does the same job for the existing base.
- *Trials* — not at launch; monthly plans are cheap and cancellable, and Free already lets you try the whole solo product. Revisit for Team if conversion says so.

## 4. Principles (the rules the code enforces)

1. **Never turn a client away.** No plan limit ever blocks a public booking, a confirmation, or a manage link. Limits act on the *provider's* side.
2. **Limits shape the public offering; nothing is deleted.** On Free the booking page offers the primary staff and the first 3 services (by `sort_order`); on downgrade, over-limit staff/services simply stop being publicly bookable. Data, history and admin views stay intact. This also closes the "subscribe one month, add 10 staff, cancel" loop with no engine change.
3. **Free's volume cap = reminders.** Confirmations always send; reminder emails are included for the first 30 bookings each calendar month (org timezone). Past that, reminders are suppressed for that org until the month rolls over. Reminders are the provider's no-show insurance — the exact thing Pro sells.
4. **Our DB is a cache of the provider's truth.** `org_subscriptions` is written only by the webhook route; entitlements are computed from that row; the request path never calls the billing provider.
5. **Provider behind a seam.** One adapter interface (`src/lib/billing/provider.ts`), a Merchant-of-Record adapter for production, a fake for dev/tests — the email transport idiom.
6. **Behind a compile-time flag** (`BILLING_ENABLED` in `src/lib/flags.ts`, false until launch). While false: no gates, no nav item, no pricing page — early access continues exactly as today.

## 5. The math

**Customer side (the pricing-page argument).** A solo doing 60 bookings/mo at $60 avg books $3,600/mo. Industry no-show rates run ~10–20 %; reminders cut them by roughly a third; deposits far more. At 12 % → ~7 no-shows → ~$430/mo lost; one extra reminder recovering a third → ~$140/mo. Pro at $12 pays for itself ~12×. Line: *"Pro costs less than one no-show."* Team: one extra chair filled via "Anyone available" pays the month.

**Business side.** Fixed: Vercel Pro $20 + Supabase Pro $25 + Resend $0–20 + domain ≈ **$50–70/mo**. Stripe Managed Payments ≈ 3.5 % MoR add-on + processing + Billing ≈ 7–9 % all-in → we keep ≈ $11.00 of $12 (Paddle 5 % + $0.50 ≈ $10.90; Stripe direct ≈ $0.70 in fees but we would own VAT/OSS filing — not worth it solo). Variable per Pro org: ~3.5 emails/booking × 100 bookings ≈ 350 emails ≈ $0.15/mo. **Gross margin ≈ 90 %. Break-even ≈ 6 Pro subscribers.**

Assumptions: free→paid 3 % (freemium norm 2–5 %), blended ARPU ≈ $15 (¾ Pro incl. annual mix, ¼ Team), logo churn 5 %/mo monthly, ~2.5 % annual.

| Target | Paying orgs | Signups needed (3 %) | New paying/mo just to offset 5 % churn |
|---|---|---|---|
| $1k MRR | ~67 | ~2,200 | ~3–4 |
| $3k MRR | ~200 | ~6,700 | ~10 |
| $10k MRR | ~670 | ~22,000 | ~33 |

LTV ≈ 15 × 0.90 / 0.05 ≈ **$270** on monthly; annual roughly doubles it → the checkout defaults to annual. With no ad budget CAC is time; paid acquisition only makes sense under ~$80/customer.

Badge loop (measure, don't trust): a free org's page gets ~40–80 views/mo; if 0.3–1 % of viewers are providers who click through, that is 0.1–0.8 new orgs per free org per month — k < 1, so not viral alone, but it multiplies every other channel over ~6 months. The badge link carries `?ref=badge&org=<handle>` so this is measurable from day one.

## 6. Provider choice — **Stripe Managed Payments** (decided 2026-08-18)

Andrii sells as a Polish JDG. Being the seller of record ourselves would mean EU VAT-OSS above €10k/yr cross-border B2C, UK VAT registration from the first UK consumer sale, consumer invoicing, disputes and dunning — more accountant time than the fee difference at $1–3k MRR. So: **Merchant of Record**, and the MoR is **Stripe Managed Payments** — Stripe is the seller of record (tax, fraud, disputes, transaction-level support), we keep Stripe Checkout + Billing + Customer Portal + webhooks. Verified: `PL` is a supported business location; SaaS is an eligible category (product tax code `txcd_10103001`, "SaaS – business use"); fee = 3.5 % add-on + standard processing + Billing pay-as-you-go ≈ 7–9 % all-in; access is by eligibility review (apply early — §7.12). Constraint to remember: Managed Payments does not support Stripe Connect, which the deposits slice will need (§8).

**Fallback: Paddle** (5 % + $0.50, mature, pays out to Poland) if the review stalls or rejects. Rejected: Lemon Squeezy (being migrated into Stripe Managed Payments), Polar (same price as Paddle at our scale, younger), Stripe direct + Stripe Tax (cheapest fees, but we would file OSS/UK VAT ourselves).

The seam (§7.1) makes the provider a one-file change either way. Accountant questions to settle in parallel (not design decisions): VAT‑UE registration to invoice Stripe's Irish entity while VAT-exempt; the ryczałt rate for SaaS revenue.

## 7. Billing slice design

### 7.1 Provider seam — `src/lib/billing/provider.ts`

```ts
type PlanId = "pro" | "team";
type Interval = "month" | "year";

interface BillingProvider {
  /** Hosted checkout for an org. Returns a URL to redirect the admin to. */
  createCheckoutUrl(input: {
    orgId: string; plan: PlanId; interval: Interval;
    email: string; discountCode?: string; returnUrl: string;
  }): Promise<string>;
  /** Provider-hosted "manage subscription" portal (update card, cancel, switch interval). */
  createPortalUrl(providerCustomerId: string): Promise<string>;
  /** Verify signature and normalise one webhook request into events. Throws on bad signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[];
}

type BillingEvent = {
  providerEventId: string;          // idempotency key
  occurredAt: string;               // ISO, from the provider payload
  orgId: string;                    // from checkout custom data
  type: "subscription_created" | "subscription_updated" | "subscription_cancelled"
      | "subscription_expired" | "payment_failed" | "payment_recovered";
  subscription: {
    providerCustomerId: string; providerSubscriptionId: string;
    plan: PlanId; interval: Interval; seats: number;   // seats: 1 for pro; 5 (+extra later) for team
    status: "active" | "past_due" | "cancelled" | "expired";
    currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
  };
};
```

`selectBillingProvider()` (same file): `env.BILLING_PROVIDER === "stripe"` → `stripe.ts`; anything else → `fake.ts`. The fake's `createCheckoutUrl` returns `/dev/billing/checkout?org=…&plan=…&interval=…&return=…[&customer=…]` and its `createPortalUrl` returns `/dev/billing/portal?return=…` — two **non-production-only** pages (the emulator, see Implementation notes) whose server actions emit the same `BillingEvent`s Stripe would and apply them through the same `applyBillingEvents`, rather than writing the subscription directly (guarded by `process.env.NODE_ENV !== "production"`, `env.BILLING_PROVIDER !== "stripe"`, `BILLING_ENABLED`, and membership of the `org` in the URL; 404 otherwise). Its `parseWebhook` accepts our own normalised JSON signed with `BILLING_FAKE_SECRET` (HMAC-SHA256 hex in `x-signature`) — that is what integration tests post.

**`stripe.ts` (Stripe Managed Payments adapter)** — the only file that imports the official `stripe` npm SDK (server-only; chosen over bare `fetch` for signed-webhook parsing, API versioning and types — a deliberate exception to the Resend bare-fetch idiom, contained behind the seam):
- `createCheckoutUrl` → `checkout.sessions.create` in `subscription` mode with Managed Payments enabled per Stripe's set-up guide, `line_items: [{ price: <STRIPE_PRICE_*>, quantity: 1 }]`, `client_reference_id: orgId`, `metadata.org_id` **and** `subscription_data.metadata.org_id` (so every later `customer.subscription.*` event carries the org without a lookup), `customer_email`, `discounts: [{ promotion_code }]` when a Founder code applies, `success_url = returnUrl`, `allow_promotion_codes: false`. Products carry tax code `txcd_10103001`.
- `createPortalUrl` → `billingPortal.sessions.create({ customer, return_url })` (portal configuration allows cancel, interval switch, payment-method update; plan switching between Pro/Team is done in the portal too — the webhook reflects it).
- `parseWebhook` → `stripe.webhooks.constructEvent(rawBody, headers["stripe-signature"], STRIPE_WEBHOOK_SECRET)`; maps `customer.subscription.created|updated|deleted` → `subscription_created|updated|expired`, `invoice.payment_failed` → `payment_failed`, `invoice.paid` (billing_reason ≠ `subscription_create`) → `payment_recovered`; ignores everything else (incl. `checkout.session.completed` — the subscription events are the source). `providerEventId = event.id`, `occurredAt = event.created`. Status mapping: `active|trialing` → `active`; `past_due` → `past_due`; `canceled|unpaid|incomplete|incomplete_expired|paused` → `expired`; `cancel_at_period_end` copied as-is (Stripe keeps `active` until the period ends, so our `cancelled` status is only produced by providers that model it explicitly — Paddle). `plan`/`interval` from the price id (reverse map of the env table); `seats` = line-item quantity for Team.

Plan ↔ price ids are env (`STRIPE_PRICE_PRO_MONTH`, `…_PRO_YEAR`, `…_TEAM_MONTH`, `…_TEAM_YEAR`); the adapter maps both directions.

### 7.2 Data model — migrations `0042_<generated>.sql` + `0043_billing_security.sql`

Drizzle: new `src/db/schema/billing.ts` (added to the barrel). Custom SQL follows the repo idiom (idempotent, explicit grants, RLS, `search_path=''`).

**`org_subscriptions`** — one row per org that has ever subscribed; **absence = Free**.

| column | type | notes |
|---|---|---|
| org_id | uuid pk → orgs cascade | |
| plan | text not null | CHECK in (`'pro'`,`'team'`) — Free is the absence of an effective row |
| status | text not null | CHECK in (`'active'`,`'past_due'`,`'cancelled'`,`'expired'`) |
| interval | text not null | CHECK in (`'month'`,`'year'`) |
| seats | int not null default 1 | bookable-staff allowance for Team; 1 for Pro |
| provider | text not null | `'stripe'` / `'fake'` |
| provider_customer_id | text not null | |
| provider_subscription_id | text not null | unique |
| current_period_end | timestamptz null | |
| cancel_at_period_end | bool not null default false | |
| provider_updated_at | timestamptz not null | ordering guard for out-of-order webhooks |
| created_at / updated_at | timestamptz | |

Effective plan (SQL and TS agree, one rule): `status in ('active','past_due')` **or** (`status = 'cancelled'` and `current_period_end > now()`) → `plan`; otherwise Free. `past_due` keeps access while the provider retries (dunning is theirs); `expired` is the provider's word for "retries exhausted / period over".

**`billing_events`** — webhook audit + idempotency: `id uuid pk`, `provider text`, `provider_event_id text` (unique with provider), `org_id uuid null` (null when unresolvable — still recorded), `type text`, `payload jsonb`, `error text null`, `received_at timestamptz`. Retention is not this slice's problem.

RLS + grants: `org_subscriptions` — org members `select` via `user_orgs()`; **no** authenticated insert/update/delete policies; `grant select … to authenticated; grant all … to service_role`; anon nothing. `billing_events` — service_role only. The webhook route and the fake checkout write with `createAdminClient()` (service role) — the reminder-drain precedent. No definer RPC needed: there is no cross-table invariant to protect and no client-driven write.

Index for the monthly usage count: `bookings (org_id, created_at)` (0043). A **SQL view `billing_mrr`** (service_role only) sums effective subscriptions by plan × interval at list price — the founder's MRR dashboard until there is a real one; a copy of the query goes to `supabase/snippets/mrr.sql`.

**`0042/0043` take the numbers the parked R3 plan reserved** — R3 renumbers again when un-parked (note added to `rentals-r3` memory).

### 7.3 Plans + entitlements module — `src/lib/billing/plans.ts`, `entitlements.ts`

`plans.ts` is the single source of truth for what the pricing page shows and what the code enforces:

```ts
export const PLANS = {
  free: { name: "Free", monthly: 0, yearly: 0,
          limits: { bookableStaff: 1, publicServices: 3, reminderBookingsPerMonth: 30, hideBadge: false,
                    customReminders: false, gcalSync: false, intakeQuestions: false } },
  pro:  { name: "Pro",  monthly: 12, yearly: 108,
          limits: { bookableStaff: 1, publicServices: null, reminderBookingsPerMonth: null, hideBadge: true,
                    customReminders: true, gcalSync: true, intakeQuestions: true } },
  team: { name: "Team", monthly: 29, yearly: 288,
          limits: { bookableStaff: 5 /* = seats */, publicServices: null, reminderBookingsPerMonth: null, hideBadge: true,
                    customReminders: true, gcalSync: true, intakeQuestions: true } },
} as const;
```

`entitlements.ts`:
- `entitlementsFor(row: OrgSubscriptionRow | null, now: Date): Entitlements` — pure; applies the effective-plan rule, substitutes `seats` for Team's `bookableStaff`. Unit-tested.
- `getEntitlements(orgId, client)` — one `select` on `org_subscriptions`, called with the RLS client in dashboard actions/pages and with the admin client on public/drain paths. Wrapped in React `cache()` for the request.
- `monthlyBookingUsage(orgId, timeZone, now, admin)` — `count(*)` of `bookings` where `org_id = ? and rescheduled_from_id is null and created_at >= <month start in org tz>` (reschedules don't double-count; cancelled bookings still consumed the slot — "bookings made this month", the SimplyBook definition). Also drives the usage meter on `/billing`.

### 7.4 Gates (all server-side; every refusal carries an upgrade CTA)

| Where | Rule | Refusal |
|---|---|---|
| `createStaff` (`staff-actions.ts:44`) and `setStaffActive(true)` | count(active staff) ≥ `bookableStaff` → refuse | `'plan_limit'` → "Team members are on the Team plan" / "Your plan allows N team members" |
| `createService` (`actions.ts:63`) | count(services) ≥ `publicServices` (Free: 3) → refuse | "Free includes 3 services — upgrade for unlimited" |
| Public offering — `src/lib/booking/public.ts` (`listPublicServices`, `listPublicStaff`, `loadOrgSlotContext`) | services = first `publicServices` active by `sort_order`; staff = first `bookableStaff` active by `sort_order`, intersected with `service_staff` | none — the page shows what the plan allows |
| `createBooking` / `getSlots` (`public-actions.ts`) | staff not in the bookable set → treated as ineligible (existing `staff_unavailable` path); **`p_staff_id` is null only when the bookable set has > 1 members**, otherwise the single bookable id is passed explicitly, so DB auto-assign never picks a non-bookable staff | existing copy |
| `/book/[handle]/[staffSlug]`, `?staff=` on embed | slug not in bookable set → `notFound()` / falls back to org flow (the deactivated-staff rule) | — |
| Badge | hosted `/book` page (both routes) gets the same footer `<p>` the embed already has; embed keeps its own; every client-facing template in `templates.ts` gets a `Powered by Booklo` line after the footer `<p>` (and in `text`); all three render iff `!(theme.hidePoweredBy && ent.hideBadge)` | — |
| `hidePoweredBy` toggle (`widget-appearance.tsx:239`) | disabled + "Pro" pill on Free; stored value is kept, just ineffective (`update_org_widget_theme` unchanged) | — |
| Reminder drain (`reminders.ts`) | per candidate: if org is Free and `monthlyBookingUsage ≥ 30` → `"suppress"` (stamped like the in-window suppress; not re-scanned). One count per distinct org per tick (≤ 25 rows) | — |
| Overview / dashboard shell | Free: pill "Free · 24/30 reminders this month" in the sidebar footer; ≥ 24 → banner; over-limit after downgrade → persistent banner "Your plan allows 1 team member; Anna and Ben aren't bookable publicly" | — |

Not gated (deliberately): walk-ins and admin reschedules to *any* active staff, calendar/list views, clients directory, stats — the admin can always run what they already have.

Grandfathering at flip: existing orgs with > 3 services or > 1 staff keep everything; only the public offering narrows (announced by email ≥ 14 days before, per the FAQ promise) and the Founder code makes staying whole $8.

**Trade-off, accepted:** the creation gates are enforced in TypeScript actions, not DB triggers. A logged-in member could bypass them with a hand-crafted PostgREST call, but the *public offering* filter (the thing that actually delivers value) is server-side on the admin-client path and cannot be bypassed. If abuse shows up, `create_staff` and a `services` insert trigger read `org_subscriptions` — a follow-up, not a redesign.

### 7.5 Webhook — `src/app/api/billing/webhook/route.ts`

`POST` only. Raw body read before parsing (signature is over bytes). `provider.parseWebhook()` → 401 on bad signature; 503 when the provider secret is unset (fail closed — the drain-auth idiom). For each event, in order of `occurredAt`:
1. `insert into billing_events` — on unique-violation (already processed) skip silently.
2. Resolve `orgId`; unknown org → record with `error`, return 200 (never make the provider retry a bug).
3. Upsert `org_subscriptions` **only if** `event.occurredAt > provider_updated_at` (out-of-order guard); `subscription_expired` → `status='expired'`; `payment_failed` → `past_due`; `payment_recovered` → `active`.
4. Return 200 with `{ processed, skipped }`.

Idempotent and safe to replay; no email is sent from the webhook (the provider mails receipts/dunning). `revalidatePath("/billing")` after writes.

### 7.6 Checkout + portal — `src/features/billing/actions.ts`

- `startCheckout({ plan, interval })` — `requireOrg()`, member email from session, `discountCode = env.BILLING_FOUNDER_PROMO_CODE` (a Stripe Promotion Code on a `forever` coupon, `max_redemptions: 100`) when `org.created_at < env.BILLING_FOUNDER_CUTOFF` (ISO date) — else undefined; `returnUrl = /billing?checkout=success`; redirect to the provider URL. Never trusts client-provided prices.
- `openPortal()` — requires an `org_subscriptions` row; redirect to `createPortalUrl(provider_customer_id)`.
- Downgrades, card changes, cancellations, interval switches all happen in the provider portal — we do not build those screens.
- Anyone who is an org member may buy for the org (roles are not enforced anywhere else yet; when they are, `owner`/`admin` gates this).

### 7.7 Admin UI

- **Nav:** `{ href: "/billing", label: "Billing", icon: CreditCardIcon, section: "configure" }` between *Website embed* and *Settings* — an org-level noun in the Configure group (Settings stays per-user, per the 2026-08-17 IA ruling). Rendered only when `BILLING_ENABLED`.
- **`/billing`** (`src/app/(dashboard)/billing/page.tsx`, components in `src/features/billing/components/`): current plan card (name, price, interval, renews/ends on, `past_due` warning), usage meters (reminders this month X/30 on Free; bookable staff N/M; services N/3 on Free), a plan picker (Free/Pro/Team columns from `PLANS`, monthly/annual switch defaulting to annual, Founder ribbon when eligible) → `startCheckout`; "Manage subscription" → `openPortal`. `?checkout=success` shows a toast and re-reads the row (webhook may lag by seconds — the card says "Activating…" until the row exists; a `router.refresh()` retry every 3 s for 30 s).
- **Gate CTAs:** the refusals in §7.4 render an inline "Upgrade" link to `/billing`.
- **Shell:** the sidebar footer pill + banners from §7.4 (`src/components/shell/plan-pill.tsx`, data via `getEntitlements` in `(dashboard)/layout.tsx`).

### 7.8 Marketing

- `/pricing` route in `(marketing)`; nav gets "Pricing"; the pricing table is rendered from `PLANS` (no second source of truth); the FAQ "What does it cost?" answer becomes the plan summary; `heroNote` → "Free plan · No credit card". Copy must not violate `FORBIDDEN_COPY` (still no "google", "calendar sync", "stripe", "payment" — Pro's 🔨 rows stay off the page until shipped; the pricing table shows only shipped rows plus "more coming to Pro").
- Legal: `/privacy`, `/terms` (+ refund policy line) become real pages — the Merchant of Record requires them at store setup. Static content pages in `(marketing)`; wording is a launch-checklist item, not a design question.
- Badge href: `${APP_URL}/?ref=badge&org=${handle}` (both page and email badges).

### 7.9 Env + flags

`src/env.ts` additions (all optional, server-only): `BILLING_PROVIDER` (`"fake" | "stripe"`, default `"fake"`), `BILLING_FAKE_SECRET` (min 16; dev/tests), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTH|PRO_YEAR|TEAM_MONTH|TEAM_YEAR`, `BILLING_FOUNDER_PROMO_CODE`, `BILLING_FOUNDER_CUTOFF`. `.env.example` documents each. `src/lib/flags.ts`: `export const BILLING_ENABLED = false;` with the un-flip doctrine comment. Everything in §7.4/§7.7/§7.8 checks the flag; the webhook route and tables exist regardless (so the Stripe account can be wired before the flip).

### 7.10 Error handling

- Provider API failure on checkout/portal → action returns `GENERIC_WRITE_ERROR` shape ("Couldn't open checkout — try again"); nothing is written.
- Webhook: signature failure 401, unset secret 503, malformed payload 400 (provider retries), business-level unknowns 200 + `billing_events.error`.
- Entitlement lookup failure on a **public** path degrades to Free limits (never throws into the booking page); on the **drain** it degrades to "send" (a missed suppression beats a missed reminder); in the **dashboard** it surfaces as the plan pill showing "—" and the gates refusing conservatively.
- Over-limit after downgrade is a *state*, not an error: banners explain, nothing blocks.

### 7.11 Testing

- **Unit (Vitest):** `entitlementsFor` (every status × period-end combination; seats → bookableStaff), `PLANS` shape (prices > 0 for paid, yearly < 12×monthly), `monthlyBookingUsage` window maths across a DST month in a non-UTC org tz, `decideReminder` with the quota input, fake `parseWebhook` signature accept/reject, the Stripe adapter's event/status/price mapping against checked-in fixture events (`stripe.webhooks.generateTestHeaderString` for signatures), badge visibility rule, marketing `site.test.ts` extended for `/pricing` + `FORBIDDEN_COPY` on the pricing copy.
- **Integration (existing `*.integration.test.ts` idiom, serial):**
  - webhook route: created → row; replayed event → skipped; older `occurredAt` after newer → ignored; `expired` → entitlements Free; unknown org → 200 + event with `error`; bad signature → 401; no secret → 503;
  - RLS: member selects own row, cannot insert/update; member of org B cannot see org A; anon nothing on both tables;
  - gates: Free org `createStaff` → `plan_limit`; 4th `createService` → refused; after fake upgrade to Team both succeed; downgrade (fake `expired`) → `listPublicStaff` returns only the primary, `listPublicServices` returns 3, admin `listStaff` still returns all;
  - public booking on Free with 2 active staff: `createBooking` passes the primary id explicitly (spy on the rpc args) and a `staffId` of the second staff is rejected;
  - reminder drain: Free org with 31 bookings this month → 31st reminder `suppress`ed, Pro org identical setup → sent;
  - `billing_mrr` view sums correctly for a fixture set.
- **Manual (no Playwright in the repo):** Stripe test mode end-to-end with `stripe listen --forward-to localhost:3000/api/billing/webhook` — checkout → webhook → `/billing` shows Pro → badge gone on `/book/[handle]`; portal cancel-at-period-end → still Pro with "ends on"; `stripe trigger customer.subscription.deleted` → Free; `invoice.payment_failed` → past_due banner.

### 7.12 Rollout / launch checklist

1. Build the slice with `BILLING_ENABLED = false` (merge safe).
2. Stripe: **apply for Managed Payments eligibility now** (review takes time; fallback = Paddle via a second adapter). Then: products + prices (Pro/Team × month/year) with tax code `txcd_10103001`, Founder coupon (forever, 33.3 % off Pro monthly → $8) + promotion code (`max_redemptions: 100`), Customer Portal configuration, webhook endpoint + secret; fill env on the deploy. Ask Stripe whether Connect can later coexist with Managed Payments in the same account (deposits slice) or needs a second account.
   - **A price id that has ever been sold stays mapped.** On rotation, add the new id to `priceMapFromEnv()` and KEEP the old one — a live subscription keeps emitting webhooks under the price it was bought at, and an unmapped price is an event we cannot project. Second net: set `plan` + `interval` metadata on **every** price in the dashboard, which `subscriptionFrom` falls back to when the env map doesn't know the id.
   - The **Customer Portal configuration must enable `subscription_update`** with both Pro and Team listed as switchable products. That switch IS the Pro↔Team path: checkout refuses a paid→paid move (`/billing?error=use_portal`) precisely so the change is a proration on the existing subscription instead of a second one.
   - **Deleting an org cascades `org_subscriptions` but tells Stripe nothing** — cancel the subscription in Stripe FIRST, or the customer keeps being billed for an org that no longer exists (and the next webhook for it lands as "unresolvable org").
3. Legal pages live; support email in footer.
4. Email early-access orgs: pricing, Founder code, date (≥ 14 days out).
5. **Pre-flip verification.** Both halves are unexecuted today because `BILLING_ENABLED` is a compile-time constant: nothing in CI runs the paid paths.
   - **Local walkthrough:** flip the flag locally (`BILLING_ENABLED = true`, do not commit) with `BILLING_PROVIDER=fake`, and walk the `/dev/billing` checkout + portal scenarios end to end — every test card, cancel/resume, plan and interval switches, failed renewal → recovery, period advance (renew and expire), resubscribe, reset. It exercises the real projection, so it is the cheapest rehearsal of the Stripe dry run above.
   - An end-to-end integration seam/test of the **narrowed booking path with the flag ON** — Free org with two active staff, public booking → the primary staff id is what reaches the RPC, and the second staff's id is refused.
   - A **Stripe test-mode dry run** of: Pro→Team via the portal (one subscription afterwards, not two); an **exhausted Founder code** (checkout still completes, at list price); a **rotated price id** (metadata fallback projects it); **cancel-at-period-end** (plan holds until the date, then Free); and a **same-second `created` + `updated` burst** (both recorded, the later one wins).
6. Flip `BILLING_ENABLED = true`, deploy, watch `billing_events` and `billing_mrr`.
7. Then: Google Calendar sync spec (Pro's headline), intake questions, reminder schedule.

## 8. Roadmap after this slice (each its own spec)

1. **Google Calendar 2-way sync** (revive S4) → the Pro headline; flip Pro marketing on.
2. **Intake questions per service** + **custom reminder schedule** (e.g. 24h + 2h) — small, high perceived value; both already have entitlement flags.
3. **Team extra seats** (`seats` > 5 via provider quantity → webhook writes `seats`).
4. **SMS reminders** — metered add-on (Twilio pass-through + margin; EU SMS ≈ 10× US, so never "unlimited"). `src/lib/sms/` is an empty seam today.
5. **Deposits via Stripe Checkout + Connect** — the biggest no-show killer and a second revenue line (Free ~1 % platform fee, Pro/Team 0 %). Card data never touches us; we store payment-intent ids only. **Managed Payments does not support Connect** — expect a separate Stripe account (or a non-MoR path) for provider payouts; confirm with Stripe before that spec.
6. Growth: SEO niche pages templated from `site.ts` ("booking page for tutors / therapists / barbers"), directory listings, measure the badge loop via `?ref=badge`.

## 9. Open decisions (need Andrii)

1. ~~Provider~~ — **decided: Stripe Managed Payments, Paddle fallback** (§6). Remaining: outcome of Stripe's eligibility review; Connect coexistence for deposits.
2. **Price points and limits** — $12/$9, $29/$24, 3 services, 30 reminder-bookings, 5 seats: proposals. Regional (PPP) pricing is off for MVP; the MoR shows local currency.
3. **Founder cap and price** — 100 orgs at $8: proposal.
4. **Team trial** — none at launch; revisit with data.

## 10. Out of scope

Payments/deposits, SMS, Google Calendar, intake questions, reminder schedules (all §8); role-based purchase rights; invoices/receipts UI (Stripe portal/receipts); tax handling (Stripe as MoR); PPP pricing; usage analytics beyond the SQL view; DB-level enforcement of the creation gates (§7.4 trade-off); the Paddle adapter (only if the Stripe review fails).

## Implementation notes

(filled during execution — deviations from this spec are recorded here, per repo convention)

**Task 6 (`stripe.ts`):** §7.1 says `parseWebhook` maps `invoice.payment_failed` → `payment_failed` and `invoice.paid` (billing_reason ≠ `subscription_create`) → `payment_recovered`. Built instead: both are ignored (`normalizeStripeEvent` returns `null` for them). Reason: Stripe flips the subscription's own `status` field to `past_due`/`active` on payment failure/recovery and emits `customer.subscription.updated` for it — that single event is already the source `mapStripeStatus` reads, so mapping the invoice events too would mean re-fetching the subscription (invoice payloads don't carry `metadata.org_id`) to derive the same status a second time. One source, no re-fetch. `BillingEventType` still has `payment_failed`/`payment_recovered` for other providers (e.g. Paddle, which models them distinctly) to use.

**Task 14 — deviations/rulings recorded across execution (from the SDD ledger and fix rounds):**
- **Task 5:** the webhook projection (§7.5) is one transactional definer RPC, `apply_billing_event(...)` (0043) — audit insert with unique-violation → "replayed", conditional upsert guarded by `provider_updated_at` → "processed"/"stale", null org/subscription → "skipped" — replacing the spec's two-step TS select-then-upsert, which left a non-atomic ordering race under concurrent webhook deliveries; `applyBillingEvents` (TS) is now a thin loop over the RPC.
- **Task 5:** `provider.ts` uses static top-level imports of both adapters (`stripeProvider`, `fakeProvider`), not `require()`; `stripeProvider()` still throws lazily on a missing `STRIPE_SECRET_KEY` at call time, not at import time.
- **Task 4/10:** `emailBadgeVisible(orgId): Promise<boolean>` (§7.3) was built as `emailBadgeUrl(orgId): Promise<string | null>`; client-facing templates in `templates.ts` take `badgeUrl?: string | null` (a link; renders the footer line iff non-null) rather than a boolean `showBadge`, and call sites pass `await emailBadgeUrl(orgId)`.
- **Task 10:** the "Powered by Booklo" badge is deliberately OUTSIDE `BILLING_ENABLED` — the hosted page, embed, and every client email honour the org's existing `hidePoweredBy` toggle for every org until the flag flips, rather than being gated by the flag itself (amends the flag-off behaviour implied by §4.6 for this one surface). The Website-embed studio's toggle fails OPEN (stays usable, no 500) on an entitlements read error.
- **Task 8:** the public offering (`loadPublicOffering`, `src/lib/booking/public-offering.ts`) fails OPEN — falls back to an `UNLIMITED` entitlements object — on a billing-read failure, amending §7.10's "degrade to Free" rule for this one caller only: a paying org must never shrink its public offering during a billing-table blip. Badge, reminders, dashboard and emails still degrade to Free exactly as §7.10 specifies. Backed by a new strict reader `getEntitlementsAdminStrict` (throws) alongside the existing degrade-to-Free `getEntitlementsAdmin` (still used by `emailBadgeUrl` and the drain).
- **Task 8:** `UNLIMITED = { ...PLANS.team.limits, plan: "team", bookableStaff: Number.MAX_SAFE_INTEGER }` — every paid flag true, derived from `PLANS.team` rather than a hand-picked field subset (an earlier draft left `reminderBookingsPerMonth` at Team's numeric value; this reads `null`, "unused on this path" made explicit).
- **Task 8:** `chooseStaffForBooking` (pure TS helper in `bookable.ts`) names the first bookable staff member who is currently free when the plan's bookable set is a strict subset of the service's eligible roster and the client requested "any" staff; DB auto-assign (`p_staff_id: null`) is untouched for the common case where the bookable set equals the eligible roster (all normal Team orgs).
- **Task 8:** `getPublicStaffBySlug` was superseded by the single `loadPublicOffering` loader — kept during execution, ~~left in place~~ **deleted in the post-review fix wave** (zero callers; a second, un-narrowed way to resolve a staff slug is exactly the kind of bypass the loader exists to prevent). The appointments-side `PublicOffering` in `public-offering.ts` was renamed `PlanLimitedOffering` in the same pass, so it no longer shadows the rentals `PublicOffering` in `public.ts`.
- **Task 9:** the creation gates (`assertCanAddStaff`/`assertCanAddService`) return `GENERIC_WRITE_ERROR` ("Couldn't save. Try again.") on an entitlements/count lookup failure rather than the plan-limit copy, which would assert a limit was reached that a failed read never established (§7.10 "refuses conservatively").
- **Task 12:** `startCheckout`/`openPortal` return `Promise<void>` and surface failures via `redirect("/billing?error=checkout|portal")` rather than a return value; the `/billing` page renders the mapped message in a `role="alert"` line.
- **Task 12:** the sidebar plan pill (§7.7) was folded into one component, `PlanBanner`/`PlanBannerSlot` — it stacks both the reminder-quota nudge and the over-limit-roster nudge and is wrapped in `<Suspense>` in the dashboard layout — instead of a separate `plan-pill.tsx`.
- **Task 12:** the Founder ribbon (§3) renders only on the plan picker's monthly tab, with its price derived as `PLANS.pro.monthly * FOUNDER_PRICE_FACTOR` (`2/3`, a new `plans.ts` constant mirroring the Stripe coupon) rather than a hardcoded `$8`; the yearly tab shows a muted note instead of the ribbon.
- **Task 12:** the `?checkout=success` activation poller compares the freshly-read plan against `&plan=` carried in the checkout `returnUrl`, not just "any subscription row exists", so it can tell which plan activated.
- **Task 13:** `/privacy` and `/terms` may say "Stripe" and "payment(s)" — legal disclosures sit outside the `FORBIDDEN_COPY` corpus that marketing/pricing copy is held to.
- **Team seats:** `TEAM_INCLUDED_SEATS = 5` is fixed for this slice; there is no self-serve add-seats flow even though `org_subscriptions.seats`/the webhook already carry a `seats` number (roadmap item, §8.3).
- **Test infra (all tasks):** unit tests that transitively import `@/env` stub `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` with `??=` before the import, since `env.ts` parses eagerly (precedent: `drain-isolation.test.ts`).

**Post-review fix wave (2026-08-18, whole-branch review):**
- **Paid→paid is portal-only.** Every move between paid plans — Team→Pro *and* Pro→Team — renders "Switch in the billing portal" in the plan picker, and `startCheckout` refuses the same move server-side (`/billing?error=use_portal`) after reading the org's subscription and its effective plan. Checkout can only ever *add* a subscription, so an "Upgrade to Team" button on a Pro org would have bought a second subscription next to the first; the portal's `subscription_update` is the only path that prorates the existing one. A resubscribe (a row that exists but no longer entitles) now passes its `provider_customer_id` into `CheckoutInput`, and the Stripe adapter sends `customer` **instead of** `customer_email` (Stripe rejects both together) so the org's payment history never splits across two customers.
- **`apply_billing_event` expires on a null payload.** `subscription_expired` with `p_org_id` set and `p_sub` null (Stripe deleted a subscription whose price maps to nothing we know) now updates the cached row to `status='expired'` under the same `provider_updated_at` guard, returning `processed`/`stale`, instead of falling into the generic "no subscription payload → skipped" branch that would have left the org paid forever in our cache. That generic branch stays for every other type. The ordering guard also became `<=` (from `<`): Stripe emits `created` and `updated` inside the same second routinely, and a strict `<` dropped the later of the pair as stale — true replays are caught by the `billing_events` unique index, not by this guard, so a tie can only mean "let the last arrival win".
- **Price ids are not the only mapping.** `subscriptionFrom` falls back to the price's own `plan`/`interval` **metadata** when `priceMapFromEnv()` doesn't know the id (validated against the two enums; anything else stays unmapped), so a rotated or renamed Stripe price does not silently stop projecting. `customer.subscription.deleted` with an unmappable price still emits `type: "subscription_expired"` with `subscription: null` — which is exactly the case the RPC change above handles.
- **The reminder quota is ordinal.** "Reminders for the first 30 bookings each month" (§3) is a question about *this booking's position*, not about a running total: a reminder is suppressed iff the org made ≥ 30 original bookings in that booking's org-local month **before** it (`monthlyBookingUsage(..., { before: created_at })`, whose month window also comes from `before`). The old per-tick, per-org count made booking #31 sendable again as soon as an earlier booking was cancelled or the month rolled over. The drain's `quotaExceeded` dep therefore takes the booking's `created_at` and is asked per booking (the per-tick quota cache is gone); the badge lookup — genuinely per-org — keeps a per-tick memo in its place.

**Billing emulator (2026-08-18, plan `2026-08-18-billing-emulator`):** the fake provider is a full **emulator**, not a subscription-writing shortcut — a hosted-checkout page with Stripe's test cards (`/dev/billing/checkout`) and a customer-portal page (`/dev/billing/portal`) with one button per lifecycle event, both of which build `BillingEvent`s through `src/lib/billing/fake-emulator.ts` and hand them to `applyBillingEvents`, the exact path a Stripe webhook takes. `/api/billing/dev-checkout` is **removed** (superseded); §7.1's description of it is updated above. Every dev surface is gated by `requireDevBilling` (not production, provider ≠ stripe, `BILLING_ENABLED`, signed-in member whose org matches any `org` param).
