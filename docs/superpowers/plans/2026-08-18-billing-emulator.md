# Billing Emulator (fake Stripe for local e2e) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every billing scenario walkable end-to-end locally with `BILLING_PROVIDER=fake` — checkout with test cards, cancel at period end / resume / cancel now, switch plan/interval, failed renewal → past_due → recovery, period advance (renew or expire), reset — by giving the fake provider a checkout page and a portal page that emit the exact `BillingEvent`s Stripe would, projected through the existing `applyBillingEvents`.

**Architecture:** Nothing changes for production. `src/lib/billing/fake.ts` gains real URLs (`/dev/billing/checkout`, `/dev/billing/portal`); a pure `src/lib/billing/fake-emulator.ts` turns (current row, action, now) into `BillingEvent[]`; two dev-only pages + server actions under `src/app/dev/billing/**` and `src/features/billing/dev/` apply them with the admin client. All dev surfaces are guarded: not production, `BILLING_PROVIDER !== "stripe"`, `BILLING_ENABLED`, signed-in member of the org. The old `/api/billing/dev-checkout` route is deleted (superseded).

**Tech Stack:** Next.js 16 App Router (server components + server actions), Supabase admin client, Vitest unit + integration (local stack), existing UI primitives (`Button`, `Input`, `Label`).

**Spec:** `docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md` (§7.1 provider seam, §7.5 projection, §7.6 checkout/portal, §7.7 UI). Amendment recorded by this plan: the fake adapter is a full emulator; spec Implementation notes get a bullet.

## Global Constraints
- Dev-only. Every page/action under `/dev/billing` and every dev server action returns `notFound()` when `process.env.NODE_ENV === "production"` OR `env.BILLING_PROVIDER === "stripe"` OR `!BILLING_ENABLED`; then `requireOrg()`; when an `org` param is present it must equal the session org (else 403 / `notFound()`).
- Events are produced ONLY through `src/lib/billing/fake-emulator.ts` builders and applied ONLY through `applyBillingEvents(createAdminClient(), events)` (idempotent, ordered). Provider ids: `cus_fake_<orgId>`, `sub_fake_<orgId>`; event ids `fake-<action>-<orgId>-<ms>`; `occurredAt` = injected `now`.
- Period math: month → `+1 calendar month`, year → `+1 calendar year` from the anchor (checkout: now; advance/renew: current period end); Team `seats = TEAM_INCLUDED_SEATS`, Pro 1.
- Test cards (digits only after stripping spaces): `4242424242424242` → success; `4000000000000002` → `declined`; `4000000000009995` → `insufficient_funds`; `4000000000000341` → subscription created `past_due` ("card attached, first charge failed"); anything else with 16 digits + Luhn-valid → success; otherwise `invalid`. Expiry must be a future MM/YY, CVC 3–4 digits, else `invalid`.
- No `stripe` import anywhere new. No `FORBIDDEN_COPY` words in dashboard copy (`/billing`); the dev pages may say "test card" and "payment" — they are not marketing.
- Commands: `npm run verify`; `npx vitest run --config vitest.integration.config.ts <file>`; commit per task with a conventional message on branch `feat/billing-emulator`.

## File map
| File | Responsibility |
|---|---|
| `src/lib/billing/fake-emulator.ts` (+ test) | pure: `classifyTestCard`, `addInterval`, event builders per action, `FakeAction` type |
| `src/lib/billing/fake.ts` (modify) | checkout/portal URLs point at the dev pages; carries `customer`/`return` params |
| `src/features/billing/dev/guard.ts` | `requireDevBilling(orgParam?)` shared guard |
| `src/features/billing/dev/actions.ts` | server actions: `fakeCheckout(formData)`, `fakePortalAction(formData)`, `fakeUpdateCard(formData)`, `fakeReset()` |
| `src/features/billing/dev/components/*.tsx` | `CheckoutForm`, `PortalPanel`, `DevBanner` |
| `src/app/dev/billing/layout.tsx`, `checkout/page.tsx`, `portal/page.tsx` | pages |
| `src/app/api/billing/dev-checkout/route.ts` (+ its test cases) | DELETE (superseded) |
| `src/features/billing/components/current-plan.tsx` (modify) | cancellation/past_due copy |
| `src/lib/billing/fake-emulator.integration.test.ts` | scenario chain through `applyBillingEvents` |
| `docs/superpowers/specs/…design.md` (notes), `.env.example` | docs |

