# Team (multi-staff) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org have several bookable staff members — each with their own availability, services and booking link — while a single-staff org keeps today's solo experience byte-for-byte.

**Architecture:** New `staff` + `service_staff` tables; `staff_id NOT NULL` on `availability_rules`, `availability_exceptions` and appointment `bookings` (0040 drizzle-generated columns/tables, 0041 custom SQL: backfill, guards re-keyed to staff, RLS, triggers, RPCs). The pure slot engine is unchanged (it already models one calendar); a `unionSlots` helper merges per-staff results for "Anyone available", and the DB assigns the staff (`pick_staff_for_slot`) inside `create_booking`. Public pages gain a staff step (only when >1 eligible) and a per-staff route `/book/[handle]/[staffSlug]`; admin gains a Team page, a staff selector on Availability, a staff checklist on Services, and a staff filter + colours on the calendar. Every UI reads `staff.length > 1` to decide whether the staff layer is visible.

**Tech Stack:** Next.js App Router (newer than training data — check `node_modules/next/dist/docs/` on surprises), Base UI (`@base-ui/react`, NOT Radix), Supabase (supabase-js in app; Drizzle only for migrations), Vitest, Tailwind, Hugeicons, sonner.

**Spec:** `docs/superpowers/specs/2026-08-17-team-staff-design.md`

## Global Constraints

- Branch `worktree-rentals-r3`, worktree `/Users/andriishcherbiak/Pet projects/pipline-app/.claude/worktrees/rentals-r2` (base `23512ec`, last migration `0039`). Run everything there; never `cd` to the main checkout. Local Supabase stack is shared with other sessions: never `supabase db reset` / `npm run db:reset`; never kill a dev server you didn't start.
- Commands: `npm run verify` (lint+typecheck+unit), `npm run build`, `npm run test:integration` (needs stack; `npm run db:migrate` first), single file `npx vitest run <path>` / `npx vitest run --config vitest.integration.config.ts <path>`. Generated migration: `npx drizzle-kit generate` (after editing `src/db/schema/*.ts`), custom: `npx drizzle-kit generate --custom --name=<name>`. If a custom migration file must be re-applied locally after editing, run it via the `postgres` package (`npx --yes tsx -e` script reading `DATABASE_URL` from `.env.local`) — write custom SQL idempotently (`create or replace`, `drop … if exists`, `if not exists`).
- Rentals are parked (`RENTALS_ENABLED=false` in `src/lib/flags.ts`) — never touch rental tables/RPCs/guards; `bookings.staff_id` is null on rental rows.
- Integration test header/`signedInUser` helper: copy verbatim from `src/features/scheduling/admin-booking-rpc.integration.test.ts` (loadEnvFile in try/catch, admin + anon clients, `generateAccessToken` from `@/lib/tokens/mint`). Dates relative to today via `addDaysISO(dateInZone(new Date(), TZ), n)` from `@/features/scheduling/slots`.
- Vitest picks up `*.test.ts` only (no component tests). Pure logic goes in `.ts` modules with tests; components verified by typecheck + manual smoke (Playwright MCP available; sign in `demo@rolloutos.local` / `Password123!`; demo org handle `demo-studio`).
- RLS/definer conventions: authenticated definer RPCs check `org_id in (select public.user_orgs())` inside; anon RPCs are handle/token-scoped; `revoke all … from public, anon, authenticated, service_role` then grant to exactly one role; `security definer set search_path = ''`. Uniform `'not found'` for bad input. New distinct raises in this slice: `'staff_unavailable'`, `'taken'`, `'last_active_staff'`, `'has_future_bookings'`.
- **Solo rule:** every surface decides staff-layer visibility from the count of *active* staff (`> 1` ⇒ show). No flag, no mode column.
- Server actions: `"use server"` files export only async functions. Actions validate with zod schemas from `src/features/scheduling/schema.ts`; direct table writes go through the RLS client (`createClient` from `@/lib/supabase/server`) and add explicit `.eq("org_id", orgId)` on updates/deletes.
- The spec's `0040_staff.sql` is split per repo convention into `0040_<drizzle-name>.sql` (generated: tables + nullable columns) and `0041_staff_security.sql` (custom: everything else). The parked R3 spec's `0040_org_modes.sql` renumbers to `0042` when un-parked.
- Commit after every task, conventional message ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- After the last task, run `graphify update .` (project rule).

---

### Task 1: Drizzle schema + generated migration 0040 (tables + nullable columns)

**Files:**
- Modify: `src/db/schema/scheduling.ts`
- Create (generated): `src/db/migrations/0040_*.sql`, `src/db/migrations/meta/0040_snapshot.json`, journal entry

**Interfaces (Produces):**
- Tables `public.staff`, `public.service_staff`; nullable columns `availability_rules.staff_id`, `availability_exceptions.staff_id`, `bookings.staff_id` (made NOT NULL / CHECKed in Task 2).

- [ ] **Step 1: Add the Drizzle definitions** — in `src/db/schema/scheduling.ts`, above `services`, add:

```ts
// Team slice (2026-08-17 spec): a bookable person. Every org has ≥1 row (the
// creator's, seeded by create_org / backfilled by 0041). Solo = exactly one
// active row — every UI hides the staff layer at that count. CHECKs, RLS,
// grants, triggers, guard rebuilds and RPCs live in 0041 (0037 idiom).
export const staff = pgTable(
  "staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Public URL segment: /book/[handle]/[slug]. Format CHECK in 0041.
    slug: text("slug").notNull(),
    // Optional; only for staff notices. Never exposed to anon.
    email: text("email"),
    // Hex "#rrggbb" — CHECK in 0041. Calendar/event accent.
    color: text("color").notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    // Reserved for the staff-login slice; unused here. References auth.users.
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("staff_org_id_idx").on(t.orgId),
    index("staff_org_active_sort_idx").on(t.orgId, t.active, t.sortOrder),
    uniqueIndex("staff_org_slug_uq").on(t.orgId, t.slug),
    uniqueIndex("staff_user_id_uq").on(t.userId),
  ],
);

// Which staff offer which service. All-assigned by default (actions fan out
// on create in both directions). Org-consistency trigger in 0041.
export const serviceStaff = pgTable(
  "service_staff",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.serviceId, t.staffId] }),
    index("service_staff_staff_id_idx").on(t.staffId),
    index("service_staff_org_id_idx").on(t.orgId),
  ],
);
```

  Add `primaryKey` to the `drizzle-orm/pg-core` import. Note `serviceStaff` references `services`, so place it *after* `services` in the file (declaration order matters for `references(() => …)` only at runtime — keep `staff` above `services` and `serviceStaff` below `services`).

  Then add to `availabilityRules` and `availabilityExceptions` (after `orgId`):
```ts
    // Team slice: nullable in 0040, backfilled + NOT NULL in 0041.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
```
  and to `bookings` (after `rentalUnitId`):
```ts
    // Team slice: set iff service_id is set (CHECK bookings_staff_iff_service,
    // 0041). Restrict: a staff row with history can only be deactivated.
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "restrict" }),
```
  Add indexes: `index("availability_rules_staff_weekday_idx").on(t.staffId, t.weekday)`, `index("availability_exceptions_staff_date_idx").on(t.staffId, t.date)`, `index("bookings_staff_starts_at_idx").on(t.staffId, t.startsAt)`.

- [ ] **Step 2: Export from the schema index** — check `src/db/schema/index.ts` re-exports `./scheduling` (it does via `export *`); nothing to add if so.

- [ ] **Step 3: Generate + apply**

Run: `npx drizzle-kit generate` → expect `src/db/migrations/0040_<name>.sql` creating `staff`, `service_staff`, the three `staff_id` columns, FKs and indexes. Inspect it: no drops, no unexpected diffs. Then `npm run db:migrate`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema/scheduling.ts src/db/migrations
git commit -m "feat(team): staff + service_staff tables, nullable staff_id columns (0040)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0041 — backfill, guards, RLS, triggers, `create_org`, `create_staff` (integration TDD)

**Files:**
- Create: `src/db/migrations/0041_staff_security.sql` (`npx drizzle-kit generate --custom --name=staff_security`), `src/features/scheduling/staff-rls.integration.test.ts`

**Interfaces (Produces):**
- Every org has ≥1 `staff` row; `availability_rules.staff_id`, `availability_exceptions.staff_id` NOT NULL; `bookings_staff_iff_service` CHECK; EXCLUDE guards keyed by `staff_id`.
- RPC `public.create_staff(p_org_id uuid, p_name text, p_slug text, p_email text, p_color text, p_service_ids uuid[]) returns uuid` (authenticated).
- Trigger errors `'last_active_staff'`, `'has_future_bookings'`.

- [ ] **Step 1: Write the failing integration test** — `src/features/scheduling/staff-rls.integration.test.ts` (header + `signedInUser` copied verbatim from `admin-booking-rpc.integration.test.ts`):

