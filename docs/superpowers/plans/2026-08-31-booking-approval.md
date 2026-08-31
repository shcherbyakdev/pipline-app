# Booking Approval (Request-to-Book) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-service/per-space "Require approval": public bookings arrive as `pending` requests that hold the slot, are accepted/declined from an Overview inbox (and calendar), and email the client the outcome.

**Architecture:** A `pending` status on the existing `bookings` row (plus `declined`), with both EXCLUDE overlap guards and every free-check widened to `('confirmed','pending')` — slot-holding falls out of the constraint, declining frees the slot by a status flip. Expiry is computed (`pending && starts_at <= now()`), no cron. Accept/decline are direct-update-under-RLS server actions (the `booking-actions.ts` idiom), with accept rotating the manage token before sending the confirmation email.

**Tech Stack:** Next.js App Router, Supabase (RLS + SECURITY DEFINER RPCs), Drizzle migrations, Zod, Vitest (+ `*.integration.test.ts` against local Supabase), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-31-booking-approval-design.md`

## Deviations from the spec (verified during planning — flag to Andrii at review)

1. **No "Pending token" in the Bookings Show dropdown.** `bookings-scope.ts` is a strictly two-sided people/spaces model (`normalise`, `applyScope`, `scopeSides` all assume two sides); pending rows carry `staff_id`/`rental_offering_id` so the existing scope already filters them correctly. Requests appear in list views via widened queries + a "Pending approval" badge instead.
2. **No studio-form toggle.** `studio/forms/services.tsx` / `spaces.tsx` edit booking-page *section* config, not services/spaces (spaces.tsx links out to "Manage spaces"). The toggle's only homes are `service-dialog.tsx` and `offering-dialog.tsx`.
3. **RPC return shapes unchanged.** Instead of adding `status` to the create RPCs' returns, each create action does one `select("status")` by the returned id (admin client). Smaller migration, same truth.
4. **`overview` flag default flips `false` → `true`** — the spec's "Overview inbox" is unreachable while `/overview` 404s by default (2026-08-18 ruling: stat tiles alone didn't earn the nav slot; the inbox does).
5. **Withdraw email reuses the existing cancellation templates** (client + provider). Manage-page UI says "Withdraw request"; the email copy still says "cancelled as requested". Deferred nicety.

## Global Constraints

- Branch: `git fetch origin && git switch -c feat/booking-approval origin/main`. Verify `ls src/db/migrations | tail -1` shows `0061_reserved_staff_slugs.sql` — local `main` is BEHIND origin and lacks it. The new migration is **0062**.
- Migrations live in `src/db/migrations/` (Drizzle), never `supabase/migrations/`. CI drift check: after any `src/db/schema/*.ts` change, `npx drizzle-kit generate` must produce no new files (i.e. generate the migration from the schema change, then hand-append SQL to that same file).
- New statuses full set: `confirmed | pending | declined | cancelled_by_client | cancelled_by_provider | rescheduled`. "Expired" is NEVER a stored status — it is computed: `status === 'pending' && starts_at <= now`.
- Admin RPCs (`create_booking_admin`, `create_rental_booking_admin`, `create_rental_booking_hours_admin`) and both reschedule families stay untouched — walk-ins always confirm; pending can't be rescheduled (existing `status = 'confirmed'` guards already enforce it).
- Decline note: max 500 chars, stored on `bookings.decline_note`, included in the decline email.
- Unit tests: `npm run test`. Integration: `npm run supabase:start` once, then `npm run test:integration` (local ports are +30: API 54351, db 54352). `npm run verify` = lint + typecheck + unit tests.
- Browser QA drives `localhost`, never `127.0.0.1` (cross-origin HMR → inert clicks).
- After code changes land, run `graphify update .` (project rule; do it once in Task 10).
- Every commit message ends with the standard Co-Authored-By/Claude-Session trailer used on this repo.

---

### Task 1: Migration 0062 — columns, statuses, widened guards, RPC behavior

**Files:**
- Modify: `src/db/schema/scheduling.ts` (services table ~L39-60 area; bookings table L188-215)
- Modify: `src/db/schema/rentals.ts` (rentalOfferings table, near `active` at L64)
- Create: `src/db/migrations/0062_booking_approval.sql` (via `db:generate` + rename + hand-append)
- Create: `src/features/scheduling/approval-rpc.integration.test.ts`
- Create: `src/features/rentals/approval-rpc.integration.test.ts`

**Interfaces:**
- Produces (DB): `services.requires_approval boolean not null default false`; `rental_offerings.requires_approval boolean not null default false`; `bookings.decline_note text` (CHECK ≤ 500); statuses `pending`/`declined` valid; both EXCLUDE guards and `pick_staff_for_slot` / `rental_unit_is_free` / `rental_unit_is_free_hours` cover `('confirmed','pending')`; the three public create RPCs insert `pending` when the flag is set; `cancel_booking` withdraws a pending row (bypassing the rental cancel-window guard for pending only).
- Consumed by: every later task.

- [ ] **Step 1: Schema columns in Drizzle**

In `src/db/schema/scheduling.ts`, `services` table, after the `active` column:

```ts
    // Approval feature: when true, public creates insert status='pending'
    // instead of 'confirmed' (0062). Admin walk-ins ignore it.
    requiresApproval: boolean("requires_approval").default(false).notNull(),
```

Same file, `bookings` table, after `note`:

```ts
    // Provider's optional message stamped at decline time (CHECK <= 500, 0062).
    declineNote: text("decline_note"),
```

Update the status comment at L188-189 to:

```ts
    // 'confirmed' | 'pending' | 'declined' | 'cancelled_by_client' |
    // 'cancelled_by_provider' | 'rescheduled' — CHECK in 0062 (was 0026).
    // The EXCLUDE guards cover 'confirmed' AND 'pending' (0062): a request
    // holds its slot. "Expired" is computed (pending && starts_at <= now),
    // never stored.
```

In `src/db/schema/rentals.ts`, `rentalOfferings` table, after `active`:

```ts
    // Approval feature (0062): public creates insert status='pending'.
    requiresApproval: boolean("requires_approval").default(false).notNull(),
```

- [ ] **Step 2: Generate the migration, rename, append SQL**

```bash
npm run db:generate
# produces src/db/migrations/0062_<random>.sql with the three ADD COLUMNs + meta/0062_snapshot.json
```

Rename the SQL file to `0062_booking_approval.sql` and edit `src/db/migrations/meta/_journal.json`'s new entry `"tag"` to `"0062_booking_approval"`. Then append to the SQL file (after the generated ADD COLUMN statements):

```sql
--> statement-breakpoint
-- ============================================================
-- Booking approval (request-to-book). A 'pending' booking is a request:
-- it HOLDS its slot (EXCLUDE below), 'declined' frees it by status flip,
-- and a pending row past its starts_at is expired by definition — no cron.
-- ============================================================

alter table public.bookings
  add constraint bookings_decline_note_check
    check (decline_note is null or length(decline_note) <= 500);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_status_check;
--> statement-breakpoint
alter table public.bookings
  add constraint bookings_status_check
    check (status in
      ('confirmed','pending','declined',
       'cancelled_by_client','cancelled_by_provider','rescheduled'));
--> statement-breakpoint
-- Both overlap guards (0041 staff-scoped, 0037 unit-scoped) re-created so a
-- pending request reserves the slot. Accepting (pending -> confirmed) can
-- never conflict; declining/cancelling frees the slot with no further work.
alter table public.bookings drop constraint bookings_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending') and staff_id is not null);
--> statement-breakpoint
alter table public.bookings drop constraint bookings_rental_unit_no_overlap;
--> statement-breakpoint
alter table public.bookings add constraint bookings_rental_unit_no_overlap
  exclude using gist (rental_unit_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status in ('confirmed','pending') and rental_unit_id is not null);
```

- [ ] **Step 3: Widen the SQL free-check helpers (same file, appended)**

Copy each function's LATEST full definition into 0062 as `create or replace`, changing **only** the status predicate `b.status = 'confirmed'` → `b.status in ('confirmed','pending')`:

- `pick_staff_for_slot` — copy from `src/db/migrations/0052_audit_hardening.sql` (the status filter is at its L191: `where b.staff_id = st.id and b.status = 'confirmed'`).
- `rental_unit_is_free` — copy from `src/db/migrations/0039_rentals_r2_rpcs.sql:9-40` (filter: `and b.status = 'confirmed'`).
- `rental_unit_is_free_hours` — copy from `src/db/migrations/0056_hourly_security.sql:113-131` (filter at its L126).

Keep each function's existing `revoke`/`grant` lines verbatim after it (grants convention). Add one comment above the trio:

```sql
-- Free-checks mirror the EXCLUDE predicate — a slot a pending request holds
-- must read as busy, or the constraint 23P01s what the pre-check allowed.
```

- [ ] **Step 4: Create RPCs read the flag (same file, appended)**

`create_booking`: copy the full body from `src/db/migrations/0054_org_modes.sql:139-231` as `create or replace function` (signature unchanged, so no drop needed), with exactly two edits:

1. The service select gains the flag:
```sql
  select s.id, s.duration_min, s.booking_window_days, s.requires_approval into v_service
    from public.services s where s.id = p_service_id and s.org_id = v_org.id and s.active;
```
2. The insert's status value:
```sql
         starts_at, ends_at, status, cancel_token_hash, note)
      values
        (v_org.id, p_service_id, v_staff, v_client_id, btrim(p_name), lower(p_email),
         p_starts_at, v_ends_at,
         case when v_service.requires_approval then 'pending' else 'confirmed' end,
         p_token_hash, p_note)
```

`create_rental_booking`: copy from `src/db/migrations/0058_prices_terms.sql:129-250` as `create or replace`. Its `v_off` is `select *` — `v_off.requires_approval` exists automatically. One edit at the insert (0058's L235): replace the literal `'confirmed'` with `case when v_off.requires_approval then 'pending' else 'confirmed' end`.

`create_rental_booking_hours`: copy from `src/db/migrations/0058_prices_terms.sql:358-433` as `create or replace`. Same single edit at its insert (0058's L425): `'confirmed'` → `case when v_off.requires_approval then 'pending' else 'confirmed' end`.

Keep every `revoke`/`grant` line verbatim (all three stay service_role-only).

- [ ] **Step 5: `cancel_booking` withdraws pending (same file, appended)**

Copy from `src/db/migrations/0058_prices_terms.sql:783-827` as `create or replace`, changing only the update's status condition. Old:

```sql
    where b.cancel_token_hash = v_hash and b.status = 'confirmed' and b.starts_at > now()
      -- H3: a rental inside its free-cancellation window cannot self-cancel.
      and (b.rental_offering_id is null or not exists (
```

New (a request not yet accepted is ALWAYS withdrawable — the cancel window protects confirmed rentals only):

```sql
    where b.cancel_token_hash = v_hash and b.starts_at > now()
      and (b.status = 'pending'
        -- H3: a CONFIRMED rental inside its free-cancellation window cannot
        -- self-cancel; a pending request is always withdrawable.
        or (b.status = 'confirmed'
          and (b.rental_offering_id is null or not exists (
```

(Close the added paren at the end of that predicate group; the `cancel_window` sentinel `exists` check below it keeps `b.status = 'confirmed'` unchanged.) Keep the revoke/grant lines.

- [ ] **Step 6: Write the failing integration tests**

`src/features/scheduling/approval-rpc.integration.test.ts` — follow `s3-rpc.integration.test.ts` verbatim for env/clients/seed (owner via `signedInUser`, `create_org`, `update_org_scheduling` with a unique handle, one service + `service_staff` link + Mon–Sun 09:00–17:00 `availability_rules`; copy its L1-96 idiom). Then set the flag and test:

```ts
import { generateAccessToken } from "@/lib/tokens/mint";
// ...seed as in s3-rpc.integration.test.ts, then:

describe("booking approval — appointments", () => {
  beforeAll(async () => {
    await owner.from("services").update({ requires_approval: true }).eq("id", serviceId);
  });

  const create = (startsAt: string, email = "req@example.com") => {
    const t = generateAccessToken();
    return admin.rpc("create_booking", {
      p_handle: HANDLE, p_service_id: serviceId, p_starts_at: startsAt,
      p_name: "Requester", p_email: email, p_note: null,
      p_token_hash: t.tokenHash, p_staff_id: null, p_candidates: null,
    }).then((r) => ({ ...r, token: t.token }));
  };
  const statusOf = async (id: string) =>
    (await admin.from("bookings").select("status").eq("id", id).single()).data!.status;

  it("flag on -> public create inserts status=pending", async () => {
    const { data, error } = await create("2027-07-01T10:00:00Z");
    expect(error).toBeNull();
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    expect(await statusOf(id)).toBe("pending");
  });

  it("a pending request blocks an overlapping public create", async () => {
    const { error } = await create("2027-07-01T10:00:00Z", "second@example.com");
    expect(error).not.toBeNull(); // 'taken' — the EXCLUDE covers pending
  });

  it("accept (pending -> confirmed) succeeds; decline frees the slot", async () => {
    const { data } = await create("2027-07-02T10:00:00Z");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const { error: acceptErr } = await owner
      .from("bookings").update({ status: "confirmed" }).eq("id", id);
    expect(acceptErr).toBeNull();

    const { data: d2 } = await create("2027-07-03T10:00:00Z", "b@example.com");
    const id2 = (d2 as Array<{ booking_id: string }>)[0].booking_id;
    await owner.from("bookings")
      .update({ status: "declined", decline_note: "fully booked" }).eq("id", id2);
    const { error: rebookErr } = await create("2027-07-03T10:00:00Z", "c@example.com");
    expect(rebookErr).toBeNull(); // declined no longer holds the slot
  });

  it("cancel_booking withdraws a pending request", async () => {
    const { data, token } = await create("2027-07-04T10:00:00Z", "wd@example.com");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const { error } = await admin.rpc("cancel_booking", { p_token: token });
    expect(error).toBeNull();
    expect(await statusOf(id)).toBe("cancelled_by_client");
  });

  it("rotate_booking_token and reschedule_booking refuse a pending row", async () => {
    const { data, token } = await create("2027-07-05T10:00:00Z", "rr@example.com");
    const id = (data as Array<{ booking_id: string }>)[0].booking_id;
    const fresh = generateAccessToken();
    const { error: rotErr } = await owner.rpc("rotate_booking_token", {
      p_booking_id: id, p_token_hash: fresh.tokenHash });
    expect(rotErr).not.toBeNull(); // guard stays 'confirmed' — accept flips first
    const { error: resErr } = await admin.rpc("reschedule_booking", {
      p_token: token, p_starts_at: "2027-07-05T12:00:00Z", p_new_token_hash: fresh.tokenHash });
    expect(resErr ?? { message: "no row" }).not.toBeNull();
  });

  it("create_booking_admin ignores the flag (walk-ins confirm instantly)", async () => {
    const t = generateAccessToken();
    const { data: id, error } = await owner.rpc("create_booking_admin", {
      p_service_id: serviceId, p_starts_at: "2027-07-06T10:00:00Z",
      p_name: "Walk-in", p_email: null, p_note: null, p_token_hash: t.tokenHash,
      p_duration_min: null, p_staff_id: staffId });
    expect(error).toBeNull();
    expect(await statusOf(id as string)).toBe("confirmed");
  });
});
```

`src/features/rentals/approval-rpc.integration.test.ts` — seed like `hourly-rpc.integration.test.ts` (org + one `rental_offerings` row per mode + a unit + `rental_availability`-equivalent seeding as that file does), set `requires_approval: true` on the offering, then:

```ts
it("range create inserts pending; pending blocks the dates; decline frees them", async () => {
  const h = () => generateAccessToken();
  const t1 = h();
  const { data: id1, error: e1 } = await admin.rpc("create_rental_booking", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: unitId,
    p_start_date: d(10), p_end_date: d(12), p_name: "A", p_email: "a@example.com",
    p_note: null, p_token_hash: t1.tokenHash });
  expect(e1).toBeNull();
  expect((await bookingRow(id1 as string)).status).toBe("pending");

  const { error: e2 } = await admin.rpc("create_rental_booking", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: unitId,
    p_start_date: d(11), p_end_date: d(13), p_name: "B", p_email: "b@example.com",
    p_note: null, p_token_hash: h().tokenHash });
  expect(e2).not.toBeNull(); // rental_unit_is_free now sees pending

  await owner.from("bookings").update({ status: "declined" }).eq("id", id1 as string);
  const { error: e3 } = await admin.rpc("create_rental_booking", {
    p_handle: handle, p_offering_id: offeringId, p_unit_id: unitId,
    p_start_date: d(10), p_end_date: d(12), p_name: "C", p_email: "c@example.com",
    p_note: null, p_token_hash: h().tokenHash });
  expect(e3).toBeNull();
});

it("hours create inserts pending and blocks the slot while pending", async () => {
  const t = generateAccessToken();
  const { data: id, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle, p_offering_id: hoursOfferingId, p_unit_id: hoursUnitId,
    p_starts_at: iso(`${d(20)}T10:00`), p_duration_min: 120,
    p_name: "H", p_email: "h@example.com", p_note: null, p_token_hash: t.tokenHash });
  expect(error).toBeNull();
  expect((await bookingRow(id as string)).status).toBe("pending");

  const { error: e2 } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle, p_offering_id: hoursOfferingId, p_unit_id: hoursUnitId,
    p_starts_at: iso(`${d(20)}T11:00`), p_duration_min: 120,
    p_name: "H2", p_email: "h2@example.com", p_note: null,
    p_token_hash: generateAccessToken().tokenHash });
  expect(e2).not.toBeNull(); // rental_unit_is_free_hours now sees pending
});
```

(Seed a second, hours-mode offering `hoursOfferingId` with `requires_approval: true`, one unit `hoursUnitId`, and offering availability rows exactly as `hourly-rpc.integration.test.ts`'s `beforeAll` does; copy its `iso`/`d`/`bookingRow` helpers into this file.)

- [ ] **Step 7: Run the new tests, verify they FAIL**

```bash
npm run supabase:start   # if not already up
npm run test:integration -- approval-rpc
```
Expected: FAIL — `requires_approval` column does not exist.

- [ ] **Step 8: Apply the migration, verify tests PASS**

```bash
npm run db:migrate
npm run test:integration -- approval-rpc
```
Expected: PASS. Also run the neighbors that exercise the touched RPCs:
```bash
npm run test:integration -- s3-rpc hourly-rpc rpc.integration r2-rpc h3-money
```
Expected: all PASS (behavior for flag-off orgs is byte-identical).

- [ ] **Step 9: Drift check + commit**

```bash
npx drizzle-kit generate   # must create nothing new
git add -A && git commit -m "feat(db): booking approval — pending/declined statuses, widened guards, flag-aware create RPCs"
```

---

### Task 2: Blocking reads, list queries, request helpers, stats

**Files:**
- Create: `src/features/scheduling/requests.ts`
- Create: `src/features/scheduling/requests.test.ts`
- Modify: `src/lib/booking/public.ts:137` (`getBusyIntervals`), `:646` (`loadOrgRangeContext`), `:748` (`loadOrgHourlyContext`)
- Modify: `src/features/rentals/queries.ts:300` (`listTimelineData`)
- Modify: `src/features/scheduling/queries.ts` (`listBookings` L247-274, `listConfirmedBookingsBetween` L280-300, new `listPendingRequests` + `countPendingRequests`)
- Modify: `src/app/(dashboard)/bookings/page.tsx:303` (renamed calendar query)
- Modify: `src/features/scheduling/stats.ts` (cancellation-rate loop L62-71)
- Test: `src/features/scheduling/stats.test.ts`

**Interfaces:**
- Produces: `isPendingRequest(b: { status: string; startsAt: string | Date }, now: Date): boolean` and `isExpiredRequest(...same...): boolean` (requests.ts); `listPendingRequests(): Promise<AdminBooking[]>`; `countPendingRequests(): Promise<number>`; `listCalendarBookingsBetween` (renamed from `listConfirmedBookingsBetween`, now returns confirmed + live-pending rows).
- Consumes: Task 1's DB statuses.

- [ ] **Step 1: Failing unit tests**

Append to `src/features/scheduling/stats.test.ts` (row factory exists at L10):

```ts
it("pending and declined rows never count — not as bookings, not in cancellation rate", () => {
  const rows = [
    row("2027-03-10T09:00:00Z", "pending"),
    row("2027-03-10T10:00:00Z", "declined"),
    row("2027-03-10T11:00:00Z", "confirmed"),
    row("2027-03-10T12:00:00Z", "cancelled_by_client"),
  ];
  const stats = computeOverviewStats(rows, NOW, TZ);
  expect(stats.weekCount).toBe(1);
  // eligible = confirmed + cancelled only -> rate 1/2, not 1/4
  expect(stats.cancellationRate).toBe(0.5);
});
```

Create `src/features/scheduling/requests.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isPendingRequest, isExpiredRequest } from "./requests";

const NOW = new Date("2027-03-10T12:00:00Z");

describe("request helpers", () => {
  it("pending + future = live request", () => {
    const b = { status: "pending", startsAt: "2027-03-10T13:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(true);
    expect(isExpiredRequest(b, NOW)).toBe(false);
  });
  it("pending + started = expired, not live", () => {
    const b = { status: "pending", startsAt: "2027-03-10T12:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(false);
    expect(isExpiredRequest(b, NOW)).toBe(true);
  });
  it("confirmed is neither", () => {
    const b = { status: "confirmed", startsAt: "2027-03-10T13:00:00Z" };
    expect(isPendingRequest(b, NOW)).toBe(false);
    expect(isExpiredRequest(b, NOW)).toBe(false);
  });
});
```

Run: `npm run test -- requests stats` → FAIL (module missing / rate wrong).

- [ ] **Step 2: Implement**

`src/features/scheduling/requests.ts` (the ONE home of the expiry rule — inbox, badge, calendar, and lists all import from here):

```ts
// "Expired" is computed, never stored (0062): a pending row whose start has
// passed simply lapsed — it no longer blocks future availability (its range
// is in the past) and must not appear as an actionable request anywhere.
type RequestLike = { status: string; startsAt: string | Date };

export function isPendingRequest(b: RequestLike, now: Date): boolean {
  return b.status === "pending" && new Date(b.startsAt).getTime() > now.getTime();
}

export function isExpiredRequest(b: RequestLike, now: Date): boolean {
  return b.status === "pending" && new Date(b.startsAt).getTime() <= now.getTime();
}
```

`stats.ts` cancellation loop — add one line after the `rescheduled` skip (L67):

```ts
      if (b.status === "rescheduled") continue; // the replacement booking already counts
      if (b.status === "pending" || b.status === "declined") continue; // a request never became a booking
```

`src/lib/booking/public.ts` — three one-line widenings, each `.eq("status", "confirmed")` → `.in("status", ["confirmed", "pending"])` (L137, L646, L748), with one shared comment at the first site:

```ts
      // Pending requests hold their slot (0062 EXCLUDE) — busy sets must agree.
```

`src/features/rentals/queries.ts:300` — same widening in `listTimelineData` (a pending stay must occupy its lane).

`src/features/scheduling/queries.ts`:

Rename `listConfirmedBookingsBetween` → `listCalendarBookingsBetween` and widen so it returns confirmed rows plus LIVE pending (expired pendings vanish from the grid):

```ts
export async function listCalendarBookingsBetween(
  fromIso: string,
  toIso: string,
  staffIds?: string[],
): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const base = supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    // Confirmed, plus live pending requests — they hold slots (0062), so the
    // grid must show why a time is blocked. A lapsed pending is history.
    .or(`status.eq.confirmed,and(status.eq.pending,starts_at.gt.${new Date().toISOString()})`)
    .lt("starts_at", toIso)
    .gt("ends_at", fromIso);
  // ...rest unchanged
}
```

Update its one caller `src/app/(dashboard)/bookings/page.tsx:303` to the new name.

`listBookings` — widen both arms:

```ts
      // Upcoming: confirmed, plus live pending requests.
      supabase
        .from("bookings")
        .select(BOOKING_COLUMNS)
        .or(`status.eq.confirmed,and(status.eq.pending,starts_at.gt.${nowIso})`)
        .gte("ends_at", nowIso)
        .order("starts_at", { ascending: true }),
      // History: terminal statuses, confirmed-and-ended, and lapsed requests.
      supabase
        .from("bookings")
        .select(BOOKING_COLUMNS)
        .or(
          `status.in.(cancelled_by_client,cancelled_by_provider,rescheduled,declined),` +
            `and(status.eq.confirmed,ends_at.lt.${nowIso}),` +
            `and(status.eq.pending,starts_at.lte.${nowIso})`,
        )
        .order("starts_at", { ascending: false })
        .limit(50),
```

New queries at the bottom of the file:

```ts
/** Live pending requests, oldest start first — the Overview inbox feed. */
export async function listPendingRequests(): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "pending")
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
}