---

### Task 1: Emulator core (pure) + fake adapter URLs

**Files:** create `src/lib/billing/fake-emulator.ts`, `src/lib/billing/fake-emulator.test.ts`; modify `src/lib/billing/fake.ts` (+ `fake.test.ts` if URL assertions exist).

**Interfaces (produce):**
```ts
export type CardVerdict = "ok" | "declined" | "insufficient_funds" | "past_due_first_charge" | "invalid";
export function classifyTestCard(input: { number: string; exp: string; cvc: string }, now: Date): CardVerdict;
export function addInterval(from: Date, interval: Interval): Date;           // +1 month / +1 year (calendar)
export type FakeRow = OrgSubscriptionRow & { providerCustomerId: string; providerSubscriptionId: string };
export function fakeIds(orgId: string): { customer: string; subscription: string };
export function checkoutEvents(i: { orgId: string; plan: PaidPlanId; interval: Interval; now: Date; existingCustomerId?: string; firstChargeFails?: boolean }): BillingEvent[];
export type FakeAction = "cancel_at_period_end" | "resume" | "cancel_now" | "switch_pro" | "switch_team" | "switch_month" | "switch_year" | "fail_renewal" | "recover" | "advance_period";
export function actionEvents(action: FakeAction, row: FakeRow, orgId: string, now: Date): BillingEvent[];
export const FAKE_ACTIONS: Array<{ id: FakeAction; label: string; hint: string; enabledWhen: (row: FakeRow) => boolean }>;
```
Semantics of `actionEvents` (each returns ONE event unless stated; `type` per spec's `BillingEventType`; `subscription` = row with the change; `provider: "fake"`, `raw: { emulator: action }`):
- `cancel_at_period_end` → `subscription_updated`, `cancelAtPeriodEnd: true` (status unchanged). Enabled when active/past_due and not already flagged.
- `resume` → `subscription_updated`, `cancelAtPeriodEnd: false`. Enabled when flagged.
- `cancel_now` → `subscription_expired`, `status: "expired"`. Enabled unless already expired.
- `switch_pro`/`switch_team` → `subscription_updated` with the new plan (`seats` accordingly), same interval/period. Enabled when the other plan is current.
- `switch_month`/`switch_year` → `subscription_updated` with the new interval and `currentPeriodEnd = addInterval(now, newInterval)` (Stripe prorates and resets the period). Enabled when the other interval is current.
- `fail_renewal` → `payment_failed`, `status: "past_due"`. Enabled when active.
- `recover` → `payment_recovered`, `status: "active"`, `currentPeriodEnd = addInterval(now, interval)`. Enabled when past_due.
- `advance_period` → if `cancelAtPeriodEnd` → `subscription_expired` (`status: "expired"`, `occurredAt = currentPeriodEnd`); else if past_due → `subscription_expired` too (dunning exhausted); else `subscription_updated` with `currentPeriodEnd = addInterval(currentPeriodEnd, interval)` (`occurredAt = old period end`). Enabled unless expired. **Note:** `occurredAt` may be in the past relative to `now` — that is fine for ordering as long as it is `>=` the row's `provider_updated_at`; builders must therefore use `max(anchor, now)` — implement `occurredAt = new Date(Math.max(anchor.getTime(), now.getTime())).toISOString()`.
`checkoutEvents`: one `subscription_created` (`status: firstChargeFails ? "past_due" : "active"`, `currentPeriodEnd = addInterval(now, interval)`, `providerCustomerId = existingCustomerId ?? fakeIds(orgId).customer`, `providerSubscriptionId = fakeIds(orgId).subscription`, `seats` by plan, `cancelAtPeriodEnd: false`).

`fake.ts`: `createCheckoutUrl` → `${APP_URL}/dev/billing/checkout?org&plan&interval&return[&customer]`; `createPortalUrl(customerId, returnUrl)` → `${APP_URL}/dev/billing/portal?return=<returnUrl>`.

- [ ] Write `fake-emulator.test.ts` FIRST: card classification (5 cases + Luhn + expired card + bad cvc), `addInterval` (Jan 31 + 1 month → Feb 28/29 clamp; year), each action's event shape/status/flag/period, `advance_period` three branches, `occurredAt` never before `now`.
- [ ] Implement; `npx vitest run src/lib/billing/fake-emulator.test.ts src/lib/billing/fake.test.ts`; `npm run verify`.
- [ ] Commit: `feat(billing): fake provider emulator core — test cards, event builders, dev URLs`.

---

### Task 2: Dev pages + server actions; delete the old dev-checkout route

**Files:** create `src/features/billing/dev/guard.ts`, `src/features/billing/dev/actions.ts`, `src/features/billing/dev/components/{dev-banner,checkout-form,portal-panel}.tsx`, `src/app/dev/billing/layout.tsx`, `src/app/dev/billing/checkout/page.tsx`, `src/app/dev/billing/portal/page.tsx`; delete `src/app/api/billing/dev-checkout/route.ts` and move/adjust its two test cases in `src/app/api/billing/webhook/route.integration.test.ts` (drop the dev-checkout describe there; the emulator gets its own integration test in Task 3).

**Guard** `requireDevBilling(orgParam?: string | null)`: `if (process.env.NODE_ENV === "production" || env.BILLING_PROVIDER === "stripe" || !BILLING_ENABLED) notFound();` → `const { user, org } = await requireOrg();` → `if (orgParam && orgParam !== org.id) notFound();` → returns `{ user, org }`.

**Checkout page** `/dev/billing/checkout?org&plan&interval&return[&customer]`: guard; validate `plan` (`isPaidPlan`) + `interval`; render `DevBanner` ("Booklo dev billing — emulator, no real charges. Test cards: 4242… ok · …0002 declined · …9995 insufficient funds · …0341 first charge fails") + summary (plan name, `formatUsd(pricePerMonth(plan, interval))`/mo, "billed yearly $X" when year, Founder line when `isFounderEligible(org.created_at)` and plan pro + month → show "$8/mo Founder price applied") + `CheckoutForm` (hidden org/plan/interval/return/customer; inputs number/exp/cvc/name; submit "Pay"; "Cancel" link → return URL). `?error=` renders the message (declined / insufficient_funds / invalid).
`fakeCheckout(formData)`: guard(orgParam) → parse (zod: plan/interval/number/exp/cvc/name/return/customer?) → `classifyTestCard` → on `declined|insufficient_funds|invalid` `redirect(checkoutUrlWith(error))` (keep params) → else `applyBillingEvents(admin, checkoutEvents({ orgId, plan, interval, now, existingCustomerId: customer, firstChargeFails: verdict === "past_due_first_charge" }))` → `revalidatePath("/billing")` → redirect to `return` with `checkout=success` and `plan` set via `URL.searchParams.set` (resolve relative against `env.NEXT_PUBLIC_APP_URL`).

**Portal page** `/dev/billing/portal?return`: guard (no org param — session org); read row via admin (`select *` mapped to `FakeRow`) — if none, show "No subscription — go to Billing" + link. `PortalPanel`: summary (plan, interval, status, cancelAtPeriodEnd, period end, customer/subscription ids), one `<form action={fakePortalAction}>` per `FAKE_ACTIONS` entry with hidden `action`, button disabled when `!enabledWhen(row)`, hint text; **Update card** form (`fakeUpdateCard`: classify → declined shows `?error=card_declined`, ok shows `?done=card_updated`; no events); **Reset to Free** (`fakeReset`: deletes the org's `org_subscriptions` + `billing_events` rows with admin; `?done=reset`); "Back to Booklo" link → `return` (default `/billing`). `?done=` toast line per action.
`fakePortalAction(formData)`: guard → parse `action` ∈ `FakeAction` → read row (admin) → `applyBillingEvents(admin, actionEvents(action, row, org.id, new Date()))` → `revalidatePath("/billing")` → `redirect("/dev/billing/portal?return=…&done=<action>")`.

**Layout** `src/app/dev/billing/layout.tsx`: light, plain (`className="light bg-background text-foreground min-h-full"` wrapper like the marketing layout precedent) with the `DevBanner`; `export const metadata = { title: "Booklo dev billing" }`.

- [ ] Delete `dev-checkout/route.ts`; update the webhook route test (remove dev-checkout describe + the session mock if only it used it).
- [ ] Implement guard/actions/components/pages per above; `npm run verify`.
- [ ] Manual smoke in THIS worktree only (never touch the user's :3000): temporarily `BILLING_ENABLED = true` (do not commit), `BILLING_PROVIDER=fake`, `NEXT_PUBLIC_APP_URL=http://localhost:3100 PORT=3100 npm run dev`; log in as the seeded demo user; walk: Upgrade to Pro → decline with …0002 → pay with 4242 → `/billing` shows Pro → Manage subscription → portal → cancel at period end → `/billing` "Ends on" → resume → switch to Team → fail renewal → `/billing` past_due copy → recover → advance period (renews) → cancel now → `/billing` Free → reset. Restore the flag; stop the server.
- [ ] Commit: `feat(billing): dev checkout + portal pages for the fake provider (all scenarios), drop dev-checkout route`.

---

### Task 3: App copy, scenario integration test, docs

**Files:** modify `src/features/billing/components/current-plan.tsx`; create `src/lib/billing/fake-emulator.integration.test.ts`; modify `.env.example`, spec Implementation notes; add `docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md` §7.12 bullet "local walkthrough".

- [ ] `current-plan.tsx`: when `sub.cancelAtPeriodEnd || sub.status === "cancelled"` render under the date: "You keep {plan.name} until then. Changed your mind? Resume in the billing portal."; when `past_due`: keep the amber line but end with "Retry the charge or update your card in the billing portal — after the retries run out the plan ends."; when `expired` and `ent.plan === "free"`: "Your {sub.plan} plan ended — pick a plan below to resubscribe." (needs `sub.plan` name via `PLANS`). No forbidden words (`payment` etc.).
- [ ] Integration test (serial, local stack; own org via `signedInUser` + `create_org`; admin client): chain through `applyBillingEvents`: checkout(pro,month) → `entitlementsFor` pro; cancel_at_period_end → still pro + flag; advance_period → expired → Free; checkout again (existingCustomerId reused → same `provider_customer_id`); switch_team → team seats 5; fail_renewal → past_due (still team); recover → active; advance_period → renewed period end = old + 1 month; cancel_now → Free. Also `firstChargeFails` → row past_due. Assert `provider_updated_at` monotonic and `billing_events` count == events applied.
- [ ] `.env.example`: comment under `BILLING_PROVIDER` describing the dev pages + test cards. Spec Implementation notes bullet + §7.12 "Local walkthrough: flip the flag locally, BILLING_PROVIDER=fake, walk /dev/billing checkout+portal scenarios".
- [ ] `npm run verify`; `npm run test:integration` (re-run once on the known reminder-drain flake); commit: `feat(billing): cancellation/past-due copy, emulator scenario test, docs`.