```ts
const TZ = "Europe/Berlin";
let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let defaultStaffId: string;
let serviceId: string;

describe("staff: seed, RLS, triggers, create_staff", () => {
  beforeAll(async () => {
    owner = await signedInUser("staff_owner");
    stranger = await signedInUser("staff_stranger");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Team Co" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    await stranger.rpc("create_org", { p_name: "Other Co" });
    const { data: st } = await admin.from("staff").select("id, name, slug, active").eq("org_id", orgId);
    expect(st).toHaveLength(1);
    expect(st![0].slug).toBe("team-co");
    defaultStaffId = st![0].id;
    const { data: svc, error: e2 } = await owner
      .from("services").insert({ org_id: orgId, name: "Cut", duration_min: 30 }).select("id").single();
    if (e2) throw e2;
    serviceId = svc.id;
  });

  it("create_org seeds one staff row named after the org", async () => {
    const { data } = await admin.from("staff").select("name").eq("id", defaultStaffId).single();
    expect(data!.name).toBe("Team Co");
  });

  it("anon cannot read staff or service_staff", async () => {
    const { data, error } = await anon.from("staff").select("id").eq("org_id", orgId);
    expect(error ?? data?.length === 0).toBeTruthy();
    const { data: d2, error: e2 } = await anon.from("service_staff").select("service_id");
    expect(e2 ?? d2?.length === 0).toBeTruthy();
  });

  it("member of another org cannot see or update staff", async () => {
    const { data } = await stranger.from("staff").select("id").eq("org_id", orgId);
    expect(data).toEqual([]);
    const { data: upd } = await stranger.from("staff").update({ name: "x" }).eq("id", defaultStaffId).select("id");
    expect(upd).toEqual([]);
  });

  it("availability_rules require staff_id (NOT NULL) and staff must belong to the org", async () => {
    const { error } = await owner.from("availability_rules")
      .insert({ org_id: orgId, weekday: 1, start_time: "09:00", end_time: "12:00" });
    expect(error?.code).toBe("23502");
    const { data: sst } = await admin.from("staff").select("id").neq("org_id", orgId).limit(1).single();
    const { error: e2 } = await owner.from("availability_rules")
      .insert({ org_id: orgId, staff_id: sst!.id, weekday: 1, start_time: "09:00", end_time: "12:00" });
    expect(e2).toBeTruthy(); // org mismatch trigger
    const { error: e3 } = await owner.from("availability_rules")
      .insert({ org_id: orgId, staff_id: defaultStaffId, weekday: 1, start_time: "09:00", end_time: "12:00" });
    expect(e3).toBeNull();
  });

  it("create_staff copies the first active staff's rules and fans out services", async () => {
    const { data: id, error } = await owner.rpc("create_staff", {
      p_org_id: orgId, p_name: "Anna", p_slug: "anna", p_email: "anna@example.com",
      p_color: "#4f46e5", p_service_ids: [serviceId],
    });
    expect(error).toBeNull();
    const { data: rules } = await admin.from("availability_rules").select("weekday").eq("staff_id", id as string);
    expect(rules).toEqual([{ weekday: 1 }]);
    const { data: ss } = await admin.from("service_staff").select("staff_id").eq("service_id", serviceId);
    expect(ss!.map((r) => r.staff_id).sort()).toEqual([defaultStaffId, id as string].sort());
  });

  it("stranger cannot create staff in the org", async () => {
    const { error } = await stranger.rpc("create_staff", {
      p_org_id: orgId, p_name: "Evil", p_slug: "evil", p_email: null, p_color: "#000000", p_service_ids: [],
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("deactivating the last active staff is refused", async () => {
    // Anna exists (active) → deactivate her fine, then default refuses.
    const { data: anna } = await admin.from("staff").select("id").eq("org_id", orgId).eq("slug", "anna").single();
    const { error: ok } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(ok).toBeNull();
    const { error } = await owner.from("staff").update({ active: false }).eq("id", defaultStaffId);
    expect(error?.message).toMatch(/last_active_staff/);
    await owner.from("staff").update({ active: true }).eq("id", anna!.id);
  });

  it("deactivating staff with a confirmed future booking is refused; past-only is fine", async () => {
    const { data: anna } = await admin.from("staff").select("id").eq("org_id", orgId).eq("slug", "anna").single();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { error: ins } = await admin.from("bookings").insert({
      org_id: orgId, service_id: serviceId, staff_id: anna!.id, client_name: "C", client_email: "c@example.com",
      starts_at: future, ends_at: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
      status: "confirmed", cancel_token_hash: "a".repeat(64),
    });
    expect(ins).toBeNull();
    const { error } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(error?.message).toMatch(/has_future_bookings/);
    await admin.from("bookings").update({ status: "cancelled_by_provider" }).eq("staff_id", anna!.id);
    const { error: ok } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(ok).toBeNull();
  });

  it("appointment bookings need staff_id; rental-shaped rows must not have one (CHECK)", async () => {
    const future = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const { error } = await admin.from("bookings").insert({
      org_id: orgId, service_id: serviceId, client_name: "C", starts_at: future,
      ends_at: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
      status: "confirmed", cancel_token_hash: "b".repeat(64),
    });
    expect(error?.code).toBe("23514");
  });

  it("guard is per staff: two staff can hold the same slot; one staff cannot", async () => {
    const { data: anna } = await admin.from("staff").select("id").eq("org_id", orgId).eq("slug", "anna").single();
    await owner.from("staff").update({ active: true }).eq("id", anna!.id);
    const s = new Date(Date.now() + 5 * 86_400_000); s.setUTCMinutes(0, 0, 0);
    const e = new Date(s.getTime() + 30 * 60_000);
    const row = (staffId: string, hash: string) => ({
      org_id: orgId, service_id: serviceId, staff_id: staffId, client_name: "C",
      starts_at: s.toISOString(), ends_at: e.toISOString(), status: "confirmed", cancel_token_hash: hash,
    });
    expect((await admin.from("bookings").insert(row(defaultStaffId, "c".repeat(64)))).error).toBeNull();
    expect((await admin.from("bookings").insert(row(anna!.id, "d".repeat(64)))).error).toBeNull();
    expect((await admin.from("bookings").insert(row(anna!.id, "e".repeat(64)))).error?.code).toBe("23P01");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts src/features/scheduling/staff-rls.integration.test.ts` → FAIL (no staff row seeded / `create_staff` missing).

- [ ] **Step 3: Write `0041_staff_security.sql`** (`npx drizzle-kit generate --custom --name=staff_security`, then fill):

```sql
-- 0041 (Team): staff becomes the calendar owner. Backfill one staff per org,
-- re-key availability + appointment bookings + all EXCLUDE guards to
-- staff_id, RLS/grants for the two new tables, org-consistency + offboarding
-- triggers, create_org seeds the first staff, create_staff copies a schedule.
-- RPC changes for booking/reschedule live in 0041 too (below, Task 3/4).

-- ---------- CHECKs
alter table public.staff drop constraint if exists staff_name_len;
alter table public.staff add constraint staff_name_len check (length(name) between 1 and 80);
alter table public.staff drop constraint if exists staff_slug_format;
alter table public.staff add constraint staff_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or slug ~ '^[a-z0-9]{2}$');
alter table public.staff drop constraint if exists staff_color_hex;
alter table public.staff add constraint staff_color_hex check (color ~ '^#[0-9a-f]{6}$');
alter table public.staff drop constraint if exists staff_email_lower;
alter table public.staff add constraint staff_email_lower check (email is null or (email = lower(email) and length(email) <= 320));

-- ---------- Backfill: one staff per org, everything re-pointed.
insert into public.staff (org_id, name, slug, color, sort_order)
select o.id, o.name,
       coalesce(nullif(trim(both '-' from left(trim(both '-' from regexp_replace(lower(o.name), '[^a-z0-9]+', '-', 'g')), 40)), ''), 'team-member'),
       '#4f46e5', 0
from public.orgs o
where not exists (select 1 from public.staff s where s.org_id = o.id);
-- Slugs shorter than 2 chars violate the CHECK; pad them.
update public.staff set slug = slug || '-1' where length(slug) < 2;

update public.availability_rules r set staff_id = s.id
  from public.staff s where s.org_id = r.org_id and r.staff_id is null;
update public.availability_exceptions e set staff_id = s.id
  from public.staff s where s.org_id = e.org_id and e.staff_id is null;
update public.bookings b set staff_id = s.id
  from public.staff s where s.org_id = b.org_id and b.staff_id is null and b.service_id is not null;
insert into public.service_staff (org_id, service_id, staff_id)
select sv.org_id, sv.id, st.id from public.services sv join public.staff st on st.org_id = sv.org_id
on conflict do nothing;

alter table public.availability_rules alter column staff_id set not null;
alter table public.availability_exceptions alter column staff_id set not null;
alter table public.bookings drop constraint if exists bookings_staff_iff_service;
alter table public.bookings add constraint bookings_staff_iff_service
  check ((service_id is null) = (staff_id is null));

-- ---------- Guards re-keyed to staff (0026/0035/0037 shapes, org_id → staff_id)
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'confirmed' and staff_id is not null);
alter table public.availability_rules drop constraint if exists availability_rules_no_overlap;
alter table public.availability_rules add constraint availability_rules_no_overlap
  exclude using gist (staff_id with =, weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&);
alter table public.availability_exceptions drop constraint if exists availability_exceptions_no_overlap;
alter table public.availability_exceptions add constraint availability_exceptions_no_overlap
  exclude using gist (staff_id with =, date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (not closed);

-- ---------- RLS + grants (0026 doctrine)
alter table public.staff enable row level security;
alter table public.service_staff enable row level security;
drop policy if exists "staff_select_member" on public.staff;
create policy "staff_select_member" on public.staff
  for select to authenticated using (org_id in (select public.user_orgs()));
drop policy if exists "staff_insert_member" on public.staff;
create policy "staff_insert_member" on public.staff
  for insert to authenticated with check (org_id in (select public.user_orgs()));
drop policy if exists "staff_update_member" on public.staff;
create policy "staff_update_member" on public.staff
  for update to authenticated
  using (org_id in (select public.user_orgs())) with check (org_id in (select public.user_orgs()));
-- no delete policy: staff rows are history (deactivate instead)
drop policy if exists "service_staff_select_member" on public.service_staff;
create policy "service_staff_select_member" on public.service_staff
  for select to authenticated using (org_id in (select public.user_orgs()));
drop policy if exists "service_staff_insert_member" on public.service_staff;
create policy "service_staff_insert_member" on public.service_staff
  for insert to authenticated with check (org_id in (select public.user_orgs()));
drop policy if exists "service_staff_delete_member" on public.service_staff;
create policy "service_staff_delete_member" on public.service_staff
  for delete to authenticated using (org_id in (select public.user_orgs()));

revoke all on table public.staff from public, anon, authenticated, service_role;
grant select, insert, update on table public.staff to authenticated;
grant select, insert, update on table public.staff to service_role;
revoke all on table public.service_staff from public, anon, authenticated, service_role;
grant select, insert, delete on table public.service_staff to authenticated;
grant select, insert, delete on table public.service_staff to service_role;

-- ---------- Org-consistency triggers (check_booking_org idiom)
create or replace function public.check_staff_owner_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.staff where id = new.staff_id;
  if v_org is null then raise exception 'staff not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
drop trigger if exists availability_rules_staff_guard on public.availability_rules;
create trigger availability_rules_staff_guard
  before insert or update of org_id, staff_id on public.availability_rules
  for each row execute function public.check_staff_owner_org();
drop trigger if exists availability_exceptions_staff_guard on public.availability_exceptions;
create trigger availability_exceptions_staff_guard
  before insert or update of org_id, staff_id on public.availability_exceptions
  for each row execute function public.check_staff_owner_org();

create or replace function public.check_service_staff_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.services where id = new.service_id;
  if v_org is null or v_org <> new.org_id then raise exception 'org mismatch'; end if;
  select org_id into v_org from public.staff where id = new.staff_id;
  if v_org is null or v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
drop trigger if exists service_staff_org_guard on public.service_staff;
create trigger service_staff_org_guard
  before insert or update on public.service_staff
  for each row execute function public.check_service_staff_org();

-- bookings: extend 0037's check_booking_org with the staff check.
create or replace function public.check_booking_org()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_org uuid;
  v_offering uuid;
begin
  if new.service_id is not null then
    select org_id into v_org from public.services where id = new.service_id;
    if v_org is null then raise exception 'service not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.staff_id is not null then
    select org_id into v_org from public.staff where id = new.staff_id;
    if v_org is null then raise exception 'staff not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.rental_offering_id is not null then
    select org_id into v_org from public.rental_offerings where id = new.rental_offering_id;
    if v_org is null then raise exception 'offering not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
    select org_id, offering_id into v_org, v_offering from public.rental_units where id = new.rental_unit_id;
    if v_org is null then raise exception 'unit not found'; end if;
    if v_org <> new.org_id or v_offering <> new.rental_offering_id then raise exception 'org mismatch'; end if;
  end if;
  if new.client_id is not null then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  if new.rescheduled_from_id is not null then
    select org_id into v_org from public.bookings where id = new.rescheduled_from_id;
    if v_org is null then raise exception 'booking not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists bookings_org_guard on public.bookings;
create trigger bookings_org_guard
  before insert or update of org_id, service_id, staff_id, client_id, rescheduled_from_id,
    rental_offering_id, rental_unit_id
  on public.bookings
  for each row execute function public.check_booking_org();

-- ---------- Offboarding guard + immutable columns
create or replace function public.staff_guard_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id <> old.org_id then raise exception 'org mismatch'; end if;
  if new.user_id is distinct from old.user_id and old.user_id is not null then
    raise exception 'user_id immutable';
  end if;
  if old.active and not new.active then
    if not exists (select 1 from public.staff s where s.org_id = old.org_id and s.active and s.id <> old.id) then
      raise exception 'last_active_staff';
    end if;
    if exists (select 1 from public.bookings b where b.staff_id = old.id and b.status = 'confirmed' and b.starts_at > now()) then
      raise exception 'has_future_bookings';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists staff_guard_update on public.staff;
create trigger staff_guard_update before update on public.staff
  for each row execute function public.staff_guard_update();

-- ---------- create_org seeds the first staff row (0001 body + one insert)
create or replace function public.create_org(p_name text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
  v_slug text;
  v_staff_slug text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_staff_slug := trim(both '-' from left(v_slug, 40));
  if length(v_staff_slug) < 2 then v_staff_slug := v_staff_slug || '-1'; end if;
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  insert into public.orgs (name, slug) values (trim(p_name), v_slug) returning * into v_org;
  insert into public.org_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  insert into public.staff (org_id, name, slug, color, sort_order)
    values (v_org.id, trim(p_name), v_staff_slug, '#4f46e5', 0);
  return v_org;
end; $$;
grant execute on function public.create_org(text) to authenticated;

-- ---------- create_staff: row + copy first active staff's schedule + fan-out
create or replace function public.create_staff(
  p_org_id uuid, p_name text, p_slug text, p_email text, p_color text, p_service_ids uuid[]
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_source uuid;
  v_max_sort int;
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then raise exception 'not found'; end if;
  select s.id into v_source from public.staff s
    where s.org_id = p_org_id and s.active order by s.sort_order, s.created_at limit 1;
  select coalesce(max(sort_order), -1) into v_max_sort from public.staff where org_id = p_org_id;
  insert into public.staff (org_id, name, slug, email, color, sort_order)
    values (p_org_id, btrim(p_name), p_slug, lower(p_email), p_color, v_max_sort + 1)
    returning id into v_id;
  if v_source is not null then
    insert into public.availability_rules (org_id, staff_id, weekday, start_time, end_time)
      select org_id, v_id, weekday, start_time, end_time from public.availability_rules where staff_id = v_source;
    insert into public.availability_exceptions (org_id, staff_id, date, closed, start_time, end_time)
      select org_id, v_id, date, closed, start_time, end_time
        from public.availability_exceptions where staff_id = v_source and date >= current_date;
  end if;
  insert into public.service_staff (org_id, service_id, staff_id)
    select p_org_id, s.id, v_id from public.services s
      where s.org_id = p_org_id and s.id = any(coalesce(p_service_ids, '{}'::uuid[]));
  return v_id;
end; $$;
revoke all on function public.create_staff(uuid, text, text, text, text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.create_staff(uuid, text, text, text, text, uuid[]) to authenticated;
```

