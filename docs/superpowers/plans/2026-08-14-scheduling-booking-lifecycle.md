# Booking Lifecycle (Slice S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients cancel or reschedule their booking from the tokenized manage page, providers cancel/reschedule from a new Bookings dashboard, reminder emails go out ~24h before start via a drain cron, and the anon `create_booking` RPC is hardened (per-org throttle + availability containment) — closing the accepted S1 residual.

**Architecture:** Extends the S1 `scheduling` domain in place. Client-side lifecycle mutations are anon-callable SECURITY DEFINER RPCs keyed on the manage-token hash (the `create_booking` capability model); admin cancel uses the column-scoped status-update RLS seam 0026 explicitly reserved for S2; reschedule is one transaction (old row → `rescheduled`, new linked row inserted) settled by the existing EXCLUDE guard. Reminders copy the chasing drain's claim/rollback/idempotency-key machinery onto three new `bookings` columns, behind a new `/api/scheduling/drain` route.

**Tech Stack:** Next 16.3 (typed `PageProps`, async params), React 19, Supabase (RLS + definer RPCs), Drizzle (schema/migrations only), zod v4, Tailwind v4 + shadcn (base-nova), Vitest 4.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-13-scheduling-pivot-vision-and-roadmap-design.md` (S2 row of the slice roadmap + "Booking flow"/"Manage page"/"Error handling"/"Security" sections). S1 shipped in PR #22 (squash `66dab4f` on `origin/main`).
- **Branch:** `scheduling-s2`, cut from **updated main** (`git checkout main && git pull && git checkout -b scheduling-s2`). Do NOT continue on `scheduling-pivot` (merged).
- Next 16: `params`/`searchParams` are Promises — always `await`; pages typed `PageProps<"/route/[param]">`, route handlers `RouteContext<"/...">`. Never hand-write `{ params: Promise<...> }`.
- zod v4 style: `z.uuid()`, `z.email()`, `z.iso.datetime()`. Input schemas live in `src/features/scheduling/schema.ts`, never inline in actions (re-export `GENERIC_WRITE_ERROR, type ActionState` from `@/lib/actions`).
- Server actions: file starts with `"use server";` (so every export must be an async function — shared non-action helpers go in `src/lib/`), take `(input: unknown)`, `safeParse`, return `ActionState`-shaped unions, log raw errors via a local `fail(context, error)` or `console.error("[scheduling] …")`, staff actions then `revalidatePath(...)`. Specific user-facing copy only where actionable (mapped SQLSTATEs).
- Supabase clients: staff actions/queries → `await createClient()` from `@/lib/supabase/server`; public token/RPC paths → `createAnonServerClient()`; `createAdminClient()` only inside `src/lib/booking/` modules that scope every query explicitly.
- Migrations: `0027_*` is drizzle-kit **generated** (`npm run db:generate`), `0028_booking_lifecycle_security.sql` is **hand-written custom** (`npx drizzle-kit generate --custom --name=booking_lifecycle_security`). Definer RPCs: `security definer set search_path = ''`, fully-qualified `public.*` names, **alias every table reference** (RETURNS TABLE column names shadow SQL columns in plpgsql), uniform `raise exception 'not found'`, revoke-from-all-then-grant-one-caller. Any DROP+CREATE of a function loses its ACL — re-apply revoke/grant.
- CI runs `npx drizzle-kit generate` and fails on drift — the TS schema and 0027 must match exactly.
- No date library. All instants are UTC `Date`s; `now: Date` is an injected parameter of pure functions, never read inside. Timezone conversion via `Intl.DateTimeFormat` (TS) / `at time zone` (SQL) only.
- Email: `selectTransport()` + `OutboundEmail` (`{to, subject, html, text, idempotencyKey}`). All lifecycle sends are **best-effort try/catch** — the DB state change always survives email failure. Raw manage tokens are never stored and never logged.
- Weekday convention everywhere: **0 = Sunday … 6 = Saturday** (JS `getUTCDay()`, SQL `extract(dow …)` — they agree).
- Verify per task: `npm run verify` (lint + typecheck + unit tests). DB tasks also: `npm run test:integration` (needs local Supabase, `npm run setup`).
- Do not touch legacy chasing/recurrence behavior; reusing exports from `src/features/chasing/` (e.g. `drain-auth.ts`) is fine.
- Commit after every task on `scheduling-s2`; message style `feat: scheduling — <what>` / `test:` / `chore:`.

## Decisions made during planning (carry into the spec if challenged)

1. **Reminder emails contain no manage link and no ICS link.** Only the token *hash* is stored; the raw token (the URL credential) exists once, at mint time, and cannot be reconstructed at drain time. The reminder is informational: org, service, when-line, "see your confirmation email to make changes."
2. **Reminders are suppressed for bookings created inside the 24h lead window** (the confirmation email just arrived). Suppressed rows get `reminder_sent_at` stamped at drain time (counted `skipped`) so they never clog the scan.
3. **Admin cancel = column-scoped RLS update**, the seam 0026 promised ("S2 adds column-scoped status updates"): `grant update (status)` to `authenticated`, policy `USING (… and status = 'confirmed')` / `WITH CHECK (… and status = 'cancelled_by_provider')`. Staff can *only* flip confirmed → cancelled_by_provider; every other transition is RPC-only or nonexistent (no un-cancel).
4. **RPC hardening scope:** per-org throttle (30 inserts/min, matching the app-side `publicBookingLimiter` rate) + availability **containment** (slot inside a rule/exception window, org-local). Grid alignment, buffers, min-notice, and max-per-day deliberately stay app-side — the residual shrinks from "off-hours spam possible" to "mis-aligned but in-hours bookings possible via direct RPC."
5. **`resolve_booking_token` is recreated with `org_id` + `service_id` added** (DROP + CREATE — return-type change; re-grant required). Portal-resolver precedent already exposes ids to token holders.
6. **After a reschedule the old token keeps resolving** (status `rescheduled`, no actions offered) — history stays reachable; the new booking gets a fresh token in the new confirmation email.
7. **Separate drain surface:** `/api/scheduling/drain` + `SCHEDULING_DRAIN_SECRET`, reusing `isAuthorizedDrainRequest` from chasing. Keeps legacy chasing independently disableable; same operational model (POST + Bearer, cron later, `npm run scheduling:drain` now).
8. **Deferred S1 items folded in:** the action-layer e2e test (Task 8) and the `schedulingSettingsInput` `handle: null` fix (Task 5). The other S1 deferrals (a11y pair → S3, client-rename → S5) stay parked.
9. **Reschedule keeps the original service** — no service switch in the manage flow at MVP.
10. **Client cancel/reschedule require `starts_at > now()`** — past bookings are immutable history from the client side. `reschedule_booking_admin` allows moving a past-started *confirmed* booking (provider fixing a missed appointment) but the new time must be future + available.
11. **Slot pickers exclude the booking's own busy interval** (`excludeBookingId` in busy fetch), so a client can shift a booking by less than its own duration; RPC-side this is consistent because the old row is freed before the new insert in the same transaction.

## File Structure

```
Create:
  src/db/migrations/0027_<codename>.sql                    generated: reminder columns
  src/db/migrations/0028_booking_lifecycle_security.sql    hardening, lifecycle RPCs, RLS seam, index
  src/features/scheduling/lifecycle-rpc.integration.test.ts
  src/features/scheduling/manage-actions.ts                cancelBooking, rescheduleBooking, getManageSlots (anon)
  src/features/scheduling/booking-actions.ts               cancelBookingAdmin, rescheduleBookingAdmin, getAdminSlots (staff)
  src/features/scheduling/booking-flow.integration.test.ts e2e action layer (deferred from S1)
  src/features/scheduling/reminders.ts                     decideReminder + runReminderDrain
  src/features/scheduling/reminders.test.ts
  src/features/scheduling/reminder-drain.integration.test.ts
  src/features/scheduling/components/manage-booking.tsx    client cancel/reschedule UI
  src/features/scheduling/components/bookings-list.tsx     admin list + row actions
  src/features/scheduling/components/booking-reschedule-dialog.tsx
  src/lib/booking/provider.ts                              getProviderEmail (admin-client)
  src/app/api/scheduling/drain/route.ts
  src/app/(dashboard)/bookings/page.tsx
  scripts/scheduling-drain.ts
Modify:
  src/db/schema/scheduling.ts                              + reminder columns on bookings
  src/features/scheduling/schema.ts                        + lifecycle inputs; handle:null fix
  src/features/scheduling/schema.test.ts                   + coverage for the above
  src/features/scheduling/templates.ts                     + lifecycle/reminder emails + bookingLifecycleKey
  src/features/scheduling/templates.test.ts                (create; ics.test.ts precedent)
  src/features/scheduling/public-actions.ts                loadSlotContext → thin wrapper over lib
  src/features/scheduling/queries.ts                       + listBookings
  src/features/scheduling/booking-rpc.integration.test.ts  fixture gains availability rules (hardening)
  src/features/scheduling/components/scheduling-settings-form.tsx  clear-handle copy
  src/lib/tokens/booking.ts                                resolver: + orgId/serviceId
  src/lib/booking/public.ts                                + getPublicServiceById, loadOrgSlotContext, excludeBookingId
  src/app/booking/[token]/page.tsx                         placeholder → <ManageBooking>
  src/components/shell/nav.ts                              + Bookings item
  src/components/command-menu.tsx                          + Bookings nav entry
  src/env.ts                                               + SCHEDULING_DRAIN_SECRET
  package.json                                             + "scheduling:drain" script
  scripts/seed.ts                                          + demo confirmed booking
```

---

### Task 1: Branch + reminder columns (generated migration 0027)

**Files:**
- Modify: `src/db/schema/scheduling.ts`
- Create (generated): `src/db/migrations/0027_<codename>.sql`

**Interfaces:**
- Produces: `bookings.reminder_sent_at timestamptz | null`, `bookings.reminder_attempts integer not null default 0`, `bookings.reminder_last_error text | null` — consumed by Tasks 2 (partial index), 10–11 (drain).

- [ ] **Step 1: Cut the branch**

```bash
git checkout main && git pull && git checkout -b scheduling-s2
```

Run: `npm run setup` (local stack up + migrations current) if not already running.

- [ ] **Step 2: Add reminder columns to the `bookings` table object**

In `src/db/schema/scheduling.ts`, inside the `bookings` column object, after `rescheduledFromId`:

```ts
    // Reminder drain state (chasing idiom, S2). reminder_sent_at doubles as
    // the claim marker: set-before-send, rolled back on transport failure.
    // Suppressed reminders (booked <24h ahead) are stamped too — the drain
    // scan (partial index in 0028) only ever sees NULLs.
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    reminderAttempts: integer("reminder_attempts").default(0).notNull(),
    reminderLastError: text("reminder_last_error"),
```

- [ ] **Step 3: Generate and apply**

Run: `npm run db:generate`
Expected: `src/db/migrations/0027_<codename>.sql` containing exactly three `ALTER TABLE "bookings" ADD COLUMN …` statements. No grants/policies (0028's job).

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 4: Verify no drift and commit**

Run: `npm run db:generate` → "No schema changes"; `npm run verify` → PASS.

```bash
git add src/db/schema src/db/migrations
git commit -m "feat: scheduling — bookings reminder columns (0027)"
```

---

### Task 2: Security migration 0028 (hardening, lifecycle RPCs, RLS seam)

**Files:**
- Create: `src/db/migrations/0028_booking_lifecycle_security.sql`
- Modify: `src/features/scheduling/booking-rpc.integration.test.ts` (fixture only)

**Interfaces:**
- Produces (consumed by all later tasks):
  - `public.slot_within_availability(p_org_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz) returns boolean` — internal, no role grants.
  - Hardened `public.create_booking(...)` — same signature; now throttled + availability-checked.
  - `public.cancel_booking(p_token text) returns table (booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text, client_email text, starts_at timestamptz)` — anon-exec; empty = miss/no-op.
  - `public.reschedule_booking(p_token text, p_starts_at timestamptz, p_new_token_hash text) returns table (new_booking_id uuid, org_id uuid, org_name text, org_timezone text, service_name text, client_name text, client_email text, old_starts_at timestamptz, new_starts_at timestamptz)` — anon-exec.
  - `public.reschedule_booking_admin(p_booking_id uuid, p_starts_at timestamptz, p_token_hash text) returns uuid` — authenticated-exec.
  - `public.resolve_booking_token(p_token text)` recreated: previous columns **plus `org_id uuid, service_id uuid`**.
  - Policy `bookings_update_member` + `grant update (status)` — staff can flip confirmed → cancelled_by_provider only.
  - SQLSTATEs callers map: `23P01` (slot conflict) from create/reschedule RPCs.

- [ ] **Step 1: Scaffold**

Run: `npx drizzle-kit generate --custom --name=booking_lifecycle_security`
Expected: empty `src/db/migrations/0028_booking_lifecycle_security.sql`.

- [ ] **Step 2: Write the migration body**

```sql
-- Custom SQL migration file, put your code below! --