/** Cheap head-count of live pending requests — the sidebar badge. */
export async function countPendingRequests(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .gt("starts_at", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 3: Tests pass + typecheck**

```bash
npm run test -- requests stats
npm run verify
```
Expected: PASS (verify also catches any missed `listConfirmedBookingsBetween` caller).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(scheduling): pending-aware busy sets, list queries, request helpers, stats guard"
```

---

### Task 3: Config surface — "Require approval" toggle on service + space dialogs

**Files:**
- Modify: `src/features/scheduling/schema.ts:19-37` (`serviceInput`)
- Modify: `src/features/scheduling/actions.ts:89-102` (`toServiceRow`)
- Modify: `src/features/scheduling/queries.ts:6-31` (`ServiceRow` type + its select)
- Modify: `src/features/scheduling/components/service-dialog.tsx` (checkbox + payload, near L276-285 / L82-100)
- Modify: `src/features/rentals/schema.ts:12-24` (`offeringCommon` — NOTE: branches are `.strict()`, the field MUST go here)
- Modify: `src/features/rentals/actions.ts:47-61` (mapper `common`)
- Modify: `src/features/rentals/queries.ts:12-57` (`OfferingRow` + `OFFERING_COLUMNS`)
- Modify: `src/features/rentals/components/offering-dialog.tsx` (checkbox near L509-518 + `common` payload L97-139)

**Interfaces:**
- Produces: `serviceInput`/`offeringCommon` accept `requiresApproval: z.boolean().default(false)`; `ServiceRow.requiresApproval: boolean`; `OfferingRow.requiresApproval: boolean`.
- Consumes: Task 1's columns.

- [ ] **Step 1: Zod + mappers + row types**

`scheduling/schema.ts`, inside `serviceInput` after `active`:
```ts
  requiresApproval: z.boolean().default(false),
```
`scheduling/actions.ts` `toServiceRow`, after `active: d.active,`:
```ts
    requires_approval: d.requiresApproval,
```
`scheduling/queries.ts`: add `requiresApproval: boolean;` to `ServiceRow`, add `requires_approval` to its select, and map it where the row is shaped (follow how `active` flows).

`rentals/schema.ts`, inside `offeringCommon` after `active`:
```ts
  requiresApproval: z.boolean().default(false),
```
`rentals/actions.ts` mapper `common`, after `active: d.active,`:
```ts
  requires_approval: d.requiresApproval,
```
`rentals/queries.ts`: add `requiresApproval` to `OfferingRow` + `requires_approval` to `OFFERING_COLUMNS` + the row mapping.

- [ ] **Step 2: Dialog checkboxes**

`service-dialog.tsx`, directly under the Active checkbox block (L276-285), same idiom:

```tsx
        <div className="flex items-center gap-2">
          <input
            id="service-requires-approval"
            name="requiresApproval"
            type="checkbox"
            className="size-4"
            defaultChecked={service?.requiresApproval ?? false}
          />
          <Label htmlFor="service-requires-approval">Require approval</Label>
        </div>
        <p className="text-muted-foreground text-xs">
          New bookings wait for your confirmation instead of confirming instantly.
        </p>
```

Payload (L82-100), after `active`:
```ts
    requiresApproval: fd.get("requiresApproval") === "on",
```

`offering-dialog.tsx`: identical block under its Active checkbox (id `offering-requires-approval`), and in `common` (L97-139):
```ts
    requiresApproval: fd.get("requiresApproval") === "on",
```

- [ ] **Step 3: Verify + manual check**

```bash
npm run verify
```
Expected: PASS. Then with `npm run dev`: toggle it on a service, re-open the dialog — the checkbox persists (round-trip through `ServiceRow`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(config): Require approval toggle on services and spaces"
```

---

### Task 4: Templates, STATUS_LABEL, public payload types

**Files:**
- Modify: `src/features/scheduling/templates.ts` (STATUS_LABEL L105-110; `providerNewBookingEmail` L376-412; two new templates after `bookingCancelledEmail`; `bookingLifecycleKey` kind union L205-225)
- Modify: `src/lib/booking/public.ts` (`PublicService` L25-36 + selects L70-72/L180-182 + maps L78-89/L188-199; `PublicOffering` L379-407 + `PUBLIC_OFFERING_COLUMNS` L410-411 + `PublicOfferingDb` L413-437 + `toPublicOffering` L439-465)

**Interfaces:**
- Produces: `bookingRequestReceivedEmail(input)` and `bookingDeclinedEmail(input)` (shapes below); `providerNewBookingEmail` gains `pending?: boolean`; `bookingLifecycleKey` accepts kinds `"request-declined"` and `"request-received"`; `STATUS_LABEL.pending = "Pending approval"`, `.declined = "Declined"`; `PublicService.requiresApproval: boolean`; `PublicOffering.requiresApproval: boolean`.
- Consumes: Task 1's column (selects).

- [ ] **Step 1: STATUS_LABEL + lifecycle kinds**

```ts
export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending approval",
  declined: "Declined",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};
```

In `bookingLifecycleKey`'s kind union, add `| "request-received" | "request-declined" | "manage-accept"` (the last one is the accept-time confirmation's key, used in Task 7).

- [ ] **Step 2: New client templates (after `bookingCancelledEmail`, same style)**

```ts
// Approval: the request-time twin of bookingConfirmationEmail. No .ics —
// nothing is on anyone's calendar yet; the manage link is the withdraw path.
export function bookingRequestReceivedEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  manageUrl: string;
  staffName?: string | null;
  badgeUrl?: string | null;
  infoLines?: string[];
}): { subject: string; html: string; text: string } {
  const subject = `Request received — ${input.serviceName}, ${input.whenLine}`;
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">Your booking request was sent. You'll get an email once ${esc(input.orgName)} confirms it.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${(input.infoLines ?? []).map((l) => `\n  <p style="margin: 0 0 4px; color: #444;">${esc(l)}</p>`).join("")}
  <p style="margin: 0 0 8px;">
    <a href="${esc(input.manageUrl)}">View or withdraw this request</a>
  </p>
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    Keep this email — the link above is your access to the request.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    `Your booking request was sent. You'll get an email once ${input.orgName} confirms it.`,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.infoLines ?? []),
    "",
    `View or withdraw: ${input.manageUrl}`,
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}

