# Internal utils — owner-only management center (`/utils`)

**Date:** 2026-08-18
**Status:** Approved in chat (approach A; sections 1–3 accepted) — ready for an implementation plan
**Type:** Internal tooling. Not a customer feature; nothing here is reachable, or even discoverable, by anyone but the project owner.
**Base:** `main` @ `13e22bf` (PR #42 merged; last migration `0043_billing_security.sql`; billing dormant behind the compile-time `BILLING_ENABLED`).
**Related:** `2026-08-18-pricing-and-billing-design.md` (§7.2 entitlements, §7.6 fake provider), `features/billing/dev/guard.ts` (the existing `/dev/billing` emulator, which stays where it is).

## 1. Goal

Give Andrii — the project owner and its only tester — a **management center inside the app** for quick, no-deploy administration on local, stage and prod alike:

1. **Subscription management** for test ("pet") accounts: put any org on Pro/Team as a complimentary plan, or take it off, without touching Stripe.
2. **Feature toggles per org**: turn a dormant feature (billing, rentals, overview, ⌘K) on for one org — e.g. the test org on prod — while every other org keeps the environment default.
3. A **home for further internal utilities** as they come up.

Access is for the owner alone; the whole area 404s for everyone else, in every environment.

Success: signed in as the owner on prod, open `/utils`, pick the test org, grant it Pro and switch `billing` on — `/billing`, the sidebar item, the creation gates and the public booking page all flip for that org only, and a later real Stripe checkout by that org still works.

## 2. Non-goals / out of scope

- Global (environment-wide) runtime flags. The environment default stays a code change in `lib/flags.ts`.
- Searching orgs by member email (needs `auth.admin`; add later if the name/slug/handle search proves insufficient).
- Moving `/dev/billing` under `/utils` — it emulates the *provider's* pages and keeps its own guard.
- Any audit trail beyond `granted_by`/`updated_by` + timestamps.
- Multi-admin roles, permissions, or "internal" as a product concept. This is one owner's back office.
- Writing `org_subscriptions` from `/utils` (rejected: coexists badly with a live Stripe subscription).

## 3. Design

### 3.1 Access gate

- New optional env var **`INTERNAL_EMAILS`** (comma-separated) in `src/env.ts`. Unset or empty ⇒ nobody is internal ⇒ every `/utils` route and action 404s. That is the safe default; the owner sets it per environment.
- `src/features/utils/guard.ts` — `requireInternal(): Promise<{ user: User }>`:
  - `requireUser()` (redirects to `/login` when signed out — the right answer for a browser hop);
  - `notFound()` unless the signed-in user's email (lower-cased, trimmed) is in the allowlist. `notFound()` rather than 403, as `/dev/billing` does: an internal route does not confirm it exists.
  - **No** `NODE_ENV` or `BILLING_PROVIDER` checks — this gate is the one that works on prod.
- Every server action re-runs `requireInternal()`. A server action is a POST endpoint of its own; the page's guard protects nothing there (`features/billing/dev/actions.ts` idiom).
- Identity note: the check is on Supabase Auth's verified email of a signed-in user, against a list the owner controls. That is adequate for a solo-owner back office and is documented as such in the guard.

### 3.2 Routes and layout

Standalone: own layout, no dashboard sidebar, **no nav link anywhere** — reached by URL only.

```
src/app/utils/layout.tsx               light surface (`.light`, like /dev/billing) + banner
src/app/utils/page.tsx                 hub
src/app/utils/subscriptions/page.tsx   comp plans
src/app/utils/flags/page.tsx           per-org feature toggles
src/features/utils/
  guard.ts        requireInternal, allowlist parsing
  queries.ts      searchOrgs, readOrgAdminView (subscription row + override + flags)
  actions.ts      grantPlanOverride, revokePlanOverride, setOrgFlag
  schema.ts       zod inputs
  components/     internal-banner, org-picker, subscription-panel, flags-table
```

- **Banner**: `Internal tools · <env label>` where the label is derived from `NODE_ENV` and the `NEXT_PUBLIC_APP_URL` host (`development · localhost:3000`, `production · booklo.app`) — so it is never ambiguous which database is being edited.
- **Hub** (`/utils`): cards → *Subscriptions*, *Feature flags*, and an *Environment* card (NODE_ENV, `BILLING_PROVIDER`, app URL, the four flag defaults, and a link to `/dev/billing` when that guard would let it through — i.e. non-production + fake provider + billing default on).
- **Org picker** (shared by both sub-pages): `?org=<uuid>` in the query string. Without it: a search box (name / slug / handle, `ilike`, admin client, first 20 matches, newest first) listing org name, slug, handle, created date, effective plan. With it: that org's panel plus a "change org" link. Unknown id ⇒ `notFound()`.

### 3.3 Data model

Drizzle schema `src/db/schema/utils.ts` (+ export from `schema/index.ts`) → `db:generate` ⇒ **`0044_*.sql`**; then a hand-written **`0045_utils_security.sql`** for CHECKs, RLS, grants (the `0042`/`0043` pattern).

```sql
org_plan_overrides (
  org_id      uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  plan        text NOT NULL,            -- CHECK plan IN ('pro','team')
  expires_at  timestamptz NULL,         -- NULL = until revoked
  note        text NULL,                -- "founder test org", "friend beta" …
  granted_by  text NOT NULL,            -- internal user's email
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

org_feature_flags (
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  flag        text NOT NULL,            -- CHECK flag IN ('billing','rentals','overview','command_menu')
  enabled     boolean NOT NULL,
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, flag)
);
```

- RLS enabled on both. One `SELECT` policy each for `authenticated`, scoped to the caller's org membership (same shape as `org_subscriptions`' policy) — the dashboard reads through the RLS client. **No** INSERT/UPDATE/DELETE policies: writes come only from the service role in `/utils` actions.
- Explicit `GRANT SELECT ON … TO authenticated` (grants convention — newer images drop default ACLs). Nothing to `anon`.
- Index: `org_feature_flags` PK already leads with `org_id`; `org_plan_overrides` is keyed by `org_id`. Nothing more.
- "Revoke" is `DELETE` from `org_plan_overrides`; there is no `plan = 'free'` row. "Default" for a flag is `DELETE` from `org_feature_flags`; only explicit On/Off rows exist.
- The flag CHECK list is duplicated from `FLAG_DEFAULTS` in code; adding a flag means a new migration that widens the CHECK (stated in a comment on both sides).