-- Booking lifecycle security model (pivot slice S2):
--   * Client cancel/reschedule: anon-callable definer RPCs keyed on the
--     manage-token hash — the create_booking capability model. Uniform
--     empty-result/raise on any miss.
--   * Reschedule = old row -> 'rescheduled' + new linked row, ONE
--     transaction; the EXCLUDE guard settles races (23P01 => rollback,
--     old booking stays confirmed).
--   * Admin cancel: the column-scoped status-update seam reserved in 0026.
--   * create_booking hardening (accepted S1 residual, plan deviation #7):
--     per-org insert throttle + availability containment now live INSIDE
--     the RPC. Grid/buffers/min-notice/max-per-day stay app-side.

-- ---------- Reminder drain scan (columns in 0027). Partial indexes are
-- not expressible in the TS schema (established limitation).
create index bookings_reminder_due_idx
  on public.bookings (starts_at)
  where status = 'confirmed' and reminder_sent_at is null;

-- ---------- Availability containment: [starts,ends) must sit inside one
-- bookable window of the org-local date. Mirrors the slot engine's COARSE
-- semantics: rules per weekday; open exceptions REPLACE the day's rules;
-- closed exceptions kill the day; windows never cross local midnight
-- (end_time caps at 23:59 by CHECK).
create or replace function public.slot_within_availability(
  p_org_id uuid,
  p_timezone text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_start_local timestamp := p_starts_at at time zone p_timezone;
  v_end_local   timestamp := p_ends_at   at time zone p_timezone;
  v_date date := v_start_local::date;
  v_start_hm text := to_char(v_start_local, 'HH24:MI');
  v_end_hm   text := to_char(v_end_local,   'HH24:MI');
  v_weekday int := extract(dow from v_start_local)::int; -- 0=Sunday, matches JS
begin
  if v_end_local::date <> v_date then
    return false;
  end if;

  if exists (
    select 1 from public.availability_exceptions ae
    where ae.org_id = p_org_id and ae.date = v_date
  ) then
    -- Closed rows have null windows and can never contain the slot.
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.org_id = p_org_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm
    );
  end if;

  return exists (
    select 1 from public.availability_rules ar
    where ar.org_id = p_org_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm
  );
end;
$$;

-- Internal helper: only definer functions call it (as owner) — no role
-- needs EXECUTE.
revoke all on function public.slot_within_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- Hardened create_booking (same signature; OR REPLACE keeps the
-- existing anon EXECUTE grant). Adds: per-org throttle + containment.
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
  v_recent int;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select o.id, o.timezone into v_org from public.orgs o where o.handle = p_handle;
  if v_org.id is null then raise exception 'not found'; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = p_service_id and s.org_id = v_org.id and s.active;
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

  -- S2 hardening 1: per-org creation throttle. The app-side limiter is
  -- per-IP+instance; this is the direct-PostgREST backstop. 30/min matches
  -- publicBookingLimiter.
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  -- S2 hardening 2: availability containment.
  if not public.slot_within_availability(v_org.id, v_org.timezone, p_starts_at, v_ends_at) then
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
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

-- ---------- Client cancel: atomic claim keyed on the token hash. Only a
-- confirmed, future booking flips; empty result = miss/no-op (uniform,
-- like the resolver). Returns what the caller needs for the two emails.
create or replace function public.cancel_booking(p_token text)
returns table (
  booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');

  update public.bookings b
    set status = 'cancelled_by_client'
    where b.cancel_token_hash = v_hash
      and b.status = 'confirmed'
      and b.starts_at > now()
    returning b.id into v_id;
  if v_id is null then return; end if;

  return query
    select b.id, b.org_id, o.name, o.timezone, s.name, b.client_name, b.client_email, b.starts_at
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.id = v_id;
end;
$$;

revoke all on function public.cancel_booking(text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_booking(text) to anon;

-- ---------- Client reschedule: one transaction. Old row is freed FIRST so
-- shifting a booking by less than its own duration cannot self-conflict;
-- a 23P01 on the insert rolls everything back (old stays confirmed).
create or replace function public.reschedule_booking(
  p_token text,
  p_starts_at timestamptz,
  p_new_token_hash text
) returns table (
  new_booking_id uuid,
  org_id uuid,
  org_name text,
  org_timezone text,
  service_name text,
  client_name text,
  client_email text,
  old_starts_at timestamptz,
  new_starts_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_old record;
  v_service record;
  v_tz text;
  v_ends_at timestamptz;
  v_new_id uuid;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  if p_new_token_hash is null or p_new_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');

  select b.id, b.org_id, b.service_id, b.client_id, b.client_name, b.client_email,
         b.note, b.starts_at
    into v_old
    from public.bookings b
    where b.cancel_token_hash = v_hash
      and b.status = 'confirmed'
      and b.starts_at > now()
    for update;
  if v_old.id is null then return; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;

  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.org_id, v_tz, p_starts_at, v_ends_at) then
    raise exception 'not found';
  end if;

  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends_at, 'confirmed', p_new_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;

  return query
    select v_new_id, v_old.org_id, o.name, o.timezone, s.name,
           v_old.client_name, v_old.client_email, v_old.starts_at, p_starts_at
    from public.orgs o, public.services s
    where o.id = v_old.org_id and s.id = v_old.service_id;
end;
$$;

revoke all on function public.reschedule_booking(text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking(text, timestamptz, text) to anon;

-- ---------- Admin reschedule (update_org_scheduling idiom: user_orgs
-- membership check, generic raises). Old booking may be past-started
-- (provider fixing a missed appointment); the NEW time must be future,
-- inside the window, and available.
create or replace function public.reschedule_booking_admin(
  p_booking_id uuid,
  p_starts_at timestamptz,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old record;
  v_service record;
  v_tz text;
  v_ends_at timestamptz;
  v_new_id uuid;
begin
  if p_booking_id is null then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  select b.id, b.org_id, b.service_id, b.client_id, b.client_name, b.client_email, b.note
    into v_old
    from public.bookings b
    where b.id = p_booking_id
      and b.org_id in (select public.user_orgs())
      and b.status = 'confirmed'
    for update;
  if v_old.id is null then raise exception 'not found'; end if;

  select s.id, s.duration_min, s.booking_window_days into v_service
    from public.services s
    where s.id = v_old.service_id and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  select o.timezone into v_tz from public.orgs o where o.id = v_old.org_id;

  if p_starts_at is null or p_starts_at <= now() then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_service.booking_window_days + 1) then
    raise exception 'not found';
  end if;
  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);
  if not public.slot_within_availability(v_old.org_id, v_tz, p_starts_at, v_ends_at) then
    raise exception 'not found';
  end if;

  update public.bookings b set status = 'rescheduled' where b.id = v_old.id;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, rescheduled_from_id)
  values
    (v_old.org_id, v_old.service_id, v_old.client_id, v_old.client_name, v_old.client_email,
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, v_old.note, v_old.id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.reschedule_booking_admin(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.reschedule_booking_admin(uuid, timestamptz, text)
  to authenticated;

-- ---------- Resolver v2: + org_id, service_id (manage page needs them to
-- load the reschedule slot context). Return-type change forces DROP —
-- grants do not survive, re-applied below.
drop function public.resolve_booking_token(text);

create function public.resolve_booking_token(p_token text)
returns table (
  booking_id uuid,
  booking_status text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  org_name text,
  org_timezone text,
  org_id uuid,
  service_id uuid
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
    select b.id, b.status, b.starts_at, b.ends_at, s.name, o.name, o.timezone,
           b.org_id, b.service_id
    from public.bookings b
    join public.services s on s.id = b.service_id
    join public.orgs o on o.id = b.org_id
    where b.cancel_token_hash = v_hash;
end;
$$;

revoke all on function public.resolve_booking_token(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_booking_token(text) to anon;

-- ---------- The 0026-reserved seam: staff cancel via column-scoped status
-- update. USING pins the pre-state (only confirmed rows are touchable),
-- WITH CHECK pins the post-state (only cancelled_by_provider). Everything
-- else — reschedule, un-cancel — is RPC-only or intentionally impossible.
grant update (status) on table public.bookings to authenticated;

create policy "bookings_update_member" on public.bookings
  for update to authenticated
  using (org_id in (select public.user_orgs()) and status = 'confirmed')
  with check (org_id in (select public.user_orgs()) and status = 'cancelled_by_provider');
```

- [ ] **Step 3: Apply and check for drift**

Run: `npm run db:migrate` → applies cleanly.
Run: `npm run db:generate` → no new file (custom migrations invisible to TS schema).

- [ ] **Step 4: Fix the S1 RPC test fixture for the hardening**

The hardened `create_booking` rejects slots outside availability; the S1 fixture (`src/features/scheduling/booking-rpc.integration.test.ts`) created a service but **no availability rules**, so every existing `create_booking` call would now fail. In its `beforeAll`, after the service insert, add all-week rules:

```ts
    // S2 hardening: create_booking now enforces availability containment —
    // open the whole week so the fixed 2027 test instants stay bookable.
    const { error: e4 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId,
        weekday,
        start_time: "00:00",
        end_time: "23:59",
      })),
    );
    if (e4) throw e4;
```

- [ ] **Step 5: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS (all S1 suites green against the migrated stack).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations src/features/scheduling/booking-rpc.integration.test.ts
git commit -m "feat: scheduling — booking lifecycle security migration 0028 (cancel/reschedule RPCs, RPC hardening, admin status seam)"
```

---

### Task 3: Lifecycle RPC integration tests

**Files:**
- Create: `src/features/scheduling/lifecycle-rpc.integration.test.ts`

**Interfaces:**
- Consumes: all Task 2 RPCs; `generateAccessToken` from `@/lib/tokens/mint`.

- [ ] **Step 1: Write the test file**

Fixture idiom from `booking-rpc.integration.test.ts` (namespaced handle, `loadEnvFile` try/catch, `signedInUser` helper, order-dependent `it` blocks). Org timezone **UTC** so wall-times equal UTC instants; rules Mon–Sun **09:00–17:00**; service duration 60, `booking_window_days: 365`. All fixed instants in 2027 fall inside the window.

```ts
/**
 * S2 lifecycle RPCs: cancel_booking, reschedule_booking,
 * reschedule_booking_admin, the hardened create_booking (throttle +
 * availability containment), the recreated resolver, and the
 * column-scoped admin status seam. Requires the local Supabase stack.
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

const HANDLE = `lc-rpc-${Date.now()}`;

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

async function book(startsAt: string, email: string) {
  const { token, tokenHash } = generateAccessToken();
  const { data, error } = await anon.rpc("create_booking", {
    p_handle: HANDLE,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_name: "Lifecycle Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
  });
  return { token, bookingId: data as string | null, error };
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let serviceId: string;

describe("S2 lifecycle RPCs", () => {
  beforeAll(async () => {
    owner = await signedInUser("lc_owner");
    stranger = await signedInUser("lc_stranger");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "LifecycleCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // stranger gets their own org so their staff client is a *member
    // somewhere* but foreign to LifecycleCo.
    const { error: e1b } = await stranger.rpc("create_org", { p_name: "StrangerCo" });
    if (e1b) throw e1b;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "UTC",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    const { error: e4 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId,
        weekday,
        start_time: "09:00",
        end_time: "17:00",
      })),
    );
    if (e4) throw e4;
  });

  it("hardening: off-hours direct RPC create is rejected, in-hours accepted", async () => {
    const night = await book("2027-04-05T03:00:00Z", "night@example.com");
    expect(night.error).not.toBeNull();
    expect(night.error!.message).toContain("not found");
    const day = await book("2027-04-05T10:00:00Z", "day@example.com");
    expect(day.error).toBeNull();
  });

  it("hardening: closed exception blocks the day; open exception replaces rules", async () => {
    const { error: exErr } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: "2027-04-06", closed: true });
    expect(exErr).toBeNull();
    const closed = await book("2027-04-06T10:00:00Z", "closed@example.com");
    expect(closed.error).not.toBeNull();

    const { error: ex2Err } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: "2027-04-07", closed: false, start_time: "13:00", end_time: "15:00" });
    expect(ex2Err).toBeNull();
    const outside = await book("2027-04-07T10:00:00Z", "outside@example.com");
    expect(outside.error).not.toBeNull();
    const inside = await book("2027-04-07T13:00:00Z", "inside@example.com");
    expect(inside.error).toBeNull();
  });

  it("resolver v2 exposes org_id and service_id", async () => {
    const { token, error } = await book("2027-04-05T11:00:00Z", "resolve@example.com");
    expect(error).toBeNull();
    const { data } = await anon.rpc("resolve_booking_token", { p_token: token });
    const row = (data as Array<{ org_id: string; service_id: string }>)[0];
    expect(row.org_id).toBe(orgId);
    expect(row.service_id).toBe(serviceId);
  });

  it("cancel_booking flips a confirmed future booking and frees its slot", async () => {
    const { token, error } = await book("2027-04-05T12:00:00Z", "cancelme@example.com");
    expect(error).toBeNull();
    const { data, error: cErr } = await anon.rpc("cancel_booking", { p_token: token });
    expect(cErr).toBeNull();
    const row = (data as Array<{ booking_id: string; org_timezone: string; client_email: string }>)[0];
    expect(row.client_email).toBe("cancelme@example.com");
    expect(row.org_timezone).toBe("UTC");

    const { data: b } = await admin
      .from("bookings")
      .select("status")
      .eq("id", row.booking_id)
      .single();
    expect(b!.status).toBe("cancelled_by_client");

    // Second cancel with the same token: uniform empty no-op.
    const { data: again } = await anon.rpc("cancel_booking", { p_token: token });
    expect(again).toEqual([]);

    // The slot is free again.
    const rebook = await book("2027-04-05T12:00:00Z", "rebook@example.com");
    expect(rebook.error).toBeNull();
  });

  it("cancel_booking refuses a past booking", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { error } = await admin.from("bookings").insert({
      org_id: orgId,
      service_id: serviceId,
      client_name: "Past",
      client_email: "past@example.com",
      starts_at: "2026-01-05T10:00:00Z",
      ends_at: "2026-01-05T11:00:00Z",
      cancel_token_hash: tokenHash,
    });
    expect(error).toBeNull();
    const { data } = await anon.rpc("cancel_booking", { p_token: token });
    expect(data).toEqual([]);
  });

  it("reschedule_booking: new linked row, old freed + marked, both tokens resolve", async () => {
    const { token, bookingId, error } = await book("2027-04-05T13:00:00Z", "move@example.com");
    expect(error).toBeNull();
    const fresh = generateAccessToken();
    const { data, error: rErr } = await anon.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-04-05T15:00:00Z",
      p_new_token_hash: fresh.tokenHash,
    });
    expect(rErr).toBeNull();
    const row = (data as Array<{ new_booking_id: string; old_starts_at: string; new_starts_at: string }>)[0];

    const { data: oldRow } = await admin
      .from("bookings").select("status").eq("id", bookingId!).single();
    expect(oldRow!.status).toBe("rescheduled");
    const { data: newRow } = await admin
      .from("bookings")
      .select("status, rescheduled_from_id, starts_at")
      .eq("id", row.new_booking_id)
      .single();
    expect(newRow!.status).toBe("confirmed");
    expect(newRow!.rescheduled_from_id).toBe(bookingId);

    // Old token resolves to history; new token resolves to the new booking.
    const { data: oldResolved } = await anon.rpc("resolve_booking_token", { p_token: token });
    expect((oldResolved as Array<{ booking_status: string }>)[0].booking_status).toBe("rescheduled");
    const { data: newResolved } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
    expect((newResolved as Array<{ booking_id: string }>)[0].booking_id).toBe(row.new_booking_id);

    // The vacated 13:00 slot is bookable again.
    const rebook = await book("2027-04-05T13:00:00Z", "vacated@example.com");
    expect(rebook.error).toBeNull();
  });

  it("reschedule conflict rolls the whole transaction back (old stays confirmed)", async () => {
    const a = await book("2027-04-08T10:00:00Z", "atomic-a@example.com");
    const b = await book("2027-04-08T12:00:00Z", "atomic-b@example.com");
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const { error } = await anon.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-08T12:00:00Z",
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23P01");
    const { data: aRow } = await admin
      .from("bookings").select("status").eq("id", a.bookingId!).single();
    expect(aRow!.status).toBe("confirmed");
  });

  it("reschedule allows overlapping the booking's own old slot", async () => {
    const a = await book("2027-04-09T10:00:00Z", "shift@example.com");
    expect(a.error).toBeNull();
    const { data, error } = await anon.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-09T10:30:00Z", // overlaps its own 10:00–11:00
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(1);
  });

  it("reschedule_booking rejects off-availability and malformed hash", async () => {
    const a = await book("2027-04-12T10:00:00Z", "reject@example.com");
    expect(a.error).toBeNull();
    const { error: offHours } = await anon.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-12T20:00:00Z",
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(offHours).not.toBeNull();
    const { error: badHash } = await anon.rpc("reschedule_booking", {
      p_token: a.token,
      p_starts_at: "2027-04-12T14:00:00Z",
      p_new_token_hash: "not-hex",
    });
    expect(badHash).not.toBeNull();
  });

  it("reschedule_booking_admin: member ok, foreign member uniform miss", async () => {
    const a = await book("2027-04-13T10:00:00Z", "admin-move@example.com");
    expect(a.error).toBeNull();
    const { error: foreign } = await stranger.rpc("reschedule_booking_admin", {
      p_booking_id: a.bookingId,
      p_starts_at: "2027-04-13T14:00:00Z",
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(foreign).not.toBeNull();
    expect(foreign!.message).toContain("not found");

    const { data: newId, error } = await owner.rpc("reschedule_booking_admin", {
      p_booking_id: a.bookingId,
      p_starts_at: "2027-04-13T14:00:00Z",
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error).toBeNull();
    const { data: newRow } = await admin
      .from("bookings")
      .select("rescheduled_from_id, status")
      .eq("id", newId as string)
      .single();
    expect(newRow!.rescheduled_from_id).toBe(a.bookingId);
    expect(newRow!.status).toBe("confirmed");
  });

  it("admin status seam: confirmed→cancelled_by_provider only, own org only", async () => {
    const a = await book("2027-04-14T10:00:00Z", "seam@example.com");
    expect(a.error).toBeNull();

    // Foreign member: policy filters the row out — zero rows updated.
    const { data: foreignRows } = await stranger
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(foreignRows).toEqual([]);

    // A non-status column is not granted at all.
    const { error: colErr } = await owner
      .from("bookings")
      .update({ client_name: "hax" })
      .eq("id", a.bookingId!);
    expect(colErr).not.toBeNull();

    // Member flips confirmed → cancelled_by_provider.
    const { data: rows, error } = await owner
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(error).toBeNull();
    expect(rows!.length).toBe(1);

    // Un-cancel is impossible: USING pins status='confirmed'.
    const { data: unRows } = await owner
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", a.bookingId!)
      .select("id");
    expect(unRows).toEqual([]);

    // An arbitrary target status fails WITH CHECK.
    const b2 = await book("2027-04-14T12:00:00Z", "seam2@example.com");
    expect(b2.error).toBeNull();
    const { error: badTarget } = await owner
      .from("bookings")
      .update({ status: "rescheduled" })
      .eq("id", b2.bookingId!);
    expect(badTarget).not.toBeNull();
  });

  // LAST on purpose: floods its own dedicated org so the 30/min per-org
  // throttle never bleeds into the suites above.
  it("hardening: per-org creation throttle trips at 30/min", async () => {
    const flooder = await signedInUser("lc_flood");
    const { data: org2 } = await flooder.rpc("create_org", { p_name: "FloodCo" });
    const floodOrgId = (org2 as { id: string }).id;
    const floodHandle = `lc-flood-${Date.now()}`;
    await flooder.rpc("update_org_scheduling", {
      p_org_id: floodOrgId,
      p_handle: floodHandle,
      p_timezone: "UTC",
    });
    const { data: svc2 } = await flooder
      .from("services")
      .insert({ org_id: floodOrgId, name: "Flood", duration_min: 30, booking_window_days: 365 })
      .select("id")
      .single();
    await flooder.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: floodOrgId,
        weekday,
        start_time: "00:00",
        end_time: "23:59",
      })),
    );

    // 48 half-hour slots per day — walk forward from 2027-05-03T00:00Z.
    let rejected = false;
    for (let i = 0; i < 31; i++) {
      const day = 3 + Math.floor(i / 48);
      const minutes = (i % 48) * 30;
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      const { error } = await anon.rpc("create_booking", {
        p_handle: floodHandle,
        p_service_id: svc2!.id,
        p_starts_at: `2027-05-${String(day).padStart(2, "0")}T${hh}:${mm}:00Z`,
        p_name: "Flood",
        p_email: `flood${i}@example.com`,
        p_note: null,
        p_token_hash: generateAccessToken().tokenHash,
      });
      if (error) {
        rejected = true;
        expect(i).toBeGreaterThanOrEqual(30);
        break;
      }
    }
    expect(rejected).toBe(true);
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:integration -- src/features/scheduling/lifecycle-rpc.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/lifecycle-rpc.integration.test.ts
git commit -m "test: scheduling — lifecycle RPCs, hardening, admin status seam"
```

---

### Task 4: Lib layer (resolver v2 TS, slot-context loader, provider email)

**Files:**
- Modify: `src/lib/tokens/booking.ts`, `src/lib/booking/public.ts`, `src/features/scheduling/public-actions.ts`
- Create: `src/lib/booking/provider.ts`

**Interfaces:**
- Produces (consumed by Tasks 7, 9, 12):
  - `ResolveBookingResult` ok-branch booking gains `orgId: string; serviceId: string`.
  - `getPublicServiceById(orgId: string, serviceId: string): Promise<PublicService | null>` (active services only).
  - `loadOrgSlotContext(orgId: string, serviceId: string, fromDate: string, days: number, opts?: { excludeBookingId?: string }): Promise<{ service: PublicService; rules: SlotRule[]; exceptions: SlotException[]; busy: Array<{ startsAt: Date; endsAt: Date }> } | null>`
  - `getBusyIntervals` gains optional 4th param `excludeBookingId?: string`.
  - `getProviderEmail(orgId: string): Promise<string | null>`.

- [ ] **Step 1: Extend the resolver mapping in `src/lib/tokens/booking.ts`**

Add `orgId: string; serviceId: string;` to the ok-branch `booking` type; add `org_id: string; service_id: string;` to the row cast; map `orgId: row.org_id, serviceId: row.service_id` in the returned object.

- [ ] **Step 2: Extend `src/lib/booking/public.ts`**

Append to `getBusyIntervals` an optional param and filter:

```ts
export async function getBusyIntervals(
  orgId: string,
  fromIso: string,
  toIso: string,
  excludeBookingId?: string,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const admin = createAdminClient();
  let query = admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  // Reschedule pickers drop the booking's own interval: the RPC frees the
  // old row before inserting, so "overlaps itself" is a legal target.
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
}
```

Add below `listPublicServices`:

```ts
export async function getPublicServiceById(
  orgId: string,
  serviceId: string,
): Promise<PublicService | null> {
  const services = await listPublicServices(orgId);
  return services.find((s) => s.id === serviceId) ?? null;
}
```

Add at the bottom (imports `addDaysISO` from `@/features/scheduling/slots`):

```ts
// Everything the slot engine needs for one org+service. Shared by the
// public booking page, the tokenized manage page, and the admin
// reschedule dialog (public-actions' former loadSlotContext, org-keyed).
export async function loadOrgSlotContext(
  orgId: string,
  serviceId: string,
  fromDate: string,
  days: number,
  opts?: { excludeBookingId?: string },
): Promise<{
  service: PublicService;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: Array<{ startsAt: Date; endsAt: Date }>;
} | null> {
  const service = await getPublicServiceById(orgId, serviceId);
  if (!service) return null;
  const { rules, exceptions } = await getAvailability(orgId);
  // Fetch busy one day beyond both edges — buffers can reach across
  // org-local midnight in UTC terms.
  const busy = await getBusyIntervals(
    orgId,
    `${addDaysISO(fromDate, -1)}T00:00:00Z`,
    `${addDaysISO(fromDate, days + 1)}T23:59:59Z`,
    opts?.excludeBookingId,
  );
  return { service, rules, exceptions, busy };
}
```

- [ ] **Step 3: Refactor `public-actions.ts` to use it**

Replace the body of the private `loadSlotContext` so behavior is identical but shared:

```ts
async function loadSlotContext(handle: string, serviceId: string, fromDate: string, days: number) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  const ctx = await loadOrgSlotContext(org.orgId, serviceId, fromDate, days);
  if (!ctx) return null;
  return { org, ...ctx };
}
```

Update the import from `@/lib/booking/public` to `{ getBookingOrg, loadOrgSlotContext }` (drop now-unused `listPublicServices`, `getAvailability`, `getBusyIntervals`).

- [ ] **Step 4: Create `src/lib/booking/provider.ts`**

```ts
import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Solo-provider assumption (spec actor model): the org's oldest member IS
// the provider. Best-effort — notification callers treat null as "skip",
// never as an error.
export async function getProviderEmail(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(data.user_id);
  if (userError) return null;
  return user.user?.email ?? null;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm run verify` → PASS. Run: `npm run test:integration -- src/features/scheduling/booking-rpc.integration.test.ts` → PASS (refactor is behavior-preserving).

```bash
git add src/lib src/features/scheduling/public-actions.ts
git commit -m "feat: scheduling — org-keyed slot context, resolver v2 mapping, provider email lookup"
```

---

### Task 5: Input schemas + the `handle: null` fix

**Files:**
- Modify: `src/features/scheduling/schema.ts`, `src/features/scheduling/schema.test.ts`, `src/features/scheduling/components/scheduling-settings-form.tsx`

**Interfaces:**
- Produces (consumed by Tasks 7, 12):
  - `manageTokenInput` → `{ token: string }` (20–200 chars)
  - `manageSlotsInput` → `{ token, fromDate, days }`
  - `rescheduleBookingInput` → `{ token, startsAt }` (ISO datetime)
  - `bookingIdInput` → `{ id: uuid }`
  - `adminRescheduleInput` → `{ id: uuid, startsAt }`
  - `adminSlotsInput` → `{ serviceId: uuid, fromDate, days }`
  - `schedulingSettingsInput.handle` now parses to `string | null` ("" → null).

- [ ] **Step 1: Extend `schema.ts`**

Replace `schedulingSettingsInput` with:

```ts
export const schedulingSettingsInput = z.object({
  // "" (cleared field) → null: the provider can unpublish the booking page
  // or set a timezone before ever choosing a handle (S1 deferral).
  // update_org_scheduling already accepts a null handle.
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().regex(HANDLE_RE), z.null()]),
  ),
  timezone: z.string().min(1).max(64),
});
```

Append after `createBookingInput`:

```ts
const tokenField = z.string().min(20).max(200);

export const manageTokenInput = z.object({ token: tokenField });

export const manageSlotsInput = z.object({
  token: tokenField,
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});

export const rescheduleBookingInput = z.object({
  token: tokenField,
  startsAt: z.iso.datetime(),
});

export const bookingIdInput = z.object({ id: z.uuid() });

export const adminRescheduleInput = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
});

export const adminSlotsInput = z.object({
  serviceId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});
```

- [ ] **Step 2: Extend `schema.test.ts`**

Add a describe block (existing file's style — plain `safeParse` assertions):

```ts
describe("schedulingSettingsInput handle clearing", () => {
  it("maps empty and whitespace handle to null", () => {
    expect(schedulingSettingsInput.parse({ handle: "", timezone: "UTC" }).handle).toBeNull();
    expect(schedulingSettingsInput.parse({ handle: "  ", timezone: "UTC" }).handle).toBeNull();
  });
  it("still rejects a malformed non-empty handle", () => {
    expect(schedulingSettingsInput.safeParse({ handle: "Bad Handle!", timezone: "UTC" }).success).toBe(false);
  });
  it("passes a valid handle through", () => {
    expect(schedulingSettingsInput.parse({ handle: "my-studio", timezone: "UTC" }).handle).toBe("my-studio");
  });
});

describe("lifecycle inputs", () => {
  it("manageTokenInput bounds token length", () => {
    expect(manageTokenInput.safeParse({ token: "short" }).success).toBe(false);
    expect(manageTokenInput.safeParse({ token: "x".repeat(43) }).success).toBe(true);
  });
  it("rescheduleBookingInput requires an ISO instant", () => {
    expect(
      rescheduleBookingInput.safeParse({ token: "x".repeat(43), startsAt: "tomorrow" }).success,
    ).toBe(false);
    expect(
      rescheduleBookingInput.safeParse({ token: "x".repeat(43), startsAt: "2027-04-05T10:00:00Z" }).success,
    ).toBe(true);
  });
  it("adminSlotsInput caps the scan window", () => {
    expect(
      adminSlotsInput.safeParse({ serviceId: crypto.randomUUID(), fromDate: "2027-04-05", days: 60 }).success,
    ).toBe(false);
  });
});
```

(Import the new schemas in the test file's import list.)

- [ ] **Step 3: Settings form copy**

In `scheduling-settings-form.tsx`, update the handle helper text to mention clearing:

```tsx
        <p className="text-muted-foreground text-xs">
          Lowercase letters, digits and hyphens, 3–50 characters. Leave empty
          to unpublish your booking page.
        </p>
```

(No logic change needed: the form already sends the raw string; the schema now maps `""` → null, the RPC accepts null, and the "Public booking page" block is already gated on a truthy `savedHandle`.)

- [ ] **Step 4: Run tests, verify, commit**

Run: `npx vitest run src/features/scheduling/schema.test.ts` → PASS. Run: `npm run verify` → PASS (the `updateSchedulingSettings` action already forwards `parsed.data.handle`, whose type widens to `string | null` — if typecheck flags the RPC arg, it already accepts null; fix the local type annotation, not the RPC).

```bash
git add src/features/scheduling/schema.ts src/features/scheduling/schema.test.ts src/features/scheduling/components/scheduling-settings-form.tsx
git commit -m "feat: scheduling — lifecycle input schemas; handle can be cleared (S1 deferral)"
```

---

### Task 6: Email templates for the lifecycle + reminder

**Files:**
- Modify: `src/features/scheduling/templates.ts`
- Create: `src/features/scheduling/templates.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 7, 10, 12), all returning `{ subject: string; html: string; text: string }`:
  - `bookingLifecycleKey(bookingId: string, kind: "cancelled" | "rescheduled" | "reminder" | "provider-cancelled" | "provider-rescheduled"): string` → `` `booking/${bookingId}/${kind}` ``
  - `bookingCancelledEmail({ orgName, serviceName, whenLine, cancelledBy }: { …; cancelledBy: "client" | "provider" })`
  - `bookingRescheduledEmail({ orgName, serviceName, oldWhenLine, whenLine, manageUrl, icsUrl })`
  - `bookingReminderEmail({ orgName, serviceName, whenLine })`
  - `providerCancelledEmail({ serviceName, whenLine, clientName })`
  - `providerRescheduledEmail({ serviceName, oldWhenLine, whenLine, clientName })`

- [ ] **Step 1: Append to `templates.ts`**

Follow the existing `bookingConfirmationEmail` shape exactly (inline styles, `esc()` on every interpolation, text fallback):

```ts
export function bookingLifecycleKey(
  bookingId: string,
  kind: "cancelled" | "rescheduled" | "reminder" | "provider-cancelled" | "provider-rescheduled",
): string {
  return `booking/${bookingId}/${kind}`;
}

export function bookingCancelledEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  cancelledBy: "client" | "provider";
}): { subject: string; html: string; text: string } {
  const lead =
    input.cancelledBy === "client"
      ? "Your booking has been cancelled as requested."
      : `${input.orgName} had to cancel your booking.`;
  const subject = `Booking cancelled — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(lead)}</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Need a new appointment? Book again any time on the booking page.
  </p>
</div>`.trim();
  const text = [input.orgName, "", lead, input.serviceName, input.whenLine].join("\n");
  return { subject, html, text };
}

export function bookingRescheduledEmail(input: {
  orgName: string;
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  manageUrl: string;
  icsUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Booking rescheduled — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking has been moved.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.icsUrl)}">Add to calendar (.ics)</a>
  </p>
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or manage this booking</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above replaces your previous manage link.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "Your booking has been moved.",
    input.serviceName,
    `Was: ${input.oldWhenLine}`,
    `Now: ${input.whenLine}`,
    "",
    `Add to calendar: ${input.icsUrl}`,
    `View or manage: ${input.manageUrl}`,
  ].join("\n");
  return { subject, html, text };
}

// Deliberately link-free: only the token HASH is stored, so the manage URL
// cannot be reconstructed at drain time. The confirmation email carries
// the credential.
export function bookingReminderEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
}): { subject: string; html: string; text: string } {
  const subject = `Reminder — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">A reminder about your upcoming appointment.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Need to change or cancel? Use the link in your confirmation email.
  </p>
</div>`.trim();
  const text = [
    input.orgName,
    "",
    "A reminder about your upcoming appointment.",
    input.serviceName,
    input.whenLine,
    "",
    "Need to change or cancel? Use the link in your confirmation email.",
  ].join("\n");
  return { subject, html, text };
}

