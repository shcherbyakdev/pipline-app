# Pricing & Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Free / Pro / Team ladder: Stripe Managed Payments checkout + portal behind a provider seam, a webhook-written `org_subscriptions` cache, server-side entitlements and gates, the "Powered by Booklo" badge as a Pro perk, the Free reminder quota, a `/billing` page and a `/pricing` page — all dormant behind `BILLING_ENABLED = false` until launch.

**Architecture:** One pure `plans.ts` is the source of truth for prices and limits; `entitlements.ts` turns an `org_subscriptions` row (or its absence = Free) into limits; every gate reads entitlements server-side. `src/lib/billing/provider.ts` is the seam (Stripe adapter + fake adapter); the webhook route normalises provider events and upserts our cache idempotently. Plan limits shape the *public offering* (`lib/booking`), never delete admin data, and never block a client's booking.

**Tech Stack:** Next.js 16.3 (App Router, server actions, route handlers), Supabase (Postgres RLS, service-role admin client), Drizzle migrations, zod 4, Vitest (unit + serial integration against the local stack), `stripe` npm SDK (adapter file only), Tailwind + existing UI primitives.

**Spec:** `docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md`

## Global Constraints

- Migrations live in `src/db/migrations/`; next numbers are **0042** (generated) and **0043** (custom `billing_security`). Custom SQL is idempotent (`drop … if exists` before every add), every definer function uses `security definer set search_path = ''`, every new table gets explicit `revoke all … from public, anon, authenticated, service_role;` then targeted grants; `anon` receives nothing.
- Compile-time flag `BILLING_ENABLED = false` in `src/lib/flags.ts` — while false the app behaves exactly as today (no gates, no nav item, no pricing page). Tables, seam, webhook route and pure modules exist regardless.
- Never block a public booking, confirmation or manage link on plan grounds. Limits act on the provider side (creation gates, public offering, badge, reminders).
- The `stripe` SDK is imported ONLY in `src/lib/billing/stripe.ts`. Nothing else in `src/` may import it.
- Marketing copy must not contain the words in `FORBIDDEN_COPY` (`google`, `calendar sync`, `stripe`, `payment`) — `site.test.ts` enforces it, and the pricing copy joins that corpus.
- Prices/limits: Free (1 bookable staff, 3 public services, reminders for first 30 bookings/mo, badge shown), Pro $12/mo or $108/yr, Team $29/mo or $288/yr with 5 seats. Only `src/lib/billing/plans.ts` holds these numbers (the `billing_mrr` view mirrors them with a comment).
- Commands: `npm run verify` (lint + typecheck + unit), `npm run test:integration` (needs the local stack; run `npm run db:migrate` first), single file `npx vitest run <path>` / `npx vitest run --config vitest.integration.config.ts <path>`. Generated migration: `npx drizzle-kit generate` after editing `src/db/schema/*.ts`; custom: `npx drizzle-kit generate --custom --name=billing_security`.
- Commit after every task with a conventional message; keep the branch `feat/billing` (create it from `main` in Task 1).

## File map

| File | Responsibility |
|---|---|
| `src/lib/flags.ts` (modify) | `BILLING_ENABLED` |
| `src/env.ts`, `.env.example` (modify) | `BILLING_PROVIDER`, `BILLING_FAKE_SECRET`, `STRIPE_*`, `BILLING_FOUNDER_*` |
| `src/lib/billing/plans.ts` (+ test) | `PLANS`, `PlanId`, `Interval`, prices, limits |
| `src/lib/billing/entitlements.ts` (+ test) | pure: `effectivePlan`, `entitlementsFor`, `monthWindow`, `canAddStaff`, `canAddService`, `badgeVisible` |
| `src/db/schema/billing.ts`, `src/db/schema/index.ts` (modify) | `org_subscriptions`, `billing_events` |
| `src/db/migrations/0042_*.sql`, `0043_billing_security.sql` | tables, CHECKs, RLS, grants, `bookings(org_id, created_at)` index, `billing_mrr` view |
| `src/lib/billing/queries.ts` | server-only reads: `getOrgSubscription`, `getEntitlements`, `getEntitlementsAdmin`, `monthlyBookingUsage`, `emailBadgeVisible` |
| `src/lib/billing/provider.ts` | `BillingProvider`, `BillingEvent`, `selectBillingProvider` |
| `src/lib/billing/fake.ts` (+ test) | dev/test adapter, `signFakeWebhook` |
| `src/lib/billing/stripe.ts` (+ test) | Stripe Managed Payments adapter; pure mappers exported for tests |
| `src/lib/billing/apply-events.ts` | `applyBillingEvents(admin, events)` — idempotency + ordering guard + upsert |
| `src/lib/billing/billing.integration.test.ts` | RLS, apply-events, usage count, view |
| `src/app/api/billing/webhook/route.ts`, `src/app/api/billing/dev-checkout/route.ts` | provider → cache; fake checkout |
| `src/lib/booking/bookable.ts` (modify, + test) | `limitPublicOffering` |
| `src/lib/booking/public-offering.ts` | server-only `loadPublicOffering(orgId)` |
| `src/lib/booking/public.ts` (modify) | `loadOrgSlotContext(..., { allowedStaffIds })` |
| `src/app/book/[handle]/page.tsx`, `[staffSlug]/page.tsx`, `src/app/embed/[handle]/page.tsx` (modify) | use `loadPublicOffering`, badge |
| `src/features/scheduling/public-actions.ts` (modify) | limited slot context, explicit staff id |
| `src/features/scheduling/schema.ts`, `staff-actions.ts`, `actions.ts` (modify) | creation gates + copy |
| `src/features/scheduling/templates.ts` (modify, + test) | `showBadge` line |
| `src/features/scheduling/public-actions.ts`, `manage-actions.ts`, `booking-actions.ts`, `reminders.ts` (modify) | badge on client emails; reminder quota |
| `src/features/orgs/components/widget-appearance.tsx`, `src/app/(dashboard)/embed/page.tsx` (modify) | lock "Hide Powered by" on Free |
| `src/features/billing/actions.ts`, `schema.ts`, `components/*` | `startCheckout`, `openPortal`, plan picker, usage meters, banner |
| `src/app/(dashboard)/billing/page.tsx`, `src/components/shell/nav.ts`, `src/app/(dashboard)/layout.tsx` (modify) | Billing page, nav item, banner |
| `src/features/marketing/site.ts` (+ test), `src/app/(marketing)/pricing/page.tsx`, `privacy/page.tsx`, `terms/page.tsx`, `components/pricing-table.tsx` | marketing |
| `supabase/snippets/mrr.sql` | founder MRR query |

---

### Task 1: Branch, dependency, env, flag, `plans.ts`

**Files:**
- Modify: `src/lib/flags.ts`, `src/env.ts`, `.env.example`, `package.json` (via `npm install`)
- Create: `src/lib/billing/plans.ts`, `src/lib/billing/plans.test.ts`

**Interfaces:**
- Produces: `PLANS`, `PlanId = "free" | "pro" | "team"`, `PaidPlanId`, `Interval = "month" | "year"`, `PlanLimits`, `PlanDef`, `TEAM_INCLUDED_SEATS`, `PAID_PLANS`, `pricePerMonth(plan, interval)`, `env.BILLING_PROVIDER` etc., `BILLING_ENABLED`.

- [ ] **Step 1: Branch + dependency**

```bash
git checkout main && git pull && git checkout -b feat/billing
npm install stripe
```
Expected: `stripe` appears in `package.json` dependencies (any current major; the adapter pins nothing else).

- [ ] **Step 2: Flag**

Append to `src/lib/flags.ts`:
```ts
/** Billing (spec docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md).
    While false: no plan gates, no /billing nav item, no /pricing route, no
    badge changes — early access continues exactly as today. Tables, the
    provider seam and the webhook route exist regardless so the Stripe
    account can be wired before the flip. */
export const BILLING_ENABLED = false;
```

- [ ] **Step 3: Env**

In `src/env.ts` add to `envSchema` (all optional, server-only) and to the parse object:
```ts
  BILLING_PROVIDER: z.enum(["fake", "stripe"]).default("fake"),
  BILLING_FAKE_SECRET: z.string().min(16).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_MONTH: z.string().min(1).optional(),
  STRIPE_PRICE_PRO_YEAR: z.string().min(1).optional(),
  STRIPE_PRICE_TEAM_MONTH: z.string().min(1).optional(),
  STRIPE_PRICE_TEAM_YEAR: z.string().min(1).optional(),
  BILLING_FOUNDER_PROMO_CODE: z.string().min(1).optional(),
  BILLING_FOUNDER_CUTOFF: z.string().date().optional(),
```
and the matching `process.env.X` lines. Append to `.env.example`:
```
# --- Billing (spec 2026-08-18) ---
# "fake" (default; dev checkout at /api/billing/dev-checkout) or "stripe".
BILLING_PROVIDER=fake
# HMAC secret the fake provider signs its webhooks with (tests + dev). >= 16 chars.
BILLING_FAKE_SECRET=
# Stripe (Managed Payments). Production only.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_PRO_MONTH=
STRIPE_PRICE_PRO_YEAR=
STRIPE_PRICE_TEAM_MONTH=
STRIPE_PRICE_TEAM_YEAR=
# Founder price: Stripe promotion code id, applied for orgs created before the cutoff (YYYY-MM-DD).
BILLING_FOUNDER_PROMO_CODE=
BILLING_FOUNDER_CUTOFF=
```

- [ ] **Step 4: Failing test for `plans.ts`**

`src/lib/billing/plans.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PLANS, PAID_PLANS, TEAM_INCLUDED_SEATS, pricePerMonth } from "./plans";

describe("PLANS", () => {
  it("has free, pro, team with the spec prices", () => {
    expect(PLANS.free.monthly).toBe(0);
    expect(PLANS.pro.monthly).toBe(12);
    expect(PLANS.pro.yearly).toBe(108);
    expect(PLANS.team.monthly).toBe(29);
    expect(PLANS.team.yearly).toBe(288);
  });
  it("yearly is cheaper than 12× monthly for paid plans", () => {
    for (const id of PAID_PLANS) expect(PLANS[id].yearly).toBeLessThan(PLANS[id].monthly * 12);
  });
  it("free limits match the spec", () => {
    expect(PLANS.free.limits).toMatchObject({
      bookableStaff: 1, publicServices: 3, reminderBookingsPerMonth: 30, hideBadge: false,
    });
    expect(PLANS.pro.limits.publicServices).toBeNull();
    expect(PLANS.team.limits.bookableStaff).toBe(TEAM_INCLUDED_SEATS);
  });
  it("pricePerMonth divides yearly by 12", () => {
    expect(pricePerMonth("pro", "month")).toBe(12);
    expect(pricePerMonth("pro", "year")).toBe(9);
    expect(pricePerMonth("team", "year")).toBe(24);
  });
});
```
Run: `npx vitest run src/lib/billing/plans.test.ts` → FAIL (module missing).

- [ ] **Step 5: Implement `plans.ts`**