### 3.4 Comp plans and the entitlement seam

`getOrgSubscription(orgId, client)` in `lib/billing/queries.ts` becomes the single seam that knows about comps:

- Reads `org_subscriptions` and `org_plan_overrides` for the org (`Promise.all`, two PK reads).
- If an override exists and (`expires_at IS NULL OR expires_at > now`) it returns a synthetic `OrgSubscriptionRow`:
  `{ plan, status: 'active', interval: 'month', seats: TEAM_INCLUDED_SEATS, currentPeriodEnd: expires_at, cancelAtPeriodEnd: false }`.
- Otherwise the real row (or `null` = Free), exactly as today.
- Rule: **an unexpired override wins outright** over whatever the real row says. Simple to reason about; the `note` column explains why it is there.
- `now` is threaded from `getEntitlements(orgId, client, now)` so the expiry check is injectable and `entitlementsFor` stays pure. `getEntitlementsAdmin` / `…Strict` and every downstream consumer (gates, badge, public offering, reminders) are untouched.
- `/billing` (customer page): `CurrentPlan` reads the raw row for its "Manage in portal" affordance. When an override is what is in effect, it labels the plan **Complimentary**, shows the expiry (or "no expiry"), and hides the portal button. Nothing else on the page changes.
- Stripe rows and the webhook path are untouched, so a real checkout later still works; when the override expires or is revoked the real row takes over on the next read.

**Subscriptions page** (`/utils/subscriptions?org=…`): for the chosen org —
- the real `org_subscriptions` row, read-only (plan, status, interval, seats, period end, cancel-at-period-end, provider, provider ids — the `readFakeRow` columns);
- the current override, if any (plan, expires, note, granted by/at);
- the **effective plan** as `entitlementsFor` sees it now;
- a form — plan (Pro/Team) · expires (date, or "no expiry") · note → **Grant / Update**; and **Revoke** when an override exists.
- Actions `grantPlanOverride`, `revokePlanOverride`: zod-validated, `requireInternal`, admin client, `revalidatePath`, result via `?done=`/`?error=` query params (plain `<form action>` idiom, no client wrapper). Not wrapped in try/catch — `redirect()` must escape; a DB failure on an internal page is best shown as the stack trace it is.