- [ ] **Step 4: Apply + run the test**

Run: `npm run db:migrate`, then `npx vitest run --config vitest.integration.config.ts src/features/scheduling/staff-rls.integration.test.ts` → PASS.
(Slug CHECK: `team-co` passes; the CHECK's second alternative covers 2-char slugs.)

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations src/features/scheduling/staff-rls.integration.test.ts
git commit -m "feat(team): 0041 — backfill staff, per-staff guards, RLS, triggers, create_org seed, create_staff

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Booking RPCs per staff — helpers, `create_booking`, `create_booking_admin` (integration TDD)

**Files:**
- Modify: `src/db/migrations/0041_staff_security.sql` (append), `src/features/scheduling/booking-rpc.integration.test.ts`, `src/features/scheduling/admin-booking-rpc.integration.test.ts`
- Create: `src/features/scheduling/staff-booking-rpc.integration.test.ts`

**Interfaces (Produces):**
- `public.slot_within_availability(p_staff_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz) returns boolean` (replaces the org-keyed one).
- `public.staff_is_free(p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid) returns boolean`.
- `public.pick_staff_for_slot(p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid[]) returns uuid`.
- `public.create_booking(p_handle, p_service_id, p_starts_at, p_name, p_email, p_note, p_token_hash, p_staff_id uuid default null) returns table(booking_id uuid, staff_id uuid, staff_name text)` — **return type changes** (was uuid).
- `public.create_booking_admin(p_service_id, p_starts_at, p_name, p_email, p_note, p_token_hash, p_duration_min integer, p_staff_id uuid) returns uuid` — `p_staff_id` required.

- [ ] **Step 1: New failing tests** — `src/features/scheduling/staff-booking-rpc.integration.test.ts` (same header/helpers as Task 2's test; `TZ = "UTC"` and set `update_org_scheduling` with `p_handle: HANDLE, p_timezone: "UTC"` as `booking-rpc.integration.test.ts` does):

```ts
// Setup (beforeAll): create org → defaultStaffId; create service "Cut" 30min
// (service_staff for the default staff is NOT automatic on raw insert — insert
// it via admin); create_staff Anna (services [serviceId]); rules for BOTH staff:
// weekday of d(3) 09:00–12:00 (insert via admin with staff_id).
const d = (n: number) => addDaysISO(dateInZone(new Date(), "UTC"), n);
const at = (n: number, hm: string) => `${d(n)}T${hm}:00Z`;
function book(staffId: string | null, hm = "09:00", email = "c@example.com") {
  const { tokenHash } = generateAccessToken();
  return anon.rpc("create_booking", {
    p_handle: HANDLE, p_service_id: serviceId, p_starts_at: at(3, hm),
    p_name: "Client", p_email: email, p_note: null, p_token_hash: tokenHash, p_staff_id: staffId,
  });
}

it("named staff: books on that staff and returns staff_name", async () => {
  const { data, error } = await book(annaId);
  expect(error).toBeNull();
  const row = (data as Array<{ booking_id: string; staff_id: string; staff_name: string }>)[0];
  expect(row.staff_id).toBe(annaId);
  expect(row.staff_name).toBe("Anna");
});

it("named staff not offering the service → staff_unavailable", async () => {
  await admin.from("service_staff").delete().eq("service_id", serviceId).eq("staff_id", annaId);
  const { error } = await book(annaId, "10:00");
  expect(error?.message).toMatch(/staff_unavailable/);
  await admin.from("service_staff").insert({ org_id: orgId, service_id: serviceId, staff_id: annaId });
});

it("inactive staff → staff_unavailable", async () => {
  // Anna holds the 09:00 booking from the first test — the offboarding trigger
  // refuses deactivation while it is confirmed, so cancel it first.
  await admin.from("bookings").update({ status: "cancelled_by_provider" }).eq("staff_id", annaId).eq("status", "confirmed");
  const { error: deact } = await admin.from("staff").update({ active: false }).eq("id", annaId);
  expect(deact).toBeNull();
  const { error } = await book(annaId, "11:00", "i@example.com");
  expect(error?.message).toMatch(/staff_unavailable/);
  await admin.from("staff").update({ active: true }).eq("id", annaId);
  // Restore the 09:00 booking state the load-balancing tests below assume.
  const { error: re } = await book(annaId, "09:00", "c2@example.com");
  expect(re).toBeNull();
});

it("null staff: picks the least-loaded eligible staff", async () => {
  // default staff has 0 bookings on d(3), Anna has 1 (09:00) → default picked at 10:00
  const { data } = await book(null, "10:00", "x@example.com");
  expect((data as Array<{ staff_id: string }>)[0].staff_id).toBe(defaultStaffId);
  // now both have 1 → tie → lowest sort_order (default) at 10:30
  const { data: d2 } = await book(null, "10:30", "y@example.com");
  expect((d2 as Array<{ staff_id: string }>)[0].staff_id).toBe(defaultStaffId);
});

it("null staff: skips staff who is busy at that time", async () => {
  // Anna is free at 10:00? She has 09:00 only. Default is busy at 10:00 → 10:00 again must go to Anna.
  const { data } = await book(null, "10:00", "z@example.com");
  expect((data as Array<{ staff_id: string }>)[0].staff_id).toBe(annaId);
});

it("null staff: nobody free → taken", async () => {
  const { error } = await book(null, "10:00", "w@example.com");
  expect(error?.message).toMatch(/taken/);
});

it("null staff: outside every staff's hours → not found", async () => {
  const { error } = await book(null, "15:00");
  expect(error?.message).toMatch(/not found/);
});

it("create_booking_admin requires an eligible staff", async () => {
  const { tokenHash } = generateAccessToken();
  const { error } = await owner.rpc("create_booking_admin", {
    p_service_id: serviceId, p_starts_at: at(4, "09:00"), p_name: "W", p_email: null, p_note: null,
    p_token_hash: tokenHash, p_duration_min: null, p_staff_id: annaId,
  });
  expect(error).toBeNull();
  const { tokenHash: t2 } = generateAccessToken();
  const { data: foreign } = await admin.from("staff").select("id").neq("org_id", orgId).limit(1).single();
  const { error: e2 } = await owner.rpc("create_booking_admin", {
    p_service_id: serviceId, p_starts_at: at(4, "10:00"), p_name: "W", p_email: null, p_note: null,
    p_token_hash: t2, p_duration_min: null, p_staff_id: foreign!.id,
  });
  expect(e2?.message).toMatch(/staff_unavailable/);
});
```
  Tests run top-down and depend on the booking state left by earlier ones (Anna: one confirmed 09:00 on d(3) going into the auto-assign cases). Keep the order as written.

- [ ] **Step 2: Update the two existing RPC tests for the new signatures** — in `booking-rpc.integration.test.ts` and `admin-booking-rpc.integration.test.ts`: after `create_org`, fetch `defaultStaffId` (`admin.from("staff").select("id").eq("org_id", orgId).single()`), insert `service_staff` for each created service, add `staff_id: defaultStaffId` to every `availability_rules`/`availability_exceptions`/direct `bookings` insert, pass `p_staff_id: null` (anon) / `p_staff_id: defaultStaffId` (admin) in the RPC calls, and read `create_booking`'s result as `data[0].booking_id` where the tests used `data` as the id.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run --config vitest.integration.config.ts src/features/scheduling/staff-booking-rpc.integration.test.ts` → FAIL (`p_staff_id` unknown).

- [ ] **Step 4: Append to `0041_staff_security.sql`:**

```sql
-- ---------- slot_within_availability: staff-keyed (0028 body, org → staff)
drop function if exists public.slot_within_availability(uuid, text, timestamptz, timestamptz);
create function public.slot_within_availability(
  p_staff_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz
) returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_start_local timestamp := p_starts_at at time zone p_timezone;
  v_end_local   timestamp := p_ends_at   at time zone p_timezone;
  v_date date := v_start_local::date;
  v_start_hm text := to_char(v_start_local, 'HH24:MI');
  v_end_hm   text := to_char(v_end_local,   'HH24:MI');
  v_weekday int := extract(dow from v_start_local)::int;
begin
  if v_end_local::date <> v_date then return false; end if;
  if exists (select 1 from public.availability_exceptions ae where ae.staff_id = p_staff_id and ae.date = v_date) then
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.staff_id = p_staff_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm);
  end if;
  return exists (
    select 1 from public.availability_rules ar
    where ar.staff_id = p_staff_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm);
end; $$;
revoke all on function public.slot_within_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- staff_is_free: no confirmed overlap on the staff (excluding one row)
create or replace function public.staff_is_free(
  p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
    select 1 from public.bookings b
    where b.staff_id = p_staff_id and b.status = 'confirmed'
      and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
      and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_starts_at, p_ends_at));
$$;
revoke all on function public.staff_is_free(uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated, service_role;

-- ---------- pick_staff_for_slot: "Anyone available" assignment (spec: least
-- confirmed bookings that org-local day, tie → sort_order, created_at).
create or replace function public.pick_staff_for_slot(
  p_service_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz, p_exclude uuid[]
) returns uuid language sql stable set search_path = '' as $$
  select st.id
  from public.service_staff ss
  join public.staff st on st.id = ss.staff_id
  where ss.service_id = p_service_id and st.active
    and st.id <> all(coalesce(p_exclude, '{}'::uuid[]))
    and public.slot_within_availability(st.id, p_timezone, p_starts_at, p_ends_at)
    and public.staff_is_free(st.id, p_starts_at, p_ends_at, null)
  order by (
      select count(*) from public.bookings b
      where b.staff_id = st.id and b.status = 'confirmed'
        and (b.starts_at at time zone p_timezone)::date = (p_starts_at at time zone p_timezone)::date
    ) asc, st.sort_order asc, st.created_at asc
  limit 1;
$$;
revoke all on function public.pick_staff_for_slot(uuid, text, timestamptz, timestamptz, uuid[])
  from public, anon, authenticated, service_role;

-- ---------- create_booking v3: + p_staff_id (null = auto-assign), returns staff.
-- Return type changes → DROP (grants re-applied).
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text);
create function public.create_booking(
  p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text,
  p_note text, p_token_hash text, p_staff_id uuid default null
) returns table (booking_id uuid, staff_id uuid, staff_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_org record;
  v_service record;
  v_recent int;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
  v_staff uuid;
  v_tried uuid[] := '{}';
  v_attempts int := 0;
begin
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s where s.id = p_service_id and s.org_id = v_org.id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select count(*) into v_recent from public.bookings b where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  if p_staff_id is not null then
    -- Named staff: must be active, in the org, offering the service, inside hours.
    if not exists (
      select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
      where st.id = p_staff_id and st.org_id = v_org.id and st.active and ss.service_id = p_service_id
    ) then raise exception 'staff_unavailable'; end if;
    if not public.slot_within_availability(p_staff_id, v_org.timezone, p_starts_at, v_ends_at) then
      raise exception 'not found';
    end if;
    v_staff := p_staff_id;
  else
    -- Auto-assign. If no eligible staff is even open at this time → not found
    -- (uniform); if all open ones are busy → taken.
    if not exists (
      select 1 from public.service_staff ss join public.staff st on st.id = ss.staff_id
      where ss.service_id = p_service_id and st.active
        and public.slot_within_availability(st.id, v_org.timezone, p_starts_at, v_ends_at)
    ) then raise exception 'not found'; end if;
  end if;

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  loop
    if p_staff_id is null then
      v_staff := public.pick_staff_for_slot(p_service_id, v_org.timezone, p_starts_at, v_ends_at, v_tried);
      if v_staff is null then raise exception 'taken'; end if;
    end if;
    begin
      insert into public.bookings
        (org_id, service_id, staff_id, client_id, client_name, client_email,
         starts_at, ends_at, status, cancel_token_hash, note)
      values
        (v_org.id, p_service_id, v_staff, v_client_id, btrim(p_name), lower(p_email),
         p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
      returning id into v_booking_id;
      exit;
    exception when exclusion_violation then
      -- Named staff: surface as the classic 23P01 so callers keep their
      -- "slot taken" mapping. Auto: try the next eligible staff (race lost).
      if p_staff_id is not null then raise; end if;
      v_tried := v_tried || v_staff;
      v_attempts := v_attempts + 1;
      if v_attempts > 20 then raise exception 'taken'; end if;
    end;
  end loop;

  return query select v_booking_id, v_staff, st.name from public.staff st where st.id = v_staff;
end; $$;
revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) to anon;

-- ---------- create_booking_admin v3: + required p_staff_id (0031 body)
drop function if exists public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer);
create function public.create_booking_admin(
  p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text, p_note text,
  p_token_hash text, p_duration_min integer, p_staff_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_service record;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select s.id, s.org_id, s.duration_min into v_service
    from public.services s where s.id = p_service_id and s.org_id in (select public.user_orgs()) and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  if p_staff_id is null or not exists (
    select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
    where st.id = p_staff_id and st.org_id = v_service.org_id and st.active and ss.service_id = p_service_id
  ) then raise exception 'staff_unavailable'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '24 hours' or p_starts_at > now() + interval '365 days' then raise exception 'not found'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is not null and (length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  if p_duration_min is not null and p_duration_min not between 5 and 480 then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => coalesce(p_duration_min, v_service.duration_min));
  if p_email is not null then
    insert into public.clients (org_id, name, email) values (v_service.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null do update set name = excluded.name
    returning id into v_client_id;
  end if;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_service.org_id, p_service_id, p_staff_id, v_client_id, btrim(p_name), lower(p_email), p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;
  return v_booking_id;
end; $$;
revoke all on function public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_admin(uuid, timestamptz, text, text, text, text, integer, uuid) to authenticated;
```

- [ ] **Step 5: Re-apply the migration locally** (the file was already applied in Task 2 — journal won't re-run it): run the appended SQL via `npx --yes tsx -e` with the `postgres` package against `DATABASE_URL` (Global Constraints). Then run all three tests:

Run: `npx vitest run --config vitest.integration.config.ts src/features/scheduling/staff-booking-rpc.integration.test.ts src/features/scheduling/booking-rpc.integration.test.ts src/features/scheduling/admin-booking-rpc.integration.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0041_staff_security.sql src/features/scheduling/*.integration.test.ts
git commit -m "feat(team): staff-keyed create_booking (auto-assign) + create_booking_admin

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Reschedule RPCs + resolver/cancel `staff_name`; fix remaining tests + seed

**Files:**
- Modify: `src/db/migrations/0041_staff_security.sql` (append), `src/features/scheduling/lifecycle-rpc.integration.test.ts`, `src/features/scheduling/availability-guard.integration.test.ts`, `src/features/scheduling/rls.integration.test.ts`, `src/features/scheduling/booking-flow.integration.test.ts`, `src/features/scheduling/s3-rpc.integration.test.ts`, `src/features/scheduling/reminder-drain.integration.test.ts`, `scripts/seed.ts`

**Interfaces (Produces):**
- `reschedule_booking(p_token, p_starts_at, p_new_token_hash) returns table(… existing cols …, staff_id uuid, staff_name text)`.
- `reschedule_booking_admin(p_booking_id, p_starts_at, p_token_hash, p_staff_id uuid default null) returns table(new_booking_id uuid, staff_changed boolean, staff_name text)`.
- `resolve_booking_token` and `cancel_booking` return extra trailing `staff_id uuid, staff_name text` (null for rentals).

- [ ] **Step 1: Failing tests** — append to `staff-booking-rpc.integration.test.ts`:

```ts
it("reschedule_booking keeps the staff and reports staff_name", async () => {
  const { token, tokenHash } = generateAccessToken();
  await anon.rpc("create_booking", { p_handle: HANDLE, p_service_id: serviceId, p_starts_at: at(6, "09:00"),
    p_name: "R", p_email: "r@example.com", p_note: null, p_token_hash: tokenHash, p_staff_id: annaId });
  const fresh = generateAccessToken();
  const { data, error } = await anon.rpc("reschedule_booking", { p_token: token, p_starts_at: at(6, "10:00"), p_new_token_hash: fresh.tokenHash });
  expect(error).toBeNull();
  const row = (data as Array<{ new_booking_id: string; staff_id: string; staff_name: string }>)[0];
  expect(row.staff_id).toBe(annaId);
  expect(row.staff_name).toBe("Anna");
  const { data: r } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
  const rr = (r as Array<{ staff_id: string; staff_name: string }>)[0];
  expect(rr.staff_id).toBe(annaId);
  expect(rr.staff_name).toBe("Anna");
});

it("reschedule_booking_admin moves to another staff (staff_changed=true) and refuses ineligible staff", async () => {
  const { data: b } = await admin.from("bookings").select("id").eq("staff_id", annaId).eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).single();
  const t1 = generateAccessToken();
  const { data, error } = await owner.rpc("reschedule_booking_admin", { p_booking_id: b!.id, p_starts_at: at(6, "11:00"), p_token_hash: t1.tokenHash, p_staff_id: defaultStaffId });
  expect(error).toBeNull();
  const row = (data as Array<{ new_booking_id: string; staff_changed: boolean; staff_name: string }>)[0];
  expect(row.staff_changed).toBe(true);
  const { data: foreign } = await admin.from("staff").select("id").neq("org_id", orgId).limit(1).single();
  const t2 = generateAccessToken();
  const { error: e2 } = await owner.rpc("reschedule_booking_admin", { p_booking_id: row.new_booking_id, p_starts_at: at(6, "11:30"), p_token_hash: t2.tokenHash, p_staff_id: foreign!.id });
  expect(e2?.message).toMatch(/staff_unavailable/);
});
```

- [ ] **Step 2: Append to `0041_staff_security.sql`:**

```sql
-- ---------- reschedule_booking v2: staff kept; + staff cols in the return.
drop function if exists public.reschedule_booking(text, timestamptz, text);
create function public.reschedule_booking(p_token text, p_starts_at timestamptz, p_new_token_hash text)
returns table (
  new_booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text,
  client_name text, client_email text, old_starts_at timestamptz, new_starts_at timestamptz,
  staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare
  v_hash text; v_old record; v_service record; v_tz text; v_ends_at timestamptz; v_new_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select b.id, b.org_id, b.service_id, b.staff_id, b.client_id, b.client_name, b.client_email, b.note, b.starts_at
    into v_old from public.bookings b
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now() and b.service_id is not null
    for update;
  if v_old.id is null then return; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service from public.services s where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.staff_id, v_tz, p_starts_at, v_ends_at) then raise exception 'not found'; end if;
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.staff_id, v_old.client_id, v_old.client_name, v_old.client_email, p_starts_at, v_ends_at, 'confirmed', p_new_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;
  return query
    select v_new_id, v_old.org_id, o.name, o.timezone, s.name, v_old.client_name, v_old.client_email,
           v_old.starts_at, p_starts_at, v_old.staff_id, st.name
    from public.orgs o, public.services s, public.staff st
    where o.id = v_old.org_id and s.id = v_old.service_id and st.id = v_old.staff_id;
end; $$;
revoke all on function public.reschedule_booking(text, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking(text, timestamptz, text) to anon;

-- ---------- reschedule_booking_admin v2: optional move to another staff.
drop function if exists public.reschedule_booking_admin(uuid, timestamptz, text);
create function public.reschedule_booking_admin(
  p_booking_id uuid, p_starts_at timestamptz, p_token_hash text, p_staff_id uuid default null
) returns table (new_booking_id uuid, staff_changed boolean, staff_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_old record; v_service record; v_tz text; v_ends_at timestamptz; v_new_id uuid; v_staff uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;
  select b.id, b.org_id, b.service_id, b.staff_id, b.client_id, b.client_name, b.client_email, b.note
    into v_old from public.bookings b
    where b.id = p_booking_id and b.org_id in (select public.user_orgs()) and b.status = 'confirmed' and b.service_id is not null
    for update;
  if v_old.id is null then raise exception 'not found'; end if;
  select s.id, s.duration_min, s.booking_window_days into v_service from public.services s where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;
  v_staff := coalesce(p_staff_id, v_old.staff_id);
  if not exists (
    select 1 from public.staff st join public.service_staff ss on ss.staff_id = st.id
    where st.id = v_staff and st.org_id = v_old.org_id and st.active and ss.service_id = v_old.service_id
  ) then raise exception 'staff_unavailable'; end if;
  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;
  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then raise exception 'not found'; end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_staff, v_tz, p_starts_at, v_ends_at) then raise exception 'not found'; end if;
  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;
  insert into public.bookings
    (org_id, service_id, staff_id, client_id, client_name, client_email, starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_staff, v_old.client_id, v_old.client_name, v_old.client_email, p_starts_at, v_ends_at, 'confirmed', p_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;
  return query select v_new_id, v_staff <> v_old.staff_id, st.name from public.staff st where st.id = v_staff;
end; $$;
revoke all on function public.reschedule_booking_admin(uuid, timestamptz, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking_admin(uuid, timestamptz, text, uuid) to authenticated;

-- ---------- resolver v4 / cancel v3: + trailing staff_id, staff_name (0037 bodies + one join)
drop function if exists public.resolve_booking_token(text);
create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text,
  org_name text, org_timezone text, org_id uuid, service_id uuid, rental_unit_id uuid, range_mode text,
  staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, coalesce(s.name, ro.name || ' · ' || u.name),
           o.name, o.timezone, b.org_id, b.service_id, b.rental_unit_id, ro.range_mode, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.cancel_token_hash = v_hash;
end; $$;
revoke all on function public.resolve_booking_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

drop function if exists public.cancel_booking(text);
create function public.cancel_booking(p_token text)
returns table (
  booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text,
  client_email text, starts_at timestamptz, ends_at timestamptz, rental_unit_id uuid, staff_id uuid, staff_name text
) language plpgsql security definer set search_path = '' as $$
declare v_hash text; v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then return; end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  update public.bookings b set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then return; end if;
  return query
    select b.id, b.org_id, o.name, o.timezone, coalesce(s.name, ro.name || ' · ' || u.name),
           b.client_name, b.client_email, b.starts_at, b.ends_at, b.rental_unit_id, b.staff_id, st.name
    from public.bookings b
    join public.orgs o on o.id = b.org_id
    left join public.services s on s.id = b.service_id
    left join public.staff st on st.id = b.staff_id
    left join public.rental_offerings ro on ro.id = b.rental_offering_id
    left join public.rental_units u on u.id = b.rental_unit_id
    where b.id = v_id;
end; $$;
revoke all on function public.cancel_booking(text) from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to anon;
```

- [ ] **Step 3: Update remaining integration tests + seed** (mechanical): in each file listed above add `staff_id: defaultStaffId` (fetched after `create_org` from `staff`) to every insert into `availability_rules` / `availability_exceptions` / `bookings` (appointment rows), insert `service_staff` for each created service, pass `p_staff_id` where the RPCs are called (`null` for anon `create_booking` unless a specific staff is meant; `defaultStaffId` for `create_booking_admin`), and read `create_booking` results as `data[0].booking_id`. `resolve_booking_token`/`cancel_booking` consumers in tests that assert on column counts must include `staff_name`. In `scripts/seed.ts`: after locating/creating the org, fetch the org's staff row and add `staff_id` to the `availability_rules` rows (line ~437) and the demo `bookings` insert (line ~472); after seeding services, insert `service_staff` rows for each service × that staff (`on conflict do nothing` isn't available via supabase-js — check existence first).

- [ ] **Step 4: Re-apply SQL locally + run the whole integration suite**

Run: `npm run test:integration` → PASS (rentals suites untouched and green).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/0041_staff_security.sql src/features/scheduling/*.integration.test.ts scripts/seed.ts
git commit -m "feat(team): staff-aware reschedule RPCs, resolver/cancel staff_name; tests + seed re-keyed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Engine `unionSlots` + staff-aware public loaders (TDD)

**Files:**
- Modify: `src/features/scheduling/slots.ts`, `src/features/scheduling/slots.test.ts`, `src/lib/booking/public.ts`
- Create: `src/features/scheduling/staff-slug.ts`, `src/features/scheduling/staff-slug.test.ts`

**Interfaces (Produces):**
```ts
// slots.ts
export type StaffSlots = { staffId: string; slots: Date[] };
export function unionSlots(perStaff: StaffSlots[]): Array<{ startsAt: Date; staffIds: string[] }>;
// staff-slug.ts
export const STAFF_SLUG_RE = /^(?:[a-z0-9]{2}|[a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/;   // 2–40 chars, matches the DB CHECK
export function slugifyStaffName(name: string): string;                  // "Anna Müller" → "anna-muller"; "" → "team-member"; ≥2 chars, ≤40
export const STAFF_COLORS: readonly string[];                            // 8 hex colours, first = "#4f46e5"
export function nextStaffColor(used: string[]): string;                  // first unused, else cycles by used.length
// lib/booking/public.ts
export type PublicStaff = { id: string; name: string; slug: string; color: string };
export async function listPublicStaff(orgId: string, serviceId?: string): Promise<PublicStaff[]>;   // active, ordered by sort_order,name; filtered via service_staff when serviceId given
export async function getPublicStaffBySlug(orgId: string, slug: string): Promise<PublicStaff | null>; // active only
export async function countActiveStaff(orgId: string): Promise<number>;
export async function getAvailability(staffId: string): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }>;   // now keyed by staff
export async function getBusyIntervals(staffId: string, fromIso: string, toIso: string, excludeBookingId?: string): Promise<BusyInterval[]>; // now keyed by staff
export type StaffSlotContext = { staffId: string; rules: SlotRule[]; exceptions: SlotException[]; busy: BusyInterval[] };
export async function loadOrgSlotContext(orgId: string, serviceId: string, fromDate: string, days: number,
  opts: { staffId: string | "any"; excludeBookingId?: string }): Promise<{ service: PublicService; perStaff: StaffSlotContext[] } | null>;
```

- [ ] **Step 1: Failing unit tests** — append to `slots.test.ts`:

```ts
describe("unionSlots", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 8, 1, h));
  it("merges, dedupes by instant, sorts, and lists eligible staff per slot", () => {
    const out = unionSlots([
      { staffId: "a", slots: [t(10), t(9)] },
      { staffId: "b", slots: [t(9), t(11)] },
    ]);
    expect(out.map((s) => s.startsAt.getTime())).toEqual([t(9), t(10), t(11)].map((d) => d.getTime()));
    expect(out[0].staffIds).toEqual(["a", "b"]);
    expect(out[1].staffIds).toEqual(["a"]);
  });
  it("empty input → empty", () => expect(unionSlots([])).toEqual([]));
});
```
  Create `staff-slug.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { slugifyStaffName, STAFF_SLUG_RE, nextStaffColor, STAFF_COLORS } from "./staff-slug";
describe("slugifyStaffName", () => {
  it("lowercases, strips diacritics, hyphenates", () => expect(slugifyStaffName("Anna Müller")).toBe("anna-muller"));
  it("empty → team-member", () => expect(slugifyStaffName("  ")).toBe("team-member"));
  it("single char padded", () => expect(slugifyStaffName("A")).toBe("a-1"));
  it("clamps to 40 and always matches the regex", () => {
    const s = slugifyStaffName("x".repeat(60) + "-");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(STAFF_SLUG_RE.test(s)).toBe(true);
  });
});
describe("nextStaffColor", () => {
  it("first unused, then cycles", () => {
    expect(nextStaffColor([])).toBe(STAFF_COLORS[0]);
    expect(nextStaffColor([STAFF_COLORS[0]])).toBe(STAFF_COLORS[1]);
    expect(nextStaffColor([...STAFF_COLORS])).toBe(STAFF_COLORS[0]);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/features/scheduling/slots.test.ts src/features/scheduling/staff-slug.test.ts` → FAIL.

- [ ] **Step 3: Implement**

  `slots.ts` (append):
```ts
export type StaffSlots = { staffId: string; slots: Date[] };
// "Anyone available": one merged list for the picker. Which staff actually
// takes the booking is decided in the DB (pick_staff_for_slot) — staffIds
// here is display-only (and lets the widget say "3 people free").
export function unionSlots(perStaff: StaffSlots[]): Array<{ startsAt: Date; staffIds: string[] }> {
  const byMs = new Map<number, string[]>();
  for (const { staffId, slots } of perStaff) {
    for (const s of slots) {
      const ms = s.getTime();
      const ids = byMs.get(ms);
      if (ids) { if (!ids.includes(staffId)) ids.push(staffId); }
      else byMs.set(ms, [staffId]);
    }
  }
  return [...byMs.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, staffIds]) => ({ startsAt: new Date(ms), staffIds }));
}
```
  `staff-slug.ts`:
```ts
export const STAFF_SLUG_RE = /^(?:[a-z0-9]{2}|[a-z0-9][a-z0-9-]{0,38}[a-z0-9])$/;
export const STAFF_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#475569"] as const;
export function slugifyStaffName(name: string): string {
  let s = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  if (s === "") return "team-member";
  if (s.length < 2) s = `${s}-1`;
  return s;
}
export function nextStaffColor(used: string[]): string {
  return STAFF_COLORS.find((c) => !used.includes(c)) ?? STAFF_COLORS[used.length % STAFF_COLORS.length];
}
```
  `lib/booking/public.ts`: change `getAvailability`/`getBusyIntervals` to filter `.eq("staff_id", staffId)` instead of `org_id` (keep the `rental_unit_id is null` filter — redundant now but harmless); add:
```ts
export type PublicStaff = { id: string; name: string; slug: string; color: string };
const STAFF_COLS = "id, name, slug, color, sort_order";
export async function listPublicStaff(orgId: string, serviceId?: string): Promise<PublicStaff[]> {
  const admin = createAdminClient();
  let ids: string[] | null = null;
  if (serviceId) {
    const { data, error } = await admin.from("service_staff").select("staff_id").eq("org_id", orgId).eq("service_id", serviceId);
    if (error) throw error;
    ids = (data ?? []).map((r) => r.staff_id);
    if (ids.length === 0) return [];
  }
  let q = admin.from("staff").select(STAFF_COLS).eq("org_id", orgId).eq("active", true).order("sort_order").order("name");
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color }));
}
export async function getPublicStaffBySlug(orgId: string, slug: string): Promise<PublicStaff | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("staff").select(STAFF_COLS).eq("org_id", orgId).eq("slug", slug).eq("active", true).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name, slug: data.slug, color: data.color };
}
export async function countActiveStaff(orgId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("active", true);
  if (error) throw error;
  return count ?? 0;
}
export type StaffSlotContext = { staffId: string; rules: SlotRule[]; exceptions: SlotException[]; busy: BusyInterval[] };
export async function loadOrgSlotContext(orgId, serviceId, fromDate, days, opts: { staffId: string | "any"; excludeBookingId?: string }) {
  const service = await getPublicServiceById(orgId, serviceId);
  if (!service) return null;
  const eligible = await listPublicStaff(orgId, serviceId);
  const targets = opts.staffId === "any" ? eligible : eligible.filter((s) => s.id === opts.staffId);
  if (targets.length === 0) return null;
  const fromIso = `${addDaysISO(fromDate, -1)}T00:00:00Z`;
  const toIso = `${addDaysISO(fromDate, days + 1)}T23:59:59Z`;
  const perStaff = await Promise.all(targets.map(async (st) => {
    const [{ rules, exceptions }, busy] = await Promise.all([
      getAvailability(st.id), getBusyIntervals(st.id, fromIso, toIso, opts.excludeBookingId),
    ]);
    return { staffId: st.id, rules, exceptions, busy };
  }));
  return { service, perStaff };
}
```
  (`BusyInterval` is exported from `slots.ts`; import it.) The old `getPublicServiceById` stays. **All existing callers of `loadOrgSlotContext`** (`public-actions.ts`, `manage-actions.ts`, `booking-actions.ts`) now fail typecheck — that's expected; Tasks 6/8/12 fix them. To keep the tree compiling at this commit, update those three call sites minimally: pass `{ staffId: "any" }` and use `ctx.perStaff[0]` — Task 6+ replace this. (Do this now so `npm run verify` passes.)

- [ ] **Step 4: Run** unit tests → PASS; `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit** — `feat(team): unionSlots, staff slug/colour helpers, staff-aware public loaders`.