```ts
// Single source of truth for what the pricing page shows and what the code
// enforces (spec §3/§7.3). Change a number here, nowhere else — the
// billing_mrr view (0043) mirrors these prices and says so.
export type PlanId = "free" | "pro" | "team";
export type PaidPlanId = Exclude<PlanId, "free">;
export type Interval = "month" | "year";

export type PlanLimits = {
  /** Staff members the PUBLIC page may offer (Team: = seats). */
  bookableStaff: number;
  /** Services the PUBLIC page may offer; null = unlimited. */
  publicServices: number | null;
  /** Reminder emails are sent for the first N bookings made each month; null = unlimited. */
  reminderBookingsPerMonth: number | null;
  /** May the org hide "Powered by Booklo"? */
  hideBadge: boolean;
  // Flags for follow-up slices; nothing reads them yet.
  customReminders: boolean;
  gcalSync: boolean;
  intakeQuestions: boolean;
};

export type PlanDef = {
  id: PlanId;
  name: string;
  blurb: string;
  /** USD, list price. yearly = total per year. */
  monthly: number;
  yearly: number;
  limits: PlanLimits;
};

export const TEAM_INCLUDED_SEATS = 5;

const PAID_LIMITS = { hideBadge: true, customReminders: true, gcalSync: true, intakeQuestions: true } as const;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", name: "Free", blurb: "Everything a solo provider needs to take bookings.",
    monthly: 0, yearly: 0,
    limits: { bookableStaff: 1, publicServices: 3, reminderBookingsPerMonth: 30,
      hideBadge: false, customReminders: false, gcalSync: false, intakeQuestions: false },
  },
  pro: {
    id: "pro", name: "Pro", blurb: "Your brand, unlimited services, reminders for every booking.",
    monthly: 12, yearly: 108,
    limits: { bookableStaff: 1, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
  team: {
    id: "team", name: "Team", blurb: "Up to five team members, each bookable, auto-assigned.",
    monthly: 29, yearly: 288,
    limits: { bookableStaff: TEAM_INCLUDED_SEATS, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
};

export const PAID_PLANS: readonly PaidPlanId[] = ["pro", "team"];

export function isPaidPlan(id: string): id is PaidPlanId {
  return id === "pro" || id === "team";
}

export function pricePerMonth(plan: PaidPlanId, interval: Interval): number {
  return interval === "month" ? PLANS[plan].monthly : PLANS[plan].yearly / 12;
}
```
Run the test → PASS. Run `npm run verify` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(billing): flag, env, stripe dep, plans.ts source of truth"
```

---

### Task 2: Pure entitlements module

**Files:**
- Create: `src/lib/billing/entitlements.ts`, `src/lib/billing/entitlements.test.ts`

**Interfaces:**
- Consumes: `PLANS`, `PlanLimits`, `PaidPlanId`, `Interval` (Task 1); `dateInZone`, `wallTimeToUtc` from `@/features/scheduling/slots`.
- Produces:
  ```ts
  type SubscriptionStatus = "active" | "past_due" | "cancelled" | "expired";
  type OrgSubscriptionRow = { plan: PaidPlanId; status: SubscriptionStatus; interval: Interval; seats: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; };
  type Entitlements = PlanLimits & { plan: PlanId };
  effectivePlan(row, now): PlanId
  entitlementsFor(row, now): Entitlements
  monthWindow(now, timeZone): { fromIso: string; toIso: string }
  canAddStaff(activeCount, ent): boolean
  canAddService(serviceCount, ent): boolean
  badgeVisible(themeHidePoweredBy, ent): boolean
  reminderQuotaExceeded(usedThisMonth, ent): boolean
  ```

- [ ] **Step 1: Failing tests**

`src/lib/billing/entitlements.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  effectivePlan, entitlementsFor, monthWindow, canAddStaff, canAddService,
  badgeVisible, reminderQuotaExceeded, type OrgSubscriptionRow,
} from "./entitlements";

const now = new Date("2026-08-18T12:00:00Z");
const row = (o: Partial<OrgSubscriptionRow>): OrgSubscriptionRow => ({
  plan: "pro", status: "active", interval: "month", seats: 1,
  currentPeriodEnd: "2026-09-18T12:00:00Z", cancelAtPeriodEnd: false, ...o,
});

describe("effectivePlan", () => {
  it("no row → free", () => expect(effectivePlan(null, now)).toBe("free"));
  it("active / past_due → the plan", () => {
    expect(effectivePlan(row({}), now)).toBe("pro");
    expect(effectivePlan(row({ status: "past_due" }), now)).toBe("pro");
  });
  it("cancelled keeps the plan until current_period_end", () => {
    expect(effectivePlan(row({ status: "cancelled" }), now)).toBe("pro");
    expect(effectivePlan(row({ status: "cancelled", currentPeriodEnd: "2026-08-01T00:00:00Z" }), now)).toBe("free");
    expect(effectivePlan(row({ status: "cancelled", currentPeriodEnd: null }), now)).toBe("free");
  });
  it("expired → free", () => expect(effectivePlan(row({ status: "expired" }), now)).toBe("free"));
});

describe("entitlementsFor", () => {
  it("free defaults", () => {
    const e = entitlementsFor(null, now);
    expect(e.plan).toBe("free");
    expect(e.bookableStaff).toBe(1);
    expect(e.publicServices).toBe(3);
    expect(e.hideBadge).toBe(false);
  });
  it("team uses seats for bookableStaff", () => {
    const e = entitlementsFor(row({ plan: "team", seats: 7 }), now);
    expect(e.plan).toBe("team");
    expect(e.bookableStaff).toBe(7);
    expect(e.publicServices).toBeNull();
    expect(e.hideBadge).toBe(true);
  });
});

