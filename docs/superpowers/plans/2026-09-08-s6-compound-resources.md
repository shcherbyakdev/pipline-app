# S6 Compound Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One rental booking can occupy several units (a whole-studio space blocks its rooms; shared equipment attaches to a room booking) and Postgres refuses every overlap on every one of them.

**Architecture:** A new `booking_units` table holds one occupancy row per booking × unit with its own EXCLUDE; a security-definer trigger on `bookings` writes the primary and component rows and flips a `reserving` flag on status changes, while the hours create/reschedule RPCs write the equipment rows. `rental_offerings.kind` (`space | composite | equipment`) plus a `rental_offering_components` join table describe the shapes; the free-check functions and every availability read switch from `bookings.rental_unit_id` to `booking_units`. Equipment is priced by a new `rental_equipment_lines` SQL function with a TS mirror, concatenated onto the untouched S1 quote.

**Tech Stack:** Next.js (App Router, server actions), Supabase Postgres (plpgsql, RLS, btree_gist EXCLUDE), Drizzle schema + hand-written SQL migrations, Zod, Vitest (unit + integration against the local Supabase stack), next-intl (en/pl/uk), Playwright for QA.

**Spec:** `docs/superpowers/specs/2026-09-08-s6-compound-resources-design.md`

## Global Constraints

- Migration is `src/db/migrations/0084_compound_resources.sql`; statements separated by `--> statement-breakpoint`; every new table gets `enable row level security`, `revoke all … from public, anon, authenticated, service_role` then explicit grants (`supabase-grants-convention`).
- Hand-written migrations need their Drizzle snapshot: after editing `src/db/schema/*.ts`, run `npx drizzle-kit generate`, delete the generated `.sql`, keep `src/db/migrations/meta/0084_snapshot.json`, and set the journal entry's `tag` to `0084_compound_resources`. Index/unique/FK names in SQL must match the Drizzle definitions exactly.
- `create_rental_booking_hours` changes signature: drop the 11-arg version, create the 12-arg version with `p_equipment jsonb default '[]'::jsonb` so existing callers keep working. One-window deploy (S1 idiom).
- Reserving statuses are exactly `('confirmed','pending','pending_payment')` everywhere (SQL and TS).
- Every new UI string lands in `messages/en.json`, `messages/pl.json` and `messages/uk.json`; `src/i18n/messages.test.ts` refuses partial locales and identical translations (unless listed in `SAME_IN_EVERY_LOCALE`).
- Composites and equipment are hours mode only with `unit_selection = 'auto'` (CHECK `rental_offerings_compound_hours`).
- `kind` is set at create time and never edited (no UI, no zod path for changing it).
- Equipment is never a primary offering: both hours create RPCs refuse `kind = 'equipment'` with `not found`; `listPublicOfferings` hides it.
- Unit tests: `npm run verify` (lint + typecheck + `vitest run`). Integration tests: `npm run test:integration` (needs the local Supabase stack, `.env.local`). Run the single new file with `npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts`.
- Commit after every task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5` trailers.
- Deviation from the spec, recorded here: the admin create RPC (`create_rental_booking_hours_admin`) does **not** gain `p_equipment` in this slice — no admin surface offers equipment picks yet, so the parameter would be dead code. It is re-created only to refuse equipment as a primary. Admin equipment picks go on the deferred list.

---

## File map

| File | Responsibility |
|---|---|
| `src/db/migrations/0084_compound_resources.sql` (create) | kind column + CHECKs, `rental_offering_components`, `booking_units`, `sync_booking_units` trigger, backfill, `rental_unit_scope`, both free-checks rewritten, `rental_equipment_lines`, `attach_booking_equipment`, three RPCs re-created |
| `src/db/schema/rentals.ts` (modify) | `kind` on `rentalOfferings`; `rentalOfferingComponents` table |
| `src/db/schema/scheduling.ts` (modify) | `bookingUnits` table (after `bookings`, avoids the import cycle) |
| `src/features/rentals/pricing-rules.ts` (modify) | `Line` gains `equipment`; `EquipmentPick`, `equipmentPicksSchema`, `OFFERING_KINDS` |
| `src/features/rentals/pricing.ts` (modify) | `EquipmentOffering`, `equipmentLines`, `formatLine` case |
| `src/features/rentals/pricing-fixture.ts` (modify) | equipment parity cases |
| `src/features/rentals/hourly.ts` (modify) | `freeUnitsAt` |
| `src/features/rentals/schema.ts` (modify) | `kind`, `componentIds`, `itemCount` on the hours offering branches; `createRentalBookingHoursInput.equipment`; `setOfferingComponentsInput` |
| `src/features/rentals/actions.ts` (modify) | `createOffering` (kind, components, item units, no hours seed for equipment), `updateOffering` (components), `createUnit` refuses composites |
| `src/features/rentals/queries.ts` (modify) | `OfferingRow.kind/componentIds`; `listTimelineData` returns `placements` |
| `src/lib/booking/public.ts` (modify) | `PublicOffering.kind`; `booking_units` reads; `scopeUnitIds`; `alsoBusyUnitIds`; `listEquipmentAvailability`; equipment hidden from the catalogue |
| `src/features/rentals/hourly-actions.ts` (modify) | `getHourlySlots` returns `equipment`; `createRentalBookingHours` passes `equipment` |
| `src/features/rentals/manage-actions.ts` (modify) | `getManageHourlySlots` folds attached equipment busy + returns `equipment` defs and picks |
| `src/features/rentals/booking-actions.ts` (modify) | `getAdminHourlySlots` folds attached equipment busy when `excludeBookingId` is set |
| `src/features/rentals/components/hourly-booking-flow.tsx` (modify) | equipment add-on rows, quote concat, submit |
| `src/features/rentals/components/hourly-reschedule-panel.tsx` (modify) | quote concat |
| `src/features/rentals/components/offering-form.tsx` (modify) | kind choice, includes list, item count, hidden sections |
| `src/features/rentals/components/space-header.tsx`, `offerings-list.tsx` (modify) | kind chip |
| `src/app/(dashboard)/rentals/new/page.tsx`, `[id]/page.tsx` (modify) | pass rooms to the form; hide `UnitsEditor` for composites |
| `src/features/rentals/components/timeline.tsx` (modify) | placements on extra lanes |
| `src/features/payments/actions.ts` (modify) | `loadBookingSettlement.alsoReserved` |
| `src/features/scheduling/components/booking-detail-dialog.tsx`, `src/app/booking/[token]/page.tsx` (modify) | "Also reserved" line |
| `messages/{en,pl,uk}.json` (modify) | new keys |
| `src/features/rentals/compound.integration.test.ts` (create) | guards, RPC behaviour, reads |
| `src/features/rentals/pricing.test.ts`, `hourly.test.ts`, `actions.test.ts`, `pricing-quote.integration.test.ts` (modify) | unit + parity tests |
| `scripts/qa-s6-compound.mjs` (create) | scripted Playwright QA |

---

### Task 1: Migration part A — kind, components, `booking_units`, trigger, backfill, free-checks

**Files:**
- Create: `src/db/migrations/0084_compound_resources.sql`
- Modify: `src/db/schema/rentals.ts`, `src/db/schema/scheduling.ts`
- Create: `src/db/migrations/meta/0084_snapshot.json` (via drizzle-kit), modify `src/db/migrations/meta/_journal.json`
- Test: `src/features/rentals/compound.integration.test.ts` (create)

**Interfaces:**
- Produces: table `public.booking_units(id, org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)`; table `public.rental_offering_components(composite_id, component_id, org_id)`; column `rental_offerings.kind`; function `public.rental_unit_scope(uuid) returns setof uuid`; `rental_unit_is_free` / `rental_unit_is_free_hours` (same signatures) now read `booking_units`.

- [ ] **Step 1: Drizzle schema — `kind` and `rentalOfferingComponents`**

In `src/db/schema/rentals.ts`, inside `rentalOfferings` after `sortOrder`:

```ts
    // S6: 'space' | 'composite' (whole studio ⊃ rooms, one virtual unit) |
    // 'equipment' (units are the physical items, never the primary offering).
    // CHECKs in 0084: non-space ⇒ hours mode + unit_selection 'auto'.
    kind: text("kind").default("space").notNull(),
```

Append to the file:

```ts
// S6: which hourly rooms a composite (whole studio) includes. Guard trigger
// in 0084 pins both offerings to org_id, the composite to kind='composite'
// and the component to kind='space' in hours mode (no nesting).
export const rentalOfferingComponents = pgTable(
  "rental_offering_components",
  {
    compositeId: uuid("composite_id")
      .notNull()
      .references(() => rentalOfferings.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => rentalOfferings.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.compositeId, t.componentId] }),
    index("rental_offering_components_component_idx").on(t.componentId),
  ],
);
```

Add `primaryKey` to the drizzle-orm/pg-core import.

- [ ] **Step 2: Drizzle schema — `bookingUnits`**

In `src/db/schema/scheduling.ts`, after the `bookings` table (it references it), add:

```ts
// S6 occupancy: one row per booking × unit, the only place a unit's
// overlap is enforced (EXCLUDE booking_units_no_overlap in 0084, on
// `reserving` rows). Written by the sync_booking_units trigger (primary +
// component rows) and by the hours RPCs (equipment rows); never by the app.
// `bookings.rental_unit_id` stays the primary unit for display.
export const bookingUnits = pgTable(
  "booking_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    // Cascade: a deleted room takes its component history with it; the
    // primary FK on bookings still restricts.
    rentalUnitId: uuid("rental_unit_id")
      .notNull()
      .references(() => rentalUnits.id, { onDelete: "cascade" }),
    // 'primary' | 'component' | 'equipment' — CHECK in 0084.
    kind: text("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // = status in ('confirmed','pending','pending_payment'); trigger-maintained.
    reserving: boolean("reserving").notNull(),
  },
  (t) => [
    index("booking_units_unit_starts_idx").on(t.rentalUnitId, t.startsAt),
    index("booking_units_booking_idx").on(t.bookingId),
    unique("booking_units_booking_unit_uq").on(t.bookingId, t.rentalUnitId),
  ],
);
```

Make sure `boolean` and `unique` are in the pg-core import of that file.

- [ ] **Step 3: Write the migration part A**

Create `src/db/migrations/0084_compound_resources.sql`:

```sql
-- S6 compound resources (docs/superpowers/specs/2026-09-08-s6-compound-resources-design.md).
-- One occupancy row per booking × unit (booking_units) with its own EXCLUDE.
-- A composite (whole studio) blocks every unit of every room it includes; an
-- equipment space's units attach to a room booking as exclusive add-ons.
-- Deploy note: create_rental_booking_hours changes signature (drop/create) —
-- migrate and deploy the build in one window (S1 idiom).

-- ---------- rental_offerings.kind
alter table public.rental_offerings add column kind text not null default 'space';
--> statement-breakpoint
alter table public.rental_offerings
  add constraint rental_offerings_kind_check check (kind in ('space','composite','equipment')),
  add constraint rental_offerings_compound_hours
    check (kind = 'space' or (range_mode = 'hours' and unit_selection = 'auto'));
--> statement-breakpoint

