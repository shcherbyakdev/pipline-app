# H5b Repositioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Booklo's plans from per-seat to per-resource (a bookable person and an active unit of a space share one budget: Free 1 · Pro 3 · Team 10), enforce the cap on the public page without a migration, put Spaces first on every provider-facing order, and finish the "appointment"-flavoured copy audit (emails, nights/days provider notice, date overrides, `FORBIDDEN_COPY`).

**Architecture:** `PlanLimits.bookableStaff` becomes `bookableResources`; one pure counting rule (`countResources`) and one pure allocator (`limitPublicResources`: people first, then units) live in `lib/`. The single gated public loader (`loadPublicOffering`) grows a per-request `loadPublicResources` that yields the allowed unit/space ids (or `null` = no cap, the flag-off path, byte-identical to today). The rental public actions filter the engine's units to that set and — only when the plan hides a unit of that space — name the unit explicitly to the RPC instead of letting SQL auto-pick. Creation gates count people + units through one `evaluateResourceGate`. Everything else is copy and ordering.

**Tech Stack:** Next.js (App Router, server actions), Supabase (PostgREST + definer RPCs, no migration in this slice), Vitest (`*.test.ts` pure, `*.integration.test.ts` against the local stack), Zod, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-08-25-h5b-repositioning-design.md` (commit 73d6551, branch `feat/h5b`). Read it first; the rulings section explains every "why" below.

## Global Constraints

- **Branch `feat/h5b`, worktree `.claude/worktrees/ia-u4`** (the directory name is stale — it hosts `feat/h5b`, off `main` at `e746b8f`). Run everything from that directory. Do not `cd` to the main checkout.
- **No migrations.** H4 keeps `0059`. `org_subscriptions.seats` keeps its column name. `billing_mrr` (0043) is untouched — prices stay `$12` / `$29`.
- **Caps:** Free `1` · Pro `3` · Team `TEAM_INCLUDED_RESOURCES = 10`. Prices unchanged.
- **Counting rule (spec ruling 5):** people count only when `offersAppointments`; units only when `offersRentals` AND the org's `rentals` flag is on (`effectiveMode`). Slots fill **people first**, then units (ruling 4).
- **No cap ⇒ no behaviour change.** With billing off (or a failed billing read) every public path must behave exactly as on `main` today: `allowedUnitIds === null`, RPCs still called with `p_unit_id: null` + one retry.
- **Admin paths are never capped** — `loadOrgRangeContext`, walk-ins, timeline moves, reschedules: untouched.
- **Copy is kind-blind** (ruling 6): no `kind` parameter on email templates.
- **`FORBIDDEN_COPY`** = `["google", "calendar sync", "stripe", "payment", "offering", "rentals"]` — grows, never shrinks.
- **Vocabulary:** "Spaces" / "space" / "unit" / "people" in anything a provider or client reads. Never "rental", "rentals", "offering" (code identifiers `rental_*`, `offersRentals`, `/rentals` do not change). `src/features/orgs/admin-copy.test.ts` guards the admin surfaces.
- **House test pattern:** pure `.test.ts` next to the module, vitest node env, no component tests. Integration tests need the local Supabase stack (`npm run setup` once; `npm run test:integration`).
- **Verify before claiming done:** `npm run verify` (lint + typecheck + unit). Use `npm run typecheck` (runs `next typegen` first), never bare `tsc`.
- **Bash guard:** heredoc writes with template literals/spreads are silently rejected in this worktree — write TS/TSX with the Write/Edit tools and confirm with `git status`.
- Commit after every task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` as the trailer.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `src/lib/billing/plans.ts` | `bookableResources` caps 1/3/10, `TEAM_INCLUDED_RESOURCES`, blurbs |
| `src/lib/billing/entitlements.ts` | `ResourceUsage`, `countResources`, `canAddResource` (replaces `canAddStaff`) |
| `src/features/scheduling/schema.ts` | `planLimitResourceError(max)` (replaces `PLAN_LIMIT_STAFF_ERROR`/`planLimitStaffError`) |
| `src/lib/billing/gates.ts` | `resourceGateMessage`, `evaluateResourceGate`, `assertCanAddStaff`, **new** `assertCanAddUnit` |
| `src/features/rentals/actions.ts` | unit create/reactivate gated |
| `src/lib/booking/bookable.ts` | **new pure** `UnitRef`, `limitPublicResources`, `unitsToTry` |
| `src/lib/booking/public.ts` | **new** `listPublicUnitsForOrg`, `getOrgModeAdmin`; `listPublicStaff` memoised |
| `src/lib/booking/public-offering.ts` | **new** `loadPublicResources`; `PlanLimitedOffering.allowedUnitIds` / `allowedSpaceIds` |
| `src/lib/booking/catalog.ts` | spaces filtered by `allowedSpaceIds` |
| `src/features/rentals/public-actions.ts` | units capped, explicit unit pick, nights/days provider notice |
| `src/features/rentals/hourly-actions.ts` | units capped, explicit unit pick |
| `src/lib/booking/resources.integration.test.ts` | **new** integration test (cap + provider notice) |
| `src/features/scheduling/templates.ts` | three kind-blind sentences |
| `src/features/scheduling/components/date-overrides.tsx` | intro per owner |
| `src/features/billing/resource-usage.ts` | **new pure** `resourceMeter`, `resourceBannerText` |
| `src/features/billing/queries.ts` | `BillingOverview.mode`, `usage.activeUnits` |
| `src/features/billing/components/{usage-meters,plan-banner,plan-picker}.tsx` | resource copy |
| `src/features/marketing/site.ts` | pricing row/sub, FAQ, `ONBOARDING.modes` order, `FORBIDDEN_COPY` |
| `src/features/orgs/vocab.ts` | `pickerBoth`, `pickerBothBlurb` reordered |
| `src/components/shell/nav.ts`, `src/features/orgs/link-rows.ts`, `src/features/scheduling/setup-checklist.ts`, `src/features/booking-page/templates.ts`, `src/features/scheduling/components/new-booking-dialog.tsx`, `src/features/orgs/components/business-settings.tsx` | spaces-first order |

---

### Task 1: `bookableResources` — rename, new caps, counting rule

**Files:**
- Modify: `src/lib/billing/plans.ts`
- Modify: `src/lib/billing/entitlements.ts`
- Modify: `src/features/scheduling/schema.ts:122-135`
- Modify: `src/lib/billing/gates.ts` (minimal — the real restructure is Task 2)
- Modify: `src/lib/booking/bookable.ts:58`, `src/lib/booking/public-offering.ts:39`, `src/lib/billing/fake-emulator.ts:9,97`, `src/lib/billing/overrides.ts:5,40`, `src/lib/billing/stripe.ts:4,85`, `src/features/billing/components/plan-banner.tsx:16,26`, `src/features/billing/components/usage-meters.tsx:11,28,31`, `src/features/billing/components/plan-picker.tsx:28`
- Test: `src/lib/billing/plans.test.ts`, `src/lib/billing/entitlements.test.ts`, `src/lib/billing/gates.test.ts`, `src/lib/billing/fake-emulator.test.ts`, `src/lib/billing/overrides.test.ts`

**Interfaces:**
- Produces: `PlanLimits.bookableResources: number`; `TEAM_INCLUDED_RESOURCES = 10`; `type ResourceUsage = { activeStaff: number; activeUnits: number }`; `countResources(u: ResourceUsage, mode: OrgMode): number`; `canAddResource(count: number, ent: Entitlements): boolean`; `planLimitResourceError(max: number): string`. `canAddStaff`, `PLAN_LIMIT_STAFF_ERROR`, `planLimitStaffError`, `TEAM_INCLUDED_SEATS` are **deleted**.

- [ ] **Step 1: Write the failing tests**

In `src/lib/billing/plans.test.ts` replace the import and the "free limits match the spec" test:

```ts
import {
  PLANS, PAID_PLANS, TEAM_INCLUDED_RESOURCES, pricePerMonth,
  FOUNDER_PRICE_FACTOR, formatUsd, yearlySaving,
} from "./plans";
```

```ts
  it("limits match the H5b spec: resources 1 / 3 / 10, services 3 / ∞ / ∞", () => {
    expect(PLANS.free.limits).toMatchObject({
      bookableResources: 1, publicServices: 3, reminderBookingsPerMonth: 30, hideBadge: false,
    });
    expect(PLANS.pro.limits.bookableResources).toBe(3);
    expect(PLANS.pro.limits.publicServices).toBeNull();
    expect(TEAM_INCLUDED_RESOURCES).toBe(10);
    expect(PLANS.team.limits.bookableResources).toBe(TEAM_INCLUDED_RESOURCES);
  });
  it("blurbs speak of people and units, never seats or team members", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.blurb.toLowerCase()).not.toMatch(/seat|team member/);
    }
    expect(PLANS.free.blurb).toBe("Everything one person — or one room — needs to take bookings.");
  });
```

In `src/lib/billing/entitlements.test.ts` replace the import line and the two affected tests, and add the counting tests:

```ts
import {
  effectivePlan, entitlementsFor, monthWindow, canAddResource, canAddService, countResources,
  badgeShows, badgeVisible, reminderQuotaExceeded, type OrgSubscriptionRow,
} from "./entitlements";
```

```ts
  it("free defaults", () => {
    const e = entitlementsFor(null, now);
    expect(e.plan).toBe("free");
    expect(e.bookableResources).toBe(1);
    expect(e.publicServices).toBe(3);
    expect(e.hideBadge).toBe(false);
  });
  it("team uses seats for bookableResources", () => {
    const e = entitlementsFor(row({ plan: "team", seats: 7 }), now);
    expect(e.plan).toBe("team");
    expect(e.bookableResources).toBe(7);
    expect(e.publicServices).toBeNull();
    expect(e.hideBadge).toBe(true);
  });
```

```ts
describe("countResources (H5b ruling 5)", () => {
  const BOTH = { offersAppointments: true, offersRentals: true };
  const APPTS = { offersAppointments: true, offersRentals: false };
  const SPACES = { offersAppointments: false, offersRentals: true };
  it("people and units share one budget in a both-mode org", () => {
    expect(countResources({ activeStaff: 2, activeUnits: 3 }, BOTH)).toBe(5);
  });
  it("a spaces-only org's backfilled staff row counts for nothing", () => {
    expect(countResources({ activeStaff: 1, activeUnits: 3 }, SPACES)).toBe(3);
  });
  it("an appointments-only org's units count for nothing", () => {
    expect(countResources({ activeStaff: 2, activeUnits: 3 }, APPTS)).toBe(2);
  });
});
```

and in the `gates` describe block replace the `canAddStaff` test:

```ts
  it("canAddResource", () => {
    expect(canAddResource(1, free)).toBe(false);
    expect(canAddResource(0, free)).toBe(true);
    expect(canAddResource(4, team)).toBe(true);
    expect(canAddResource(5, team)).toBe(false);
  });
```

In `src/lib/billing/gates.test.ts` replace the schema import and the two describes that reference the old copy:

```ts
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";
```

