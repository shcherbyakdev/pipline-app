# Scheduling Core (Slice S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A provider defines services and weekly availability in the dashboard, and their clients book appointments (double-book-proof, timezone-correct) on a public page `/book/[handle]`, receiving a confirmation email with a manage link and an ICS download.

**Architecture:** New `scheduling` feature domain (4 new tables + a pure slot engine) on the existing platform layer. All public writes go through anon-callable SECURITY DEFINER RPCs; double-booking is prevented by a Postgres `EXCLUDE USING gist` constraint (the repo's first — requires `btree_gist`). Admin CRUD uses the established RLS member-CRUD + server-action pattern. Legacy fire-safety nav is removed (code/tables kept).

**Tech Stack:** Next 16.3 (typed `PageProps`/`RouteContext`, async params), React 19, Supabase (RLS + definer RPCs), Drizzle (schema/migrations only), zod v4, Tailwind v4 + shadcn (base-nova, @base-ui/react), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-scheduling-pivot-vision-and-roadmap-design.md`. Work on branch `scheduling-pivot`.
- Next 16: `params`/`searchParams` are Promises — always `await`; type pages as `PageProps<"/route/[param]">` (route groups stripped from the literal), route handlers as `RouteContext<"/...">`. Never hand-write `{ params: Promise<...> }`.
- zod v4 style: `z.uuid()`, not `z.string().uuid()`. Input schemas live in the feature's `schema.ts`, never inline in actions (re-export `GENERIC_WRITE_ERROR, type ActionState` from `@/lib/actions`).
- Server actions: file starts with `"use server";`, take `(input: unknown)`, `safeParse`, return `ActionState`-shaped unions, log raw errors via a local `fail(context, error)`, then `revalidatePath(...)`. Specific user-facing messages only where actionable (e.g. mapped SQLSTATEs).
- Supabase clients: staff actions/queries → `await createClient()` from `@/lib/supabase/server`; public token/RPC paths → `createAnonServerClient()`; `createAdminClient()` only inside lib modules that scope every query explicitly (`src/lib/booking/` here, per the `getOrgBranding` precedent).
- Migrations: `0025_*` is drizzle-kit **generated** (`npm run db:generate`), `0026_scheduling_security.sql` is **hand-written custom** (`npx drizzle-kit generate --custom`). Every new table: enable RLS, revoke-then-narrow grants **including `truncate`**, policies keyed on `org_id in (select public.user_orgs())`. Definer RPCs: `security definer set search_path = ''`, fully-qualified `public.*` names, generic `'not found'` raises, revoke-from-all-then-grant-one-caller.
- CI runs `npx drizzle-kit generate` and fails on drift — the TS schema and 0025 must match exactly.
- No date library. All instants are UTC `Date`s; `now: Date` is always an injected parameter of pure functions, never read inside. Timezone conversion via `Intl.DateTimeFormat` only.
- Email: `selectTransport()` + `OutboundEmail` (html+text+idempotencyKey). No attachments exist — the ICS is a hosted download route, not an attachment.
- Weekday convention everywhere: **0 = Sunday … 6 = Saturday** (JS `getUTCDay()`).
- Verify per task: `npm run verify` (lint + typecheck + unit tests). DB tasks also: `npm run test:integration` (needs `npm run setup` / local Supabase running).
- Commit after every task on `scheduling-pivot`; message style `feat: scheduling — <what>` / `test:` / `chore:`.

## Deviations from the spec (decided during planning — carry into the spec if challenged)

1. **ICS is a hosted download link** (`/booking/[token]/calendar.ics`), not an email attachment — `OutboundEmail`/both transports have zero attachment support and the hand-rolled SMTP transport would need real MIME multipart. Same user value, no transport surgery.
2. **`clients_org_lower_name_uq` is dropped.** Booking-created end-customers legitimately share names; the upsert key becomes a partial unique index on `(org_id, lower(email)) where email is not null`. `clients` gains a nullable `email` column.
3. **`bookings` denormalizes `client_name`/`client_email`** and `client_id` is `on delete set null` — a booking is a historical record that must survive client deletion.
4. Confirmation email is sent **inline once** (try/catch, booking survives failure); retry machinery arrives with S2's drain.
5. A **minimal read-only `/booking/[token]` page ships in S1** so the manage link in the email isn't dead; cancel/reschedule actions remain S2.
6. `orgs.slug` stays untouched (legacy); the new nullable `orgs.handle` governs the booking URL. The booking page 404s until the provider sets a handle in Settings.
7. **Direct-RPC residual (accepted for S1):** the 30/min rate limit and fine-grained slot validation (grid, min-notice, max-per-day, availability) live in the server actions only; a caller hitting `create_booking` directly via PostgREST bypasses both — the RPC enforces org/service integrity, basic sanity, the booking window, and the EXCLUDE overlap guard. Accepted as Calendly-MVP-grade abuse posture; S2 hardening: per-org insert throttle and/or availability check inside the RPC.

## File Structure

```
Create:
  src/db/schema/scheduling.ts                      services, availabilityRules, availabilityExceptions, bookings
  src/db/migrations/0025_<codename>.sql            generated DDL
  src/db/migrations/0026_scheduling_security.sql   extension, EXCLUDE, CHECKs, RLS, grants, triggers, 3 RPCs
  src/features/scheduling/slots.ts                 pure slot engine + tz helpers
  src/features/scheduling/slots.test.ts
  src/features/scheduling/ics.ts                   pure ICS builder
  src/features/scheduling/ics.test.ts
  src/features/scheduling/templates.ts             confirmation email
  src/features/scheduling/schema.ts                zod inputs + ActionState re-export
  src/features/scheduling/schema.test.ts
  src/features/scheduling/queries.ts               staff queries (services, rules, exceptions)
  src/features/scheduling/actions.ts               staff actions (services, availability, org scheduling settings)
  src/features/scheduling/public-actions.ts        getSlots, createBooking (anon surface)
  src/features/scheduling/rls.integration.test.ts
  src/features/scheduling/booking-rpc.integration.test.ts
  src/features/scheduling/components/service-dialog.tsx
  src/features/scheduling/components/services-list.tsx
  src/features/scheduling/components/availability-editor.tsx
  src/features/scheduling/components/scheduling-settings-form.tsx
  src/features/scheduling/components/booking-widget.tsx
  src/lib/booking/public.ts                        admin-client reads scoped by handle/orgId
  src/lib/tokens/booking.ts                        resolveBookingToken
  src/app/book/layout.tsx
  src/app/book/[handle]/page.tsx
  src/app/booking/[token]/page.tsx
  src/app/booking/[token]/calendar.ics/route.ts
  src/app/(dashboard)/services/page.tsx
  src/app/(dashboard)/availability/page.tsx
Modify:
  src/db/schema/orgs.ts                            + handle, timezone
  src/db/schema/clients.ts                         + email; drop name unique index
  src/db/schema/index.ts                           barrel comment + export
  src/lib/tokens/index.ts                          export * from "./booking"
  src/lib/tokens/rate-limit.ts                     + publicBookingLimiter
  src/components/shell/nav.ts                      new NAV_ITEMS
  src/components/command-menu.tsx                  Actions group
  src/app/(dashboard)/settings/page.tsx            + SchedulingSettingsForm
  src/features/orgs/queries.ts                     + getSchedulingSettings
  scripts/seed.ts                                  demo service/availability/handle + booking URL
```

---

### Task 1: Drizzle schema + generated migration 0025

**Files:**
- Create: `src/db/schema/scheduling.ts`
- Modify: `src/db/schema/orgs.ts`, `src/db/schema/clients.ts`, `src/db/schema/index.ts`
- Create (generated): `src/db/migrations/0025_<codename>.sql`

**Interfaces:**
- Produces: Drizzle tables `services`, `availabilityRules`, `availabilityExceptions`, `bookings`; `orgs.handle`, `orgs.timezone`; `clients.email`. Column names are consumed by every later task via supabase-js (snake_case).

- [ ] **Step 1: Write `src/db/schema/scheduling.ts`**

```ts
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { clients } from "./clients";

// Scheduling pivot (S1). CHECKs, RLS, grants, the EXCLUDE double-book guard,
// triggers, and RPCs all live in 0026 (custom SQL keeps the security surface
// in one reviewable place — the 0013 idiom).

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMin: integer("duration_min").notNull(),
    // Free text ("€80", "80 € / Stunde") — no payments at MVP.
    priceLabel: text("price_label"),
    bufferBeforeMin: integer("buffer_before_min").default(0).notNull(),
    bufferAfterMin: integer("buffer_after_min").default(0).notNull(),
    minNoticeMin: integer("min_notice_min").default(0).notNull(),
    // null = unlimited bookings per day.
    maxPerDay: integer("max_per_day"),
    bookingWindowDays: integer("booking_window_days").default(60).notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("services_org_id_idx").on(t.orgId)],
);

export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 0 = Sunday … 6 = Saturday (JS getUTCDay convention). CHECK in 0026.
    weekday: integer("weekday").notNull(),
    // Org-local wall-clock "HH:MM". Format CHECK in 0026. The slot engine
    // converts to UTC per concrete date (DST-safe) — a `time` column would
    // not carry more meaning and complicates the pure-function inputs.
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("availability_rules_org_id_idx").on(t.orgId)],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Org-local calendar date the exception applies to.
    date: date("date").notNull(),
    // closed=true ⇒ whole day off (start/end null). closed=false ⇒ this
    // window REPLACES the weekday rules for that date. CHECK in 0026.
    closed: boolean("closed").default(true).notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("availability_exceptions_org_date_idx").on(t.orgId, t.date)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    // set null: a booking is a historical record that survives client
    // deletion — the denormalized name/email below keep it self-contained.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    clientName: text("client_name").notNull(),
    clientEmail: text("client_email").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // 'confirmed' | 'cancelled_by_client' | 'cancelled_by_provider' |
    // 'rescheduled' — CHECK in 0026. The EXCLUDE guard covers 'confirmed' only.
    status: text("status").default("confirmed").notNull(),
    // sha256 hex of the manage token (mint.ts idiom). The raw token is
    // returned once from create_booking's caller and never stored.
    cancelTokenHash: text("cancel_token_hash").notNull(),
    note: text("note"),
    // Self-FK deferred to 0026 (drizzle self-reference needs AnyPgColumn
    // gymnastics; the deferred-FK idiom from access_tokens.chase_id is
    // simpler and established).
    rescheduledFromId: uuid("rescheduled_from_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("bookings_org_id_idx").on(t.orgId),
    index("bookings_org_starts_at_idx").on(t.orgId, t.startsAt),
    index("bookings_service_id_idx").on(t.serviceId),
    index("bookings_client_id_idx").on(t.clientId),
    uniqueIndex("bookings_cancel_token_hash_uq").on(t.cancelTokenHash),
  ],
);
```

- [ ] **Step 2: Extend `src/db/schema/orgs.ts`**

Add to the `orgs` column object, after `logoPath`:

```ts
  // Public booking URL segment (/book/[handle]). Nullable — the booking
  // page 404s until the provider picks one in Settings. Written ONLY via
  // the update_org_scheduling definer RPC (orgs stays select-only — 0004).
  // Format CHECK lives in 0026. Distinct from slug (legacy, non-editable).
  handle: text("handle").unique(),
  // IANA zone for availability wall-times. Validated against
  // pg_timezone_names inside update_org_scheduling.
  timezone: text("timezone").default("UTC").notNull(),