export function bookingDeclinedEmail(input: {
  orgName: string;
  serviceName: string;
  whenLine: string;
  note?: string | null;
  staffName?: string | null;
  badgeUrl?: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `Request declined — ${input.serviceName}, ${input.whenLine}`;
  const noteHtml = input.note
    ? `\n  <p style="margin: 0 0 16px; color: #444; white-space: pre-wrap;">&ldquo;${esc(input.note)}&rdquo;</p>`
    : "";
  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="font-size: 18px; margin: 0 0 16px;">${esc(input.orgName)}</h2>
  <p style="margin: 0 0 8px;">${esc(input.orgName)} couldn't take your booking request.</p>
  <p style="margin: 0 0 4px;"><strong>${esc(input.serviceName)}</strong></p>${staffHtmlLine(input.staffName)}
  <p style="margin: 0 0 16px;">${esc(input.whenLine)}</p>${noteHtml}
  <p style="color: #666; font-size: 12px; margin: 16px 0 0;">
    You're welcome to request another time on the booking page.
  </p>${badgeHtmlLine(input.badgeUrl)}
</div>`.trim();
  const text = [
    input.orgName,
    "",
    `${input.orgName} couldn't take your booking request.`,
    input.serviceName,
    ...staffTextLine(input.staffName),
    input.whenLine,
    ...(input.note ? ["", `"${input.note}"`] : []),
    "",
    "You're welcome to request another time on the booking page.",
    ...badgeTextLines(input.badgeUrl),
  ].join("\n");
  return { subject, html, text };
}
```

- [ ] **Step 3: Provider variant**

`providerNewBookingEmail`: add `pending?: boolean` to the input type; then:

```ts
  const requested = input.pending === true;
  const subject = requested
    ? `New booking request — ${input.serviceName}, ${input.whenLine}`
    : `New booking — ${input.serviceName}, ${input.whenLine}`;