export function providerCancelledEmail(input: {
  serviceName: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Cancelled by client — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;"><strong>${esc(input.clientName)}</strong> cancelled their booking.</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">The slot is open again.</p>
</div>`.trim();
  const text = [
    `${input.clientName} cancelled their booking.`,
    input.serviceName,
    input.whenLine,
    "",
    "The slot is open again.",
  ].join("\n");
  return { subject, html, text };
}

export function providerRescheduledEmail(input: {
  serviceName: string;
  oldWhenLine: string;
  whenLine: string;
  clientName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Rescheduled by client — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p style="margin: 0 0 8px;"><strong>${esc(input.clientName)}</strong> moved their booking.</p>
  <p style="margin: 0 0 4px;">${esc(input.serviceName)}</p>
  <p style="margin: 0 0 4px; text-decoration: line-through; color: #666;">${esc(input.oldWhenLine)}</p>
  <p style="margin: 0 0 16px;"><strong>${esc(input.whenLine)}</strong></p>
</div>`.trim();
  const text = [
    `${input.clientName} moved their booking.`,
    input.serviceName,
    `Was: ${input.oldWhenLine}`,
    `Now: ${input.whenLine}`,
  ].join("\n");
  return { subject, html, text };
}
```

- [ ] **Step 2: Write `templates.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  bookingLifecycleKey,
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingReminderEmail,
  providerCancelledEmail,
} from "./templates";