-- ---------- rental_offering_components: which hourly rooms a composite includes.
create table public.rental_offering_components (
  composite_id uuid not null references public.rental_offerings(id) on delete cascade,
  component_id uuid not null references public.rental_offerings(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  primary key (composite_id, component_id)
);
--> statement-breakpoint
create index rental_offering_components_component_idx on public.rental_offering_components (component_id);
--> statement-breakpoint
-- check_rental_unit_org idiom (0037): both offerings in org_id, the parent a
-- composite, the child an hourly plain space (so nesting is impossible).
create function public.check_offering_component()
returns trigger language plpgsql set search_path = '' as $$
declare v_comp record; v_part record;
begin
  if new.composite_id = new.component_id then raise exception 'component is the composite'; end if;
  select org_id, kind into v_comp from public.rental_offerings where id = new.composite_id;
  select org_id, kind, range_mode into v_part from public.rental_offerings where id = new.component_id;
  if v_comp.org_id is null or v_part.org_id is null then raise exception 'offering not found'; end if;
  if v_comp.org_id <> new.org_id or v_part.org_id <> new.org_id then raise exception 'offering not in org'; end if;
  if v_comp.kind <> 'composite' then raise exception 'not a composite'; end if;
  if v_part.kind <> 'space' or v_part.range_mode <> 'hours' then raise exception 'component must be an hourly space'; end if;
  return new;
end; $$;
--> statement-breakpoint
create trigger rental_offering_components_guard
  before insert or update on public.rental_offering_components
  for each row execute function public.check_offering_component();
--> statement-breakpoint
alter table public.rental_offering_components enable row level security;
--> statement-breakpoint
create policy "rental_offering_components_select_member" on public.rental_offering_components
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "rental_offering_components_insert_member" on public.rental_offering_components
  for insert to authenticated with check (org_id in (select public.user_orgs()));
--> statement-breakpoint
create policy "rental_offering_components_delete_member" on public.rental_offering_components
  for delete to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
revoke all on table public.rental_offering_components from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select, insert, delete on table public.rental_offering_components to authenticated;
--> statement-breakpoint
grant select on table public.rental_offering_components to service_role;
--> statement-breakpoint

-- ---------- booking_units: the occupancy record.
create table public.booking_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  rental_unit_id uuid not null references public.rental_units(id) on delete cascade,
  kind text not null check (kind in ('primary','component','equipment')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reserving boolean not null,
  constraint booking_units_range check (ends_at > starts_at),
  constraint booking_units_booking_unit_uq unique (booking_id, rental_unit_id),
  constraint booking_units_no_overlap
    exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
    where (reserving)
);
--> statement-breakpoint
create index booking_units_unit_starts_idx on public.booking_units (rental_unit_id, starts_at);
--> statement-breakpoint
create index booking_units_booking_idx on public.booking_units (booking_id);
--> statement-breakpoint
alter table public.booking_units enable row level security;
--> statement-breakpoint
create policy "booking_units_select_member" on public.booking_units
  for select to authenticated using (org_id in (select public.user_orgs()));
--> statement-breakpoint
-- Only the definer trigger and the definer RPCs write; the public flows read
-- through the admin client.
revoke all on table public.booking_units from public, anon, authenticated, service_role;
--> statement-breakpoint
grant select on table public.booking_units to authenticated, service_role;
--> statement-breakpoint

-- ---------- Backfill BEFORE the trigger exists: one primary row per rental
-- booking. Cannot violate the new EXCLUDE — the old per-unit EXCLUDE already
-- kept reserving rows apart. No composites exist yet, so no component rows.
insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
select b.org_id, b.id, b.rental_unit_id, 'primary', b.starts_at, b.ends_at,
       b.status in ('confirmed','pending','pending_payment')
  from public.bookings b
 where b.rental_unit_id is not null;
--> statement-breakpoint

-- ---------- sync_booking_units: primary + component rows on insert, the
-- reserving flag on status change. Definer: status flips arrive from definer
-- RPCs, the drain (service_role) and RLS'd member updates, none of which
-- holds a write grant on booking_units. Equipment rows are RPC-written.
-- There is no in-place move (reschedule = new row), so starts/ends never
-- change after insert.
create function public.sync_booking_units()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_reserving boolean; v_kind text;
begin
  if new.rental_unit_id is null then return new; end if;
  v_reserving := new.status in ('confirmed','pending','pending_payment');
  if tg_op = 'INSERT' then
    insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
    values (new.org_id, new.id, new.rental_unit_id, 'primary', new.starts_at, new.ends_at, v_reserving);
    select ro.kind into v_kind from public.rental_offerings ro where ro.id = new.rental_offering_id;
    if v_kind = 'composite' then
      insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
      select new.org_id, new.id, u.id, 'component', new.starts_at, new.ends_at, v_reserving
        from public.rental_offering_components c
        join public.rental_units u on u.offering_id = c.component_id
       where c.composite_id = new.rental_offering_id
         and u.id <> new.rental_unit_id;
    end if;
  elsif new.status is distinct from old.status then
    update public.booking_units
       set reserving = v_reserving
     where booking_id = new.id and reserving is distinct from v_reserving;
  end if;
  return new;
end; $$;
--> statement-breakpoint
create trigger bookings_sync_units
  after insert or update of status on public.bookings
  for each row execute function public.sync_booking_units();
--> statement-breakpoint

-- ---------- rental_unit_scope: the unit itself plus, for a composite's unit,
-- every unit of every included room. Both free-checks read over this scope,
-- so a whole studio is free only when every room is.
create function public.rental_unit_scope(p_unit_id uuid)
returns setof uuid language sql stable set search_path = '' as $$
  select p_unit_id
  union
  select cu.id
    from public.rental_units u
    join public.rental_offerings ro on ro.id = u.offering_id and ro.kind = 'composite'
    join public.rental_offering_components c on c.composite_id = ro.id
    join public.rental_units cu on cu.offering_id = c.component_id
   where u.id = p_unit_id;
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_scope(uuid) from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- rental_unit_is_free (base: 0079): bookings → booking_units over
-- the scope; blackouts over the scope too. Same signature.
create or replace function public.rental_unit_is_free(
  p_unit_id uuid, p_timezone text, p_range_mode text, p_occ_start date, p_occ_end date,
  p_turnover int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'))
    and not exists (
      select 1 from public.booking_units bu
      where bu.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and bu.reserving
        and (p_exclude_booking_id is null or bu.booking_id <> p_exclude_booking_id)
        and daterange((bu.starts_at at time zone p_timezone)::date,
                      greatest((bu.starts_at at time zone p_timezone)::date,
                               (bu.ends_at at time zone p_timezone)::date
                                 - case when p_range_mode = 'nights' then 1 else 0 end
                                 + p_turnover), '[]')
            && daterange(p_occ_start, p_occ_end + p_turnover, '[]'));
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_is_free(uuid, text, text, date, date, int, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- rental_unit_is_free_hours (base: 0079): same swap.
create or replace function public.rental_unit_is_free_hours(
  p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_turnover_min int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange((p_starts_at at time zone p_timezone)::date,
                         (p_ends_at   at time zone p_timezone)::date, '[]'))
    and not exists (
      select 1 from public.booking_units bu
      where bu.rental_unit_id in (select public.rental_unit_scope(p_unit_id))
        and bu.reserving
        and (p_exclude_booking_id is null or bu.booking_id <> p_exclude_booking_id)
        and tstzrange(bu.starts_at, bu.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
--> statement-breakpoint
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint
```

(Task 3 appends part B — equipment lines, attach helper and the RPCs — to this same file before it is ever applied to a shared environment. Locally, apply part A now, then re-apply part B by hand, or `npm run db:reset` after Task 3.)

- [ ] **Step 4: Snapshot + journal**

```bash
npx drizzle-kit generate
```

Expected: a new `src/db/migrations/0084_<random>.sql` and `meta/0084_snapshot.json`, plus a journal entry. Delete the generated `.sql` (`rm src/db/migrations/0084_*.sql` **except** `0084_compound_resources.sql`), and in `meta/_journal.json` set the new entry's `"tag"` to `"0084_compound_resources"`. Then apply locally:

```bash
npm run db:migrate
```

Expected: applies cleanly; `select count(*) from booking_units` equals `select count(*) from bookings where rental_unit_id is not null`.

- [ ] **Step 5: Write the failing integration tests (part A)**

Create `src/features/rentals/compound.integration.test.ts`. Fixture idiom copied from `hourly-rpc.integration.test.ts` (signed-in owner, `create_org`, `update_org_scheduling`, direct inserts through the owner client, 7-day availability 09:00–21:00). The RPC `create_rental_booking_hours` is `service_role`-only, so bookings are made through `admin.rpc(...)` with the 11 arguments it has today (Task 3 adds a defaulted 12th).

```ts
/**
 * S6 compound resources (0084): booking_units occupancy, composites
 * (whole studio ⊃ rooms), equipment add-ons. Requires the local Supabase
 * stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

try { loadEnvFile(".env.local"); } catch { /* CI exports env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const TZ = "Europe/Warsaw";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);
const iso = (local: string) => { const [dd, t] = local.split("T"); return wallTimeToUtc(dd, t, TZ).toISOString(); };
const hash = () => generateAccessToken().tokenHash;
type Row = Record<string, unknown>;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

type Studio = {
  owner: SupabaseClient; orgId: string; handle: string;
  roomA: { id: string; unitId: string }; roomB: { id: string; unitId: string };
  whole: { id: string; unitId: string };
  lamp: { id: string; unitIds: string[] };
};

/** Two hourly rooms, a whole-studio composite including both, and a
    2-unit equipment space (the lamp), all with 7-day 09:00–21:00 hours. */
async function newStudio(tag: string): Promise<Studio> {
  const owner = await signedInUser(tag);
  const { data: org, error: e1 } = await owner.rpc("create_org", {
    p_name: `S6 ${tag}`, p_offers_appointments: false, p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s6-${tag.replace(/_/g, "-")}-${Date.now()}`;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: handle, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;

  async function offering(name: string, kind: "space" | "composite" | "equipment", price: number | null) {
    const { data, error } = await owner.from("rental_offerings").insert({
      org_id: orgId, name, kind, range_mode: "hours", unit_selection: "auto",
      slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
      price_cents: price, pricing_mode: "per_unit",
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function unit(offeringId: string, name: string, sort: number) {
    const { data, error } = await owner.from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name, sort_order: sort }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function hours(offeringId: string) {
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId, rental_offering_id: offeringId, weekday, start_time: "09:00", end_time: "21:00",
    }));
    const { error } = await owner.from("availability_rules").insert(rules);
    if (error) throw error;
  }
  const roomAId = await offering("Room A", "space", 10000);
  const roomBId = await offering("Room B", "space", 10000);
  const wholeId = await offering("Whole studio", "composite", 25000);
  const lampId = await offering("ARRI lamp", "equipment", 5000);
  const s: Studio = {
    owner, orgId, handle,
    roomA: { id: roomAId, unitId: await unit(roomAId, "Room A", 0) },
    roomB: { id: roomBId, unitId: await unit(roomBId, "Room B", 0) },
    whole: { id: wholeId, unitId: await unit(wholeId, "Whole studio", 0) },
    lamp: { id: lampId, unitIds: [await unit(lampId, "Lamp 1", 0), await unit(lampId, "Lamp 2", 1)] },
  };
  await hours(roomAId); await hours(roomBId); await hours(wholeId);
  const { error: e3 } = await owner.from("rental_offering_components").insert([
    { composite_id: wholeId, component_id: roomAId, org_id: orgId },
    { composite_id: wholeId, component_id: roomBId, org_id: orgId },
  ]);
  if (e3) throw e3;
  return s;
}

function book(s: Studio, offeringId: string, startsLocal: string, durationMin: number, extra: Row = {}) {
  return admin.rpc("create_rental_booking_hours", {
    p_handle: s.handle, p_offering_id: offeringId, p_unit_id: null,
    p_starts_at: iso(startsLocal), p_duration_min: durationMin,
    p_name: "Client", p_email: `c${Math.random().toString(36).slice(2)}@example.com`,
    p_note: null, p_token_hash: hash(), p_people: null, p_extras: [],
    ...extra,
  });
}

const isTaken = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === "23P01" || /taken/.test(error.message ?? ""));

async function units(bookingId: string): Promise<Row[]> {
  const { data, error } = await admin.from("booking_units").select("rental_unit_id, kind, reserving").eq("booking_id", bookingId);
  if (error) throw error;
  return data as Row[];
}

describe("S6 — booking_units + composites (0084 part A)", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("a"); }, 60_000);

  it("a room booking writes one primary occupancy row", async () => {
    const { data, error } = await book(s, s.roomA.id, `${d(3)}T10:00`, 60);
    expect(error).toBeNull();
    const rows = await units(data as string);
    expect(rows).toEqual([{ rental_unit_id: s.roomA.unitId, kind: "primary", reserving: true }]);
  });

  it("a whole-studio booking writes primary + one component row per room, and both rooms are blocked", async () => {
    const { data, error } = await book(s, s.whole.id, `${d(4)}T10:00`, 120);
    expect(error).toBeNull();
    const rows = await units(data as string);
    expect(rows.map((r) => `${r.kind}:${r.rental_unit_id}`).sort()).toEqual(
      [`primary:${s.whole.unitId}`, `component:${s.roomA.unitId}`, `component:${s.roomB.unitId}`].sort(),
    );
    const a = await book(s, s.roomA.id, `${d(4)}T11:00`, 60);
    expect(isTaken(a.error)).toBe(true);
    const b = await book(s, s.roomB.id, `${d(4)}T09:00`, 90);   // 09:00–10:30 overlaps 10:00
    expect(isTaken(b.error)).toBe(true);
    const c = await book(s, s.roomB.id, `${d(4)}T12:00`, 60);   // right after — free
    expect(c.error).toBeNull();
  });

  it("a room booking blocks the whole studio for that hour", async () => {
    const r = await book(s, s.roomA.id, `${d(5)}T14:00`, 60);
    expect(r.error).toBeNull();
    const w = await book(s, s.whole.id, `${d(5)}T13:00`, 120);
    expect(isTaken(w.error)).toBe(true);
    const w2 = await book(s, s.whole.id, `${d(5)}T15:00`, 60);
    expect(w2.error).toBeNull();
  });

  it("a blackout on an included room blocks the whole studio", async () => {
    const { error } = await s.owner.from("rental_unit_blackouts").insert({
      org_id: s.orgId, rental_unit_id: s.roomB.unitId, start_date: d(6), end_date: d(6), reason: "paint",
    });
    expect(error).toBeNull();
    const w = await book(s, s.whole.id, `${d(6)}T10:00`, 60);
    expect(isTaken(w.error)).toBe(true);
    const a = await book(s, s.roomA.id, `${d(6)}T10:00`, 60);   // room A itself is fine
    expect(a.error).toBeNull();
  });

  it("cancelling clears reserving on every row and frees the rooms", async () => {
    const { data, error } = await book(s, s.whole.id, `${d(7)}T10:00`, 60);
    expect(error).toBeNull();
    const { error: e } = await admin.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", data as string);
    expect(e).toBeNull();
    const rows = await units(data as string);
    expect(rows.every((r) => r.reserving === false)).toBe(true);
    const a = await book(s, s.roomA.id, `${d(7)}T10:00`, 60);
    expect(a.error).toBeNull();
  });

  it("component guard: cross-org, self, non-composite parent, dates-mode child are refused", async () => {
    const other = await newStudio("b");
    const cross = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: other.roomA.id, org_id: s.orgId });
    expect(cross.error).not.toBeNull();
    const self = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: s.whole.id, org_id: s.orgId });
    expect(self.error).not.toBeNull();
    const notComposite = await s.owner.from("rental_offering_components").insert({ composite_id: s.roomA.id, component_id: s.roomB.id, org_id: s.orgId });
    expect(notComposite.error).not.toBeNull();
    const { data: nights, error: e } = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Flat", range_mode: "nights", start_time: "15:00", end_time: "11:00",
    }).select("id").single();
    expect(e).toBeNull();
    const datesChild = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: nights!.id, org_id: s.orgId });
    expect(datesChild.error).not.toBeNull();
  });

  it("kind CHECK: a composite or equipment space must be hours mode with auto selection", async () => {
    const bad = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Bad", kind: "equipment", range_mode: "nights", start_time: "15:00", end_time: "11:00",
    });
    expect(bad.error?.code).toBe("23514");
    const bad2 = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Bad2", kind: "composite", range_mode: "hours", unit_selection: "client_picks",
      slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
    });
    expect(bad2.error?.code).toBe("23514");
  });

  it("backfill: every rental booking has exactly one primary row", async () => {
    const { count: bookings } = await admin.from("bookings").select("id", { count: "exact", head: true }).not("rental_unit_id", "is", null);
    const { count: primaries } = await admin.from("booking_units").select("id", { count: "exact", head: true }).eq("kind", "primary");
    expect(primaries).toBe(bookings);
  });
});
```

- [ ] **Step 6: Run the new file, expect the part-A block to pass**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts
```

Expected: all 8 tests pass (the migration is applied). If "a whole-studio booking …" fails on the third `book` with `taken`, check the trigger excluded `new.rental_unit_id` from the component rows.

- [ ] **Step 7: Run the whole rentals + payments integration suites (the free-check rewrite must not change them)**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals src/features/payments
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/0084_compound_resources.sql src/db/migrations/meta src/db/schema/rentals.ts src/db/schema/scheduling.ts src/features/rentals/compound.integration.test.ts
git commit -m "feat(rentals): booking_units occupancy + composites (S6 part A)"
```

---

### Task 2: Equipment lines — TS mirror, zod, `Line` kind, `formatLine`, `freeUnitsAt`

**Files:**
- Modify: `src/features/rentals/pricing-rules.ts`, `src/features/rentals/pricing.ts`, `src/features/rentals/hourly.ts`
- Test: `src/features/rentals/pricing.test.ts`, `src/features/rentals/hourly.test.ts`

**Interfaces:**
- Produces:
  - `OFFERING_KINDS = ["space","composite","equipment"] as const; type OfferingKind`
  - `type EquipmentPick = { offeringId: string; qty: number }`, `equipmentPicksSchema`
  - `Line` member `{ kind: "equipment"; qty; unitCents; cents; offeringId; label; unit: "hour" | "flat" }`
  - `type EquipmentOffering = { id: string; name: string; priceCents: number | null; pricingMode: "per_unit" | "flat"; unitCount: number }`
  - `equipmentLines(equipment: EquipmentOffering[], picks: EquipmentPick[], durationMin: number): Line[]` (throws `Error("quote_equipment")`)
  - `freeUnitsAt(units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[], startsAt: Date, endsAt: Date): number`

- [ ] **Step 1: Failing unit tests**

Append to `src/features/rentals/pricing.test.ts`:

```ts
import { equipmentLines, type EquipmentOffering } from "./pricing";
import { equipmentPicksSchema } from "./pricing-rules";

const LAMP: EquipmentOffering = { id: "11111111-1111-4111-8111-111111111111", name: "ARRI", priceCents: 5000, pricingMode: "per_unit", unitCount: 2 };
const SMOKE: EquipmentOffering = { id: "22222222-2222-4222-8222-222222222222", name: "Smoke", priceCents: 8000, pricingMode: "flat", unitCount: 1 };

describe("equipmentLines (S6)", () => {
  it("per-hour × qty × hours, rounded like the S1 base line", () => {
    expect(equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 2 }], 90)).toEqual([
      { kind: "equipment", offeringId: LAMP.id, label: "ARRI", unit: "hour", qty: 2, unitCents: 5000, cents: 15000 },
    ]);
  });
  it("flat × qty ignores the duration", () => {
    expect(equipmentLines([SMOKE], [{ offeringId: SMOKE.id, qty: 1 }], 240)).toEqual([
      { kind: "equipment", offeringId: SMOKE.id, label: "Smoke", unit: "flat", qty: 1, unitCents: 8000, cents: 8000 },
    ]);
  });
  it("keeps pick order and returns [] for no picks", () => {
    const lines = equipmentLines([LAMP, SMOKE], [{ offeringId: SMOKE.id, qty: 1 }, { offeringId: LAMP.id, qty: 1 }], 60);
    expect(lines.map((l) => l.kind === "equipment" && l.offeringId)).toEqual([SMOKE.id, LAMP.id]);
    expect(equipmentLines([LAMP], [], 60)).toEqual([]);
  });
  it("refuses unknown, unpriced, duplicate and oversize picks with the sentinel", () => {
    expect(() => equipmentLines([LAMP], [{ offeringId: SMOKE.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([{ ...LAMP, priceCents: null }], [{ offeringId: LAMP.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 1 }, { offeringId: LAMP.id, qty: 1 }], 60)).toThrow("quote_equipment");
    expect(() => equipmentLines([LAMP], [{ offeringId: LAMP.id, qty: 3 }], 60)).toThrow("quote_equipment");
  });
});

describe("equipmentPicksSchema", () => {
  it("accepts distinct uuid picks with qty 1–99, refuses repeats", () => {
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 1 }]).success).toBe(true);
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 0 }]).success).toBe(false);
    expect(equipmentPicksSchema.safeParse([{ offeringId: LAMP.id, qty: 1 }, { offeringId: LAMP.id, qty: 2 }]).success).toBe(false);
    expect(equipmentPicksSchema.safeParse([{ offeringId: "nope", qty: 1 }]).success).toBe(false);
  });
});
```

Append to `src/features/rentals/hourly.test.ts`:

```ts
import { freeUnitsAt } from "./hourly";

describe("freeUnitsAt (S6)", () => {
  const T = (h: number) => new Date(Date.UTC(2026, 8, 10, h));
  const units = [
    { id: "u1", busy: [{ startsAt: T(10), endsAt: T(12) }] },
    { id: "u2", busy: [] },
    { id: "u3", busy: [{ startsAt: T(12), endsAt: T(13) }] },
  ];
  it("counts units with no overlapping busy interval (touching edges are free)", () => {
    expect(freeUnitsAt(units, T(11), T(12))).toBe(2);   // u1 busy
    expect(freeUnitsAt(units, T(12), T(13))).toBe(2);   // u3 busy; u1 ends at 12 → free
    expect(freeUnitsAt(units, T(14), T(15))).toBe(3);
    expect(freeUnitsAt([], T(14), T(15))).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failures**

```bash
npx vitest run src/features/rentals/pricing.test.ts src/features/rentals/hourly.test.ts
```

Expected: FAIL — `equipmentLines`, `equipmentPicksSchema`, `freeUnitsAt` are not exported.

- [ ] **Step 3: Implement in `pricing-rules.ts`**

Add after `EXTRA_ID_RE`:

```ts
export const OFFERING_KINDS = ["space", "composite", "equipment"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];
```

Extend the `Line` union with:

```ts
  // S6: an equipment space attached to the booking — qty items of one space,
  // priced by that space's own price (per hour or flat per booking).
  | { kind: "equipment"; qty: number; unitCents: number; cents: number; offeringId: string; label: string; unit: "hour" | "flat" };
```

Add after `extraPicksSchema`:

```ts
export type EquipmentPick = { offeringId: string; qty: number };
export const equipmentPicksSchema: z.ZodType<EquipmentPick[]> = z
  .array(z.object({ offeringId: z.uuid(), qty: z.number().int().min(1).max(99) }).strict())
  .max(12)
  .refine((p) => new Set(p.map((x) => x.offeringId)).size === p.length, { message: "equipment repeats" });
```

- [ ] **Step 4: Implement in `pricing.ts`**

Import `EquipmentPick` from `./pricing-rules`. Add after `quoteHours`:

```ts
// S6: the equipment spaces an hours booking may attach. The SQL twin is
// rental_equipment_lines (0084) — same refusals, same rounding
// (round(price × qty × hours), the S1 per-hour rule).
export type EquipmentOffering = {
  id: string;
  name: string;
  priceCents: number | null;
  pricingMode: "per_unit" | "flat";
  unitCount: number;
};

export function equipmentLines(equipment: EquipmentOffering[], picks: EquipmentPick[], durationMin: number): Line[] {
  const seen = new Set<string>();
  const hours = durationMin / 60;
  return picks.map((pick) => {
    const def = equipment.find((e) => e.id === pick.offeringId);
    if (!def || def.priceCents === null || seen.has(pick.offeringId) || pick.qty < 1 || pick.qty > def.unitCount) {
      throw new Error("quote_equipment");
    }
    seen.add(pick.offeringId);
    const flat = def.pricingMode === "flat";
    return {
      kind: "equipment",
      offeringId: def.id,
      label: def.name,
      unit: flat ? "flat" : "hour",
      qty: pick.qty,
      unitCents: def.priceCents,
      cents: flat ? def.priceCents * pick.qty : Math.round(def.priceCents * pick.qty * hours),
    };
  });
}
```

In `formatLine`, add a case (the extra's "label × qty" copy fits an item count):

```ts
    case "equipment":
      return t("line.extra", { label: l.label, qty: l.qty });
```

- [ ] **Step 5: Implement `freeUnitsAt` in `hourly.ts`**

```ts
/** How many of these units have no busy interval overlapping [startsAt, endsAt).
    Touching edges are free (half-open ranges, like the EXCLUDE's tstzrange). */
export function freeUnitsAt(
  units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[],
  startsAt: Date,
  endsAt: Date,
): number {
  const s = startsAt.getTime();
  const e = endsAt.getTime();
  return units.filter((u) => !u.busy.some((b) => b.startsAt.getTime() < e && b.endsAt.getTime() > s)).length;
}
```

- [ ] **Step 6: Run, expect pass; run typecheck (the new `Line` member must not break any exhaustive switch)**

```bash
npx vitest run src/features/rentals/pricing.test.ts src/features/rentals/hourly.test.ts && npm run typecheck
```

Expected: PASS; typecheck clean. If typecheck reports a `switch` on `Line["kind"]` elsewhere, add the `equipment` case there too, rendering by `label`/`qty` like `extra`.

- [ ] **Step 7: Commit**

```bash
git add src/features/rentals/pricing-rules.ts src/features/rentals/pricing.ts src/features/rentals/hourly.ts src/features/rentals/pricing.test.ts src/features/rentals/hourly.test.ts
git commit -m "feat(rentals): equipment lines TS mirror, picks schema, freeUnitsAt (S6)"
```

---

### Task 3: Migration part B — `rental_equipment_lines`, `attach_booking_equipment`, the three RPCs; parity + RPC tests

**Files:**
- Modify: `src/db/migrations/0084_compound_resources.sql` (append), `src/features/rentals/pricing-fixture.ts`
- Test: `src/features/rentals/compound.integration.test.ts` (append), `src/features/rentals/pricing-quote.integration.test.ts` (append)

**Interfaces:**
- Consumes: `booking_units`, `rental_unit_is_free_hours` (Task 1).
- Produces: `public.rental_equipment_lines(p_org_id uuid, p_picks jsonb, p_duration_min int) returns jsonb`; `public.attach_booking_equipment(p_booking_id uuid, p_org_id uuid, p_timezone text, p_picks jsonb, p_starts_at timestamptz, p_ends_at timestamptz, p_reserving boolean, p_prefer_booking_id uuid) returns void`; `create_rental_booking_hours(…11 args…, p_equipment jsonb default '[]')`; `create_rental_booking_hours_admin` (same signature, refuses equipment); `reschedule_rental_hours_apply` (same signature, carries equipment).

- [ ] **Step 1: Failing tests — parity and RPC behaviour**

Append to `src/features/rentals/pricing-fixture.ts` (it exports `FIXTURE_CASES` etc.; add a separate export so the S1 harness is untouched):

```ts
/** S6: equipment picks × duration → expected lines. `priceCents`/`pricingMode`
    are the equipment spaces the parity test creates; ids are filled in at
    runtime (the test maps `lamp`/`smoke` to the inserted offering ids). */
export const EQUIPMENT_FIXTURES = {
  lamp: { name: "ARRI 2 kW", priceCents: 5000, pricingMode: "per_unit" as const, units: 2 },
  smoke: { name: "Smoke machine", priceCents: 8000, pricingMode: "flat" as const, units: 1 },
};
export const EQUIPMENT_CASES: { name: string; picks: { key: "lamp" | "smoke"; qty: number }[]; durationMin: number }[] = [
  { name: "one lamp, 90 min", picks: [{ key: "lamp", qty: 1 }], durationMin: 90 },
  { name: "two lamps + smoke, 4 h", picks: [{ key: "lamp", qty: 2 }, { key: "smoke", qty: 1 }], durationMin: 240 },
  { name: "smoke only, 1 h", picks: [{ key: "smoke", qty: 1 }], durationMin: 60 },
];
```

Append to `src/features/rentals/pricing-quote.integration.test.ts` a new `describe` (reuse that file's `newOrg`/`admin`; read its existing helpers before writing):

```ts
import { equipmentLines, type EquipmentOffering } from "./pricing";
import { EQUIPMENT_FIXTURES, EQUIPMENT_CASES } from "./pricing-fixture";

describe("S6 lockstep: rental_equipment_lines ≡ equipmentLines", () => {
  it("every fixture case", async () => {
    const { client, orgId } = await newOrg("s6eq");   // whatever newOrg returns in this file
    const defs: Record<string, EquipmentOffering> = {};
    for (const [key, f] of Object.entries(EQUIPMENT_FIXTURES)) {
      const { data, error } = await client.from("rental_offerings").insert({
        org_id: orgId, name: f.name, kind: "equipment", range_mode: "hours", unit_selection: "auto",
        slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
        price_cents: f.priceCents, pricing_mode: f.pricingMode,
      }).select("id").single();
      if (error) throw error;
      for (let i = 0; i < f.units; i++) {
        const { error: ue } = await client.from("rental_units").insert({ org_id: orgId, offering_id: data!.id, name: `${f.name} ${i + 1}`, sort_order: i });
        if (ue) throw ue;
      }
      defs[key] = { id: data!.id as string, name: f.name, priceCents: f.priceCents, pricingMode: f.pricingMode, unitCount: f.units };
    }
    for (const c of EQUIPMENT_CASES) {
      const picks = c.picks.map((p) => ({ offeringId: defs[p.key].id, qty: p.qty }));
      const { data, error } = await admin.rpc("rental_equipment_lines", { p_org_id: orgId, p_picks: picks, p_duration_min: c.durationMin });
      expect(error, c.name).toBeNull();
      expect(data, c.name).toEqual(equipmentLines(Object.values(defs), picks, c.durationMin));
    }
    const bad = await admin.rpc("rental_equipment_lines", { p_org_id: orgId, p_picks: [{ offeringId: defs.lamp.id, qty: 3 }], p_duration_min: 60 });
    expect(bad.error?.message).toMatch(/quote_equipment/);
  });
});
```

Append to `src/features/rentals/compound.integration.test.ts`:

```ts
describe("S6 — equipment add-ons + reschedule (0084 part B)", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("c"); }, 60_000);

  const lampPick = (qty: number) => ({ p_equipment: [{ offeringId: s.lamp.id, qty }] });

  it("attaches equipment rows, prices them, and the same lamp cannot serve two rooms at once", async () => {
    const a = await book(s, s.roomA.id, `${d(3)}T10:00`, 60, lampPick(2));
    expect(a.error).toBeNull();
    const rows = await units(a.data as string);
    expect(rows.filter((r) => r.kind === "equipment").map((r) => r.rental_unit_id).sort()).toEqual([...s.lamp.unitIds].sort());
    const { data: b } = await admin.from("bookings").select("price_cents, lines").eq("id", a.data as string).single();
    expect(b!.price_cents).toBe(10000 + 2 * 5000);
    expect((b!.lines as Row[]).some((l) => l.kind === "equipment" && l.qty === 2)).toBe(true);
    // Both lamps are gone for that hour: Room B with one lamp fails, without a lamp passes.
    const taken = await book(s, s.roomB.id, `${d(3)}T10:30`, 60, lampPick(1));
    expect(isTaken(taken.error)).toBe(true);
    const free = await book(s, s.roomB.id, `${d(3)}T10:30`, 60);
    expect(free.error).toBeNull();
  });

  it("two rooms, one lamp each, same hour: both pass", async () => {
    const a = await book(s, s.roomA.id, `${d(8)}T10:00`, 60, lampPick(1));
    const b = await book(s, s.roomB.id, `${d(8)}T10:00`, 60, lampPick(1));
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const ua = await units(a.data as string); const ub = await units(b.data as string);
    const lampA = ua.find((r) => r.kind === "equipment")!.rental_unit_id;
    const lampB = ub.find((r) => r.kind === "equipment")!.rental_unit_id;
    expect(lampA).not.toBe(lampB);
  });

  it("refuses a pick over the unit count and equipment as the primary offering", async () => {
    const over = await book(s, s.roomA.id, `${d(9)}T10:00`, 60, lampPick(3));
    expect(over.error?.message).toMatch(/quote_equipment/);
    const primary = await book(s, s.lamp.id, `${d(9)}T10:00`, 60);
    expect(primary.error?.message).toMatch(/not found/);
  });

  it("reschedule carries the lamp, prefers the same unit, refuses when none is free", async () => {
    const a = await book(s, s.roomA.id, `${d(10)}T10:00`, 60, lampPick(1));
    expect(a.error).toBeNull();
    const lampBefore = (await units(a.data as string)).find((r) => r.kind === "equipment")!.rental_unit_id;
    // Someone else takes the OTHER lamp at 14:00; the move to 14:00 must keep ours.
    const otherLamp = s.lamp.unitIds.find((u) => u !== lampBefore)!;
    const other = await book(s, s.roomB.id, `${d(10)}T14:00`, 60, lampPick(1));
    expect(other.error).toBeNull();
    const otherRows = await units(other.data as string);
    // Auto-pick is by sort_order, so make the assertion independent of which lamp `other` got:
    const otherLampGot = otherRows.find((r) => r.kind === "equipment")!.rental_unit_id;
    const moved = await admin.rpc("reschedule_rental_hours_apply", {
      p_old_id: a.data, p_unit_id: null, p_starts_at: iso(`${d(10)}T14:00`), p_new_token_hash: hash(), p_enforce_limits: false,
    });
    expect(moved.error).toBeNull();
    const newId = (moved.data as Row[])[0].new_booking_id as string;
    const after = await units(newId);
    const lampAfter = after.find((r) => r.kind === "equipment")!.rental_unit_id;
    expect(lampAfter).not.toBe(otherLampGot);
    expect([lampBefore, otherLamp]).toContain(lampAfter);
    const { data: nb } = await admin.from("bookings").select("lines").eq("id", newId).single();
    expect((nb!.lines as Row[]).some((l) => l.kind === "equipment")).toBe(true);
    // Old rows released.
    expect((await units(a.data as string)).every((r) => r.reserving === false)).toBe(true);
    // Now both lamps are taken at 16:00 → a move there must refuse.
    const x = await book(s, s.roomB.id, `${d(10)}T16:00`, 60, lampPick(2));
    expect(x.error).toBeNull();
    const refused = await admin.rpc("reschedule_rental_hours_apply", {
      p_old_id: newId, p_unit_id: null, p_starts_at: iso(`${d(10)}T16:00`), p_new_token_hash: hash(), p_enforce_limits: false,
    });
    expect(isTaken(refused.error)).toBe(true);
  });

  it("reschedule drops the equipment line when the equipment space is inactive", async () => {
    const t = await newStudio("dgr");
    const a = await book(t, t.roomA.id, `${d(11)}T10:00`, 60, { p_equipment: [{ offeringId: t.lamp.id, qty: 1 }] });
    expect(a.error).toBeNull();
    const { error } = await t.owner.from("rental_offerings").update({ active: false }).eq("id", t.lamp.id);
    expect(error).toBeNull();
    const moved = await admin.rpc("reschedule_rental_hours_apply", {
      p_old_id: a.data, p_unit_id: null, p_starts_at: iso(`${d(11)}T12:00`), p_new_token_hash: hash(), p_enforce_limits: false,
    });
    expect(moved.error).toBeNull();
    const newId = (moved.data as Row[])[0].new_booking_id as string;
    const { data: nb } = await admin.from("bookings").select("price_cents, lines").eq("id", newId).single();
    expect(nb!.price_cents).toBe(10000);
    expect((await units(newId)).some((r) => r.kind === "equipment")).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failures**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts src/features/rentals/pricing-quote.integration.test.ts
```

Expected: FAIL — `rental_equipment_lines` does not exist; `p_equipment` is not a parameter.

- [ ] **Step 3: Append part B to the migration**

Append to `src/db/migrations/0084_compound_resources.sql`:

```sql
-- ---------- rental_equipment_lines: priced lines for equipment picks
-- [{offeringId, qty}] of ONE org. TS twin: equipmentLines (pricing.ts),
-- lockstep-tested. Refusals are the 'quote_equipment' sentinel (S1 idiom).
create function public.rental_equipment_lines(p_org_id uuid, p_picks jsonb, p_duration_min int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_lines jsonb := '[]'::jsonb; v_pick jsonb; v_off record; v_qty int; v_units int;
  v_seen uuid[] := '{}'; v_hours numeric := p_duration_min / 60.0;
begin
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 12 then
    raise exception 'quote_equipment';
  end if;
  for v_pick in select * from jsonb_array_elements(p_picks) loop
    if (v_pick->>'offeringId') is null or (v_pick->>'qty') is null then raise exception 'quote_equipment'; end if;
    v_qty := (v_pick->>'qty')::int;
    select ro.id, ro.name, ro.price_cents, ro.pricing_mode into v_off
      from public.rental_offerings ro
     where ro.id = (v_pick->>'offeringId')::uuid and ro.org_id = p_org_id
       and ro.kind = 'equipment' and ro.active;
    if v_off.id is null or v_off.price_cents is null or v_off.id = any(v_seen) then raise exception 'quote_equipment'; end if;
    select count(*) into v_units from public.rental_units u where u.offering_id = v_off.id and u.active;
    if v_qty < 1 or v_qty > v_units then raise exception 'quote_equipment'; end if;
    v_seen := v_seen || v_off.id;
    v_lines := v_lines || jsonb_build_object(
      'kind', 'equipment', 'offeringId', v_off.id, 'label', v_off.name,
      'unit', case when v_off.pricing_mode = 'flat' then 'flat' else 'hour' end,
      'qty', v_qty, 'unitCents', v_off.price_cents,
      'cents', case when v_off.pricing_mode = 'flat' then v_off.price_cents * v_qty
                    else round(v_off.price_cents * v_qty * v_hours)::int end);
  end loop;
  return v_lines;
end; $$;
--> statement-breakpoint
revoke all on function public.rental_equipment_lines(uuid, jsonb, int) from public, anon, authenticated, service_role;
--> statement-breakpoint
grant execute on function public.rental_equipment_lines(uuid, jsonb, int) to service_role;
--> statement-breakpoint

-- ---------- attach_booking_equipment: qty free units per pick → equipment
-- rows. Prefers the units p_prefer_booking_id held (a moved booking keeps
-- its lamp), then sort_order. Fewer free than asked → 'taken' (physical
-- conflict, never degraded). No advisory lock: equipment has no turnover,
-- the EXCLUDE settles races (ruling 10). Owner-only, called by the RPCs.
create function public.attach_booking_equipment(
  p_booking_id uuid, p_org_id uuid, p_timezone text, p_picks jsonb,
  p_starts_at timestamptz, p_ends_at timestamptz, p_reserving boolean, p_prefer_booking_id uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_pick jsonb; v_qty int; v_got int;
begin
  for v_pick in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) loop
    v_qty := (v_pick->>'qty')::int;
    with free as (
      select u.id
        from public.rental_units u
       where u.offering_id = (v_pick->>'offeringId')::uuid and u.org_id = p_org_id and u.active
         and public.rental_unit_is_free_hours(u.id, p_timezone, p_starts_at, p_ends_at, 0, p_booking_id)
       order by (p_prefer_booking_id is not null and exists (
                   select 1 from public.booking_units pb
                    where pb.booking_id = p_prefer_booking_id and pb.rental_unit_id = u.id)) desc,
                u.sort_order, u.created_at
       limit v_qty
    )
    insert into public.booking_units (org_id, booking_id, rental_unit_id, kind, starts_at, ends_at, reserving)
    select p_org_id, p_booking_id, free.id, 'equipment', p_starts_at, p_ends_at, p_reserving from free;
    get diagnostics v_got = row_count;
    if v_got < v_qty then raise exception 'taken'; end if;
  end loop;
end; $$;
--> statement-breakpoint
revoke all on function public.attach_booking_equipment(uuid, uuid, text, jsonb, timestamptz, timestamptz, boolean, uuid)
  from public, anon, authenticated, service_role;
--> statement-breakpoint

-- ---------- create_rental_booking_hours (base: 0079 lines 213–306): + p_equipment.
drop function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb);
--> statement-breakpoint
```

Then paste the **whole** `create function public.create_rental_booking_hours(...)` body from `src/db/migrations/0079_holds_collection.sql` lines 213–306 (from `create or replace function` through `end; $$;`) and apply exactly these edits:

1. Header → add the defaulted parameter:
   ```sql
   create function public.create_rental_booking_hours(
     p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
     p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
     p_people int, p_extras jsonb, p_equipment jsonb default '[]'::jsonb
   ) returns uuid ...
   ```
2. `declare` → add `v_equip jsonb; v_status text;   -- S6`.
3. After the `select * into v_off ...; if v_off.id is null then raise exception 'not found'; end if;` line add:
   ```sql
     -- S6: equipment is an add-on, never the room (ruling 5/9).
     if v_off.kind = 'equipment' then raise exception 'not found'; end if;
   ```
4. Replace the line `v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb));` with:
   ```sql
     v_equip := public.rental_equipment_lines(v_org.id, coalesce(p_equipment, '[]'::jsonb), p_duration_min);   -- S6
     v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb)) || v_equip;
   ```
5. Just before `insert into public.bookings` add:
   ```sql
     v_status := case when v_off.requires_approval then 'pending'
                      when v_pay then 'pending_payment' else 'confirmed' end;
   ```
   and in the `values (...)` replace the three-line `case when v_off.requires_approval ... end` status expression with `v_status`.
6. In the `values (...)`, replace `case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end,  -- S1` with:
   ```sql
        case when jsonb_array_length(v_lines) = 0 then null
             when v_off.pricing is null and jsonb_array_length(v_equip) = 0 then null
             else v_lines end,                                                            -- S1/S6
   ```
7. After `returning id into v_booking_id;` add:
   ```sql
     -- S6: the trigger has written the primary (+ component) rows; equipment
     -- is explicit. Runs inside the same transaction — a lost race rolls the
     -- booking back with 'taken'.
     perform public.attach_booking_equipment(v_booking_id, v_org.id, v_org.timezone, coalesce(p_equipment, '[]'::jsonb),
                                             p_starts_at, v_ends, v_status in ('confirmed','pending','pending_payment'), null);
   ```
8. Tail:
   ```sql
   --> statement-breakpoint
   revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb)
     from public, anon, authenticated, service_role;
   --> statement-breakpoint
   grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb, jsonb) to service_role;
   --> statement-breakpoint
   ```

Next, `create_rental_booking_hours_admin` (base: `0078_pricing_rules.sql` lines 238–314): paste it verbatim under a `-- ---------- create_rental_booking_hours_admin (base: 0078): refuses equipment as the room.` comment as `create or replace function` (same signature, no drop) with one edit — after its `if v_off.id is null then raise exception 'not found'; end if;` add `if v_off.kind = 'equipment' then raise exception 'not found'; end if;`. Keep its revoke/grant tail verbatim, each statement followed by `--> statement-breakpoint`.

Last, `reschedule_rental_hours_apply` (base: `0081_change_consequences.sql` lines 188–372): paste verbatim as `create or replace function` (same signature) with these edits:

1. `declare` → add `v_equipment jsonb; v_equip jsonb; v_new_status text;   -- S6`.
2. After the `v_extras` derivation block (ends with `where l.l->>'kind' = 'extra';`) add:
   ```sql
     -- S6: the attached equipment, degraded like the extras — a deleted or
     -- inactive equipment space (or one with no active units) drops out,
     -- qty is clamped to the active unit count. The join carries org_id so a
     -- foreign id in an old snapshot can never be honoured.
     select coalesce(jsonb_agg(jsonb_build_object('offeringId', ro.id, 'qty', least((l.l->>'qty')::int, cnt.n)) order by l.ord), '[]'::jsonb)
       into v_equipment
       from jsonb_array_elements(coalesce(v_old.lines, '[]'::jsonb)) with ordinality as l(l, ord)
       join public.rental_offerings ro
         on ro.id = (l.l->>'offeringId')::uuid and ro.org_id = v_old.org_id
        and ro.kind = 'equipment' and ro.active and ro.price_cents is not null
       join lateral (select count(*)::int as n from public.rental_units u where u.offering_id = ro.id and u.active) cnt on cnt.n > 0
      where l.l->>'kind' = 'equipment';
   ```
   (`v_old` must carry `org_id` — check the `select ... into v_old` list at the top of the function includes `b.org_id`; if it is only in `v_org.id`, use that.)
3. Inside the `begin ... exception` carry block replace `v_lines := public.rental_quote_hours(v_off.id, p_starts_at, v_duration, v_people, v_extras);` with:
   ```sql
       v_equip := public.rental_equipment_lines(v_old.org_id, v_equipment, v_duration);
       v_lines := public.rental_quote_hours(v_off.id, p_starts_at, v_duration, v_people, v_extras) || v_equip;
   ```
   and extend the sentinel check to `if sqlerrm not in ('quote_band', 'quote_people', 'quote_extra', 'quote_equipment') then raise; end if;`. In the `if v_carry then` branch add `v_equip := '[]'::jsonb;` (carried lines keep the old equipment lines; the attach below uses v_equipment, which is what still exists).
4. In the new-row `insert into public.bookings ... values (...)`, replace `case when v_off.pricing is null or jsonb_array_length(v_lines) = 0 then null else v_lines end` with the same three-way expression as in create (step 6 above), and capture the inserted status: the insert already computes a status expression — assign it to `v_new_status` first (`v_new_status := <that expression>;`) and use `v_new_status` in the `values`.
5. After `returning id into v_new_id;` add:
   ```sql
     -- S6: re-attach the equipment at the new time, preferring the old
     -- booking's own units (its rows stopped reserving when it was flipped to
     -- 'rescheduled' above). None free → 'taken' (ruling 11).
     perform public.attach_booking_equipment(v_new_id, v_old.org_id, v_org.timezone, v_equipment,
                                             p_starts_at, v_ends, v_new_status in ('confirmed','pending','pending_payment'), v_old.id);
   ```
6. Keep its revoke/grant tail verbatim with `--> statement-breakpoint` after each statement.

- [ ] **Step 4: Apply part B locally**

Either re-run the whole migration on a reset DB (`npm run db:reset`, then re-seed anything QA needs) or apply only the appended statements with `psql "$DATABASE_URL" -f <(sed -n '/rental_equipment_lines/,$p' src/db/migrations/0084_compound_resources.sql)`. Expected: no errors.

- [ ] **Step 5: Run the tests, expect pass**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts src/features/rentals/pricing-quote.integration.test.ts
```

Expected: PASS. Then the wider suites (the 11-arg callers must still work through the default):

```bash
npm run test:integration
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0084_compound_resources.sql src/features/rentals/pricing-fixture.ts src/features/rentals/compound.integration.test.ts src/features/rentals/pricing-quote.integration.test.ts
git commit -m "feat(rentals): equipment lines + attach, hours RPCs carry equipment (S6 part B)"
```

---

### Task 4: Availability reads on `booking_units`, composite scope, equipment availability, catalogue filter

**Files:**
- Modify: `src/lib/booking/public.ts`
- Test: `src/features/rentals/compound.integration.test.ts` (append a reads block)

**Interfaces:**
- Produces in `public.ts`:
  - `PublicOffering.kind: OfferingKind` (column `kind` added to `PUBLIC_OFFERING_COLUMNS`/`PublicOfferingDb`/`toPublicOffering`).
  - `loadOrgHourlyContext(..., opts?: { …; alsoBusyUnitIds?: string[] })` — busy of those units is unioned into every `perUnit` entry.
  - `scopeUnitIds(orgId, offeringId, unitIds): Promise<string[]>` — for a composite, the units of its components; otherwise `[]`.
  - `listEquipmentAvailability(orgId, fromIso, toIso, opts?: { excludeBookingId?: string; allowedUnitIds?: Set<string> | null }): Promise<PublicEquipment[]>` with `type PublicEquipment = EquipmentOffering & { units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[] }`.
  - `listBookingEquipmentUnitIds(bookingId): Promise<string[]>` (the booking's `kind = 'equipment'` rows).
  - `listPublicOfferings` / `getPublicOfferingById` (as primary) exclude `kind = 'equipment'`.

- [ ] **Step 1: Failing reads tests**

Append to `compound.integration.test.ts`:

```ts
const publicLib = await import("@/lib/booking/public");

describe("S6 — availability reads", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("r"); }, 60_000);

  it("a whole-studio booking makes the room busy, and a room booking makes the whole studio busy", async () => {
    const w = await book(s, s.whole.id, `${d(12)}T10:00`, 60);
    expect(w.error).toBeNull();
    const roomCtx = await publicLib.loadOrgHourlyContext(s.orgId, s.roomA.id, TZ, d(12), 1);
    expect(roomCtx!.perUnit[0].busy.some((b) => b.startsAt.toISOString() === iso(`${d(12)}T10:00`))).toBe(true);
    const r = await book(s, s.roomB.id, `${d(12)}T13:00`, 60);
    expect(r.error).toBeNull();
    const wholeCtx = await publicLib.loadOrgHourlyContext(s.orgId, s.whole.id, TZ, d(12), 1);
    expect(wholeCtx!.perUnit).toHaveLength(1);
    expect(wholeCtx!.perUnit[0].busy.some((b) => b.startsAt.toISOString() === iso(`${d(12)}T13:00`))).toBe(true);
  });

  it("alsoBusyUnitIds folds a lamp's busy time into every room unit", async () => {
    const a = await book(s, s.roomA.id, `${d(13)}T10:00`, 60, { p_equipment: [{ offeringId: s.lamp.id, qty: 1 }] });
    expect(a.error).toBeNull();
    const lampUnit = (await units(a.data as string)).find((r) => r.kind === "equipment")!.rental_unit_id as string;
    const ctx = await publicLib.loadOrgHourlyContext(s.orgId, s.roomB.id, TZ, d(13), 1, { alsoBusyUnitIds: [lampUnit] });
    expect(ctx!.perUnit[0].busy.some((b) => b.startsAt.toISOString() === iso(`${d(13)}T10:00`))).toBe(true);
    const plain = await publicLib.loadOrgHourlyContext(s.orgId, s.roomB.id, TZ, d(13), 1);
    expect(plain!.perUnit[0].busy.some((b) => b.startsAt.toISOString() === iso(`${d(13)}T10:00`))).toBe(false);
  });

  it("listEquipmentAvailability lists equipment spaces with per-unit busy; listPublicOfferings hides them", async () => {
    const eq = await publicLib.listEquipmentAvailability(s.orgId, iso(`${d(13)}T00:00`), iso(`${d(14)}T00:00`));
    expect(eq.map((e) => e.id)).toEqual([s.lamp.id]);
    expect(eq[0].unitCount).toBe(2);
    expect(eq[0].units.flatMap((u) => u.busy)).toHaveLength(1);
    const offerings = await publicLib.listPublicOfferings(s.orgId);
    expect(offerings.map((o) => o.id).sort()).toEqual([s.roomA.id, s.roomB.id, s.whole.id].sort());
    expect(offerings.find((o) => o.id === s.whole.id)!.kind).toBe("composite");
  });
});
```

- [ ] **Step 2: Run, expect failures**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts -t "availability reads"
```

Expected: FAIL (busy from `bookings` only; `listEquipmentAvailability` missing; equipment listed).

- [ ] **Step 3: `kind` on `PublicOffering`**

Run `grep -rn 'from("rental_offerings")' src/lib src/features/marketing src/app` and list every public-facing reader (hosted page, widget templates, `lib/booking/preview-catalog.ts`, embed page). Each catalogue-style list adds `.neq("kind", "equipment")`; `listPublicUnitsForOrg` (the plan cap's count) is left alone — equipment units spend the budget (ruling 13).

In `public.ts`: import `OfferingKind` from `@/features/rentals/pricing-rules`; add `kind: OfferingKind;` to `PublicOffering` and `PublicOfferingDb` (`kind: OfferingKind`), `kind` to `PUBLIC_OFFERING_COLUMNS`, and `kind: o.kind` in `toPublicOffering`. In `listPublicOfferings` add `.neq("kind", "equipment")` to the offerings query. In `getPublicOfferingById` (used as the primary by every hourly/range flow) add the same `.neq("kind", "equipment")` **only if** its callers are all "book this as the room" paths — check with `grep -n getPublicOfferingById src`; if `loadOrgHourlyContext` is the only consumer, add it there instead by returning `null` when `offering.kind === "equipment"`.

- [ ] **Step 4: Occupancy from `booking_units`; scope; `alsoBusyUnitIds`**

Add near the rentals section of `public.ts`:

```ts
// S6: a composite's own unit stands for every unit of its included rooms —
// their occupancy is folded onto it (rental_unit_scope's TS twin).
export async function scopeUnitIds(orgId: string, offeringId: string, kind: OfferingKind): Promise<string[]> {
  if (kind !== "composite") return [];
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offering_components")
    .select("component_id")
    .eq("composite_id", offeringId)
    .eq("org_id", orgId);
  if (error) throw error;
  const componentIds = (data ?? []).map((c) => c.component_id as string);
  if (componentIds.length === 0) return [];
  const { data: units, error: unitsError } = await admin
    .from("rental_units")
    .select("id")
    .in("offering_id", componentIds)
    .eq("org_id", orgId);
  if (unitsError) throw unitsError;
  return (units ?? []).map((u) => u.id as string);
}

type OccupancyRow = { booking_id: string; rental_unit_id: string; starts_at: string; ends_at: string };

// S6: the one occupancy read. Reserving rows of these units in the window;
// `excludeBookingId` drops the booking being moved.
async function listOccupancy(unitIds: string[], fromIso: string, toIso: string, excludeBookingId?: string): Promise<OccupancyRow[]> {
  if (unitIds.length === 0) return [];
  const admin = createAdminClient();
  let q = admin
    .from("booking_units")
    .select("booking_id, rental_unit_id, starts_at, ends_at")
    .in("rental_unit_id", unitIds)
    .eq("reserving", true)
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  if (excludeBookingId) q = q.neq("booking_id", excludeBookingId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OccupancyRow[];
}
```

In `loadOrgRangeContext` (line ≈700): replace the `admin.from("bookings").select("id, rental_unit_id, starts_at, ends_at").in("rental_unit_id", unitIds).in("status", [...]).gte(...).lte(...)` with `listOccupancy(unitIds, \`${windowStart}T00:00:00Z\`, \`${windowEnd}T23:59:59Z\`)` and map `{ id: b.booking_id, unitId: b.rental_unit_id, startsAt, endsAt }`. Any later `b.id !== excludeBookingId` filter now compares `booking_id`.

In `loadOrgHourlyContext`:
- add `alsoBusyUnitIds?: string[]` to `opts`;
- return `null` when `offering.kind === "equipment"`;
- compute `const scope = await scopeUnitIds(orgId, offeringId, offering.kind);`
- replace the bookings query with `listOccupancy([...unitIds, ...scope, ...(opts?.alsoBusyUnitIds ?? [])], fromIso, toIso, opts?.excludeBookingId)`;
- build `perUnit` so each unit's busy = its own rows + rows on `scope` units + rows on `alsoBusyUnitIds` units + blackouts + external:

```ts
  const extraUnitIds = new Set([...scope, ...(opts?.alsoBusyUnitIds ?? [])]);
  const toBusy = (b: OccupancyRow): BusyInterval => ({
    startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at), bufferAfterMin: offering.turnoverMin,
  });
  const perUnit = units.map((u) => ({
    unitId: u.id,
    busy: [
      ...occupancy.filter((b) => b.rental_unit_id === u.id || extraUnitIds.has(b.rental_unit_id)).map(toBusy),
      ...(blackoutMap.get(u.id) ?? []),
      // A blackout on an included room blocks the whole studio (ruling 7).
      ...scope.flatMap((id) => blackoutMap.get(id) ?? []),
      ...external,
    ],
  }));
```

The blackout fetch must then cover `[...unitIds, ...scope]`.

- [ ] **Step 5: `listEquipmentAvailability` and `listBookingEquipmentUnitIds`**

```ts
import type { EquipmentOffering } from "@/features/rentals/pricing";
export type PublicEquipment = EquipmentOffering & { units: { id: string; busy: { startsAt: Date; endsAt: Date }[] }[] };

// S6: the org's active equipment spaces with what is busy in the window —
// the add-on step's "N available" and the reschedule panels' fold-in.
export async function listEquipmentAvailability(
  orgId: string,
  fromIso: string,
  toIso: string,
  opts?: { excludeBookingId?: string; allowedUnitIds?: Set<string> | null },
): Promise<PublicEquipment[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_offerings")
    .select("id, name, price_cents, pricing_mode, rental_units(id, active)")
    .eq("org_id", orgId)
    .eq("kind", "equipment")
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  const rows = (data ?? []) as unknown as { id: string; name: string; price_cents: number | null; pricing_mode: "per_unit" | "flat"; rental_units: { id: string; active: boolean }[] | null }[];
  const equipment = rows
    .map((r) => ({
      id: r.id, name: r.name, priceCents: r.price_cents, pricingMode: r.pricing_mode,
      unitIds: (r.rental_units ?? []).filter((u) => u.active && (!opts?.allowedUnitIds || opts.allowedUnitIds.has(u.id))).map((u) => u.id),
    }))
    .filter((r) => r.unitIds.length > 0 && r.priceCents !== null);
  const occupancy = await listOccupancy(equipment.flatMap((e) => e.unitIds), fromIso, toIso, opts?.excludeBookingId);
  return equipment.map((e) => ({
    id: e.id, name: e.name, priceCents: e.priceCents, pricingMode: e.pricingMode, unitCount: e.unitIds.length,
    units: e.unitIds.map((id) => ({
      id,
      busy: occupancy.filter((b) => b.rental_unit_id === id).map((b) => ({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at) })),
    })),
  }));
}

// S6: the equipment units a booking holds (for the reschedule fold-in).
export async function listBookingEquipmentUnitIds(bookingId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("booking_units").select("rental_unit_id").eq("booking_id", bookingId).eq("kind", "equipment");
  if (error) throw error;
  return (data ?? []).map((r) => r.rental_unit_id as string);
}
```

- [ ] **Step 6: Run reads tests + the hourly/rentals integration files that exercise these loaders**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/compound.integration.test.ts src/features/rentals/hourly-flow.integration.test.ts src/features/rentals/flow.integration.test.ts src/features/rentals/queries.integration.test.ts && npm run typecheck
```

Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/booking/public.ts src/features/rentals/compound.integration.test.ts
git commit -m "feat(booking): availability reads on booking_units, composite scope, equipment availability (S6)"
```

---

### Task 5: Public + manage + admin actions and the widget

**Files:**
- Modify: `src/features/rentals/schema.ts` (`createRentalBookingHoursInput.equipment`), `src/features/rentals/hourly-actions.ts`, `src/features/rentals/manage-actions.ts`, `src/features/rentals/booking-actions.ts`, `src/features/rentals/components/hourly-booking-flow.tsx`, `src/features/rentals/components/hourly-reschedule-panel.tsx`, `messages/{en,pl,uk}.json`
- Test: `src/features/rentals/hourly-flow.integration.test.ts` (append), `src/i18n/messages.test.ts` (runs as is)

**Interfaces:**
- Consumes: `listEquipmentAvailability`, `listBookingEquipmentUnitIds`, `alsoBusyUnitIds` (Task 4); `equipmentLines`, `freeUnitsAt`, `equipmentPicksSchema` (Task 2).
- Produces: `getHourlySlots` returns `equipment: PublicEquipment[]`; `createRentalBookingHours` input gains `equipment: EquipmentPick[]` (default `[]`) and maps `quote_equipment` to the existing `rentalsQuote` error; `getManageHourlySlots` returns `equipment: EquipmentOffering[]` and `booking.equipment: EquipmentPick[]`.

- [ ] **Step 1: Failing integration test for the public action**

Append to `src/features/rentals/hourly-flow.integration.test.ts` (read its fixture helpers first; it creates an hourly org and calls `createRentalBookingHours` through `hourly-actions`). Add a test that creates an equipment space + unit for that org via the owner client (kind `equipment`, price 5000, one unit), then:

```ts
it("S6: a booking with an equipment pick prices it, holds a lamp, and getHourlySlots lists the equipment", async () => {
  const slots = await hourlyActions.getHourlySlots({ handle, offeringId, durationMin: 60, fromDate: d(3), days: 7 });
  expect(slots.ok && slots.equipment.map((e) => e.id)).toEqual([lampId]);
  const result = await hourlyActions.createRentalBookingHours({
    handle, offeringId, unitId: null, startsAt: iso(`${d(3)}T10:00`), durationMin: 60,
    name: "Eq Client", email: "eq@example.com", termsAccepted: false, people: null, extras: [],
    equipment: [{ offeringId: lampId, qty: 1 }],
  });
  expect(result.ok).toBe(true);
  const { data } = await admin.from("bookings").select("id, price_cents").eq("client_email", "eq@example.com").single();
  expect(data!.price_cents).toBe(/* room price */ 10000 + 5000);
  const { data: rows } = await admin.from("booking_units").select("kind").eq("booking_id", data!.id);
  expect(rows!.map((r) => r.kind).sort()).toEqual(["equipment", "primary"]);
  const over = await hourlyActions.createRentalBookingHours({ /* same */ equipment: [{ offeringId: lampId, qty: 2 }] });
  expect(over.ok).toBe(false);
  expect(!over.ok && over.quote).toBe(true);
});
```

Fill in `handle`, `offeringId`, `d`, `iso`, `admin`, `hourlyActions` from that file's own names (they exist; do not invent new fixtures).

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/hourly-flow.integration.test.ts -t S6
```

Expected: FAIL — `equipment` is stripped/unknown, `slots.equipment` undefined.

- [ ] **Step 3: Schema + actions**

`schema.ts`: in `createRentalBookingHoursInput` add `equipment: equipmentPicksSchema.default([]),` (import from `./pricing-rules`).

`hourly-actions.ts`:
- `getHourlySlots`: after computing `slots`, add

```ts
    // S6: what equipment is on offer and when it is busy — the add-on step
    // caps quantities per slot with freeUnitsAt. Capped units never appear
    // (H5b: the plan's budget applies to a lamp as it does to a room).
    const resources = await loadPublicResources(ctx.org.orgId);   // memoised per request
    const equipment = await listEquipmentAvailability(
      ctx.org.orgId,
      `${from}T00:00:00Z`,
      `${addDaysISO(from, span)}T23:59:59Z`,
      { allowedUnitIds: resources?.allowedUnitIds ?? null },
    );
```

  Return `equipment` in the `ok: true` object and extend the return type with `equipment: PublicEquipment[]`.
- `createRentalBookingHours`: destructure `equipment`; pass `p_equipment: equipment` in `call()`; add `isRpcSentinel(error, "quote_equipment")` to the `rentalsQuote` condition.

`manage-actions.ts`:
- `toManageBookingMoney`: add `equipment: (booking.lines ?? []).flatMap((l) => (l.kind === "equipment" ? [{ offeringId: l.offeringId, qty: l.qty }] : []))` and `equipment: EquipmentPick[]` to `ManageBookingMoney`.
- `getManageHourlySlots`: before `loadOrgHourlyContext`, `const equipmentUnitIds = await listBookingEquipmentUnitIds(booking.id);` and pass `alsoBusyUnitIds: equipmentUnitIds` in opts; after, `const equipment = await listEquipmentAvailability(booking.orgId, fromIso, toIso, { excludeBookingId: booking.id });` (use the same `from`/`span` window as the context) and return `equipment: equipment.map(({ units: _u, ...def }) => def)` so the panel has `EquipmentOffering[]` for `equipmentLines`.

`booking-actions.ts` `getAdminHourlySlots`: when `excludeBookingId` is set, fold that booking's equipment: `alsoBusyUnitIds: excludeBookingId ? await listBookingEquipmentUnitIds(excludeBookingId) : undefined`.

- [ ] **Step 4: Widget — add-on rows**

`hourly-booking-flow.tsx`:
- state: `const [equipment, setEquipment] = React.useState<EquipmentPick[]>([]);` and `const [equipmentDefs, setEquipmentDefs] = React.useState<PublicEquipment[]>([]);` (`PublicEquipment` from `@/lib/booking/public` — it is a type import, safe in a client component).
- in `load()` where `setSlots`/`setUnits` are called from the `getHourlySlots` result, also `setEquipmentDefs(result.equipment)`.
- reset `setEquipment([])` wherever `setExtras([])` is reset (`changeDuration`, `backToTime`, the `result.quote` branch).
- the preview quote: `const lines = [...quoteHours(...), ...equipmentLines(equipmentDefs, equipment, durationMin)]` (wrap in the same try/catch the S1 quote uses).
- submit: pass `equipment`.
- rows: after the extras `<ul>`, when `equipmentDefs.length > 0 && slot && durationMin`:

```tsx
          {equipmentDefs.length > 0 && slot && durationMin ? (
            <ul className={ROW_LIST} aria-label={t("equipment")}>
              {equipmentDefs.map((eq) => {
                const free = freeUnitsAt(eq.units, new Date(slot), new Date(new Date(slot).getTime() + durationMin * 60_000));
                const qty = equipment.find((e) => e.offeringId === eq.id)?.qty ?? 0;
                const setQty = (q: number) =>
                  setEquipment(q <= 0 ? equipment.filter((e) => e.offeringId !== eq.id) : [...equipment.filter((e) => e.offeringId !== eq.id), { offeringId: eq.id, qty: q }]);
                return (
                  <li key={eq.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block">{eq.name}</span>
                      <span className="text-muted-foreground block text-xs">
                        {formatMoney(eq.priceCents ?? 0, currency)} · {eq.pricingMode === "flat" ? tu("perBooking") : tu("perHourShort")}
                        {" · "}
                        {free === 0 ? t("noneLeft") : t("available", { count: free })}
                      </span>
                    </span>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" aria-label={t("fewerOf", { label: eq.name })} disabled={qty === 0} onClick={() => setQty(qty - 1)}><Minus /></Button>
                      <span className="w-6 text-center tabular-nums">{qty}</span>
                      <Button type="button" variant="outline" size="sm" aria-label={t("moreOf", { label: eq.name })} disabled={qty >= free} onClick={() => setQty(qty + 1)}><Plus /></Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
```

- when `slot` or `durationMin` changes, drop picks that no longer fit: in the effect/handler that reacts to a slot change, `setEquipment((cur) => cur.filter((p) => freeUnitsAt(defFor(p).units, s, e) >= p.qty))` — or simply reset `setEquipment([])` on slot change like extras are reset on duration change (acceptable; choose the reset).

`hourly-reschedule-panel.tsx`: where `quoteHours(...)` is computed for the preview, concatenate `equipmentLines(result.equipment, booking.equipment, durationMin)` inside the same try/catch (a `quote_equipment` throw is treated like the other sentinels).

- [ ] **Step 5: Copy in all three locales**

`public.widget`: `equipment` ("Equipment" / "Sprzęt" / "Обладнання"), `available` ("{count} available" / "{count} dostępne" / "{count} доступно"), `noneLeft` ("none left at this time" / "brak wolnych o tej godzinie" / "немає вільних на цей час"). `public.units.perBooking` ("per booking" / "za rezerwację" / "за бронювання").

- [ ] **Step 6: Run**

```bash
npx vitest run --config vitest.integration.config.ts src/features/rentals/hourly-flow.integration.test.ts src/features/rentals/change-consequences.integration.test.ts && npm run verify
```

Expected: PASS (including `messages.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/features/rentals/schema.ts src/features/rentals/hourly-actions.ts src/features/rentals/manage-actions.ts src/features/rentals/booking-actions.ts src/features/rentals/components/hourly-booking-flow.tsx src/features/rentals/components/hourly-reschedule-panel.tsx src/features/rentals/hourly-flow.integration.test.ts messages
git commit -m "feat(public): equipment add-ons in the hourly flow, reschedule fold-in (S6)"
```

---

### Task 6: Admin — kinds in the space form, components, item count, chips, guards

**Files:**
- Modify: `src/features/rentals/schema.ts`, `src/features/rentals/actions.ts`, `src/features/rentals/queries.ts`, `src/features/rentals/components/offering-form.tsx`, `src/features/rentals/components/space-header.tsx`, `src/features/rentals/components/offerings-list.tsx`, `src/app/(dashboard)/rentals/new/page.tsx`, `src/app/(dashboard)/rentals/[id]/page.tsx`, the admin new-booking form's offering list (`space-booking-form.tsx` or the page that feeds it), `messages/{en,pl,uk}.json`
- Test: `src/features/rentals/actions.test.ts` (append zod cases); the `createUnit` composite refusal is covered by the browser QA in Task 8 (server actions need a session)

**Interfaces:**
- Consumes: `OFFERING_KINDS`, `OfferingKind` (Task 2).
- Produces: `offeringInput` hours branch accepts `kind` (default `space`), `componentIds: string[]` (default `[]`, ≥1 when composite), `itemCount: number` (default 1, only meaningful for equipment); `updateOfferingInput` hours branch accepts optional `componentIds`; `OfferingRow.kind`, `OfferingRow.componentIds: string[]`; `OfferingForm` prop `rooms: { id: string; name: string }[]`.

- [ ] **Step 1: Failing zod tests**

Append to `src/features/rentals/actions.test.ts` (it imports `offeringInput` from `./schema`; check the existing hours fixture object name and reuse it as `HOURS`):

```ts
describe("S6 offering kinds", () => {
  it("defaults to a plain space", () => {
    const r = offeringInput.safeParse(HOURS);
    expect(r.success && r.data.rangeMode === "hours" && r.data.kind).toBe("space");
  });
  it("a composite needs at least one included room and auto selection", () => {
    expect(offeringInput.safeParse({ ...HOURS, kind: "composite", componentIds: [] }).success).toBe(false);
    expect(offeringInput.safeParse({ ...HOURS, kind: "composite", componentIds: ["11111111-1111-4111-8111-111111111111"], unitSelection: "client_picks" }).success).toBe(false);
    expect(offeringInput.safeParse({ ...HOURS, kind: "composite", componentIds: ["11111111-1111-4111-8111-111111111111"] }).success).toBe(true);
  });
  it("equipment takes an item count 1–99 and no pricing rules", () => {
    expect(offeringInput.safeParse({ ...HOURS, kind: "equipment", itemCount: 3 }).success).toBe(true);
    expect(offeringInput.safeParse({ ...HOURS, kind: "equipment", itemCount: 0 }).success).toBe(false);
    expect(offeringInput.safeParse({ ...HOURS, kind: "equipment", pricing: HOURS_RULES }).success).toBe(false);   // HOURS_RULES = any valid PricingRules fixture in the file
  });
  it("nights/days spaces refuse a kind", () => {
    expect(offeringInput.safeParse({ ...NIGHTS, kind: "composite" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run src/features/rentals/actions.test.ts
```

- [ ] **Step 3: Schema**

In `schema.ts`, keep `hoursFields` as it is and add a create-only extension used by `hoursOffering` (the create branch of `offeringInput`):

```ts
// S6: create-only. `kind` is set once and never edited; the update schema
// below never sees these three keys (strict → a stray kind is refused).
const hoursCreateFields = hoursFields.extend({
  kind: z.enum(OFFERING_KINDS).default("space"),
  // composite: the hourly rooms it includes (≥ 1). Ignored otherwise.
  componentIds: z.array(z.uuid()).max(50).default([]),
  // equipment: how many physical items (units) to create. Ignored otherwise.
  itemCount: z.number().int().min(1).max(99).default(1),
});
```

`hoursOffering = offeringCommon.extend(hoursCreateFields.shape).strict()` with three more refinements after the existing ones:

```ts
  .refine((o) => o.kind !== "composite" || o.componentIds.length >= 1, { message: "a whole studio includes at least one room", path: ["componentIds"] })
  .refine((o) => o.kind === "space" || o.unitSelection === "auto", { message: "composites and equipment are auto-assigned", path: ["unitSelection"] })
  .refine((o) => o.kind !== "equipment" || o.pricing === null, { message: "equipment is priced by its flat price", path: ["pricing"] })
```

The hours branch of `updateOfferingInput` gains only `componentIds: z.array(z.uuid()).min(1).max(50).optional()` (a composite's settings save replaces its rooms; anything else omits the key). `OFFERING_KINDS` is imported from `./pricing-rules`.

- [ ] **Step 4: Actions**

`toOfferingSettingsRow` hours branch: add `kind: d.kind ?? "space"` (the update branch has it optional — but `kind` must never be written on update; so put `kind: d.kind` **only** in `toOfferingRow` (create), and strip it from the update path). Range branch: `kind: "space"`.

`createOffering`:
- after the offering insert, insert units: for `kind === "equipment"` insert `itemCount` units named `${name} 1..n` (the first one is the usual auto unit, so insert `itemCount - 1` extra rows after it, `sort_order` 1..n-1); the plan gate `assertCanAddUnit` is called once as today — call it once more per extra item? Keep it simple: call `assertCanAddUnit` once (the first unit) and let the cap apply publicly through `allowedUnitIds` (H5b already hides units over budget). Note this in the commit message.
- for `kind === "composite"`: insert `componentIds.map((component_id) => ({ composite_id: data.id, component_id, org_id: orgId }))` into `rental_offering_components`; on error, undo the offering (same undo block as the first unit) and `return fail("createOffering components", error)`.
- skip `seedDefaultHours` when `kind === "equipment"` (`if (parsed.data.rangeMode === "hours" && parsed.data.kind !== "equipment")`).

`updateOffering`: when the hours payload carries `componentIds` (composite edit): delete the offering's components and insert the new list (replace-all), after the settings update succeeds. Never write `kind`.

`createUnit`: before the insert, read the offering's kind (`select kind from rental_offerings where id = offeringId and org_id = orgId`); if `composite`, `return { ok: false, error: t("units.compositeHasOneUnit") }` (use the file's existing translated-error helper pattern; see how `fail`/`generic` produce copy).

- [ ] **Step 5: Queries**

`queries.ts`: add `kind` to `OFFERING_COLUMNS` and an embed `components:rental_offering_components!rental_offering_components_composite_id_fkey(component_id)` (the FK names are Postgres defaults from the `create table` in Task 1: `rental_offering_components_composite_id_fkey`). `OfferingDb.kind: OfferingKind; components: { component_id: string }[] | null`. `OfferingRow.kind`, `OfferingRow.componentIds = (o.components ?? []).map((c) => c.component_id)`. Verify the embed name against the live PostgREST instance in `queries.integration.test.ts` (that file already probes `rental_units(count)`; add a one-line probe that `getOffering(compositeId).componentIds` has length 2 for a composite created via the owner client).

- [ ] **Step 6: Form**

`offering-form.tsx`:
- prop `rooms: { id: string; name: string }[]` (hourly `kind === "space"` offerings of the org, excluding the offering itself).
- state `const [kind, setKind] = React.useState<OfferingKind>(offering?.kind ?? "space");`, `const [componentIds, setComponentIds] = React.useState<string[]>(offering?.componentIds ?? []);`.
- when `kind !== "space"`, force `rangeMode` to `"hours"` (`const effectiveRangeMode = kind === "space" ? rangeMode : "hours";` and use it everywhere `rangeMode` is read) and hide the "Booked by" select.
- create only (`!isEdit`): a segmented control above the Session heading:

```tsx
            {isEdit ? null : (
              <div className="flex flex-col gap-2">
                <Label>{t("form.kind.label")}</Label>
                <div role="radiogroup" className="grid grid-cols-3 gap-2">
                  {(["space", "composite", "equipment"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={kind === k}
                      onClick={() => setKind(k)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left text-sm",
                        kind === k ? "border-brand ring-brand/30 ring-2" : "border-border hover:bg-muted/40",
                      )}
                    >
                      <span className="font-medium">{t(`form.kind.${k}`)}</span>
                      <span className="text-muted-foreground text-xs">{t(`form.kind.${k}Hint`)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
```

- composite (create and edit): under the Session section, a checkbox list:

```tsx
            {kind === "composite" ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{t("form.includes")}</legend>
                {rooms.length === 0 ? <p className="text-muted-foreground text-xs">{t("form.includesEmpty")}</p> : null}
                {rooms.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={componentIds.includes(r.id)}
                      onChange={(e) => setComponentIds(e.target.checked ? [...componentIds, r.id] : componentIds.filter((id) => id !== r.id))}
                    />
                    {r.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
```

- equipment: render only name/description (create), the Price + Pricing-mode grid (with the `per_unit` option labelled `t("form.perHour")` and `flat` labelled `t("form.perBooking")`), and on create an `itemCount` number input (`name="itemCount"`, min 1, max 99, default 1, label `t("form.itemCount")`), plus the Active switch. Everything else (Session fields, PricingRulesEditor, approval, the `<details>` rules block, unitSelection select) is not rendered for equipment; the payload fills their defaults:

```ts
    const payload = kind === "equipment"
      ? {
          ...common,
          rangeMode: "hours" as const, kind,
          slotIncrementMin: OFFERING_DEFAULTS.hours.slotIncrementMin,
          minDurationMin: OFFERING_DEFAULTS.hours.minDurationMin,
          maxDurationMin: OFFERING_DEFAULTS.hours.maxDurationMin,
          turnoverMin: 0, minNoticeMin: 0, pricing: null,
          requiresApproval: false, depositType: "none" as const, depositValue: null, cancelPolicy: [], termsText: undefined,
          bookingWindowDays: 180, unitSelection: "auto" as const,
          itemCount: Number(fd.get("itemCount") ?? 1),
        }
      : effectiveRangeMode === "hours"
        ? { ...common, rangeMode: "hours" as const, kind, componentIds: kind === "composite" ? componentIds : [], /* existing hours fields */ ...(kind !== "space" ? { unitSelection: "auto" as const } : {}) }
        : { /* existing range payload */ };
```

  On edit, omit `kind` and `itemCount` from the payload (the update schema refuses unknown keys); keep `componentIds` for composites.

- composite validation on submit: `if (kind === "composite" && componentIds.length === 0) { toast.error(t("form.includesRequired")); return; }`.

- [ ] **Step 7: Pages, chips, guards**

- `/rentals/new/page.tsx`: load `listOfferings()`, pass `rooms={offerings.filter((o) => o.rangeMode === "hours" && o.kind === "space").map(({ id, name }) => ({ id, name }))}`.
- `/rentals/[id]/page.tsx`: same, excluding the offering itself; render `UnitsEditor` only when `offering.kind !== "composite"`; hide the `splitIntoUnits` prompt for composites.
- `space-header.tsx` / `offerings-list.tsx`: next to the existing badge, when `kind === "composite"` show `t("chip.includes", { count: offering.componentIds.length })`, when `equipment` show `t("chip.addon")`.
- The admin new-booking surface (`space-booking-form.tsx` and/or the page feeding it, and `move-rental-dialog.tsx` if it lists offerings): filter `kind !== "equipment"` out of the offering choices.

- [ ] **Step 8: Copy in all three locales** (`spaces` namespace)

`form.kind.label` ("What is it?"), `form.kind.space` ("Room"), `form.kind.spaceHint` ("A room or item clients book on its own"), `form.kind.composite` ("Whole studio"), `form.kind.compositeHint` ("Books several rooms at once and blocks them all"), `form.kind.equipment` ("Equipment"), `form.kind.equipmentHint` ("Added to a room booking; one item can't be in two rooms"), `form.includes` ("Includes"), `form.includesEmpty` ("Create at least one hourly room first."), `form.includesRequired` ("Pick at least one room to include."), `form.itemCount` ("How many items"), `form.perBooking` ("Per booking"), `chip.includes` ("Includes {count, plural, one {# room} other {# rooms}}"), `chip.addon` ("Add-on"), `units.compositeHasOneUnit` ("A whole studio is one unit — split its rooms instead."). Polish and Ukrainian translations for each; pluralisation with ICU `plural` in all three (uk needs `one/few/many/other`).

- [ ] **Step 9: Run**

```bash
npm run verify && npx vitest run --config vitest.integration.config.ts src/features/rentals/queries.integration.test.ts
```

Expected: green.

- [ ] **Step 10: Commit**

```bash
git add src/features/rentals src/app/\(dashboard\)/rentals messages
git commit -m "feat(rentals): whole-studio + equipment spaces in the admin (S6)"
```

---

### Task 7: Timeline placements and "Also reserved"

**Files:**
- Modify: `src/features/rentals/queries.ts` (`listTimelineData`), `src/features/rentals/components/timeline.tsx`, `src/features/rentals/components/timeline-lane.tsx`, `src/features/payments/actions.ts` (`loadBookingSettlement`), `src/features/scheduling/components/booking-detail-dialog.tsx`, `src/app/booking/[token]/page.tsx`, `messages/{en,pl,uk}.json`
- Test: `src/features/rentals/queries.integration.test.ts` (append), `src/features/rentals/pan.test.ts` or a new `timeline-placements.test.ts` for the pure grouping helper

**Interfaces:**
- Consumes: `booking_units` (Task 1).
- Produces: `listTimelineData` returns `placements: { bookingId: string; unitId: string; kind: "component" | "equipment" }[]`; pure helper `staysByLane(bookings: AdminBooking[], placements): Map<string, AdminBooking[]>` in `timeline.tsx` (exported for the test); `loadBookingSettlement` result gains `alsoReserved: string[]`.

- [ ] **Step 1: Failing unit test for the grouping**

Create `src/features/rentals/timeline-placements.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { staysByLane } from "./components/timeline";
import type { AdminBooking } from "@/features/scheduling/queries";

const b = (id: string, unit: string) => ({ id, rentalUnitId: unit } as unknown as AdminBooking);

describe("staysByLane (S6)", () => {
  it("puts a booking on its primary lane and on every placement lane", () => {
    const m = staysByLane([b("w", "whole"), b("a", "roomA")], [
      { bookingId: "w", unitId: "roomA", kind: "component" },
      { bookingId: "w", unitId: "roomB", kind: "component" },
      { bookingId: "a", unitId: "lamp1", kind: "equipment" },
    ]);
    expect(m.get("whole")!.map((x) => x.id)).toEqual(["w"]);
    expect(m.get("roomA")!.map((x) => x.id).sort()).toEqual(["a", "w"]);
    expect(m.get("roomB")!.map((x) => x.id)).toEqual(["w"]);
    expect(m.get("lamp1")!.map((x) => x.id)).toEqual(["a"]);
  });
  it("ignores placements whose booking is not in the feed", () => {
    expect(staysByLane([], [{ bookingId: "x", unitId: "u", kind: "component" }]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failure** (`staysByLane` not exported).

- [ ] **Step 3: Query**

In `listTimelineData`, alongside the bookings query add:

```ts
    supabase
      .from("booking_units")
      .select("booking_id, rental_unit_id, kind")
      .eq("reserving", true)
      .neq("kind", "primary")
      .lt("starts_at", toIso)
      .gt("ends_at", fromIso),
```

and return `placements: (placementsRes.data ?? []).filter((p) => keptUnitIds.has(p.rental_unit_id)).map((p) => ({ bookingId: p.booking_id, unitId: p.rental_unit_id, kind: p.kind as "component" | "equipment" }))`. Extend the return type. The `bookedUnitIds` set used to keep inactive-but-booked units should also include placement unit ids.

- [ ] **Step 4: Timeline**

`timeline.tsx`: add prop `placements` (threaded from `bookings/page.tsx`, which spreads `listTimelineData`'s result), export:

```ts
export function staysByLane(
  bookings: AdminBooking[],
  placements: { bookingId: string; unitId: string; kind: "component" | "equipment" }[],
): Map<string, AdminBooking[]> {
  const byId = new Map(bookings.map((b) => [b.id, b]));
  const out = new Map<string, AdminBooking[]>();
  const push = (unitId: string, b: AdminBooking) => {
    const list = out.get(unitId) ?? [];
    if (!list.some((x) => x.id === b.id)) list.push(b);
    out.set(unitId, list);
  };
  for (const b of bookings) if (b.rentalUnitId !== null) push(b.rentalUnitId, b);
  for (const p of placements) { const b = byId.get(p.bookingId); if (b) push(p.unitId, b); }
  return out;
}
```

and replace the `staysByUnit` memo's `groupBy(...)` with `staysByLane(filteredBookings, placements)` (keep the existing `isExpiredRequest` filter on `bookings` first). Pass `ghostIds` to each `TimelineLane`: `new Set(placements.filter((p) => p.unitId === unit.id).map((p) => p.bookingId))`.

`timeline-lane.tsx`: new optional prop `ghostIds?: Set<string>`; where `StayBar` / the hourly chip is rendered for a stay `b`, add `className={cn(…existing…, ghostIds?.has(b.id) && "border-dashed opacity-70")}` and `title` prefixed with the booking's `serviceName` (so a room lane reads "Whole studio · Client"). Clicking still calls `onSelect(b)`. Conflict detection input (`perOffering`/`conflicts`) keeps using the primary-only grouping it uses today — placements never overlap a lane's own stays (the EXCLUDE forbids it).

- [ ] **Step 5: "Also reserved"**

`payments/actions.ts` `loadBookingSettlement`: after loading the booking, `const { data: also } = await supabase.from("booking_units").select("kind, rental_units(name)").eq("booking_id", id).neq("kind", "primary");` and return `alsoReserved: (also ?? []).map((r) => (r.rental_units as { name: string } | null)?.name).filter((n): n is string => !!n)`. Extend the `ok: true` type.

`booking-detail-dialog.tsx`: where the settlement result is rendered for rentals, add `{settlement.alsoReserved.length > 0 ? <p className="text-muted-foreground text-xs">{t("alsoReserved", { names: settlement.alsoReserved.join(", ") })}</p> : null}` under the title.

`app/booking/[token]/page.tsx`: the manage page resolves the booking through a token (server); add one admin-client select of `booking_units(kind, rental_units(name))` for `b.id` (a small helper `listBookingAlsoReserved(bookingId)` in `lib/booking/public.ts` beside `getBookingUnitName`) and render the same line under `b.serviceName` with `t("alsoReserved", { names })` from the `public.confirmed`/manage namespace the page already uses.

Copy: `bookings.alsoReserved` and `public.manage.alsoReserved` (or the namespace the manage page uses) = "Also reserved: {names}" / "Zarezerwowane również: {names}" / "Також заброньовано: {names}".

- [ ] **Step 6: Run**

```bash
npm run verify && npx vitest run --config vitest.integration.config.ts src/features/rentals/queries.integration.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/features/rentals src/features/payments/actions.ts src/features/scheduling/components/booking-detail-dialog.tsx src/app/booking src/lib/booking/public.ts messages
git commit -m "feat(rentals): timeline placements for compound bookings, also-reserved line (S6)"
```

---

### Task 8: Browser QA script, full verification, graph update, notes

**Files:**
- Create: `scripts/qa-s6-compound.mjs`
- Modify: memory notes (outside the repo), `graphify-out/` via `graphify update .`

- [ ] **Step 1: QA script**

Follow the house recipe (`browser-qa-localhost-lesson`: drive `http://localhost:3000`, never 127.0.0.1; Playwright from the npx cache; the demo org already in Spaces mode). Script outline, each step asserting visible text:

1. Sign in as the demo owner; `/rentals/new` → kind "Whole studio", name "Whole studio", include both existing hourly rooms, price 250, create. Expect the list to show "Includes 2 rooms".
2. `/rentals/new` → kind "Equipment", name "ARRI lamp", price 50 per hour, 2 items, create. Expect "Add-on" chip; the public page `/<handle>` must NOT list "ARRI lamp".
3. Public flow: open the whole studio, pick a slot, book. Then `/bookings?view=timeline`: the booking appears on the Whole studio lane and, dashed, on both room lanes.
4. Public flow: open Room A at another hour; add-on step shows "ARRI lamp · 2 available"; pick 2; confirm; the total shows room + 2 × lamp × hours. Then open Room B for the same hour: the lamp row shows "none left at this time" and its + button is disabled.
5. Manage page (from the booking mail / token in the DB): "Also reserved" not shown for a room booking without components; for the whole-studio booking it lists both rooms.
6. Reschedule the lamp booking to a free hour via the manage page; the new booking still lists the equipment line.
7. Cancel the whole-studio booking; re-book Room A at that hour succeeds.

Print `PASS n/7`.

- [ ] **Step 2: Run everything**

```bash
npm run verify && npm run test:integration && node scripts/qa-s6-compound.mjs
```

Expected: all green, QA 7/7. Fix anything that fails before moving on; do not skip.

- [ ] **Step 3: Graph + memory**

```bash
graphify update .
```

Update the memory index with an `s6-compound-resources-notes.md` entry (status, migration 0084 → next free 0085, one-window deploy, rulings, deviations: admin `p_equipment` deferred, equipment reset-on-slot-change, cap gate once per space; deferred list from the spec).

- [ ] **Step 4: Commit and open the PR**

```bash
git add scripts/qa-s6-compound.mjs graphify-out
git commit -m "chore(qa): S6 compound resources browser QA script"
git push -u origin feat/s6-compound-resources
gh pr create --title "feat(rentals): compound resources — whole studio + shared equipment (S6)" --body "$(cat <<'EOF'
Whole-studio composites block every included room; equipment spaces attach to a room booking as exclusive add-ons. One occupancy row per booking × unit (`booking_units`) with its own EXCLUDE, trigger-maintained; hours RPCs carry equipment; availability reads and the timeline read `booking_units`.

Spec: docs/superpowers/specs/2026-09-08-s6-compound-resources-design.md
Plan: docs/superpowers/plans/2026-09-08-s6-compound-resources.md

Migration 0084 (next free 0085). `create_rental_booking_hours` changes signature → one-window deploy.

Deviations: admin RPC does not take equipment picks yet (no admin UI offers them); the widget resets equipment picks on a slot change instead of re-capping.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
EOF
)"
```

---

## Self-review notes

- **Spec coverage:** data model (T1), trigger + backfill (T1), free-checks + scope (T1), equipment lines SQL/TS + parity (T2/T3), create/admin/reschedule RPCs (T3), availability reads + composite union + `alsoBusyUnitIds` + equipment availability + catalogue filter (T4), widget add-ons + reschedule panels (T5), admin form/kinds/components/items/chips/`createUnit` guard/no hours seed (T6), timeline placements + also-reserved (T7), i18n (T5–T7), tests (all), QA + deploy note + deferred (T8).
- **Deviations recorded:** admin `p_equipment` deferred; equipment picks reset on slot change; `assertCanAddUnit` runs once per new equipment space (public cap still applies through `allowedUnitIds`).
- **Type consistency:** `EquipmentPick { offeringId, qty }` everywhere (zod, TS mirror, SQL JSON keys); `Line.kind = "equipment"` carries `offeringId`; `PublicEquipment = EquipmentOffering & { units }`; `placements[].kind ∈ component|equipment`.