```
Lead line: `${input.clientName} ${requested ? "requested a booking with you." : "booked with you."}` (both html and text). Footer line:
```ts
  const footer = requested
    ? "Accept or decline it from your Overview page — the slot is held until you do."
    : "It's on your calendar; the client got their confirmation.";
```
(use `footer` in both html and text where the current footer string sits).

- [ ] **Step 4: Public payload types**

`src/lib/booking/public.ts`:
- `PublicService`: add `requiresApproval: boolean;`
- Both service selects (L70-72 and L180-182): append `, requires_approval`
- Both `.map` blocks: `requiresApproval: s.requires_approval,` (match the row typing idiom used for the other fields)
- `PUBLIC_OFFERING_COLUMNS`: append `, requires_approval`
- `PublicOfferingDb`: add `requires_approval: boolean;`
- `PublicOffering`: add `requiresApproval: boolean;`
- `toPublicOffering`: add `requiresApproval: o.requires_approval,`

- [ ] **Step 5: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat(emails+payload): request/declined templates, provider request variant, requiresApproval on public types"
```

---

### Task 5: Public create actions branch on pending; flows say "Request"

**Files:**
- Modify: `src/features/scheduling/public-actions.ts` (`createBooking` L162-329)
- Modify: `src/features/rentals/public-actions.ts` (`createRentalBooking` L121-326)
- Modify: `src/features/rentals/hourly-actions.ts` (`createRentalBookingHours` L159-331)
- Modify: `src/features/scheduling/components/booking-confirmed.tsx`
- Modify: `src/features/scheduling/components/booking-widget.tsx` (submit label ~L455, done-state ~L278)
- Modify: `src/features/rentals/components/rental-booking-flow.tsx` (label ~L251, success ~L141-148)
- Modify: `src/features/rentals/components/hourly-booking-flow.tsx` (label ~L336, success ~L181-194)