```

- [ ] **Step 3: Extend `src/db/schema/clients.ts`**

Add after `name`:

```ts
    // Booking-created clients are keyed by email; hand-created ones may
    // lack it. Partial unique (org_id, lower(email)) lives in 0026.
    email: text("email"),
```

Remove the `uniqueIndex("clients_org_lower_name_uq")...` line and its comment from the index array (booking-created end-customers legitimately share names — pivot decision, see plan header). Keep `index("clients_org_id_idx")`. If the `sql` import becomes unused, remove it.

- [ ] **Step 4: Update the barrel `src/db/schema/index.ts`**

Add `export * from "./scheduling";` and extend the `// Current:` comment with `services, availabilityRules, availabilityExceptions, bookings`.

- [ ] **Step 5: Generate and apply the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0025_<codename>.sql` containing CREATE TABLE for the four tables, ALTER TABLE for `orgs` (handle, timezone) and `clients` (email), `DROP INDEX "clients_org_lower_name_uq"`, and the new indexes. Inspect it — it must NOT contain grants/policies (those are 0026's job).

Run: `npm run db:migrate`
Expected: applies cleanly against the local stack (`npm run setup` first if not running).

- [ ] **Step 6: Verify no drift and commit**

Run: `npm run db:generate`
Expected: "No schema changes, nothing to migrate" (no new file, `git status` clean apart from intended files).

Run: `npm run verify`
Expected: PASS (schema files compile; no behavior change yet).

```bash
git add src/db/schema src/db/migrations
git commit -m "feat: scheduling — tables for services, availability, bookings (0025)"
```

---

### Task 2: Security migration 0026 (EXCLUDE guard, RLS, grants, RPCs)

**Files:**
- Create: `src/db/migrations/0026_scheduling_security.sql`

**Interfaces:**
- Produces (consumed by all later tasks):
  - `public.create_booking(p_handle text, p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text, p_note text, p_token_hash text) returns uuid` — anon-exec.
  - `public.resolve_booking_token(p_token text) returns table (booking_id uuid, booking_status text, starts_at timestamptz, ends_at timestamptz, service_name text, org_name text, org_timezone text)` — anon-exec, empty result = miss.
  - `public.update_org_scheduling(p_org_id uuid, p_handle text, p_timezone text) returns void` — authenticated-exec, full-state semantics.
  - SQLSTATEs callers map: `23P01` (slot overlap) from create_booking, `23505` (handle taken) from update_org_scheduling, `23503` (service has bookings) from service delete.

- [ ] **Step 1: Scaffold the custom migration**

Run: `npx drizzle-kit generate --custom --name=scheduling_security`
Expected: empty `src/db/migrations/0026_scheduling_security.sql` starting with `-- Custom SQL migration file, put your code below! --`.

- [ ] **Step 2: Write the migration body**

```sql
-- Custom SQL migration file, put your code below! --