### 3.5 Feature flags — registry, resolver, consumers

**Registry** — `src/lib/flags.ts` stays a plain module (importable from client components):

```ts
export const FLAG_DEFAULTS = { billing: false, rentals: false, overview: false, command_menu: false } as const;
export type FlagKey = keyof typeof FLAG_DEFAULTS;
export type Flags = Record<FlagKey, boolean>;
export const FLAG_META: Record<FlagKey, { label: string; description: string }>;
```
The four `*_ENABLED` constants are **removed**. Every remaining reader is either a resolved `Flags`, or — only where there is no org — `FLAG_DEFAULTS.x` with a comment saying so. Deleting the constants is what makes the refactor complete: a stale import fails typecheck instead of silently taking the flag-off branch. The per-flag doc comments (what "off" means, how to un-park) move onto `FLAG_META`/`FLAG_DEFAULTS`.

**Resolver** — `src/lib/flags/resolve.ts` (`server-only`):
- `getOrgFlags(orgId, client): Promise<Flags>` — reads `org_feature_flags` for the org, merges over `FLAG_DEFAULTS`. Works with the RLS client (dashboard) or the admin client.
- `getOrgFlagsAdmin = cache(async (orgId) => …)` — public/drain paths; per-request memoised; **degrades to `FLAG_DEFAULTS` on read failure** (log + defaults; a broken flag read must never break a booking page — `getEntitlementsAdmin` stance).
- `getDashboardFlags = cache(async (orgId) => …)` — the caller's own org through the RLS client; per-request memoised; **degrades to `FLAG_DEFAULTS` on read failure too** (ruling at final review 2026-08-18) — the flag-off default IS the pre-branch product, so degrading can only reproduce it, whereas throwing would 500 every dashboard page during a PostgREST schema-cache window or on a deploy where `0044`/`0045` have not been applied yet.
- Dashboard: `(dashboard)/layout.tsx` resolves once and passes `flags` down as a prop (`AppShell` → `SidebarBody`, `Providers`); pages that need flags call `getOrgFlags` themselves (wrap in React `cache()` so the second call in a request is free).

**Consumer conversion** — all 21 import sites, by flag:

| flag | sites | how |
|---|---|---|
| `billing` | `(dashboard)/layout.tsx`, `(dashboard)/billing/page.tsx`, `(dashboard)/embed/page.tsx`, `components/shell/nav.ts`, `features/billing/components/plan-banner.tsx`, `features/billing/actions.ts`, `lib/billing/gates.ts`, `lib/billing/queries.ts` (`emailBadgeUrl`), `lib/booking/public-offering.ts`, `api/scheduling/drain/route.ts` | resolved `Flags` — `getOrgFlags` after `requireOrg`; `assertCanAdd*` take `flags` from the calling action; public/drain paths use `getOrgFlagsAdmin` on the org resolved by handle/booking |
| `billing` (org-less) | `(marketing)/pricing/page.tsx`, `features/marketing/site.ts`, `features/billing/dev/guard.ts` | `FLAG_DEFAULTS.billing` + comment |
| `rentals` | `(dashboard)/rentals/layout.tsx`, `(dashboard)/bookings/page.tsx`, `book/[handle]/page.tsx`, `embed/[handle]/page.tsx`, `features/rentals/public-actions.ts` | resolved `Flags` |
| `overview` | `(dashboard)/overview/layout.tsx`, `nav.ts` | resolved; the "restore the /overview row" comment becomes real: the row shows when the flag resolves true |
| `command_menu` | `components/providers.tsx`, `components/shell/sidebar-body.tsx`, `components/command-menu.tsx` | `flags` prop from the layout; `command-menu` gets `items` from the same resolved list |

`nav.ts`: `NAV_ITEMS` (module-level filter) → `navItemsFor(flags): NavItem[]`; `titleForPath(pathname, items)`.

