# H2 — Hourly Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `range_mode='hours'` rental offerings booked on an increment grid via the existing appointments slot engine — public flow, manage-page reschedule, admin walk-ins + moves, week-calendar rendering, offering-level opening hours.

**Architecture:** New offering columns (0055) + custom security migration (0056: CHECKs, availability owner XOR, EXCLUDE twins, 5 definer RPCs). The `slots.ts` engine gains one additive `stepMin` field; everything else is mapping. Availability editor + time-grid picker are generalized (owner seam) and shared between staff and offerings.

**Tech Stack:** Next.js (App Router; **read `node_modules/next/dist/docs/` before writing Next-specific code** — this Next version has breaking changes), Drizzle migrations, Supabase (local stack, ports +30, e.g. API 54351), Zod, Vitest (+ `npm run test:integration` — serial files), plpgsql definer RPCs.

**Spec:** `docs/superpowers/specs/2026-08-24-h2-hourly-mode-design.md` (parent: `2026-08-24-resource-booking-pivot-vision-and-roadmap-design.md`)

**Branch:** `feat/h2-hourly` off `docs/h2-hourly-spec` (spec travels with the branch; PR against `main`).

## Global Constraints

- Migrations: **0055** = generated (`npm run db:generate`), **0056** = custom SQL (`npx drizzle-kit generate --custom --name=hourly_security`). Never renumber; 0054 is the latest on main.
- Every new table/column write path needs explicit GRANTs checked (supabase-grants convention). `availability_rules`/`_exceptions` already have table-level `insert`+`delete` for authenticated (0026) and column-scoped `update (start_time, end_time)` (0035) — the new `rental_offering_id` column needs **no new grant** for insert, but 0056 must add RLS-compatible triggers.
- Public booking RPCs are **service_role-only** (0052 posture); admin RPCs granted to `authenticated`, gated by `org_id in (select public.user_orgs())`. Uniform `raise exception 'not found'` for anything enumerable; distinct sentinels only where the UI says something different (`taken`, `started`, `too_many`).
- Channel gating in app code goes through `effectiveMode(flags, mode)` (`src/features/orgs/mode.ts`) and the loaders' existing gates — never hand-write `flags.rentals && offersRentals`.
- `getBusyIntervals` (staff) keeps excluding rentals — a booked room never blocks a person's calendar (R1 ruling).
- Integration test files run serially (`fileParallelism: false` is already configured); they need the local Supabase stack (`npm run db:reset` first if schema changed).
- TDD: write the failing test first wherever a pure function or RPC is involved. Commit after each green step. Conventional commits (`feat:`, `fix:`, `refactor:`, `test:`).
- Times in availability tables are org-local `"HH:MM"` text; weekday 0=Sunday (JS `getUTCDay`).
- `wallTimeToUtc` / `dateInZone` / `addDaysISO` from `src/features/scheduling/slots.ts` are the only date-math primitives — never hand-roll tz math.
- After the final task: `graphify update .`

---

### Task 1: Migration 0055 — Drizzle columns + Zod schemas

**Files:**
- Modify: `src/db/schema/rentals.ts` (rental_offerings columns)
- Modify: `src/db/schema/scheduling.ts` (availability owner column)
- Modify: `src/features/rentals/schema.ts` (RANGE_MODES + discriminated offering input)
- Create: `src/db/migrations/0055_*.sql` (generated — do not hand-edit)
- Test: `src/features/rentals/schema.test.ts` (extend)

**Interfaces:**
- Produces: `RANGE_MODES = ["nights","days","hours"]`; `offeringInput`/`updateOfferingInput` accepting an hours variant with `slotIncrementMin`, `minDurationMin`, `maxDurationMin`, `turnoverMin`, `minNoticeMin` and **no** `startTime`/`endTime`/`minStay`/`maxStay`/`turnoverDays`/`minNoticeDays`; Drizzle columns `slot_increment_min`, `min_duration_min`, `max_duration_min`, `turnover_min` (default 0 not null), `min_notice_min` (default 0 not null); `start_time`/`end_time` nullable; `availability_rules.rental_offering_id` + `availability_exceptions.rental_offering_id` (uuid, cascade, indexed).

- [ ] **Step 1: Write failing schema tests** — extend `src/features/rentals/schema.test.ts`:

```ts
describe("hours offering input", () => {
  const base = {
    name: "Rehearsal Room",
    rangeMode: "hours" as const,
    slotIncrementMin: 30,
    minDurationMin: 60,
    maxDurationMin: 240,
    turnoverMin: 15,
    minNoticeMin: 120,
    bookingWindowDays: 60,
    unitSelection: "auto" as const,
    active: true,
  };
  it("accepts a valid hours offering without start/end times", () => {
    expect(offeringInput.safeParse(base).success).toBe(true);
  });
  it("rejects a min duration that is not a multiple of the increment", () => {
    expect(offeringInput.safeParse({ ...base, minDurationMin: 45 }).success).toBe(false);
  });
  it("rejects max < min duration", () => {
    expect(offeringInput.safeParse({ ...base, maxDurationMin: 30 }).success).toBe(false);
  });
  it("still accepts a nights offering exactly as before", () => {
    expect(
      offeringInput.safeParse({
        name: "Cabin", rangeMode: "nights", startTime: "15:00", endTime: "11:00",
        minStay: 1, maxStay: null, turnoverDays: 1, minNoticeDays: 0,
        bookingWindowDays: 180, unitSelection: "auto", active: true,
      }).success,
    ).toBe(true);
  });
  it("rejects hours fields on a nights offering", () => {
    expect(
      offeringInput.safeParse({
        name: "Cabin", rangeMode: "nights", startTime: "15:00", endTime: "11:00",
        minStay: 1, maxStay: null, turnoverDays: 1, minNoticeDays: 0,
        bookingWindowDays: 180, unitSelection: "auto", active: true,
        slotIncrementMin: 30,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npm run test -- schema.test` — expect FAIL (hours not in enum).

- [ ] **Step 3: Rework `src/features/rentals/schema.ts`** into a discriminated union. Replace the current `offeringBase`/`offeringInput`/`updateOfferingInput` block with:

```ts
export const RANGE_MODES = ["nights", "days", "hours"] as const;
export const UNIT_SELECTIONS = ["auto", "client_picks"] as const;

const offeringCommon = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priceLabel: z.string().trim().max(100).optional(),
  bookingWindowDays: z.number().int().min(1).max(730).default(180),
  unitSelection: z.enum(UNIT_SELECTIONS).default("auto"),
  active: z.boolean().default(true),
});
const rangeFields = z.object({
  rangeMode: z.enum(["nights", "days"]),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  minStay: z.number().int().min(1).max(365).default(1),
  maxStay: z.number().int().min(1).max(365).nullable().default(null),
  turnoverDays: z.number().int().min(0).max(30).default(0),
  minNoticeDays: z.number().int().min(0).max(365).default(0),
});
const hoursFields = z.object({
  rangeMode: z.literal("hours"),
  slotIncrementMin: z.number().int().min(5).max(240),
  minDurationMin: z.number().int().min(5).max(1440),
  maxDurationMin: z.number().int().min(5).max(1440),
  turnoverMin: z.number().int().min(0).max(1440).default(0),
  minNoticeMin: z.number().int().min(0).max(43200).default(0),
});
const stayOrder = (o: { minStay: number; maxStay: number | null }) =>
  o.maxStay === null || o.maxStay >= o.minStay;
export const HOURS_GRID_MSG = "durations must be multiples of the increment, max ≥ min";
const hoursGrid = (o: z.infer<typeof hoursFields>) =>
  o.maxDurationMin >= o.minDurationMin &&
  o.minDurationMin % o.slotIncrementMin === 0 &&
  o.maxDurationMin % o.slotIncrementMin === 0;

// `strict()` on each branch so hours fields on a nights offering (and vice
// versa) are rejected rather than silently dropped.
const rangeOffering = offeringCommon.extend(rangeFields.shape).strict()
  .refine(stayOrder, { message: "max stay must be ≥ min stay" });
const hoursOffering = offeringCommon.extend(hoursFields.shape).strict()
  .refine(hoursGrid, { message: HOURS_GRID_MSG });
export const offeringInput = z.union([rangeOffering, hoursOffering]);
export const updateOfferingInput = z.union([
  offeringCommon.extend(rangeFields.shape).extend({ id: z.uuid() }).strict()
    .refine(stayOrder, { message: "max stay must be ≥ min stay" }),
  offeringCommon.extend(hoursFields.shape).extend({ id: z.uuid() }).strict()
    .refine(hoursGrid, { message: HOURS_GRID_MSG }),
]);
```

Check `src/features/rentals/actions.ts` `createOffering`/`updateOffering`: they insert parsed fields into the DB — extend the insert/update payload mapping with the new snake_case columns (`slot_increment_min` etc.), writing `null` for the fields the mode doesn't carry (`start_time: null` for hours; `slot_increment_min: null` for nights/days).

- [ ] **Step 4: Drizzle columns.** In `src/db/schema/rentals.ts` `rentalOfferings`: remove `.notNull()` from `startTime`/`endTime`, add:

```ts
    // Hours mode (H2). NULL for nights/days; the trio NOT NULL iff
    // range_mode='hours' (CHECK in 0056).
    slotIncrementMin: integer("slot_increment_min"),
    minDurationMin: integer("min_duration_min"),
    maxDurationMin: integer("max_duration_min"),
    // Minutes-granularity siblings of turnover_days/min_notice_days, used
    // only in hours mode (min_notice_min mirrors services.min_notice_min).
    turnoverMin: integer("turnover_min").default(0).notNull(),
    minNoticeMin: integer("min_notice_min").default(0).notNull(),
```