---

### Task 6: Public actions, schema, emails — `staffId | "any"`, staff line, staff notice

**Files:**
- Modify: `src/features/scheduling/schema.ts`, `src/features/scheduling/public-actions.ts`, `src/features/scheduling/templates.ts`, `src/features/scheduling/templates.test.ts`, `src/features/scheduling/ics.ts`, `src/features/scheduling/ics.test.ts`
- Create: `src/lib/booking/staff-notice.ts`

**Interfaces (Produces):**
```ts
// schema.ts
export const staffChoice = z.union([z.literal("any"), z.uuid()]);
getSlotsInput  += { staffId: staffChoice }
createBookingInput += { staffId: staffChoice }
// public-actions.ts
getSlots(input) → { ok: true; slots: string[] }   // union when "any"
createBooking(input) → { ok: true; token: string; staffName: string | null }  // staffName null when org is solo
// templates.ts — every client-facing template input gains `staffName?: string | null`; when truthy adds a line "With {staffName}"
bookingConfirmationEmail, bookingRescheduledEmail, bookingCancelledEmail, bookingReminderEmail, bookingManageLinkEmail
export function staffNewBookingEmail(input: { staffName: string; orgName: string; serviceName: string; clientName: string; whenLine: string }): { subject; html; text }
// ics.ts — buildBookingIcs(...) input gains `staffName?: string | null` → SUMMARY "… with {staffName}"
// lib/booking/staff-notice.ts
export async function sendStaffNotice(input: { orgId: string; staffId: string; kind: "new" | "cancelled" | "rescheduled"; serviceName: string; clientName: string; whenLine: string; idempotencyKey: string }): Promise<void>  // no-op when staff.email null; never throws
```