describe("monthWindow", () => {
  it("is the org-local calendar month as UTC instants (Warsaw, DST month)", () => {
    const w = monthWindow(new Date("2026-10-20T10:00:00Z"), "Europe/Warsaw");
    expect(w.fromIso).toBe("2026-09-30T22:00:00.000Z"); // Oct 1 00:00 CEST
    expect(w.toIso).toBe("2026-10-31T23:00:00.000Z");   // Nov 1 00:00 CET
  });
  it("handles year rollover", () => {
    const w = monthWindow(new Date("2026-12-31T23:30:00Z"), "UTC");
    expect(w.fromIso).toBe("2026-12-01T00:00:00.000Z");
    expect(w.toIso).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("gates", () => {
  const free = entitlementsFor(null, now);
  const team = entitlementsFor(row({ plan: "team", seats: 5 }), now);
  it("canAddStaff", () => {
    expect(canAddStaff(1, free)).toBe(false);
    expect(canAddStaff(0, free)).toBe(true);
    expect(canAddStaff(4, team)).toBe(true);
    expect(canAddStaff(5, team)).toBe(false);
  });
  it("canAddService", () => {
    expect(canAddService(2, free)).toBe(true);
    expect(canAddService(3, free)).toBe(false);
    expect(canAddService(300, team)).toBe(true);
  });
  it("badgeVisible: hidden only when the org asked AND the plan allows", () => {
    expect(badgeVisible(true, free)).toBe(true);
    expect(badgeVisible(false, team)).toBe(true);
    expect(badgeVisible(true, team)).toBe(false);
  });
  it("reminderQuotaExceeded", () => {
    expect(reminderQuotaExceeded(29, free)).toBe(false);
    expect(reminderQuotaExceeded(30, free)).toBe(true);
    expect(reminderQuotaExceeded(10_000, team)).toBe(false);
  });
});
```
Run: `npx vitest run src/lib/billing/entitlements.test.ts` → FAIL.

- [ ] **Step 2: Implement**

`src/lib/billing/entitlements.ts`:
```ts
// Pure: an org_subscriptions row (or its absence = Free) → what the org may
// do. No clock reads, no I/O — every consumer injects `now`. The one place
// the effective-plan rule lives (spec §7.2); the SQL view billing_mrr
// restates it and says so.
import { PLANS, type Interval, type PaidPlanId, type PlanId, type PlanLimits } from "./plans";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

export type SubscriptionStatus = "active" | "past_due" | "cancelled" | "expired";

export type OrgSubscriptionRow = {
  plan: PaidPlanId;
  status: SubscriptionStatus;
  interval: Interval;
  seats: number;
  currentPeriodEnd: string | null; // ISO
  cancelAtPeriodEnd: boolean;
};

export type Entitlements = PlanLimits & { plan: PlanId };

export function effectivePlan(row: OrgSubscriptionRow | null, now: Date): PlanId {
  if (!row) return "free";
  if (row.status === "active" || row.status === "past_due") return row.plan;
  if (row.status === "cancelled" && row.currentPeriodEnd && Date.parse(row.currentPeriodEnd) > now.getTime()) {
    return row.plan;
  }
  return "free";
}

export function entitlementsFor(row: OrgSubscriptionRow | null, now: Date): Entitlements {
  const plan = effectivePlan(row, now);
  const limits = { ...PLANS[plan].limits };
  if (plan === "team" && row) limits.bookableStaff = Math.max(1, row.seats);
  return { plan, ...limits };
}

/** The org-local calendar month containing `now`, as UTC instants [from, to). */
export function monthWindow(now: Date, timeZone: string): { fromIso: string; toIso: string } {
  const today = dateInZone(now, timeZone); // YYYY-MM-DD
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const first = `${today.slice(0, 7)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return {
    fromIso: wallTimeToUtc(first, "00:00", timeZone).toISOString(),
    toIso: wallTimeToUtc(next, "00:00", timeZone).toISOString(),
  };
}

export function canAddStaff(activeCount: number, ent: Entitlements): boolean {
  return activeCount < ent.bookableStaff;
}

export function canAddService(serviceCount: number, ent: Entitlements): boolean {
  return ent.publicServices === null || serviceCount < ent.publicServices;
}

/** The badge shows unless the org asked to hide it AND the plan allows hiding. */
export function badgeVisible(themeHidePoweredBy: boolean, ent: Entitlements): boolean {
  return !(themeHidePoweredBy && ent.hideBadge);
}

export function reminderQuotaExceeded(usedThisMonth: number, ent: Entitlements): boolean {
  return ent.reminderBookingsPerMonth !== null && usedThisMonth >= ent.reminderBookingsPerMonth;
}
```
Run the test → PASS. If `Europe/Warsaw` expectations disagree by an hour, check `wallTimeToUtc`'s contract in `slots.ts` (it is DST-safe; the numbers above are correct for CEST/CET) before touching the test.

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing && git commit -m "feat(billing): pure entitlements (effective plan, month window, gates)"
```

---

### Task 3: Schema + migrations 0042/0043 + RLS integration test

**Files:**
- Create: `src/db/schema/billing.ts`, `src/db/migrations/0042_<generated>.sql`, `src/db/migrations/0043_billing_security.sql`, `src/lib/billing/billing.integration.test.ts`
- Modify: `src/db/schema/index.ts`

**Interfaces:**
- Produces: tables `public.org_subscriptions` (columns below), `public.billing_events`, index `bookings_org_created_at_idx`, view `public.billing_mrr`.

- [ ] **Step 1: Drizzle schema**

`src/db/schema/billing.ts`:
```ts
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Cache of the billing provider's truth (spec §7.2). Written ONLY by the
// webhook route (service role); members read their own row; absence = Free.
// CHECKs, RLS, grants live in 0043_billing_security.sql.
export const orgSubscriptions = pgTable(
  "org_subscriptions",
  {
    orgId: uuid("org_id").primaryKey().references(() => orgs.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(),               // 'pro' | 'team'
    status: text("status").notNull(),           // 'active' | 'past_due' | 'cancelled' | 'expired'
    billingInterval: text("billing_interval").notNull(), // 'month' | 'year'
    seats: integer("seats").default(1).notNull(),
    provider: text("provider").notNull(),       // 'stripe' | 'fake'
    providerCustomerId: text("provider_customer_id").notNull(),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    // Ordering guard: a webhook older than this is ignored.
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("org_subscriptions_provider_sub_uq").on(t.providerSubscriptionId)],
);

// Webhook audit + idempotency. Service role only.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("billing_events_provider_event_uq").on(t.provider, t.providerEventId),
    index("billing_events_org_id_idx").on(t.orgId),
  ],
);
```
Add `export * from "./billing";` to `src/db/schema/index.ts` (and mention `orgSubscriptions, billingEvents` in its comment).

- [ ] **Step 2: Generate 0042**

Run: `npx drizzle-kit generate` → `src/db/migrations/0042_<random>.sql` creating the two tables, FKs, indexes. Inspect: no drops, no unrelated diffs. Then `npm run db:migrate`.

- [ ] **Step 3: Write 0043**

Run `npx drizzle-kit generate --custom --name=billing_security`, then fill `src/db/migrations/0043_billing_security.sql`:
```sql
-- 0043 (Billing): CHECKs, RLS, grants for org_subscriptions + billing_events,
-- the (org_id, created_at) bookings index behind the monthly usage count, and
-- the founder's MRR view. Written idempotently (drop-if-exists before add).

-- ---------- CHECKs
alter table public.org_subscriptions drop constraint if exists org_subscriptions_plan_chk;
alter table public.org_subscriptions add constraint org_subscriptions_plan_chk check (plan in ('pro','team'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_status_chk;
alter table public.org_subscriptions add constraint org_subscriptions_status_chk
  check (status in ('active','past_due','cancelled','expired'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_interval_chk;
alter table public.org_subscriptions add constraint org_subscriptions_interval_chk check (billing_interval in ('month','year'));
alter table public.org_subscriptions drop constraint if exists org_subscriptions_seats_chk;
alter table public.org_subscriptions add constraint org_subscriptions_seats_chk check (seats >= 1);
alter table public.org_subscriptions drop constraint if exists org_subscriptions_provider_chk;
alter table public.org_subscriptions add constraint org_subscriptions_provider_chk check (provider in ('stripe','fake'));

-- ---------- RLS: members read their own row; nobody but service_role writes.
alter table public.org_subscriptions enable row level security;
drop policy if exists "org_subscriptions_select_member" on public.org_subscriptions;
create policy "org_subscriptions_select_member" on public.org_subscriptions
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies on purpose (spec §4.4: webhook-written cache)

alter table public.billing_events enable row level security;
-- no policies at all: service_role bypasses RLS, everyone else has no grant.

-- ---------- Grants (0004 doctrine: explicit, anon gets nothing)
revoke all on table public.org_subscriptions from public, anon, authenticated, service_role;
grant select on table public.org_subscriptions to authenticated;
grant select, insert, update, delete on table public.org_subscriptions to service_role;
revoke all on table public.billing_events from public, anon, authenticated, service_role;
grant select, insert, update on table public.billing_events to service_role;

-- ---------- Monthly usage count (spec §7.3): bookings made this month per org.
create index if not exists bookings_org_created_at_idx on public.bookings (org_id, created_at);

-- ---------- Founder's MRR view. Prices MIRROR src/lib/billing/plans.ts — keep both in step.
-- Effective-plan rule mirrors entitlements.ts: active/past_due, or cancelled until period end.
drop view if exists public.billing_mrr;
create view public.billing_mrr with (security_invoker = true) as
select plan,
       billing_interval,
       count(*)::int as subscriptions,
       sum(seats)::int as seats,
       sum(case
             when plan = 'pro'  and billing_interval = 'month' then 12
             when plan = 'pro'  and billing_interval = 'year'  then 9
             when plan = 'team' and billing_interval = 'month' then 29
             else 24
           end)::numeric as mrr_usd
from public.org_subscriptions
where status in ('active','past_due')
   or (status = 'cancelled' and current_period_end > now())
group by plan, billing_interval;
revoke all on public.billing_mrr from public, anon, authenticated, service_role;
grant select on public.billing_mrr to service_role;
```
Run `npm run db:migrate`.

- [ ] **Step 4: Failing integration test (RLS + view)**

`src/lib/billing/billing.integration.test.ts` (later tasks append to this file):
```ts
/**
 * Billing slice against the real DB: RLS/grants on org_subscriptions +
 * billing_events, applyBillingEvents idempotency/ordering, monthly usage
 * count, billing_mrr view. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `bill_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

const RUN = Date.now().toString(36);
let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;

const subRow = (o: Record<string, unknown> = {}) => ({
  org_id: orgId, plan: "pro", status: "active", billing_interval: "month", seats: 1,
  provider: "fake", provider_customer_id: `cus_${RUN}`, provider_subscription_id: `sub_${RUN}`,
  current_period_end: new Date(Date.now() + 30 * 864e5).toISOString(),
  cancel_at_period_end: false, provider_updated_at: new Date().toISOString(), ...o,
});

describe("billing: RLS + grants", () => {
  beforeAll(async () => {
    owner = await signedInUser("owner");
    stranger = await signedInUser("stranger");
    const { data, error } = await owner.rpc("create_org", { p_name: "BillCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
    const { error: insErr } = await admin.from("org_subscriptions").insert(subRow());
    if (insErr) throw insErr;
  });

  it("member selects own row; stranger and anon see nothing", async () => {
    const mine = await owner.from("org_subscriptions").select("plan").eq("org_id", orgId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    const theirs = await stranger.from("org_subscriptions").select("plan").eq("org_id", orgId);
    expect(theirs.data ?? []).toHaveLength(0);
    const nobody = await anon.from("org_subscriptions").select("plan");
    expect(nobody.error).not.toBeNull(); // no grant at all
  });

  it("member cannot insert/update/delete", async () => {
    const up = await owner.from("org_subscriptions").update({ plan: "team" }).eq("org_id", orgId);
    expect(up.error).not.toBeNull();
    const del = await owner.from("org_subscriptions").delete().eq("org_id", orgId);
    expect(del.error).not.toBeNull();
  });

  it("billing_events: service_role only", async () => {
    const ins = await admin.from("billing_events").insert({
      provider: "fake", provider_event_id: `evt_${RUN}`, org_id: orgId, type: "subscription_created", payload: {},
    });
    expect(ins.error).toBeNull();
    const dup = await admin.from("billing_events").insert({
      provider: "fake", provider_event_id: `evt_${RUN}`, org_id: orgId, type: "subscription_created", payload: {},
    });
    expect(dup.error?.code).toBe("23505");
    const member = await owner.from("billing_events").select("id");
    expect(member.error).not.toBeNull();
  });

  it("CHECKs reject bad plan/status", async () => {
    const bad = await admin.from("org_subscriptions").update({ plan: "gold" }).eq("org_id", orgId);
    expect(bad.error).not.toBeNull();
  });

  it("billing_mrr counts this org's pro monthly", async () => {
    const { data, error } = await admin.from("billing_mrr").select("*").eq("plan", "pro").eq("billing_interval", "month");
    expect(error).toBeNull();
    expect((data ?? [])[0]?.subscriptions).toBeGreaterThanOrEqual(1);
  });
});
```
Run: `npx vitest run --config vitest.integration.config.ts src/lib/billing/billing.integration.test.ts` → PASS (the migrations from Steps 2–3 are already applied; if any assertion fails, fix the SQL, re-apply 0043 by hand via the `postgres` package script idiom, re-run).

- [ ] **Step 5: Commit**

```bash
git add src/db src/lib/billing && git commit -m "feat(billing): org_subscriptions + billing_events (0042/0043), RLS, mrr view"
```

---

### Task 4: Server-only billing reads

**Files:**
- Create: `src/lib/billing/queries.ts`
- Modify: `src/lib/billing/billing.integration.test.ts` (append usage test)

**Interfaces:**
- Consumes: `entitlementsFor`, `monthWindow`, `badgeVisible`, `OrgSubscriptionRow` (Task 2); `createAdminClient`; `parseWidgetTheme` (`@/lib/widget-theme`).
- Produces:
  ```ts
  getOrgSubscription(orgId, client: SupabaseClient): Promise<OrgSubscriptionRow | null>
  getEntitlements(orgId, client, now?): Promise<Entitlements>
  getEntitlementsAdmin(orgId, now?): Promise<Entitlements>   // admin client; React cache()d
  monthlyBookingUsage(orgId, timeZone, now, db): Promise<number>
  emailBadgeVisible(orgId): Promise<boolean>                 // swallows errors → true
  ```

- [ ] **Step 1: Implement**

`src/lib/billing/queries.ts`:
```ts
import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseWidgetTheme } from "@/lib/widget-theme";
import { badgeVisible, entitlementsFor, monthWindow, type Entitlements, type OrgSubscriptionRow } from "./entitlements";
import { isPaidPlan } from "./plans";

const SUB_COLS = "plan, status, billing_interval, seats, current_period_end, cancel_at_period_end";

// Works with the RLS client (dashboard: policy scopes to the member's org)
// and the admin client (public/drain paths: caller resolved orgId already).
export async function getOrgSubscription(orgId: string, client: SupabaseClient): Promise<OrgSubscriptionRow | null> {
  const { data, error } = await client.from("org_subscriptions").select(SUB_COLS).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data || !isPaidPlan(data.plan)) return null;
  return {
    plan: data.plan,
    status: data.status as OrgSubscriptionRow["status"],
    interval: data.billing_interval as OrgSubscriptionRow["interval"],
    seats: data.seats,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}

export async function getEntitlements(orgId: string, client: SupabaseClient, now = new Date()): Promise<Entitlements> {
  return entitlementsFor(await getOrgSubscription(orgId, client), now);
}

/** Public/drain paths. Per-request memoised. Degrades to Free on failure —
    a broken billing read must never break a booking page (spec §7.10). */
export const getEntitlementsAdmin = cache(async (orgId: string, now = new Date()): Promise<Entitlements> => {
  try {
    return await getEntitlements(orgId, createAdminClient(), now);
  } catch (error) {
    console.error("[billing] entitlements read failed (treating as Free):", error);
    return entitlementsFor(null, now);
  }
});

/** "Bookings made this month": original bookings (rescheduled_from_id null),
    any status, created inside the org-local calendar month. */
export async function monthlyBookingUsage(
  orgId: string, timeZone: string, now: Date, db: SupabaseClient,
): Promise<number> {
  const { fromIso, toIso } = monthWindow(now, timeZone);
  const { count, error } = await db
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("rescheduled_from_id", null)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

/** For client-facing emails: badge shows unless the org hid it AND may.
    Swallows errors (resolveClientStaffName idiom) — after a committed
    booking nothing may fail the action; showing the badge is the safe default. */
export async function emailBadgeVisible(orgId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const [{ data }, ent] = await Promise.all([
      admin.from("orgs").select("widget_theme").eq("id", orgId).maybeSingle(),
      getEntitlementsAdmin(orgId),
    ]);
    return badgeVisible(parseWidgetTheme(data?.widget_theme).hidePoweredBy, ent);
  } catch (error) {
    console.error("[billing] emailBadgeVisible:", error);
    return true;
  }
}
```

- [ ] **Step 2: Append usage test to the integration file**

```ts
import { monthlyBookingUsage } from "./queries";

describe("billing: monthlyBookingUsage", () => {
  it("counts original bookings created this month, ignores reschedule rows", async () => {
    // Fixture: a staff + service exist for the org from create_org; insert bookings directly.
    const { data: staff } = await admin.from("staff").select("id").eq("org_id", orgId).limit(1).single();
    const { data: svc } = await admin.from("services").insert({ org_id: orgId, name: "U", duration_min: 30 }).select("id").single();
    const base = Date.now() + 7 * 864e5;
    const mk = (i: number, extra: Record<string, unknown> = {}) => ({
      org_id: orgId, service_id: svc!.id, staff_id: staff!.id, client_name: "c", client_email: "c@example.com",
      starts_at: new Date(base + i * 36e5).toISOString(), ends_at: new Date(base + i * 36e5 + 18e5).toISOString(),
      status: "confirmed", cancel_token_hash: `${RUN}${i}`.padEnd(64, "0").slice(0, 64), ...extra,
    });
    const { data: first, error } = await admin.from("bookings").insert([mk(1), mk(2)]).select("id");
    if (error) throw error;
    await admin.from("bookings").insert(mk(3, { rescheduled_from_id: first![0].id }));
    const n = await monthlyBookingUsage(orgId, "UTC", new Date(), admin);
    expect(n).toBe(2);
  });
});
```
(If the `bookings` insert needs other NOT NULL columns, copy the fixture shape from `reminder-drain.integration.test.ts` — the client columns are `client_name`/`client_email`/`client_note` and `cancel_token_hash` is unique per row.)
Run the integration file → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing && git commit -m "feat(billing): server-only entitlement + usage reads"
```

---

### Task 5: Provider seam, fake adapter, apply-events

**Files:**
- Create: `src/lib/billing/provider.ts`, `src/lib/billing/fake.ts`, `src/lib/billing/fake.test.ts`, `src/lib/billing/apply-events.ts`
- Modify: `src/lib/billing/billing.integration.test.ts` (append apply-events tests)

**Interfaces:**
- Produces:
  ```ts
  type BillingEventType = "subscription_created" | "subscription_updated" | "subscription_cancelled" | "subscription_expired" | "payment_failed" | "payment_recovered";
  type BillingEvent = { providerEventId: string; provider: "stripe" | "fake"; occurredAt: string; orgId: string | null; type: BillingEventType; subscription: { providerCustomerId: string; providerSubscriptionId: string; plan: PaidPlanId; interval: Interval; seats: number; status: SubscriptionStatus; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null; raw: unknown };
  interface BillingProvider { name: "stripe" | "fake"; createCheckoutUrl(input: CheckoutInput): Promise<string>; createPortalUrl(providerCustomerId: string, returnUrl: string): Promise<string>; parseWebhook(rawBody: string, headers: Headers): BillingEvent[]; }
  type CheckoutInput = { orgId: string; plan: PaidPlanId; interval: Interval; email: string; discountCode?: string; returnUrl: string };
  selectBillingProvider(): BillingProvider
  signFakeWebhook(body: string, secret: string): string           // hex HMAC-SHA256
  applyBillingEvents(admin: SupabaseClient, events: BillingEvent[]): Promise<{ processed: number; skipped: number }>
  ```

- [ ] **Step 1: `provider.ts`**

```ts
import "server-only";
import { env } from "@/env";
import type { Interval, PaidPlanId } from "./plans";
import type { SubscriptionStatus } from "./entitlements";

// The ONLY vendor decision for billing (email transport idiom): Stripe
// Managed Payments in production, a fake for dev/tests. Adapters normalise
// everything into BillingEvent; the rest of the app never sees a vendor type.
export type ProviderName = "stripe" | "fake";

export type BillingEventType =
  | "subscription_created" | "subscription_updated" | "subscription_cancelled"
  | "subscription_expired" | "payment_failed" | "payment_recovered";

export type BillingSubscription = {
  providerCustomerId: string;
  providerSubscriptionId: string;
  plan: PaidPlanId;
  interval: Interval;
  seats: number;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type BillingEvent = {
  provider: ProviderName;
  providerEventId: string;   // idempotency key
  occurredAt: string;        // ISO from the provider payload
  orgId: string | null;      // from checkout metadata; null = unresolvable
  type: BillingEventType;
  subscription: BillingSubscription | null;
  raw: unknown;              // stored in billing_events.payload
};

export type CheckoutInput = {
  orgId: string; plan: PaidPlanId; interval: Interval; email: string;
  discountCode?: string; returnUrl: string;
};

export interface BillingProvider {
  readonly name: ProviderName;
  createCheckoutUrl(input: CheckoutInput): Promise<string>;
  createPortalUrl(providerCustomerId: string, returnUrl: string): Promise<string>;
  /** Verify the signature and normalise. Throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[];
}

export function selectBillingProvider(): BillingProvider {
  if (env.BILLING_PROVIDER === "stripe") {
    // Lazy import keeps the SDK out of every bundle that only needs the types.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { stripeProvider } = require("./stripe") as typeof import("./stripe");
    return stripeProvider();
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { fakeProvider } = require("./fake") as typeof import("./fake");
  return fakeProvider();
}
```
(If the repo's ESLint config forbids `require`, switch to top-level `import { stripeProvider } from "./stripe"` / `"./fake"` — the Stripe module must then guard `env.STRIPE_SECRET_KEY` lazily inside `stripeProvider()`, not at import time.)

- [ ] **Step 2: Failing test for the fake signature**

`src/lib/billing/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signFakeWebhook, parseFakeWebhook } from "./fake";

const secret = "0123456789abcdef0123456789abcdef";
const body = JSON.stringify([{ providerEventId: "e1", occurredAt: "2026-08-18T00:00:00Z", orgId: "o", type: "subscription_created", subscription: null }]);

describe("fake webhook", () => {
  it("accepts a correctly signed body", () => {
    const events = parseFakeWebhook(body, new Headers({ "x-signature": signFakeWebhook(body, secret) }), secret);
    expect(events).toHaveLength(1);
    expect(events[0].provider).toBe("fake");
    expect(events[0].providerEventId).toBe("e1");
  });
  it("rejects a bad or missing signature", () => {
    expect(() => parseFakeWebhook(body, new Headers({ "x-signature": "deadbeef" }), secret)).toThrow();
    expect(() => parseFakeWebhook(body, new Headers(), secret)).toThrow();
  });
});
```
Run → FAIL.

- [ ] **Step 3: `fake.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import type { BillingEvent, BillingProvider, CheckoutInput } from "./provider";

export function signFakeWebhook(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Body = JSON array of BillingEvent minus `provider`/`raw`. */
export function parseFakeWebhook(rawBody: string, headers: Headers, secret: string): BillingEvent[] {
  const provided = headers.get("x-signature") ?? "";
  const expected = signFakeWebhook(rawBody, secret);
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
  const parsed = JSON.parse(rawBody) as Array<Omit<BillingEvent, "provider" | "raw">>;
  return parsed.map((e) => ({ ...e, provider: "fake", raw: e }));
}

export function fakeProvider(): BillingProvider {
  return {
    name: "fake",
    async createCheckoutUrl(input: CheckoutInput) {
      const q = new URLSearchParams({ org: input.orgId, plan: input.plan, interval: input.interval, return: input.returnUrl });
      return `${env.NEXT_PUBLIC_APP_URL}/api/billing/dev-checkout?${q}`;
    },
    async createPortalUrl(_customerId: string, returnUrl: string) {
      return returnUrl; // nothing to manage in the fake
    },
    parseWebhook(rawBody, headers) {
      if (!env.BILLING_FAKE_SECRET) throw new Error("BILLING_FAKE_SECRET unset");
      return parseFakeWebhook(rawBody, headers, env.BILLING_FAKE_SECRET);
    },
  };
}
```
Run the test → PASS.

- [ ] **Step 4: `apply-events.ts`**

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingEvent } from "./provider";

// Idempotent, order-safe projection of provider events onto our cache
// (spec §7.5). 1) record the event (unique → already processed → skip);
// 2) unresolvable org → recorded with error, no upsert; 3) upsert only if
// the event is newer than provider_updated_at.
export async function applyBillingEvents(
  admin: SupabaseClient, events: BillingEvent[],
): Promise<{ processed: number; skipped: number }> {
  let processed = 0, skipped = 0;
  const ordered = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const ev of ordered) {
    const { error: insErr } = await admin.from("billing_events").insert({
      provider: ev.provider, provider_event_id: ev.providerEventId, org_id: ev.orgId,
      type: ev.type, payload: ev.raw as object, error: ev.orgId ? null : "unresolvable org",
    });
    if (insErr) {
      if (insErr.code === "23505") { skipped += 1; continue; } // replay
      throw insErr;
    }
    if (!ev.orgId || !ev.subscription) { skipped += 1; continue; }

    const { data: current, error: readErr } = await admin
      .from("org_subscriptions").select("provider_updated_at").eq("org_id", ev.orgId).maybeSingle();
    if (readErr) throw readErr;
    if (current && Date.parse(current.provider_updated_at) >= Date.parse(ev.occurredAt)) { skipped += 1; continue; }

    const s = ev.subscription;
    const { error: upErr } = await admin.from("org_subscriptions").upsert({
      org_id: ev.orgId, plan: s.plan, status: s.status, billing_interval: s.interval, seats: s.seats,
      provider: ev.provider, provider_customer_id: s.providerCustomerId, provider_subscription_id: s.providerSubscriptionId,
      current_period_end: s.currentPeriodEnd, cancel_at_period_end: s.cancelAtPeriodEnd,
      provider_updated_at: ev.occurredAt, updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });
    if (upErr) throw upErr;
    processed += 1;
  }
  return { processed, skipped };
}
```

- [ ] **Step 5: Append integration tests**

```ts
import { applyBillingEvents } from "./apply-events";
import type { BillingEvent } from "./provider";

const ev = (id: string, at: string, o: Partial<BillingEvent> = {}, s: Partial<NonNullable<BillingEvent["subscription"]>> = {}): BillingEvent => ({
  provider: "fake", providerEventId: `${RUN}-${id}`, occurredAt: at, orgId: orgId, type: "subscription_updated", raw: { id },
  subscription: { providerCustomerId: `cus_${RUN}`, providerSubscriptionId: `sub_${RUN}`, plan: "team", interval: "year", seats: 5,
    status: "active", currentPeriodEnd: "2027-01-01T00:00:00Z", cancelAtPeriodEnd: false, ...s },
  ...o,
});

describe("billing: applyBillingEvents", () => {
  it("applies, dedupes replays, ignores older events, records unresolvable orgs", async () => {
    const r1 = await applyBillingEvents(admin, [ev("a", "2026-08-18T10:00:00Z")]);
    expect(r1).toEqual({ processed: 1, skipped: 0 });
    let row = (await admin.from("org_subscriptions").select("plan, seats").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");

    const r2 = await applyBillingEvents(admin, [ev("a", "2026-08-18T10:00:00Z")]); // replay
    expect(r2).toEqual({ processed: 0, skipped: 1 });

    const r3 = await applyBillingEvents(admin, [ev("old", "2026-08-18T09:00:00Z", {}, { plan: "pro" })]); // older
    expect(r3.skipped).toBe(1);
    row = (await admin.from("org_subscriptions").select("plan, seats").eq("org_id", orgId).single()).data!;
    expect(row.plan).toBe("team");

    const r4 = await applyBillingEvents(admin, [ev("x", "2026-08-18T11:00:00Z", { orgId: null })]);
    expect(r4.skipped).toBe(1);
    const logged = await admin.from("billing_events").select("error").eq("provider_event_id", `${RUN}-x`).single();
    expect(logged.data?.error).toBe("unresolvable org");

    const r5 = await applyBillingEvents(admin, [ev("exp", "2026-08-18T12:00:00Z", { type: "subscription_expired" }, { status: "expired" })]);
    expect(r5.processed).toBe(1);
    row = (await admin.from("org_subscriptions").select("status").eq("org_id", orgId).single()).data! as unknown as { plan: string; seats: number; status: string };
    expect(row.status).toBe("expired");
  });
});
```
Run the integration file → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/billing && git commit -m "feat(billing): provider seam, fake adapter, idempotent apply-events"
```

---
### Task 6: Stripe Managed Payments adapter

**Files:**
- Create: `src/lib/billing/stripe.ts`, `src/lib/billing/stripe.test.ts`, `src/lib/billing/__fixtures__/stripe-subscription-updated.json`

**Interfaces:**
- Consumes: `BillingProvider`, `BillingEvent`, `CheckoutInput` (Task 5); `env.STRIPE_*`; `PLANS`.
- Produces: `stripeProvider(): BillingProvider`; pure, exported for tests: `mapStripeStatus(status): SubscriptionStatus`, `planFromPriceId(priceId, priceMap): { plan; interval } | null`, `normalizeStripeEvent(event, priceMap): BillingEvent | null`, `type PriceMap = Record<string, { plan: PaidPlanId; interval: Interval }>`, `priceMapFromEnv(): PriceMap`, `priceIdFor(plan, interval): string`.

- [ ] **Step 1: Failing unit tests**

`src/lib/billing/stripe.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mapStripeStatus, planFromPriceId, normalizeStripeEvent, type PriceMap } from "./stripe";

const priceMap: PriceMap = {
  price_pro_m: { plan: "pro", interval: "month" }, price_pro_y: { plan: "pro", interval: "year" },
  price_team_m: { plan: "team", interval: "month" }, price_team_y: { plan: "team", interval: "year" },
};

// Minimal Stripe event shape — only the fields the normaliser reads.
const subEvent = (type: string, sub: Record<string, unknown>) => ({
  id: "evt_1", type, created: 1_787_000_000,
  data: { object: { id: "sub_1", object: "subscription", customer: "cus_1", status: "active",
    cancel_at_period_end: false, metadata: { org_id: "org-uuid" },
    items: { data: [{ price: { id: "price_team_m" }, quantity: 5, current_period_end: 1_790_000_000 }] }, ...sub } },
});

describe("mapStripeStatus", () => {
  it("maps Stripe statuses onto ours", () => {
    expect(mapStripeStatus("active")).toBe("active");
    expect(mapStripeStatus("trialing")).toBe("active");
    expect(mapStripeStatus("past_due")).toBe("past_due");
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) expect(mapStripeStatus(s)).toBe("expired");
  });
});

describe("planFromPriceId", () => {
  it("resolves both directions and unknown → null", () => {
    expect(planFromPriceId("price_pro_y", priceMap)).toEqual({ plan: "pro", interval: "year" });
    expect(planFromPriceId("nope", priceMap)).toBeNull();
  });
});

describe("normalizeStripeEvent", () => {
  it("customer.subscription.updated → subscription_updated with org from metadata", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", {}) as never, priceMap)!;
    expect(e.type).toBe("subscription_updated");
    expect(e.orgId).toBe("org-uuid");
    expect(e.providerEventId).toBe("evt_1");
    expect(e.occurredAt).toBe(new Date(1_787_000_000 * 1000).toISOString());
    expect(e.subscription).toMatchObject({ plan: "team", interval: "month", seats: 5, status: "active",
      providerCustomerId: "cus_1", providerSubscriptionId: "sub_1", currentPeriodEnd: new Date(1_790_000_000 * 1000).toISOString() });
  });
  it("customer.subscription.deleted → subscription_expired regardless of status", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.deleted", { status: "canceled" }) as never, priceMap)!;
    expect(e.type).toBe("subscription_expired");
    expect(e.subscription?.status).toBe("expired");
  });
  it("cancel_at_period_end stays active with the flag", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { cancel_at_period_end: true }) as never, priceMap)!;
    expect(e.subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });
  it("unknown price → orgId kept, subscription null (recorded, not applied)", () => {
    const e = normalizeStripeEvent(subEvent("customer.subscription.updated", { items: { data: [{ price: { id: "zzz" }, quantity: 1 }] } }) as never, priceMap)!;
    expect(e.subscription).toBeNull();
  });
  it("ignores unrelated events", () => {
    expect(normalizeStripeEvent({ id: "evt_2", type: "checkout.session.completed", created: 1, data: { object: {} } } as never, priceMap)).toBeNull();
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `stripe.ts`**

```ts
import "server-only";
import Stripe from "stripe";
import { env } from "@/env";
import type { Interval, PaidPlanId } from "./plans";
import type { SubscriptionStatus } from "./entitlements";
import type { BillingEvent, BillingProvider, BillingSubscription, CheckoutInput } from "./provider";

// Stripe Managed Payments (spec §6/§7.1). The ONLY file in src/ that imports
// the stripe SDK. Stripe is the merchant of record: Checkout Session in
// subscription mode with managed_payments enabled; the Customer Portal
// handles cancel/interval/plan switches; webhooks project state onto our
// cache. Everything below the two exported pure mappers is I/O.

export type PriceMap = Record<string, { plan: PaidPlanId; interval: Interval }>;

export function priceMapFromEnv(): PriceMap {
  const m: PriceMap = {};
  if (env.STRIPE_PRICE_PRO_MONTH) m[env.STRIPE_PRICE_PRO_MONTH] = { plan: "pro", interval: "month" };
  if (env.STRIPE_PRICE_PRO_YEAR) m[env.STRIPE_PRICE_PRO_YEAR] = { plan: "pro", interval: "year" };
  if (env.STRIPE_PRICE_TEAM_MONTH) m[env.STRIPE_PRICE_TEAM_MONTH] = { plan: "team", interval: "month" };
  if (env.STRIPE_PRICE_TEAM_YEAR) m[env.STRIPE_PRICE_TEAM_YEAR] = { plan: "team", interval: "year" };
  return m;
}

export function priceIdFor(plan: PaidPlanId, interval: Interval): string {
  const id = plan === "pro"
    ? (interval === "month" ? env.STRIPE_PRICE_PRO_MONTH : env.STRIPE_PRICE_PRO_YEAR)
    : (interval === "month" ? env.STRIPE_PRICE_TEAM_MONTH : env.STRIPE_PRICE_TEAM_YEAR);
  if (!id) throw new Error(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()} unset`);
  return id;
}

export function mapStripeStatus(status: string): SubscriptionStatus {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  return "expired"; // canceled | unpaid | incomplete | incomplete_expired | paused
}

export function planFromPriceId(priceId: string, priceMap: PriceMap) {
  return priceMap[priceId] ?? null;
}

type SubLike = {
  id: string; customer: string | { id: string }; status: string; cancel_at_period_end: boolean;
  metadata?: Record<string, string>;
  items: { data: Array<{ price: { id: string }; quantity?: number; current_period_end?: number }> };
};

function subscriptionFrom(sub: SubLike, priceMap: PriceMap, forceExpired: boolean): BillingSubscription | null {
  const item = sub.items?.data?.[0];
  if (!item) return null;
  const mapped = planFromPriceId(item.price.id, priceMap);
  if (!mapped) return null;
  return {
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    providerSubscriptionId: sub.id,
    plan: mapped.plan,
    interval: mapped.interval,
    seats: mapped.plan === "team" ? 5 : 1, // Team is fixed at 5 seats in this slice; quantity → seats is spec §8 item 3
    status: forceExpired ? "expired" : mapStripeStatus(sub.status),
    currentPeriodEnd: item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  };
}

export function normalizeStripeEvent(event: Stripe.Event, priceMap: PriceMap): BillingEvent | null {
  const base = {
    provider: "stripe" as const,
    providerEventId: event.id,
    occurredAt: new Date(event.created * 1000).toISOString(),
    raw: event,
  };
  const obj = event.data.object as unknown;
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = obj as SubLike;
      const deleted = event.type === "customer.subscription.deleted";
      return {
        ...base,
        orgId: sub.metadata?.org_id ?? null,
        type: deleted ? "subscription_expired" : event.type === "customer.subscription.created" ? "subscription_created" : "subscription_updated",
        subscription: subscriptionFrom(sub, priceMap, deleted),
      };
    }
    case "invoice.payment_failed":
    case "invoice.paid": {
      // Invoice events carry the subscription id but not its metadata; the
      // route re-fetches the subscription (see stripeProvider.parseWebhook).
      return null;
    }
    default:
      return null;
  }
}

export function stripeProvider(): BillingProvider {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY unset");
  const stripe = new Stripe(env.STRIPE_SECRET_KEY);
  const priceMap = priceMapFromEnv();
  return {
    name: "stripe",
    async createCheckoutUrl(input: CheckoutInput) {
      const params: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: [{ price: priceIdFor(input.plan, input.interval), quantity: 1 }],
        client_reference_id: input.orgId,
        customer_email: input.email,
        metadata: { org_id: input.orgId },
        subscription_data: { metadata: { org_id: input.orgId } },
        success_url: input.returnUrl,
        cancel_url: input.returnUrl,
        allow_promotion_codes: false,
        ...(input.discountCode ? { discounts: [{ promotion_code: input.discountCode }] } : {}),
      };
      // Managed Payments flag (API ≥ 2025-03-31.basil). If the installed SDK's
      // types lag, keep the cast; the API accepts it.
      const session = await stripe.checkout.sessions.create({
        ...params, managed_payments: { enabled: true },
      } as unknown as Stripe.Checkout.SessionCreateParams);
      if (!session.url) throw new Error("stripe: no checkout url");
      return session.url;
    },
    async createPortalUrl(providerCustomerId, returnUrl) {
      const s = await stripe.billingPortal.sessions.create({ customer: providerCustomerId, return_url: returnUrl });
      return s.url;
    },
    parseWebhook(rawBody, headers) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET unset");
      const sig = headers.get("stripe-signature") ?? "";
      const event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET); // throws on bad signature
      const normalized = normalizeStripeEvent(event, priceMap);
      return normalized ? [normalized] : [];
    },
  };
}
```
Note on `invoice.*`: this slice derives `past_due`/`active` from `customer.subscription.updated` (Stripe flips the subscription status on payment failure/recovery and emits that event), so the invoice events are deliberately ignored — one source, no re-fetch. Record this in the spec's Implementation notes (§7.1 listed invoice events).

Run the unit test → PASS. Run `npm run verify` → PASS (fix any SDK type nits with the cast shown; never widen the import beyond this file).

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing && git commit -m "feat(billing): Stripe Managed Payments adapter with pure event/status/price mappers"
```

---

### Task 7: Webhook route + dev checkout route

**Files:**
- Create: `src/app/api/billing/webhook/route.ts`, `src/app/api/billing/dev-checkout/route.ts`, `src/app/api/billing/webhook/route.integration.test.ts`

**Interfaces:**
- Consumes: `selectBillingProvider`, `applyBillingEvents`, `signFakeWebhook`, `createAdminClient`, `env`, `PLANS`.
- Produces: `POST /api/billing/webhook` (200 `{processed, skipped}`, 401 bad signature, 503 provider secret unset, 400 malformed); `GET /api/billing/dev-checkout?org&plan&interval&return` (non-production, fake provider only; writes an active subscription and redirects to `return`).

- [ ] **Step 1: Webhook route**

```ts
import { revalidatePath } from "next/cache";
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectBillingProvider } from "@/lib/billing/provider";
import { applyBillingEvents } from "@/lib/billing/apply-events";

// Provider → cache. Raw body first (signatures cover bytes). Fail closed
// when the provider secret is unset (drain-auth idiom). Business-level
// unknowns (org missing) return 200 — never make the provider retry a bug.
export async function POST(request: Request) {
  const secretSet = env.BILLING_PROVIDER === "stripe" ? Boolean(env.STRIPE_WEBHOOK_SECRET) : Boolean(env.BILLING_FAKE_SECRET);
  if (!secretSet) return Response.json({ error: "billing webhook disabled" }, { status: 503 });
  const rawBody = await request.text();
  let events;
  try {
    events = selectBillingProvider().parseWebhook(rawBody, request.headers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/signature/i.test(msg)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ error: "malformed" }, { status: 400 });
  }
  try {
    const summary = await applyBillingEvents(createAdminClient(), events);
    if (summary.processed > 0) revalidatePath("/billing");
    return Response.json(summary);
  } catch (error) {
    console.error("[billing] webhook apply failed:", error);
    return Response.json({ error: "apply failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Dev checkout route**

`src/app/api/billing/dev-checkout/route.ts`:
```ts
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyBillingEvents } from "@/lib/billing/apply-events";
import { isPaidPlan, TEAM_INCLUDED_SEATS } from "@/lib/billing/plans";

// Fake provider's "checkout": writes an active subscription and bounces back.
// Dev/test only — 404 in production or whenever the real provider is on.
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || env.BILLING_PROVIDER === "stripe") {
    return new Response("Not found", { status: 404 });
  }
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  const plan = url.searchParams.get("plan");
  const interval = url.searchParams.get("interval") === "year" ? "year" : "month";
  const back = url.searchParams.get("return") ?? `${env.NEXT_PUBLIC_APP_URL}/billing`;
  if (!org || !plan || !isPaidPlan(plan)) return Response.json({ error: "bad params" }, { status: 400 });
  const now = new Date();
  await applyBillingEvents(createAdminClient(), [{
    provider: "fake", providerEventId: `dev-${org}-${now.getTime()}`, occurredAt: now.toISOString(), orgId: org,
    type: "subscription_created", raw: { dev: true },
    subscription: {
      providerCustomerId: `cus_dev_${org}`, providerSubscriptionId: `sub_dev_${org}`, plan, interval,
      seats: plan === "team" ? TEAM_INCLUDED_SEATS : 1, status: "active",
      currentPeriodEnd: new Date(now.getTime() + 30 * 864e5).toISOString(), cancelAtPeriodEnd: false,
    },
  }]);
  return Response.redirect(`${back}${back.includes("?") ? "&" : "?"}checkout=success`, 303);
}
```

- [ ] **Step 3: Route integration test**

`src/app/api/billing/webhook/route.integration.test.ts` — set env BEFORE importing the route:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI */ }
process.env.BILLING_PROVIDER = "fake";
process.env.BILLING_FAKE_SECRET = "test-secret-0123456789abcdef";

const { POST } = await import("./route");
const { signFakeWebhook } = await import("@/lib/billing/fake");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const RUN = Date.now().toString(36);
let orgId: string;

describe("POST /api/billing/webhook (fake provider)", () => {
  beforeAll(async () => {
    const { data, error } = await admin.rpc("create_org", { p_name: "HookCo" }); // create_org is authenticated-only; use a signed-in user if this errors
    if (error) throw error;
    orgId = (data as { id: string }).id;
  });
  const body = () => JSON.stringify([{
    providerEventId: `hook-${RUN}`, occurredAt: new Date().toISOString(), orgId, type: "subscription_created",
    subscription: { providerCustomerId: "c", providerSubscriptionId: `s-${RUN}`, plan: "pro", interval: "month", seats: 1,
      status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false },
  }]);
  const post = (b: string, sig: string | null) => POST(new Request("http://x/api/billing/webhook", {
    method: "POST", body: b, headers: sig ? { "x-signature": sig } : {} }));

  it("401 on bad signature, 200 + row on good, replay skipped", async () => {
    expect((await post(body(), "bad")).status).toBe(401);
    const b = body();
    const ok = await post(b, signFakeWebhook(b, process.env.BILLING_FAKE_SECRET!));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ processed: 1, skipped: 0 });
    const row = await admin.from("org_subscriptions").select("plan").eq("org_id", orgId).single();
    expect(row.data?.plan).toBe("pro");
    const again = await post(b, signFakeWebhook(b, process.env.BILLING_FAKE_SECRET!));
    expect(await again.json()).toEqual({ processed: 0, skipped: 1 });
  });
});
```
If `create_org` refuses the service role (it is granted to `authenticated` only), reuse the `signedInUser` helper from `billing.integration.test.ts` (copy the 12 lines) to create the org. Run the file with the integration config → PASS. (`revalidatePath` outside a request logs a warning in tests — acceptable; if it throws, wrap it in `try {} catch {}` in the route.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/billing && git commit -m "feat(billing): webhook route (idempotent, signed) + fake dev checkout"
```

---

### Task 8: Plan limits shape the public offering

**Files:**
- Modify: `src/lib/booking/bookable.ts` (+ `bookable.test.ts` if present, else create `src/lib/booking/bookable.test.ts`), `src/lib/booking/public.ts` (`loadOrgSlotContext`), `src/app/book/[handle]/page.tsx`, `src/app/book/[handle]/[staffSlug]/page.tsx`, `src/app/embed/[handle]/page.tsx`, `src/features/scheduling/public-actions.ts`
- Create: `src/lib/booking/public-offering.ts`

**Interfaces:**
- Consumes: `getEntitlementsAdmin`, `Entitlements`, `filterBookableServices`, `listPublicServices`, `listPublicStaff`, `listServiceStaffMap`, `BILLING_ENABLED`.
- Produces:
  ```ts
  // bookable.ts (pure)
  limitPublicOffering<S extends {id:string}, T extends {id:string}>(services: S[], staff: T[], serviceStaffIds, ent: Entitlements): { services: S[]; staff: T[] }
  // public-offering.ts (server-only)
  loadPublicOffering(orgId): Promise<{ services: PublicService[]; staff: PublicStaff[]; serviceStaffIds: Record<string,string[]>; entitlements: Entitlements }>
  // public.ts
  loadOrgSlotContext(orgId, serviceId, fromDate, days, { staffId, excludeBookingId?, allowedStaffIds? })
  ```

- [ ] **Step 1: Failing unit test for `limitPublicOffering`**

Append to (or create) `src/lib/booking/bookable.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { limitPublicOffering } from "./bookable";
import { entitlementsFor } from "@/lib/billing/entitlements";

const now = new Date("2026-08-18T00:00:00Z");
const staff = [{ id: "a" }, { id: "b" }, { id: "c" }];            // already ordered by sort_order
const services = [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }];
const map = { s1: ["a", "b"], s2: ["b"], s3: ["a"], s4: ["c"] };

describe("limitPublicOffering", () => {
  it("free: primary staff only, then services that person offers, capped at 3", () => {
    const r = limitPublicOffering(services, staff, map, entitlementsFor(null, now));
    expect(r.staff.map((s) => s.id)).toEqual(["a"]);
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s3"]); // s2 (b only), s4 (c only) drop; ≤3 anyway
  });
  it("free with 4 services all offered by the primary → first 3", () => {
    const r = limitPublicOffering(services, staff, { s1: ["a"], s2: ["a"], s3: ["a"], s4: ["a"] }, entitlementsFor(null, now));
    expect(r.services.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
  it("team: everyone, everything", () => {
    const team = entitlementsFor({ plan: "team", status: "active", interval: "month", seats: 5, currentPeriodEnd: null, cancelAtPeriodEnd: false }, now);
    const r = limitPublicOffering(services, staff, map, team);
    expect(r.staff).toHaveLength(3);
    expect(r.services).toHaveLength(4);
  });
  it("team with 2 seats and 3 staff → first 2 by order", () => {
    const team = entitlementsFor({ plan: "team", status: "active", interval: "month", seats: 2, currentPeriodEnd: null, cancelAtPeriodEnd: false }, now);
    expect(limitPublicOffering(services, staff, map, team).staff.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement in `bookable.ts`**

```ts
import type { Entitlements } from "@/lib/billing/entitlements";

// Plan limits shape the PUBLIC offering, never the data (spec §4.2): the
// first `bookableStaff` active people by sort order stay bookable, services
// narrow to what those people offer, then cap at `publicServices`. Order in
// = order out — callers pass lists already sorted by sort_order.
export function limitPublicOffering<S extends { id: string }, T extends { id: string }>(
  services: S[],
  staff: T[],
  serviceStaffIds: Record<string, string[]>,
  ent: Entitlements,
): { services: S[]; staff: T[] } {
  const bookableStaff = staff.slice(0, ent.bookableStaff);
  const offered = filterBookableServices(services, serviceStaffIds, bookableStaff);
  const capped = ent.publicServices === null ? offered : offered.slice(0, ent.publicServices);
  return { services: capped, staff: bookableStaff };
}
```
Run → PASS.

- [ ] **Step 3: `public-offering.ts`**

```ts
import "server-only";
import { listPublicServices, listPublicStaff, listServiceStaffMap, type PublicService, type PublicStaff } from "./public";
import { filterBookableServices, limitPublicOffering } from "./bookable";
import { getEntitlementsAdmin } from "@/lib/billing/queries";
import { entitlementsFor, type Entitlements } from "@/lib/billing/entitlements";
import { BILLING_ENABLED } from "@/lib/flags";

// The one loader every public entry point uses (/book/[handle], its staff
// pages, /embed, and the public server actions): the org's active roster and
// services, narrowed to what the org's plan may offer. While billing is off
// this is exactly today's behaviour (Team-shaped entitlements = no narrowing).
export type PublicOffering = {
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds: Record<string, string[]>;
  entitlements: Entitlements;
};

const UNLIMITED: Entitlements = { ...entitlementsFor(null, new Date()), plan: "team", bookableStaff: Number.MAX_SAFE_INTEGER, publicServices: null, hideBadge: true };

export async function loadPublicOffering(orgId: string): Promise<PublicOffering> {
  const [allServices, allStaff, serviceStaffIds, entitlements] = await Promise.all([
    listPublicServices(orgId),
    listPublicStaff(orgId),
    listServiceStaffMap(orgId),
    BILLING_ENABLED ? getEntitlementsAdmin(orgId) : Promise.resolve(UNLIMITED),
  ]);
  const limited = limitPublicOffering(allServices, allStaff, serviceStaffIds, entitlements);
  return { services: filterBookableServices(limited.services, serviceStaffIds, limited.staff), staff: limited.staff, serviceStaffIds, entitlements };
}
```
(`UNLIMITED` keeps `hideBadge: true` so the flag-off world respects the org's existing embed toggle exactly as today.)

- [ ] **Step 4: `loadOrgSlotContext` accepts `allowedStaffIds`**

In `src/lib/booking/public.ts` change the `opts` type to `{ staffId: string | "any"; excludeBookingId?: string; allowedStaffIds?: string[] }` and after `const eligible = await listPublicStaff(orgId, serviceId);` add:
```ts
  // Public callers pass the plan-limited roster; the admin reschedule dialog
  // and the tokenized manage page pass nothing (spec §7.4: admins may move a
  // booking to anyone active; a client keeps the person they booked).
  const allowed = opts.allowedStaffIds ? eligible.filter((s) => opts.allowedStaffIds!.includes(s.id)) : eligible;
  const targets = opts.staffId === "any" ? allowed : allowed.filter((s) => s.id === opts.staffId);
```
(replace the existing `const targets = …` line).

- [ ] **Step 5: Wire the pages**

`src/app/book/[handle]/page.tsx` — replace the `Promise.all` + `filterBookableServices` block with:
```ts
  const [offering, offerings, branding] = await Promise.all([
    loadPublicOffering(org.orgId),
    RENTALS_ENABLED ? listPublicOfferings(org.orgId) : Promise.resolve([]),
    getOrgBranding(org.orgId),
  ]);
  const { services, staff, serviceStaffIds, entitlements } = offering;
  if (services.length === 0 && offerings.length === 0) notFound();
```
imports: drop `listPublicServices, listPublicStaff, listServiceStaffMap, filterBookableServices`; add `import { loadPublicOffering } from "@/lib/booking/public-offering";`. Keep the JSX props identical (`services`, `staff`, `serviceStaffIds`). (`entitlements` is used by the badge in Task 10 — leave it destructured; ESLint unused-var will pass once Task 10 lands in the same PR; if the executor's lint step complains now, prefix with `void entitlements;` and remove it in Task 10.)

`src/app/book/[handle]/[staffSlug]/page.tsx` — after resolving `person`, load `const offering = await loadPublicOffering(org.orgId);` and add: `if (!offering.staff.some((s) => s.id === person.id)) notFound();` (a person the plan doesn't offer publicly 404s like a deactivated one). Then `const services = filterBookableServices(offering.services, offering.serviceStaffIds, [person], person.id);` (replace the previous services load; `getOrgBranding` stays).

`src/app/embed/[handle]/page.tsx` — same swap as `/book`; the pinned-staff branch becomes: `const pinnedStaff = staffSlug ? staff.find((s) => s.slug === staffSlug) ?? null : null;` (a pinned person outside the plan's roster degrades to the org flow — the embed never breaks). Remove the `getPublicStaffBySlug` import if unused.

- [ ] **Step 6: Wire `public-actions.ts`**

In `loadSlotContext`:
```ts
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const offering = await loadPublicOffering(org.orgId);
  const bookableIds = offering.staff.map((s) => s.id);
  const ctx = await loadOrgSlotContext(org.orgId, serviceId, fromDate, days, { staffId, allowedStaffIds: bookableIds });
  if (!ctx) return null;
  return { org, service: ctx.service, perStaff: ctx.perStaff, bookableIds };
```
In `createBooking`, the RPC call's staff arg becomes:
```ts
      // "Anyone" may only reach the DB's auto-assign when more than one
      // person is publicly bookable; otherwise name the single bookable person
      // so a downgraded org's hidden staff never receive public bookings.
      p_staff_id: staffId === "any" ? (ctx.bookableIds.length > 1 ? null : ctx.bookableIds[0]) : staffId,
```
Add `import { loadPublicOffering } from "@/lib/booking/public-offering";`.

- [ ] **Step 7: Verify + commit**

`npm run verify` → PASS; run the existing public/booking integration files (`booking-flow`, `staff-booking-rpc`, `s3-rpc`) → PASS (flag is off, so behaviour is unchanged).
```bash
git add -A && git commit -m "feat(billing): plan limits shape the public offering (loader, slot context, pages, actions)"
```

---

### Task 9: Creation gates (staff, services)

**Files:**
- Modify: `src/features/scheduling/schema.ts` (error copy), `src/features/scheduling/staff-actions.ts` (`createStaff`, `setStaffActive`), `src/features/scheduling/actions.ts` (`createService`)
- Create: `src/lib/billing/gates.ts`, `src/lib/billing/gates.test.ts`

**Interfaces:**
- Consumes: `getEntitlements(orgId, client)`, `canAddStaff`, `canAddService`, `BILLING_ENABLED`.
- Produces: `PLAN_LIMIT_STAFF_ERROR`, `PLAN_LIMIT_SERVICES_ERROR` (schema.ts); `assertCanAddStaff(orgId, client): Promise<string | null>`, `assertCanAddService(orgId, client): Promise<string | null>` (null = allowed, string = user-facing refusal).

- [ ] **Step 1: Copy + gate helpers**

Add to `src/features/scheduling/schema.ts` (next to `LAST_ACTIVE_STAFF_ERROR`):
```ts
export const PLAN_LIMIT_STAFF_ERROR = "Team members are on the Team plan. Upgrade in Billing to add people.";
export const PLAN_LIMIT_SERVICES_ERROR = "Free includes 3 services. Upgrade in Billing for unlimited.";
```
`src/lib/billing/gates.ts`:
```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BILLING_ENABLED } from "@/lib/flags";
import { getEntitlements } from "./queries";
import { canAddService, canAddStaff, type Entitlements } from "./entitlements";
import { PLAN_LIMIT_SERVICES_ERROR, PLAN_LIMIT_STAFF_ERROR } from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.
export function staffGateMessage(activeCount: number, ent: Entitlements): string | null {
  return canAddStaff(activeCount, ent) ? null : PLAN_LIMIT_STAFF_ERROR;
}
export function serviceGateMessage(serviceCount: number, ent: Entitlements): string | null {
  return canAddService(serviceCount, ent) ? null : PLAN_LIMIT_SERVICES_ERROR;
}

export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  const [ent, { count, error }] = await Promise.all([
    getEntitlements(orgId, client),
    client.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
  ]);
  if (error) throw error;
  return staffGateMessage(count ?? 0, ent);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!BILLING_ENABLED) return null;
  const [ent, { count, error }] = await Promise.all([
    getEntitlements(orgId, client),
    client.from("services").select("id", { count: "exact", head: true }).eq("org_id", orgId),
  ]);
  if (error) throw error;
  return serviceGateMessage(count ?? 0, ent);
}
```
Unit test `src/lib/billing/gates.test.ts` for the two pure `*GateMessage` functions (Free at 1 staff → message; Team at 4 → null; Free at 3 services → message; Pro at 50 → null). Note: importing `gates.ts` pulls `server-only` — the unit config aliases it, fine.

- [ ] **Step 2: Wire the actions**

`createStaff` (after `const orgId = …` and `const supabase = await createClient();`):
```ts
  const refused = await assertCanAddStaff(orgId, supabase);
  if (refused) return { ok: false, error: refused };
```
`setStaffActive`: only when `active === true`, same two lines before the update. `createService`: same with `assertCanAddService` before the insert. Imports from `@/lib/billing/gates`.

- [ ] **Step 3: Verify + commit**

`npm run verify` → PASS.
```bash
git add -A && git commit -m "feat(billing): staff/service creation gates with upgrade copy"
```

---

### Task 10: "Powered by Booklo" as a plan perk (page, embed, emails, toggle)

**Files:**
- Modify: `src/app/book/[handle]/page.tsx`, `src/app/book/[handle]/[staffSlug]/page.tsx`, `src/app/embed/[handle]/page.tsx`, `src/features/scheduling/templates.ts` (+ `templates.test.ts`), `src/features/scheduling/public-actions.ts`, `src/features/scheduling/manage-actions.ts`, `src/features/scheduling/booking-actions.ts`, `src/features/scheduling/reminders.ts`, `src/features/orgs/components/widget-appearance.tsx`, `src/app/(dashboard)/embed/page.tsx`
- Create: `src/components/powered-by.tsx`

**Interfaces:**
- Consumes: `badgeVisible`, `emailBadgeVisible`, `getEntitlements`, `parseWidgetTheme`, `env.NEXT_PUBLIC_APP_URL`.
- Produces: `<PoweredBy handle />` component; every client-facing template gains `showBadge?: boolean` (default `false`); `runReminderDrain` deps gain `badgeFor?: (orgId) => Promise<boolean>`; `WidgetAppearance` gains prop `canHideBadge: boolean`.

- [ ] **Step 1: Component**

`src/components/powered-by.tsx`:
```tsx
import { env } from "@/env";

/** The growth loop (spec §5). Shown on Free; Pro/Team may hide it via the
    embed studio toggle. `?ref=badge&org=` makes the loop measurable. */
export function PoweredBy({ handle }: { handle: string }) {
  return (
    <p className="mt-4 text-center text-xs opacity-60">
      <a href={`${env.NEXT_PUBLIC_APP_URL}/?ref=badge&org=${encodeURIComponent(handle)}`} target="_blank" rel="noopener noreferrer">
        Powered by Booklo
      </a>
    </p>
  );
}
```
Pages: in `/book/[handle]` and `/book/[handle]/[staffSlug]` add after `</WidgetTheme>` inside `<main>`: `{badgeVisible(theme.hidePoweredBy, offering.entitlements) ? <PoweredBy handle={handle} /> : null}` (import `badgeVisible` from `@/lib/billing/entitlements`). In `/embed/[handle]` replace the existing `theme.hidePoweredBy ? null : (<p …>)` block with the same expression (the `env` import may become unused — remove it).

- [ ] **Step 2: Templates — failing test**

Append to `src/features/scheduling/templates.test.ts`:
```ts
import { bookingConfirmationEmail, bookingReminderEmail } from "./templates";
describe("email badge", () => {
  const base = { orgName: "O", serviceName: "S", whenLine: "W", manageUrl: "https://x/m", icsUrl: "https://x/i" };
  it("is absent by default and present when showBadge", () => {
    expect(bookingConfirmationEmail(base).html).not.toContain("Powered by Booklo");
    const withBadge = bookingConfirmationEmail({ ...base, showBadge: true });
    expect(withBadge.html).toContain("Powered by Booklo");
    expect(withBadge.text).toContain("Powered by Booklo");
    expect(bookingReminderEmail({ orgName: "O", serviceName: "S", whenLine: "W", showBadge: true }).html).toContain("Powered by Booklo");
  });
});
```
Run → FAIL.

- [ ] **Step 3: Templates — implement**

In `templates.ts` add near the top:
```ts
import { env } from "@/env";
const BADGE_HTML = `\n  <p style="color: #999; font-size: 11px; margin: 12px 0 0;"><a href="${env.NEXT_PUBLIC_APP_URL}/?ref=badge" style="color: #999;">Powered by Booklo</a></p>`;
const BADGE_TEXT = ["", "Powered by Booklo — " + env.NEXT_PUBLIC_APP_URL];
function badge(show: boolean | undefined): { html: string; text: string[] } {
  return show ? { html: BADGE_HTML, text: BADGE_TEXT } : { html: "", text: [] };
}
```
For each of `bookingConfirmationEmail`, `bookingManageLinkEmail`, `bookingCancelledEmail`, `bookingRescheduledEmail`, `bookingReminderEmail`: add `showBadge?: boolean` to the input type; `const b = badge(input.showBadge);` at the top; insert `${b.html}` immediately after the existing footer `<p style="color: #666; …">…</p>` (still inside the wrapping `<div>`); spread `...b.text` as the last entries of the `text` array. Run the test → PASS; run the whole `templates.test.ts` → PASS (existing snapshots/expectations unchanged because default is off).

- [ ] **Step 4: Call sites**

Add `showBadge: await emailBadgeVisible(<orgId>)` to the message inputs at (import from `@/lib/billing/queries`):
- `public-actions.ts` confirmation (`ctx.org.orgId`);
- `manage-actions.ts` cancelled (`row.org_id`) and rescheduled (the corresponding row's `org_id`);
- `booking-actions.ts` cancelled, rescheduled, manage-link, walk-in confirmation (`org.id`);
- `reminders.ts`: extend deps with `badgeFor?: (orgId: string) => Promise<boolean>`; the candidate select adds `org_id`; per row `showBadge: deps.badgeFor ? await deps.badgeFor(row.org_id) : false`; the drain route passes `badgeFor: emailBadgeVisible`. (`CandidateRow` gains `org_id: string`.)
Rentals call sites (parked) are left untouched.

- [ ] **Step 5: Lock the toggle on Free**

`widget-appearance.tsx`: new prop `canHideBadge: boolean` (default `true` for callers that don't pass it, so the flag-off world is unchanged); the checkbox gets `disabled={pending || !canHideBadge}` and, when `!canHideBadge`, a sibling `<Link href="/billing" className="text-primary text-xs">Pro</Link>` after the label. `src/app/(dashboard)/embed/page.tsx` (the studio page that renders `WidgetAppearance`): compute `const ent = BILLING_ENABLED ? await getEntitlements(org.id, await createClient()) : null;` and pass `canHideBadge={ent ? ent.hideBadge : true}`. (Find the exact render site with `grep -n "WidgetAppearance" src/app`.)

- [ ] **Step 6: Verify + commit**

`npm run verify` → PASS; `reminder-drain` integration file → PASS.
```bash
git add -A && git commit -m "feat(billing): Powered by Booklo badge on page/embed/emails, gated by plan; toggle locked on Free"
```

---
### Task 11: Free reminder quota in the drain

**Files:**
- Modify: `src/features/scheduling/reminders.ts`, `src/features/scheduling/reminders.test.ts`, `src/app/api/scheduling/drain/route.ts`, `src/features/scheduling/reminder-drain.integration.test.ts`

**Interfaces:**
- Consumes: `getEntitlementsAdmin`, `monthlyBookingUsage`, `reminderQuotaExceeded`, `BILLING_ENABLED`.
- Produces: `decideReminder(booking, now, opts?: { overQuota?: boolean })` → `"suppress"` when `overQuota`; `runReminderDrain` deps gain `quotaExceeded?: (orgId: string, timeZone: string) => Promise<boolean>`; the drain route passes a real implementation.

- [ ] **Step 1: Failing unit test**

Append to `src/features/scheduling/reminders.test.ts`:
```ts
it("suppresses when the org is over its free reminder quota", () => {
  const now = new Date("2026-08-18T10:00:00Z");
  const booking = { startsAt: new Date("2026-08-19T09:00:00Z"), createdAt: new Date("2026-08-10T00:00:00Z") };
  expect(decideReminder(booking, now)).toBe("send");
  expect(decideReminder(booking, now, { overQuota: true })).toBe("suppress");
});
```
Run → FAIL.

- [ ] **Step 2: Implement**

`decideReminder` signature: `(booking, now, opts: { overQuota?: boolean } = {})`; first line inside: `if (opts.overQuota) return "suppress";` (after the "already started" check is fine too — keep it as the very first line so the stamp semantics match "suppressed, never rescanned").

`runReminderDrain`: deps type gains `quotaExceeded?: (orgId: string, timeZone: string) => Promise<boolean>`; the select adds `org_id`; per row, before `decideReminder`: 
```ts
      let overQuota = false;
      if (deps.quotaExceeded) {
        try { overQuota = await deps.quotaExceeded(row.org_id, row.orgs?.timezone ?? "UTC"); }
        catch (e) { console.error("[scheduling] quota check failed (sending):", e); } // spec §7.10: a missed suppression beats a missed reminder
      }
      const decision = decideReminder({ startsAt: new Date(row.starts_at), createdAt: new Date(row.created_at) }, now, { overQuota });
```
Memoise per tick: `const quotaCache = new Map<string, boolean>();` above the loop and consult/populate it by `row.org_id` around the call.

Drain route: 
```ts
import { BILLING_ENABLED } from "@/lib/flags";
import { getEntitlementsAdmin, monthlyBookingUsage, emailBadgeVisible } from "@/lib/billing/queries";
import { reminderQuotaExceeded } from "@/lib/billing/entitlements";
…
    const admin = createAdminClient();
    const summary = await runReminderDrain({
      db: admin,
      transport: selectTransport(),
      badgeFor: emailBadgeVisible,
      quotaExceeded: BILLING_ENABLED
        ? async (orgId, tz) => reminderQuotaExceeded(await monthlyBookingUsage(orgId, tz, new Date(), admin), await getEntitlementsAdmin(orgId))
        : undefined,
    });
```
Same wiring in `scripts/scheduling-drain.ts` only if it calls `runReminderDrain` directly (check; the script POSTs to the route in the current code, so probably nothing to do).

- [ ] **Step 3: Integration test**

Append to `reminder-drain.integration.test.ts` a case that injects `quotaExceeded: async () => true` for a due booking and asserts `summary.skipped` increments, `reminder_sent_at` is stamped and nothing was sent; and a control run with `quotaExceeded: async () => false` on a fresh due booking that sends. Run → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(billing): free reminder quota — drain suppresses past 30 bookings/month"
```

---

### Task 12: Billing actions, `/billing` page, nav, banner

**Files:**
- Create: `src/features/billing/schema.ts`, `src/features/billing/actions.ts`, `src/features/billing/queries.ts`, `src/features/billing/components/plan-picker.tsx`, `src/features/billing/components/current-plan.tsx`, `src/features/billing/components/usage-meters.tsx`, `src/features/billing/components/plan-banner.tsx`, `src/app/(dashboard)/billing/page.tsx`
- Modify: `src/components/shell/nav.ts`, `src/app/(dashboard)/layout.tsx`, `src/features/scheduling/schema.ts` (nothing new — copy lives in Task 9)

**Interfaces:**
- Consumes: `PLANS`, `PAID_PLANS`, `pricePerMonth`, `getOrgSubscription`, `getEntitlements`, `monthlyBookingUsage`, `selectBillingProvider`, `requireOrg`, `getSchedulingSettings` (`@/features/orgs/queries`, returns `{ timezone }`), `BILLING_ENABLED`, `env.BILLING_FOUNDER_*`.
- Produces: server actions `startCheckout(formData)` and `openPortal()`; `getBillingOverview(): Promise<BillingOverview>`; components; nav item `{ href: "/billing", label: "Billing", icon: CreditCardIcon, section: "configure" }`.

- [ ] **Step 1: Schema + actions**

`src/features/billing/schema.ts`:
```ts
import { z } from "zod";
export const checkoutInput = z.object({ plan: z.enum(["pro", "team"]), interval: z.enum(["month", "year"]) });
export const CHECKOUT_ERROR = "Couldn't open checkout — try again.";
```
`src/features/billing/actions.ts`:
```ts
"use server";
import { redirect } from "next/navigation";
import { env } from "@/env";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { selectBillingProvider } from "@/lib/billing/provider";
import { getOrgSubscription } from "@/lib/billing/queries";
import { BILLING_ENABLED } from "@/lib/flags";
import { checkoutInput, CHECKOUT_ERROR } from "./schema";

async function founderCodeFor(orgId: string): Promise<string | undefined> {
  if (!env.BILLING_FOUNDER_PROMO_CODE || !env.BILLING_FOUNDER_CUTOFF) return undefined;
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("created_at").eq("id", orgId).maybeSingle();
  if (!data?.created_at) return undefined;
  return Date.parse(data.created_at) < Date.parse(`${env.BILLING_FOUNDER_CUTOFF}T00:00:00Z`) ? env.BILLING_FOUNDER_PROMO_CODE : undefined;
}

// Prices are never trusted from the client: the form sends plan+interval,
// the provider maps them to its own price ids.
export async function startCheckout(formData: FormData): Promise<{ ok: false; error: string } | never> {
  if (!BILLING_ENABLED) return { ok: false, error: CHECKOUT_ERROR };
  const parsed = checkoutInput.safeParse({ plan: formData.get("plan"), interval: formData.get("interval") });
  if (!parsed.success) return { ok: false, error: CHECKOUT_ERROR };
  const { user, org } = await requireOrg();
  let url: string;
  try {
    url = await selectBillingProvider().createCheckoutUrl({
      orgId: org.id, plan: parsed.data.plan, interval: parsed.data.interval,
      email: user.email ?? "", discountCode: await founderCodeFor(org.id),
      returnUrl: `${env.NEXT_PUBLIC_APP_URL}/billing?checkout=success`,
    });
  } catch (error) {
    console.error("[billing] startCheckout:", error);
    return { ok: false, error: CHECKOUT_ERROR };
  }
  redirect(url);
}

export async function openPortal(): Promise<{ ok: false; error: string } | never> {
  const { org } = await requireOrg();
  const supabase = await createClient();
  const sub = await getOrgSubscription(org.id, supabase);
  const { data } = await supabase.from("org_subscriptions").select("provider_customer_id").eq("org_id", org.id).maybeSingle();
  if (!sub || !data) return { ok: false, error: "No subscription to manage yet." };
  let url: string;
  try {
    url = await selectBillingProvider().createPortalUrl(data.provider_customer_id, `${env.NEXT_PUBLIC_APP_URL}/billing`);
  } catch (error) {
    console.error("[billing] openPortal:", error);
    return { ok: false, error: CHECKOUT_ERROR };
  }
  redirect(url);
}
```
(`redirect()` throws a Next control-flow error — never wrap it in the try/catch.)

- [ ] **Step 2: Overview query**

`src/features/billing/queries.ts`:
```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireOrg } from "@/lib/auth/session";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { getEntitlements, getOrgSubscription, monthlyBookingUsage } from "@/lib/billing/queries";
import type { Entitlements, OrgSubscriptionRow } from "@/lib/billing/entitlements";
import { env } from "@/env";

export type BillingOverview = {
  orgId: string;
  subscription: OrgSubscriptionRow | null;
  entitlements: Entitlements;
  usage: { bookingsThisMonth: number; activeStaff: number; services: number };
  founderEligible: boolean;
};

export async function getBillingOverview(now = new Date()): Promise<BillingOverview> {
  const { org } = await requireOrg();
  const supabase = await createClient();
  const settings = await getSchedulingSettings();
  const [subscription, entitlements, bookingsThisMonth, staffRes, svcRes, orgRow] = await Promise.all([
    getOrgSubscription(org.id, supabase),
    getEntitlements(org.id, supabase, now),
    monthlyBookingUsage(org.id, settings?.timezone ?? "UTC", now, supabase),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle(),
  ]);
  const founderEligible = Boolean(env.BILLING_FOUNDER_PROMO_CODE && env.BILLING_FOUNDER_CUTOFF && orgRow.data?.created_at
    && Date.parse(orgRow.data.created_at) < Date.parse(`${env.BILLING_FOUNDER_CUTOFF}T00:00:00Z`));
  return {
    orgId: org.id, subscription, entitlements,
    usage: { bookingsThisMonth, activeStaff: staffRes.count ?? 0, services: svcRes.count ?? 0 },
    founderEligible,
  };
}
```
(`monthlyBookingUsage` with the RLS client works: members select their org's bookings.)

- [ ] **Step 3: Components**

`current-plan.tsx` (server component): card with `PLANS[ent.plan].name`, price line (`pricePerMonth` when paid, "Free" otherwise), status line — `past_due` → amber "Payment failed — update your card" ; `cancelAtPeriodEnd`/`cancelled` → "Ends on {date}" ; else "Renews on {date}" when `currentPeriodEnd`; a `<form action={openPortal}><Button variant="secondary">Manage subscription</Button></form>` when a subscription exists.

`usage-meters.tsx`: three rows using `StatTile`-like markup: "Reminders this month" `X / 30` (only when `ent.reminderBookingsPerMonth !== null`), "Bookable team members" `activeStaff / bookableStaff` (with the over-limit note "Only the first N are bookable publicly" when `activeStaff > bookableStaff`), "Services" `services / 3` on Free.

`plan-picker.tsx` (client component, `"use client"`): a month/year segmented control (default `year`), three columns from `PLANS` (Free column says "Current plan" or "Included"), each paid column a `<form action={startCheckout}>` with hidden `plan` + `interval` inputs and a `Button` "Upgrade to {name}"; the current plan's column shows "Current plan" disabled; the Founder ribbon "Founder price · $8/mo for life" on Pro when `founderEligible`; the six feature rows from spec §3 that are shipped (bookable staff, services, reminders, badge, team layer, brand basics) — copy lives in a `PLAN_ROWS` const in this file, derived from `PLANS[...].limits` where possible.

`plan-banner.tsx` (server): props `{ ent, usage }`; renders nothing unless `BILLING_ENABLED` and (a) Free with `bookingsThisMonth >= 24` → "You've used {n} of 30 free reminder bookings this month. <Link href="/billing">Upgrade</Link>" or (b) `usage.activeStaff > ent.bookableStaff` → "Your plan allows {ent.bookableStaff} bookable team member(s); {activeStaff - bookableStaff} aren't bookable publicly. <Link href="/billing">Manage plan</Link>". Muted bordered strip, `role="status"`.

- [ ] **Step 4: Page, nav, layout**

`src/app/(dashboard)/billing/page.tsx`:
```tsx
import { notFound } from "next/navigation";
import { BILLING_ENABLED } from "@/lib/flags";
import { getBillingOverview } from "@/features/billing/queries";
import { CurrentPlan } from "@/features/billing/components/current-plan";
import { UsageMeters } from "@/features/billing/components/usage-meters";
import { PlanPicker } from "@/features/billing/components/plan-picker";
import { PageIntro } from "@/components/shell/page-header";

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  if (!BILLING_ENABLED) notFound();
  const { checkout } = await searchParams;
  const overview = await getBillingOverview();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <PageIntro>Your plan, usage and invoices. Payments are handled by Stripe.</PageIntro>
      {checkout === "success" && overview.entitlements.plan === "free" ? (
        <p role="status" className="text-muted-foreground text-sm">Activating your plan… this takes a few seconds.</p>
      ) : null}
      <CurrentPlan overview={overview} />
      <UsageMeters overview={overview} />
      <PlanPicker currentPlan={overview.entitlements.plan} founderEligible={overview.founderEligible} />
    </div>
  );
}
```
Add a tiny client component `<ActivationPoller active={checkout === "success" && plan === "free"} />` that calls `router.refresh()` every 3 s for 30 s while `active` (spec §7.7).

`nav.ts`: import `CreditCardIcon` from `@hugeicons/core-free-icons`; add `{ href: "/billing", label: "Billing", icon: CreditCardIcon, section: "configure" }` before Settings; export `NAV_ITEMS` filtered: `export const NAV_ITEMS = ALL_NAV_ITEMS.filter((i) => i.href !== "/billing" || BILLING_ENABLED)` (import the flag; keep the `as const` on the source array).

`(dashboard)/layout.tsx`: when `BILLING_ENABLED`, load `getBillingOverview()` and render `<PlanBanner ent={o.entitlements} usage={o.usage} />` as the first child inside `<AppShell>` (before `{children}`).

- [ ] **Step 5: Verify + manual smoke**

`npm run verify` → PASS. Temporarily flip `BILLING_ENABLED = true` locally (do NOT commit), `BILLING_PROVIDER=fake`, run `npm run dev`: `/billing` shows Free + meters; "Upgrade to Team" → dev-checkout → back on `/billing` as Team; Team page can add a 2nd staff; flip back to `false`, confirm `/billing` 404s and nav hides it. Restore the flag.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(billing): /billing page (plan, usage, picker), checkout/portal actions, nav item, plan banner"
```

---

### Task 13: Marketing — pricing page, legal pages, copy

**Files:**
- Modify: `src/features/marketing/site.ts`, `src/features/marketing/site.test.ts`, `src/features/marketing/components/marketing-nav.tsx` (only if nav links need `Link` for a route, see below)
- Create: `src/app/(marketing)/pricing/page.tsx`, `src/app/(marketing)/privacy/page.tsx`, `src/app/(marketing)/terms/page.tsx`, `src/features/marketing/components/pricing-table.tsx`

**Interfaces:**
- Consumes: `PLANS`, `PAID_PLANS`, `pricePerMonth`, `BILLING_ENABLED`, `FORBIDDEN_COPY`.
- Produces: `PRICING` copy block in `site.ts`; routes `/pricing`, `/privacy`, `/terms`.

- [ ] **Step 1: Copy in `site.ts`**

Add:
```ts
export const PRICING = {
  heading: "Simple pricing",
  sub: "Free for solo providers. Pay when you need your brand, unlimited services or a team.",
  note: "Prices in USD. Taxes are handled at checkout.",
  rows: [
    { label: "Publicly bookable team members", free: "1", pro: "1", team: "5" },
    { label: "Services on your booking page", free: "3", pro: "Unlimited", team: "Unlimited" },
    { label: "Reminder emails", free: "First 30 bookings a month", pro: "Every booking", team: "Every booking" },
    { label: "Hosted page + website embed", free: "✓", pro: "✓", team: "✓" },
    { label: "Self-serve cancel & reschedule", free: "✓", pro: "✓", team: "✓" },
    { label: "Your logo, colours, welcome text", free: "✓", pro: "✓", team: "✓" },
    { label: "Remove “Powered by Booklo”", free: "—", pro: "✓", team: "✓" },
    { label: "Team layer: per-person links, “Anyone available”, colours", free: "—", pro: "—", team: "✓" },
  ],
  founder: "Early-access accounts get Pro for $8/month, locked for life — look for the Founder ribbon in Billing.",
} as const;
```
Change `SITE.heroNote` to `"Free plan · No credit card"`, `SITE.links` gains `pricing: "/pricing"`, `NAV_LINKS` gains `{ label: "Pricing", href: "/pricing" }` **only when `BILLING_ENABLED`** (build the array with a conditional spread; import the flag), the FAQ "What does it cost?" answer becomes `"Free for solo providers — one bookable person, three services, reminders for your first 30 bookings each month. Pro and Team add your brand, unlimited services and a team; see Pricing."` (this mentions nothing from `FORBIDDEN_COPY`), and `FOOTER_COLUMNS` Legal links become `/privacy` and `/terms`.

`site.test.ts`: `ROUTE_DIRS` gains `"/pricing": "src/app/(marketing)/pricing"`, `"/privacy": "src/app/(marketing)/privacy"`, `"/terms": "src/app/(marketing)/terms"`; the forbidden-copy corpus adds `PRICING.heading, PRICING.sub, PRICING.note, PRICING.founder, ...PRICING.rows.flatMap((r) => [r.label, r.free, r.pro, r.team])`; the "every nav href is one of the anchors" assertion becomes "is an anchor or an internal route" (`anchors.includes(l.href) || l.href in ROUTE_DIRS`). Note the nav renders anchors with `<a>`; a route href works the same way, no component change needed. Run `npx vitest run src/features/marketing` → PASS after the pages exist (Step 2).

- [ ] **Step 2: Pages**

`pricing-table.tsx` (server): three columns from `PLANS` (name, blurb, `$X /mo` with "billed yearly" small print using `pricePerMonth(id, "year")` and "or $Y monthly"), then a rows table from `PRICING.rows`, then `PRICING.founder` and `PRICING.note`; CTAs `Link` to `/signup` (`marketingButton("primary","md")` for Pro, secondary for others). Uses tokens only, no `dark:` (marketing layout rule).

`src/app/(marketing)/pricing/page.tsx`: `if (!BILLING_ENABLED) notFound();` then `<MarketingNav /><main className="flex-1"><PricingTable /></main><MarketingFooter />`, `export const metadata = { title: "Pricing — Booklo" }`.

`privacy/page.tsx`, `terms/page.tsx`: static, same nav/footer, prose sections. Privacy: what we store (name, email, optional note; provider account email; subscription status — no card data, payments processed by Stripe as merchant of record), retention, contact. Terms: service description, plans/billing (subscription, cancel anytime in Billing, refunds per Stripe's Managed Payments consumer terms), acceptable use, liability, governing law placeholder **replaced by Andrii before flip** — write "Governing law: Poland" now. Wording is a launch-checklist item; the pages must exist and be reachable.

- [ ] **Step 3: Verify + commit**

`npm run verify` → PASS.
```bash
git add -A && git commit -m "feat(marketing): pricing page, privacy + terms, pricing copy guarded by FORBIDDEN_COPY"
```

---

### Task 14: MRR snippet, docs, final verification

**Files:**
- Create: `supabase/snippets/mrr.sql`
- Modify: `docs/superpowers/specs/2026-08-18-pricing-and-billing-design.md` (Implementation notes), this plan (tick boxes / deviations appendix)

- [ ] **Step 1: Snippet**

`supabase/snippets/mrr.sql`:
```sql
-- Founder MRR (run in Supabase Studio as service_role). Mirrors src/lib/billing/plans.ts.
select plan, billing_interval, subscriptions, seats, mrr_usd from public.billing_mrr order by plan, billing_interval;
select sum(mrr_usd) as total_mrr_usd, sum(subscriptions) as paying_orgs from public.billing_mrr;
```

- [ ] **Step 2: Spec implementation notes**

Append to the spec's "Implementation notes": invoice.* events ignored (subscription.updated carries the status); Team seats fixed at 5; the sidebar pill was folded into the `PlanBanner` (no pill); rentals email call sites untouched; any other deviation the executor made.

- [ ] **Step 3: Full verification**

```bash
npm run verify
npm run test:integration
npm run build
graphify update .
```
All PASS. Then open the PR (`gh pr create --base main --head feat/billing`) with the spec link, the flag-off statement, and the launch checklist (§7.12) as the body.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(billing): mrr snippet, spec implementation notes"
```

---

## Self-review (done while writing)

- **Spec coverage:** §3 ladder → T1 `PLANS` + T13 pricing; §4 principles → T8 (public offering), T11 (reminders), T5/T7 (cache + webhook), T1 (flag); §7.1 seam/adapters → T5/T6; §7.2 schema/RLS/view/index → T3; §7.3 entitlements/usage → T2/T4; §7.4 gates → T8/T9/T10/T11/T12 (banner); §7.5 webhook → T7; §7.6 checkout/portal/Founder → T12; §7.7 UI/nav → T12; §7.8 marketing/legal/badge href → T13/T10; §7.9 env/flag → T1; §7.10 error handling → T4 (degrade to Free), T7 (status codes), T11 (send on failure); §7.11 tests → each task; §7.12 checklist → T14 PR body. Deviations recorded in T14 (invoice events, sidebar pill, seats).
- **Type consistency:** `OrgSubscriptionRow` (T2) is what `getOrgSubscription` (T4) returns and `CurrentPlan` (T12) reads; `BillingEvent`/`BillingSubscription` (T5) are produced by `fake.ts`/`stripe.ts` and consumed by `applyBillingEvents`; `Entitlements` flows T2 → T4 → T8/T9/T10/T12; `loadOrgSlotContext` opts extended in T8 and used by `public-actions.ts` in the same task; `showBadge` (T10 templates) matches every call site.