**Interfaces:**
- Produces: all three create actions' success shape gains `pending: boolean` (`{ ok: true; token: string; pending: boolean; ... }`); `BookingConfirmed` gains `pending?: boolean`.
- Consumes: Task 4 templates + payload types; Task 1 RPC behavior.

- [ ] **Step 1: `createBooking` (scheduling/public-actions.ts)**

Return type: `{ ok: true; token: string; staffName: string | null; pending: boolean }`.

After the `row` extraction (L234-240), read the truth from the DB (the RPC decided under the flag it saw at insert time):

```ts
    // The RPC decided under the flag it read at insert time — one select
    // keeps the emails honest even if the toggle flips mid-flight.
    const { data: statusRow } = await admin
      .from("bookings").select("status").eq("id", row.booking_id).maybeSingle();
    const isPending = statusRow?.status === "pending";
```

Client email block: import `bookingRequestReceivedEmail` and branch —

```ts
      const manageUrl = buildBookingManageUrl(token);
      const msg = isPending
        ? bookingRequestReceivedEmail({
            orgName: ctx.org.orgName,
            serviceName: ctx.service.name,
            whenLine,
            manageUrl,
            staffName,
            badgeUrl: await emailBadgeUrl(ctx.org.orgId),
          })
        : bookingConfirmationEmail({ /* existing args unchanged */ });
```
(keep the existing `selectTransport().send` unchanged; for pending, the idempotency key stays `bookingIdempotencyKey(row.booking_id)` — one creation, one mail).

Provider block: pass `pending: isPending` into `providerNewBookingEmail`.

Staff notice: only for instant bookings — wrap the existing `sendStaffNotice` call in `if (!isPending) { ... }` (the member hears about it on accept, Task 7).

Success return: `return { ok: true, token, staffName, pending: isPending };`

- [ ] **Step 2: `createRentalBooking` + `createRentalBookingHours` — same branch**

Both: success shape gains `pending` (including the early mail-prep-failure return — `return { ok: true, token, pending: isPending };` — compute `isPending` immediately after the RPC succeeds, before mail prep). The status select uses the `admin` client already in scope with `bookingId as string`. Client mail: `bookingRequestReceivedEmail` with the same `orgName/serviceName/whenLine/manageUrl/infoLines` values the confirmed branch uses (rentals pass `infoLines`, no `staffName`). Provider mail: `pending: isPending`. There are no staff notices in the range flow; hourly has none either — leave those paths alone.

- [ ] **Step 3: `BookingConfirmed` pending variant**

```tsx
export function BookingConfirmed({ token, summary, staffName, pending }: {
  token: string;
  summary?: { title: string; whenLine: string };
  staffName?: string | null;
  pending?: boolean;
}) {
```
- Heading: `{pending ? "Request sent" : "Booking confirmed"}`
- Body copy for pending: `Nothing is booked yet — you'll get an email as soon as it's confirmed. Keep that email; the link below is your access to the request.`
- The `.ics` link renders only when `!pending` (nothing is on a calendar yet). The "View your booking" link stays for both; label it `{pending ? "View your request" : "View your booking"}`.

- [ ] **Step 4: Flow wiring**

Each flow stores the action result's `pending` next to its existing `doneToken` state and passes it to `BookingConfirmed`. Submit buttons (the selected service/offering object is already in scope in each):