-- Scheduling security model (pivot slice S1):
--   * services / availability_rules / availability_exceptions: ordinary
--     member CRUD (participants/0013 idiom) — staff manage them directly
--     under RLS.
--   * bookings: created ONLY by the anon-callable create_booking definer
--     RPC (the public page's single write path); staff read them; S2 adds
--     column-scoped status updates. No delete — bookings are history.
--   * Double-booking is impossible at the DB level: EXCLUDE USING gist
--     over (org_id, tstzrange(starts_at, ends_at)) on confirmed rows.
--     First use of btree_gist in this repo.
--   * orgs.handle/timezone are written only via update_org_scheduling
--     (orgs stays select-only for authenticated — 0004/0018 idiom).

create extension if not exists btree_gist;

-- ---------- Self-FK deferred from 0025 (module-cycle idiom, cf. 0020)
alter table public.bookings
  add constraint bookings_rescheduled_from_id_fk
  foreign key (rescheduled_from_id) references public.bookings(id)
  on delete set null;

-- ---------- CHECKs (text-column enums + sanity, the 0008 idiom)
alter table public.orgs
  add constraint orgs_handle_format_check
  check (handle is null or handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$');

alter table public.services
  add constraint services_duration_check
    check (duration_min between 5 and 480),
  add constraint services_buffer_before_check
    check (buffer_before_min between 0 and 240),
  add constraint services_buffer_after_check
    check (buffer_after_min between 0 and 240),
  add constraint services_min_notice_check
    check (min_notice_min between 0 and 20160),
  add constraint services_window_check
    check (booking_window_days between 1 and 365),
  add constraint services_max_per_day_check
    check (max_per_day is null or max_per_day between 1 and 100);

alter table public.availability_rules
  add constraint availability_rules_weekday_check
    check (weekday between 0 and 6),
  add constraint availability_rules_time_format_check
    check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add constraint availability_rules_order_check
    check (start_time < end_time);

alter table public.availability_exceptions
  add constraint availability_exceptions_shape_check
    check (
      (closed and start_time is null and end_time is null)
      or (not closed
          and start_time is not null
          and end_time is not null
          and start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and end_time   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          and start_time < end_time)
    );

alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','cancelled_by_client','cancelled_by_provider','rescheduled')),
  add constraint bookings_order_check
    check (starts_at < ends_at),
  add constraint bookings_client_name_check
    check (length(btrim(client_name)) between 1 and 200),
  add constraint bookings_client_email_check
    check (length(client_email) between 3 and 320),
  add constraint bookings_note_check
    check (note is null or length(note) <= 2000);

-- ---------- THE double-book guard. Rows with '[)' bounds: back-to-back
-- bookings (10:00-10:30, 10:30-11:00) do not conflict. Buffers are an
-- engine concern; the constraint guards the appointment itself against
-- races on the same slot.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    org_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (status = 'confirmed');

-- ---------- Client upsert key for booking-created clients. Partial unique
-- indexes are not expressible in the TS schema (established limitation).
create unique index clients_org_lower_email_uq
  on public.clients (org_id, lower(email))
  where email is not null;

-- ---------- RLS
alter table public.services enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.bookings enable row level security;

create policy "services_select_member" on public.services
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "services_insert_member" on public.services
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "services_update_member" on public.services
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "services_delete_member" on public.services
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "availability_rules_select_member" on public.availability_rules
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "availability_rules_insert_member" on public.availability_rules
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "availability_rules_delete_member" on public.availability_rules
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "availability_exceptions_select_member" on public.availability_exceptions
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "availability_exceptions_insert_member" on public.availability_exceptions
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "availability_exceptions_delete_member" on public.availability_exceptions
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "bookings_select_member" on public.bookings
  for select to authenticated using (org_id in (select public.user_orgs()));
-- No insert/update/delete policies for authenticated: creation is the
-- create_booking RPC's job; S2 adds column-scoped status updates.

-- ---------- Grants (0004 doctrine: revoke-then-narrow, truncate explicit,
-- anon starts with nothing thanks to 0013's default-privileges sweep).
revoke insert, update, delete, truncate on table public.services from authenticated;
grant select, insert, update, delete on table public.services to authenticated;
grant select on table public.services to service_role;
revoke truncate on table public.services from authenticated, service_role;

revoke insert, update, delete, truncate on table public.availability_rules from authenticated;
grant select, insert, delete on table public.availability_rules to authenticated;
grant select on table public.availability_rules to service_role;
revoke truncate on table public.availability_rules from authenticated, service_role;

revoke insert, update, delete, truncate on table public.availability_exceptions from authenticated;
grant select, insert, delete on table public.availability_exceptions to authenticated;
grant select on table public.availability_exceptions to service_role;
revoke truncate on table public.availability_exceptions from authenticated, service_role;

revoke insert, update, delete, truncate on table public.bookings from authenticated;
grant select on table public.bookings to authenticated;
-- service_role: insert for test seeding now, update for S2's reminder
-- drain + admin cancel. Never delete — bookings are history.
grant select, insert, update on table public.bookings to service_role;
revoke delete, truncate on table public.bookings from authenticated, service_role;

-- ---------- Org-consistency guard (check_chase_org idiom): a booking's
-- service and client must belong to its org.
create or replace function public.check_booking_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.services where id = new.service_id;
  if v_org is null then raise exception 'service not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
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
end;
$$;

create trigger bookings_org_guard
  before insert or update of org_id, service_id, client_id, rescheduled_from_id
  on public.bookings
  for each row execute function public.check_booking_org();

-- ---------- RPC 1: the public page's single write path. SECURITY DEFINER:
-- anon has no table grants at all; the function IS the capability. Fine-
-- grained slot validity is checked app-side (the engine re-runs before
-- calling); this function enforces org/service integrity, basic input
-- sanity, and lets bookings_no_overlap settle races (23P01 to the caller).
create or replace function public.create_booking(
  p_handle text,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_name text,
  p_email text,
  p_note text,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_service record;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select id into v_org from public.orgs where handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;

  select id, duration_min, booking_window_days into v_service
    from public.services
    where id = p_service_id and org_id = v_org.id and active;
  if v_service.id is null then raise exception 'not found'; end if;

  if p_starts_at is null or p_starts_at <= now() then
    raise exception 'not found';
  end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'not found';
  end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not found';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'not found';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = excluded.name
  returning id into v_client_id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_org.id, p_service_id, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, p_starts_at + make_interval(mins => v_service.duration_min),
     'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_booking(text, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text)
  to anon;

-- ---------- RPC 2: manage-link resolver (resolve_portal_token idiom:
-- anon-exec, hash lookup, uniform empty result on any miss).
create or replace function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid,
  booking_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  org_name text,
  org_timezone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  return query
    select b.id, b.status, b.starts_at, b.ends_at, s.name, o.name, o.timezone
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.cancel_token_hash = v_hash;
end;
$$;

revoke all on function public.resolve_booking_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

-- ---------- RPC 3: the only write path to orgs.handle/timezone
-- (update_org_branding idiom: member check via user_orgs, full-state
-- semantics, generic raises).
create or replace function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = p_org_id;
end;
$$;

revoke all on function public.update_org_scheduling(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text)
  to authenticated;
```

- [ ] **Step 3: Apply and smoke-check**

Run: `npm run db:migrate`
Expected: applies cleanly.

Run: `npm run db:generate`
Expected: no drift (custom migrations are invisible to the TS schema; nothing new generated).

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations
git commit -m "feat: scheduling — security migration 0026 (EXCLUDE guard, RLS, booking RPCs)"
```

---

### Task 3: RLS integration tests for the scheduling tables

**Files:**
- Create: `src/features/scheduling/rls.integration.test.ts`

**Interfaces:**
- Consumes: tables + policies from Tasks 1–2.

- [ ] **Step 1: Write the test file**

Mirror the alice/bob fixture from `src/features/programs/rls.integration.test.ts` (globally unique tag prefix, order-dependent `it` blocks, `loadEnvFile(".env.local")` in try/catch, service-role `admin` client for privileged assertions).

```ts
/**
 * Tenant isolation + anon-surface posture for the scheduling tables.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("RLS scheduling", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let bobOrgId: string;
  let aliceServiceId: string;

  beforeAll(async () => {
    alice = await signedInUser("sched_alice");
    bob = await signedInUser("sched_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "SchedAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { data: orgB, error: e2 } = await bob.rpc("create_org", { p_name: "SchedBeta" });
    if (e2) throw e2;
    bobOrgId = (orgB as { id: string }).id;
  });

  it("member can create a service in their org", async () => {
    const { data, error } = await alice
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Intro Call", duration_min: 30 })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceServiceId = data!.id;
  });

  it("member cannot create a service in a foreign org", async () => {
    const { error } = await bob
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Sneaky", duration_min: 30 });
    expect(error).not.toBeNull();
  });

  it("foreign services are invisible", async () => {
    const { data } = await bob.from("services").select("id").eq("org_id", aliceOrgId);
    expect(data).toEqual([]);
  });

  it("CHECK rejects an out-of-range duration", async () => {
    const { error } = await alice
      .from("services")
      .insert({ org_id: aliceOrgId, name: "Marathon", duration_min: 9999 });
    expect(error).not.toBeNull();
  });

  it("member manages availability rules; foreign org blocked", async () => {
    const { error } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, weekday: 1, start_time: "09:00", end_time: "17:00" });
    expect(error).toBeNull();
    const { error: crossErr } = await bob
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, weekday: 1, start_time: "09:00", end_time: "17:00" });
    expect(crossErr).not.toBeNull();
  });

  it("CHECK rejects a malformed time and an inverted window", async () => {
    const { error: badFormat } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, weekday: 2, start_time: "9am", end_time: "17:00" });
    expect(badFormat).not.toBeNull();
    const { error: inverted } = await alice
      .from("availability_rules")
      .insert({ org_id: aliceOrgId, weekday: 2, start_time: "17:00", end_time: "09:00" });
    expect(inverted).not.toBeNull();
  });

  it("exception shape CHECK: open exception needs a valid window", async () => {
    const { error } = await alice
      .from("availability_exceptions")
      .insert({ org_id: aliceOrgId, date: "2027-01-04", closed: false });
    expect(error).not.toBeNull();
    const { error: ok } = await alice
      .from("availability_exceptions")
      .insert({ org_id: aliceOrgId, date: "2027-01-04", closed: true });
    expect(ok).toBeNull();
  });

  it("anon reads nothing from any scheduling table", async () => {
    for (const table of ["services", "availability_rules", "availability_exceptions", "bookings"]) {
      const { data, error } = await anon.from(table).select("id").limit(1);
      // Grant-less access surfaces as an error or an empty set depending on
      // PostgREST version — both prove the deny posture.
      expect(error !== null || data?.length === 0).toBe(true);
    }
  });

  it("authenticated cannot insert bookings directly (RPC-only path)", async () => {
    const { error } = await alice.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: aliceServiceId,
      client_name: "X",
      client_email: "x@example.com",
      starts_at: "2027-01-05T10:00:00Z",
      ends_at: "2027-01-05T10:30:00Z",
      cancel_token_hash: "a".repeat(64),
    });
    expect(error).not.toBeNull();
  });

  it("member sees own-org bookings; foreign org sees none", async () => {
    const { error } = await admin.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: aliceServiceId,
      client_name: "Seeded",
      client_email: "seeded@example.com",
      starts_at: "2027-01-06T10:00:00Z",
      ends_at: "2027-01-06T10:30:00Z",
      cancel_token_hash: "b".repeat(64),
    });
    expect(error).toBeNull();
    const { data: mine } = await alice.from("bookings").select("id").eq("org_id", aliceOrgId);
    expect(mine!.length).toBeGreaterThan(0);
    const { data: theirs } = await bob.from("bookings").select("id").eq("org_id", aliceOrgId);
    expect(theirs).toEqual([]);
  });

  it("org guard trigger rejects a cross-org service on a booking", async () => {
    const { data: bobService, error: e } = await bob
      .from("services")
      .insert({ org_id: bobOrgId, name: "Bob Svc", duration_min: 30 })
      .select("id")
      .single();
    expect(e).toBeNull();
    const { error } = await admin.from("bookings").insert({
      org_id: aliceOrgId,
      service_id: bobService!.id,
      client_name: "X",
      client_email: "x2@example.com",
      starts_at: "2027-01-07T10:00:00Z",
      ends_at: "2027-01-07T10:30:00Z",
      cancel_token_hash: "c".repeat(64),
    });
    expect(error).not.toBeNull();
  });
});
```

Note: the direct-insert assertions via `admin` rely on `service_role`'s `insert` grant on `bookings` from 0026.

- [ ] **Step 2: Run the suite**

Run: `npm run test:integration -- src/features/scheduling/rls.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/rls.integration.test.ts src/db/migrations
git commit -m "test: scheduling — RLS tenant isolation + anon posture"
```

---

### Task 4: Booking RPC integration tests (create_booking, resolver, EXCLUDE guard)

**Files:**
- Create: `src/features/scheduling/booking-rpc.integration.test.ts`

**Interfaces:**
- Consumes: `create_booking`, `resolve_booking_token`, `update_org_scheduling` RPCs (Task 2); `generateAccessToken` from `@/lib/tokens/mint`.

- [ ] **Step 1: Write the test file**

```ts
/**
 * Public booking write path: create_booking + resolve_booking_token +
 * the EXCLUDE double-book guard. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const HANDLE = `bkg-rpc-${Date.now()}`;
const START = "2027-03-01T10:00:00Z";

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("create_booking RPC", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let serviceId: string;

  beforeAll(async () => {
    owner = await signedInUser("bkg_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "BookingCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "Europe/Berlin",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      // window 365: the fixed 2027 test dates must stay inside the
      // booking window create_booking enforces (default 60 would reject
      // them with its uniform 'not found').
      .insert({ org_id: orgId, name: "Consult", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
  });

  it("update_org_scheduling rejects a bogus timezone and a bad handle", async () => {
    const { error: tz } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "Mars/Olympus",
    });
    expect(tz).not.toBeNull();
    const { error: h } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: "Bad Handle!",
      p_timezone: "Europe/Berlin",
    });
    expect(h).not.toBeNull();
  });

  it("anon books happy-path: booking + upserted client + resolvable token", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { data, error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: START,
      p_name: "Jamie Doe",
      p_email: "Jamie@Example.com",
      p_note: "first visit",
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const bookingId = data as string;

    const { data: booking } = await admin
      .from("bookings")
      .select("org_id, service_id, client_id, client_email, status, ends_at")
      .eq("id", bookingId)
      .single();
    expect(booking!.org_id).toBe(orgId);
    expect(booking!.client_email).toBe("jamie@example.com"); // lowercased
    expect(booking!.status).toBe("confirmed");
    expect(new Date(booking!.ends_at).toISOString()).toBe("2027-03-01T11:00:00.000Z");

    const { data: client } = await admin
      .from("clients")
      .select("id, name")
      .eq("org_id", orgId)
      .eq("email", "jamie@example.com")
      .single();
    expect(client!.id).toBe(booking!.client_id);

    const { data: resolved, error: rErr } = await anon.rpc("resolve_booking_token", {
      p_token: token,
    });
    expect(rErr).toBeNull();
    const row = (resolved as Array<{ booking_id: string; org_timezone: string }>)[0];
    expect(row.booking_id).toBe(bookingId);
    expect(row.org_timezone).toBe("Europe/Berlin");
  });

  it("re-booking with the same email reuses the client row", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-02T10:00:00Z",
      p_name: "Jamie D.",
      p_email: "jamie@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const { data: clients } = await admin
      .from("clients")
      .select("id")
      .eq("org_id", orgId)
      .eq("email", "jamie@example.com");
    expect(clients!.length).toBe(1);
  });

  it("overlapping confirmed booking is rejected with 23P01", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-01T10:30:00Z", // overlaps the 10:00–11:00 booking
      p_name: "Race Loser",
      p_email: "race@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23P01");
  });

  it("back-to-back booking (11:00 after 10:00–11:00) is allowed", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-01T11:00:00Z",
      p_name: "Adjacent",
      p_email: "adjacent@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(error).toBeNull();
  });

  it("unknown handle, inactive service, and past start are all generic misses", async () => {
    const { tokenHash } = generateAccessToken();
    const { error: badHandle } = await anon.rpc("create_booking", {
      p_handle: "no-such-handle",
      p_service_id: serviceId,
      p_starts_at: "2027-03-03T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: tokenHash,
    });
    expect(badHandle).not.toBeNull();
    expect(badHandle!.message).toContain("not found");

    await admin.from("services").update({ active: false }).eq("id", serviceId);
    const { error: inactive } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2027-03-03T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(inactive).not.toBeNull();
    await admin.from("services").update({ active: true }).eq("id", serviceId);

    const { error: past } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: "2020-01-01T10:00:00Z",
      p_name: "X",
      p_email: "x@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(past).not.toBeNull();
  });

  it("resolve_booking_token returns empty for a wrong token", async () => {
    const { data } = await anon.rpc("resolve_booking_token", {
      p_token: "definitely-not-a-real-token-value",
    });
    expect(data).toEqual([]);
  });

  it("cancelled bookings stop blocking the slot", async () => {
    await admin
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("org_id", orgId)
      .eq("starts_at", START);
    const { error } = await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: START,
      p_name: "Second Chance",
      p_email: "second@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:integration -- src/features/scheduling/booking-rpc.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/booking-rpc.integration.test.ts
git commit -m "test: scheduling — create_booking RPC, resolver, EXCLUDE guard"
```

---

### Task 5: Pure slot engine (TDD)

**Files:**
- Create: `src/features/scheduling/slots.ts`, `src/features/scheduling/slots.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 9, 14):
  - `wallTimeToUtc(date: string, time: string, timeZone: string): Date`
  - `dateInZone(instant: Date, timeZone: string): string` (YYYY-MM-DD)
  - `addDaysISO(date: string, days: number): string`
  - `computeSlots(input: SlotInput): Date[]` with
    ```ts
    type SlotInput = {
      service: { durationMin: number; bufferBeforeMin: number; bufferAfterMin: number;
                 minNoticeMin: number; maxPerDay: number | null; bookingWindowDays: number };
      rules: Array<{ weekday: number; startTime: string; endTime: string }>;
      exceptions: Array<{ date: string; closed: boolean; startTime: string | null; endTime: string | null }>;
      busy: Array<{ startsAt: Date; endsAt: Date }>;
      timeZone: string;
      now: Date;
      fromDate: string; // org-local YYYY-MM-DD, first day to scan
      days: number;     // how many days to scan
    };
    ```

- [ ] **Step 1: Write the failing tests**

`src/features/scheduling/slots.test.ts` — fixture style copied from `cadence.test.ts` (fixed `T0`, builder with overrides):

```ts
import { describe, it, expect } from "vitest";
import { wallTimeToUtc, dateInZone, addDaysISO, computeSlots, type SlotInput } from "./slots";

const TZ = "Europe/Berlin";
// A Monday, well before any test slot.
const T0 = new Date("2027-02-01T00:00:00Z");

function input(over: Partial<SlotInput> = {}): SlotInput {
  return {
    service: {
      durationMin: 60,
      bufferBeforeMin: 0,
      bufferAfterMin: 0,
      minNoticeMin: 0,
      maxPerDay: null,
      bookingWindowDays: 365,
    },
    // Mon–Fri 09:00–17:00 (weekday 0 = Sunday).
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })),
    exceptions: [],
    busy: [],
    timeZone: TZ,
    now: T0,
    fromDate: "2027-02-01",
    days: 1,
    ...over,
  };
}

const iso = (d: Date) => d.toISOString();

describe("wallTimeToUtc", () => {
  it("converts Berlin winter time (UTC+1)", () => {
    expect(iso(wallTimeToUtc("2027-02-01", "09:00", TZ))).toBe("2027-02-01T08:00:00.000Z");
  });
  it("converts Berlin summer time (UTC+2)", () => {
    expect(iso(wallTimeToUtc("2027-07-01", "09:00", TZ))).toBe("2027-07-01T07:00:00.000Z");
  });
  it("handles the spring-forward day (EU DST 2027-03-28)", () => {
    // 09:00 local on the switch day is UTC+2 already.
    expect(iso(wallTimeToUtc("2027-03-28", "09:00", TZ))).toBe("2027-03-28T07:00:00.000Z");
  });
  it("handles the fall-back day (EU DST 2027-10-31)", () => {
    // 09:00 local after the switch is UTC+1 again.
    expect(iso(wallTimeToUtc("2027-10-31", "09:00", TZ))).toBe("2027-10-31T08:00:00.000Z");
  });
  it("passes UTC through untouched", () => {
    expect(iso(wallTimeToUtc("2027-02-01", "09:00", "UTC"))).toBe("2027-02-01T09:00:00.000Z");
  });
  it("resolves nonexistent gap-hour times by shifting forward", () => {
    // 02:30 local never exists on 2027-03-28 in Berlin (02:00 → 03:00).
    // Convention: shift forward across the gap → 03:30 local = 01:30Z.
    expect(iso(wallTimeToUtc("2027-03-28", "02:30", TZ))).toBe("2027-03-28T01:30:00.000Z");
  });
  it("resolves ambiguous fall-back times deterministically", () => {
    // 02:30 local occurs twice on 2027-10-31; the algorithm lands on the
    // second (CET, +1) occurrence every time.
    expect(iso(wallTimeToUtc("2027-10-31", "02:30", TZ))).toBe("2027-10-31T01:30:00.000Z");
  });
});

describe("dateInZone / addDaysISO", () => {
  it("maps a UTC instant to the org-local date", () => {
    // 23:30 UTC is already next-day in Berlin (UTC+1).
    expect(dateInZone(new Date("2027-02-01T23:30:00Z"), TZ)).toBe("2027-02-02");
  });
  it("adds days across a month boundary", () => {
    expect(addDaysISO("2027-02-27", 2)).toBe("2027-03-01");
  });
});

describe("computeSlots", () => {
  it("fills a full open day with duration-stepped slots", () => {
    const slots = computeSlots(input());
    // 09:00–17:00 Berlin winter = 08:00–16:00Z, 60-min slots → 8 slots.
    expect(slots.length).toBe(8);
    expect(iso(slots[0])).toBe("2027-02-01T08:00:00.000Z");
    expect(iso(slots[7])).toBe("2027-02-01T15:00:00.000Z");
  });

  it("returns nothing on a day without rules (Sunday)", () => {
    expect(computeSlots(input({ fromDate: "2027-02-07" }))).toEqual([]);
  });

  it("buffers shrink capacity and pad the step", () => {
    const slots = computeSlots(
      input({ service: { ...input().service, durationMin: 50, bufferBeforeMin: 5, bufferAfterMin: 5 } }),
    );
    // Block = 60 min → 8 blocks; slot starts at window+5min.
    expect(slots.length).toBe(8);
    expect(iso(slots[0])).toBe("2027-02-01T08:05:00.000Z");
  });

  it("min notice hides too-soon slots", () => {
    const slots = computeSlots(
      input({ now: new Date("2027-02-01T09:30:00Z"), service: { ...input().service, minNoticeMin: 120 } }),
    );
    // Earliest allowed start: 11:30Z → first grid slot 12:00Z.
    expect(iso(slots[0])).toBe("2027-02-01T12:00:00.000Z");
  });

  it("booking window caps the horizon", () => {
    const slots = computeSlots(
      input({ fromDate: "2027-02-08", days: 1, service: { ...input().service, bookingWindowDays: 3 } }),
    );
    expect(slots).toEqual([]);
  });

  it("busy intervals block overlapping slots (inflated by buffers)", () => {
    const slots = computeSlots(
      input({
        busy: [{ startsAt: new Date("2027-02-01T10:00:00Z"), endsAt: new Date("2027-02-01T11:00:00Z") }],
      }),
    );
    expect(slots.map(iso)).not.toContain("2027-02-01T10:00:00.000Z");
    expect(slots.length).toBe(7);
  });

  it("a closed exception empties the day", () => {
    const slots = computeSlots(
      input({ exceptions: [{ date: "2027-02-01", closed: true, startTime: null, endTime: null }] }),
    );
    expect(slots).toEqual([]);
  });

  it("an open exception REPLACES the weekday rules", () => {
    const slots = computeSlots(
      input({ exceptions: [{ date: "2027-02-01", closed: false, startTime: "13:00", endTime: "15:00" }] }),
    );
    expect(slots.length).toBe(2);
    expect(iso(slots[0])).toBe("2027-02-01T12:00:00.000Z");
  });

  it("maxPerDay counts existing busy starts on that org-local day", () => {
    const slots = computeSlots(
      input({
        service: { ...input().service, maxPerDay: 2 },
        busy: [
          { startsAt: new Date("2027-02-01T08:00:00Z"), endsAt: new Date("2027-02-01T09:00:00Z") },
          { startsAt: new Date("2027-02-01T09:00:00Z"), endsAt: new Date("2027-02-01T10:00:00Z") },
        ],
      }),
    );
    expect(slots).toEqual([]);
  });

  it("multi-day scan concatenates days in order", () => {
    const slots = computeSlots(input({ days: 3 }));
    // Mon+Tue+Wed × 8.
    expect(slots.length).toBe(24);
    expect(iso(slots[8])).toBe("2027-02-02T08:00:00.000Z");
  });

  it("split-shift rules produce two windows", () => {
    const slots = computeSlots(
      input({
        rules: [
          { weekday: 1, startTime: "09:00", endTime: "12:00" },
          { weekday: 1, startTime: "14:00", endTime: "17:00" },
        ],
      }),
    );
    expect(slots.length).toBe(6);
    expect(slots.map(iso)).not.toContain("2027-02-01T12:00:00.000Z");
  });

  it("slots are timezone-correct across DST inside one scan", () => {
    const slots = computeSlots(input({ fromDate: "2027-03-26", days: 4 })); // Fri..Mon over EU switch
    const friday = slots.filter((s) => dateInZone(s, TZ) === "2027-03-26");
    const monday = slots.filter((s) => dateInZone(s, TZ) === "2027-03-29");
    expect(iso(friday[0])).toBe("2027-03-26T08:00:00.000Z"); // UTC+1
    expect(iso(monday[0])).toBe("2027-03-29T07:00:00.000Z"); // UTC+2
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/scheduling/slots.test.ts`
Expected: FAIL — `Cannot find module './slots'`.

- [ ] **Step 3: Implement `src/features/scheduling/slots.ts`**

```ts
// Pure slot engine — no DB, no clock reads. `now` is always injected
// (cadence.ts convention). All returned instants are UTC Dates; the UI
// renders them in the viewer's timezone.

export type SlotService = {
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
};
export type SlotRule = { weekday: number; startTime: string; endTime: string };
export type SlotException = {
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
};
export type BusyInterval = { startsAt: Date; endsAt: Date };
export type SlotInput = {
  service: SlotService;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: BusyInterval[];
  timeZone: string;
  now: Date;
  fromDate: string;
  days: number;
};

const MIN = 60_000;
const DAY = 86_400_000;

// What wall-clock (as a UTC-encoded ms value) does `instant` show in `timeZone`?
function wallClockOf(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
}

// Org-local wall time → UTC instant, without a tz library: guess UTC, read
// back the wall-clock the guess shows in the zone, correct by the diff.
// The second pass settles DST-transition days.
export function wallTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    utc += target - wallClockOf(new Date(utc), timeZone);
  }
  // A wall time inside a DST spring-forward gap has no fixed point, so the
  // loop oscillates between the two adjacent-offset candidates. Resolve
  // deterministically by shifting FORWARD across the gap (the conventional
  // treatment of nonexistent local times): take the later candidate. For
  // every existing wall time `other === utc` and this is a no-op.
  const other = utc + (target - wallClockOf(new Date(utc), timeZone));
  return new Date(Math.max(utc, other));
}

export function dateInZone(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function addDaysISO(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) + days * DAY).toISOString().slice(0, 10);
}

// The org-local date's weekday is a property of the date itself.
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function computeSlots(input: SlotInput): Date[] {
  const { service, rules, exceptions, busy, timeZone, now, fromDate, days } = input;
  const notBefore = now.getTime() + service.minNoticeMin * MIN;
  const notAfter = now.getTime() + service.bookingWindowDays * DAY;
  const blockMs =
    (service.bufferBeforeMin + service.durationMin + service.bufferAfterMin) * MIN;
  const slots: Date[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDaysISO(fromDate, i);
    const dayExceptions = exceptions.filter((e) => e.date === date);
    if (dayExceptions.some((e) => e.closed)) continue;

    if (service.maxPerDay !== null) {
      const bookedToday = busy.filter((b) => dateInZone(b.startsAt, timeZone) === date).length;
      if (bookedToday >= service.maxPerDay) continue;
    }

    const overrides = dayExceptions.filter((e) => !e.closed);
    const windows: Array<{ startTime: string; endTime: string }> =
      overrides.length > 0
        ? overrides.map((e) => ({ startTime: e.startTime!, endTime: e.endTime! }))
        : rules.filter((r) => r.weekday === weekdayOf(date));

    for (const w of windows) {
      const winStart = wallTimeToUtc(date, w.startTime, timeZone).getTime();
      const winEnd = wallTimeToUtc(date, w.endTime, timeZone).getTime();
      for (let t = winStart; t + blockMs <= winEnd; t += blockMs) {
        const start = t + service.bufferBeforeMin * MIN;
        const end = start + service.durationMin * MIN;
        if (start < notBefore || start > notAfter) continue;
        const padStart = start - service.bufferBeforeMin * MIN;
        const padEnd = end + service.bufferAfterMin * MIN;
        const blocked = busy.some(
          (b) => padStart < b.endsAt.getTime() && b.startsAt.getTime() < padEnd,
        );
        if (blocked) continue;
        slots.push(new Date(start));
      }
    }
  }
  return slots;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/scheduling/slots.test.ts`
Expected: PASS (all cases, including both DST days).

- [ ] **Step 5: Run full verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/scheduling/slots.ts src/features/scheduling/slots.test.ts
git commit -m "feat: scheduling — pure slot engine with DST-safe tz math"
```

---

### Task 6: ICS builder + confirmation email template (TDD)

**Files:**
- Create: `src/features/scheduling/ics.ts`, `src/features/scheduling/ics.test.ts`, `src/features/scheduling/templates.ts`

**Interfaces:**
- Produces (consumed by Tasks 9–10):
  - `bookingIcs(input: { uid: string; starts: Date; ends: Date; summary: string; description: string; url: string }): string`
  - `bookingConfirmationEmail(input: { orgName: string; serviceName: string; whenLine: string; manageUrl: string; icsUrl: string }): { subject: string; html: string; text: string }`
  - `bookingIdempotencyKey(bookingId: string): string` → `booking/{id}/confirmation`
  - `formatWhenLine(starts: Date, timeZone: string): string` — e.g. `Mon, 01 Mar 2027, 11:00 (CET)`

- [ ] **Step 1: Write the failing ICS tests**

`src/features/scheduling/ics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bookingIcs } from "./ics";

const BASE = {
  uid: "11111111-2222-3333-4444-555555555555",
  starts: new Date("2027-03-01T10:00:00Z"),
  ends: new Date("2027-03-01T11:00:00Z"),
  summary: "Consultation — BookingCo",
  description: "Manage: https://example.com/booking/tok",
  url: "https://example.com/booking/tok",
};

describe("bookingIcs", () => {
  it("emits a well-formed UTC VEVENT with CRLF line ends", () => {
    const ics = bookingIcs(BASE);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20270301T100000Z");
    expect(ics).toContain("DTEND:20270301T110000Z");
    expect(ics).toContain(`UID:${BASE.uid}`);
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
  });

  it("escapes commas, semicolons and newlines in text fields", () => {
    const ics = bookingIcs({ ...BASE, summary: "A, B; C\nD" });
    expect(ics).toContain("SUMMARY:A\\, B\\; C\\nD");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/scheduling/ics.test.ts`
Expected: FAIL — `Cannot find module './ics'`.

- [ ] **Step 3: Implement `src/features/scheduling/ics.ts`**

```ts
// Minimal RFC 5545 VEVENT for the "add to calendar" download. All times
// UTC (Z suffix) — calendar apps localize on import.

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function bookingIcs(input: {
  uid: string;
  starts: Date;
  ends: Date;
  summary: string;
  description: string;
  url: string;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RolloutOS//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${icsStamp(input.starts)}`,
    `DTSTART:${icsStamp(input.starts)}`,
    `DTEND:${icsStamp(input.ends)}`,
    `SUMMARY:${icsEscape(input.summary)}`,
    `DESCRIPTION:${icsEscape(input.description)}`,
    `URL:${input.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/features/scheduling/ics.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/features/scheduling/templates.ts`**

Mirror `chasing/templates.ts` (local `esc`, template literals, text as joined array). Data discipline: service/org names and times only — no person names on a forwardable artifact.

```ts
// Confirmation email. Same discipline as chasing/templates.ts: the manage
// URL is the credential; org/service names and times only.

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function bookingIdempotencyKey(bookingId: string): string {
  return `booking/${bookingId}/confirmation`;
}

export function formatWhenLine(starts: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(starts);
}

export function bookingConfirmationEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Booking confirmed — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking is confirmed.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above is your access to the booking.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking is confirmed.",
    input.serviceName,
    input.whenLine,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
  ].join("\n");
  return { subject, html, text };
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/scheduling/ics.ts src/features/scheduling/ics.test.ts src/features/scheduling/templates.ts
git commit -m "feat: scheduling — ICS builder and confirmation email template"
```

---

### Task 7: Feature zod schemas (TDD)

**Files:**
- Create: `src/features/scheduling/schema.ts`, `src/features/scheduling/schema.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 8–13): all input schemas + shared consts below. Re-exports `GENERIC_WRITE_ERROR, type ActionState` from `@/lib/actions` (repo idiom).

- [ ] **Step 1: Write the failing tests**

`src/features/scheduling/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  serviceInput,
  availabilityRuleInput,
  availabilityExceptionInput,
  schedulingSettingsInput,
  getSlotsInput,
  createBookingInput,
} from "./schema";

describe("serviceInput", () => {
  it("accepts a minimal valid service", () => {
    const r = serviceInput.safeParse({ name: "Intro Call", durationMin: 30 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.bufferBeforeMin).toBe(0);
      expect(r.data.bookingWindowDays).toBe(60);
      expect(r.data.active).toBe(true);
      expect(r.data.maxPerDay).toBeNull();
    }
  });
  it("rejects out-of-range duration and empty name", () => {
    expect(serviceInput.safeParse({ name: "", durationMin: 30 }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "X", durationMin: 3 }).success).toBe(false);
    expect(serviceInput.safeParse({ name: "X", durationMin: 999 }).success).toBe(false);
  });
});

describe("availabilityRuleInput", () => {
  it("accepts weekday 0-6 with ordered HH:MM times", () => {
    expect(
      availabilityRuleInput.safeParse({ weekday: 1, startTime: "09:00", endTime: "17:00" }).success,
    ).toBe(true);
  });
  it("rejects weekday 7, bad format, inverted order", () => {
    expect(availabilityRuleInput.safeParse({ weekday: 7, startTime: "09:00", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: "9am", endTime: "17:00" }).success).toBe(false);
    expect(availabilityRuleInput.safeParse({ weekday: 1, startTime: "17:00", endTime: "09:00" }).success).toBe(false);
  });
});

describe("availabilityExceptionInput", () => {
  it("accepts closed day and open window", () => {
    expect(availabilityExceptionInput.safeParse({ date: "2027-01-04", closed: true }).success).toBe(true);
    expect(
      availabilityExceptionInput.safeParse({
        date: "2027-01-04",
        closed: false,
        startTime: "10:00",
        endTime: "12:00",
      }).success,
    ).toBe(true);
  });
  it("rejects open exception without a window", () => {
    expect(availabilityExceptionInput.safeParse({ date: "2027-01-04", closed: false }).success).toBe(false);
  });
  it("rejects a closed exception that carries a window", () => {
    expect(
      availabilityExceptionInput.safeParse({
        date: "2027-01-04",
        closed: true,
        startTime: "10:00",
        endTime: "12:00",
      }).success,
    ).toBe(false);
  });
});

describe("schedulingSettingsInput", () => {
  it("accepts a valid handle + timezone", () => {
    expect(
      schedulingSettingsInput.safeParse({ handle: "demo-studio", timezone: "Europe/Berlin" }).success,
    ).toBe(true);
  });
  it("rejects bad handles", () => {
    for (const handle of ["ab", "-bad", "bad-", "Bad", "has space", "a".repeat(51)]) {
      expect(schedulingSettingsInput.safeParse({ handle, timezone: "UTC" }).success).toBe(false);
    }
  });
});

describe("public inputs", () => {
  it("getSlotsInput bounds the scan", () => {
    expect(
      getSlotsInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        fromDate: "2027-02-01",
        days: 7,
      }).success,
    ).toBe(true);
    expect(
      getSlotsInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        fromDate: "2027-02-01",
        days: 60,
      }).success,
    ).toBe(false);
  });
  it("createBookingInput validates email and trims name", () => {
    const r = createBookingInput.safeParse({
      handle: "demo-studio",
      serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      startsAt: "2027-03-01T10:00:00.000Z",
      name: "  Jamie  ",
      email: "jamie@example.com",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Jamie");
    expect(
      createBookingInput.safeParse({
        handle: "demo-studio",
        serviceId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        startsAt: "2027-03-01T10:00:00.000Z",
        name: "Jamie",
        email: "not-an-email",
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/scheduling/schema.test.ts`
Expected: FAIL — `Cannot find module './schema'`.

- [ ] **Step 3: Implement `src/features/scheduling/schema.ts`**

```ts
import { z } from "zod";

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

export const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const timeField = z.string().regex(TIME_RE);

export const serviceInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  durationMin: z.number().int().min(5).max(480),
  priceLabel: z.string().trim().max(100).optional(),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  minNoticeMin: z.number().int().min(0).max(20160).default(0),
  maxPerDay: z.number().int().min(1).max(100).nullable().default(null),
  bookingWindowDays: z.number().int().min(1).max(365).default(60),
  active: z.boolean().default(true),
});
export const updateServiceInput = serviceInput.extend({ id: z.uuid() });
export const serviceIdInput = z.object({ id: z.uuid() });

export const availabilityRuleInput = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });
export const ruleIdInput = z.object({ id: z.uuid() });

export const availabilityExceptionInput = z
  .object({
    date: z.string().regex(DATE_RE),
    closed: z.boolean(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
  })
  .refine(
    (e) =>
      e.closed
        ? e.startTime === undefined && e.endTime === undefined
        : e.startTime !== undefined && e.endTime !== undefined && e.startTime < e.endTime,
    { message: "closed day has no window; open exception needs an ordered window" },
  );
export const exceptionIdInput = z.object({ id: z.uuid() });

export const schedulingSettingsInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  timezone: z.string().min(1).max(64),
});

export const getSlotsInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});