describe("booking lifecycle templates", () => {
  it("lifecycle keys are stable per booking+kind", () => {
    expect(bookingLifecycleKey("b1", "reminder")).toBe("booking/b1/reminder");
    expect(bookingLifecycleKey("b1", "cancelled")).toBe("booking/b1/cancelled");
  });

  it("cancellation copy differs by initiator", () => {
    const base = { orgName: "Studio", serviceName: "Cut", whenLine: "Mon, 05 Apr" };
    expect(bookingCancelledEmail({ ...base, cancelledBy: "client" }).text).toContain("as requested");
    expect(bookingCancelledEmail({ ...base, cancelledBy: "provider" }).text).toContain("had to cancel");
  });

  it("rescheduled email carries both times and the new manage link", () => {
    const msg = bookingRescheduledEmail({
      orgName: "Studio",
      serviceName: "Cut",
      oldWhenLine: "OLD-TIME",
      whenLine: "NEW-TIME",
      manageUrl: "https://app/booking/tok",
      icsUrl: "https://app/booking/tok/calendar.ics",
    });
    expect(msg.text).toContain("Was: OLD-TIME");
    expect(msg.text).toContain("Now: NEW-TIME");
    expect(msg.html).toContain("https://app/booking/tok");
  });

  it("reminder email contains no URL at all (token cannot be reconstructed)", () => {
    const msg = bookingReminderEmail({ orgName: "Studio", serviceName: "Cut", whenLine: "Mon" });
    expect(msg.html).not.toContain("http");
    expect(msg.text).not.toContain("http");
  });

  it("escapes HTML in interpolations", () => {
    const msg = providerCancelledEmail({
      serviceName: "<script>",
      whenLine: "Mon",
      clientName: "A & B",
    });
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("A &amp; B");
  });
});
```

- [ ] **Step 3: Run, verify, commit**

Run: `npx vitest run src/features/scheduling/templates.test.ts` → PASS. `npm run verify` → PASS.

```bash
git add src/features/scheduling/templates.ts src/features/scheduling/templates.test.ts
git commit -m "feat: scheduling — lifecycle and reminder email templates"
```

---

### Task 7: Manage actions (anon surface)

**Files:**
- Create: `src/features/scheduling/manage-actions.ts`

**Interfaces:**
- Consumes: resolver v2 (Task 4), `loadOrgSlotContext`, `getProviderEmail`, Task 5 schemas, Task 6 templates, `cancel_booking`/`reschedule_booking` RPCs.
- Produces (consumed by Tasks 8, 9):
  - `getManageSlots(input: unknown): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }>`
  - `cancelBooking(input: unknown): Promise<ActionState>`
  - `rescheduleBooking(input: unknown): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }>`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom, generateAccessToken } from "@/lib/tokens";
import { publicBookingLimiter } from "@/lib/tokens/rate-limit";
import { resolveBookingToken, buildBookingManageUrl } from "@/lib/tokens/booking";
import { loadOrgSlotContext } from "@/lib/booking/public";
import { getProviderEmail } from "@/lib/booking/provider";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone } from "./slots";
import {
  bookingCancelledEmail,
  bookingRescheduledEmail,
  providerCancelledEmail,
  providerRescheduledEmail,
  bookingLifecycleKey,
  formatWhenLine,
} from "./templates";
import {
  manageSlotsInput,
  manageTokenInput,
  rescheduleBookingInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

const SLOT_TAKEN = "That time was just taken — please pick another.";
const NOT_CHANGEABLE = "This booking can no longer be changed online.";

async function limited(): Promise<boolean> {
  const key = clientKeyFrom(await headers());
  return !publicBookingLimiter.allow(key);
}

// Token-authenticated resolve for mutations/pickers: only a confirmed,
// still-future booking is actionable (mirrors the RPCs' own guards).
async function resolveActionable(token: string) {
  const result = await resolveBookingToken(token, clientKeyFrom(await headers()));
  if (result.status !== "ok") return null;
  const { booking } = result;
  if (booking.status !== "confirmed") return null;
  if (booking.startsAt.getTime() <= Date.now()) return null;
  return booking;
}

export async function getManageSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = manageSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const booking = await resolveActionable(parsed.data.token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };
    const ctx = await loadOrgSlotContext(
      booking.orgId,
      booking.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
      { excludeBookingId: booking.id },
    );
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate: parsed.data.fromDate,
      days: parsed.data.days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    console.error("[scheduling] getManageSlots:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function cancelBooking(input: unknown): Promise<ActionState> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = manageTokenInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const anon = createAnonServerClient();
    const { data, error } = await anon.rpc("cancel_booking", { p_token: parsed.data.token });
    if (error) {
      console.error("[scheduling] cancelBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const row = (data as Array<{
      booking_id: string;
      org_id: string;
      org_name: string;
      org_timezone: string;
      service_name: string;
      client_name: string;
      client_email: string;
      starts_at: string;
    }> | null)?.[0];
    if (!row) return { ok: false, error: NOT_CHANGEABLE };

    // Best-effort notifications — the cancellation is already committed.
    try {
      const transport = selectTransport();
      const whenLine = formatWhenLine(new Date(row.starts_at), row.org_timezone);
      const msg = bookingCancelledEmail({
        orgName: row.org_name,
        serviceName: row.service_name,
        whenLine,
        cancelledBy: "client",
      });
      await transport.send({
        to: row.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(row.booking_id, "cancelled"),
      });
      const providerEmail = await getProviderEmail(row.org_id);
      if (providerEmail) {
        const notice = providerCancelledEmail({
          serviceName: row.service_name,
          whenLine,
          clientName: row.client_name,
        });
        await transport.send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          idempotencyKey: bookingLifecycleKey(row.booking_id, "provider-cancelled"),
        });
      }
    } catch (mailError) {
      console.error("[scheduling] cancel emails failed:", mailError);
    }
    return { ok: true };
  } catch (error) {
    console.error("[scheduling] cancelBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}

export async function rescheduleBooking(
  input: unknown,
): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }> {
  if (await limited()) return { ok: false, error: "Too many requests — slow down." };
  const parsed = rescheduleBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const booking = await resolveActionable(parsed.data.token);
    if (!booking) return { ok: false, error: NOT_CHANGEABLE };

    // Engine re-check on the org-local day (createBooking idiom): the
    // requested instant must be one of the engine's own outputs. EXCLUDE +
    // the RPC's containment stay the race-proof last lines.
    const starts = new Date(parsed.data.startsAt);
    const localDate = dateInZone(starts, booking.orgTimezone);
    const ctx = await loadOrgSlotContext(booking.orgId, booking.serviceId, localDate, 1, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: NOT_CHANGEABLE };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: booking.orgTimezone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const fresh = generateAccessToken();
    const anon = createAnonServerClient();
    const { data, error } = await anon.rpc("reschedule_booking", {
      p_token: parsed.data.token,
      p_starts_at: starts.toISOString(),
      p_new_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      console.error("[scheduling] rescheduleBooking:", error.code || "rpc error");
      return { ok: false, error: GENERIC_WRITE_ERROR };
    }
    const row = (data as Array<{
      new_booking_id: string;
      org_id: string;
      org_name: string;
      org_timezone: string;
      service_name: string;
      client_name: string;
      client_email: string;
      old_starts_at: string;
      new_starts_at: string;
    }> | null)?.[0];
    if (!row) return { ok: false, error: NOT_CHANGEABLE };

    try {
      const transport = selectTransport();
      const oldWhenLine = formatWhenLine(new Date(row.old_starts_at), row.org_timezone);
      const whenLine = formatWhenLine(new Date(row.new_starts_at), row.org_timezone);
      const msg = bookingRescheduledEmail({
        orgName: row.org_name,
        serviceName: row.service_name,
        oldWhenLine,
        whenLine,
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
      });
      await transport.send({
        to: row.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(row.new_booking_id, "rescheduled"),
      });
      const providerEmail = await getProviderEmail(row.org_id);
      if (providerEmail) {
        const notice = providerRescheduledEmail({
          serviceName: row.service_name,
          oldWhenLine,
          whenLine,
          clientName: row.client_name,
        });
        await transport.send({
          to: providerEmail,
          subject: notice.subject,
          html: notice.html,
          text: notice.text,
          idempotencyKey: bookingLifecycleKey(row.new_booking_id, "provider-rescheduled"),
        });
      }
    } catch (mailError) {
      console.error("[scheduling] reschedule emails failed:", mailError);
    }

    return { ok: true, token: fresh.token };
  } catch (error) {
    console.error("[scheduling] rescheduleBooking:", error);
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
}
```