**Flags page** (`/utils/flags?org=…`): one row per `FlagKey` — label, description, environment default, a three-state control **Default / On / Off** ("Default" deletes the row), last `updated_by`/`updated_at`. Action `setOrgFlag(orgId, flag, value: boolean | null)`.

### 3.6 Error handling

- Guard failures: `notFound()`; signed-out: redirect to `/login`.
- Actions: zod failure ⇒ `?error=invalid`; DB errors throw (internal surface; stack trace is the useful output). `redirect()` never wrapped.
- Reads on customer paths degrade as stated: flags → defaults; entitlements unchanged (Free / strict as today).
- Dashboard `getDashboardFlags` failure **degrades to defaults** (ruling at final review 2026-08-18) — the flag-off default is the pre-branch product, so the page renders what it rendered before this slice instead of 500-ing. `getOrgFlags` itself still throws; callers decide.

## 4. Testing

- **Unit** (`vitest run`): `lib/flags/resolve.test.ts` (merge; degrade to defaults with a throwing stub client); `lib/billing/queries.test.ts` (override wins / expired override ignored / absent ⇒ real row / both absent ⇒ null; `now` injected); `components/shell/nav.test.ts` (`navItemsFor` for each flag combination, `titleForPath`); `features/utils/guard.test.ts` (allowlist parsing: case, whitespace, empty ⇒ nobody).
- **Integration** (`vitest.integration` against local Supabase): RLS — a member reads only their own org's `org_feature_flags` / `org_plan_overrides` and cannot insert/update/delete; the service role writes; the seam picks the override for a real org row.
- **No component tests** (no RTL in the repo — consistent with the billing slice).
- **Manual smoke (local)**: set `INTERNAL_EMAILS` to the owner's email; open `/utils` signed in as owner (200) and as another user (404); comp the org Pro; set `billing` On for it; confirm `/billing`, the sidebar item, the service/staff gates and the public page flip for that org only; a second org is unchanged. Revoke → back to Free.

## 5. Implementation order (each lands green on its own)

1. Gate + layout + hub + org picker (`INTERNAL_EMAILS`, `requireInternal`, `/utils`).
2. `0044`/`0045` migrations, `org_plan_overrides` seam in `getOrgSubscription`, `/utils/subscriptions`, `/billing` "Complimentary" label.
3. `FLAG_DEFAULTS`/`FLAG_META` registry, `resolve.ts`, `/utils/flags`.
4. Consumer conversion — one commit per flag (`billing`, `rentals`, `overview`, `command_menu`), constants deleted in the last one.
5. Docs: memory notes, `.env.example` (`INTERNAL_EMAILS`), launch-checklist line "set INTERNAL_EMAILS on stage/prod".

## 6. Rulings taken in chat (2026-08-18)

- Access = email allowlist via env, owner only, works on prod (over DB flag / non-prod-only).
- Flags = **per-org runtime overrides** over compile-time defaults (over global runtime flags / read-only view).
- Subscription management = **comp plan override** honoured by entitlements (over writing `org_subscriptions` / read-only).
- Approach **A**: full mechanism and convert **all** org-scoped consumers in this slice; org-less surfaces read the default explicitly.
- `/utils` is a standalone layout, no nav link, URL only.
- Unexpired override wins outright over the real subscription row.

## Implementation notes (2026-08-18)

- Built per `docs/superpowers/plans/2026-08-18-internal-utils.md` on `feat/internal-utils`.
- Deviations: `assertCanAddStaff/Service` resolve the org's flag themselves (one change point); `features/billing/dev/guard.ts` follows the org's `billing` flag rather than the default; the drain route's `quotaExceeded` hook is always installed and decides per org.
- `getOrgSubscription` = effective (override wins); `getRawOrgSubscription` = provider row (used by the checkout duplicate guard and the /billing portal affordance).
- Tests turn a feature on for an org by inserting an `org_feature_flags` row with the admin client — there is no compile-time switch any more.
- `searchOrgs` sanitises its input itself (`orgSearchInput`) rather than relying on callers.
- `/utils/*` pages 404 a malformed `?org=` (non-UUID) and the actions never echo a non-UUID org back into a redirect.