In `src/db/schema/scheduling.ts`, both `availabilityRules` and `availabilityExceptions` get (import `rentalOfferings` from `./rentals`):

```ts
    // H2: owner is staff XOR rental offering (CHECK in 0056; 0041's staff
    // NOT NULL is dropped there).
    rentalOfferingId: uuid("rental_offering_id").references(() => rentalOfferings.id, {
      onDelete: "cascade",
    }),
```

plus indexes `availability_rules_offering_weekday_idx` on `(rentalOfferingId, weekday)` and `availability_exceptions_offering_date_idx` on `(rentalOfferingId, date)`.

- [ ] **Step 5: Generate** — `npm run db:generate` → inspect `src/db/migrations/0055_*.sql`: expect ADD COLUMN ×7, ALTER `start_time`/`end_time` DROP NOT NULL, 2 FKs, 2 indexes, and nothing else.

- [ ] **Step 6: Run tests** — `npm run test -- schema.test` PASS; `npm run test` (whole unit suite) PASS (fix any `RangeMode` narrowing fallout: `src/features/rentals/range.ts` exports `RangeMode` — widen the type to the new union but keep `computeRangeAvailability`/`validateStay`/`stayLength` accepting only `"nights" | "days"`; add `export function isHourly(o: { rangeMode: RangeMode }): boolean { return o.rangeMode === "hours"; }` in `range.ts`).

- [ ] **Step 7: Commit** — `feat(db): 0055 hourly offering columns + availability owner column`

---

### Task 2: Migration 0056 part A — CHECKs, owner XOR, EXCLUDE twins, triggers (integration TDD)

**Files:**
- Create: `src/db/migrations/0056_hourly_security.sql` (via `npx drizzle-kit generate --custom --name=hourly_security`)
- Test: `src/features/rentals/hourly-guards.integration.test.ts` (new; copy the setup/teardown idiom from `guards.integration.test.ts`)

**Interfaces:**
- Produces (DB): `rental_offerings_range_mode` CHECK extended to `('nights','days','hours')`; `rental_offerings_hours_fields` CHECK; `rental_offerings_times_by_mode` CHECK; `availability_rules`/`_exceptions` owner XOR CHECK + `staff_id` NOT NULL dropped; offering-keyed EXCLUDE twins; `check_offering_owner_org()` trigger on both availability tables. Later tasks rely on all of these existing.

- [ ] **Step 1: Write failing integration tests** (admin client, direct table writes):

```ts
// hourly-guards.integration.test.ts — setup mirrors guards.integration.test.ts:
// create org + hours offering (+ a second org for the mismatch case) in
// beforeAll, delete in afterAll (try/finally).
it("accepts an hours offering with the duration trio", async () => {
  const { error } = await admin.from("rental_offerings").insert({
    org_id: orgId, name: "Room A", range_mode: "hours",
    slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
  });
  expect(error).toBeNull();
});
it("rejects an hours offering missing max_duration_min", async () => {
  const { error } = await admin.from("rental_offerings").insert({
    org_id: orgId, name: "Bad", range_mode: "hours",
    slot_increment_min: 30, min_duration_min: 60,
  });
  expect(error?.code).toBe("23514"); // check_violation
});
it("rejects an hours offering with start_time set", async () => {
  const { error } = await admin.from("rental_offerings").insert({
    org_id: orgId, name: "Bad", range_mode: "hours", start_time: "09:00",
    slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
  });
  expect(error?.code).toBe("23514");
});
it("rejects a nights offering without start/end times", async () => {
  const { error } = await admin.from("rental_offerings").insert({
    org_id: orgId, name: "Bad", range_mode: "nights",
  });
  expect(error?.code).toBe("23514");
});
it("accepts an offering-owned availability rule and rejects a two-owner row", async () => {
  const ok = await admin.from("availability_rules").insert({
    org_id: orgId, rental_offering_id: offeringId, weekday: 1,
    start_time: "09:00", end_time: "21:00",
  });
  expect(ok.error).toBeNull();
  const bad = await admin.from("availability_rules").insert({
    org_id: orgId, rental_offering_id: offeringId, staff_id: staffId, weekday: 2,
    start_time: "09:00", end_time: "21:00",
  });
  expect(bad.error?.code).toBe("23514");
});
it("rejects overlapping offering rules on the same weekday (EXCLUDE twin)", async () => {
  const { error } = await admin.from("availability_rules").insert({
    org_id: orgId, rental_offering_id: offeringId, weekday: 1,
    start_time: "10:00", end_time: "12:00",
  });
  expect(error?.code).toBe("23P01"); // exclusion_violation
});
it("rejects an availability rule whose offering belongs to another org", async () => {
  const { error } = await admin.from("availability_rules").insert({
    org_id: otherOrgId, rental_offering_id: offeringId, weekday: 3,
    start_time: "09:00", end_time: "10:00",
  });
  expect(error?.message).toMatch(/org mismatch/);
});
```

- [ ] **Step 2: Run** `npm run test:integration -- hourly-guards` — expect FAIL (23514 on the hours insert: range_mode CHECK).

- [ ] **Step 3: Write `0056_hourly_security.sql`** (first section):

```sql
-- 0056: hourly mode security surface (H2). Idiom: 0037/0038/0041.
-- Appended across plan Tasks 2 and 3 (0041 precedent).

-- ---------- rental_offerings: mode + per-mode field CHECKs
alter table public.rental_offerings drop constraint rental_offerings_range_mode;
alter table public.rental_offerings
  add constraint rental_offerings_range_mode check (range_mode in ('nights', 'days', 'hours'));

-- Duration trio present iff hours; multiples of the increment; max >= min.
alter table public.rental_offerings add constraint rental_offerings_hours_fields check (
  case when range_mode = 'hours' then
    slot_increment_min is not null and min_duration_min is not null and max_duration_min is not null
    and slot_increment_min between 5 and 240
    and min_duration_min between 5 and 1440
    and max_duration_min between min_duration_min and 1440
    and min_duration_min % slot_increment_min = 0
    and max_duration_min % slot_increment_min = 0
    and turnover_min between 0 and 1440
    and min_notice_min between 0 and 43200
  else
    slot_increment_min is null and min_duration_min is null and max_duration_min is null
  end
);

-- Check-in/out times belong to nights/days only; hours reads opening hours
-- from availability_rules. (0037's *_fmt CHECKs allow NULL already — verify:
-- they are `check (start_time ~ ...)`, which is NULL-passing in SQL.)
alter table public.rental_offerings add constraint rental_offerings_times_by_mode check (
  (range_mode = 'hours') = (start_time is null and end_time is null)
);

-- ---------- availability owner: staff XOR rental offering (bookings_kind idiom)
alter table public.availability_rules alter column staff_id drop not null;
alter table public.availability_exceptions alter column staff_id drop not null;
alter table public.availability_rules add constraint availability_rules_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));
alter table public.availability_exceptions add constraint availability_exceptions_owner
  check ((staff_id is not null) <> (rental_offering_id is not null));

-- ---------- EXCLUDE twins: the 0041 staff-keyed guards never fire when
-- staff_id is NULL, so offering rows need their own (same hm_to_min shape).
alter table public.availability_rules add constraint availability_rules_offering_no_overlap
  exclude using gist (rental_offering_id with =, weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (rental_offering_id is not null);
alter table public.availability_exceptions add constraint availability_exceptions_offering_no_overlap
  exclude using gist (rental_offering_id with =, date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&)
  where (not closed and rental_offering_id is not null);

-- ---------- org-consistency trigger (check_staff_owner_org idiom)
create or replace function public.check_offering_owner_org()
returns trigger language plpgsql set search_path = '' as $$
declare v_org uuid;
begin
  if new.rental_offering_id is null then return new; end if;
  select org_id into v_org from public.rental_offerings where id = new.rental_offering_id;
  if v_org is null then raise exception 'offering not found'; end if;
  if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  return new;
end; $$;
create trigger availability_rules_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_rules
  for each row execute function public.check_offering_owner_org();
create trigger availability_exceptions_offering_guard
  before insert or update of org_id, rental_offering_id on public.availability_exceptions
  for each row execute function public.check_offering_owner_org();
```

Before committing, verify the 0037 time-format CHECKs really are NULL-passing: `grep -n "start_time_fmt" src/db/migrations/0037_rentals_security.sql` — `start_time ~ '...'` evaluates to NULL for NULL input, which CHECK accepts. If any CHECK there uses `is not null and`, adjust this migration accordingly.

- [ ] **Step 4: Apply + test** — `npm run db:migrate`, then `npm run test:integration -- hourly-guards` PASS. Also run the existing `guards.integration.test.ts` + `rls.integration.test.ts` + `scheduling` integration files — the staff-keyed guards and RLS must be unaffected.

- [ ] **Step 5: Commit** — `feat(db): 0056 hourly CHECKs, availability owner XOR, EXCLUDE twins`

---

### Task 3: Migration 0056 part B — helpers + the five hourly RPCs (integration TDD)

**Files:**
- Modify: `src/db/migrations/0056_hourly_security.sql` (append)
- Test: `src/features/rentals/hourly-rpc.integration.test.ts` (new; setup idiom from `r2-rpc.integration.test.ts`)