- [ ] **Step 2: Verify and commit**

Run: `npm run verify` → PASS (behavioral coverage lands in Task 8).

```bash
git add src/features/scheduling/manage-actions.ts
git commit -m "feat: scheduling — client cancel and reschedule actions (tokenized manage surface)"
```

---

### Task 8: Action-layer e2e flow test (deferred from S1)

**Files:**
- Create: `src/features/scheduling/booking-flow.integration.test.ts`

**Interfaces:**
- Consumes: `getSlots`/`createBooking` (public-actions), Task 7 manage actions.

- [ ] **Step 1: Write the test**

Server actions import `next/headers` — mock it before dynamically importing the action modules (top-level `vi.mock` + `await import` keeps env loading first; `vitest.integration.config.ts` already aliases `server-only`). Dates are **relative to now** (engine + RPC both enforce future-ness): scan a 7-day window starting 7 days out.

```ts
/**
 * S1-deferred e2e of the action layer: getSlots → createBooking (incl. the
 * off-grid slotTaken branch) → getManageSlots → rescheduleBooking →
 * cancelBooking. Emails are best-effort inside the actions; transport
 * failures must not fail the flow. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic imports so env is loaded before src/env.ts parses it.
const publicActions = await import("./public-actions");
const manageActions = await import("./manage-actions");
const { addDaysISO } = await import("./slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HANDLE = `flow-${Date.now()}`;

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

let serviceId: string;
const fromDate = addDaysISO(new Date().toISOString().slice(0, 10), 7);

describe("booking flow e2e (action layer)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("flow_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "FlowCo" });
    if (e1) throw e1;
    const orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: "UTC",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Flow Session", duration_min: 60, booking_window_days: 60 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    const { error: e4 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId,
        weekday,
        start_time: "09:00",
        end_time: "17:00",
      })),
    );
    if (e4) throw e4;
  });

  it("books, reschedules, and cancels end-to-end", async () => {
    const slotsRes = await publicActions.getSlots({
      handle: HANDLE,
      serviceId,
      fromDate,
      days: 7,
    });
    expect(slotsRes.ok).toBe(true);
    if (!slotsRes.ok) return;
    expect(slotsRes.slots.length).toBeGreaterThan(2);
    const [first, , third] = slotsRes.slots;

    // Off-grid instant → slotTaken branch, no booking created.
    const offGrid = await publicActions.createBooking({
      handle: HANDLE,
      serviceId,
      startsAt: new Date(new Date(first).getTime() + 7 * 60_000).toISOString(),
      name: "Flow Client",
      email: "flow@example.com",
    });
    expect(offGrid.ok).toBe(false);
    if (!offGrid.ok) expect(offGrid.slotTaken).toBe(true);

    const created = await publicActions.createBooking({
      handle: HANDLE,
      serviceId,
      startsAt: first,
      name: "Flow Client",
      email: "flow@example.com",
      note: "e2e",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The manage picker deliberately still offers the booking's OWN slot
    // (decision #11: excludeBookingId drops the booking's own interval so
    // self-overlap reschedules are legal — the RPC frees the old row first).
    const manageSlots = await manageActions.getManageSlots({
      token: created.token,
      fromDate,
      days: 7,
    });
    expect(manageSlots.ok).toBe(true);
    if (!manageSlots.ok) return;
    expect(manageSlots.slots).toContain(first);
    expect(manageSlots.slots).toContain(third);

    const moved = await manageActions.rescheduleBooking({
      token: created.token,
      startsAt: third,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.token).not.toBe(created.token);

    // Old booking is history; the flow continues on the new token.
    const { data: oldRows } = await admin
      .from("bookings")
      .select("status")
      .eq("client_email", "flow@example.com")
      .eq("starts_at", first);
    expect(oldRows![0].status).toBe("rescheduled");

    const cancelled = await manageActions.cancelBooking({ token: moved.token });
    expect(cancelled.ok).toBe(true);

    const { data: newRows } = await admin
      .from("bookings")
      .select("status")
      .eq("client_email", "flow@example.com")
      .eq("starts_at", third);
    expect(newRows![0].status).toBe("cancelled_by_client");

    // Cancelling again via the same token: friendly refusal, not a 500.
    const again = await manageActions.cancelBooking({ token: moved.token });
    expect(again.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration -- src/features/scheduling/booking-flow.integration.test.ts`
Expected: PASS. (If `selectTransport()` throws locally because Mailpit env is absent, the actions swallow it — the flow must still pass.)

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/booking-flow.integration.test.ts
git commit -m "test: scheduling — action-layer booking flow e2e (S1 deferral)"
```

---

### Task 9: Manage page UI

**Files:**
- Create: `src/features/scheduling/components/manage-booking.tsx`
- Modify: `src/app/booking/[token]/page.tsx`

**Interfaces:**
- Consumes: Task 7 actions, `addDaysISO` from `./slots` (pure, client-safe).

- [ ] **Step 1: Write `manage-booking.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addDaysISO } from "@/features/scheduling/slots";
import {
  cancelBooking,
  getManageSlots,
  rescheduleBooking,
} from "@/features/scheduling/manage-actions";
import { Button } from "@/components/ui/button";