- [ ] **Step 1: Failing unit tests** — `templates.test.ts`: `bookingConfirmationEmail({...base, staffName: "Anna"}).text` contains `With Anna`; without `staffName` it does not contain `With`. `staffNewBookingEmail` subject `New booking — Cut, <whenLine>`, text contains client name. `ics.test.ts`: SUMMARY contains ` with Anna` when given, unchanged otherwise. Run → FAIL.

- [ ] **Step 2: Implement templates/ics** — add `staffName?: string | null` to each input type; in html add `<p style="margin: 0 0 4px;">With ${esc(input.staffName)}</p>` right under the service line and `With ${staffName}` in text, guarded by `input.staffName ? … : ""`. `staffNewBookingEmail` mirrors `providerCancelledEmail`'s shape (plain, no manage link).

- [ ] **Step 3: `staff-notice.ts`:**
```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { staffNewBookingEmail, providerCancelledEmail, providerRescheduledEmail } from "@/features/scheduling/templates";
export async function sendStaffNotice(input) {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("staff").select("name, email").eq("id", input.staffId).eq("org_id", input.orgId).maybeSingle();
    if (!data?.email) return;
    const { data: org } = await admin.from("orgs").select("name").eq("id", input.orgId).single();
    const msg = input.kind === "new"
      ? staffNewBookingEmail({ staffName: data.name, orgName: org?.name ?? "", serviceName: input.serviceName, clientName: input.clientName, whenLine: input.whenLine })
      : input.kind === "cancelled"
        ? providerCancelledEmail({ serviceName: input.serviceName, clientName: input.clientName, whenLine: input.whenLine })
        : providerRescheduledEmail({ serviceName: input.serviceName, clientName: input.clientName, whenLine: input.whenLine, oldWhenLine: input.whenLine });
    await selectTransport().send({ to: data.email, subject: msg.subject, html: msg.html, text: msg.text, idempotencyKey: `${input.idempotencyKey}:staff` });
  } catch (e) { console.error("[scheduling] staff notice failed:", e); }
}
```
  Check `providerRescheduledEmail`'s actual input fields in `templates.ts` and pass what it needs (it takes old/new when lines — extend `sendStaffNotice` input with `oldWhenLine?: string`).

