# Rentals — Slice R3 (org modes: onboarding choice, mode-aware admin, public gating)

> ## ⚠️ RENUMBER: `0040`/`0041` ARE TAKEN BY THE TEAM SLICE
>
> This spec's `0040_org_modes.sql` was numbered when the last migration was
> `0039`. The Team / multi-staff slice has since landed `0040_sad_the_fury`
> (generated) and `0041_staff_security` (custom): use **`0042`** (generated
> columns) and **`0043`** (custom SQL) instead.
>
> **`create_org` must start from `0041_staff_security.sql`'s body, not `0001`'s** —
> 0041 rewrote it to seed the org's first `staff` row, which every booking RPC
> now requires.

**Date:** 2026-08-17
**Status:** Approved (brainstorm with Andrii)
**Parent:** `2026-08-17-rentals-r1-design.md` (decision 5 — "hard mode by default + enable both toggle", deferred from R1 → R2 → here) and `2026-08-17-rentals-r2-design.md`.
**Base:** `main` @ `e6225c6` (R2 #36 merged; last migration `0039`).

## Decision

An org declares **what it sells** — appointments, rentals, or both — once at onboarding, and can change it later in Settings. Two booleans on `orgs` (`offers_appointments`, `offers_rentals`) drive:

1. the admin nav and command menu (hide the channel you don't sell),
2. `/bookings` default view (Timeline for rentals-only),
3. empty-state hints (point at Rentals vs Services),
4. the public booking page and its create RPCs (a disabled channel is not listed and cannot be booked).

Nothing is deleted or 404'd when a flag flips; hidden admin routes redirect to `/overview`, and existing bookings are untouched.

**Rejected alternatives:**
- A single `booking_mode text` enum (`appointments|rentals|both`): "both" is a combinatorial value; a third channel later would explode it, and every consumer would branch on three strings instead of two flags.
- Flags inside a jsonb settings blob: no DB-level "at least one" invariant, and it mixes with `widget_theme`.
- Vocabulary swap (rentals-only says "Reservations"/"Guests"): explicitly out of scope; labels stay generic ("Bookings", "Clients").
- Onboarding without a "Both" option: rejected — a guesthouse that also does massages is a real customer.

Side fix folded in: the admin-shell redesign (#35) rewrote `nav.ts` and dropped the `/rentals` item; on `main` today Rentals is reachable only by URL. R3 restores it, mode-aware.

## Data model — migration `0040_org_modes.sql` (custom SQL, security-surface idiom)

```sql
alter table public.orgs
  add column offers_appointments boolean not null default true,
  add column offers_rentals      boolean not null default true;

-- Backfill (runs before the CHECK so an all-false row can't exist):
--   offers_rentals      = org has any rental_offerings row
--   offers_appointments = org has any services row, OR has no rentals
--                         (never-configured orgs land in appointments-only,
--                          today's default flow)
update public.orgs o set
  offers_rentals = exists (select 1 from public.rental_offerings r where r.org_id = o.id),
  offers_appointments = exists (select 1 from public.services s where s.org_id = o.id)
                        or not exists (select 1 from public.rental_offerings r where r.org_id = o.id);

alter table public.orgs
  add constraint orgs_offers_something check (offers_appointments or offers_rentals);
```

Drizzle `src/db/schema/orgs.ts` gains the two columns (with the "written only via RPC" comment idiom). `orgs` stays select-only for `authenticated` (0004) — writes go through definer RPCs:

### `create_org(p_name text, p_offers_appointments boolean, p_offers_rentals boolean)`
Replaces the 1-arg function (drop `create_org(text)`; regenerate the Supabase types). Same body as today plus: raise `'pick at least one booking type'` if both false; insert both flags. Grant execute to `authenticated`.

### `update_org_modes(p_org_id uuid, p_offers_appointments boolean, p_offers_rentals boolean)`
Definer, `set search_path = ''`, mirrors `update_org_scheduling` (0026): auth check, `p_org_id in (select public.user_orgs())` else `'org not found'`, `'pick at least one booking type'` if both false, update the two columns. `revoke all … from public, anon, authenticated, service_role; grant execute … to authenticated`.

### Public gating (same migration, re-create the current bodies)
- `create_booking` (latest body: `0034_s5_client_name.sql`) — after resolving the org by handle: `if not v_org.offers_appointments then raise exception 'not found'` (same message the RPC uses for an unknown handle, so no channel-existence oracle).
- `create_rental_booking` (latest body: `0039_rentals_r2_rpcs.sql`) — same, on `offers_rentals`.
- Admin RPCs (`create_booking_admin`, `create_rental_booking_admin`, reschedule/apply cores) are **not** gated: an owner may still hand-book a hidden channel from the timeline/calendar (data isn't hidden, only nav).

RLS is unchanged (columns live on `orgs`, already policy-guarded).

## Server reads

- `src/lib/auth/session.ts` `getCurrentOrg()` selects `id, name, slug, offers_appointments, offers_rentals`; exported `Org` type gains `offersAppointments`, `offersRentals` (camelCase mapping done in the query, as `getBrandingSettings` does).
- New `src/features/orgs/mode.ts` (pure, testable):
  ```ts
  export type OrgMode = { offersAppointments: boolean; offersRentals: boolean };
  export type Channel = "appointments" | "rentals";
  export function channelsOf(mode: OrgMode): Channel[];
  export function navItemsFor(mode: OrgMode): NavItem[];      // filters NAV_ITEMS by item.channel
  export function isRouteVisible(pathname: string, mode: OrgMode): boolean;
  export function defaultBookingsView(mode: OrgMode): "week" | "timeline"; // rentals-only → timeline
  ```
- `src/lib/booking/public.ts`: `getBookingOrg(handle)` also returns the two flags; `listPublicServices` / `listPublicOfferings` take the org record and return `[]` when the channel is off (single choke point — the `/book` page and the embed both go through them). `/book/[handle]` keeps its "both lists empty → 404" rule.

## Admin shell

- `nav.ts`: `NavItem` gains optional `channel?: Channel`. Services + Availability → `"appointments"`; new `{ href: "/rentals", label: "Rentals", icon: House01Icon, section: "configure", channel: "rentals" }` placed after Availability. Overview/Bookings/Clients/Booking page/Website embed/Settings are channel-less. `titleForPath` keeps searching the full list.
- `AppShell` receives `mode` from the dashboard layout (`requireOrg()` already runs there) and threads it to `AppSidebar`, `MobileNav`, `TopBar`, and the command menu, all of which render `navItemsFor(mode)` instead of `NAV_ITEMS`.
- Hidden-route guard: `(dashboard)/layout.tsx` cannot see the pathname, so the guard lives at the two channel entry points: `(dashboard)/services/layout.tsx`, `(dashboard)/availability/layout.tsx` (→ redirect `/overview` when `!offersAppointments`) and `(dashboard)/rentals/layout.tsx` (→ redirect when `!offersRentals`). Thin server layouts that call `requireOrg()` and `redirect()`.

## Onboarding

- `onboarding-form.tsx`: below the name field, a required radio group "What are you booking?" rendered as three label-wrapped cards over native `<input type="radio" name="mode">` (house idiom is native form controls — see the offering dialog's `<select>`; no RadioGroup component exists):
  - **Appointments** — "Time on your calendar: consultations, sessions, classes."
  - **Rentals** — "Things people book by the night or day: rooms, cars, equipment."
  - **Both** — "You sell appointments and rentals."
  No default; submit is disabled until one is chosen; the server also validates.
- `createOrgSchema` gains `mode: z.enum(["appointments", "rentals", "both"])`; the action maps it to the two flags and calls `create_org(p_name, p_offers_appointments, p_offers_rentals)`.
- Redirect after create stays `/bookings` (user ruling: keep the S2 post-login surface). The Bookings empty state does the nudging (below).

## Settings — "Business" section

Settings ruling relaxed: Settings holds per-user Interface prefs **and** one org-level "Business" group (future home for org name/timezone). Layout:

```
Interface        (existing per-user appearance)
Business         "What you offer" — two checkboxes (existing `Checkbox` ui component): Appointments · Rentals
                 caption: "Turning one off hides it from your booking page and this admin. Existing bookings stay."
```

- Component `src/features/orgs/components/business-settings.tsx` (client): two `Checkbox`es, optimistic; the last enabled one is `disabled` with tooltip/caption "Keep at least one". Calls server action `updateOrgModes(input)` (`updateOrgModesInput = z.object({ offersAppointments: z.boolean(), offersRentals: z.boolean() }).refine(a || r)`), which calls the RPC then `revalidatePath("/", "layout")` so the sidebar re-renders.
- Turning a channel off does **not** touch its rows (services/offerings stay, inactive or not); turning it back on restores everything.

## Mode-aware defaults & empty states

- `/bookings`: `view` param absent → `defaultBookingsView(mode)`. The Week/Timeline switcher renders only when both channels are on; single-channel orgs see just their view (existing "New rental booking" / week header buttons unchanged).
- Bookings empty state (no bookings in window): appointments → "Set up a service to start taking bookings" → `/services`; rentals → "Add a rental offering and its units" → `/rentals`; both → both links.
- Overview: stat tiles unchanged (they're channel-agnostic). No new stats.
- Public `/book`: unchanged rendering; a gated channel simply isn't in its list.

## Error handling

- RPC errors surface through the existing `GENERIC_WRITE_ERROR` path in `updateOrgModes`; the "at least one" case is caught client-side first (checkbox disabled) so the RPC message is a defence, not UX.
- Onboarding: invalid/missing mode → inline "Pick what you're booking." (schema error), name error unchanged.
- Gated public RPCs raise `'not found'` → the public actions already map that to the widget's generic failure copy.

## Testing

- **Integration (`vitest.integration.config.ts`, existing seeded-org helpers):**
  - `create_org` new signature: creates with each of the three combos; both-false raises; old 1-arg signature no longer exists.
  - `update_org_modes`: non-member raises `org not found`; both-false raises; happy path flips flags; CHECK `orgs_offers_something` blocks a direct all-false update.
  - Backfill logic: apply the same expressions to seeded orgs (org with only offerings → rentals-only; org with nothing → appointments-only; org with both → both).
  - Public gating: with `offers_rentals=false`, `listPublicOfferings` returns `[]` and `create_rental_booking` raises `not found`; symmetric for appointments; admin RPCs still succeed.
- **Unit (Vitest):** `mode.ts` (`navItemsFor`, `isRouteVisible`, `defaultBookingsView`), `createOrgSchema` mode mapping, `updateOrgModesInput` refine.
- **Component/e2e (existing Playwright-less setup — house pattern is integration + unit; add a component test only if the RadioGroup wiring proves fiddly):** onboarding form disables submit until a mode is picked.

## Out of scope (R4+)

Vocabulary swap, per-night pricing, deposits/Stripe, hourly rentals, pooled capacity, per-unit photos, org name/timezone editing in Settings → Business, R2 deferred timeline items (turnover-padded window, occupied-cell tab stops, no-op move token rotation).