// UTC "today" — matches booking-widget's documented caveat (far-west
// evening viewers start one day ahead; navigation covers it).
const todayISO = () => new Date().toISOString().slice(0, 10);

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function ManageBooking({ token, timeZone }: { token: string; timeZone: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);

  const loadSlots = (date: string) => {
    startTransition(async () => {
      const res = await getManageSlots({ token, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else setSlots(res.slots);
    });
  };

  const openPicker = () => {
    setPicking(true);
    loadSlots(fromDate);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO()) return;
    setFromDate(next);
    loadSlots(next);
  };

  const doCancel = () =>
    startTransition(async () => {
      const res = await cancelBooking({ token });
      if (!res.ok) toast.error(res.error);
      else {
        toast.success("Booking cancelled");
        router.refresh();
      }
    });

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBooking({ token, startsAt });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate);
      } else {
        // New booking, new token: the manage link changes.
        window.location.assign(`/booking/${res.token}`);
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {picking ? (
        <div className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Pick a new time</p>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(-7)}
                disabled={pending || fromDate <= todayISO()}
                aria-label="Previous week"
              >
                ←
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => nav(7)}
                disabled={pending}
                aria-label="Next week"
              >
                →
              </Button>
            </div>
          </div>
          {slots === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : slots.length === 0 ? (
            <p className="text-muted-foreground text-sm">No free times this week — try the next.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {slots.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => pick(s)}
                >
                  {slotLabel(s)}
                </Button>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            Times shown in your local timezone; the provider is in {timeZone}.
          </p>
        </div>
      ) : (
        <Button variant="outline" onClick={openPicker} disabled={pending}>
          Reschedule
        </Button>
      )}
      {confirmingCancel ? (
        <div className="flex items-center gap-2">
          <Button variant="destructive" onClick={doCancel} disabled={pending}>
            Yes, cancel this booking
          </Button>
          <Button variant="ghost" onClick={() => setConfirmingCancel(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => setConfirmingCancel(true)} disabled={pending}>
          Cancel booking
        </Button>
      )}
    </div>
  );
}
```

(If `Button` has no `destructive` variant in this repo's shadcn set, check `src/components/ui/button.tsx` and use the closest existing variant — do not add a new one for this.)

- [ ] **Step 2: Wire it into `src/app/booking/[token]/page.tsx`**

Replace the confirmed-branch placeholder block (the "online changes are coming soon" `<p>`) with the component; keep the ICS link:

```tsx
      {b.status === "confirmed" ? (
        <>
          <a className="text-sm underline" href={`/booking/${token}/calendar.ics`}>
            Add to calendar (.ics)
          </a>
          {b.startsAt.getTime() > Date.now() ? (
            <ManageBooking token={token} timeZone={b.orgTimezone} />
          ) : (
            <p className="text-muted-foreground text-xs">
              This booking has already started.
            </p>
          )}
        </>
      ) : null}
```

Add the import: `import { ManageBooking } from "@/features/scheduling/components/manage-booking";`

- [ ] **Step 3: Manual smoke + verify + commit**

Run: `npm run verify` → PASS. Optionally `npm run dev`, book via `/book/<demo-handle>`, open the emailed manage link (Mailpit :54354), reschedule then cancel.

```bash
git add src/features/scheduling/components/manage-booking.tsx "src/app/booking/[token]/page.tsx"
git commit -m "feat: scheduling — manage page cancel and reschedule UI"
```

---

### Task 10: Reminder engine (pure decision + drain runner)

**Files:**
- Create: `src/features/scheduling/reminders.ts`, `src/features/scheduling/reminders.test.ts`

**Interfaces:**
- Consumes: Task 1 columns, Task 6 `bookingReminderEmail`/`bookingLifecycleKey`, `EmailTransport` from `@/lib/email/transport`.
- Produces (consumed by Task 11):
  - `REMINDER_LEAD_MS`, `REMINDER_BATCH_LIMIT = 25`, `REMINDER_MAX_ATTEMPTS = 5`
  - `decideReminder(booking: { startsAt: Date; createdAt: Date }, now: Date): "send" | "suppress" | "wait"`
  - `type ReminderSummary = { sent: number; skipped: number; failed: number }`
  - `runReminderDrain(deps: { db: SupabaseClient; transport: EmailTransport; now?: Date }): Promise<ReminderSummary>`

- [ ] **Step 1: Write the failing unit tests**

```ts
import { describe, it, expect } from "vitest";
import { decideReminder, REMINDER_LEAD_MS } from "./reminders";

const T0 = new Date("2027-02-10T12:00:00Z");
const hours = (n: number) => n * 60 * 60 * 1000;

describe("decideReminder", () => {
  it("waits while the booking is further out than the lead window", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + REMINDER_LEAD_MS + hours(1)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("wait");
  });

  it("sends inside the lead window for an early-created booking", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + hours(2)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("send");
  });

  it("suppresses when the booking was created inside the lead window", () => {
    // Booked 3h before start: the confirmation email IS the reminder.
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() + hours(2)), createdAt: new Date(T0.getTime() - hours(1)) },
        T0,
      ),
    ).toBe("suppress");
  });

  it("suppresses once the booking has started", () => {
    expect(
      decideReminder(
        { startsAt: new Date(T0.getTime() - hours(1)), createdAt: new Date(T0.getTime() - hours(48)) },
        T0,
      ),
    ).toBe("suppress");
  });
});
```

Run: `npx vitest run src/features/scheduling/reminders.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `reminders.ts`**

```ts
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import { bookingReminderEmail, bookingLifecycleKey, formatWhenLine } from "./templates";

// Booking reminder drain (chasing idiom): claim-before-send on
// reminder_sent_at, rollback + attempt-count on transport failure,
// transport-level dedupe via a stable idempotency key. All timing is
// injected — no clock reads inside decide.

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export const REMINDER_BATCH_LIMIT = 25;
export const REMINDER_MAX_ATTEMPTS = 5;

export type ReminderSummary = { sent: number; skipped: number; failed: number };

export function decideReminder(
  booking: { startsAt: Date; createdAt: Date },
  now: Date,
): "send" | "suppress" | "wait" {
  const lead = booking.startsAt.getTime() - REMINDER_LEAD_MS;
  if (now.getTime() >= booking.startsAt.getTime()) return "suppress";
  if (now.getTime() < lead) return "wait";
  // Booked inside the lead window: the confirmation email just arrived —
  // a reminder would be noise. Stamped (not skipped-forever-rescanned).
  if (booking.createdAt.getTime() > lead) return "suppress";
  return "send";
}

type CandidateRow = {
  id: string;
  client_email: string;
  starts_at: string;
  created_at: string;
  reminder_attempts: number;
  services: { name: string } | null;
  orgs: { name: string; timezone: string } | null;
};

export async function runReminderDrain(deps: {
  db: SupabaseClient;
  transport: EmailTransport;
  now?: Date;
}): Promise<ReminderSummary> {
  const now = deps.now ?? new Date();
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };

  const { data, error } = await deps.db
    .from("bookings")
    .select(
      "id, client_email, starts_at, created_at, reminder_attempts, services(name), orgs(name, timezone)",
    )
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .lt("reminder_attempts", REMINDER_MAX_ATTEMPTS)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + REMINDER_LEAD_MS).toISOString())
    .order("starts_at", { ascending: true })
    .limit(REMINDER_BATCH_LIMIT);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as CandidateRow[]) {
    try {
      const decision = decideReminder(
        { startsAt: new Date(row.starts_at), createdAt: new Date(row.created_at) },
        now,
      );
      if (decision === "wait") continue; // defensive: query bounds already exclude

      // Optimistic claim (chasing idiom): exactly one drain wins the row.
      const { data: claimed, error: claimError } = await deps.db
        .from("bookings")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .eq("status", "confirmed")
        .select("id");
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) {
        summary.skipped += 1; // lost the race
        continue;
      }

      if (decision === "suppress") {
        summary.skipped += 1; // stamped, never rescanned
        continue;
      }

      try {
        const msg = bookingReminderEmail({
          orgName: row.orgs?.name ?? "Your provider",
          serviceName: row.services?.name ?? "Appointment",
          whenLine: formatWhenLine(new Date(row.starts_at), row.orgs?.timezone ?? "UTC"),
        });
        await deps.transport.send({
          to: row.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(row.id, "reminder"),
        });
        summary.sent += 1;
      } catch (sendError) {
        // Roll the claim back so the row is due next tick; cap attempts.
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        await deps.db
          .from("bookings")
          .update({
            reminder_sent_at: null,
            reminder_attempts: row.reminder_attempts + 1,
            reminder_last_error: message.slice(0, 500),
          })
          .eq("id", row.id)
          .eq("reminder_attempts", row.reminder_attempts);
        summary.failed += 1;
      }
    } catch (rowError) {
      // Per-row isolation: one bad row never stops the batch.
      console.error("[scheduling] reminder row failed:", rowError);
      summary.failed += 1;
    }
  }

  return summary;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run src/features/scheduling/reminders.test.ts` → PASS. `npm run verify` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/scheduling/reminders.ts src/features/scheduling/reminders.test.ts
git commit -m "feat: scheduling — reminder decision engine and drain runner"
```

---

### Task 11: Drain route, env, script + reminder integration test

**Files:**
- Create: `src/app/api/scheduling/drain/route.ts`, `scripts/scheduling-drain.ts`, `src/features/scheduling/reminder-drain.integration.test.ts`
- Modify: `src/env.ts`, `package.json`

**Interfaces:**
- Consumes: Task 10 `runReminderDrain`, `isAuthorizedDrainRequest` from `@/features/chasing/drain-auth`.
- Produces: `POST /api/scheduling/drain` (Bearer `SCHEDULING_DRAIN_SECRET`), `npm run scheduling:drain`.

- [ ] **Step 1: env**

In `src/env.ts`, add to the schema object after `CHASE_DRAIN_SECRET`:

```ts
  SCHEDULING_DRAIN_SECRET: z.string().min(16).optional(),
```

and to the `envSchema.parse({...})` call:

```ts
  SCHEDULING_DRAIN_SECRET: process.env.SCHEDULING_DRAIN_SECRET,
```

If a `.env.example` (or similar) exists, add a commented `SCHEDULING_DRAIN_SECRET=` line beside `CHASE_DRAIN_SECRET`.

- [ ] **Step 2: Route**

`src/app/api/scheduling/drain/route.ts` (mirror `src/app/api/chase/drain/route.ts`'s status codes):

```ts
import { env } from "@/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport } from "@/lib/email/transport";
import { isAuthorizedDrainRequest } from "@/features/chasing/drain-auth";
import { runReminderDrain } from "@/features/scheduling/reminders";