- [ ] **Step 4: `public-actions.ts`:**
  - `getSlots`: `const { staffId } = parsed.data`; `ctx = loadSlotContext(handle, serviceId, fromDate, days, staffId)`; compute per staff:
```ts
const perStaff = ctx.perStaff.map((p) => ({ staffId: p.staffId, slots: computeSlots({ service: ctx.service, rules: p.rules, exceptions: p.exceptions, busy: p.busy, timeZone: ctx.org.timeZone, now: new Date(), fromDate, days }) }));
const slots = unionSlots(perStaff).map((s) => s.startsAt.toISOString());
```
  - `createBooking`: same re-check with the union for the local day; RPC call adds `p_staff_id: staffId === "any" ? null : staffId`; result is `data[0]` → `{ booking_id, staff_id, staff_name }`. Map errors: `error.message.includes("staff_unavailable")` → `{ ok:false, error: "That team member can't take this time — pick another." , slotTaken: true }`; `includes("taken")` or `code === "23P01"` → `SLOT_TAKEN`. Then `const solo = (await countActiveStaff(ctx.org.orgId)) <= 1; const staffName = solo ? null : row.staff_name;` pass `staffName` into `bookingConfirmationEmail`; call `sendStaffNotice({ kind: "new", … })` after the client email (best-effort). Return `{ ok: true, token, staffName }`.
  - `loadSlotContext(handle, serviceId, fromDate, days, staffId)` passes `{ staffId }` through.

- [ ] **Step 5: Run** `npm run verify` → PASS. Commit — `feat(team): public getSlots/createBooking take staffId|any; staff line in emails/ICS; staff notice`.

---

### Task 7: Booking widget staff step, per-staff page, embed `?staff=`, snippet

**Files:**
- Modify: `src/features/scheduling/components/booking-widget.tsx`, `src/features/scheduling/components/booking-confirmed.tsx`, `src/app/book/[handle]/page.tsx`, `src/app/embed/[handle]/page.tsx`, `src/features/orgs/components/widget-embed-snippet.ts`, `src/features/orgs/components/widget-embed-snippet.test.ts` (create if absent), `src/features/orgs/components/widget-appearance.tsx`, `src/app/(dashboard)/embed/page.tsx`
- Create: `src/app/book/[handle]/[staffSlug]/page.tsx`

**Interfaces:**
```ts
// BookingWidget props (added)
staff: PublicStaff[];                 // active staff of the org (all, unfiltered) — [] never happens post-0041
serviceStaffIds?: Record<string, string[]>; // serviceId → eligible staff ids (for the staff step filter)
lockedStaff?: PublicStaff | null;     // per-staff page / ?staff= — skips the staff step, no "Anyone"
// snippetFor(appUrl: string, handle: string, staffSlug?: string | null): string  // appends ?staff=<slug>
```
  Loader for pages: `listPublicStaff(orgId)` + one `service_staff` fetch → build `serviceStaffIds` — add `export async function listServiceStaffMap(orgId: string): Promise<Record<string,string[]>>` to `lib/booking/public.ts` (`select("service_id, staff_id").eq("org_id", orgId)`).

- [ ] **Step 1: Snippet unit test** — `snippetFor(u, h, "anna")` contains `/embed/h?staff=anna`; without slug unchanged. Implement: `const src = staffSlug ? \`${appUrl}/embed/${handle}?staff=${staffSlug}\` : \`${appUrl}/embed/${handle}\``. Run → PASS.