- `booking-widget.tsx` ~L455: `{preview ? "Preview" : pending ? "Sending…" : svc.requiresApproval ? "Request to book" : "Confirm booking"}` — `svc` = the selected `PublicService` the panel already renders duration from (match the local variable name).
- `rental-booking-flow.tsx` ~L251 and `hourly-booking-flow.tsx` ~L336: `{pending ? "Sending…" : offering.requiresApproval ? "Request to book" : "Confirm booking"}`.

- [ ] **Step 5: Verify + commit**

```bash
npm run verify
```
Expected: PASS (type errors surface every missed `{ ok: true, token }` site). Manual: flag a service on, book on `/book/<handle>` via `npm run dev` — success panel says "Request sent", Mailpit (http://localhost:54354) shows "Request received" + "New booking request".

```bash
git add -A && git commit -m "feat(public): request-to-book flow — pending-aware actions, CTA + success copy"
```

---

### Task 6: Client manage page — pending / declined / expired states

**Files:**
- Modify: `src/app/booking/[token]/page.tsx` (STATUS_LINE L10-15, gate L73-96)
- Modify: `src/features/scheduling/components/manage-booking.tsx` (props L33-58, cancel block L199-214)

**Interfaces:**
- Produces: `ManageBooking` gains `request?: boolean` (withdraw wording).
- Consumes: Task 1's `cancel_booking` widening (withdraw works through the existing cancel action unchanged).

- [ ] **Step 1: Page states**

```ts
const STATUS_LINE: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Waiting for confirmation",
  declined: "Request declined",
  cancelled_by_client: "Cancelled",
  cancelled_by_provider: "Cancelled by the provider",
  rescheduled: "Rescheduled",
};
```

Expired override where the line renders: `{b.status === "pending" && !isInFuture ? "Request expired" : (STATUS_LINE[b.status] ?? b.status)}`.

Widen the action gate: alongside the existing `b.status === "confirmed"` branch, add a pending branch (no `.ics` — nothing is confirmed):

```tsx
{b.status === "pending" && isInFuture ? (
  <>
    <p className="text-muted-foreground text-sm">
      {b.orgName ?? "The provider"} hasn't confirmed this request yet — you'll get
      an email when they do.
    </p>
    <ManageBooking
      token={token}
      timeZone={b.orgTimezone}
      canReschedule={false}
      canCancel={true}
      kind={b.rentalUnitId === null ? "appointment" : "rental"}
      rangeMode={b.rangeMode}
      request
    />
  </>
) : null}
```
(Check what org-name field `resolveBookingToken` actually returns — `src/lib/tokens/booking.ts:41-104`; if none, drop the name and write "This request hasn't been confirmed yet…".)

- [ ] **Step 2: `ManageBooking` withdraw wording**

Add `request?: boolean` to props. In the cancel block, swap copy when set:
- trigger button: `{request ? "Withdraw request" : "Cancel booking"}`
- confirm button: `{request ? "Yes, withdraw this request" : "Yes, cancel this booking"}`
- keep-button stays "Keep it".
A withdrawn request goes through the existing cancel action verbatim (`cancel_booking` now accepts pending, Task 1). Post-cancel confirmation copy inside the component: reuse as-is (deviation 5).

- [ ] **Step 3: Verify + commit**

`npm run verify`; manual: open the manage link from a request email — banner + "Withdraw request" present; withdraw flips the page to "Cancelled". Declined row (flip one in Studio/psql) shows "Request declined".

```bash
git add -A && git commit -m "feat(manage): pending/declined/expired request states + withdraw"
```

---

### Task 7: Accept / decline server actions

**Files:**
- Modify: `src/features/scheduling/schema.ts` (new `declineBookingInput` next to `bookingIdInput`)
- Modify: `src/features/scheduling/booking-actions.ts` (two new exports at the end)
- Create: `src/features/scheduling/approval-actions.integration.test.ts`

**Interfaces:**
- Produces: `acceptBookingRequest(input: unknown): Promise<{ ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }>` (input `{ id }`); `declineBookingRequest(input: unknown)` same shape (input `{ id, note? }`).
- Consumes: Task 4 templates (`bookingDeclinedEmail`), Task 2 nothing, Task 1 statuses; `rotate_booking_token` (authenticated grant, 0033) for the fresh manage link.

- [ ] **Step 1: Schema input**

```ts
export const declineBookingInput = z.object({
  id: z.uuid(),
  note: z.string().trim().max(500).optional(),
});
```

- [ ] **Step 2: Failing integration test**

`approval-actions.integration.test.ts` — seed like `s3-rpc.integration.test.ts`; borrow `hourly-rpc.integration.test.ts`'s action idiom (L30-40): `vi.mock("@/lib/supabase/server", ...)` with `actingClient.current = owner`, `vi.mock("next/cache", ...)`, dynamic-import `./booking-actions` after `loadEnvFile`. Set `requires_approval` on the service, create a request via `admin.rpc("create_booking", ...)`, then:

```ts
it("accept flips to confirmed and rotates the manage token", async () => {
  const before = await admin.from("bookings")
    .select("status, cancel_token_hash").eq("id", requestId).single();
  const result = await bookingActions.acceptBookingRequest({ id: requestId });
  expect(result.ok).toBe(true);
  const after = await admin.from("bookings")
    .select("status, cancel_token_hash").eq("id", requestId).single();
  expect(after.data!.status).toBe("confirmed");
  expect(after.data!.cancel_token_hash).not.toBe(before.data!.cancel_token_hash);
});

it("decline stamps declined + note; both refuse an already-resolved row", async () => {
  const result = await bookingActions.declineBookingRequest({ id: requestId2, note: "fully booked" });
  expect(result.ok).toBe(true);
  const row = await admin.from("bookings")
    .select("status, decline_note").eq("id", requestId2).single();
  expect(row.data!.status).toBe("declined");
  expect(row.data!.decline_note).toBe("fully booked");
  const again = await bookingActions.acceptBookingRequest({ id: requestId2 });
  expect(again.ok).toBe(false);
});

it("accept refuses an expired request", async () => {
  // create a request, admin-backdate starts_at/ends_at (s3 test idiom), then:
  const result = await bookingActions.acceptBookingRequest({ id: expiredId });
  expect(result.ok).toBe(false);
});
```

Run → FAIL (functions don't exist).

- [ ] **Step 3: Implement in `booking-actions.ts`**

Follow `cancelBookingAdmin` (L51-163) line-for-line for structure — parse, `currentOrg()`, guarded update with `.select(...)`, committed-tail try/catch, `revalidatePath`. New imports: `bookingDeclinedEmail`, `bookingRequestReceivedEmail` is NOT needed here, `declineBookingInput`.

```ts
export async function acceptBookingRequest(
  input: unknown,
): Promise<{ ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }> {
  const parsed = bookingIdInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    // pending -> confirmed cannot 23P01: the row already holds its slot under
    // the widened EXCLUDE (0062). Guards: live requests only.
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "pending")
      .gt("starts_at", new Date().toISOString())
      .select(
        "id, client_name, client_email, staff_id, starts_at, ends_at, rental_unit_id, price_cents, currency, deposit_cents, staff(name), services(name), rental_offerings(name, cancel_window_min), rental_units(name)",
      );
    if (error) return fail("acceptBookingRequest", error);
    const row = (data as unknown as Array<{
      id: string;
      client_name: string;
      client_email: string | null;
      staff_id: string | null;
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      price_cents: number | null;
      currency: string | null;
      deposit_cents: number | null;
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string; cancel_window_min: number } | null;
      rental_units: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only a live pending request can be accepted." };

    // Past this line the accept is APPLIED — the committed-tail discipline
    // from cancelBookingAdmin applies to everything below.
    let emailed = false;
    let noEmail = false;
    try {
      const serviceName = bookingTitle(row);
      const whenLine = whenLineFor(
        { startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), isRental: row.rental_unit_id !== null },
        org.timezone,
      );
      const idempotencyKey = bookingLifecycleKey(row.id, "manage-accept");

      if (!row.client_email) {
        noEmail = true;
      } else {
        // Rotate first (resendManageLink discipline): the confirmation must
        // carry a live link, and the request-received link dies with it.
        const fresh = generateAccessToken();
        const { error: rotateError } = await supabase.rpc("rotate_booking_token", {
          p_booking_id: row.id,
          p_token_hash: fresh.tokenHash,
        });
        if (rotateError) {
          // Accepted but link not rotated: the old (request) link still works.
          // Skip the mail; "Resend link" recovers.
          console.error("[scheduling] accept rotate failed:", rotateError);
        } else {
          emailed = true;
          try {
            const infoLines =
              row.rental_unit_id !== null
                ? moneyInfoLines({
                    totalCents: row.price_cents,
                    depositCents: row.deposit_cents,
                    currency: row.currency,
                    cancelWindowMin: row.rental_offerings?.cancel_window_min ?? 0,
                  })
                : [];
            const msg = bookingConfirmationEmail({
              orgName: org.name,
              serviceName,
              whenLine,
              manageUrl: buildBookingManageUrl(fresh.token),
              icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${fresh.token}/calendar.ics`,
              staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
              badgeUrl: await emailBadgeUrl(org.id),
              infoLines,
            });
            await selectTransport().send({
              to: row.client_email,
              subject: msg.subject,
              html: msg.html,
              text: msg.text,
              idempotencyKey,
            });
          } catch (mailError) {
            console.error("[scheduling] accept email failed:", mailError);
            emailed = false;
          }
        }
      }

      // The member finally hears about it — creation deliberately skipped
      // the staff notice for pending rows (Task 5).
      if (row.staff_id) {
        await sendStaffNotice({
          orgId: org.id,
          staffId: row.staff_id,
          kind: "new",
          serviceName,
          clientName: row.client_name,
          whenLine,
          idempotencyKey,
        });
      }
    } catch (postError) {
      console.error("[scheduling] accept follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true, emailed, noEmail };
  } catch (error) {
    return fail("acceptBookingRequest", error);
  }
}

