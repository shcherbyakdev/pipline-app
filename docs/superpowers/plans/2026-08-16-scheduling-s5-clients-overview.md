# Scheduling S5 — Clients Directory + Overview Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last MVP slice: a scheduling-flavored clients directory with booking history and rename, an `/overview` page with four stat tiles, and the 0034 fix that stops anonymous re-bookers from renaming clients.

**Architecture:** No new tables. One migration (0034) redefines `create_booking`'s client upsert to keep the existing name. Stats are computed by a pure, unit-tested TS module fed by a single 90-day bookings query; pages stay thin server components composing existing feature queries/components (`ClientHeader`, `formatWhenLine`, `Badge`).

**Tech Stack:** Next.js App Router (NOTE: this repo runs a newer Next than your training data — check `node_modules/next/dist/docs/` if any App Router API surprises you; pages use the `PageProps<"/route">` typed helper and `await params`/`await searchParams`), Supabase (RLS + definer RPCs), Drizzle migrations, Vitest, Tailwind + shadcn-style UI components.

**Spec:** `docs/superpowers/specs/2026-08-16-scheduling-s5-clients-overview-design.md`

## Global Constraints

- Branch: `scheduling-s5` off `main` (create in an isolated worktree per superpowers:using-git-worktrees).
- Verify commands: `npm run verify` (lint + typecheck + unit tests). Integration tests: `npm run test:integration` — requires the local Supabase stack (`supabase start`; this machine's ports are shifted +30) and migrations applied (`npm run db:migrate`).
- Migration convention: security-relevant SQL is hand-written custom migrations; every new grant explicit; `create or replace` on a same-signature function preserves existing EXECUTE grants (0028 idiom). No new tables ⇒ no new grants in this slice.
- Feature boundary: cross-feature reads go through a feature's `queries.ts`; server actions validate with zod from `schema.ts` (this slice reuses existing `renameClient`/`deleteClient`, no new actions).
- Never store or display sensitive personal data (name, email, note only).
- After code changes on this branch land, run `graphify update .` once (Task 8).
- Commit messages: conventional (`feat:`/`fix:`/`test:`), each ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migration 0034 — anon re-booking no longer renames the client

**Files:**
- Modify: `src/features/scheduling/booking-rpc.integration.test.ts` (the `re-booking with the same email reuses the client row` test, ~line 139)
- Create: `src/db/migrations/0034_s5_client_name.sql` (via drizzle-kit custom)

**Interfaces:**
- Consumes: existing `create_booking(p_handle, p_service_id, p_starts_at, p_name, p_email, p_note, p_token_hash)` as defined in `0028_booking_lifecycle_security.sql`.
- Produces: same function, same signature — only the client upsert's conflict action changes. `create_booking_admin` (0031) is deliberately untouched.

- [ ] **Step 1: Extend the integration test to pin name preservation (failing first)**

In `src/features/scheduling/booking-rpc.integration.test.ts`, the file's earlier happy-path test books as `"Jamie Doe"`. Change the re-booking test (which books again as `"Jamie D."`) to assert the original name survives:

```ts
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
      .select("id, name")
      .eq("org_id", orgId)
      .eq("email", "jamie@example.com");
    expect(clients!.length).toBe(1);
    // 0034: first-typed name wins — an unverified re-booker can't rename the
    // client. The provider renames via the directory.
    expect(clients![0].name).toBe("Jamie Doe");
  });
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

Run: `supabase start` (if not running), `npm run db:migrate`, then
`npm run test:integration -- booking-rpc`
Expected: FAIL on the new assertion with received `"Jamie D."` (pre-0034 the upsert renames).

- [ ] **Step 3: Create the empty custom migration**

Run: `npx drizzle-kit generate --custom --name=s5_client_name`
Expected: `src/db/migrations/0034_s5_client_name.sql` created (empty) and registered in `meta/_journal.json` with tag `0034_s5_client_name`.

- [ ] **Step 4: Write the migration**

Fill `src/db/migrations/0034_s5_client_name.sql` with the full redefinition — this is 0028's `create_booking` body verbatim except the `on conflict` action (marked below):

```sql
-- 0034 (S5): anon re-booking no longer renames the client.
-- create_booking's client upsert previously did `set name = excluded.name`,
-- letting anyone who typed a known email rename that client in the provider's
-- directory (unverified input; deferred from S1). First-typed name now
-- sticks; the provider renames via the clients directory (member-RLS update
-- on clients, 0018). create_booking_admin (0031) keeps rename-on-conflict on
-- purpose — walk-in input is the provider's own, authenticated. The booking
-- row still records whatever the booker typed (client_name).
-- Same signature; OR REPLACE keeps the existing anon EXECUTE grant (0028 idiom).
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
  -- 0034 change: keep the existing name (no-op update so RETURNING still
  -- yields the row) instead of `excluded.name`.
  do update set name = clients.name
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
```

Before finalizing, diff the copied body against 0028's actual `create_booking` (lines ~74–155 of `0028_booking_lifecycle_security.sql`) to confirm the ONLY semantic change is the conflict action.

- [ ] **Step 5: Apply and verify green**

Run: `npm run db:migrate`, then `npm run test:integration -- booking-rpc`
Expected: PASS, including the untouched throttle/containment/EXCLUDE tests.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0034_s5_client_name.sql src/db/migrations/meta src/features/scheduling/booking-rpc.integration.test.ts
git commit -m "fix: create_booking keeps existing client name on re-booking (S5)"
```

---

### Task 2: Pure overview-stats module (TDD)

**Files:**
- Create: `src/features/scheduling/stats.ts`
- Test: `src/features/scheduling/stats.test.ts`

**Interfaces:**
- Consumes: `mondayOf` from `./calendar-geometry`; `addDaysISO`, `dateInZone`, `wallTimeToUtc` from `./slots` (all existing — same imports as `src/app/(dashboard)/bookings/page.tsx`).
- Produces:
  - `type StatsBookingRow = { startsAt: string; status: string; createdAt: string }`
  - `type OverviewStats = { weekCount: number; monthCount: number; cancellationRate: number | null; busiestWeekday: string | null; busiestHour: number | null }`
  - `computeOverviewStats(rows: StatsBookingRow[], now: Date, timeZone: string): OverviewStats`

- [ ] **Step 1: Write the failing tests**

Create `src/features/scheduling/stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeOverviewStats, type StatsBookingRow } from "./stats";

// 2027-03-10 is a Wednesday; Berlin is CET (UTC+1) until DST starts
// 2027-03-28. Week = Mon 03-08 .. Sun 03-14 → UTC [03-07T23:00, 03-14T23:00).
// Month = Mar → UTC [02-28T23:00, 03-31T22:00) (April 1 falls in CEST).
const NOW = new Date("2027-03-10T12:00:00Z");
const TZ = "Europe/Berlin";

const row = (
  startsAt: string,
  status = "confirmed",
  createdAt = "2027-03-01T00:00:00Z",
): StatsBookingRow => ({ startsAt, status, createdAt });

describe("computeOverviewStats", () => {
  it("counts confirmed bookings in the org-tz week and month, boundaries half-open", () => {
    const rows = [
      row("2027-03-07T23:00:00Z"), // Mon 00:00 Berlin — first instant of week
      row("2027-03-14T22:59:00Z"), // Sun 23:59 Berlin — last minute of week
      row("2027-03-14T23:00:00Z"), // next Mon 00:00 — out of week, in month
      row("2027-02-28T22:59:00Z"), // Feb 28 23:59 Berlin — out of month
      row("2027-03-31T21:59:00Z"), // Mar 31 23:59 CEST — in month, not week
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(2);
    expect(stats.monthCount).toBe(4);
  });

  it("only status=confirmed counts toward week/month", () => {
    const rows = [
      row("2027-03-10T09:00:00Z", "cancelled_by_client"),
      row("2027-03-10T10:00:00Z", "cancelled_by_provider"),
      row("2027-03-10T11:00:00Z", "rescheduled"),
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(0);
    expect(stats.monthCount).toBe(0);
  });

  it("cancellation rate = cancelled / (created-in-30d minus rescheduled)", () => {
    const rows = [
      row("2027-03-11T09:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T10:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T11:00:00Z", "confirmed", "2027-03-01T00:00:00Z"),
      row("2027-03-11T12:00:00Z", "cancelled_by_client", "2027-03-05T00:00:00Z"),
      // rescheduled rows are neutral — their replacement already counts
      row("2027-03-11T13:00:00Z", "rescheduled", "2027-03-05T00:00:00Z"),
      // created before the 30-day window — ignored entirely
      row("2027-03-11T14:00:00Z", "cancelled_by_provider", "2027-01-01T00:00:00Z"),
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.cancellationRate).toBe(0.25);
  });

  it("cancellation rate is null with no bookings created in the window", () => {
    const rows = [row("2027-03-11T09:00:00Z", "confirmed", "2027-01-01T00:00:00Z")];
    expect(computeOverviewStats(rows, NOW, TZ).cancellationRate).toBeNull();
  });

  it("busiest weekday and hour are independent modes over past-90d confirmed bookings", () => {
    const rows = [
      row("2027-03-02T09:00:00Z"), // Tue 10:00 Berlin
      row("2027-03-09T09:00:00Z"), // Tue 10:00 Berlin
      row("2027-03-03T08:00:00Z"), // Wed 09:00 Berlin
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBe("Tue");
    expect(stats.busiestHour).toBe(10);
  });

  it("ties break to the earlier weekday (Mon-first) and earlier hour", () => {
    const rows = [
      row("2027-03-02T13:00:00Z"), // Tue 14:00 Berlin
      row("2027-03-01T09:00:00Z"), // Mon 10:00 Berlin
    ];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBe("Mon");
    expect(stats.busiestHour).toBe(10);
  });

  it("future bookings count toward the week but not toward busiest", () => {
    const rows = [row("2027-03-12T09:00:00Z")]; // Friday — after NOW (Wed)
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.weekCount).toBe(1);
    expect(stats.busiestWeekday).toBeNull();
    expect(stats.busiestHour).toBeNull();
  });

  it("bookings older than 90 days are excluded from busiest", () => {
    const rows = [row("2026-12-01T10:00:00Z")];
    const stats = computeOverviewStats(rows, NOW, TZ);
    expect(stats.busiestWeekday).toBeNull();
  });

  it("buckets busiest-hour by the DST-local wall clock", () => {
    // DST started 2027-03-28; 08:00Z on Mon 03-29 is 10:00 CEST.
    const now = new Date("2027-04-01T12:00:00Z");
    const rows = [row("2027-03-29T08:00:00Z", "confirmed", "2027-03-20T00:00:00Z")];
    const stats = computeOverviewStats(rows, now, TZ);
    expect(stats.busiestWeekday).toBe("Mon");
    expect(stats.busiestHour).toBe(10);
  });

  it("December month window rolls into January", () => {
    const now = new Date("2026-12-15T12:00:00Z");
    const rows = [
      row("2026-12-31T23:30:00Z", "confirmed", "2026-12-01T00:00:00Z"),
      row("2027-01-01T00:30:00Z", "confirmed", "2026-12-01T00:00:00Z"),
    ];
    expect(computeOverviewStats(rows, now, "UTC").monthCount).toBe(1);
  });

  it("empty input yields zero counts and null rates", () => {
    const stats = computeOverviewStats([], NOW, TZ);
    expect(stats).toEqual({
      weekCount: 0,
      monthCount: 0,
      cancellationRate: null,
      busiestWeekday: null,
      busiestHour: null,
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/scheduling/stats.test.ts`
Expected: FAIL — module `./stats` not found.

- [ ] **Step 3: Implement `stats.ts`**

```ts
import { mondayOf } from "./calendar-geometry";
import { addDaysISO, dateInZone, wallTimeToUtc } from "./slots";

// Pure overview-stat aggregation (S5). All boundaries in the org timezone;
// weeks are Mon–Sun to match the admin calendar. Feed it bookings with
// starts_at >= now - 90d: both booking RPCs floor starts_at at now - 24h at
// insert time, so that one window also contains every booking created in the
// last 30 days (the cancellation-rate basis).
export type StatsBookingRow = {
  startsAt: string;
  status: string;
  createdAt: string;
};

export type OverviewStats = {
  weekCount: number;
  monthCount: number;
  /** cancelled / (created-in-30d minus rescheduled); null when no denominator. */
  cancellationRate: number | null;
  /** en short weekday name in the org tz ("Tue"); null when no past-90d history. */
  busiestWeekday: string | null;
  /** 0-23 org-tz start hour; null when no past-90d history. */
  busiestHour: number | null;
};

const DAY_MS = 86_400_000;
const WEEKDAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isCancelled(status: string): boolean {
  return status === "cancelled_by_client" || status === "cancelled_by_provider";
}

function nextMonthFirstISO(todayISO: string): string {
  const year = Number(todayISO.slice(0, 4));
  const month = Number(todayISO.slice(5, 7));
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

export function computeOverviewStats(
  rows: StatsBookingRow[],
  now: Date,
  timeZone: string,
): OverviewStats {
  const todayISO = dateInZone(now, timeZone);
  const weekStartISO = mondayOf(todayISO);
  const weekFrom = wallTimeToUtc(weekStartISO, "00:00", timeZone).getTime();
  const weekTo = wallTimeToUtc(addDaysISO(weekStartISO, 7), "00:00", timeZone).getTime();
  const monthFrom = wallTimeToUtc(`${todayISO.slice(0, 7)}-01`, "00:00", timeZone).getTime();
  const monthTo = wallTimeToUtc(nextMonthFirstISO(todayISO), "00:00", timeZone).getTime();

  let weekCount = 0;
  let monthCount = 0;
  for (const b of rows) {
    if (b.status !== "confirmed") continue;
    const t = Date.parse(b.startsAt);
    if (t >= weekFrom && t < weekTo) weekCount++;
    if (t >= monthFrom && t < monthTo) monthCount++;
  }

  const createdFrom = now.getTime() - 30 * DAY_MS;
  let cancelled = 0;
  let eligible = 0;
  for (const b of rows) {
    if (Date.parse(b.createdAt) < createdFrom) continue;
    if (b.status === "rescheduled") continue; // the replacement booking already counts
    eligible++;
    if (isCancelled(b.status)) cancelled++;
  }
  const cancellationRate = eligible === 0 ? null : cancelled / eligible;

  // Busiest = independent modes over history only (no future bookings).
  const historyFrom = now.getTime() - 90 * DAY_MS;
  const nowMs = now.getTime();
  const weekdayCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  });
  for (const b of rows) {
    if (b.status !== "confirmed") continue;
    const t = Date.parse(b.startsAt);
    if (t < historyFrom || t > nowMs) continue;
    let weekday = "";
    let hour = -1;
    for (const part of fmt.formatToParts(new Date(t))) {
      if (part.type === "weekday") weekday = part.value;
      if (part.type === "hour") hour = Number(part.value);
    }
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
  }

  let busiestWeekday: string | null = null;
  for (const day of WEEKDAY_ORDER) {
    const count = weekdayCounts.get(day) ?? 0;
    if (count > 0 && count > (busiestWeekday === null ? 0 : weekdayCounts.get(busiestWeekday)!)) {
      busiestWeekday = day;
    }
  }
  let busiestHour: number | null = null;
  for (let h = 0; h < 24; h++) {
    const count = hourCounts.get(h) ?? 0;
    if (count > 0 && count > (busiestHour === null ? 0 : hourCounts.get(busiestHour)!)) {
      busiestHour = h;
    }
  }

  return { weekCount, monthCount, cancellationRate, busiestWeekday, busiestHour };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/features/scheduling/stats.test.ts`
Expected: PASS (all 11).

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/stats.ts src/features/scheduling/stats.test.ts
git commit -m "feat: pure overview-stats module (week/month counts, cancellation rate, busiest time)"
```

---

### Task 3: Read paths — stats query, directory query, client detail queries, type fix

**Files:**
- Modify: `src/features/scheduling/queries.ts` (add `listStatsBookings`; fix `BookingRow.client_email` type)
- Modify: `src/features/clients/queries.ts` (add `listClientsDirectory`, `listClientBookings`; extend `getClient`)
- Modify: `src/features/scheduling/booking-rpc.integration.test.ts` (pin the `bookings(count)` embed)

**Interfaces:**
- Consumes: `StatsBookingRow` from `./stats` (Task 2); Supabase server client per existing query files.
- Produces:
  - `listStatsBookings(fromIso: string): Promise<StatsBookingRow[]>` (scheduling)
  - `type ClientDirectoryRow = { id: string; name: string; email: string | null; bookingCount: number }` and `listClientsDirectory(): Promise<ClientDirectoryRow[]>` (clients)
  - `getClient(id: string): Promise<{ id: string; name: string; email: string | null; createdAt: string } | null>` (clients — extended return; sole caller is the detail page rewritten in Task 5)
  - `type ClientBookingRow = { id: string; serviceName: string; startsAt: string; endsAt: string; status: string; note: string | null }` and `listClientBookings(clientId: string): Promise<ClientBookingRow[]>` (clients)

- [ ] **Step 1: Add the embed-shape integration test (failing only if the embed idiom is wrong)**

Append to the `create_booking RPC` describe block in `src/features/scheduling/booking-rpc.integration.test.ts` (after the re-booking test — by then Jamie has ≥2 bookings; integration files run serially):

```ts
  it("member reads clients with an embedded booking count (directory query shape)", async () => {
    const { data, error } = await owner
      .from("clients")
      .select("id, name, email, bookings(count)")
      .order("name");
    expect(error).toBeNull();
    const jamie = (
      data as Array<{ email: string | null; bookings: { count: number }[] }>
    ).find((c) => c.email === "jamie@example.com");
    expect(jamie).toBeDefined();
    expect(jamie!.bookings[0].count).toBeGreaterThanOrEqual(2);
  });
```

Run: `npm run test:integration -- booking-rpc` — expected PASS (this pins current PostgREST behavior; if it FAILS, the directory query in Step 2 must change strategy — stop and reassess).

- [ ] **Step 2: Add `listStatsBookings` + fix the `client_email` type in `src/features/scheduling/queries.ts`**

Change `BookingRow.client_email` from `string` to `string | null` (walk-ins have no email; `AdminBooking.clientEmail` is already `string | null`).

Add at the end of the file:

```ts
import { type StatsBookingRow } from "./stats";
```
(place the import at the top with the existing imports), and:

```ts
// Overview tiles (S5): minimal columns, single 90-day starts_at window —
// see stats.ts for why that also covers the created_at-based tile.
export async function listStatsBookings(fromIso: string): Promise<StatsBookingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("starts_at, status, created_at")
    .gte("starts_at", fromIso);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: b.starts_at,
    status: b.status,
    createdAt: b.created_at,
  }));
}
```

- [ ] **Step 3: Add the directory + detail queries in `src/features/clients/queries.ts`**

Extend `getClient` (sole caller is the page Task 5 rewrites — verify with `grep -rn "getClient(" src` first):

```ts
export async function getClient(
  id: string,
): Promise<{ id: string; name: string; email: string | null; createdAt: string } | null> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data
    ? { id: data.id, name: data.name, email: data.email, createdAt: data.created_at }
    : null;
}
```

Add:

```ts
export type ClientDirectoryRow = {
  id: string;
  name: string;
  email: string | null;
  bookingCount: number;
};