- [ ] **Step 2: Widget** — state additions:
```ts
const [staffChoice, setStaffChoice] = React.useState<string | "any" | null>(lockedStaff ? lockedStaff.id : null);
const eligibleFor = (svc: PublicService) => (serviceStaffIds ? staff.filter((s) => (serviceStaffIds[svc.id] ?? []).includes(s.id)) : staff);
const needsStaffStep = (svc: PublicService) => !lockedStaff && eligibleFor(svc).length > 1;
```
  - On service pick: `if (!needsStaffStep(s)) setStaffChoice(lockedStaff?.id ?? eligibleFor(s)[0]?.id ?? "any")` — solo/one-eligible orgs never see the step. (When exactly one eligible staff, pass that id, not `"any"`, so the RPC does the strict named check.)
  - `loadSlots(svc, from)` and `submit` include `staffId: staffChoice`; effect deps include `staffChoice`; guard `if (service && staffChoice) loadSlots(...)`.
  - Render order: `!service` → service list (unchanged) ; `service && staffChoice === null` → **staff step**:
```tsx
<div className="flex flex-col gap-3">
  <p className="text-sm font-medium">{service.name} <button …change… onClick={() => { setService(null); setStaffChoice(null); }}>change</button></p>
  <p className="text-muted-foreground text-sm">Who would you like to book with?</p>
  <ul className="flex flex-col gap-2">
    <li><button type="button" className="wt-surface flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm" onClick={() => setStaffChoice("any")}><span className="font-medium">Anyone available</span><span className="text-muted-foreground ml-auto text-xs">most times</span></button></li>
    {eligibleFor(service).map((s) => (
      <li key={s.id}><button type="button" className="wt-surface flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-sm" onClick={() => setStaffChoice(s.id)}>
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: s.color }}>{initials(s.name)}</span>
        <span className="font-medium">{s.name}</span></button></li>))}
  </ul>
</div>
```
  - Slot header line: when the step was shown, show `{service.name} · {staffChoice === "any" ? "Anyone" : staffName} <change>` where "change" resets `staffChoice` to null (not the service). When `lockedStaff`, show `with {lockedStaff.name}` (no change link).
  - Confirm form line: same "with X" text. `BookingConfirmed` gains optional `staffName?: string | null` prop → "with {staffName}" line; `submit` stores `result.staffName` in state and passes it.
  - `initials(name)` helper: first letters of the first two words, uppercase — put in `src/features/scheduling/staff-slug.ts` (`export function initials(name: string): string`) with a unit test.

- [ ] **Step 3: Pages** — `/book/[handle]/page.tsx` and `/embed/[handle]/page.tsx`: load `[services, offerings, branding, staff, serviceStaffIds] = Promise.all([…, listPublicStaff(org.orgId), listServiceStaffMap(org.orgId)])`; pass to widget. Embed: read `searchParams.staff` (`PageProps` provides `searchParams`); if it matches `STAFF_SLUG_RE`, `lockedStaff = await getPublicStaffBySlug(org.orgId, slug)`; unknown/inactive → `null` (falls back to the org flow, never 404 — spec). New `src/app/book/[handle]/[staffSlug]/page.tsx`: copy of the org page; validate `staffSlug` with `STAFF_SLUG_RE` else `notFound()`; `const person = await getPublicStaffBySlug(org.orgId, staffSlug); if (!person) notFound();` services = `listPublicServices(org.orgId)` filtered to `serviceStaffIds[svc.id]?.includes(person.id)`; if empty → `notFound()`; `BrandedHeader` gets a subtitle prop? — `BrandedHeader` has no subtitle: render `<p className="text-muted-foreground -mt-4 text-sm">Booking with {person.name}</p>` under it; pass `lockedStaff={person}`.

- [ ] **Step 4: Embed studio** — `WidgetAppearance` gets `staffOptions: Array<{ slug: string; name: string }>` (only passed when >1 active staff; else `[]`); when non-empty, render a `<select>` "Book with: Whole team / {name}…" above the snippet, state `staffSlug`, snippet uses `snippetFor(appUrl, handle, staffSlug)`. `/embed/page.tsx` loads staff via the admin queries from Task 9 (`listStaff()`) — if Task 9 isn't done yet, do this step at the end of Task 9 instead and note it.

- [ ] **Step 5: Verify + smoke** — `npm run verify`; Playwright MCP: demo org solo → `/book/demo-studio` flow unchanged (no staff step). Commit — `feat(team): widget staff step, /book/[handle]/[staffSlug], embed ?staff=, snippet option`.

---

### Task 8: Manage / reschedule (tokenized) — staff-locked, staff name shown

**Files:**
- Modify: `src/lib/tokens/booking.ts`, `src/features/scheduling/manage-actions.ts`, `src/features/scheduling/components/manage-booking.tsx`, `src/app/booking/[token]/**` (whatever renders `ManageBooking` / the ICS route — grep `resolveBookingToken`)

**Interfaces:**
- `ResolveBookingResult` ok-branch gains `staffId: string | null` and `staffName: string | null` (the resolver already returns both since Task 4).
- `getManageSlots` / `rescheduleBooking` call `loadOrgSlotContext(..., { staffId: booking.staffId!, excludeBookingId })` and compute for `perStaff[0]`.

- [ ] **Step 1:** `booking.ts`: map `staffId: row.staff_id ?? null`, `staffName: row.staff_name ?? null`.
- [ ] **Step 2:** `manage-actions.ts`: `getManageSlots` — `if (booking.serviceId === null || booking.staffId === null) return NOT_CHANGEABLE`; ctx with `{ staffId: booking.staffId, excludeBookingId: booking.id }`; `computeSlots` on `ctx.perStaff[0]`. `rescheduleBooking` — same; read `row.staff_name`; pass `staffName` (solo → null via `countActiveStaff(row.org_id) > 1 ? row.staff_name : null`) into `bookingRescheduledEmail`; after the provider notice call `sendStaffNotice({ kind: "rescheduled", staffId: booking.staffId, … })`. `cancelBooking` — the RPC row now carries `staff_id, staff_name`; when `staff_id` is non-null call `sendStaffNotice({ kind: "cancelled", staffId: row.staff_id, … })` after the provider notice, and pass `staffName` (>1 rule) into `bookingCancelledEmail`.
- [ ] **Step 3:** `manage-booking.tsx`: render `with {staffName}` under the service line when `staffName` is non-null (server passes null in solo: in the page loader, `staffName = (await countActiveStaff(booking.orgId)) > 1 ? booking.staffName : null`). ICS route: pass `staffName` under the same rule.
- [ ] **Step 4:** `npm run verify`; `npx vitest run --config vitest.integration.config.ts src/features/scheduling/lifecycle-rpc.integration.test.ts src/features/scheduling/staff-booking-rpc.integration.test.ts` → PASS. Commit — `feat(team): manage/reschedule flow is staff-locked; staff name on manage page + notices`.

---

### Task 9: Admin — staff queries, actions, Team page, nav

**Files:**
- Create: `src/features/scheduling/staff-queries.ts`, `src/features/scheduling/staff-actions.ts`, `src/features/scheduling/components/staff-list.tsx`, `src/features/scheduling/components/staff-dialog.tsx`, `src/app/(dashboard)/team/page.tsx`
- Modify: `src/features/scheduling/schema.ts`, `src/components/shell/nav.ts`, `src/features/orgs/components/widget-appearance.tsx` (Task 7 Step 4 if deferred)

**Interfaces (Produces):**
```ts
// staff-queries.ts (RLS client)
export type StaffRow = { id: string; name: string; slug: string; email: string | null; color: string; active: boolean; sortOrder: number; serviceIds: string[] };
export async function listStaff(): Promise<StaffRow[]>;            // all (active + inactive), ordered sort_order,name; serviceIds via one service_staff select
export async function listActiveStaff(): Promise<StaffRow[]>;      // filter of the above
export async function firstActiveStaffId(): Promise<string | null>;
// schema.ts
export const staffInput = z.object({ name: z.string().trim().min(1).max(80), slug: z.string().regex(STAFF_SLUG_RE), email: z.preprocess(emptyToUndefined, z.email().max(320).optional()), color: z.string().regex(/^#[0-9a-f]{6}$/), serviceIds: z.array(z.uuid()) });
export const updateStaffInput = staffInput.extend({ id: z.uuid() });
export const staffActiveInput = z.object({ id: z.uuid(), active: z.boolean() });
// staff-actions.ts
export async function createStaff(input: unknown): Promise<ActionState>;   // rpc create_staff
export async function updateStaff(input: unknown): Promise<ActionState>;   // update row + diff service_staff (delete missing, insert new)
export async function setStaffActive(input: unknown): Promise<ActionState>; // maps 'last_active_staff' / 'has_future_bookings' to messages
```
  Messages: `"You need at least one active team member."`, `"{name} has upcoming bookings — move or cancel them first."` (fetch name for the message), slug unique violation `23505` → `"That link name is already used."`.

- [ ] **Step 1: Unit test for schema** — in `schema.test.ts`: `staffInput` rejects slug `"A b"`, accepts `"anna"`, converts `email: ""` to undefined. Run → FAIL; add schemas; PASS.
- [ ] **Step 2: Queries + actions** — follow `actions.ts` idioms (`currentOrgId`, `fail`, `revalidatePath("/team")`, plus `revalidatePath("/availability")`, `revalidatePath("/bookings")`, `revalidatePath("/services")` since staff changes affect all). `createStaff`: `supabase.rpc("create_staff", { p_org_id: orgId, p_name, p_slug, p_email: email ?? null, p_color, p_service_ids })`. `updateStaff`: update `staff` (`name, slug, email, color`) `.eq("id").eq("org_id")`, then reconcile `service_staff`: read current, delete `not in` new, insert missing with `org_id`. `setStaffActive`: update `active`; on error `message.includes("last_active_staff")` etc.
- [ ] **Step 3: Team page** — `/team/page.tsx`: `PageIntro` ("Everyone who can be booked. Each person has their own hours, services and booking link.") + `<StaffList staff={await listStaff()} services={await listServices()} handle={schedulingSettings.handle} appUrl={env.NEXT_PUBLIC_APP_URL} />` + create trigger (`<StaffDialog services=… usedColors=… />`). `StaffList`: rows with colour dot, name, `n services`, active switch (calls `setStaffActive`, toast on error), link `${appUrl}/book/${handle}/${slug}` with a copy button (only when `handle` set; note "Set your booking page handle first" otherwise), "Embed…" link to `/embed?staff=${slug}` (the studio preselects it — Task 7 Step 4 reads `searchParams.staff`), edit button opening `StaffDialog` with `staff`. `StaffDialog` (mirror `service-dialog.tsx` structure with Base UI Dialog): fields name (auto-fills slug via `slugifyStaffName` until the slug is touched), slug (prefix shows `/book/{handle}/`), email, colour swatches (`STAFF_COLORS`, default `nextStaffColor(usedColors)`), services checklist (all checked on create), on create a note "Starts with {firstActiveStaffName}'s weekly hours — edit them on Availability."
- [ ] **Step 4: Nav** — add `{ href: "/team", label: "Team", icon: UserGroupIcon, section: "configure" }` after Services (import `UserGroupIcon` from `@hugeicons/core-free-icons`; verify it exists in the free set, else `UserMultiple02Icon`). Update `titleForPath` test if `nav.test.ts` exists.
- [ ] **Step 5:** `npm run verify`; smoke via Playwright MCP: create "Anna", toggle inactive/active, copy link renders. Commit — `feat(team): Team page — staff CRUD, links, nav`.