**Interfaces:**
- Produces (DB, all `security definer set search_path = ''`):
  - `slot_within_offering_availability(p_offering_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz) returns boolean` — internal, revoked from all.
  - `rental_unit_is_free_hours(p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz, p_turnover_min int, p_exclude_booking_id uuid) returns boolean` — internal.
  - `create_rental_booking_hours(p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz, p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text) returns uuid` — **service_role only**.
  - `create_rental_booking_hours_admin(p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz, p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text) returns uuid` — authenticated.
  - `reschedule_rental_hours_apply(p_old_id uuid, p_unit_id uuid, p_starts_at timestamptz, p_new_token_hash text, p_enforce_limits boolean) returns table (…same 13 columns as reschedule_rental_apply…)` — internal.
  - `reschedule_rental_booking_hours(p_token text, p_unit_id uuid, p_starts_at timestamptz, p_new_token_hash text) returns table (…)` — **service_role only**.
  - `reschedule_rental_booking_hours_admin(p_booking_id uuid, p_unit_id uuid, p_starts_at timestamptz, p_new_token_hash text) returns table (…)` — authenticated.

- [ ] **Step 1: Write failing integration tests.** Fixture in `beforeAll`: org (handle, timezone `Europe/Warsaw`, `offers_rentals=true`), hours offering (increment 30, min 60, max 240, turnover 30, notice 0, window 60), two units A/B (sort_order 0/1), offering rules Mon–Sun `09:00–21:00`. Helper `t(dateHour: string)` building timestamptz. Tests (call RPCs via admin client for the service_role ones, via an authenticated member client for `_admin`):

```ts
it("books a free 2h slot and auto-picks unit A", async () => {
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: null,
    p_starts_at: iso("2026-09-07T10:00"), p_duration_min: 120,
    p_name: "Kasia", p_email: "kasia@example.com", p_note: null, p_token_hash: hash(),
  });
  expect(error).toBeNull();
  const row = await bookingRow(data as string);
  expect(row.rental_unit_id).toBe(unitAId);
  expect(new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()).toBe(120 * 60_000);
});
it("rejects a duration off the grid / below min / above max", async () => {
  for (const dur of [45, 30, 270]) {
    const { error } = await createHours({ startsAt: iso("2026-09-07T14:00"), durationMin: dur });
    expect(error?.message).toMatch(/not found/);
  }
});
it("rejects a slot outside the offering's opening hours", async () => {
  const { error } = await createHours({ startsAt: iso("2026-09-07T20:30"), durationMin: 60 });
  expect(error?.message).toMatch(/not found/); // ends 21:30 > 21:00
});
it("turnover blocks a back-to-back slot but not one past the gap", async () => {
  await createHours({ startsAt: iso("2026-09-08T10:00"), durationMin: 60, unitId: unitAId });
  const tight = await createHours({ startsAt: iso("2026-09-08T11:00"), durationMin: 60, unitId: unitAId });
  expect(tight.error?.message).toMatch(/taken/);
  const ok = await createHours({ startsAt: iso("2026-09-08T11:30"), durationMin: 60, unitId: unitAId });
  expect(ok.error).toBeNull();
});
it("auto-pick falls over to unit B when A is taken", async () => { /* book A, book same slot auto → row lands on B */ });
it("a physically overlapping insert loses to the EXCLUDE guard", async () => {
  // Bypass the RPC: direct insert of an overlapping confirmed row on the same
  // unit must raise 23P01 (bookings_rental_unit_no_overlap, 0037).
});
it("blackout on the org-local day blocks the slot", async () => { /* insert blackout for 2026-09-09 on unit A; explicit-unit create at 10:00 → taken */ });
it("admin variant ignores min_notice/window but not occupancy", async () => { /* set min_notice_min=1440; anon-path create for +2h fails 'not found'; admin create succeeds; admin create over an existing booking fails 'taken' */ });
it("hours reschedule frees the old row, keeps duration, rotates the token", async () => {
  // create at 10:00; reschedule_rental_booking_hours_admin to 15:00 with a new
  // hash → old row status 'rescheduled', new row 15:00–17:00, new row's
  // cancel_token_hash = the new hash, rescheduled_from_id = old id.
});
it("client reschedule via token enforces limits; a started booking raises 'started'", async () => { /* … */ });
it("create on a rentals-off org raises 'not found'", async () => { /* org with offers_rentals=false */ });
```

- [ ] **Step 2: Run** `npm run test:integration -- hourly-rpc` — expect FAIL (function does not exist).

- [ ] **Step 3: Append to `0056_hourly_security.sql`.** Complete bodies (mirroring 0054's `create_rental_booking` + 0041's `slot_within_availability`; validation order copied so error precedence matches the R2 tests):

```sql
-- ---------- slot_within_offering_availability: 0041's slot_within_availability
-- with the owner swapped to rental_offering_id. Same one-org-local-day rule.
create function public.slot_within_offering_availability(
  p_offering_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz
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
  if exists (select 1 from public.availability_exceptions ae
             where ae.rental_offering_id = p_offering_id and ae.date = v_date) then
    return exists (
      select 1 from public.availability_exceptions ae
      where ae.rental_offering_id = p_offering_id and ae.date = v_date and not ae.closed
        and ae.start_time <= v_start_hm and ae.end_time >= v_end_hm);
  end if;
  return exists (
    select 1 from public.availability_rules ar
    where ar.rental_offering_id = p_offering_id and ar.weekday = v_weekday
      and ar.start_time <= v_start_hm and ar.end_time >= v_end_hm);
end; $$;
revoke all on function public.slot_within_offering_availability(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------- rental_unit_is_free_hours: tstzrange sibling of
-- rental_unit_is_free. Both sides share the offering's turnover, so a single
-- range extended by the turnover on each side's END is exactly the engine's
-- two-sided check (bufferBefore is always 0 for hourly).
create function public.rental_unit_is_free_hours(
  p_unit_id uuid, p_timezone text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_turnover_min int, p_exclude_booking_id uuid
) returns boolean language sql stable set search_path = '' as $$
  select not exists (
      select 1 from public.rental_unit_blackouts bl
      where bl.rental_unit_id = p_unit_id
        and daterange(bl.start_date, bl.end_date, '[]')
            && daterange((p_starts_at at time zone p_timezone)::date,
                         (p_ends_at   at time zone p_timezone)::date, '[]'))
    and not exists (
      select 1 from public.bookings b
      where b.rental_unit_id = p_unit_id
        and b.status = 'confirmed'
        and (p_exclude_booking_id is null or b.id <> p_exclude_booking_id)
        and tstzrange(b.starts_at, b.ends_at + make_interval(mins => p_turnover_min))
            && tstzrange(p_starts_at, p_ends_at + make_interval(mins => p_turnover_min)));
$$;
revoke all on function public.rental_unit_is_free_hours(uuid, text, timestamptz, timestamptz, int, uuid)
  from public, anon, authenticated, service_role;

-- ---------- shared hourly validation is inlined in each RPC (plpgsql has no
-- cheap record-passing; the R2 create/admin pair does the same).

create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
begin
  select o.id, o.timezone, o.offers_rentals into v_org
    from public.orgs o where o.handle = p_handle;
  if v_org.id is null or not v_org.offers_rentals then raise exception 'not found'; end if;
  select * into v_off from public.rental_offerings ro
    where ro.id = p_offering_id and ro.org_id = v_org.id and ro.active and ro.range_mode = 'hours';
  if v_off.id is null then raise exception 'not found'; end if;

  if p_name is null or length(btrim(p_name)) not between 1 and 200 then raise exception 'not found'; end if;
  if p_email is null or length(p_email) > 320 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'not found'; end if;
  if p_note is not null and length(p_note) > 2000 then raise exception 'not found'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'not found'; end if;

  if p_starts_at is null or p_duration_min is null then raise exception 'not found'; end if;
  if p_duration_min < v_off.min_duration_min or p_duration_min > v_off.max_duration_min
     or p_duration_min % v_off.slot_increment_min <> 0 then raise exception 'not found'; end if;
  v_ends := p_starts_at + make_interval(mins => p_duration_min);
  if p_starts_at <= now() + make_interval(mins => v_off.min_notice_min) then raise exception 'not found'; end if;
  if p_starts_at > now() + make_interval(days => v_off.booking_window_days + 1) then raise exception 'not found'; end if;
  if not public.slot_within_offering_availability(v_off.id, v_org.timezone, p_starts_at, v_ends) then
    raise exception 'not found';
  end if;

  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and b.created_at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'not found'; end if;
  -- Per-email hourly cap (0052 idiom — the rentals date RPCs predate it;
  -- hourly starts hardened).
  select count(*) into v_recent from public.bookings b
    where b.org_id = v_org.id and lower(b.client_email) = lower(p_email)
      and b.created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'too_many'; end if;

  perform pg_advisory_xact_lock(hashtext('rental_offering:' || v_off.id::text));

  select u.id into v_unit
    from public.rental_units u
    where u.offering_id = v_off.id and u.active
      and (p_unit_id is null or u.id = p_unit_id)
      and public.rental_unit_is_free_hours(u.id, v_org.timezone, p_starts_at, v_ends,
                                           v_off.turnover_min, null)
    order by u.sort_order, u.created_at
    limit 1;
  if v_unit is null then raise exception 'taken'; end if;

  insert into public.clients (org_id, name, email)
  values (v_org.id, btrim(p_name), lower(p_email))
  on conflict (org_id, lower(email)) where email is not null
  do update set name = clients.name
  returning id into v_client_id;

  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text) to service_role;
```