export const createBookingInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  note: z.string().trim().max(2000).optional(),
});
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run src/features/scheduling/schema.test.ts` then `npm run verify`
Expected: PASS.

```bash
git add src/features/scheduling/schema.ts src/features/scheduling/schema.test.ts
git commit -m "feat: scheduling — feature input schemas"
```

---

### Task 8: Public lib — handle-scoped reads + booking token resolver

**Files:**
- Create: `src/lib/booking/public.ts`, `src/lib/tokens/booking.ts`
- Modify: `src/lib/tokens/index.ts`, `src/lib/tokens/rate-limit.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `@/lib/supabase/admin`, `createAnonServerClient`, `SlidingWindowLimiter`, `tokenLimiter` idioms.
- Produces (consumed by Tasks 9–10):
  - `getBookingOrg(handle: string): Promise<{ orgId: string; orgName: string; timeZone: string } | null>`
  - `listPublicServices(orgId: string): Promise<PublicService[]>` where `PublicService = { id, name, description, durationMin, priceLabel, bufferBeforeMin, bufferAfterMin, minNoticeMin, maxPerDay, bookingWindowDays }` (camelCase, mapped from snake_case rows)
  - `getBusyIntervals(orgId: string, fromIso: string, toIso: string): Promise<Array<{ startsAt: Date; endsAt: Date }>>`
  - `getAvailability(orgId: string): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }>`
  - `resolveBookingToken(token: string, clientKey: string): Promise<ResolveBookingResult>` with `ResolveBookingResult = { status: "not_found" } | { status: "rate_limited" } | { status: "ok"; booking: { id: string; status: string; startsAt: Date; endsAt: Date; serviceName: string; orgName: string; orgTimezone: string } }`
  - `buildBookingManageUrl(token: string): string` → `${env.NEXT_PUBLIC_APP_URL}/booking/${token}`
  - `publicBookingLimiter` (30 req/min) exported from `rate-limit.ts`