---

### Task 10: Availability page — staff selector; rule/override actions take `staffId`

**Files:**
- Modify: `src/features/scheduling/queries.ts` (`getAvailabilityAdmin(staffId)`, `listExceptionsBetween(fromDate, toDate, staffIds?)`), `src/features/scheduling/schema.ts`, `src/features/scheduling/actions.ts`, `src/features/scheduling/components/weekly-hours.tsx`, `src/features/scheduling/components/date-overrides.tsx`, `src/app/(dashboard)/availability/page.tsx`
- Create: `src/features/scheduling/components/staff-tabs.tsx`

**Interfaces:**
- `getAvailabilityAdmin(staffId: string)`; every rule/override zod input gains `staffId: z.uuid()`; every action inserts `staff_id`, and filters `.eq("staff_id", staffId)` in addition to `org_id` on read/delete (`copyDayHours`, `setDateOverride`, `deleteDateOverride`, `blockTimeRange`, `unblockTimeRange`, `reopenDay`); `WeeklyHours({ staffId, rules })`, `DateOverrides({ staffId, rules, exceptions })`.
- `StaffTabs({ staff: StaffRow[]; current: string; hrefFor: (id) => string })` — segmented control (`Link`s), rendered only when `staff.length > 1`.

- [ ] **Step 1:** Extend `schema.test.ts`: `availabilityRuleInput` requires `staffId` (uuid). Run → FAIL. Add `staffId: z.uuid()` to `availabilityRuleInput`, `blockTimeInput`, `reopenDayInput`, `copyDayHoursInput`, `dateOverrideInput`, `deleteOverrideInput` (rule id–keyed inputs `ruleIdInput`/`updateRuleInput` don't need it — the row already knows its staff). PASS.
- [ ] **Step 2:** Actions: thread `staffId` (insert `staff_id: parsed.data.staffId`; reads/deletes add `.eq("staff_id", parsed.data.staffId)`). RLS + the `check_staff_owner_org` trigger reject foreign staff ids; the explicit filter is defence-in-depth.
- [ ] **Step 3:** Page: `searchParams.staff` (uuid regex) → `current = valid && staff.some(s=>s.id===it && s.active) ? it : firstActive.id`; render `<StaffTabs>` when `activeStaff.length > 1`; pass `staffId={current}` down. Components: accept `staffId` prop and include it in every action call (`addAvailabilityRule({ staffId, weekday, ...next })`, `copyDayHours({ staffId, … })`, `setDateOverride({ staffId, … })`, `deleteDateOverride({ staffId, date })`).
- [ ] **Step 4:** `npm run verify`; smoke: solo shows no tabs; with Anna, tabs switch and edits land on the right staff (check `/book/demo-studio/anna` slots). Commit — `feat(team): per-staff availability editor`.

---

### Task 11: Services ↔ staff checklist

**Files:**
- Modify: `src/features/scheduling/schema.ts` (`serviceInput += { staffIds: z.array(z.uuid()).optional() }`), `src/features/scheduling/actions.ts` (`createService`/`updateService`), `src/features/scheduling/components/service-dialog.tsx`, `src/features/scheduling/components/services-list.tsx`, `src/app/(dashboard)/services/page.tsx`, `src/features/scheduling/queries.ts` (`ServiceRow += staffIds: string[]`, `listServices` joins `service_staff(staff_id)`)

- [ ] **Step 1:** `listServices()` select adds `service_staff(staff_id)` → `staffIds`. `createService`: insert service `.select("id").single()`, then insert `service_staff` rows for `staffIds ?? allActiveStaffIds` (fetch active staff ids server-side when omitted — the solo path). `updateService`: when `staffIds` provided, reconcile like `updateStaff`.
- [ ] **Step 2:** `ServiceDialog` gets `staff: StaffRow[]` prop; when `staff.filter(active).length > 1`, render "Team members" checkboxes (all checked on create; `service.staffIds` on edit); include `staffIds` in the payload only when the section is shown. Page passes `staff` from `listStaff()`; `services-list.tsx` shows a small "n of m team members" hint when >1 staff.
- [ ] **Step 3:** `npm run verify`; smoke. Commit — `feat(team): service ↔ staff assignment`.

---

### Task 12: Calendar + bookings list + admin dialogs — staff filter, colours, staff select

**Files:**
- Modify: `src/features/scheduling/queries.ts` (`AdminBooking += staffId: string | null; staffName: string | null; staffColor: string | null`; `BOOKING_COLUMNS += ", staff_id, staff(name, color)"`; `listConfirmedBookingsBetween(fromIso, toIso, staffIds?: string[])`), `src/features/scheduling/schema.ts` (`adminSlotsInput += { staffId: z.uuid() }`, `adminCreateBookingInput += { staffId: z.uuid() }`, `adminRescheduleInput += { staffId: z.uuid().optional() }`), `src/features/scheduling/booking-actions.ts`, `src/features/scheduling/components/calendar-week.tsx`, `create-booking-dialog.tsx`, `booking-reschedule-dialog.tsx`, `booking-detail-dialog.tsx`, `bookings-list.tsx`, `src/app/(dashboard)/bookings/page.tsx`, `src/features/scheduling/calendar-geometry.ts` (`serviceAccent` fallback)
- Create: `src/features/scheduling/components/staff-filter.tsx`

**Interfaces:**
- `getAdminSlots({ serviceId, staffId, fromDate, days })` — ctx `{ staffId }`, `perStaff[0]`.
- `createBookingAdmin({ …, staffId })` → RPC `p_staff_id`; `staff_unavailable` → `{ ok:false, error: "That team member doesn't offer this service." }`.
- `rescheduleBookingAdmin({ id, startsAt, staffId? })` — engine re-check on the *target* staff (`staffId ?? booking.staff_id`), RPC `p_staff_id: staffId ?? null`, result row `{ new_booking_id, staff_changed, staff_name }`; email `bookingRescheduledEmail` gets `staffName` under the >1 rule; `sendStaffNotice` to the new staff (and, when `staff_changed`, a "cancelled" notice to the old staff).
- `StaffFilter({ staff, selected: string[] })` — chips "All" + one per active staff (multi-select), writes `?staff=a,b` via `router.replace`; rendered only when `staff.length > 1`.
- `CalendarWeek` props: `+ staff: StaffRow[]`, `+ selectedStaffIds: string[]`, `rules`/`exceptions` become **per selected staff**: page passes `rules` = rules of the single selected staff when exactly one is selected, else the union of all selected staff's rules (`getAvailabilityAdmin` per id, concatenated); the open-hours tiles then show "someone is open". Drag-to-block/unblock/reopen (which write exceptions) are enabled **only when exactly one staff is selected** — otherwise the drag handler shows `toast.info("Pick one team member to block time.")` and does nothing. In solo, exactly one is always selected → unchanged behaviour.
- Event card accent: `b.staffColor ?? serviceAccent(...)`; when `staff.length > 1`, add the staff initials chip (`initials()` from Task 7) to the card + `staffName` in the detail dialog + a "Team member" column in `bookings-list.tsx`.
- `CreateBookingDialog` props `+ staff: StaffRow[]`, `+ defaultStaffId: string`: staff `<select>` (shown when `staff.length > 1`; options filtered by `service.staffIds.includes(s.id)`; default `defaultStaffId` if eligible else first eligible), passed to `createBookingAdmin`. `BookingRescheduleDialog` props `+ staff: StaffRow[]`: "Move to" `<select>` defaulting to the booking's staff (options = active staff offering `booking.serviceId`; needs `services` staffIds → pass `eligibleStaff: StaffRow[]` computed by the caller); slots reload on change (`getAdminSlots({ serviceId, staffId })`); pick sends `staffId` when it differs from the booking's.

- [ ] **Step 1:** Queries/schema/actions changes above; `npx tsc --noEmit` drives the component prop updates. Page: parse `?staff=` (comma-split uuids ∩ active staff ids; empty → all active), load `rules` per selected id, pass `staff`, `selectedStaffIds`, `defaultStaffId = selected.length === 1 ? selected[0] : firstActive.id`.
- [ ] **Step 2:** Components as specified. Keep the solo path pixel-identical: `StaffFilter` hidden, no chip, no column, no selects.
- [ ] **Step 3:** `npm run verify`; `npx vitest run --config vitest.integration.config.ts src/features/scheduling/admin-booking-rpc.integration.test.ts` → PASS; smoke: 2-staff org — filter chips, walk-in with staff select, move Anna's booking to default staff via the reschedule dialog, both colours visible. Commit — `feat(team): calendar staff filter/colours, walk-in + move with staff, list column`.

---

### Task 13: Verification sweep, docs, graph

- [ ] **Step 1:** `npm run verify && npm run build && npm run test:integration` → all PASS (paste the summary lines in the task report).
- [ ] **Step 2:** Solo regression smoke (Playwright MCP, demo org): `/book/demo-studio` no staff step; `/availability` no tabs; `/bookings` no filter; `/services` no checklist; `/team` shows exactly one row (the org name) with the copy link.
- [ ] **Step 3:** Update `docs/superpowers/specs/2026-08-17-team-staff-design.md` header `Status: Implemented (PR #…)`; note the 0040/0041 split. `graphify update .`.
- [ ] **Step 4:** Commit — `docs(team): mark spec implemented; graph update`. Then use `superpowers:finishing-a-development-branch` (PR against `main`; this branch also carries the R3 spec/plan + parking commit — mention that in the PR body).

---

## Self-review notes (done while writing)

- **Spec coverage:** data model/migration → T1–T2; RPCs → T3–T4 (+T8 resolver `staff_id`); engine/loaders → T5; public flow + pages + embed → T6–T7; manage → T8; Team page → T9; availability → T10; services → T11; calendar/list/dialogs → T12; emails/ICS → T6/T8/T12; testing → per task; onboarding (`create_org` seed) → T2. Not covered by design: stats per staff (out of scope).
- **Deviations from spec, ruled here:** (1) two migration files (0040 generated + 0041 custom) per repo convention; (2) `create_booking` returns a table (needs `booking_id, staff_id, staff_name`) instead of `uuid`; (3) staff "new booking" notice exists (spec) although the provider gets none today — cheap, and it's what was chosen; (4) calendar block/unblock requires exactly one selected staff (spec silent — the exception rows are per staff so this is the only coherent rule); (5) `resolve_booking_token`/`cancel_booking` also return `staff_id` for the actions' notice path.
- **Type consistency:** `PublicStaff` (public loaders) vs `StaffRow` (admin queries) are intentionally distinct; `staffChoice = "any" | uuid` is the public wire type; `loadOrgSlotContext` opts `{ staffId: string | "any"; excludeBookingId? }` everywhere; `sendStaffNotice` signature fixed in T6 and reused in T8/T12.