export async function declineBookingRequest(
  input: unknown,
): Promise<{ ok: true; emailed: boolean; noEmail?: boolean } | { ok: false; error: string }> {
  const parsed = declineBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "declined", decline_note: parsed.data.note ?? null })
      .eq("id", parsed.data.id)
      .eq("org_id", org.id)
      .eq("status", "pending")
      .gt("starts_at", new Date().toISOString())
      .select(
        "id, client_email, starts_at, ends_at, rental_unit_id, staff(name), services(name), rental_offerings(name), rental_units(name)",
      );
    if (error) return fail("declineBookingRequest", error);
    const row = (data as unknown as Array<{
      id: string;
      client_email: string | null;
      starts_at: string;
      ends_at: string;
      rental_unit_id: string | null;
      staff: { name: string } | null;
      services: { name: string } | null;
      rental_offerings: { name: string } | null;
      rental_units: { name: string } | null;
    }>)?.[0];
    if (!row) return { ok: false, error: "Only a live pending request can be declined." };

    let emailed = false;
    let noEmail = false;
    try {
      if (!row.client_email) {
        noEmail = true;
      } else {
        emailed = true;
        try {
          const msg = bookingDeclinedEmail({
            orgName: org.name,
            serviceName: bookingTitle(row),
            whenLine: whenLineFor(
              { startsAt: new Date(row.starts_at), endsAt: new Date(row.ends_at), isRental: row.rental_unit_id !== null },
              org.timezone,
            ),
            note: parsed.data.note ?? null,
            staffName: await resolveClientStaffName(org.id, row.staff?.name ?? null),
            badgeUrl: await emailBadgeUrl(org.id),
          });
          await selectTransport().send({
            to: row.client_email,
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
            idempotencyKey: bookingLifecycleKey(row.id, "request-declined"),
          });
        } catch (mailError) {
          console.error("[scheduling] decline email failed:", mailError);
          emailed = false;
        }
      }
    } catch (postError) {
      console.error("[scheduling] decline follow-up failed:", postError);
    }

    revalidatePath("/bookings");
    revalidatePath("/overview");
    return { ok: true, emailed, noEmail };
  } catch (error) {
    return fail("declineBookingRequest", error);
  }
}
```

New imports at the top of the file: `bookingDeclinedEmail` (templates), `declineBookingInput` (schema), `moneyInfoLines` from `@/features/rentals/pricing`. The `"manage-accept"` and `"request-declined"` lifecycle kinds were added to `bookingLifecycleKey` in Task 4.

- [ ] **Step 4: Tests pass + commit**

```bash
npm run test:integration -- approval-actions
npm run verify
git add -A && git commit -m "feat(admin): accept/decline booking-request actions"
```

---

### Task 8: Overview inbox, flag default, sidebar badge

**Files:**
- Modify: `src/lib/flags/index.ts:30` (`overview: false` → `true`)
- Create: `src/features/scheduling/components/requests-inbox.tsx`
- Modify: `src/app/(dashboard)/overview/page.tsx`
- Modify: `src/app/(dashboard)/layout.tsx` (count fetch + prop)
- Modify: `src/components/shell/app-shell.tsx`, `app-sidebar.tsx`, `mobile-nav.tsx`, `sidebar-body.tsx` (thread `pendingRequests: number`, badge on the `/overview` row)

**Interfaces:**
- Consumes: `listPendingRequests` / `countPendingRequests` (Task 2), `acceptBookingRequest` / `declineBookingRequest` (Task 7), `AdminBooking` (queries.ts).
- Produces: `RequestsInbox({ requests, timeZone }: { requests: AdminBooking[]; timeZone: string })`.

- [ ] **Step 1: Flag default**

`src/lib/flags/index.ts:30`: `overview: true,` and amend the comment above it: the 2026-08-18 ruling is superseded — the requests inbox earns the nav slot; orgs can still be opted out per-org via /utils.

- [ ] **Step 2: `RequestsInbox` component**

`"use client"`. Renders nothing when `requests.length === 0` (spec: no permanent empty box). Per row: client name + service/space title (use `bookingTitle` from `./booking-label` — it's a pure helper), when-line (format client-side with the same `Intl` idiom `bookings-list.tsx` uses — copy its date-format helper), note (truncated, `text-muted-foreground`), price line when `priceCents !== null` (reuse how `bookings-list.tsx` shows money if it does; otherwise `new Intl.NumberFormat(undefined, { style: "currency", currency }).format(priceCents / 100)`). Actions per row:

```tsx
const [pending, startTransition] = useTransition();
const [declining, setDeclining] = useState<string | null>(null); // booking id with dialog open
const [note, setNote] = useState("");
const router = useRouter();

const accept = (id: string) =>
  startTransition(async () => {
    const result = await acceptBookingRequest({ id });
    if (!result.ok) toast.error(result.error);
    else toast.success(result.emailed ? "Accepted — confirmation sent." : "Accepted.");
    router.refresh();
  });

const decline = (id: string) =>
  startTransition(async () => {
    const result = await declineBookingRequest({ id, note: note.trim() || undefined });
    if (!result.ok) toast.error(result.error);
    else toast.success("Request declined.");
    setDeclining(null); setNote("");
    router.refresh();
  });
```

Buttons: `<Button size="sm" onClick={() => accept(b.id)} disabled={pending}>Accept</Button>` and `<Button variant="outline" size="sm" onClick={() => setDeclining(b.id)} disabled={pending}>Decline…</Button>`. The decline dialog: use the same `Dialog` primitive `service-dialog.tsx` imports, one `<textarea maxLength={500}>` labeled "Message to the client (optional)", buttons "Decline request" (destructive) / "Keep". Follow the toast import used in `space-booking-form.tsx` (`toast` from wherever it imports it — check its header).

Section wrapper (server side provides the heading):

```tsx
<section className="flex flex-col gap-3">
  <h2 className="text-sm font-medium">Requests</h2>
  <ul className="flex flex-col gap-2">{/* rows: rounded-lg border p-4 */}</ul>