`create_rental_booking_hours_admin`: same body with the R2 admin deltas — resolve the offering via `ro.org_id in (select public.user_orgs())` (join orgs for timezone, `and ro.range_mode = 'hours'`, active NOT required is wrong: keep `ro.active` requirement off? **Keep the R2 semantics**: `create_rental_booking_admin` requires `ro.active` — mirror it); email optional (`if p_email is not null and (…bad…) then raise`); skip the min-notice/window checks and both throttles; keep `p_starts_at <= now()` rejection, duration-grid check, containment check, advisory lock, freeness, client upsert only when email present. Grant to `authenticated`.

`reschedule_rental_hours_apply`: mirror `reschedule_rental_apply` exactly (same 13 return columns, `for update` lock, `'started'` raise for `starts_at <= now()`, old row → `rescheduled` BEFORE the unit pick, auto prefers old unit via `order by (u.id = v_old.rental_unit_id) desc, u.sort_order, u.created_at`) with these deltas: no dates — **duration is copied from the old row** (`v_duration := extract(epoch from (v_old.ends_at - v_old.starts_at))::int / 60`), `v_ends := p_starts_at + make_interval(mins => v_duration)`; require `v_off.range_mode = 'hours'`; when `p_enforce_limits`: `p_starts_at > now() + make_interval(mins => v_off.min_notice_min)` and `p_starts_at <= now() + make_interval(days => v_off.booking_window_days + 1)`; always require `slot_within_offering_availability` and `rental_unit_is_free_hours(…, v_old.id)`; `service_name` in the return row is `v_off.name || ' · ' || u.name`. Revoked from all.

`reschedule_rental_booking_hours` (token wrapper): copy `reschedule_rental_booking` verbatim, changing only the delegate call (no dates, `p_starts_at`) and adding `and b.rental_unit_id is not null` (already there) — the apply core's own `range_mode='hours'` check rejects date-mode bookings. Grant **service_role** (not anon — 0052 posture; the app action is the entry).

`reschedule_rental_booking_hours_admin`: copy `reschedule_rental_booking_admin` with the same delegate change; grant `authenticated`.

- [ ] **Step 4: Apply + test** — `npm run db:migrate`; `npm run test:integration -- hourly-rpc` PASS; run the full `npm run test:integration` (serial) — R2 suites must stay green.

- [ ] **Step 5: Commit** — `feat(db): 0056 hourly helpers + create/reschedule RPCs`

---

### Task 4: Engine `stepMin` + hourly pure lib + loaders

**Files:**
- Modify: `src/features/scheduling/slots.ts` (additive `stepMin`)
- Create: `src/features/rentals/hourly.ts` (pure helpers)
- Modify: `src/lib/booking/public.ts` (PublicOffering fields + `getOfferingAvailability` + `loadOrgHourlyContext`)
- Test: `src/features/scheduling/slots.test.ts` (extend), `src/features/rentals/hourly.test.ts` (new)

**Interfaces:**
- Consumes: `SlotInput`/`computeSlots`/`unionSlots` (slots.ts), `PublicOffering`/`PublicUnit` (public.ts), 0055 columns.
- Produces:
  - `SlotService.stepMin?: number` — candidate starts advance by `stepMin` instead of the block length.
  - `hourly.ts`: `durationOptions(o): number[]`; `hourlySlotService(o, durationMin): SlotService`; `blackoutBusy(blackouts: {unitId,startDate,endDate}[], timeZone): Map<string, BusyInterval[]>`; `unionUnitSlots(perUnit: {unitId: string; slots: Date[]}[]): {startsAt: Date; unitIds: string[]}[]`; `formatDurationLabel(min): string`.
  - `public.ts`: `PublicOffering` gains `slotIncrementMin/minDurationMin/maxDurationMin: number | null`, `turnoverMin: number`, `minNoticeMin: number`, `startTime/endTime: string | null`; `getOfferingAvailability(offeringId)` (rules+exceptions by `rental_offering_id`); `loadOrgHourlyContext(orgId, offeringId, fromDate, days, opts?: { excludeBookingId?: string; unitId?: string; includeInactiveUnits?: boolean }): Promise<{ offering; units; rules; exceptions; perUnit: { unitId: string; busy: BusyInterval[] }[] } | null>` — null when the offering is missing/inactive/not hours.

- [ ] **Step 1: Failing engine test** (slots.test.ts):

```ts
it("stepMin overrides block stepping: 120min sessions every 30min", () => {
  const slots = computeSlots({
    service: { durationMin: 120, bufferBeforeMin: 0, bufferAfterMin: 0,
               minNoticeMin: 0, maxPerDay: null, bookingWindowDays: 30, stepMin: 30 },
    rules: [{ weekday: 1, startTime: "09:00", endTime: "13:00" }],
    exceptions: [], busy: [], timeZone: "Europe/Warsaw",
    now: new Date("2026-08-31T00:00:00Z"), fromDate: "2026-08-31", days: 1,
  });
  // starts 09:00, 09:30, 10:00, 10:30, 11:00 (11:00+2h = 13:00 fits; 11:30 doesn't)
  expect(slots).toHaveLength(5);
});
it("without stepMin behaviour is unchanged (block stepping)", () => { /* same input minus stepMin → 2 slots (09:00, 11:00) */ });
```

- [ ] **Step 2: Run** — FAIL (5 ≠ 2).

- [ ] **Step 3: Implement** in `computeSlots` (two lines):

```ts
  const blockMs =
    (service.bufferBeforeMin + service.durationMin + service.bufferAfterMin) * MIN;
  // Hourly mode: candidate starts advance on the offering's increment grid
  // rather than by the whole block (a 2h session can start every 30 min).
  const stepMs = (service.stepMin ?? 0) * MIN || blockMs;
```

and `t += stepMs` in the loop (the `t + blockMs <= winEnd` fit check stays). Add `stepMin?: number;` to `SlotService`.

- [ ] **Step 4: Failing hourly.ts tests**, then implement:

```ts
// hourly.ts
import { wallTimeToUtc, addDaysISO, unionSlots, type SlotService, type BusyInterval } from "@/features/scheduling/slots";
import type { PublicOffering } from "@/lib/booking/public";

export type HourlyOffering = PublicOffering & {
  slotIncrementMin: number; minDurationMin: number; maxDurationMin: number;
};
export function isHourlyOffering(o: PublicOffering): o is HourlyOffering {
  return o.rangeMode === "hours" && o.slotIncrementMin !== null
    && o.minDurationMin !== null && o.maxDurationMin !== null;
}
export function durationOptions(o: HourlyOffering): number[] {
  const out: number[] = [];
  for (let d = o.minDurationMin; d <= o.maxDurationMin; d += o.slotIncrementMin) out.push(d);
  return out;
}
export function hourlySlotService(o: HourlyOffering, durationMin: number): SlotService {
  return {
    id: o.id, durationMin, bufferBeforeMin: 0, bufferAfterMin: o.turnoverMin,
    minNoticeMin: o.minNoticeMin, maxPerDay: null,
    bookingWindowDays: o.bookingWindowDays, stepMin: o.slotIncrementMin,
  };
}
// A date-range blackout occupies its org-local days wholesale.
export function blackoutBusy(
  blackouts: { unitId: string; startDate: string; endDate: string }[],
  timeZone: string,
): Map<string, BusyInterval[]> {
  const map = new Map<string, BusyInterval[]>();
  for (const b of blackouts) {
    const startsAt = wallTimeToUtc(b.startDate, "00:00", timeZone);
    const endsAt = wallTimeToUtc(addDaysISO(b.endDate, 1), "00:00", timeZone);
    (map.get(b.unitId) ?? map.set(b.unitId, []).get(b.unitId)!).push({ startsAt, endsAt });
  }
  return map;
}
export function unionUnitSlots(
  perUnit: { unitId: string; slots: Date[] }[],
): { startsAt: Date; unitIds: string[] }[] {
  // unionSlots (slots.ts) is keyed on `staffId`; the shape is identical.
  return unionSlots(perUnit.map((u) => ({ staffId: u.unitId, slots: u.slots })))
    .map((s) => ({ startsAt: s.startsAt, unitIds: s.staffIds }));
}
export function formatDurationLabel(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
```

Tests: `durationOptions` (60..240 by 30 → 7 options), `blackoutBusy` (whole-day span in Warsaw, DST day included), `unionUnitSlots` (two units sharing a start → one entry with both ids), `formatDurationLabel` (90 → "1 h 30 min").

- [ ] **Step 5: Loaders in `public.ts`.** Extend `PUBLIC_OFFERING_COLUMNS` (+ `slot_increment_min, min_duration_min, max_duration_min, turnover_min, min_notice_min`), `PublicOfferingDb`, `toPublicOffering`, and the `PublicOffering` type (`startTime: string | null; endTime: string | null;` — fix nights/days call-site narrowing with non-null assertions ONLY where the offering is known range-mode, e.g. `rentals/public-actions.ts` uses `ctx.offering.startTime` → keep compiling via `offering.startTime!` with a one-line comment). Then:

```ts
export async function getOfferingAvailability(
  offeringId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  // Twin of getAvailability(staffId) with the owner column swapped.
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin.from("availability_rules").select("weekday, start_time, end_time")
      .eq("rental_offering_id", offeringId),
    admin.from("availability_exceptions").select("date, closed, start_time, end_time")
      .eq("rental_offering_id", offeringId),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return { rules: (rulesRes.data ?? []).map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })),
           exceptions: (exceptionsRes.data ?? []).map((e) => ({ date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time })) };
}

// `timeZone` is passed in rather than re-queried — every caller already
// holds the org record (getBookingOrg / currentOrg).
export async function loadOrgHourlyContext(
  orgId: string, offeringId: string, timeZone: string, fromDate: string, days: number,
  opts?: { excludeBookingId?: string; unitId?: string; includeInactiveUnits?: boolean },
) {
  const offering = await getPublicOfferingById(orgId, offeringId);
  if (!offering || offering.rangeMode !== "hours") return null;
  const admin = createAdminClient();
  let unitsQuery = admin.from("rental_units")
    .select("id, name, description, sort_order, active")
    .eq("offering_id", offeringId).eq("org_id", orgId);
  if (!opts?.includeInactiveUnits) unitsQuery = unitsQuery.eq("active", true);
  const { data: unitRows, error: unitsError } = await unitsQuery.order("sort_order").order("created_at");
  if (unitsError) throw unitsError;
  const units = (unitRows ?? [])
    .filter((u) => (opts?.unitId ? u.id === opts.unitId : true))
    .map((u) => ({ id: u.id, name: u.name, description: u.description, active: u.active }));
  const [{ rules, exceptions }] = await Promise.all([getOfferingAvailability(offeringId)]);
  // Window padded a day each side (viewer/org offset) — getBusyIntervals idiom.
  const fromIso = `${addDaysISO(fromDate, -1)}T00:00:00Z`;
  const toIso = `${addDaysISO(fromDate, days + 1)}T23:59:59Z`;
  const unitIds = units.map((u) => u.id);
  const [bookingRes, blackoutRes] = await Promise.all([
    unitIds.length
      ? admin.from("bookings").select("id, rental_unit_id, starts_at, ends_at")
          .in("rental_unit_id", unitIds).eq("status", "confirmed")
          .gte("ends_at", fromIso).lte("starts_at", toIso)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length
      ? admin.from("rental_unit_blackouts").select("rental_unit_id, start_date, end_date")
          .in("rental_unit_id", unitIds)
          .gte("end_date", addDaysISO(fromDate, -1)).lte("start_date", addDaysISO(fromDate, days + 1))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (bookingRes.error) throw bookingRes.error;
  if (blackoutRes.error) throw blackoutRes.error;
  const blackoutMap = blackoutBusy(
    (blackoutRes.data ?? []).map((b) => ({ unitId: b.rental_unit_id, startDate: b.start_date, endDate: b.end_date })),
    timeZone,
  );
  const perUnit = units.map((u) => ({
    unitId: u.id,
    busy: [
      ...(bookingRes.data ?? [])
        .filter((b) => b.rental_unit_id === u.id && b.id !== opts?.excludeBookingId)
        .map((b) => ({ startsAt: new Date(b.starts_at), endsAt: new Date(b.ends_at),
                       bufferAfterMin: offering.turnoverMin })),
      ...(blackoutMap.get(u.id) ?? []),
    ],
  }));
  return { offering, units, rules, exceptions, perUnit };
}
```

- [ ] **Step 6: Run** `npm run test` PASS (typecheck the nights/days `startTime` fallout: `npx tsc --noEmit`).

- [ ] **Step 7: Commit** — `feat(rentals): engine stepMin + hourly slot lib + hourly context loader`

---

### Task 5: Offering form — hours mode

**Files:**
- Modify: `src/features/rentals/components/offering-dialog.tsx`
- Modify: `src/features/rentals/queries.ts` (`OfferingRow` + select columns get the five new fields)
- Modify: `src/features/rentals/actions.ts` (payload mapping from Task 1 Step 3 if not already done)
- Modify: `src/app/(dashboard)/rentals/[id]/page.tsx` + `src/features/rentals/components/offerings-list.tsx` (badge/copy)
- Test: `src/features/rentals/schema.test.ts` already covers parsing; add `src/features/rentals/components/offering-dialog.test.tsx` only if a component test harness exists for dialogs — otherwise rely on the schema tests (check `src/features/scheduling/components/*.test.tsx` for precedent; if none, skip).

**Interfaces:**
- Consumes: `offeringInput`/`updateOfferingInput` union (Task 1).
- Produces: `OfferingRow` with `slotIncrementMin/minDurationMin/maxDurationMin/turnoverMin/minNoticeMin` and nullable `startTime/endTime` — Tasks 6/10 read it.