// Booking-reminder drain tick. Same operational model as /api/chase/drain:
// POST + Bearer secret now (scripts/scheduling-drain.ts), a cron
// (GH Actions / Vercel) later — same URL, same secret, no code change.
export async function POST(request: Request) {
  if (!env.SCHEDULING_DRAIN_SECRET) {
    return Response.json({ error: "drain disabled" }, { status: 503 });
  }
  if (!isAuthorizedDrainRequest(request.headers.get("authorization"), env.SCHEDULING_DRAIN_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runReminderDrain({
      db: createAdminClient(),
      transport: selectTransport(),
    });
    return Response.json(summary);
  } catch (error) {
    console.error("[scheduling] drain tick failed:", error);
    return Response.json({ error: "drain failed" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Script + npm script**

`scripts/scheduling-drain.ts` — copy `scripts/chase-drain.ts` verbatim, changing the env var to `SCHEDULING_DRAIN_SECRET`, the URL to `/api/scheduling/drain`, and the log prefixes to `scheduling:drain`. In `package.json` scripts, next to `"chase:drain"`:

```json
    "scheduling:drain": "tsx scripts/scheduling-drain.ts",
```

- [ ] **Step 4: Reminder drain integration test**

`src/features/scheduling/reminder-drain.integration.test.ts` — injected fake transports, no HTTP layer (chasing's `drain.integration.test.ts` idiom):

```ts
/**
 * Reminder drain against the real DB: claim, suppress-stamp, rollback on
 * transport failure, idempotent second tick. Requires the local stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { runReminderDrain } from "./reminders";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";

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

function recordingTransport(): { transport: EmailTransport; sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    transport: {
      async send(msg) {
        sent.push(msg);
        return { id: `t-${sent.length}` };
      },
    },
  };
}

const failingTransport: EmailTransport = {
  async send() {
    throw new Error("smtp exploded");
  },
};

const now = new Date();
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000).toISOString();

let orgId: string;
let serviceId: string;
let dueId: string;
let lateId: string;

describe("reminder drain", () => {
  beforeAll(async () => {
    const owner = await signedInUser("rem_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "ReminderCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: svc, error: e2 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Reminded", duration_min: 60 })
      .select("id")
      .single();
    if (e2) throw e2;
    serviceId = svc!.id;

    const insert = (over: Record<string, unknown>) =>
      admin
        .from("bookings")
        .insert({
          org_id: orgId,
          service_id: serviceId,
          client_name: "R Client",
          client_email: "reminded@example.com",
          cancel_token_hash: generateAccessToken().tokenHash,
          status: "confirmed",
          ...over,
        })
        .select("id")
        .single();

    // Due: starts in 2h, created 2 days ago.
    const due = await insert({
      starts_at: hours(2),
      ends_at: hours(3),
      created_at: hours(-48),
    });
    if (due.error) throw due.error;
    dueId = due.data!.id;

    // Late-created: starts in 5h, created 1h ago → suppress-stamp.
    const late = await insert({
      starts_at: hours(5),
      ends_at: hours(6),
      created_at: hours(-1),
    });
    if (late.error) throw late.error;
    lateId = late.data!.id;

    // Outside the lead window: untouched by every tick below.
    const far = await insert({
      starts_at: hours(40),
      ends_at: hours(41),
      created_at: hours(-48),
    });
    if (far.error) throw far.error;

    // Cancelled: never reminded.
    const cancelled = await insert({
      starts_at: hours(8),
      ends_at: hours(9),
      created_at: hours(-48),
      status: "cancelled_by_client",
    });
    if (cancelled.error) throw cancelled.error;
  });

  it("failed send rolls the claim back and counts an attempt", async () => {
    const summary = await runReminderDrain({ db: admin, transport: failingTransport });
    expect(summary.failed).toBe(1); // the due row
    expect(summary.skipped).toBeGreaterThanOrEqual(1); // the late row got stamped
    const { data } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts, reminder_last_error")
      .eq("id", dueId)
      .single();
    expect(data!.reminder_sent_at).toBeNull();
    expect(data!.reminder_attempts).toBe(1);
    expect(data!.reminder_last_error).toContain("smtp exploded");
  });

  it("suppressed late booking was stamped, not left for rescan", async () => {
    const { data } = await admin
      .from("bookings")
      .select("reminder_sent_at")
      .eq("id", lateId)
      .single();
    expect(data!.reminder_sent_at).not.toBeNull();
  });

  it("second tick sends the due reminder with a stable idempotency key", async () => {
    const { transport, sent } = recordingTransport();
    const summary = await runReminderDrain({ db: admin, transport });
    expect(summary.sent).toBe(1);
    expect(sent[0].to).toBe("reminded@example.com");
    expect(sent[0].idempotencyKey).toBe(`booking/${dueId}/reminder`);
    expect(sent[0].html).not.toContain("http"); // link-free by design
  });

  it("third tick is a no-op", async () => {
    const { transport, sent } = recordingTransport();
    const summary = await runReminderDrain({ db: admin, transport });
    expect(summary.sent).toBe(0);
    expect(sent.length).toBe(0);
  });
});
```

Note: `runReminderDrain` scans table-wide (all orgs). `fileParallelism: false` in the integration config prevents cross-file races; within this file the assertions on `summary.sent`/`failed` counts assume no OTHER org has due reminders — earlier suites in this run only create far-future (2027) bookings, which sit outside the 24h lead window. Keep the fixed-2027-dates convention in the other suites or these counts break.

- [ ] **Step 5: Run, verify, commit**

Run: `npm run test:integration -- src/features/scheduling/reminder-drain.integration.test.ts` → PASS. `npm run verify` → PASS.

```bash
git add src/app/api/scheduling src/env.ts scripts/scheduling-drain.ts package.json src/features/scheduling/reminder-drain.integration.test.ts
git commit -m "feat: scheduling — reminder drain route, secret, script (cron-ready)"
```

---

### Task 12: Admin queries + booking actions

**Files:**
- Modify: `src/features/scheduling/queries.ts`
- Create: `src/features/scheduling/booking-actions.ts`

**Interfaces:**
- Consumes: Task 2 RPC + status seam, Task 4 `loadOrgSlotContext`, Task 5 schemas, Task 6 templates.
- Produces (consumed by Task 13):
  - `type AdminBooking = { id: string; serviceId: string; serviceName: string; clientName: string; clientEmail: string; startsAt: string; endsAt: string; status: string; note: string | null; rescheduledFromId: string | null }`
  - `listBookings(): Promise<{ upcoming: AdminBooking[]; past: AdminBooking[] }>`
  - `cancelBookingAdmin(input: unknown): Promise<ActionState>`
  - `getAdminSlots(input: unknown): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }>`
  - `rescheduleBookingAdmin(input: unknown): Promise<{ ok: true } | { ok: false; error: string; slotTaken?: boolean }>`

- [ ] **Step 1: Add `listBookings` to `queries.ts`**

Follow `listServices`' style (staff `createClient()`, manual snake→camel mapping, FK embed for the service name):

```ts
export type AdminBooking = {
  id: string;
  serviceId: string;
  serviceName: string;
  clientName: string;
  clientEmail: string;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
  rescheduledFromId: string | null;
};

const BOOKING_COLUMNS =
  "id, service_id, client_name, client_email, starts_at, ends_at, status, note, rescheduled_from_id, services(name)";

type BookingRow = {
  id: string;
  service_id: string;
  client_name: string;
  client_email: string;
  starts_at: string;
  ends_at: string;
  status: string;
  note: string | null;
  rescheduled_from_id: string | null;
  services: { name: string } | null;
};

function toAdminBooking(b: BookingRow): AdminBooking {
  return {
    id: b.id,
    serviceId: b.service_id,
    serviceName: b.services?.name ?? "—",
    clientName: b.client_name,
    clientEmail: b.client_email,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    status: b.status,
    note: b.note,
    rescheduledFromId: b.rescheduled_from_id,
  };
}

export async function listBookings(): Promise<{ upcoming: AdminBooking[]; past: AdminBooking[] }> {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [upcomingRes, pastRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("status", "confirmed")
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true }),
    // History: anything cancelled/rescheduled, plus confirmed-but-started.
    // Capped — S5's calendar view is the archaeology surface.
    supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .or(`status.neq.confirmed,starts_at.lt.${nowIso}`)
      .order("starts_at", { ascending: false })
      .limit(50),
  ]);
  if (upcomingRes.error) throw upcomingRes.error;
  if (pastRes.error) throw pastRes.error;
  return {
    upcoming: ((upcomingRes.data ?? []) as unknown as BookingRow[]).map(toAdminBooking),
    past: ((pastRes.data ?? []) as unknown as BookingRow[]).map(toAdminBooking),
  };
}
```

- [ ] **Step 2: Write `booking-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateAccessToken } from "@/lib/tokens";
import { buildBookingManageUrl } from "@/lib/tokens/booking";
import { loadOrgSlotContext } from "@/lib/booking/public";
import { selectTransport } from "@/lib/email/transport";
import { env } from "@/env";
import { computeSlots, dateInZone } from "./slots";
import {
  bookingCancelledEmail,
  bookingRescheduledEmail,
  bookingLifecycleKey,
  formatWhenLine,
} from "./templates";
import {
  bookingIdInput,
  adminRescheduleInput,
  adminSlotsInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

const SLOT_TAKEN = "That time was just taken — pick another.";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[scheduling] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrg(): Promise<{ id: string; name: string; timezone: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id, name, timezone").limit(1).maybeSingle();
  return data ?? null;
}

export async function cancelBookingAdmin(input: unknown): Promise<ActionState> {
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    // Column-scoped seam from 0028: only confirmed → cancelled_by_provider
    // can succeed; the org filter is defense-in-depth on top of RLS.
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .select("id, client_email, starts_at, services(name)");
    if (error) return fail("cancelBookingAdmin", error);
    const row = (data as unknown as Array<{
      id: string;
      client_email: string;
      starts_at: string;
      services: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only an upcoming confirmed booking can be cancelled." };

    try {
      const msg = bookingCancelledEmail({
        orgName: org.name,
        serviceName: row.services?.name ?? "Appointment",
        whenLine: formatWhenLine(new Date(row.starts_at), org.timezone),
        cancelledBy: "provider",
      });
      await selectTransport().send({
        to: row.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(row.id, "cancelled"),
      });
    } catch (mailError) {
      console.error("[scheduling] admin cancel email failed:", mailError);
    }

    revalidatePath("/bookings");
    return { ok: true };
  } catch (error) {
    return fail("cancelBookingAdmin", error);
  }
}

export async function getAdminSlots(
  input: unknown,
): Promise<{ ok: true; slots: string[] } | { ok: false; error: string }> {
  const parsed = adminSlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const ctx = await loadOrgSlotContext(
      org.id,
      parsed.data.serviceId,
      parsed.data.fromDate,
      parsed.data.days,
    );
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: parsed.data.fromDate,
      days: parsed.data.days,
    });
    return { ok: true, slots: slots.map((s) => s.toISOString()) };
  } catch (error) {
    return fail("getAdminSlots", error);
  }
}

export async function rescheduleBookingAdmin(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string; slotTaken?: boolean }> {
  const parsed = adminRescheduleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data: booking, error: readError } = await supabase
      .from("bookings")
      .select("id, service_id, client_email, starts_at")
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "confirmed")
      .maybeSingle();
    if (readError) return fail("rescheduleBookingAdmin", readError);
    if (!booking) return { ok: false, error: "Only a confirmed booking can be rescheduled." };

    const starts = new Date(parsed.data.startsAt);
    const localDate = dateInZone(starts, org.timezone);
    const ctx = await loadOrgSlotContext(org.id, booking.service_id, localDate, 1, {
      excludeBookingId: booking.id,
    });
    if (!ctx) return { ok: false, error: GENERIC_WRITE_ERROR };
    const slots = computeSlots({
      service: ctx.service,
      rules: ctx.rules,
      exceptions: ctx.exceptions,
      busy: ctx.busy,
      timeZone: org.timezone,
      now: new Date(),
      fromDate: localDate,
      days: 1,
    });
    if (!slots.some((s) => s.getTime() === starts.getTime())) {
      return { ok: false, error: SLOT_TAKEN, slotTaken: true };
    }

    const fresh = generateAccessToken();
    const { error } = await supabase.rpc("reschedule_booking_admin", {
      p_booking_id: booking.id,
      p_starts_at: starts.toISOString(),
      p_token_hash: fresh.tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: SLOT_TAKEN, slotTaken: true };
      return fail("rescheduleBookingAdmin", error);
    }

    try {
      const msg = bookingRescheduledEmail({
        orgName: org.name,
        serviceName: ctx.service.name,
        oldWhenLine: formatWhenLine(new Date(booking.starts_at), org.timezone),
        whenLine: formatWhenLine(starts, org.timezone),
        manageUrl: buildBookingManageUrl(fresh.token),
        icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
      });
      await selectTransport().send({
        to: booking.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        // Keyed on the OLD id: the new id isn't returned with the email
        // fields, and old-id + kind is just as collision-free.
        idempotencyKey: bookingLifecycleKey(booking.id, "rescheduled"),
      });
    } catch (mailError) {
      console.error("[scheduling] admin reschedule email failed:", mailError);
    }

    revalidatePath("/bookings");
    return { ok: true };
  } catch (error) {
    return fail("rescheduleBookingAdmin", error);
  }
}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run verify` → PASS. (The seam itself is integration-tested in Task 3; these actions are exercised manually in Task 13's smoke.)

```bash
git add src/features/scheduling/queries.ts src/features/scheduling/booking-actions.ts
git commit -m "feat: scheduling — admin bookings query and cancel/reschedule actions"
```

---

### Task 13: Admin Bookings page, nav, command menu

**Files:**
- Create: `src/app/(dashboard)/bookings/page.tsx`, `src/features/scheduling/components/bookings-list.tsx`, `src/features/scheduling/components/booking-reschedule-dialog.tsx`
- Modify: `src/components/shell/nav.ts`, `src/components/command-menu.tsx`

**Interfaces:**
- Consumes: Task 12 `listBookings` + actions, `getSchedulingSettings` from `@/features/orgs/queries`.

- [ ] **Step 1: Page**

`src/app/(dashboard)/bookings/page.tsx` (services/page.tsx layout idiom):

```tsx
import { listBookings } from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { BookingsList } from "@/features/scheduling/components/bookings-list";

export default async function BookingsPage() {
  const [{ upcoming, past }, settings] = await Promise.all([
    listBookings(),
    getSchedulingSettings(),
  ]);
  const timeZone = settings?.timezone ?? "UTC";
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Bookings</h1>
      <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} />
    </div>
  );
}
```

- [ ] **Step 2: List component**

`bookings-list.tsx` — the `services-list.tsx` `<ol>`-of-rows idiom (no table component exists; do not introduce one):

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatWhenLine } from "@/features/scheduling/templates";
import { cancelBookingAdmin } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};

function Row({
  booking,
  timeZone,
  actionable,
}: {
  booking: AdminBooking;
  timeZone: string;
  actionable: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else toast.success("Booking cancelled — the client has been emailed");
      setConfirming(false);
    });

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{booking.serviceName}</p>
        {actionable ? null : (
          <Badge variant="secondary">{STATUS_LABEL[booking.status] ?? booking.status}</Badge>
        )}
      </div>
      <p>{formatWhenLine(new Date(booking.startsAt), timeZone)}</p>
      <p className="text-muted-foreground">
        {booking.clientName} · {booking.clientEmail}
        {booking.note ? ` · “${booking.note}”` : null}
      </p>
      {actionable ? (
        <div className="flex items-center gap-2">
          <BookingRescheduleDialog booking={booking} timeZone={timeZone} />
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
                Confirm cancel
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
              Cancel booking
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function BookingsList({
  upcoming,
  past,
  timeZone,
}: {
  upcoming: AdminBooking[];
  past: AdminBooking[];
  timeZone: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No upcoming bookings. Share your booking page to fill the calendar.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {upcoming.map((b) => (
              <Row key={b.id} booking={b} timeZone={timeZone} actionable />
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Past &amp; cancelled</h2>
        {past.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {past.map((b) => (
              <Row key={b.id} booking={b} timeZone={timeZone} actionable={false} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Reschedule dialog**

`booking-reschedule-dialog.tsx` (service-dialog.tsx Dialog idiom; slot loading like `manage-booking.tsx`):

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { addDaysISO } from "@/features/scheduling/slots";
import { getAdminSlots, rescheduleBookingAdmin } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const todayISO = () => new Date().toISOString().slice(0, 10);

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export function BookingRescheduleDialog({
  booking,
  timeZone,
}: {
  booking: AdminBooking;
  timeZone: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [fromDate, setFromDate] = React.useState(todayISO);
  const [slots, setSlots] = React.useState<string[] | null>(null);

  const loadSlots = (date: string) => {
    startTransition(async () => {
      const res = await getAdminSlots({ serviceId: booking.serviceId, fromDate: date, days: 7 });
      if (!res.ok) toast.error(res.error);
      else setSlots(res.slots);
    });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) loadSlots(fromDate);
  };

  const nav = (days: number) => {
    const next = addDaysISO(fromDate, days);
    if (next < todayISO()) return;
    setFromDate(next);
    loadSlots(next);
  };

  const pick = (startsAt: string) =>
    startTransition(async () => {
      const res = await rescheduleBookingAdmin({ id: booking.id, startsAt });
      if (!res.ok) {
        toast.error(res.error);
        if ("slotTaken" in res && res.slotTaken) loadSlots(fromDate);
      } else {
        toast.success("Booking moved — the client has been emailed");
        setOpen(false);
      }
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move “{booking.serviceName}” for {booking.clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-sm">Week of {fromDate}</p>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav(-7)}
              disabled={pending || fromDate <= todayISO()}
              aria-label="Previous week"
            >
              ←
            </Button>
            <Button variant="ghost" size="sm" onClick={() => nav(7)} disabled={pending} aria-label="Next week">
              →
            </Button>
          </div>
        </div>
        {slots === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="text-muted-foreground text-sm">No free times this week.</p>
        ) : (
          <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">
            {slots.map((s) => (
              <Button key={s} variant="outline" size="sm" disabled={pending} onClick={() => pick(s)}>
                {slotLabel(s)}
              </Button>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">Times in your browser timezone; org timezone: {timeZone}.</p>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Nav + command menu**

`src/components/shell/nav.ts` — Bookings first (it's the daily surface), and update the S-plan comment:

```ts
import { Briefcase, CalendarClock, CalendarDays, Settings2 } from "lucide-react";

// Post-pivot nav (S2): Bookings is the daily surface. Widget joins in S3,
// Clients directory returns in S5.
export const NAV_ITEMS = [
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
```

(Keep whatever the file's current comment/import shape is beyond this — only add `CalendarDays` and the entry.) In `src/components/command-menu.tsx`, add a Bookings navigation entry mirroring the existing Services item exactly (same group, `href: "/bookings"`, label "Bookings", `CalendarDays` icon if items carry icons).

- [ ] **Step 5: Smoke, verify, commit**

Run: `npm run verify` → PASS. Manual smoke (`npm run dev`): seed data, book via the public page, see it under /bookings, reschedule it (client gets Mailpit email with a working new manage link), cancel one.

```bash
git add "src/app/(dashboard)/bookings" src/features/scheduling/components/bookings-list.tsx src/features/scheduling/components/booking-reschedule-dialog.tsx src/components/shell/nav.ts src/components/command-menu.tsx
git commit -m "feat: scheduling — admin bookings page with cancel/reschedule"
```

---

### Task 14: Seed demo booking + final sweep

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Seed a demo booking**

In `scripts/seed.ts`, after the availability-rules block (search `seed: availability Mon-Fri`), add an idempotent demo booking one week out at 10:00 org-local (imports: `wallTimeToUtc`, `addDaysISO` from `../src/features/scheduling/slots`; `generateAccessToken` is already imported; reuse the file's existing org-id and admin-client variables — adapt names to the file):

```ts
  // Demo confirmed booking (idempotent: skip when any future confirmed
  // booking exists). Books next week 10:00 org-local against the demo
  // service so /bookings and the manage link have something to show.
  const { data: futureBookings } = await admin
    .from("bookings")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gt("starts_at", new Date().toISOString())
    .limit(1);
  if (!futureBookings?.length) {
    const { data: demoService } = await admin
      .from("services")
      .select("id, duration_min")
      .eq("org_id", orgId)
      .limit(1)
      .maybeSingle();
    if (demoService) {
      const { token, tokenHash } = generateAccessToken();
      const startsAt = wallTimeToUtc(
        addDaysISO(new Date().toISOString().slice(0, 10), 7),
        "10:00",
        DEMO_TIMEZONE,
      );
      const endsAt = new Date(startsAt.getTime() + demoService.duration_min * 60_000);
      const { error } = await admin.from("bookings").insert({
        org_id: orgId,
        service_id: demoService.id,
        client_name: "Demo Client",
        client_email: "demo-client@example.com",
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        cancel_token_hash: tokenHash,
      });
      if (error) throw error;
      console.log(`seed: demo booking -> http://localhost:3000/booking/${token}`);
    }
  }
```

(Note: seeding 10:00 on a weekend lands outside Mon–Fri availability — that's fine; the row is inserted via service_role, not the hardened RPC, and the manage-page pickers only constrain the NEW time.)

Run: `npm run db:seed` (or the repo's seed script name from package.json) → prints the manage URL; run twice → no duplicate.

- [ ] **Step 2: Full verification sweep**

Run: `npm run verify` → PASS.
Run: `npm run test:integration` → PASS (all suites, serially, on a freshly migrated stack — `npm run db:reset` first if the local DB has drifted from manual smoke testing).
Run: `npm run build` → PASS (Next 16 typedRoutes catch page-props mistakes only here).

- [ ] **Step 3: Graph + commit**

Run: `graphify update .` (keeps the knowledge graph current, AST-only).

```bash
git add scripts/seed.ts graphify-out
git commit -m "chore: scheduling — seed demo booking; graph update"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin scheduling-s2
gh pr create --title "feat: scheduling — slice S2 (booking lifecycle: cancel/reschedule, reminders, RPC hardening)" --body "$(cat <<'EOF'
## Summary
- Client cancel/reschedule from the tokenized manage page (`cancel_booking`/`reschedule_booking` definer RPCs; reschedule = new linked row + old → `rescheduled`, atomic, EXCLUDE-guarded)
- Admin Bookings page (upcoming/past) with cancel (column-scoped status seam from 0026) and reschedule (`reschedule_booking_admin`)
- Reminder emails ~24h before start via `/api/scheduling/drain` (chasing claim/rollback idiom, link-free by design — raw tokens are never stored)
- `create_booking` hardened per the S1 residual: per-org 30/min throttle + availability containment in the RPC
- S1 deferrals folded in: action-layer e2e test; `handle` can be cleared (empty → null)

## Plan
docs/superpowers/plans/2026-08-14-scheduling-booking-lifecycle.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (checked against the spec)

- Spec "Manage page `/booking/[token]`: cancel … or reschedule (same slot picker; new booking created, old one set to `rescheduled` atomically)" → Tasks 2, 7, 9. Cancel "emails both parties" → Task 7 (client + provider notice).
- Spec "Reminder ~24h before start via drain cron, recorded idempotently (idempotency-key pattern as in chasing)" → Tasks 10–11 (claim + rollback + stable key `booking/<id>/reminder`).
- Spec "admin cancel/reschedule + bookings list" → Tasks 12–13.
- Spec security residual "S2 hardens the RPC (per-org throttle / availability check)" → Task 2 (both), tested in Task 3.
- Spec error handling: 23P01 → friendly retry state (Tasks 7, 12); expired/invalid token → uniform miss (Task 2 RPCs); email failure never breaks the mutation (all senders best-effort).
- S1 deferral queue: e2e (Task 8), handle:null (Task 5), RPC hardening (Task 2) — done; client-rename stays parked for S5, a11y pair for S3.
- Type-consistency: `bookingLifecycleKey` kinds match every call site; `loadOrgSlotContext` signature identical in Tasks 4/7/12; `AdminBooking` fields match `bookings-list.tsx`/`booking-reschedule-dialog.tsx` usage; resolver v2 columns match the Task 4 TS mapping and the Task 3 assertions.

## Execution deviations (post-review fixes — the code is authoritative)

Recorded during subagent-driven execution; each landed via its task's review loop.

1. **Task 2 (user ruling):** the per-org throttle counts `created_at` regardless of status, exactly as written here. Review flagged that a create→cancel loop (~30 anon req/min) can hold one org's booking page at the ceiling; the user ruled the plan governs (the alternative un-throttles cancelled-row spam). Accepted residual — revisit pre-production.
2. **Task 8 (plan defect, corrected above):** the e2e originally asserted the manage picker hides the booking's own slot, contradicting decision #11; the assertion is now `toContain(first)`. The committed test also randomizes `CLIENT_EMAIL` per run and org-scopes both final DB assertions (re-runnability after aborted runs) — the code block above predates that fix.
3. **Task 10:** `runReminderDrain` was hardened beyond the block above: the rollback UPDATE's error is checked and logged (row-stays-claimed visibility), and the outer per-row catch does a guarded best-effort `reminder_attempts` bump so a persistently-throwing row trips `REMINDER_MAX_ATTEMPTS` instead of starving the batch.
4. **Task 9/13 (UI):** `router.push` replaces `window.location.assign` (Next lint rule; provably fresh fetch for a dynamic route); `DialogTrigger` uses base-ui's `render={<Button/>}` — this repo's dialog wrapper has no `asChild`; `command-menu.tsx` needed no edit — its Navigate group derives from `NAV_ITEMS`.
5. **Task 5/6:** test-only import trims and one added test (`providerRescheduledEmail`) beyond the blocks above.
6. **Task 14:** the push/PR step ran after the whole-branch review, not inside the task; the manual smoke became an HTTP smoke (booking page, manage page, /bookings auth redirect, drain fail-closed).