</section>
```

- [ ] **Step 3: Overview page**

```tsx
import { listPendingRequests, listStatsBookings } from "@/features/scheduling/queries";
import { RequestsInbox } from "@/features/scheduling/components/requests-inbox";
// ...
  const [requests, rows] = await Promise.all([
    listPendingRequests(),
    listStatsBookings(new Date(now.getTime() - 90 * DAY_MS).toISOString()),
  ]);
// in JSX, above the stat grid:
      <RequestsInbox requests={requests} timeZone={timeZone} />
```

- [ ] **Step 4: Sidebar badge**

`layout.tsx`: `const pendingRequests = flags.overview ? await countPendingRequests() : 0;` (import from scheduling/queries) and pass `pendingRequests={pendingRequests}` into `<AppShell>`. Thread the prop: `app-shell.tsx` → `app-sidebar.tsx` + `mobile-nav.tsx` → `sidebar-body.tsx`. In `sidebar-body.tsx`'s item loop (L77-91):

```tsx
        {text}
        {href === "/overview" && pendingRequests > 0 ? (
          <span className="bg-primary/10 text-primary ml-auto rounded-full px-1.5 text-[10px] font-medium tabular-nums">
            {pendingRequests}
          </span>
        ) : null}
```

- [ ] **Step 5: Verify + manual + commit**

`npm run verify`; manual with dev server: create a request publicly → badge shows 1, Overview lists it, Accept confirms (badge drops, calendar gains the booking), Decline with a note sends the mail (Mailpit).

```bash
git add -A && git commit -m "feat(overview): requests inbox, overview on by default, sidebar count"
```

---

### Task 9: Admin calendar / timeline / dialog / list — pending rendering

**Files:**
- Modify: `src/features/scheduling/components/calendar-week.tsx` (timed block L385-413, all-day chip L283-291)
- Modify: `src/features/rentals/components/timeline-lane.tsx` (`Stay` className L419-426)
- Modify: `src/features/scheduling/components/booking-detail-dialog.tsx` (actions row L120-157)
- Modify: `src/features/scheduling/components/bookings-list.tsx` (badge L79-87, actions L116-151, sections ~L209/L231)

**Interfaces:**
- Consumes: `acceptBookingRequest`/`declineBookingRequest` (Task 7), `STATUS_LABEL` (Task 4), `AdminBooking.status`, `isExpiredRequest` (Task 2) where a now-dependent label is needed.

- [ ] **Step 1: Calendar ghost**

The dashed *left border* channel is taken (space vs appointment — comment at L405-407). Use the box border + fill: in the timed block's `className` (L400), branch:

```tsx
        className={cn(
          "absolute inset-x-0 z-10 overflow-hidden rounded-md border p-1.5 text-left text-xs shadow-sm hover:shadow",
          b.status === "pending" ? "border-dashed bg-card/50 opacity-80" : "bg-card",
        )}
```
(`cn` is already the file's idiom.) Inside the block's text, when pending, append a muted marker line: `<span className="text-muted-foreground">Pending</span>` in the same spot the block renders its meta text. Same branch on the all-day chip (L287): `b.status === "pending" && "border-dashed bg-card/50 opacity-80"`.

- [ ] **Step 2: Timeline ghost**

`timeline-lane.tsx` Stay className list (L419-426), add one line:

```tsx
      b.status === "pending" && "border-dashed opacity-80",
```
and make the solid accent fill conditional (L431): keep `background` as-is but for pending use the muted mix: `background: b.status === "pending" ? \`color-mix(in srgb, ${accent} 8%, var(--card))\` : \`color-mix(in srgb, ${accent} 16%, var(--card))\``.

- [ ] **Step 3: Detail dialog accept/decline**

In `DetailBody`, before the existing `ended ? … :` actions block, add a pending branch (imports: `acceptBookingRequest`, `declineBookingRequest`, `Badge`, `STATUS_LABEL`):

```tsx
  if (booking.status === "pending") {
    const expired = new Date(booking.startsAt).getTime() <= now;
    return (
      <>
        {/* existing header/when/client rows stay above */}
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{expired ? "Request expired" : STATUS_LABEL.pending}</Badge>
        </div>
        {expired ? (
          <p className="text-muted-foreground text-xs">This request lapsed before it was answered.</p>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={accept} disabled={pending}>Accept</Button>
            <Button variant="outline" size="sm" onClick={openDecline} disabled={pending}>Decline…</Button>
          </div>
        )}
      </>
    );
  }
```
Structure it the way the component actually composes (keep shared rows shared; only the actions row branches). `accept`/`openDecline` follow the `resend`/`cancel` handler idiom already in the file (useTransition + toast + `router.refresh()`); the decline dialog is the same one built in Task 8 — extract it as `DeclineRequestDialog({ bookingId, open, onOpenChange })` in `requests-inbox.tsx` and import it here rather than duplicating (export it from that file).

- [ ] **Step 4: Bookings list**

- Upcoming section: pending rows keep `actionable` FALSE for the standard controls but show a "Pending approval" badge + Accept / Decline. Concretely: compute `const isRequest = booking.status === "pending";` in the row component; badge block (L84-86) becomes:

```tsx
        {isRequest ? (
          <Badge variant="secondary">Pending approval</Badge>
        ) : actionable ? null : (
          <Badge variant="secondary">
            {booking.status === "pending" ? "Request expired" : (STATUS_LABEL[booking.status] ?? booking.status)}
          </Badge>
        )}
```
(the inner `pending` case covers lapsed requests in the Past section — reuse `isExpiredRequest` if a `now` is already in scope, otherwise section placement implies it).
- Actions block (L116): `{isRequest ? (<Accept/Decline pair as in Step 3>) : actionable ? (existing controls) : null}`.

- [ ] **Step 5: Verify + commit**

`npm run verify`; manual: request visible as dashed ghost on week grid + timeline, dialog offers Accept/Decline, list shows the badge, declined row lands in history as "Declined", lapsed request as "Request expired".

```bash
git add -A && git commit -m "feat(admin-ui): pending ghosts on calendar/timeline, accept/decline in dialog + list"
```

---

### Task 10: Full verification + QA + graph update

**Files:** none new (fixes only).

- [ ] **Step 1: Full suites**

```bash
npm run verify
npm run test:integration
```
Expected: all green (1161+ unit tests, 405+ integration). Fix regressions before proceeding.

- [ ] **Step 2: Playwright QA pass (drive `localhost`, never `127.0.0.1`)**

1. Toggle "Require approval" on a service; book publicly → "Request sent" panel, no .ics link.
2. Overview: badge count 1, inbox row present; Accept → toast, calendar shows solid booking, Mailpit has confirmation with a working manage link (the rotated one).
3. Second request; Decline with note → Mailpit declined mail carries the note; slot immediately bookable again publicly.
4. Manage page of a live request: "Waiting for confirmation" + Withdraw works.
5. Flag-off service still books instantly (regression).
6. WCAG spot-check the inbox + dialog additions (labels on the textarea, button names) — the repo's zero-fail bar.

- [ ] **Step 3: Graph + memory hygiene**

```bash
graphify update .
```

- [ ] **Step 4: Final commit + PR**

```bash
git add -A && git commit -m "chore: booking approval QA fixes"
git push -u origin feat/booking-approval
gh pr create --title "feat: booking approval (request-to-book)" --body "..."
```
PR body: summary, spec + plan paths, the five deviations, test counts. End with the standard generated-with footer.