- [ ] **Step 1:** `OfferingRow` + queries select the new columns (follow the existing camelCase mapping in `rentals/queries.ts`).
- [ ] **Step 2:** `offering-dialog.tsx`: make `rangeMode` a controlled `React.useState(offering?.rangeMode ?? "nights")`; the `<select>` gains `<option value="hours">Hourly (booked by the hour)</option>` and `onChange`. Render per mode:
  - `hours`: replace the Stay section's time/stay/turnover-days fields with: `slotIncrementMin` (select: 15/30/60, default 30), `minDurationMin` + `maxDurationMin` (number inputs, `step`=increment, min 5 max 1440), `turnoverMin` (number, 0–1440, label "Turnover (minutes)"), and in the Booking section swap "Min notice (days)" for `minNoticeMin` with a select of common values (0, 60, 120, 1440 → "None / 1 h / 2 h / 1 day") plus free number input fallback — simplest: a plain number input labelled "Min notice (minutes)".
  - `nights`/`days`: unchanged fields.
  - `onSubmit` builds the payload per mode (only that mode's fields), keeping the shared fields.
- [ ] **Step 3:** `/rentals/[id]/page.tsx`: `const hourly = offering.rangeMode === "hours"` — badge "Hourly", subtitle line `` `${formatDurationLabel(offering.minDurationMin!)}–${formatDurationLabel(offering.maxDurationMin!)} · every ${offering.slotIncrementMin} min` `` instead of check-in/out. Same treatment for the list rows in `offerings-list.tsx` and the "/rentals" empty-state copy ("…book by night, day or hour…").
- [ ] **Step 4:** Manual check: `npm run dev`, create an hourly offering + a unit via the UI. `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(rentals): hours mode in the offering form + detail/list rendering`

---

### Task 6: Availability owner seam + opening-hours editor on the offering page

**Files:**
- Modify: `src/features/scheduling/schema.ts` (owner fields on availability inputs)
- Modify: `src/features/scheduling/actions.ts` (owner-aware writes; `replaceDayExceptions` scope)
- Modify: `src/features/scheduling/components/weekly-hours.tsx`, `date-overrides.tsx` (owner prop)
- Modify: `src/app/(dashboard)/availability/page.tsx` (call sites)
- Modify: `src/features/scheduling/queries.ts` (`getOfferingAvailabilityAdmin`)
- Modify: `src/app/(dashboard)/rentals/[id]/page.tsx` (mount editor for hours offerings)
- Test: `src/features/scheduling/schema.test.ts` (owner refine), `src/features/rentals/hourly-guards.integration.test.ts` (already proves DB accepts offering rows)

**Interfaces:**
- Produces: `type AvailabilityOwner = { staffId: string; rentalOfferingId?: undefined } | { rentalOfferingId: string; staffId?: undefined }` (exported from `scheduling/schema.ts`); every availability action input accepts `staffId` XOR `rentalOfferingId` (zod refine); `WeeklyHours({ owner, rules })`, `DateOverrides({ owner, timeZone, rules, exceptions })`; `getOfferingAvailabilityAdmin(offeringId)` in queries.ts (authenticated client, RLS-scoped).

- [ ] **Step 1: Failing schema test:** `availabilityRuleInput` accepts `{rentalOfferingId, weekday, startTime, endTime}`, rejects both ids, rejects neither.
- [ ] **Step 2: Zod:** in `scheduling/schema.ts` replace `staffId: z.uuid()` on the availability inputs (`availabilityRuleInput`, update/delete rule inputs, `copyDayHours` input, `setDateOverride`/`deleteDateOverride`/`reopenDay` inputs — enumerate by reading the file) with:

```ts
const ownerFields = { staffId: z.uuid().optional(), rentalOfferingId: z.uuid().optional() };
const oneOwner = (o: { staffId?: string; rentalOfferingId?: string }) =>
  (o.staffId !== undefined) !== (o.rentalOfferingId !== undefined);
// applied per input: .extend(ownerFields).refine(oneOwner, { message: "exactly one owner" })
```

Keep `blockTimeRange`/`unblockTimeRange` **staff-only** (calendar-only surface) unless they share a parsed shape — if they do, the owner refine is harmless there.

- [ ] **Step 3: Actions:** each availability action currently does `.eq("staff_id", parsed.data.staffId)` and writes `staff_id`. Generalize with a tiny helper in `actions.ts`:

```ts
type OwnerCols = { staff_id: string | null; rental_offering_id: string | null };
function ownerCols(o: { staffId?: string; rentalOfferingId?: string }): OwnerCols {
  return { staff_id: o.staffId ?? null, rental_offering_id: o.rentalOfferingId ?? null };
}
function ownerEq<T extends { eq: (c: string, v: string) => T }>(q: T, o: { staffId?: string; rentalOfferingId?: string }): T {
  return o.staffId ? q.eq("staff_id", o.staffId) : q.eq("rental_offering_id", o.rentalOfferingId!);
}
```

Writes spread `...ownerCols(parsed.data)`; filters use `ownerEq`. For the offering path, add the same defence-in-depth the staff path has: before writing, verify the offering belongs to the current org (`supabase.from("rental_offerings").select("id").eq("id", rentalOfferingId).eq("org_id", orgId).maybeSingle()` — RLS + the 0056 trigger already enforce it; this gives the friendly error). `replaceDayExceptions` scope becomes `{ orgId: string; owner: {...}; date: string }` with `ownerEq`/`ownerCols` applied to its four statements; `revalidatePath` targets: `/availability` for staff, `/rentals/[id]` for offerings (`revalidatePath(\`/rentals/${rentalOfferingId}\`)`).

- [ ] **Step 4: Components:** `WeeklyHours`/`DateOverrides` prop `staffId: string` → `owner: AvailabilityOwner`; every action payload changes `{ staffId, … }` → `{ ...owner, … }`. `/availability/page.tsx` call sites become `owner={{ staffId: current.id }}`.
- [ ] **Step 5: Queries:** add to `scheduling/queries.ts`:

```ts
// Authenticated-client twin of getAvailabilityAdmin, offering-owned rows.
export async function getOfferingAvailabilityAdmin(offeringId: string): Promise<{
  rules: RuleRow[]; exceptions: ExceptionRow[];
}> { /* same two selects as the staff version with .eq("rental_offering_id", offeringId) */ }
```

(Read `getAvailabilityAdmin` first and mirror its row mapping exactly.)

- [ ] **Step 6: Mount on `/rentals/[id]`** for hours offerings, under the UnitsEditor:

```tsx
{hourly ? (
  <div className="flex flex-col gap-4">
    <h2 className="text-sm font-medium">Opening hours</h2>
    <WeeklyHours owner={{ rentalOfferingId: offering.id }} rules={rules} />
    <DateOverrides owner={{ rentalOfferingId: offering.id }} timeZone={timezone}
                   rules={rules} exceptions={exceptions} />
  </div>
) : null}
```

(`timezone` from the org queries idiom used by `/availability/page.tsx` — read that page for the source.)

- [ ] **Step 7:** `npm run test` + `npx tsc --noEmit` clean; manual: set Mon–Sat 9–21 on the hourly offering, see rows appear; overlapping row rejected with the OVERLAP_ERROR toast.
- [ ] **Step 8: Commit** — `feat(scheduling): availability owner seam (staff XOR offering) + offering hours editor`

---

### Task 7: Extract `TimeSlotGrid` from the booking widget (pure refactor)

**Files:**
- Create: `src/features/scheduling/components/time-slot-grid.tsx`
- Modify: `src/features/scheduling/components/booking-widget.tsx`
- Test: existing widget/component tests must stay green (`npm run test`)

**Interfaces:**
- Produces:

```tsx
export function TimeSlotGrid({
  slots, fromDate, todayISO, pending, orgTimeZone, onNavigate, onPick, regionRef,
}: {
  slots: string[];              // ISO instants
  fromDate: string;             // viewer-local YYYY-MM-DD, 7-day page
  todayISO: string;
  pending: boolean;
  orgTimeZone: string;
  onNavigate: (nextFromDate: string) => void;
  onPick: (iso: string) => void;
  regionRef?: React.Ref<HTMLDivElement>;
}): React.JSX.Element
```

- [ ] **Step 1:** Move from `booking-widget.tsx` into the new file, byte-for-byte where possible: the `byDay` grouping block, DST duplicate `timeLabel` logic, the prev/next week `Button` pair, the `aria-live`/`aria-busy` slots region, the "Times shown in your timezone" + org-tz footnotes, and `shiftDays`. The widget keeps: header line (service name / with-label / change buttons) — pass it as `children` rendered above the nav row, OR keep the header in the widget and render `<TimeSlotGrid …/>` below it (choose the latter — smaller prop surface; the nav buttons move into the grid).
- [ ] **Step 2:** Widget renders `<TimeSlotGrid slots={slots} fromDate={fromDate} todayISO={todayISO()} pending={pending} orgTimeZone={orgTimeZone} onNavigate={setFromDate} onPick={setSlot} regionRef={slotsRegionRef} />`.
- [ ] **Step 3:** `npm run test` green; `npm run dev` visual check of the appointments flow (no behavior change, including the disabled back arrow on the first week).
- [ ] **Step 4: Commit** — `refactor(scheduling): extract TimeSlotGrid from booking-widget`

---

### Task 8: Public hourly flow — actions, HourlyBookingFlow, widget branch, emails

**Files:**
- Create: `src/features/rentals/hourly-actions.ts` ("use server")
- Create: `src/features/rentals/components/hourly-booking-flow.tsx`
- Modify: `src/features/rentals/schema.ts` (inputs), `src/features/scheduling/components/booking-widget.tsx` (branch + card copy), `src/features/scheduling/templates.ts` (`formatHourlyWhenLine`)
- Test: `src/features/rentals/hourly-flow.integration.test.ts` (new — action-level, `flow.integration.test.ts` idiom), `src/features/scheduling/templates.test.ts` (extend)

**Interfaces:**
- Consumes: `loadOrgHourlyContext`, `hourlySlotService`, `unionUnitSlots`, `durationOptions`, `computeSlots`, `TimeSlotGrid`, RPC `create_rental_booking_hours`, `getBookingOrg`, `getOrgFlagsAdmin`, `publicSlotsLimiter`/`publicBookingLimiter`, `generateAccessToken`, `bookingConfirmationEmail`, `providerNewBookingEmail`, `getProviderEmail`, `isRpcSentinel`.
- Produces:
  - `getHourlySlots(input): Promise<{ ok: true; slots: { startsAt: string; unitIds: string[] }[] } | { ok: false; error: string }>` — input `{ handle, offeringId, durationMin, fromDate, days ≤ 10, unitId? }`.
  - `createRentalBookingHours(input): Promise<{ ok: true; token: string } | { ok: false; error: string; slotTaken?: boolean }>` — input `{ handle, offeringId, unitId: string | null, startsAt: ISO, durationMin, name, email, note? }`.
  - `formatHourlyWhenLine(starts: Date, ends: Date, timeZone: string): string` → `"Mon, 07 Sep 2026, 10:00–12:00 (Europe/Warsaw)"` (mirror `formatWhenLine`'s formatting choices — read it first).
  - `SLOT_TAKEN_HOURLY = "That time was just taken — please pick another."` in `rentals/schema.ts`.

- [ ] **Step 1: Zod inputs** in `rentals/schema.ts`:

```ts
export const getHourlySlotsInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  offeringId: z.uuid(),
  durationMin: z.number().int().min(5).max(1440),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(10),
  unitId: z.uuid().nullable().default(null),
});
export const createRentalBookingHoursInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  offeringId: z.uuid(),
  unitId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  durationMin: z.number().int().min(5).max(1440),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  note: z.string().trim().max(2000).optional(),
});
export const SLOT_TAKEN_HOURLY = "That time was just taken — please pick another.";
```

- [ ] **Step 2: Failing integration test** (fixture like Task 3's, driven through the ACTIONS — this is the e2e-equivalent):

```ts
it("lists slots on the increment grid and books one", async () => {
  const slots = await getHourlySlots({ handle, offeringId, durationMin: 120, fromDate: monday, days: 7 });
  expect(slots.ok).toBe(true);
  if (!slots.ok) return;
  expect(slots.slots.some((s) => s.startsAt === iso(`${monday}T09:30`))).toBe(true); // grid, not block
  const created = await createRentalBookingHours({
    handle, offeringId, unitId: null, startsAt: slots.slots[0].startsAt, durationMin: 120,
    name: "Kasia", email: "kasia@example.com",
  });
  expect(created.ok).toBe(true);
});
it("mode-gates: rentals kill switch off → generic error, no slot disclosure", async () => { /* flip org_feature_flags rentals=false, expect ok:false on both actions, flip back in finally */ });
it("a stale slot returns slotTaken so the flow refetches", async () => { /* book a slot, book it again → ok:false, slotTaken:true */ });
```

- [ ] **Step 3: `hourly-actions.ts`.** Follow `rentals/public-actions.ts` file structure (limiter, loadContext helper, isTaken). Core:

```ts
async function loadHourlyContext(handle: string, offeringId: string, fromDate: string, days: number,
                                 opts?: { unitId?: string; excludeBookingId?: string }) {
  const org = await getBookingOrg(handle);
  if (!org) return null;
  if (!(await getOrgFlagsAdmin(org.orgId)).rentals) return null;  // kill switch
  if (!org.offersRentals) return null;                            // channel gate
  const ctx = await loadOrgHourlyContext(org.orgId, offeringId, org.timeZone, fromDate, days, opts);
  if (!ctx) return null;
  return { org, ...ctx };
}

function hourlySlotsFor(ctx: NonNullable<Awaited<ReturnType<typeof loadHourlyContext>>>,
                        durationMin: number, fromDate: string, days: number) {
  const service = hourlySlotService(ctx.offering as HourlyOffering, durationMin);
  const now = new Date();
  return unionUnitSlots(ctx.perUnit.map((u) => ({
    unitId: u.unitId,
    slots: computeSlots({ service, rules: ctx.rules, exceptions: ctx.exceptions,
                          busy: u.busy, timeZone: ctx.org.timeZone, now, fromDate, days }),
  })));
}

export async function getHourlySlots(input: unknown) {
  if (await limited("slots")) return { ok: false as const, error: TOO_MANY_REQUESTS };
  const parsed = getHourlySlotsInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: GENERIC_WRITE_ERROR };
  const { handle, offeringId, durationMin, fromDate, days, unitId } = parsed.data;
  try {
    // getSlots idiom: fromDate is viewer-local; pad the engine window a day
    // each side, the client keeps what lands on its page.
    const from = addDaysISO(fromDate, -1);
    const span = days + 2;
    const ctx = await loadHourlyContext(handle, offeringId, from, span, { unitId: unitId ?? undefined });
    if (!ctx || !isHourlyOffering(ctx.offering)) return { ok: false as const, error: GENERIC_WRITE_ERROR };
    if (!durationOptions(ctx.offering).includes(durationMin))
      return { ok: false as const, error: GENERIC_WRITE_ERROR };
    const slots = hourlySlotsFor(ctx, durationMin, from, span);
    return { ok: true as const, slots: slots.map((s) => ({ startsAt: s.startsAt.toISOString(), unitIds: s.unitIds })) };
  } catch (error) {
    console.error("[rentals] getHourlySlots:", error);
    return { ok: false as const, error: GENERIC_WRITE_ERROR };
  }
}
```

`createRentalBookingHours` mirrors `createBooking` (scheduling/public-actions.ts): limiter (`booking` bucket → `publicBookingLimiter`), re-run the engine for the org-local day of the requested instant, require an exact `startsAt` match (and, for `client_picks`, that `unitId` ∈ that slot's `unitIds`), then `admin.rpc("create_rental_booking_hours", {...})`; on `taken`/`23P01` with `unitId === null` retry once (R2 idiom), map `too_many` → `TOO_MANY_FOR_EMAIL` copy (import or duplicate the string from scheduling — move both to a shared constant if trivial), return `{ ok: false, error: SLOT_TAKEN_HOURLY, slotTaken: true }` on taken. After success: client confirmation email (`bookingConfirmationEmail` with `serviceName` = `` `${offering.name} · ${unitName}` `` via `getBookingUnitName`, `whenLine` = `formatHourlyWhenLine(starts, ends, tz)`) AND the provider copy — copy the `providerNewBookingEmail` + `getProviderEmail` block from `createBooking` (best-effort, reply-to wiring included). Nights/days rentals still lack the provider copy — leave them; note it in the PR description as a deferred minor.

- [ ] **Step 4: templates.** Add `formatHourlyWhenLine` (+ unit test): same date formatting as `formatWhenLine` but with an en-dash time range; read `formatWhenLine`/`formatRangeWhenLine` and reuse their `Intl.DateTimeFormat` construction.

- [ ] **Step 5: `HourlyBookingFlow`.** Same skeleton as `RentalBookingFlow` (header with change/back, error line at the bottom, `BookingConfirmed` terminal with `summary`):
  - State: `durationMin: number | null` (auto-set when `durationOptions` has length 1), `fromDate` (viewer-local `todayISO()` — copy from booking-widget), `slots: { startsAt: string; unitIds: string[] }[]`, `slot: string | null`, `unitId: string | null`, `doneToken`, `error`, `pending`.
  - Step 1 — duration: ≤ 8 options → pill row of `<Button variant="outline">` with `formatDurationLabel`; > 8 → native `<select>` (offering-dialog's `selectClass` idiom).
  - Step 2 — time: `<TimeSlotGrid slots={slots.map(s => s.startsAt)} …/>`; fetch via `getHourlySlots({ handle, offeringId: offering.id, durationMin, fromDate, days: 7, unitId: offering.unitSelection === "client_picks" ? unitId : null })` in a `useEffect` keyed on `[durationMin, fromDate, unitId]`. **Request-ordering guard from day one:** a `React.useRef(0)` sequence — `const seq = ++seqRef.current; const res = await getHourlySlots(...); if (seq !== seqRef.current) return;` before applying state.
  - Step 2a — unit (only `client_picks`): after a slot is picked, offer the units whose ids are in that slot's `unitIds` (RentalBookingFlow's unit list markup).
  - Step 3 — details: `ClientDetailsFields idPrefix="hourly-"` + submit calling `createRentalBookingHours`; on `slotTaken` clear `slot` and refetch (booking-widget idiom).
  - Confirmation summary: `{ title: offering.name, whenLine: formatHourlyWhenLine(new Date(slot), new Date(end), orgTimeZone) }` — compute `end` from `durationMin`. Times render in the **viewer's** timezone inside TimeSlotGrid (inherited behavior — correct for hourly too).
- [ ] **Step 6: Widget branch.** In `booking-widget.tsx`'s offering hand-off: `offering.rangeMode === "hours" ? <HourlyBookingFlow …same props… /> : <RentalBookingFlow …/>`. Offering card meta line: for hours, `` `${formatDurationLabel(o.minDurationMin!)}–${formatDurationLabel(o.maxDurationMin!)}` `` instead of the min-stay text; section heading stays "Stays & rentals" — rename to "Spaces & rentals" ONLY if trivial (it appears in tests: check `grep -rn "Stays & rentals" src`) — otherwise leave.
- [ ] **Step 7:** `npm run test:integration -- hourly-flow` PASS; `npm run test`; manual dev-stack walkthrough on `/book/<handle>` AND `/embed/<handle>` (embed: confirm the iframe does not ratchet taller after browsing weeks — the S3 resize reporter handles shrink; just verify).
- [ ] **Step 8: Commit** — `feat(rentals): public hourly booking flow (duration → time grid → confirm)`

---

### Task 9: Manage page — hourly cancel copy + same-duration reschedule

**Files:**
- Modify: `src/features/rentals/manage-actions.ts` (2 new actions)
- Create: `src/features/rentals/components/hourly-reschedule-panel.tsx`
- Modify: `src/features/scheduling/components/manage-booking.tsx` (branch)
- Modify: `src/features/rentals/schema.ts` (inputs)
- Test: extend `src/features/rentals/hourly-rpc.integration.test.ts` (token-path action test)

**Interfaces:**
- Consumes: `resolveActionable` (manage-actions.ts), `reschedule_rental_booking_hours` RPC, `TimeSlotGrid`, `loadOrgHourlyContext`, `providerRescheduledEmail`/`bookingRescheduledEmail` senders in the existing `rescheduleRentalBooking` (copy its email block wholesale).
- Produces:
  - `getManageHourlySlots({ token, fromDate, days ≤ 10 })` → `{ ok: true; slots: {startsAt, unitIds}[]; durationMin: number } | { ok: false; error }` — duration comes from the booking row (same-duration ruling); busy excludes the booking's own interval (`excludeBookingId`).
  - `rescheduleRentalBookingHours({ token, unitId: null | string, startsAt })` → same result shape as `rescheduleRentalBooking` (read it; reuse its email + redirect contract).

- [ ] **Step 1: Failing test** — token path: create hourly booking via RPC, call `rescheduleRentalBookingHours` action with the raw token → old row `rescheduled`, mail spooled (Mailpit assertions only if the existing manage tests do them — mirror).
- [ ] **Step 2: Actions.** `getManageHourlySlots`: `resolveActionable(token)` → booking row; derive org + offering (`getBookingOfferingId`); require hours mode; `durationMin` = `(ends_at − starts_at)/60000`; `loadOrgHourlyContext(orgId, offeringId, tz, from, span, { excludeBookingId: booking.id })`; engine union; return slots + durationMin. `rescheduleRentalBookingHours`: limiter (`publicBookingLimiter` — the reschedule surface's R2 idiom), engine re-check of the exact instant, `generateAccessToken()`, `admin.rpc("reschedule_rental_booking_hours", { p_token, p_unit_id, p_starts_at, p_new_token_hash })`, then copy the R2 client-reschedule email/redirect block (provider notice INCLUDED on client reschedules — R2 ruling is admin-only silence).
- [ ] **Step 3: Panel.** `HourlyReschedulePanel({ token, timeZone, onCancel })` mirrors `RentalReschedulePanel`'s shell: fetch `getManageHourlySlots` per week page (request-ordering guard), `TimeSlotGrid` to pick, confirm button calls the reschedule action, `router.refresh()` on success (read the R2 panel's success handling and reuse).
- [ ] **Step 4: Branch in `manage-booking.tsx`**: the rental panel choice needs the booking's range mode — read how `manage-booking.tsx` currently receives its rental props (L109 area) and thread `rangeMode` from the page loader (`getBookingOfferingId` → `getPublicOfferingById` happens server-side on the manage page — find the actual source and extend it), then `rangeMode === "hours" ? <HourlyReschedulePanel …/> : <RentalReschedulePanel …/>`.
- [ ] **Step 5:** Tests green; manual token walkthrough (book → manage link from Mailpit → reschedule).
- [ ] **Step 6: Commit** — `feat(rentals): tokenized same-duration hourly reschedule`

---

### Task 10: Admin — hourly walk-ins + moves

**Files:**
- Modify: `src/features/rentals/booking-actions.ts` (3 new actions)
- Modify: `src/features/rentals/components/new-rental-booking-dialog.tsx`, `move-rental-dialog.tsx` (hours branches)
- Modify: `src/features/scheduling/components/booking-detail-dialog.tsx` (route hourly moves to the rental move dialog — read how it currently offers "Move" for rentals and extend the condition)
- Modify: `src/features/rentals/schema.ts` (admin inputs)
- Test: extend `hourly-rpc.integration.test.ts` (admin action-level tests)

**Interfaces:**
- Consumes: `create_rental_booking_hours_admin` / `reschedule_rental_booking_hours_admin` RPCs, `loadOrgHourlyContext(includeInactiveUnits)`, `currentOrg()` (booking-actions.ts), `TimeSlotGrid`.
- Produces:
  - `getAdminHourlySlots({ offeringId, durationMin, fromDate, days ≤ 10, unitId?, excludeBookingId? })` — **admin engine posture:** build the `SlotService` with `minNoticeMin: 0, bookingWindowDays: 366` (the R2 `ignoreLimits` equivalent); occupancy/turnover still apply via `busy`.
  - `createRentalBookingHoursAdmin({ offeringId, unitId, startsAt, durationMin, name, email?, note? })` → `{ ok: true; emailed: boolean } | { ok: false; error; slotTaken? }` — mirrors `createRentalBookingAdmin` (confirmation email only when an address was given; `revalidatePath("/bookings")`).
  - `rescheduleRentalHoursAdmin({ id, unitId, startsAt })` — mirrors `rescheduleRentalBookingAdmin`: token rotation via `generateAccessToken`, **no provider notice** (R2 admin-move ruling), client gets the "rescheduled" email — copy the R2 admin action's email block verbatim (it already implements exactly this split).
- [ ] **Step 1: Failing tests** (action level, member client): admin walk-in inside notice window succeeds; admin move keeps duration and lands on the preferred old unit; move of a started booking fails with `STAY_STARTED`-equivalent (add `export const SESSION_STARTED = "This booking has already started."` to schema.ts and map the `started` sentinel).
- [ ] **Step 2: Actions** per the shapes above (validation-first `safeParse`, `currentOrg()` guard, engine pre-check for the friendly error, RPC as authority, `isTaken`/`isStarted` mapping).
- [ ] **Step 3: Dialogs.** Both dialogs currently fetch `getAdminRangeAvailability` + render `RangePicker`. Branch on the selected/current offering's `rangeMode`:
  - `new-rental-booking-dialog.tsx`: offering `<select>` includes hourly offerings; when hours → duration select (`durationOptions`) + `TimeSlotGrid` fed by `getAdminHourlySlots` (request-ordering guard) + optional unit select for `client_picks` (or "auto"); submit → `createRentalBookingHoursAdmin`.
  - `move-rental-dialog.tsx`: when the booking's offering is hours → `TimeSlotGrid` (duration fixed from the booking; show it read-only: `formatDurationLabel`), `excludeBookingId` set, unit select offering "keep automatic" (null) or explicit; submit → `rescheduleRentalHoursAdmin`. The dialog's existing "row is stale after a move → close" behavior stays.
- [ ] **Step 4: Entry point.** `new-rental-booking-dialog` is currently mounted on the timeline header; hourly offerings don't live there. Mount the dialog (same component) on the **week-calendar header** of `/bookings` when the effective mode offers rentals AND the org has ≥ 1 hours offering — pass a `defaultMode="hours"` prop that pre-filters the offering select to hourly offerings there, leaving the timeline mount unchanged. (Read `src/app/(dashboard)/bookings/page.tsx` for where the CreateBookingDialog button row renders.)
- [ ] **Step 5:** Tests green; manual: walk-in from the calendar, move it, watch the calendar update.
- [ ] **Step 6: Commit** — `feat(rentals): admin hourly walk-ins + moves`

---

### Task 11: Week calendar — timed hourly rentals, default view, staff filter

**Files:**
- Modify: `src/features/scheduling/queries.ts` (`AdminBooking.rangeMode` via the `rental_offerings(name, range_mode)` embed; update `BOOKING_COLUMNS`, `BookingRow`, `toAdminBooking`)
- Modify: `src/features/scheduling/components/calendar-week.tsx`
- Modify: `src/features/orgs/mode.ts` (`defaultBookingsView`)
- Modify: `src/app/(dashboard)/bookings/page.tsx`
- Test: `src/features/orgs/mode.test.ts` (extend), calendar behavior via existing component tests if present (check; else typecheck + manual)

**Interfaces:**
- Consumes: `AdminBooking`, `CalendarWeek` props, `defaultBookingsView(mode)`.
- Produces: `AdminBooking.rangeMode: "nights" | "days" | "hours" | null`; `defaultBookingsView(mode, hasHourly: boolean)`.

- [ ] **Step 1:** Queries: embed `rental_offerings(name, range_mode)`; `rangeMode: b.rental_offerings?.range_mode ?? null` in `toAdminBooking`.
- [ ] **Step 2:** `calendar-week.tsx` split becomes:

```ts
  // Hourly rentals are timed events like appointments; only multi-day
  // (nights/days) stays go to the all-day chip row.
  const timed = bookings.filter((b) => b.rentalUnitId === null || b.rangeMode === "hours");
  const rentals = bookings.filter((b) => b.rentalUnitId !== null && b.rangeMode !== "hours");
```

Timed rental cards: label `` `${offeringName} · ${unitName}` `` over the client name (read how appointment cards derive their label around L397 and extend the accessor — `serviceAccent(b.serviceId ?? b.rentalOfferingId ?? "")` already colors them). Clicking opens `BookingDetailDialog` (works once Task 10 wired the move path).

- [ ] **Step 3: Staff filter.** The page narrows bookings by staff when `selectedStaffIds.length < activeStaff.length`. Hourly rentals have `staffId: null` — decide visibility at the **page** level: when a narrowing staff filter is active, drop rental rows from the fetch/result (`a room isn't that person's work`); with the filter off, include them. Read how the page currently fetches week bookings (`listWeekBookings`-style call around L163–236) and apply: `const withRentals = staffFilter === undefined;` then filter `bookings = withRentals ? bookings : bookings.filter((b) => b.rentalUnitId === null)`.
- [ ] **Step 4: Default view + Timeline link.** `defaultBookingsView(mode: OrgMode, hasHourly: boolean)`: rentals-only + `hasHourly` → `"week"`; rentals-only without → `"timeline"`; otherwise `"week"`. The page computes `hasHourly`/`hasRangeOfferings` with one cheap query (`rental_offerings` select `range_mode` for the org) and: hides the Timeline view link when the org has **no** nights/days offerings. Update `mode.test.ts` accordingly.
- [ ] **Step 5:** `npm run test`; manual: hourly booking renders as a timed card; staff filter hides it; rentals-only hourly org lands on week view.
- [ ] **Step 6: Commit** — `feat(scheduling): hourly rentals on the week calendar; hourly-aware default view`

---

### Task 12: R2 deferrals, seed, docs sweep

**Files:**
- Modify: `src/features/rentals/queries.ts` (`listTimelineData` turnover padding)
- Modify: `src/features/rentals/components/rental-booking-flow.tsx`, `rental-reschedule-panel.tsx`, `move-rental-dialog.tsx` (request-ordering guards)
- Modify: `scripts/seed.ts` (hourly demo offering)
- Test: `src/features/rentals/queries.integration.test.ts` (extend — first `listTimelineData` test)

**Interfaces:** none new.

- [ ] **Step 1: Failing timeline test:** a booking ending the day before the window with `turnover_days = 2` must appear in `listTimelineData(fromDate…)`'s bookings (its tail crosses into the window).
- [ ] **Step 2: Fix:** after fetching offerings, `const maxTurnover = Math.max(0, ...offeringDb.map((o) => o.turnover_days ?? 0));` and widen only the **lower** bound of the bookings query: `fromIso` becomes `wallTimeToUtc(addDaysISO(fromDate, -maxTurnover), "00:00", timeZone).toISOString()`. (Blackout tails don't extend — blackouts carry no turnover.) Verify the timeline renderer clips bars to the window (it does — R2), run the test.
- [ ] **Step 3: Request-ordering guards** in the three R2 pickers (month navigation): the same `useRef` sequence used in Task 8 Step 5 — guard each `load`/fetch callback (`const seq = ++seqRef.current; … if (seq !== seqRef.current) return;`). One commit per file is unnecessary — one commit for all three.
- [ ] **Step 4: Seed:** add to `scripts/seed.ts` next to the existing rental seed (find it; if the seed has no rentals section, add this after the offerings/services block): hourly offering "Rehearsal Room" (increment 30, min 60, max 240, turnover 15, notice 60, window 60), units "Room A"/"Room B", offering rules Mon–Sat 09:00–21:00. Follow the seed's existing insert style (admin client, fixed UUIDs if that's the pattern — read first).
- [ ] **Step 5: Sweep:** `npm run test && npm run test:integration && npx tsc --noEmit && npm run lint` (whatever the repo's lint script is — check package.json) all green. `graphify update .`
- [ ] **Step 6: Commit** — `fix(rentals): timeline turnover padding + picker request-ordering; seed hourly demo`

---

## Post-plan checklist (for the executing session)

- Final whole-branch review (subagent-driven-development's two-stage review), fix wave, re-review.
- PR against `main` titled `feat: H2 hourly mode — range_mode 'hours' on the appointments slot engine`; PR body lists the deferred minors observed en route (nights/days provider-new email gap; "Stays & rentals" heading copy; anything the reviews accept as deferred).
- Deploy note for the PR body: **0055+0056 must apply before the app deploy** (loaders select the new columns).
- After merge: update memory notes (`product-direction`, new `hourly-mode-notes` if warranted); H3 spec starts at migration **0057**.