// Scheduling directory (S5): embedded count rides member RLS on bookings.
export async function listClientsDirectory(): Promise<ClientDirectoryRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, bookings(count)")
    .order("name");
  if (error) throw error;
  type Row = {
    id: string;
    name: string;
    email: string | null;
    bookings: { count: number }[];
  };
  return ((data ?? []) as unknown as Row[]).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    bookingCount: c.bookings[0]?.count ?? 0,
  }));
}

export type ClientBookingRow = {
  id: string;
  serviceName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
};

export async function listClientBookings(clientId: string): Promise<ClientBookingRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, status, note, services(name)")
    .eq("client_id", clientId)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  type Row = {
    id: string;
    starts_at: string;
    ends_at: string;
    status: string;
    note: string | null;
    services: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((b) => ({
    id: b.id,
    serviceName: b.services?.name ?? "—",
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    status: b.status,
    note: b.note,
  }));
}
```

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: lint + typecheck + unit tests PASS. (The legacy `/clients/[id]` page still compiles against the extended `getClient` — it only reads `id`/`name`.)

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/queries.ts src/features/clients/queries.ts src/features/scheduling/booking-rpc.integration.test.ts
git commit -m "feat: S5 read paths — stats window, clients directory, client booking history"
```

---

### Task 4: Clients directory page