- [ ] **Step 1: Add the limiter**

In `src/lib/tokens/rate-limit.ts`, next to `tokenLimiter`:

```ts
// Public booking surface (slot queries + booking creation). Tighter than
// tokenLimiter: every request does real work (slot computation / an RPC).
export const publicBookingLimiter = new SlidingWindowLimiter(30, 60_000);
```

- [ ] **Step 2: Write `src/lib/booking/public.ts`**

```ts
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SlotRule, SlotException } from "@/features/scheduling/slots";

// Admin-client reads for the anonymous booking page (getOrgBranding
// precedent: the public surface stays off the anon SQL grant surface;
// every query here is scoped by an explicitly resolved handle/orgId).

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceLabel: string | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
};

export async function getBookingOrg(
  handle: string,
): Promise<{ orgId: string; orgName: string; timeZone: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone")
    .eq("handle", handle)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.id, orgName: data.name, timeZone: data.timezone };
}

export async function listPublicServices(orgId: string): Promise<PublicService[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days",
    )
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.duration_min,
    priceLabel: s.price_label,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    minNoticeMin: s.min_notice_min,
    maxPerDay: s.max_per_day,
    bookingWindowDays: s.booking_window_days,
  }));
}

export async function getAvailability(
  orgId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("org_id", orgId),
    admin
      .from("availability_exceptions")
      .select("date, closed, start_time, end_time")
      .eq("org_id", orgId),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}

export async function getBusyIntervals(
  orgId: string,
  fromIso: string,
  toIso: string,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
}
```