```ts
describe("staffGateMessage", () => {
  it("Free at 1 active staff → the one-resource copy", () => {
    expect(staffGateMessage(1, free)).toBe(planLimitResourceError(1));
  });
  it("Team (5 seats) at 4 active staff → null", () => {
    expect(staffGateMessage(4, team5)).toBeNull();
  });
  it("Team (5 seats) at 5 active staff → names the cap", () => {
    const message = staffGateMessage(5, team5);
    expect(message).toBe(planLimitResourceError(5));
    expect(message).toContain("allows 5 bookable resources");
  });
});

describe("planLimitResourceError", () => {
  it("one resource explains the budget; more than one names the cap", () => {
    expect(planLimitResourceError(1)).toBe(
      "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more.",
    );
    expect(planLimitResourceError(5)).toBe(
      "Your plan allows 5 bookable resources — people and units together. Upgrade in Billing to add more.",
    );
  });
});
```

and in `evaluateStaffGate`'s first test replace `.resolves.toBe(PLAN_LIMIT_STAFF_ERROR)` with `.resolves.toBe(planLimitResourceError(1))`.

In `src/lib/billing/fake-emulator.test.ts` and `src/lib/billing/overrides.test.ts` replace every `TEAM_INCLUDED_SEATS` with `TEAM_INCLUDED_RESOURCES` (import lines included).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/billing`
Expected: FAIL — `TEAM_INCLUDED_RESOURCES`, `canAddResource`, `countResources`, `planLimitResourceError` are not exported.

- [ ] **Step 3: Implement**

`src/lib/billing/plans.ts` — replace the `bookableStaff` field, the constant, and the three plan entries:

```ts
export type PlanLimits = {
  /** Bookable things the PUBLIC page may offer (H5b): active people when the
      org offers appointments, plus active units of its spaces when it offers
      spaces — one budget, people first (lib/booking/bookable.ts
      limitPublicResources). Team: = seats (the org_subscriptions column keeps
      its name). */
  bookableResources: number;
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
  /** Which booking-page sections may be published: "basic" = header, booking,
      about, links (a link-in-bio page); "all" = the whole catalogue. Every
      plan is "all" for now — the gate is wired so flipping it is a one-line change. */
  pageSections: "basic" | "all";
};
```

```ts
/** Team's included bookable resources (people + units). Written into
    org_subscriptions.seats by the Stripe mapping, the fake emulator and comp
    overrides; entitlementsFor reads it back for Team. */
export const TEAM_INCLUDED_RESOURCES = 10;

const PAID_LIMITS = { hideBadge: true, customReminders: true, gcalSync: true, intakeQuestions: true, pageSections: "all" } as const;

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", name: "Free", blurb: "Everything one person — or one room — needs to take bookings.",
    monthly: 0, yearly: 0,
    limits: { bookableResources: 1, publicServices: 3, reminderBookingsPerMonth: 30,
      hideBadge: false, customReminders: false, gcalSync: false, intakeQuestions: false, pageSections: "all" },
  },
  pro: {
    id: "pro", name: "Pro", blurb: "Your brand, unlimited services, reminders for every booking, up to three bookable people or units.",
    monthly: 12, yearly: 108,
    limits: { bookableResources: 3, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
  team: {
    id: "team", name: "Team", blurb: "Up to ten bookable people and units, auto-assigned.",
    monthly: 29, yearly: 288,
    limits: { bookableResources: TEAM_INCLUDED_RESOURCES, publicServices: null, reminderBookingsPerMonth: null, ...PAID_LIMITS },
  },
};
```

`src/lib/billing/entitlements.ts` — add the mode import, rename the seat override, replace `canAddStaff`:

```ts
import { PLANS, type Interval, type PaidPlanId, type PlanId, type PlanLimits } from "./plans";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import type { OrgMode } from "@/features/orgs/mode";
```

```ts
export function entitlementsFor(row: OrgSubscriptionRow | null, now: Date): Entitlements {
  const plan = effectivePlan(row, now);
  const limits = { ...PLANS[plan].limits };
  if (plan === "team" && row) limits.bookableResources = Math.max(1, row.seats);
  return { plan, ...limits };
}
```

```ts
/** What the plan's resource budget counts (H5b). */
export type ResourceUsage = { activeStaff: number; activeUnits: number };

/** The one counting rule (spec ruling 5): a person counts only when the org
    offers appointments, a unit only when it offers spaces. Every org has a
    backfilled staff row (0054), so a spaces-only org must not spend its Free
    slot on it. Callers pass the EFFECTIVE mode (rentals flag applied). */
export function countResources(u: ResourceUsage, mode: OrgMode): number {
  return (mode.offersAppointments ? u.activeStaff : 0) + (mode.offersRentals ? u.activeUnits : 0);
}

export function canAddResource(count: number, ent: Entitlements): boolean {
  return count < ent.bookableResources;
}
```

(Delete `canAddStaff`.)

`src/features/scheduling/schema.ts` — replace `PLAN_LIMIT_STAFF_ERROR` and `planLimitStaffError` with:

```ts
export const PLAN_LIMIT_SERVICES_ERROR = "Free includes 3 services. Upgrade in Billing for unlimited.";
/** The resource refusal, told by the cap the plan allows (H5b): people and
    units share one budget, so the sentence names both. One = Free, where the
    budget itself is the news; more = the org already pays and filled it. */
export function planLimitResourceError(max: number): string {
  return max === 1
    ? "Free includes 1 bookable resource — one person or one unit. Upgrade in Billing to add more."
    : `Your plan allows ${max} bookable resources — people and units together. Upgrade in Billing to add more.`;
}
```

`src/lib/billing/gates.ts` — interim (Task 2 restructures it): change the imports and `staffGateMessage`:

```ts
import { canAddResource, canAddService, type Entitlements } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";
```

```ts
export function staffGateMessage(activeCount: number, ent: Entitlements): string | null {
  return canAddResource(activeCount, ent) ? null : planLimitResourceError(ent.bookableResources);
}
```

Mechanical renames (`bookableStaff` → `bookableResources`, `TEAM_INCLUDED_SEATS` → `TEAM_INCLUDED_RESOURCES`) in: `src/lib/booking/bookable.ts` (`staff.slice(0, ent.bookableResources)`), `src/lib/booking/public-offering.ts` (`bookableResources: Number.MAX_SAFE_INTEGER`), `src/lib/billing/fake-emulator.ts` (import + `seatsFor`), `src/lib/billing/overrides.ts` (import + `seats: TEAM_INCLUDED_RESOURCES`; reword the comment "the Team seat count" → "Team's included resources"), `src/lib/billing/stripe.ts` (import + `seats: mapped.plan === "team" ? TEAM_INCLUDED_RESOURCES : 1`), `src/features/billing/components/plan-banner.tsx` (`ent.bookableResources`, twice), `src/features/billing/components/usage-meters.tsx` (`ent.bookableResources`, three places), `src/features/billing/components/plan-picker.tsx` (`p.limits.bookableResources`). Copy on those three components changes in Task 8 — only the identifiers now.

Run: `git grep -n "bookableStaff\|TEAM_INCLUDED_SEATS\|canAddStaff\|planLimitStaffError\|PLAN_LIMIT_STAFF_ERROR" -- src`
Expected: no output.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/billing src/lib/booking && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(billing): per-resource plans — bookableResources 1/3/10, countResources, canAddResource, planLimitResourceError

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: One resource gate for people and units

**Files:**
- Modify: `src/lib/billing/gates.ts`
- Modify: `src/features/rentals/actions.ts:148-190`
- Test: `src/lib/billing/gates.test.ts`

**Interfaces:**
- Consumes: `countResources`, `canAddResource`, `planLimitResourceError` (Task 1); `effectiveMode` from `@/features/orgs/mode`; `Flags` from `@/lib/flags`.
- Produces: `resourceGateMessage(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): string | null`; `evaluateResourceGate(orgId: string, client: SupabaseClient, flags: { rentals: boolean }): Promise<string | null>`; `assertCanAddStaff(orgId, client)` (unchanged name, new body); `assertCanAddUnit(orgId, client): Promise<string | null>`. `staffGateMessage` and `evaluateStaffGate` are deleted.

- [ ] **Step 1: Write the failing tests**

In `src/lib/billing/gates.test.ts` replace the dynamic import line and the `staffGateMessage` / `evaluateStaffGate` describes with:

```ts
const { resourceGateMessage, serviceGateMessage, evaluateResourceGate, evaluateServiceGate } = await import("./gates");
```

```ts
const BOTH = { offersAppointments: true, offersRentals: true };
const SPACES = { offersAppointments: false, offersRentals: true };

describe("resourceGateMessage", () => {
  it("Free, both-mode, one person → the one-resource copy (no room for a unit)", () => {
    expect(resourceGateMessage({ activeStaff: 1, activeUnits: 0 }, BOTH, free)).toBe(planLimitResourceError(1));
  });
  it("Free, spaces-only, the backfilled person and no unit → allowed", () => {
    expect(resourceGateMessage({ activeStaff: 1, activeUnits: 0 }, SPACES, free)).toBeNull();
  });
  it("Team (5 seats), 2 people + 3 units → the cap copy", () => {
    const message = resourceGateMessage({ activeStaff: 2, activeUnits: 3 }, BOTH, team5);
    expect(message).toBe(planLimitResourceError(5));
    expect(message).toContain("allows 5 bookable resources");
  });
  it("Team (5 seats), 2 people + 2 units → allowed", () => {
    expect(resourceGateMessage({ activeStaff: 2, activeUnits: 2 }, BOTH, team5)).toBeNull();
  });
});
```

```ts
const orgModeRow = (offersAppointments: boolean, offersRentals: boolean) => ({
  offers_appointments: offersAppointments, offers_rentals: offersRentals,
});
const FLAGS_ON = { rentals: true };

describe("evaluateResourceGate", () => {
  it("Free both-mode org at 1 person + 0 units → refusal", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBe(planLimitResourceError(1));
  });
  it("Free spaces-only org at 1 (backfilled) person + 0 units → allowed", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(false, true), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("the rentals kill-switch stops units from counting", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(false, true), error: null },
      staff: { count: 1, error: null },
      rental_units: { count: 9, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, { rentals: false })).resolves.toBeNull();
  });
  it("Team org (5 seats) at 2 people + 2 units → allowed (null)", async () => {
    const client = stubClient({
      org_subscriptions: { data: orgSubRow({ plan: "team", seats: 5 }), error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 2, error: null },
      rental_units: { count: 2, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBeNull();
  });
  it("a failed count lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: null, error: new Error("connection reset") },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
  it("a missing org row refuses conservatively too", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: null },
      orgs: { data: null, error: null },
      staff: { count: 0, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
  it("a failed entitlements lookup refuses conservatively with the generic write error", async () => {
    const client = stubClient({
      org_subscriptions: { data: null, error: new Error("connection reset") },
      orgs: { data: orgModeRow(true, true), error: null },
      staff: { count: 0, error: null },
      rental_units: { count: 0, error: null },
    });
    await expect(evaluateResourceGate("org-1", client, FLAGS_ON)).resolves.toBe(GENERIC_WRITE_ERROR);
  });
});
```

Keep the `serviceGateMessage` / `evaluateServiceGate` describes as they are. The existing `stubClient` already supports `.select().eq().eq().maybeSingle()` and awaiting the builder, so no stub change is needed.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/billing/gates.test.ts`
Expected: FAIL — `resourceGateMessage` / `evaluateResourceGate` undefined.

- [ ] **Step 3: Implement `gates.ts`**

Replace the whole file body below the `import "server-only"` line with:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { FLAG_DEFAULTS, type Flags } from "@/lib/flags";
import { getOrgFlags } from "@/lib/flags/resolve";
import { effectiveMode, type OrgMode } from "@/features/orgs/mode";
import { getEntitlements } from "./queries";
import { canAddResource, canAddService, countResources, type Entitlements, type ResourceUsage } from "./entitlements";
import {
  GENERIC_WRITE_ERROR,
  planLimitResourceError,
  PLAN_LIMIT_SERVICES_ERROR,
} from "@/features/scheduling/schema";

// Creation gates (spec §7.4). Enforced in actions, not triggers — the
// public-offering filter is the value gate; these keep the admin honest.
// Return the refusal copy, or null when allowed.

/** H5b: people and units share one budget (spec ruling 4/5). The cap comes
    from the entitlements, so a Team org at 5 of 5 is told it has 5. */
export function resourceGateMessage(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): string | null {
  return canAddResource(countResources(usage, mode), ent) ? null : planLimitResourceError(ent.bookableResources);
}
export function serviceGateMessage(serviceCount: number, ent: Entitlements): string | null {
  return canAddService(serviceCount, ent) ? null : PLAN_LIMIT_SERVICES_ERROR;
}

// The lookup + evaluation, no flag check. A failed entitlements/count read
// must refuse conservatively (spec §7.10) rather than crash the Server
// Action, so the lookup is wrapped here rather than left to throw — callers
// (assertCanAdd*, and tests) always get back a string|null, never a
// rejection. `flags` is passed in (the callers already resolved it for the
// billing check) so the rentals kill-switch can stop units from counting.
export async function evaluateResourceGate(
  orgId: string,
  client: SupabaseClient,
  flags: Pick<Flags, "rentals">,
): Promise<string | null> {
  try {
    const [ent, orgRow, staffRes, unitRes] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("orgs").select("offers_appointments, offers_rentals").eq("id", orgId).maybeSingle(),
      client.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
      client.from("rental_units").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true),
    ]);
    const failed = orgRow.error ?? staffRes.error ?? unitRes.error;
    if (failed) throw failed;
    if (!orgRow.data) throw new Error("org row missing");
    const mode = effectiveMode(flags, {
      offersAppointments: orgRow.data.offers_appointments,
      offersRentals: orgRow.data.offers_rentals,
    });
    return resourceGateMessage({ activeStaff: staffRes.count ?? 0, activeUnits: unitRes.count ?? 0 }, mode, ent);
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return GENERIC_WRITE_ERROR;
  }
}