**Files:**
- Modify (rewrite): `src/app/(dashboard)/clients/page.tsx`

**Interfaces:**
- Consumes: `listClientsDirectory` (Task 3).
- Produces: `/clients` — the scheduling directory. Legacy components (`CreateClientDialog`) intentionally no longer referenced here (kept on disk; pivot rule).

- [ ] **Step 1: Rewrite the page**

Replace `src/app/(dashboard)/clients/page.tsx` entirely:

```tsx
import Link from "next/link";
import { listClientsDirectory } from "@/features/clients/queries";

export default async function ClientsPage() {
  const clients = await listClientsDirectory();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Clients</h1>
      {clients.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No clients yet — clients appear here after their first booking.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
              >
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                {c.email ? (
                  <span className="text-muted-foreground min-w-0 truncate text-xs">
                    {c.email}
                  </span>
                ) : null}
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {c.bookingCount} {c.bookingCount === 1 ? "booking" : "bookings"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/clients/page.tsx"
git commit -m "feat: scheduling clients directory at /clients"
```

---

### Task 5: Client detail page — history drill-in + rename

**Files:**
- Modify: `src/features/scheduling/templates.ts` (add exported `STATUS_LABEL`)
- Modify: `src/features/scheduling/components/bookings-list.tsx` (import `STATUS_LABEL` instead of its local copy)
- Modify: `src/features/clients/components/client-header.tsx` (delete-dialog copy only)
- Modify (rewrite): `src/app/(dashboard)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `getClient`, `listClientBookings` (Task 3); `ClientHeader` (existing, props `{ id, name }` — rename + delete already wired to existing actions); `formatWhenLine(date: Date, timeZone: string)` and the new `STATUS_LABEL` from `@/features/scheduling/templates`; `getSchedulingSettings` from `@/features/orgs/queries`.
- Produces: `/clients/[id]` scheduling detail page; `STATUS_LABEL: Record<string, string>` exported from `templates.ts` (server-safe module — do NOT export it from the `"use client"` `bookings-list.tsx`, a server page can't consume plain values from a client module).

- [ ] **Step 1: Move `STATUS_LABEL` into `templates.ts`**

Add to `src/features/scheduling/templates.ts` (top level, near `formatWhenLine`):

```ts
export const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled_by_client: "Cancelled by client",
  cancelled_by_provider: "Cancelled by you",
  rescheduled: "Rescheduled",
};
```

In `src/features/scheduling/components/bookings-list.tsx`, delete the local `STATUS_LABEL` const and extend the existing templates import:

```ts
import { formatWhenLine, STATUS_LABEL } from "@/features/scheduling/templates";
```

- [ ] **Step 2: Update the delete-dialog copy in `client-header.tsx`**

Replace the dialog body line
`Portal links are deleted; units keep their history but lose the client grouping.`
with:

```tsx
          <p className="text-muted-foreground text-sm">
            Bookings keep their history (name and email stay on each booking);
            the client entry itself is deleted.
          </p>