- [ ] **Step 3: Write `src/lib/tokens/booking.ts`** (twin of `portal.ts`)

```ts
import "server-only";

import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import { tokenLimiter } from "./rate-limit";

export type ResolveBookingResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | {
      status: "ok";
      booking: {
        id: string;
        status: string;
        startsAt: Date;
        endsAt: Date;
        serviceName: string;
        orgName: string;
        orgTimezone: string;
      };
    };

export async function resolveBookingToken(
  token: string,
  clientKey: string,
): Promise<ResolveBookingResult> {
  if (!tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)) {
    return { status: "rate_limited" };
  }
  if (token.length < 20 || token.length > 200) return { status: "not_found" };
  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
  if (error) {
    console.error("[booking] resolve:", error.code || "rpc error");
    return { status: "not_found" };
  }
  const row = (data as Array<{
    booking_id: string;
    booking_status: string;
    starts_at: string;
    ends_at: string;
    service_name: string;
    org_name: string;
    org_timezone: string;
  }> | null)?.[0];
  if (!row) return { status: "not_found" };
  return {
    status: "ok",
    booking: {
      id: row.booking_id,
      status: row.booking_status,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      serviceName: row.service_name,
      orgName: row.org_name,
      orgTimezone: row.org_timezone,
    },
  };
}

export function buildBookingManageUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/booking/${token}`;
}
```

- [ ] **Step 4: Extend the barrel**

In `src/lib/tokens/index.ts` add `export * from "./booking";`.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/lib/booking src/lib/tokens
git commit -m "feat: scheduling — public booking reads and manage-token resolver"
```

---

### Task 9: Public server actions (getSlots, createBooking)

**Files:**
- Create: `src/features/scheduling/public-actions.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–8; `generateAccessToken` from `@/lib/tokens/mint`; `clientKeyFrom` + `publicBookingLimiter` from `@/lib/tokens`; `selectTransport` from `@/lib/email/transport`; `createAnonServerClient`.
- Produces (consumed by Task 10's widget):
  - `getSlots(input: unknown): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }>` (slots = UTC ISO strings)
  - `createBooking(input: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }>`

- [ ] **Step 1: Write `src/features/scheduling/public-actions.ts`**

```ts
"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import {
  getBookingOrg,
  listPublicServices,
  getAvailability,
  getBusyIntervals,
} from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, addDaysISO, dateInZone } from "./slots";
import {
  bookingConfirmationEmail,
  bookingIdempotencyKey,
  formatWhenLine,
} from "./templates";
import { getSlotsInput, createBookingInput, GENERIC_WRITE_ERROR } from "./schema";

const SLOT_TAKEN = "That time was just taken — please pick another.";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Shared by both actions: everything the engine needs for one org+service.
async function loadSlotContext(handle: string, serviceId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const services = await listPublicServices(org.orgId);
  const service = services.find((s) => s.id === serviceId);
  if (!service) return null;
  const { rules, exceptions } = await getAvailability(org.orgId);
  // Fetch busy one day beyond both edges — buffers can reach across
  // org-local midnight in UTC terms.
  const busy = await getBusyIntervals(
    org.orgId,
    `${addDaysISO(fromDate, -1)}T00:00:00Z`,
    `${addDaysISO(fromDate, days + 1)}T23:59:59Z`,
  );
  return { org, service, rules, exceptions, busy };
}