export async function evaluateServiceGate(orgId: string, client: SupabaseClient): Promise<string | null> {
  try {
    const [ent, { count, error }] = await Promise.all([
      getEntitlements(orgId, client),
      client.from("services").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    ]);
    if (error) throw error;
    return serviceGateMessage(count ?? 0, ent);
  } catch (error) {
    console.error("[billing] gate lookup failed (refusing):", error);
    return GENERIC_WRITE_ERROR;
  }
}

/* The public entry points. Resolve the org's flags through the same RLS
   client the action holds (org_feature_flags has a member SELECT policy);
   a failed flag read behaves as the environment default rather than block a
   provider from adding a unit because a flag table hiccuped. */
export async function assertCanAddStaff(orgId: string, client: SupabaseClient): Promise<string | null> {
  const flags = await orgFlags(orgId, client);
  if (!flags.billing) return null;
  return evaluateResourceGate(orgId, client, flags);
}

/** H5b: a new or reactivated unit spends the same budget a person does. */
export async function assertCanAddUnit(orgId: string, client: SupabaseClient): Promise<string | null> {
  const flags = await orgFlags(orgId, client);
  if (!flags.billing) return null;
  return evaluateResourceGate(orgId, client, flags);
}

export async function assertCanAddService(orgId: string, client: SupabaseClient): Promise<string | null> {
  if (!(await orgFlags(orgId, client)).billing) return null;
  return evaluateServiceGate(orgId, client);
}

async function orgFlags(orgId: string, client: SupabaseClient): Promise<Flags> {
  try {
    return await getOrgFlags(orgId, client);
  } catch (error) {
    console.error("[billing] flag read failed in gate (using defaults):", error);
    return { ...FLAG_DEFAULTS };
  }
}
```

(`Flags` is already exported from `@/lib/flags` — `export type Flags = Record<FlagKey, boolean>` — and `getOrgFlags(orgId, client)` from `@/lib/flags/resolve`; no change there.)

- [ ] **Step 4: Gate unit create and reactivate**

`src/features/rentals/actions.ts` — add the import and the two gates:

```ts
import { assertCanAddUnit } from "@/lib/billing/gates";
```

```ts
export async function createUnit(input: unknown): Promise<ActionState> {
  const parsed = unitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // H5b: a unit spends the plan's resource budget like a person does.
  if (parsed.data.active) {
    const refused = await assertCanAddUnit(orgId, supabase);
    if (refused) return { ok: false, error: refused };
  }
  const { error } = await supabase.from("rental_units").insert({
    org_id: orgId,
    offering_id: parsed.data.offeringId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    active: parsed.data.active,
  });
  // The org-guard trigger rejects a foreign offering (offering's org != orgId).
  if (error) return fail("createUnit", error);
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}