```

- [ ] **Step 3: Rewrite the detail page**

Replace `src/app/(dashboard)/clients/[id]/page.tsx` entirely:

```tsx
import { notFound } from "next/navigation";
import { getClient, listClientBookings } from "@/features/clients/queries";
import { ClientHeader } from "@/features/clients/components/client-header";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { formatWhenLine, STATUS_LABEL } from "@/features/scheduling/templates";
import { Badge } from "@/components/ui/badge";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  // Shape-guard before querying: a malformed id would surface as a Postgres
  // cast error (500), not the 404 it actually is.
  if (!UUID_RE.test(id)) notFound();
  const [client, bookings, settings] = await Promise.all([
    getClient(id),
    listClientBookings(id),
    getSchedulingSettings(),
  ]);
  // RLS returns nothing for foreign orgs' clients — the 404 we want.
  if (!client) notFound();
  const timeZone = settings?.timezone ?? "UTC";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <ClientHeader id={client.id} name={client.name} />
        <p className="text-muted-foreground px-3 text-sm">
          {client.email ?? "No email on file"}
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Bookings ({bookings.length})</h2>
        {bookings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No bookings yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{b.serviceName}</p>
                  <Badge variant="secondary">{STATUS_LABEL[b.status] ?? b.status}</Badge>
                </div>
                <p>{formatWhenLine(new Date(b.startsAt), timeZone)}</p>
                {b.note ? <p className="text-muted-foreground">“{b.note}”</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
```

(If `ClientHeader`'s Input padding makes the `px-3` on the email line misalign, match visually and adjust — the intent is email directly under the name.)

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: PASS. Check specifically that `bookings-list.tsx` still typechecks with the imported `STATUS_LABEL`.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/templates.ts src/features/scheduling/components/bookings-list.tsx src/features/clients/components/client-header.tsx "src/app/(dashboard)/clients/[id]/page.tsx"
git commit -m "feat: client detail page — booking history, rename, scheduling delete copy"
```

---

### Task 6: Overview page, stat tiles, nav

**Files:**
- Create: `src/features/scheduling/components/stat-tiles.tsx`
- Create: `src/app/(dashboard)/overview/page.tsx`
- Modify: `src/components/shell/nav.ts`

**Interfaces:**
- Consumes: `computeOverviewStats`, `OverviewStats` (Task 2); `listStatsBookings` (Task 3); `getSchedulingSettings` from `@/features/orgs/queries`.
- Produces: `/overview` page; `StatTile({ label, value, caption }: { label: string; value: string; caption?: string })`. The command menu iterates `NAV_ITEMS`, so nav additions propagate there automatically.

- [ ] **Step 1: Stat tile component**

Create `src/features/scheduling/components/stat-tiles.tsx` (server component — no `"use client"`). Dataviz stat-tile contract: sentence-case label, semibold value, proportional figures (no `tabular-nums` at display size), muted caption naming the window:

```tsx
export function StatTile({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="mt-1 text-2xl font-semibold">{value}</span>
      {caption ? <span className="text-muted-foreground mt-0.5 text-xs">{caption}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: Overview page**

Create `src/app/(dashboard)/overview/page.tsx`:

```tsx
import { listStatsBookings } from "@/features/scheduling/queries";
import { computeOverviewStats } from "@/features/scheduling/stats";
import { StatTile } from "@/features/scheduling/components/stat-tiles";
import { getSchedulingSettings } from "@/features/orgs/queries";

const DAY_MS = 86_400_000;

export default async function OverviewPage() {
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";
  const now = new Date();
  const rows = await listStatsBookings(new Date(now.getTime() - 90 * DAY_MS).toISOString());
  const stats = computeOverviewStats(rows, now, timeZone);

  const rate =
    stats.cancellationRate === null
      ? "—"
      : `${Math.round(stats.cancellationRate * 100)}%`;
  const busiest =
    stats.busiestWeekday === null || stats.busiestHour === null
      ? "—"
      : `${stats.busiestWeekday} · ${String(stats.busiestHour).padStart(2, "0")}:00`;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Overview</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="This week" value={String(stats.weekCount)} caption="confirmed bookings" />
        <StatTile label="This month" value={String(stats.monthCount)} caption="confirmed bookings" />
        <StatTile label="Cancellation rate" value={rate} caption="last 30 days" />
        <StatTile label="Busiest time" value={busiest} caption="last 90 days" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Nav**

Replace `src/components/shell/nav.ts`:

```ts
import {
  Briefcase,
  CalendarClock,
  CalendarDays,
  LayoutDashboard,
  Settings2,
  Users,
} from "lucide-react";

// Post-pivot nav (S5): Overview leads; Bookings stays the post-login surface
// (S2 user ruling). The command menu derives from this list.
export const NAV_ITEMS = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/bookings", label: "Bookings", icon: CalendarDays },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/services", label: "Services", icon: Briefcase },
  { href: "/availability", label: "Availability", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;
```

- [ ] **Step 4: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/components/stat-tiles.tsx "src/app/(dashboard)/overview/page.tsx" src/components/shell/nav.ts
git commit -m "feat: /overview stat tiles + nav (Overview, Clients)"
```

---

### Task 7: Onboarding redirect fold-in

**Files:**
- Modify: `src/features/orgs/actions.ts` (line ~39: `redirect("/programs")`)
- Modify: `src/app/onboarding/page.tsx` (line ~8 redirect + line ~17 copy)

**Interfaces:**
- Consumes/Produces: nothing new — post-signup lands on `/bookings` like post-login (fixed in S2's final wave; this closes the remaining `/programs` stragglers, which hit every new signup).

- [ ] **Step 1: Fix both redirects and the copy**

In `src/features/orgs/actions.ts`, change `redirect("/programs")` → `redirect("/bookings")`.

In `src/app/onboarding/page.tsx`:
- `if (org) redirect("/programs"); // already onboarded` → `if (org) redirect("/bookings"); // already onboarded`
- `This is your workspace for programs, units, and your team.` → `This is your workspace for services, availability, and bookings.`

- [ ] **Step 2: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/orgs/actions.ts src/app/onboarding/page.tsx
git commit -m "fix: onboarding lands on /bookings, not legacy /programs"
```

---

### Task 8: Final verification

**Files:** none new.

- [ ] **Step 1: Full suites**

Run: `npm run verify` and `npm run test:integration`
Expected: both PASS (integration needs the local Supabase stack with 0034 applied).

- [ ] **Step 2: Manual smoke via dev server**

Run the app (`npm run dev`) and confirm: `/overview` renders four tiles (seeded org shows counts or "—", never a crash); `/clients` lists seeded clients with counts; drill-in shows history + rename works; `/clients/not-a-uuid` 404s; sidebar + ⌘K menu show Overview and Clients.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Self-review against the spec, then PR**

Re-read the spec's Decisions/Fold-ins; confirm each maps to a landed commit. Push and open the PR:

```bash
git push -u origin scheduling-s5
gh pr create --title "feat: scheduling — slice S5 (clients directory, overview stats, client-name hardening)" --body "..."
```

PR body summarizes: 0034 name preservation, directory + history + rename, /overview tiles, nav, onboarding-redirect fold-in, `client_email` type fix. End the body with the repo's generated-with line.