export async function getSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = getSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, fromDate, days } = parsed.data;
  try {
    const ctx = await loadSlotContext(handle, serviceId, fromDate, days);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: ctx.org.timeZone,
      now: new Date(),
      fromDate,
      days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getSlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function createBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = createBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { handle, serviceId, startsAt, name, email, note } = parsed.data;

  try {
    const starts = new Date(startsAt);
    const ctx = await loadSlotContext(handle, serviceId, dateInZone(starts, "UTC"), 2);
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };

    // Re-run the engine for the org-local day of the requested slot; the
    // requested instant must be one of its outputs. The EXCLUDE constraint
    // remains the race-proof last line.
    const localDate = dateInZone(starts, ctx.org.timeZone);
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: ctx.org.timeZone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const { token, tokenHash } = generateAccessToken();
    const anon = createAnonServerClient();
    const { data: bookingId, error } = await anon.rpc("create_booking", {
      p_handle: handle,
      p_service_id: serviceId,
      p_starts_at: starts.toISOString(),
      p_name: name,
      p_email: email,
      p_note: note ?? null,
      p_token_hash: tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      console.error("[scheduling] createBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }

    // Best-effort confirmation (spec: the booking survives email failure;
    // S2's drain adds retries).
    try {
      const manageUrl = buildBookingManageUrl(token);
      const msg = bookingConfirmationEmail({
        orgName: ctx.org.orgName,
        serviceName: ctx.service.name,
        whenLine: formatWhenLine(starts, ctx.org.timeZone),
        manageUrl,
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
      });
      await selectTransport().send({
        to: email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingIdempotencyKey(bookingId as string),
      });
    } catch (mailError) {
      console.error("[scheduling] confirmation email failed:", mailError);
    }

    return { ok: true, token };
  } catch (error) {
    console.error("[scheduling] createBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
```

Note the `loadSlotContext(handle, serviceId, dateInZone(starts, "UTC"), 2)` call: the busy window is fetched around the UTC date of the slot (2 days wide) which always covers the org-local day re-scan.

- [ ] **Step 2: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/scheduling/public-actions.ts
git commit -m "feat: scheduling — public getSlots and createBooking actions"
```

---

### Task 10: Public pages — booking widget, manage page, ICS route

**Files:**
- Create: `src/app/book/layout.tsx`, `src/app/book/[handle]/page.tsx`, `src/features/scheduling/components/booking-widget.tsx`, `src/app/booking/[token]/page.tsx`, `src/app/booking/[token]/calendar.ics/route.ts`

**Interfaces:**
- Consumes: `getSlots`/`createBooking` (Task 9), `getBookingOrg`/`listPublicServices` (Task 8), `resolveBookingToken` (Task 8), `bookingIcs` (Task 6), `getOrgBranding` from `@/lib/org-branding`, `BrandedHeader` from `@/components/branded-header`, `clientKeyFrom` from `@/lib/tokens`, `formatWhenLine` (Task 6).

- [ ] **Step 1: Write `src/app/book/layout.tsx`** (portal-layout idiom: centered, no shell, no Providers — the widget uses inline errors, not toasts)

```tsx
export default function BookLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <main className="mx-auto w-full max-w-lg p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/book/[handle]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getBookingOrg, listPublicServices } from "@/lib/booking/public";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { BookingWidget } from "@/features/scheduling/components/booking-widget";

export default async function BookPage({ params }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(handle)) notFound();
  const org = await getBookingOrg(handle);
  if (!org) notFound();
  const [services, branding] = await Promise.all([
    listPublicServices(org.orgId),
    getOrgBranding(org.orgId),
  ]);
  if (services.length === 0) notFound();
  return (
    <div className="flex flex-col gap-6">
      <BrandedHeader name={org.orgName} branding={branding} />
      <BookingWidget handle={handle} orgTimeZone={org.timeZone} services={services} />
    </div>
  );
}
```

(Check `BrandedHeader`'s actual prop names in `src/components/branded-header.tsx` before wiring — match whatever the portal pages pass.)

- [ ] **Step 3: Write `src/features/scheduling/components/booking-widget.tsx`**

Client component, four phases in local state: `service → slot → details → done`. No toasts (outside Providers) — inline error line. Slots fetched via `getSlots` in `useTransition`; times rendered in the visitor's browser timezone via `Intl.DateTimeFormat`.

```tsx
"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PublicService } from "@/lib/booking/public";
import { getSlots, createBooking } from "@/features/scheduling/public-actions";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BookingWidget({
  handle,
  orgTimeZone,
  services,
}: {
  handle: string;
  orgTimeZone: string;
  services: PublicService[];
}) {
  const [service, setService] = React.useState<PublicService | null>(
    services.length === 1 ? services[0] : null,
  );
  const [slots, setSlots] = React.useState<string[]>([]);
  const [fromDate, setFromDate] = React.useState(todayISO());
  const [slot, setSlot] = React.useState<string | null>(null);
  const [doneToken, setDoneToken] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

  const loadSlots = React.useCallback(
    (svc: PublicService, from: string) => {
      startTransition(async () => {
        setError(null);
        const result = await getSlots({ handle, serviceId: svc.id, fromDate: from, days: 7 });
        if (result.ok) setSlots(result.slots);
        else setError(result.error);
      });
    },
    [handle],
  );

  React.useEffect(() => {
    if (service) loadSlots(service, fromDate);
  }, [service, fromDate, loadSlots]);

  function submit(formData: FormData) {
    if (!service || !slot) return;
    startTransition(async () => {
      setError(null);
      const result = await createBooking({
        handle,
        serviceId: service.id,
        startsAt: slot,
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        note: String(formData.get("note") ?? "") || undefined,
      });
      if (result.ok) {
        setDoneToken(result.token);
      } else {
        setError(result.error);
        if ("slotTaken" in result && result.slotTaken) {
          setSlot(null);
          loadSlots(service, fromDate);
        }
      }
    });
  }

  if (doneToken) {
    return (
      <div className="flex flex-col gap-3 rounded-md border p-4">
        <h2 className="font-semibold">Booking confirmed</h2>
        <p className="text-muted-foreground text-sm">
          A confirmation email is on its way. Keep it — the links below are your access to this
          booking.
        </p>
        <a className="text-sm underline" href={`/booking/${doneToken}`}>
          View your booking
        </a>
        <a className="text-sm underline" href={`/booking/${doneToken}/calendar.ics`}>
          Add to calendar (.ics)
        </a>
      </div>
    );
  }

  // Group by the VIEWER's local date, not the UTC date — a late-evening
  // slot in the viewer's zone must appear under the day they'd call it.
  const viewerDayKey = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byDay = new Map<string, string[]>();
  for (const s of slots) {
    const day = viewerDayKey.format(new Date(s));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }

  return (
    <div className="flex flex-col gap-6">
      {!service ? (
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setService(s)}
                className="hover:bg-accent/50 flex w-full items-center justify-between rounded-md border px-4 py-3 text-left text-sm"
              >
                <span>
                  <span className="font-medium">{s.name}</span>
                  {s.description ? (
                    <span className="text-muted-foreground block text-xs">{s.description}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {s.durationMin} min{s.priceLabel ? ` · ${s.priceLabel}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : !slot ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {service.name}{" "}
              <button
                type="button"
                className="text-muted-foreground underline"
                onClick={() => {
                  setService(services.length === 1 ? service : null);
                  setSlots([]);
                }}
              >
                {services.length > 1 ? "change" : ""}
              </button>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={fromDate <= todayISO()}
                onClick={() => setFromDate(shiftDays(fromDate, -7))}
              >
                ←
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFromDate(shiftDays(fromDate, 7))}>
                →
              </Button>
            </div>
          </div>
          {pending ? (
            <p className="text-muted-foreground text-sm">Loading times…</p>
          ) : byDay.size === 0 ? (
            <p className="text-muted-foreground text-sm">No free times this week — try the next.</p>
          ) : (
            [...byDay.entries()].map(([day, daySlots]) => (
              <div key={day} className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium">
                  {dayFmt.format(new Date(daySlots[0]))}
                </p>
                <div className="flex flex-wrap gap-2">
                  {daySlots.map((s) => (
                    <Button key={s} variant="outline" size="sm" onClick={() => setSlot(s)}>
                      {timeFmt.format(new Date(s))}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
          <p className="text-muted-foreground text-xs">Times shown in your timezone ({viewerTz}).</p>
        </div>
      ) : (
        <form action={submit} className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium">{service.name}</span> —{" "}
            {dayFmt.format(new Date(slot))}, {timeFmt.format(new Date(slot))}{" "}
            <button type="button" className="text-muted-foreground underline" onClick={() => setSlot(null)}>
              change
            </button>
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required maxLength={320} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Textarea id="note" name="note" maxLength={2000} rows={3} />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Booking…" : "Confirm booking"}
          </Button>
        </form>
      )}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
```

(Confirm `Button`/`Input`/`Label`/`Textarea` prop conventions against `src/components/ui/*` — base-nova variants, not Radix.)

- [ ] **Step 4: Write `src/app/booking/[token]/page.tsx`** (read-only in S1; portal not-found idiom)

```tsx
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken } from "@/lib/tokens/booking";
import { formatWhenLine } from "@/features/scheduling/templates";

const STATUS_LINE: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled",
  cancelled_by_provider: "Cancelled by the provider",
  rescheduled: "Rescheduled",
};

export default async function BookingManagePage({ params }: PageProps<"/booking/[token]">) {
  const { token } = await params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status === "rate_limited") {
    return (
      <main className="mx-auto w-full max-w-md p-6">
        <p className="text-muted-foreground text-sm">Too many requests — try again shortly.</p>
      </main>
    );
  }
  if (result.status !== "ok") notFound();
  const b = result.booking;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">{b.orgName}</h1>
      <div className="flex flex-col gap-1 rounded-md border p-4 text-sm">
        <p className="font-medium">{b.serviceName}</p>
        <p>{formatWhenLine(b.startsAt, b.orgTimezone)}</p>
        <p className="text-muted-foreground">{STATUS_LINE[b.status] ?? b.status}</p>
      </div>
      {b.status === "confirmed" ? (
        <>
          <a className="text-sm underline" href={`/booking/${token}/calendar.ics`}>
            Add to calendar (.ics)
          </a>
          <p className="text-muted-foreground text-xs">
            Need to change or cancel? Reply to your confirmation email — online changes are coming
            soon.
          </p>
        </>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 5: Write `src/app/booking/[token]/calendar.ics/route.ts`**

```ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clientKeyFrom } from "@/lib/tokens";
import { resolveBookingToken, buildBookingManageUrl } from "@/lib/tokens/booking";
import { bookingIcs } from "@/features/scheduling/ics";

export async function GET(
  _req: Request,
  ctx: RouteContext<"/booking/[token]/calendar.ics">,
) {
  const { token } = await ctx.params;
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok" || result.booking.status !== "confirmed") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const b = result.booking;
  const manageUrl = buildBookingManageUrl(token);
  const ics = bookingIcs({
    uid: b.id,
    starts: b.startsAt,
    ends: b.endsAt,
    summary: `${b.serviceName} — ${b.orgName}`,
    description: `Manage: ${manageUrl}`,
    url: manageUrl,
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="booking.ics"',
    },
  });
}
```

- [ ] **Step 6: Smoke check**

No org has a handle yet (that arrives with Task 13's settings form), so the full booking loop can't run here. Minimum bar for this task:

Run: `npm run dev`, open `http://localhost:3000/book/nonexistent`
Expected: 404 page.

Run: `npm run verify`
Expected: PASS (typecheck exercises the `PageProps`/`RouteContext` literals via `next typegen`). The full end-to-end loop is Task 13 Step 4's smoke test.

- [ ] **Step 7: Commit**

```bash
git add src/app/book src/app/booking src/features/scheduling/components/booking-widget.tsx
git commit -m "feat: scheduling — public booking page, manage page, ICS route"
```

---

### Task 11: Admin — services CRUD

**Files:**
- Create: `src/features/scheduling/queries.ts`, `src/features/scheduling/actions.ts`, `src/features/scheduling/components/services-list.tsx`, `src/features/scheduling/components/service-dialog.tsx`, `src/app/(dashboard)/services/page.tsx`

**Interfaces:**
- Consumes: schemas (Task 7), `createClient` from `@/lib/supabase/server`.
- Produces:
  - `listServices(): Promise<ServiceRow[]>` — all columns, camelCase-mapped, ordered by sortOrder/name
  - `createService(input: unknown): Promise<ActionState>`, `updateService(input: unknown): Promise<ActionState>`, `deleteService(input: unknown): Promise<ActionState>` (maps 23503 → "Service has bookings — deactivate it instead.")
  - Task 12 appends availability queries/actions to these same files.

- [ ] **Step 1: Write `src/features/scheduling/queries.ts`**

```ts
import { createClient } from "@/lib/supabase/server";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceLabel: string | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
  active: boolean;
  sortOrder: number;
};

export async function listServices(): Promise<ServiceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days, active, sort_order",
    )
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.duration_min,
    priceLabel: s.price_label,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    minNoticeMin: s.min_notice_min,
    maxPerDay: s.max_per_day,
    bookingWindowDays: s.booking_window_days,
    active: s.active,
    sortOrder: s.sort_order,
  }));
}
```

- [ ] **Step 2: Write the service actions in `src/features/scheduling/actions.ts`**

Clients-actions idiom: `currentOrgId()` helper, `fail()`, RLS-scoped writes, `revalidatePath`.

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  serviceInput,
  updateServiceInput,
  serviceIdInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

// No org_id here: inserts add it explicitly, updates must never rewrite it
// (a multi-org user's currentOrgId() pick could otherwise migrate the row
// between their orgs — security-review hardening).
function toServiceRow(d: import("zod").infer<typeof serviceInput>) {
  return {
    name: d.name,
    description: d.description ?? null,
    duration_min: d.durationMin,
    price_label: d.priceLabel ?? null,
    buffer_before_min: d.bufferBeforeMin,
    buffer_after_min: d.bufferAfterMin,
    min_notice_min: d.minNoticeMin,
    max_per_day: d.maxPerDay,
    booking_window_days: d.bookingWindowDays,
    active: d.active,
  };
}

export async function createService(input: unknown): Promise<ActionState> {
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .insert({ org_id: orgId, ...toServiceRow(parsed.data) });
  if (error) return fail("createService", error);
  revalidatePath("/services");
  return { ok: true };
}

export async function updateService(input: unknown): Promise<ActionState> {
  const parsed = updateServiceInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update(toServiceRow(rest))
    .eq("id", id)
    // RLS already hides foreign rows; the explicit org scope is
    // defense-in-depth and keeps multi-org sessions unambiguous.
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) return fail("updateService", error);
  if (!data) return { ok: false, error: GENERIC_WRITE_ERROR };
  revalidatePath("/services");
  return { ok: true };
}

export async function deleteService(input: unknown): Promise<ActionState> {
  const parsed = serviceIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("services")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Service has bookings — deactivate it instead." };
    }
    return fail("deleteService", error);
  }
  revalidatePath("/services");
  return { ok: true };
}
```

- [ ] **Step 3: Write the page + components**

`src/app/(dashboard)/services/page.tsx` (clients-page skeleton):

```tsx
import { listServices } from "@/features/scheduling/queries";
import { ServicesList } from "@/features/scheduling/components/services-list";
import { ServiceDialog } from "@/features/scheduling/components/service-dialog";

export default async function ServicesPage() {
  const services = await listServices();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Services</h1>
        <ServiceDialog />
      </div>
      {services.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No services yet — a service is what clients pick on your booking page (name, duration,
          buffers, limits).
        </p>
      ) : (
        <ServicesList services={services} />
      )}
    </div>
  );
}
```

`services-list.tsx`: client component rendering each service as a row (name, duration, price label, inactive badge when `!active`) with an Edit button opening `ServiceDialog` pre-filled and a Delete button calling `deleteService` in `useTransition` with `toast` feedback (dashboard has Providers — toasts are fine here).

`service-dialog.tsx`: `create-client-dialog.tsx` idiom — `Dialog` from `@/components/ui/dialog` (base-ui `render={...}` style, NOT Radix `asChild`), controlled fields for: name, description, duration (number input, minutes), price label, buffer before/after, min notice (minutes), max per day (empty = unlimited), booking window (days), active toggle. On submit: `useTransition` → `createService`/`updateService` → `toast.error(result.error)` on failure, close + `toast.success("Saved")` on success. Number fields parse with `Number(...)` and pass `null` for an empty max-per-day.

- [ ] **Step 4: Verify and commit**

Run: `npm run verify`
Expected: PASS.

Manual: `npm run dev` → log in (seeded demo user) → `/services` → create, edit, deactivate a service.

```bash
git add src/features/scheduling src/app/\(dashboard\)/services
git commit -m "feat: scheduling — services admin CRUD"
```

---

### Task 12: Admin — availability editor

**Files:**
- Modify: `src/features/scheduling/queries.ts`, `src/features/scheduling/actions.ts`
- Create: `src/features/scheduling/components/availability-editor.tsx`, `src/app/(dashboard)/availability/page.tsx`

**Interfaces:**
- Consumes: schemas (Task 7).
- Produces:
  - `getAvailabilityAdmin(): Promise<{ rules: RuleRow[]; exceptions: ExceptionRow[] }>` with `RuleRow = { id, weekday, startTime, endTime }`, `ExceptionRow = { id, date, closed, startTime, endTime }`
  - `addAvailabilityRule(input: unknown): Promise<ActionState>`, `deleteAvailabilityRule(input: unknown): Promise<ActionState>`
  - `addAvailabilityException(input: unknown): Promise<ActionState>`, `deleteAvailabilityException(input: unknown): Promise<ActionState>`

- [ ] **Step 1: Append queries**

```ts
export type RuleRow = { id: string; weekday: number; startTime: string; endTime: string };
export type ExceptionRow = {
  id: string;
  date: string;
  closed: boolean;
  startTime: string | null;
  endTime: string | null;
};

export async function getAvailabilityAdmin(): Promise<{
  rules: RuleRow[];
  exceptions: ExceptionRow[];
}> {
  const supabase = await createClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase
      .from("availability_rules")
      .select("id, weekday, start_time, end_time")
      .order("weekday")
      .order("start_time"),
    supabase
      .from("availability_exceptions")
      .select("id, date, closed, start_time, end_time")
      .gte("date", new Date().toISOString().slice(0, 10))
      .order("date"),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      id: e.id,
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}
```

- [ ] **Step 2: Append actions** (same idiom as Task 11; insert/delete only — a window edit is delete + re-add)

```ts
export async function addAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = availabilityRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("availability_rules").insert({
    org_id: orgId,
    weekday: parsed.data.weekday,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
  });
  if (error) return fail("addAvailabilityRule", error);
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = ruleIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_rules")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) return fail("deleteAvailabilityRule", error);
  revalidatePath("/availability");
  return { ok: true };
}

export async function addAvailabilityException(input: unknown): Promise<ActionState> {
  const parsed = availabilityExceptionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("availability_exceptions").insert({
    org_id: orgId,
    date: parsed.data.date,
    closed: parsed.data.closed,
    start_time: parsed.data.startTime ?? null,
    end_time: parsed.data.endTime ?? null,
  });
  if (error) return fail("addAvailabilityException", error);
  revalidatePath("/availability");
  return { ok: true };
}

export async function deleteAvailabilityException(input: unknown): Promise<ActionState> {
  const parsed = exceptionIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", orgId);
  if (error) return fail("deleteAvailabilityException", error);
  revalidatePath("/availability");
  return { ok: true };
}
```

(Import `availabilityRuleInput`, `ruleIdInput`, `availabilityExceptionInput`, `exceptionIdInput` from `./schema` at the top of `actions.ts`.)

- [ ] **Step 3: Page + editor component**

`src/app/(dashboard)/availability/page.tsx`:

```tsx
import { getAvailabilityAdmin } from "@/features/scheduling/queries";
import { AvailabilityEditor } from "@/features/scheduling/components/availability-editor";

export default async function AvailabilityPage() {
  const { rules, exceptions } = await getAvailabilityAdmin();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Availability</h1>
      <AvailabilityEditor rules={rules} exceptions={exceptions} />
    </div>
  );
}
```

`availability-editor.tsx`: client component, two sections.
- **Weekly hours**: seven rows Mon→Sun (render order `[1,2,3,4,5,6,0]`, labels via a local `WEEKDAY_LABELS` array). Each row lists its windows (`09:00–17:00` + a remove ×) and an "add window" inline form: two `<Input type="time" step={300}>` + Add button → `addAvailabilityRule({ weekday, startTime, endTime })`. `<input type="time">` already yields `"HH:MM"` — no conversion.
- **Exceptions**: list of upcoming exception rows (date + "Closed" or window + remove ×), and an add form: `<Input type="date">`, a closed checkbox (default on), time inputs shown only when unchecked → `addAvailabilityException`.
All mutations via `useTransition` + `toast`.

- [ ] **Step 4: Verify and commit**

Run: `npm run verify`
Expected: PASS. Manual: add Mon–Fri windows, a vacation day; confirm they appear on `/book/[handle]` slot output once a handle exists (Task 13).

```bash
git add src/features/scheduling src/app/\(dashboard\)/availability
git commit -m "feat: scheduling — availability editor (weekly hours + exceptions)"
```

---

### Task 13: Scheduling settings (handle + timezone) in /settings

**Files:**
- Modify: `src/features/orgs/queries.ts`, `src/app/(dashboard)/settings/page.tsx`
- Create: `src/features/scheduling/components/scheduling-settings-form.tsx`; append `updateSchedulingSettings` to `src/features/scheduling/actions.ts`

**Interfaces:**
- Consumes: `update_org_scheduling` RPC (Task 2), `schedulingSettingsInput` (Task 7).
- Produces: `getSchedulingSettings(): Promise<{ orgId: string; handle: string | null; timezone: string } | null>`; `updateSchedulingSettings(input: unknown): Promise<ActionState>` (maps 23505 → "That handle is already taken.").

- [ ] **Step 1: Append query to `src/features/orgs/queries.ts`**

```ts
export async function getSchedulingSettings(): Promise<{
  orgId: string;
  handle: string | null;
  timezone: string;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orgs")
    .select("id, handle, timezone")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.id, handle: data.handle, timezone: data.timezone };
}
```

(Match the local import alias if `queries.ts` aliases the supabase helper.)

- [ ] **Step 2: Append the action** (to `src/features/scheduling/actions.ts`)

```ts
export async function updateSchedulingSettings(input: unknown): Promise<ActionState> {
  const parsed = schedulingSettingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: parsed.data.handle,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "That handle is already taken." };
    return fail("updateSchedulingSettings", error);
  }
  revalidatePath("/settings");
  return { ok: true };
}
```

(Import `schedulingSettingsInput` in `actions.ts`.)

- [ ] **Step 3: Form component + settings page wiring**

`scheduling-settings-form.tsx` (branding-form idiom: client component, `useTransition` + toast):
- Handle `<Input>` (pattern hint under it: lowercase letters, digits, hyphens, 3–50 chars).
- Timezone `<select>` (native, styled like inputs) populated from `Intl.supportedValuesOf("timeZone")`, defaulting to current value; browser tz preselected when handle is null (first setup): `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Save button → `updateSchedulingSettings({ handle, timezone })`.
- When a handle is saved, show the public URL `${window.location.origin}/book/${handle}` with a Copy button (`navigator.clipboard.writeText`, `toast.success("Copied")`).

In `src/app/(dashboard)/settings/page.tsx`, fetch `getSchedulingSettings()` alongside `getBrandingSettings()` (`Promise.all`) and render a "Booking page" section with the form **above** the existing branding section.

- [ ] **Step 4: Verify, end-to-end smoke, commit**

Run: `npm run verify`
Expected: PASS.

Manual (first full loop): `/settings` → set handle `demo-studio` + timezone → `/services` create one → `/availability` add windows → open `/book/demo-studio` in a private window → book a slot → Mailpit (`http://localhost:54354`) shows the confirmation → manage link + `.ics` route work → booking the same slot again gets "That time was just taken".

```bash
git add src/features/scheduling src/features/orgs src/app/\(dashboard\)/settings
git commit -m "feat: scheduling — booking-page settings (handle + timezone)"
```

---

### Task 14: Pivot the nav, command menu, and seed; final verify

**Files:**
- Modify: `src/components/shell/nav.ts`, `src/components/command-menu.tsx`, `scripts/seed.ts`

**Interfaces:**
- Consumes: everything shipped in Tasks 1–13.

- [ ] **Step 1: Replace `NAV_ITEMS` in `src/components/shell/nav.ts`**

```ts
import { CalendarClock, Briefcase, Settings2 } from "lucide-react";

// Scheduling pivot (2026-08-13 spec): the fire-safety features (programs,
// templates, clients) are legacy — code and routes kept, nav removed.
// Bookings joins in S2, Widget in S3, Clients directory returns in S5.
export const NAV_ITEMS = [
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
```

(Pick icons that exist in `lucide-react@^1.30` — check the imports compile; `CalendarClock` and `Briefcase` do.)

- [ ] **Step 2: Update the command menu Actions group**

In `src/components/command-menu.tsx`, replace the hand-listed create commands (`/programs?new=1`, `/templates?new=1`, `/clients?new=1`) with `New service → /services?new=1`. Then in Task 11's `service-dialog.tsx`, support the URL-driven open idiom (`searchParams.get("new") === "1"`, close via `router.replace("/services")`) — the same pattern as `create-client-dialog.tsx`. Nav entries in the menu derive from `NAV_ITEMS` automatically.

- [ ] **Step 3: Extend `scripts/seed.ts`**

After `ensureDemoClient`, add and call:

```ts
const DEMO_HANDLE = "demo-studio";
const DEMO_TIMEZONE = "Europe/Berlin";
const DEMO_SERVICES = [
  { name: "Intro Call", duration_min: 30, price_label: null },
  { name: "Consultation", duration_min: 60, price_label: "€80" },
];

async function ensureDemoScheduling(client: SupabaseClient, orgId: string) {
  const { data: org } = await client.from("orgs").select("handle").eq("id", orgId).maybeSingle();
  if (!org?.handle) {
    const { error } = await client.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: DEMO_HANDLE,
      p_timezone: DEMO_TIMEZONE,
    });
    if (error) throw error;
    console.log(`seed: set booking handle "${DEMO_HANDLE}" (${DEMO_TIMEZONE})`);
  }
  for (const svc of DEMO_SERVICES) {
    const { data: existing } = await client
      .from("services")
      .select("id")
      .eq("org_id", orgId)
      .eq("name", svc.name)
      .maybeSingle();
    if (!existing) {
      const { error } = await client.from("services").insert({ org_id: orgId, ...svc });
      if (error) throw error;
      console.log(`seed: created service "${svc.name}"`);
    }
  }
  const { data: anyRule } = await client
    .from("availability_rules")
    .select("id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  if (!anyRule) {
    const rows = [1, 2, 3, 4, 5].map((weekday) => ({
      org_id: orgId,
      weekday,
      start_time: "09:00",
      end_time: "17:00",
    }));
    const { error } = await client.from("availability_rules").insert(rows);
    if (error) throw error;
    console.log("seed: availability Mon-Fri 09:00-17:00");
  }
  console.log(`seed: booking page -> http://localhost:3000/book/${DEMO_HANDLE}`);
}
```

Call it from `main()` after the existing `ensureX` chain, and match the file's existing type imports (`SupabaseClient` is already imported there).

- [ ] **Step 4: Full local verification**

Run: `npm run db:reset` (clean stack: migrations + seed)
Expected: seed prints the booking URL.

Run: `npm run verify && npm run test:integration`
Expected: ALL PASS.

Manual sweep: sidebar shows only Services / Availability / Settings; `/programs` still loads by direct URL (legacy kept); Cmd-K lists the new nav + New service; the full booking loop from Task 13's smoke test works from the seeded state.

- [ ] **Step 5: Commit**

```bash
git add src/components/shell/nav.ts src/components/command-menu.tsx scripts/seed.ts
git commit -m "feat: scheduling — pivot nav to scheduling, seed demo booking setup"
```

---

## Post-plan checklist (before PR)

- Run the graphify update: `graphify update .`
- PR title: `feat: scheduling pivot — slice S1 (services, availability, public booking, EXCLUDE guard)`; body lists the six spec deviations from the plan header and links the spec.
- Known S2 seams left open on purpose: bookings list/cancel UI, reminder drain, manage-page actions, email retries.