export async function updateUnit(input: unknown): Promise<ActionState> {
  const parsed = updateUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // H5b: only a false → true flip spends a resource; editing an already
  // active unit's name at the cap must keep working. Mirrors setStaffActive.
  if (parsed.data.active) {
    const { data: current, error: readError } = await supabase
      .from("rental_units")
      .select("active")
      .eq("id", parsed.data.id)
      .eq("org_id", orgId)
      .maybeSingle();
    if (readError) return fail("updateUnit", readError);
    if (!current) return { ok: false, error: GENERIC_WRITE_ERROR };
    if (!current.active) {
      const refused = await assertCanAddUnit(orgId, supabase);
      if (refused) return { ok: false, error: refused };
    }
  }
  const { data, error } = await supabase
    .from("rental_units")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      active: parsed.data.active,
    })
    .eq("id", parsed.data.id)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateUnit", error);
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidatePath("/rentals");
  revalidatePath(`/rentals/${parsed.data.offeringId}`);
  return { ok: true };
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/lib/billing && npm run typecheck`
Expected: PASS; typecheck clean (`staff-actions.ts` still calls `assertCanAddStaff`, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/lib/billing/gates.ts src/lib/billing/gates.test.ts src/features/rentals/actions.ts
git commit -m "feat(billing): one resource gate for people and units — evaluateResourceGate, assertCanAddUnit on create/reactivate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure allocator — `limitPublicResources`, `unitsToTry`

**Files:**
- Modify: `src/lib/booking/bookable.ts`
- Test: `src/lib/booking/bookable.test.ts`

**Interfaces:**
- Consumes: `Entitlements.bookableResources` (Task 1), `OrgMode`.
- Produces:
  ```ts
  export type UnitRef = { id: string; offeringId: string };
  export function limitPublicResources<T extends { id: string }>(
    staff: T[], units: UnitRef[], mode: OrgMode, ent: Entitlements,
  ): { staff: T[]; units: UnitRef[] };
  export function unitsToTry(freeUnitIds: readonly string[], allowedUnitIds: ReadonlySet<string>): string[];
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/booking/bookable.test.ts` (extend the import line with `limitPublicResources, unitsToTry`):

```ts
describe("limitPublicResources (H5b: one budget, people first, then units)", () => {
  const BOTH = { offersAppointments: true, offersRentals: true };
  const APPTS = { offersAppointments: true, offersRentals: false };
  const SPACES = { offersAppointments: false, offersRentals: true };
  const people = [{ id: "a" }, { id: "b" }];
  const units = [
    { id: "u1", offeringId: "o1" },
    { id: "u2", offeringId: "o1" },
    { id: "u3", offeringId: "o2" },
  ];
  const free = entitlementsFor(null, now);
  const pro = entitlementsFor(
    { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    now,
  );
  const unlimited = { ...free, bookableResources: Number.MAX_SAFE_INTEGER };

  it("people fill the slots first, then units in the order given", () => {
    const r = limitPublicResources(people, units, BOTH, pro); // cap 3
    expect(r.staff.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.units.map((u) => u.id)).toEqual(["u1"]);
  });
  it("both-mode on Free: the person takes the one slot and every unit is hidden", () => {
    const r = limitPublicResources(people, units, BOTH, free);
    expect(r.staff.map((s) => s.id)).toEqual(["a"]);
    expect(r.units).toEqual([]);
  });
  it("spaces-only: the backfilled staff row neither shows nor spends a slot", () => {
    const r = limitPublicResources(people, units, SPACES, free);
    expect(r.staff).toEqual([]);
    expect(r.units.map((u) => u.id)).toEqual(["u1"]);
  });
  it("appointments-only: units neither show nor spend a slot", () => {
    const r = limitPublicResources(people, units, APPTS, pro);
    expect(r.staff.map((s) => s.id)).toEqual(["a", "b"]);
    expect(r.units).toEqual([]);
  });
  it("an uncapped plan keeps everything, identity preserved", () => {
    const r = limitPublicResources(people, units, BOTH, unlimited);
    expect(r.staff).toHaveLength(2);
    expect(r.units).toHaveLength(3);
    expect(r.staff[0]).toBe(people[0]);
  });
  it("unitsToTry keeps the engine's order and drops hidden ids", () => {
    expect(unitsToTry(["u3", "u1", "u2"], new Set(["u1", "u2"]))).toEqual(["u1", "u2"]);
    expect(unitsToTry(["u3"], new Set(["u1"]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/booking/bookable.test.ts`
Expected: FAIL — `limitPublicResources` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/booking/bookable.ts` (after the `Entitlements` import add `import type { OrgMode } from "@/features/orgs/mode";`), placed right before `limitPublicOffering`:

```ts
/** A unit and the space that owns it — all the allocator needs to know. */
export type UnitRef = { id: string; offeringId: string };

// H5b: which people and units the plan lets the public page book. One
// budget (`bookableResources`) filled PEOPLE FIRST in `staff` order, then
// units in `units` order — the order listPublicUnitsForOrg returns (offering
// sort_order → name, unit sort_order → created_at), which is also the order
// the RPCs auto-pick in, so "the first N" means one thing everywhere.
// People first because a both-mode org on Pro with one person and three
// units should lose its fourth unit, never a whole channel (spec ruling 4).
// A channel the org does not sell contributes nothing and consumes nothing:
// every org has a backfilled staff row, and a spaces-only org must not spend
// its Free slot on it (ruling 5). Callers pass the EFFECTIVE mode.
export function limitPublicResources<T extends { id: string }>(
  staff: T[],
  units: UnitRef[],
  mode: OrgMode,
  ent: Entitlements,
): { staff: T[]; units: UnitRef[] } {
  const keptStaff = mode.offersAppointments ? staff.slice(0, ent.bookableResources) : [];
  const left = Math.max(0, ent.bookableResources - keptStaff.length);
  const keptUnits = mode.offersRentals ? units.slice(0, left) : [];
  return { staff: keptStaff, units: keptUnits };
}

/** The units a capped public create may name to the RPC, in the engine's
    order: the free ones the plan allows. Empty = nothing to try. */
export function unitsToTry(freeUnitIds: readonly string[], allowedUnitIds: ReadonlySet<string>): string[] {
  return freeUnitIds.filter((id) => allowedUnitIds.has(id));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/booking/bookable.test.ts`
Expected: PASS (the existing `limitPublicOffering` tests still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/bookable.ts src/lib/booking/bookable.test.ts
git commit -m "feat(booking): limitPublicResources — people first, then units, per effective mode; unitsToTry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Loader + catalogue — `loadPublicResources`, `allowedUnitIds`

**Files:**
- Modify: `src/lib/booking/public.ts` (add `listPublicUnitsForOrg`, `getOrgModeAdmin`; wrap `listPublicStaff` in `cache`)
- Modify: `src/lib/booking/public-offering.ts`
- Modify: `src/lib/booking/catalog.ts`

**Interfaces:**
- Consumes: `limitPublicResources`, `UnitRef` (Task 3); `effectiveMode`, `OrgMode`; `getOrgFlagsAdmin`; `getEntitlementsAdminStrict`.
- Produces:
  ```ts
  // public.ts
  export async function listPublicUnitsForOrg(orgId: string): Promise<UnitRef[]>;
  export const getOrgModeAdmin: (orgId: string) => Promise<OrgMode | null>;   // cache()d
  // public-offering.ts
  export type PublicResources = {
    staff: PublicStaff[];
    allowedUnitIds: ReadonlySet<string>;
    allowedSpaceIds: ReadonlySet<string>;
    entitlements: Entitlements;
  };
  export const loadPublicResources: (orgId: string) => Promise<PublicResources | null>; // null = no cap
  export type PlanLimitedOffering = { services; staff; serviceStaffIds; entitlements;
    allowedUnitIds: ReadonlySet<string> | null; allowedSpaceIds: ReadonlySet<string> | null };
  ```

- [ ] **Step 1: `public.ts` — the two reads**

Add `import type { OrgMode } from "@/features/orgs/mode";` and `import type { UnitRef } from "./bookable";` to the imports. Wrap `listPublicStaff` so a request that needs the roster twice (the offering loader and the resource loader below) reads it once:

```ts
// Per-request memoised (H5b): loadPublicOffering and loadPublicResources
// both want the roster inside one request.
export const listPublicStaff = cache(async (orgId: string): Promise<PublicStaff[]> => {
  /* existing body, unchanged */
});
```

(Convert the existing `export async function listPublicStaff(orgId: string): Promise<PublicStaff[]> { ... }` into the `cache(async ...)` form above; the body does not change.)

Append after `listPublicUnits`:

```ts
// H5b: every active unit of an active offering, in the order the plan cap
// counts them (offering sort_order → name, then unit sort_order → created_at)
// — the same order listPublicOfferings lists spaces and the RPCs auto-pick
// units in, so "the first N resources" means one thing everywhere.
export async function listPublicUnitsForOrg(orgId: string): Promise<UnitRef[]> {
  const admin = createAdminClient();
  const { data: offerings, error } = await admin
    .from("rental_offerings")
    .select("id")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  if (!offerings || offerings.length === 0) return [];
  const { data: units, error: unitsError } = await admin
    .from("rental_units")
    .select("id, offering_id")
    .eq("org_id", orgId)
    .eq("active", true)
    .in(
      "offering_id",
      offerings.map((o) => o.id),
    )
    .order("sort_order")
    .order("created_at");
  if (unitsError) throw unitsError;
  const rank = new Map(offerings.map((o, i) => [o.id as string, i]));
  // Stable sort: units keep their own order inside each space.
  return (units ?? [])
    .map((u) => ({ id: u.id as string, offeringId: u.offering_id as string }))
    .sort((a, b) => rank.get(a.offeringId)! - rank.get(b.offeringId)!);
}

// H5b: the org's declared channels by id, for callers that hold only an
// orgId (loadPublicOffering). Per-request memoised like getBookingOrg.
export const getOrgModeAdmin = cache(async (orgId: string): Promise<OrgMode | null> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("offers_appointments, offers_rentals")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return data ? { offersAppointments: data.offers_appointments, offersRentals: data.offers_rentals } : null;
});
```

- [ ] **Step 2: `public-offering.ts` — the resource loader**

Replace the file body below the `import "server-only";` line with:

```ts
import { cache } from "react";
import {
  getOrgModeAdmin,
  listPublicServices,
  listPublicStaff,
  listPublicUnitsForOrg,
  listServiceStaffMap,
  type PublicService,
  type PublicStaff,
} from "./public";
import { limitPublicOffering, limitPublicResources } from "./bookable";
import { getEntitlementsAdminStrict } from "@/lib/billing/queries";
import { type Entitlements } from "@/lib/billing/entitlements";
import { PLANS } from "@/lib/billing/plans";
import { getOrgFlagsAdmin } from "@/lib/flags/resolve";
import { effectiveMode } from "@/features/orgs/mode";

// The one loader every public entry point uses (/book/[handle], its staff
// pages, /embed, and the public server actions): the org's active roster and
// services, narrowed to what the org's plan may offer. While billing is off
// this is exactly today's behaviour (Team-shaped entitlements = no narrowing).
//
// Named for what it IS — an appointments roster after the plan limits — so it
// never reads as a twin of `PublicOffering` in ./public, which is the rentals
// product (a rentable thing with units and a date window).
export type PlanLimitedOffering = {
  services: PublicService[];
  staff: PublicStaff[];
  serviceStaffIds: Record<string, string[]>;
  entitlements: Entitlements;
  /** H5b: the units (and the spaces owning them) the plan lets the public
      page book; null = no cap — billing off or the fail-open path, exactly
      today's behaviour. The rental actions filter the engine's units to this
      set; listPublicCatalog lists a space only if it owns an allowed unit. */
  allowedUnitIds: ReadonlySet<string> | null;
  allowedSpaceIds: ReadonlySet<string> | null;
};

// Team's own limits with the resource cap lifted: every paid feature on, no
// service cap, no reminder quota. Used while billing is off, and as the
// fail-open answer below — so both paths agree on every field, including the
// flags no one reads yet.
const UNLIMITED: Entitlements = {
  ...PLANS.team.limits,
  plan: "team",
  bookableResources: Number.MAX_SAFE_INTEGER,
};

// null = no cap applies (billing off, or the read failed and the offering
// fails open — see loadPublicResources).
async function loadEntitlements(orgId: string): Promise<Entitlements | null> {
  if (!(await getOrgFlagsAdmin(orgId)).billing) return null;
  try {
    return await getEntitlementsAdminStrict(orgId);
  } catch (error) {
    // Spec §7.10, amended: a failed billing read degrades to Free everywhere
    // EXCEPT here. Free limits would hide a paying org's staff and services
    // from its own booking page — an outage must never shrink what a customer
    // sells, so the offering fails open and the badge/quota paths (which
    // degrade to Free) carry the cost instead.
    console.error("[billing] entitlements read failed — offering fails open:", error);
    return null;
  }
}

export type PublicResources = {
  staff: PublicStaff[];
  allowedUnitIds: ReadonlySet<string>;
  allowedSpaceIds: ReadonlySet<string>;
  entitlements: Entitlements;
};

// H5b: the plan's people/unit budget applied (spec §2.2). null = no cap.
// Per-request memoised; the rental actions call it directly (zero extra
// reads while billing is off — the flag read is memoised too), the offering
// loader below folds it in. Fails OPEN like loadEntitlements: a failed mode
// or unit read must not hide a paying org's rooms.
export const loadPublicResources = cache(async (orgId: string): Promise<PublicResources | null> => {
  const ent = await loadEntitlements(orgId);
  if (!ent) return null;
  try {
    const [staff, mode, units, flags] = await Promise.all([
      listPublicStaff(orgId),
      getOrgModeAdmin(orgId),
      listPublicUnitsForOrg(orgId),
      getOrgFlagsAdmin(orgId),
    ]);
    if (!mode) throw new Error("org row missing");
    const kept = limitPublicResources(staff, units, effectiveMode(flags, mode), ent);
    return {
      staff: kept.staff,
      allowedUnitIds: new Set(kept.units.map((u) => u.id)),
      allowedSpaceIds: new Set(kept.units.map((u) => u.offeringId)),
      entitlements: ent,
    };
  } catch (error) {
    console.error("[billing] resource read failed — offering fails open:", error);
    return null;
  }
});

// Per-request memoised: the pages render it once, but getSlots/createBooking
// each reach it through loadSlotContext, and a single request must not repeat
// these reads.
export const loadPublicOffering = cache(async (orgId: string): Promise<PlanLimitedOffering> => {
  const [allServices, allStaff, serviceStaffIds, resources] = await Promise.all([
    listPublicServices(orgId),
    listPublicStaff(orgId),
    listServiceStaffMap(orgId),
    loadPublicResources(orgId),
  ]);
  const entitlements = resources?.entitlements ?? UNLIMITED;
  // With a cap, the roster is what limitPublicResources kept (people first);
  // limitPublicOffering's own slice is then a no-op and still drops services
  // nobody bookable offers — the roster narrowing and the active-staff filter
  // are the same pass.
  const limited = limitPublicOffering(allServices, resources?.staff ?? allStaff, serviceStaffIds, entitlements);
  return {
    services: limited.services,
    staff: limited.staff,
    serviceStaffIds,
    entitlements,
    allowedUnitIds: resources?.allowedUnitIds ?? null,
    allowedSpaceIds: resources?.allowedSpaceIds ?? null,
  };
});
```

- [ ] **Step 3: `catalog.ts` — list a space only if it owns an allowed unit**

Replace the body of `listPublicCatalog` with:

```ts
export async function listPublicCatalog(org: BookingOrg): Promise<{
  offering: Awaited<ReturnType<typeof loadPublicOffering>>;
  offerings: PublicOffering[];
}> {
  const [offering, allOfferings] = await Promise.all([
    loadPublicOffering(org.orgId),
    org.offersRentals
      ? getOrgFlagsAdmin(org.orgId).then((f) => (f.rentals ? listPublicOfferings(org.orgId) : []))
      : Promise.resolve([]),
  ]);
  // H5b: a space whose every unit the plan hides is not listed (null = no
  // cap). A ?space= deep link to it degrades to the org flow through the
  // same resolver an inactive space uses.
  const allowed = offering.allowedSpaceIds;
  const offerings = allowed === null ? allOfferings : allOfferings.filter((o) => allowed.has(o.id));
  if (!org.offersAppointments) {
    // A rentals-only page shows no services and no people. Entitlements and
    // the rest of the bundle stay intact for the badge / plan logic.
    return { offering: { ...offering, services: [], staff: [], serviceStaffIds: {} }, offerings };
  }
  return { offering, offerings };
}
```

- [ ] **Step 4: Typecheck, unit tests, and the existing catalogue integration test**

Run: `npm run typecheck && npx vitest run src/lib && npx vitest run --config vitest.integration.config.ts src/lib/booking/catalog.integration.test.ts`
Expected: typecheck clean; unit PASS; the catalogue integration test PASS (billing off for that org → `allowedSpaceIds === null`, nothing filtered).

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/public.ts src/lib/booking/public-offering.ts src/lib/booking/catalog.ts
git commit -m "feat(booking): loadPublicResources — plan-allowed units/spaces on the gated loader; catalogue lists a space only with an allowed unit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Public rental actions — cap the engine's units, name the unit when capped

**Files:**
- Modify: `src/features/rentals/public-actions.ts`
- Modify: `src/features/rentals/hourly-actions.ts`

**Interfaces:**
- Consumes: `loadPublicResources` (Task 4), `unitsToTry` (Task 3).
- Produces: no new exports. Behavioural contract: with `loadPublicResources === null` the RPC calls are byte-identical to today (`p_unit_id: null`, one retry); with a cap, hidden units never reach the engine, the widget, or the RPC.

- [ ] **Step 1: `public-actions.ts` (nights/days)**

Add imports:

```ts
import { loadPublicResources } from "@/lib/booking/public-offering";
import { unitsToTry } from "@/lib/booking/bookable";
```

Add the cap helper under `loadRangeContext` and apply it there:

```ts
type RangeCtx = NonNullable<Awaited<ReturnType<typeof loadOrgRangeContext>>>;

// H5b: narrow the engine's units to what the plan lets the public page book
// (null = no cap — billing off, byte-identical to before). `capped` says this
// space has at least one hidden unit, which is when a public create must name
// the unit itself rather than let the RPC auto-pick from every active unit.
async function capRangeUnits(orgId: string, ctx: RangeCtx): Promise<RangeCtx & { capped: boolean }> {
  const resources = await loadPublicResources(orgId);
  if (!resources) return { ...ctx, capped: false };
  const allowed = resources.allowedUnitIds;
  const rangeUnits = ctx.rangeUnits.filter((u) => allowed.has(u.id));
  return {
    ...ctx,
    units: ctx.units.filter((u) => allowed.has(u.id)),
    rangeUnits,
    capped: rangeUnits.length < ctx.rangeUnits.length,
  };
}

// Shared by both actions: org + everything the range engine needs.
async function loadRangeContext(handle: string, offeringId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  // Rentals are on by default since H1; the org's `rentals` flag is a kill
  // switch — this is the server-side defence while it's off.
  if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return null;
  // The org-mode gate (offers_rentals) decides what the org sells: a
  // channel it doesn't offer must not disclose availability either.
  if (!org.offersRentals) return null;
  const ctx = await loadOrgRangeContext(org.orgId, offeringId, fromDate, days);
  if (!ctx) return null;
  return { org, ...(await capRangeUnits(org.orgId, ctx)) };
}
```

In `createRentalBooking` replace

```ts
    const ctx = await loadOrgRangeContext(org.orgId, offeringId, startDate, span);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
```

with

```ts
    const raw = await loadOrgRangeContext(org.orgId, offeringId, startDate, span);
    if (!raw) return { ok: false, error: GENERIC_WRITE_ERROR };
    const ctx = await capRangeUnits(org.orgId, raw);
```

and replace the RPC call block (from `const admin = createAdminClient();` through the `if (error) { ... }` that follows) with:

```ts
    const admin = createAdminClient();
    const call = (pUnitId: string | null) =>
      admin.rpc("create_rental_booking", {
        p_handle: handle,
        p_offering_id: offeringId,
        p_unit_id: pUnitId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_name: name,
        p_email: email,
        p_note: note ?? null,
        p_token_hash: tokenHash,
      });

    // What to hand the RPC, in order:
    //   a client-picked unit          → that unit, once;
    //   auto-assign, no cap           → null twice: the DB picks the first free
    //                                   active unit, one retry on a lost race
    //                                   ("some other unit may still be free");
    //   auto-assign, plan hides units → H5b: the DB must not pick a hidden
    //                                   unit, so name the engine's allowed free
    //                                   units one after another until one
    //                                   sticks (stay.unitIds is already the
    //                                   allowed set — the engine only saw it).
    const attempts: (string | null)[] =
      unitId !== null ? [unitId] : ctx.capped ? unitsToTry(stay.unitIds, new Set(stay.unitIds)) : [null, null];
    if (attempts.length === 0) return { ok: false, error: DATES_TAKEN, datesTaken: true };
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      if (isTaken(error)) return { ok: false, error: DATES_TAKEN, datesTaken: true };
      console.error("[rentals] createRentalBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
```

(`unitsToTry(stay.unitIds, new Set(stay.unitIds))` is deliberately the identity here — it documents that the list is the allowed set and keeps the helper as the single place a "try list" is built; the hourly action uses it the same way.)

- [ ] **Step 2: `hourly-actions.ts`**

Add the same two imports. In `loadHourlyContext` replace the last two lines with:

```ts
  const ctx = await loadOrgHourlyContext(org.orgId, offeringId, org.timeZone, fromDate, days, opts);
  if (!ctx) return null;
  // H5b: see capRangeUnits in public-actions.ts — hidden units never reach
  // the engine, the unit picker, or the RPC.
  const resources = await loadPublicResources(org.orgId);
  if (!resources) return { org, ...ctx, capped: false };
  const allowed = resources.allowedUnitIds;
  const perUnit = ctx.perUnit.filter((u) => allowed.has(u.unitId));
  return {
    org,
    ...ctx,
    units: ctx.units.filter((u) => allowed.has(u.id)),
    perUnit,
    capped: perUnit.length < ctx.perUnit.length,
  };
```

In `createRentalBookingHours` replace the RPC call block (from `const admin = createAdminClient();` through its `if (error) { ... }`) with:

```ts
    const admin = createAdminClient();
    const call = (pUnitId: string | null) =>
      admin.rpc("create_rental_booking_hours", {
        p_handle: handle,
        p_offering_id: offeringId,
        p_unit_id: pUnitId,
        p_starts_at: starts.toISOString(),
        p_duration_min: durationMin,
        p_name: name,
        p_email: email,
        p_note: note ?? null,
        p_token_hash: tokenHash,
      });

    // Same ladder as createRentalBooking (public-actions.ts): explicit unit
    // once; uncapped auto-assign = null + one retry; capped auto-assign names
    // the allowed free units (match.unitIds — the engine only saw those).
    const attempts: (string | null)[] =
      unitId !== null ? [unitId] : ctx.capped ? unitsToTry(match.unitIds, new Set(match.unitIds)) : [null, null];
    if (attempts.length === 0) return { ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true };
    let result = await call(attempts[0]);
    for (let i = 1; i < attempts.length && result.error && isTaken(result.error); i++) {
      result = await call(attempts[i]);
    }
    const { data: bookingId, error } = result;
    if (error) {
      // Per-email hourly cap (0056).
      if (isRpcSentinel(error, "too_many")) return { ok: false, error: TOO_MANY_FOR_EMAIL };
      if (isTaken(error)) return { ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true };
      console.error("[rentals] createRentalBookingHours:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
```

- [ ] **Step 3: Typecheck and the existing rental integration suites (flag-off path must be byte-identical)**

Run: `npm run typecheck && npx vitest run --config vitest.integration.config.ts src/features/rentals/flow.integration.test.ts src/features/rentals/hourly-flow.integration.test.ts`
Expected: typecheck clean; both suites PASS unchanged (these orgs have no `billing` flag → `loadPublicResources` returns null → `[null, null]`).

- [ ] **Step 4: Commit**

```bash
git add src/features/rentals/public-actions.ts src/features/rentals/hourly-actions.ts
git commit -m "feat(rentals): public actions cap units to the plan and name the unit to the RPC when the plan hides one

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Integration test — a Free spaces-only org never books its hidden unit

**Files:**
- Create: `src/lib/booking/resources.integration.test.ts`

**Interfaces:**
- Consumes: `listPublicCatalog`, `loadPublicOffering`, `getRangeAvailability`, `createRentalBooking`, `DATES_TAKEN`.
- Produces: the file Task 7 appends a provider-notice test to (it mocks the transport already).

- [ ] **Step 1: Write the test**

```ts
/**
 * H5b per-resource cap against the real DB. A Free (no subscription row)
 * spaces-only org with the `billing` flag on gets ONE bookable resource;
 * its backfilled staff row must not spend it, so the first unit is public
 * and the second is hidden: not listed, not offered by the engine, and never
 * auto-assigned by the RPC (the action names the allowed unit explicitly).
 * A second org without the billing flag proves the uncapped path is
 * untouched. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const net = vi.hoisted(() => ({ clientIp: "203.0.113.50" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": net.clientIp }),
}));
// Capture every send (Task 7 asserts the provider notice); nothing leaves.
const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/email/transport", () => ({
  selectTransport: () => ({
    send: async (msg: Record<string, unknown>) => {
      mail.sent.push(msg);
    },
  }),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const publicActions = await import("@/features/rentals/public-actions");
const { listPublicCatalog } = await import("./catalog");
const { getBookingOrg } = await import("./public");
const { loadPublicOffering } = await import("./public-offering");
const { addDaysISO, dateInZone } = await import("@/features/scheduling/slots");
const { DATES_TAKEN } = await import("@/features/rentals/schema");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TZ = "Europe/Berlin";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

async function signedInUser(tag: string): Promise<{ client: SupabaseClient; email: string }> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, email };
}

// A spaces-only org with one nights space and two units; `billing` on or off.
async function seedOrg(tag: string, billing: boolean) {
  const { client: owner, email: ownerEmail } = await signedInUser(tag);
  const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: `${tag}Co` });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const flags = [{ org_id: orgId, flag: "rentals", enabled: true, updated_by: "h5b-test" }];
  if (billing) flags.push({ org_id: orgId, flag: "billing", enabled: true, updated_by: "h5b-test" });
  const { error: eFlag } = await admin.from("org_feature_flags").insert(flags);
  if (eFlag) throw eFlag;
  const handle = `${tag}-${Date.now()}`;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: handle, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;
  const { error: eMode } = await owner.rpc("update_org_modes", {
    p_org_id: orgId, p_offers_appointments: false, p_offers_rentals: true,
  });
  if (eMode) throw eMode;
  const { data: offering, error: e3 } = await owner
    .from("rental_offerings")
    .insert({
      org_id: orgId, name: "Cabin", range_mode: "nights", start_time: "15:00", end_time: "11:00",
      min_stay: 1, max_stay: 14, turnover_days: 0, booking_window_days: 365,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const offeringId = offering!.id as string;
  const { data: units, error: e4 } = await owner
    .from("rental_units")
    .insert([
      { org_id: orgId, offering_id: offeringId, name: "Cabin 1", sort_order: 0 },
      { org_id: orgId, offering_id: offeringId, name: "Cabin 2", sort_order: 1 },
    ])
    .select("id, name");
  if (e4) throw e4;
  const unitA = units!.find((u) => u.name === "Cabin 1")!.id as string;
  const unitB = units!.find((u) => u.name === "Cabin 2")!.id as string;
  return { orgId, handle, offeringId, unitA, unitB, ownerEmail };
}

const startDate = d(30);
const endDate = d(32);

describe("H5b resource cap: Free spaces-only org, two units, billing on", () => {
  let capped: Awaited<ReturnType<typeof seedOrg>>;
  beforeAll(async () => {
    capped = await seedOrg("h5bcap", true);
  });

  it("lists the space, allows exactly the first unit", async () => {
    const org = (await getBookingOrg(capped.handle))!;
    const cat = await listPublicCatalog(org);
    expect(cat.offerings.map((o) => o.name)).toEqual(["Cabin"]);
    const offering = await loadPublicOffering(capped.orgId);
    expect(offering.entitlements.plan).toBe("free");
    expect(offering.entitlements.bookableResources).toBe(1);
    expect([...offering.allowedUnitIds!]).toEqual([capped.unitA]);
    expect([...offering.allowedSpaceIds!]).toEqual([capped.offeringId]);
  });

  it("offers one unit, auto-assigns it, and refuses a second stay instead of taking the hidden unit", async () => {
    net.clientIp = "203.0.113.51";
    const before = await publicActions.getRangeAvailability({
      handle: capped.handle, offeringId: capped.offeringId, fromDate: startDate, days: 5,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.units.map((u) => u.id)).toEqual([capped.unitA]);
    expect(before.availability.dates[startDate].free).toBe(1);

    const first = await publicActions.createRentalBooking({
      handle: capped.handle, offeringId: capped.offeringId, unitId: null,
      startDate, endDate, name: "Cap Client", email: `cap-${Date.now()}@example.com`, note: "h5b",
    });
    expect(first.ok).toBe(true);

    const second = await publicActions.createRentalBooking({
      handle: capped.handle, offeringId: capped.offeringId, unitId: null,
      startDate, endDate, name: "Cap Client 2", email: `cap2-${Date.now()}@example.com`, note: "h5b",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe(DATES_TAKEN);

    const { data: rows } = await admin
      .from("bookings")
      .select("rental_unit_id")
      .eq("org_id", capped.orgId)
      .eq("status", "confirmed");
    expect(rows).toHaveLength(1);
    expect(rows![0].rental_unit_id).toBe(capped.unitA);
  });
});

describe("H5b resource cap: the same org shape without the billing flag is uncapped", () => {
  it("offers both units", async () => {
    net.clientIp = "203.0.113.52";
    const open = await seedOrg("h5bopen", false);
    const offering = await loadPublicOffering(open.orgId);
    expect(offering.allowedUnitIds).toBeNull();
    const avail = await publicActions.getRangeAvailability({
      handle: open.handle, offeringId: open.offeringId, fromDate: startDate, days: 5,
    });
    expect(avail.ok).toBe(true);
    if (!avail.ok) return;
    expect(avail.units).toHaveLength(2);
    expect(avail.availability.dates[startDate].free).toBe(2);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --config vitest.integration.config.ts src/lib/booking/resources.integration.test.ts`
Expected: PASS. If `update_org_modes` refuses (an org must keep one channel), the order above — modes flipped BEFORE the offering exists — is fine; if it rejects because the org has no rental offering yet, move the `update_org_modes` call after the units insert.

- [ ] **Step 3: Commit**

```bash
git add src/lib/booking/resources.integration.test.ts
git commit -m "test(booking): integration — Free spaces-only org books only its allowed unit; uncapped org untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Copy audit — kind-blind emails, nights/days provider notice, date-overrides intro

**Files:**
- Modify: `src/features/scheduling/templates.ts:247,320,330,425,432`
- Modify: `src/features/rentals/public-actions.ts` (confirmation block)
- Modify: `src/features/scheduling/components/date-overrides.tsx:113-115`
- Test: `src/features/scheduling/templates.test.ts`, `src/lib/booking/resources.integration.test.ts`

**Interfaces:**
- Consumes: `providerNewBookingEmail`, `bookingLifecycleKey` (existing), `getProviderEmail` from `@/lib/booking/provider`.
- Produces: no new exports.

- [ ] **Step 1: Failing template tests**

Append to the first `describe` in `src/features/scheduling/templates.test.ts`:

```ts
  it("client and provider copy never says appointment or slot (H5b: spaces book too)", () => {
    const base = { orgName: "Studio", serviceName: "Loft · 2B", whenLine: "Mon, 05 Apr → Thu, 08 Apr" };
    const mails = [
      bookingReminderEmail(base),
      bookingCancelledEmail({ ...base, cancelledBy: "client" }),
      bookingCancelledEmail({ ...base, cancelledBy: "provider" }),
      providerCancelledEmail({ serviceName: "Loft", whenLine: "Mon", clientName: "A" }),
    ];
    for (const m of mails) {
      expect(m.text.toLowerCase()).not.toMatch(/appointment|\bslot\b/);
      expect(m.html.toLowerCase()).not.toMatch(/appointment|\bslot\b/);
    }
    expect(bookingReminderEmail(base).text).toContain("A reminder about your upcoming booking.");
    expect(bookingCancelledEmail({ ...base, cancelledBy: "client" }).html).toContain(
      "Want to rebook? You can book again any time on the booking page.",
    );
    expect(providerCancelledEmail({ serviceName: "Loft", whenLine: "Mon", clientName: "A" }).text).toContain(
      "The time is open again.",
    );
  });
```

Run: `npx vitest run src/features/scheduling/templates.test.ts`
Expected: FAIL on "appointment" / "slot".

- [ ] **Step 2: Fix the three sentences in `templates.ts`**

- `bookingCancelledEmail` html footer: `Need a new appointment? Book again any time on the booking page.` → `Want to rebook? You can book again any time on the booking page.`
- `bookingReminderEmail` html **and** text: `A reminder about your upcoming appointment.` → `A reminder about your upcoming booking.`
- `providerCancelledEmail` html **and** text: `The slot is open again.` → `The time is open again.`

Run: `npx vitest run src/features/scheduling/templates.test.ts`
Expected: PASS.

- [ ] **Step 3: Nights/days provider notice — failing integration assertion**

Append to the first `describe` in `src/lib/booking/resources.integration.test.ts` (after the auto-assign test; it reads `mail.sent` filled by that test):

```ts
  it("a nights booking sends the provider their own copy (H3 gap closed)", async () => {
    const { data: rows } = await admin
      .from("bookings")
      .select("id, client_email")
      .eq("org_id", capped.orgId)
      .eq("status", "confirmed");
    const bookingId = rows![0].id as string;
    const notice = mail.sent.find((m) => m.idempotencyKey === `booking/${bookingId}/provider-new`);
    expect(notice).toBeDefined();
    expect(notice!.to).toBe(capped.ownerEmail);
    expect(notice!.replyTo).toBe(rows![0].client_email);
    expect(String(notice!.subject)).toContain("New booking — Cabin · Cabin 1");
    expect(String(notice!.text)).toContain("Cap Client booked with you.");
  });
```

Run: `npx vitest run --config vitest.integration.config.ts src/lib/booking/resources.integration.test.ts`
Expected: FAIL — `notice` undefined. (If `to` differs from the owner's sign-up email, read `src/lib/booking/provider.ts` to see whose address `getProviderEmail` resolves and assert that instead — the key and reply-to assertions are the contract.)

- [ ] **Step 4: Send it — `public-actions.ts`**

Add imports:

```ts
import { getProviderEmail } from "@/lib/booking/provider";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  bookingLifecycleKey,
  formatRangeWhenLine,
  providerNewBookingEmail,
} from "@/features/scheduling/templates";
```

Replace the confirmation block (from `// Best-effort confirmation (the booking survives email failure).` through its `catch`) with:

```ts
    // Everything both mails share, computed once; nothing below may fail the
    // committed booking, so the unit-name read swallows its own error.
    const tz = org.timeZone;
    // Nights/days-only flow (as above) — both are set (0056 CHECK).
    const starts = wallTimeToUtc(startDate, ctx.offering.startTime!, tz);
    const ends = wallTimeToUtc(endDate, ctx.offering.endTime!, tz);
    const whenLine = formatRangeWhenLine(starts, ends, tz);
    const unitName = await getBookingUnitName(bookingId as string).catch((e) => {
      console.error("[rentals] getBookingUnitName:", e);
      return null;
    });
    const serviceName = unitName ? `${ctx.offering.name} · ${unitName}` : ctx.offering.name;
    const total = totalCents(
      ctx.offering,
      stayUnits(ctx.offering.rangeMode as "nights" | "days", startDate, endDate),
    );
    const infoLines = moneyInfoLines({
      totalCents: total,
      depositCents: depositCents(ctx.offering, total),
      currency: org.currency,
      cancelWindowMin: ctx.offering.cancelWindowMin,
    });
    const providerEmail = await getProviderEmail(org.orgId).catch((e) => {
      console.error("[rentals] getProviderEmail:", e);
      return null;
    });

    // Best-effort confirmation (the booking survives email failure).
    try {
      const msg = bookingConfirmationEmail({
        orgName: org.orgName,
        serviceName,
        whenLine,
        manageUrl: buildBookingManageUrl(token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        infoLines,
      });
      await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingIdempotencyKey(bookingId as string),
      });
    } catch (mailError) {
      console.error("[rentals] confirmation email failed:", mailError);
    }

    // The provider's own copy — the nights/days twin of the notice
    // createRentalBookingHours sends (H5b closes the gap H3 and H5a noted).
    // Its own try so a failed client mail can't skip it.
    if (providerEmail) {
      try {
        const notice = providerNewBookingEmail({
          serviceName,
          clientName: name,
          clientEmail: email,
          whenLine,
          note: note ?? null,
          infoLines,
        });
        await selectTransport().send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          replyTo: email,
          idempotencyKey: bookingLifecycleKey(bookingId as string, "provider-new"),
        });
      } catch (mailError) {
        console.error("[rentals] provider notice failed:", mailError);
      }
    }
```

Run: `npx vitest run --config vitest.integration.config.ts src/lib/booking/resources.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Date-overrides intro per owner**

In `src/features/scheduling/components/date-overrides.tsx` replace

```tsx
        <p className="text-muted-foreground text-xs">
          Days when your availability differs from your weekly hours.
        </p>
```

with

```tsx
        <p className="text-muted-foreground text-xs">
          {owner.rentalOfferingId !== undefined
            ? "Days when this space's availability differs from its weekly hours."
            : "Days when your availability differs from your weekly hours."}
        </p>
```

(`owner` is the `AvailabilityOwner` prop already in scope — `{ staffId } | { rentalOfferingId }`.)

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npx vitest run src/features/scheduling src/features/orgs`
Expected: clean; `admin-copy.test.ts` still green.

```bash
git add src/features/scheduling/templates.ts src/features/scheduling/templates.test.ts src/features/rentals/public-actions.ts src/features/scheduling/components/date-overrides.tsx src/lib/booking/resources.integration.test.ts
git commit -m "fix(copy): kind-blind reminder/cancel/provider-cancel emails, nights/days provider notice, date-overrides intro per owner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Billing UI — "Bookable resources" meter, banner, plan row

**Files:**
- Create: `src/features/billing/resource-usage.ts`, `src/features/billing/resource-usage.test.ts`
- Modify: `src/features/billing/queries.ts`
- Modify: `src/features/billing/components/usage-meters.tsx`, `plan-banner.tsx`, `plan-picker.tsx:28`

**Interfaces:**
- Consumes: `countResources`, `ResourceUsage`, `Entitlements`; `modeOf`, `effectiveMode`; `getDashboardFlags` from `@/lib/flags/resolve`.
- Produces:
  ```ts
  export type ResourceMeter = { value: string; caption: string; hidden: number };
  export function resourceMeter(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): ResourceMeter;
  export function resourceBannerText(hidden: number, cap: number): string;
  // BillingOverview gains `mode: OrgMode` and `usage.activeUnits: number`
  ```

- [ ] **Step 1: Failing tests — `src/features/billing/resource-usage.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { resourceBannerText, resourceMeter } from "./resource-usage";

const now = new Date("2026-08-25T12:00:00Z");
const free = entitlementsFor(null, now);
const pro = entitlementsFor(
  { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false },
  now,
);
const BOTH = { offersAppointments: true, offersRentals: true };
const SPACES = { offersAppointments: false, offersRentals: true };

describe("resourceMeter (spec §1.2)", () => {
  it("counts people and units per channel against the cap", () => {
    expect(resourceMeter({ activeStaff: 1, activeUnits: 1 }, BOTH, pro)).toEqual({
      value: "2 / 3", caption: "people and units on your booking page", hidden: 0,
    });
  });
  it("a spaces-only org's backfilled person is not counted", () => {
    expect(resourceMeter({ activeStaff: 1, activeUnits: 1 }, SPACES, free).value).toBe("1 / 1");
  });
  it("both-mode on Free with spaces explains why they are hidden", () => {
    const m = resourceMeter({ activeStaff: 1, activeUnits: 2 }, BOTH, free);
    expect(m.value).toBe("3 / 1");
    expect(m.caption).toBe("your person takes the slot — spaces need a second resource");
    expect(m.hidden).toBe(2);
  });
  it("over the cap otherwise says how many are public", () => {
    const m = resourceMeter({ activeStaff: 2, activeUnits: 3 }, BOTH, pro);
    expect(m.caption).toBe("only the first 3 are bookable publicly");
    expect(m.hidden).toBe(2);
  });
});

describe("resourceBannerText", () => {
  it("pluralises both numbers", () => {
    expect(resourceBannerText(1, 1)).toBe(
      "Your plan allows 1 bookable resource (people and units); 1 isn't bookable publicly.",
    );
    expect(resourceBannerText(2, 3)).toBe(
      "Your plan allows 3 bookable resources (people and units); 2 aren't bookable publicly.",
    );
  });
});
```

Run: `npx vitest run src/features/billing/resource-usage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `src/features/billing/resource-usage.ts`**

```ts
import type { OrgMode } from "@/features/orgs/mode";
import { countResources, type Entitlements, type ResourceUsage } from "@/lib/billing/entitlements";

/* The "Bookable resources" tile and the plan banner share these (spec §1.2):
   N = what the org's channels count (people + units, countResources), M =
   the plan's cap. Pure — the components stay presentational. */
export type ResourceMeter = { value: string; caption: string; hidden: number };

export function resourceMeter(usage: ResourceUsage, mode: OrgMode, ent: Entitlements): ResourceMeter {
  const used = countResources(usage, mode);
  const cap = ent.bookableResources;
  const hidden = Math.max(0, used - cap);
  // Both-mode on Free (ruling 4): the person fills the one slot, so every
  // unit is hidden — say why, not just that.
  const bothOnOne = mode.offersAppointments && mode.offersRentals && cap === 1 && usage.activeUnits > 0;
  const caption = bothOnOne
    ? "your person takes the slot — spaces need a second resource"
    : hidden > 0
      ? `only the first ${cap} are bookable publicly`
      : "people and units on your booking page";
  return { value: `${used} / ${cap}`, caption, hidden };
}

export function resourceBannerText(hidden: number, cap: number): string {
  return `Your plan allows ${cap} bookable resource${cap === 1 ? "" : "s"} (people and units); ${hidden} ${hidden === 1 ? "isn't" : "aren't"} bookable publicly.`;
}
```

Run: `npx vitest run src/features/billing/resource-usage.test.ts`
Expected: PASS.

- [ ] **Step 3: `queries.ts` — count units, carry the effective mode**

Add imports `import { effectiveMode, modeOf, type OrgMode } from "@/features/orgs/mode";` and `import { getDashboardFlags } from "@/lib/flags/resolve";`. Change the type and the read:

```ts
export type BillingOverview = {
  orgId: string;
  subscription: OrgSubscriptionRow | null;
  override: PlanOverride | null;
  entitlements: Entitlements;
  /** The org's channels with the rentals kill-switch applied — what
      countResources should count (H5b ruling 5). */
  mode: OrgMode;
  usage: { bookingsThisMonth: number; activeStaff: number; activeUnits: number; services: number };
  founderEligible: boolean;
};
```

```ts
  const [settings, subscription, override, flags, staffRes, unitRes, svcRes, orgRow] = await Promise.all([
    getSchedulingSettings(),
    getRawOrgSubscription(org.id, supabase),
    getPlanOverride(org.id, supabase),
    getDashboardFlags(org.id),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("rental_units").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("active", true),
    supabase.from("services").select("id", { count: "exact", head: true }).eq("org_id", org.id),
    supabase.from("orgs").select("created_at").eq("id", org.id).maybeSingle(),
  ]);
  const failed = staffRes.error ?? unitRes.error ?? svcRes.error ?? orgRow.error;
  if (failed) throw failed;
```

and in the returned object add `mode: effectiveMode(flags, modeOf(org)),` and `activeUnits: unitRes.count ?? 0,` inside `usage`.

- [ ] **Step 4: Components**

`usage-meters.tsx` — replace the staff tile (and its `extraStaff` line) with:

```tsx
import { resourceMeter } from "../resource-usage";
```

```tsx
  const resources = resourceMeter(usage, overview.mode, ent);
```

```tsx
      <StatTile label="Bookable resources" value={resources.value} caption={resources.caption} />
```

(Delete `const extraStaff = usage.activeStaff - ent.bookableResources;`.) Update the file's top comment: "Team's bookable resources is the seat count" instead of "bookable staff".

`plan-banner.tsx` — `PlanBanner` takes the mode and uses the shared helper:

```tsx
import type { OrgMode } from "@/features/orgs/mode";
import { resourceBannerText, resourceMeter } from "../resource-usage";
```

```tsx
export function PlanBanner({ ent, mode, usage }: { ent: Entitlements; mode: OrgMode; usage: Usage }) {
  const { hidden } = resourceMeter(usage, mode, ent);
  const cap = ent.reminderBookingsPerMonth;
  const overResources = hidden > 0;
  const nearQuota = cap !== null && usage.bookingsThisMonth >= REMINDER_WARN_AT;
  if (!overResources && !nearQuota) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {overResources ? <Notice cta="Manage plan">{resourceBannerText(hidden, ent.bookableResources)}</Notice> : null}
      {nearQuota && cap !== null ? (
        <Notice cta="Upgrade">
          {usage.bookingsThisMonth >= cap
            ? `You've used all ${cap} free reminder bookings this month — bookings made now won't get a reminder until it rolls over.`
            : `You've used ${usage.bookingsThisMonth} of ${cap} free reminder bookings this month.`}
        </Notice>
      ) : null}
    </div>
  );
}
```

and in `PlanBannerSlot`: `return <PlanBanner ent={overview.entitlements} mode={overview.mode} usage={overview.usage} />;`. Update the comment above the component ("an over-limit roster" → "hidden resources").

`plan-picker.tsx` — first row: `{ label: "Bookable resources (people + units)", value: (p) => String(p.limits.bookableResources) },`.

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npx vitest run src/features/billing src/lib/billing`
Expected: clean.

```bash
git add src/features/billing
git commit -m "feat(billing): Bookable resources meter + banner from one pure helper; overview counts units and carries the effective mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Pricing/FAQ copy and `FORBIDDEN_COPY`

**Files:**
- Modify: `src/features/marketing/site.ts:141-147,183-201,248`
- Test: `src/features/marketing/site.test.ts`

**Interfaces:**
- Produces: `FORBIDDEN_COPY = ["google", "calendar sync", "stripe", "payment", "offering", "rentals"]`; `PRICING.rows[0]` cells derived from `PLANS[*].limits.bookableResources`.

- [ ] **Step 1: Failing tests**

In `src/features/marketing/site.test.ts` add `PLANS` to the imports (`import { PLANS } from "@/lib/billing/plans";`), extend the corpus in "never advertises unshipped features" with one line after the `PRICING.rows` spread:

```ts
      ...Object.values(PLANS).map((p) => p.blurb),
```

and add:

```ts
  it("FORBIDDEN_COPY retires the old channel words and keeps the H4 ones (H5b ruling 7)", () => {
    expect(FORBIDDEN_COPY).toEqual(["google", "calendar sync", "stripe", "payment", "offering", "rentals"]);
  });

  it("the resources pricing row reads its numbers from PLANS", () => {
    const row = PRICING.rows[0];
    expect(row.label).toBe("Bookable resources — people and units");
    expect([row.free, row.pro, row.team]).toEqual(
      (["free", "pro", "team"] as const).map((id) => String(PLANS[id].limits.bookableResources)),
    );
  });

  it("pricing and the cost FAQ speak of one person or one room, never seats", () => {
    expect(PRICING.sub).toBe(
      "Free for one person or one room. Pay when you need your brand, unlimited services or more bookable resources.",
    );
    const cost = FAQ.find((f) => f.question === "What does it cost?")!;
    expect(cost.answer.toLowerCase()).not.toMatch(/seat|team member/);
  });
```

Run: `npx vitest run src/features/marketing/site.test.ts`
Expected: FAIL (old `FORBIDDEN_COPY`, old row label/sub).

- [ ] **Step 2: Implement in `site.ts`**

```ts
/** Words that must not appear in marketing copy: features not shipped yet
    (google / calendar sync / stripe / payment — the last two leave after H4)
    and the retired channel words (H5b: "Spaces" is the word; "rentals" plural
    is the old channel, "Gear rental" the business type stays legal). */
export const FORBIDDEN_COPY = ["google", "calendar sync", "stripe", "payment", "offering", "rentals"] as const;
```

```ts
export const PRICING = {
  heading: "Simple pricing",
  sub: "Free for one person or one room. Pay when you need your brand, unlimited services or more bookable resources.",
  note: "Prices in USD. Taxes are handled at checkout.",
  rows: [
    // H5b: the one row that IS a limit reads it from PLANS so the number can
    // never drift from what the code enforces.
    {
      label: "Bookable resources — people and units",
      free: String(PLANS.free.limits.bookableResources),
      pro: String(PLANS.pro.limits.bookableResources),
      team: String(PLANS.team.limits.bookableResources),
    },
    { label: "Services on your booking page", free: "3", pro: "Unlimited", team: "Unlimited" },
    { label: "Reminder emails", free: "First 30 bookings a month", pro: "Every booking", team: "Every booking" },
    { label: "Hosted page + website embed", free: "✓", pro: "✓", team: "✓" },
    { label: "Self-serve cancel & reschedule", free: "✓", pro: "✓", team: "✓" },
    { label: "Your logo, colours, welcome text", free: "✓", pro: "✓", team: "✓" },
    { label: "Remove “Powered by Booklo”", free: "—", pro: "✓", team: "✓" },
    { label: "Team layer: per-person links, “Anyone available”, colours", free: "—", pro: "—", team: "✓" },
  ] satisfies PricingRow[],
  founder: `Early-access accounts get Pro for ${FOUNDER_MONTHLY}/month, locked for life — look for the Founder ribbon in Billing.`,
  moreComing: "More is coming to Pro — early-access accounts hear first.",
} as const;
```

FAQ cost answer (billing-on branch):

```ts
    answer: BILLING_ON
      ? "Free for one person or one room — one bookable resource, three services, reminders for your first 30 bookings each month. Pro and Team add your brand, unlimited services and more bookable people and units; see Pricing."
      : "Booklo is free during early access. We'll announce pricing well before anything changes, and early users will hear first.",
```

Run: `npx vitest run src/features/marketing`
Expected: PASS — if the corpus test now fails on `rentals`/`offering`, the failing string is real copy to fix (the lists in the spec were checked: none should).

- [ ] **Step 3: Commit**

```bash
git add src/features/marketing/site.ts src/features/marketing/site.test.ts
git commit -m "feat(marketing): resources pricing row from PLANS, one-person-or-one-room copy, FORBIDDEN_COPY += offering/rentals

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Spaces first on every provider-facing order

**Files:**
- Modify: `src/components/shell/nav.ts:57-64` + `nav.test.ts`
- Modify: `src/features/marketing/site.ts` (`ONBOARDING.modes`), `src/features/orgs/vocab.ts:17,37` + `vocab.test.ts:15,79`
- Modify: `src/features/scheduling/components/new-booking-dialog.tsx:63-80`
- Modify: `src/features/orgs/link-rows.ts` + `link-rows.test.ts`
- Modify: `src/features/orgs/components/business-settings.tsx:12-15`
- Modify: `src/features/scheduling/setup-checklist.ts` + `setup-checklist.test.ts`
- Modify: `src/features/booking-page/templates.ts:201-207` + `templates.test.ts:97-104`

**Interfaces:** no signature changes; orders only.

- [ ] **Step 1: Failing order tests**

`nav.test.ts`: in "both channels" expect `"/rentals", "/services", "/team", "/availability"`; in "sections" expect `by("offer")` → `["/rentals", "/services", "/team", "/availability"]`; rename the describe to `… — spec §1 table, fixed order, spaces first (H5b)`.

`vocab.test.ts`: `expect(SPACES.pickerBothBlurb).toBe("You book spaces and people.");` and `expect(SPACES.pickerBoth).toBe("Space or service");`.

`link-rows.test.ts`: both-mode labels → `["Whole booking page", "Spaces only", "Appointments only", "Room A", "Anna", "Ben", "Massage"]`, badges `[null, null, null, "Space", "Team", "Team", "Service"]`, targets `[null, { channel: "spaces" }, { channel: "services" }, { space: "o1" }, { staff: "anna" }, { staff: "ben" }, { service: "s1" }]`; solo-team case → `["Whole booking page", "Spaces only", "Appointments only", "Room A", "Massage"]`.

`setup-checklist.test.ts`: both-mode ids → `["space", "service", "hours", "publish"]`, labels `["Add a space", "Add a service", "Set hours", "Publish your page"]`, hrefs `["/rentals?new=1", "/services?new=1", "/availability", "/booking-page"]`.

`templates.test.ts` (booking page): replace the `templatesFor` test with

```ts
  it("any org with spaces puts Venue first; appointments-only hides it", () => {
    expect(templatesFor(RENTALS_ONLY)[0]?.id).toBe("venue");
    expect(templatesFor(BOTH)[0]?.id).toBe("venue");
    expect(templatesFor(BOTH)).toHaveLength(TEMPLATES.length);
    expect(templatesFor(APPTS_ONLY).map((t) => t.id)).not.toContain("venue");
    expect(templatesFor(APPTS_ONLY)).toHaveLength(6);
  });
```

Add to `site.test.ts`:

```ts
  it("the onboarding picker lists Spaces first (H5b ruling 1)", () => {
    expect(ONBOARDING.modes.map((m) => m.value)).toEqual(["rentals", "appointments", "both"]);
  });
```

Run: `npx vitest run src/components src/features/orgs src/features/scheduling/setup-checklist.test.ts src/features/booking-page/templates.test.ts src/features/marketing`
Expected: FAIL on each order.

- [ ] **Step 2: Implement**

`nav.ts` — swap the two items so `/rentals` precedes `/services`, and update the header comment: `"Offer" (what the org sells — Spaces, Services, Team, Availability) … The order is fixed regardless of mode, spaces first (H5b ruling 1): a single-mode org loses rows, it never reorders.`

`site.ts` — `ONBOARDING.modes`:

```ts
  modes: [
    { value: "rentals", title: SPACES.pickerTitle, blurb: SPACES.pickerBlurb },
    { value: "appointments", title: "Appointments", blurb: "Time on your calendar: consultations, sessions, classes." },
    { value: "both", title: "Both", blurb: SPACES.pickerBothBlurb },
  ],
```

`vocab.ts` — `pickerBothBlurb: "You book spaces and people."`, `pickerBoth: "Space or service"`.

`new-booking-dialog.tsx` — move the `{spaces.length > 0 ? (<optgroup label={SPACES.nav}>…)}` block above the Services optgroup.

`link-rows.ts`:

```ts
  if (mode.offersAppointments && mode.offersRentals) {
    rows.push({ key: "channel:spaces", label: SPACES.only, badge: null, target: { channel: "spaces" } });
    rows.push({ key: "channel:services", label: APPOINTMENTS.only, badge: null, target: { channel: "services" } });
  }
  if (mode.offersRentals) {
    for (const o of input.spaces) rows.push({ key: `space:${o.id}`, label: o.name, badge: SPACES.badge, target: { space: o.id } });
  }
  if (mode.offersAppointments) {
    for (const p of input.staff) rows.push({ key: `staff:${p.slug}`, label: p.name, badge: "Team", target: { staff: p.slug } });
    for (const s of input.services) rows.push({ key: `service:${s.id}`, label: s.name, badge: "Service", target: { service: s.id } });
  }
```

`business-settings.tsx` — `ROWS`: the `offersRentals` row first.

`setup-checklist.ts` — the `offersRentals` push before the `offersAppointments` push.

`templates.ts`:

```ts
export function templatesFor(mode: OrgMode): Template[] {
  const venue = TEMPLATES.filter((t) => t.id === "venue");
  const rest = TEMPLATES.filter((t) => t.id !== "venue");
  // H5b ruling 1: any org that sells spaces sees Venue first.
  return mode.offersRentals ? [...venue, ...rest] : rest;
}
```

- [ ] **Step 3: Sweep for other pinned literals**

Run: `git grep -n "Service or space\|people and spaces\|\"/services\", \"/rentals\"" -- src`
Expected: only the files edited above (fix any other test literal the grep finds).

- [ ] **Step 4: Verify and commit**

Run: `npm run verify`
Expected: lint 0 errors, typecheck clean, all unit tests pass.

```bash
git add -A src
git commit -m "feat(admin): spaces first — nav, onboarding picker, New booking groups, links rows, Settings rows, checklist, Venue template

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Verification sweep, browser QA, graph update, PR

**Files:**
- Modify: `graphify-out/*` (via `graphify update .`)
- No code changes expected; fix-ups get their own commits.

- [ ] **Step 1: Full verification**

Run: `npm run verify && npm run test:integration`
Expected: all green. If `supabase db reset` is needed and flakes on a Docker 502, retry (known env quirk).

- [ ] **Step 2: Browser QA (Playwright MCP, `localhost` only — never `127.0.0.1`)**

Start: `cp ../../../.env.local .env.local 2>/dev/null; npx next dev -p 3001 --webpack` from the worktree. Log in as the demo org owner. Checklist:

1. `/utils` → flags for the demo org: `billing` ON. `/billing`: "Bookable resources" tile reads `N / 1`; with both channels and ≥1 unit the caption says "your person takes the slot — spaces need a second resource"; the shell banner names hidden resources.
2. Public page `/<handle>`: with both channels on Free, no spaces card/group; turn appointments off in Settings › Business → the first unit's space appears; the widget's unit select (client_picks space) lists only the allowed unit.
3. `/dev/billing/checkout` (fake emulator) → Pro: meter `N / 3`, spaces back; add a 4th resource → `/rentals` unit create refuses with the resource copy; deactivate + reactivate at the cap refuses; editing an active unit's name at the cap saves.
4. Orders: sidebar `Spaces · Services · Team · Availability`; ⌘K shows Spaces before Services; `/onboarding` picker Spaces first; Bookings › New booking select shows the Spaces group first with label "Space or service"; `/embed` Links & embeds rows "Spaces only" before "Appointments only" and space rows before people; Settings › Business Spaces row first; `/bookings?welcome=1` chip "Add a space" first; booking-page template picker Venue first.
5. Emails (Mailpit `http://localhost:54354`): book a nights space as a client → provider gets "New booking — <space> · <unit>"; cancel from the manage link → client mail says "Want to rebook?", provider mail says "The time is open again."; run the reminder drain → "A reminder about your upcoming booking."
6. `/availability?space=<hourly space>` → date overrides intro says "this space's availability"; a person's tab says "your availability".
7. `/pricing` (billing flag on in env or `FLAG_DEFAULTS.billing` temporarily true locally): first row "Bookable resources — people and units" 1 / 3 / 10; plan blurbs; revert any local flag change.

Record pass/fail per item in the PR body.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`
Commit if it changed tracked files.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/h5b
gh pr create --base main --title "feat(h5b): per-resource plans, spaces-first admin, copy audit" --body "$(cat <<'EOF'
## Summary
- `PLANS` per-resource: `bookableResources` Free 1 · Pro 3 · Team 10 (prices unchanged, no migration, `seats` column keeps its name)
- Cap enforced on the public page: `limitPublicResources` (people first, then units), `loadPublicResources` on the gated loader, rental actions filter engine units and name the unit to the RPC only when the plan hides one; admin paths untouched
- One resource gate for people and units (`assertCanAddUnit` on create/reactivate)
- Spaces first: nav, onboarding picker, New booking groups, Links & embeds rows, Settings rows, checklist, Venue template
- Copy audit: kind-blind reminder/cancel/provider-cancel emails, nights/days bookings now notify the provider, date-overrides intro per owner, `FORBIDDEN_COPY` += offering/rentals

Spec: docs/superpowers/specs/2026-08-25-h5b-repositioning-design.md · Plan: docs/superpowers/plans/2026-08-25-h5b-repositioning.md

## Test plan
- [ ] `npm run verify`
- [ ] `npm run test:integration` (new `resources.integration.test.ts`)
- [ ] Browser QA checklist (plan Task 11) — results below

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (done while writing)

- **Spec coverage:** §1.1 → T1; §1.2 → T1 (error copy), T8 (meter/banner/picker), T9 (pricing row/sub/FAQ, blurbs in corpus); §1.3 → T1 (`countResources`), T8 (`activeUnits`, `mode`); §2.1 → T3; §2.2 → T4; §2.3 → T4; §2.4 → T5 (+T6 proves it); §2.5 → T2; §3 → T10; §4.1 → T7; §4.2 → T7 (+T6 file assertion); §4.3 → T7; §4.4 → T9; §5 pure tests → T1–T3, T8–T10; integration → T6/T7; browser QA → T11. Deviation from the spec, documented in code: `PlanLimitedOffering` carries `allowedSpaceIds` next to `allowedUnitIds` so `catalog.ts` needs no unit→space lookup.
- **Placeholders:** none — every step has code or an exact command.
- **Type consistency:** `bookableResources` (T1) is what T3/T4/T8 read; `limitPublicResources` returns `{ staff, units: UnitRef[] }` (T3) and T4 derives both sets from `units`; `loadPublicResources` (T4) is what T5 calls; `evaluateResourceGate(orgId, client, flags)` (T2) matches its tests; `BillingOverview.mode` (T8) matches `resourceMeter(usage, mode, ent)`.
