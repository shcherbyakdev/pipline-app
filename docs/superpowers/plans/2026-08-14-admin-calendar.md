# Admin Week Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/bookings` list with a week-view calendar (view/manage bookings, admin walk-in creation, block time) per spec `docs/superpowers/specs/2026-08-14-admin-calendar-design.md`.

**Architecture:** Custom CSS-grid week view (no calendar library). Server page fetches per week via `?week=` URL param; pure helper modules (`day-windows.ts`, `calendar-geometry.ts`) carry the testable math; a new `create_booking_admin` definer RPC (relaxed validation, EXCLUDE-guarded) and a `blockTimeRange` action carry the writes.

**Tech Stack:** Next.js (READ `node_modules/next/dist/docs/` before touching app-router files — this Next has breaking changes), Supabase (RLS + definer RPCs in custom SQL migrations), Drizzle migrations, Vitest (`npm run test`, `npm run test:integration` — the latter needs the local Supabase stack, ports +30, see memory), Tailwind + existing `src/components/ui/*` primitives, sonner toasts.

## Global Constraints

- Branch: create `scheduling-calendar` off current `scheduling-s2` HEAD (S2 is unmerged PR #23; this work builds on it).
- Times are org-local wall-clock `"HH:MM"` strings; weekday `0=Sunday` (JS `getUTCDay`); all stored instants UTC (`slots.ts` conventions).
- Every new-table-or-column migration follows the repo grants convention; RPCs live in custom SQL migrations (0026/0028 idiom): `security definer`, `set search_path = ''`, `revoke all` then explicit `grant execute`.
- Honest toasts: success copy never claims an email was sent unless it was (S2 rule).
- Server actions: zod `safeParse` on `unknown` input, `GENERIC_WRITE_ERROR` on validation/infra failure, `fail(context, error)` logging idiom, `revalidatePath` after writes (see `booking-actions.ts`).
- Run `npm run verify` (lint + typecheck + unit tests) before every commit. Integration tests: `npm run test:integration`.
- **Spec deviation (recorded):** spec names Playwright e2e; the repo has no Playwright harness. Coverage is instead: integration tests on the RPC + the existing pg-backed suite, unit tests on the pure math, and a manual dev-server check for the UI. Do not introduce Playwright in this slice.
- After the final task: `graphify update .`

---

### Task 1: DB — nullable `client_email` + `create_booking_admin` RPC

**Files:**
- Modify: `src/db/schema/scheduling.ts` (bookings.clientEmail — drop `.notNull()`)
- Create: `src/db/migrations/0029_*.sql` (generated), `src/db/migrations/0030_admin_booking_security.sql` (custom)
- Test: `src/features/scheduling/admin-booking-rpc.integration.test.ts`

**Interfaces:**
- Produces RPC `create_booking_admin(p_service_id uuid, p_starts_at timestamptz, p_name text, p_email text, p_note text, p_token_hash text) returns uuid` — grant `authenticated` only. Relaxed: NO `slot_within_availability`, NO min-notice, NO throttle; past starts allowed up to 24h back, future capped at 365 days. Overlap surfaces as SQLSTATE `23P01` from the EXCLUDE guard.
- `bookings.client_email` becomes nullable. Existing `bookings_client_email_check` (length 3–320) passes on NULL automatically — leave it.

- [ ] **Step 1: Branch**

```bash
git checkout -b scheduling-calendar
```

- [ ] **Step 2: Write the failing integration test**

Create `src/features/scheduling/admin-booking-rpc.integration.test.ts`. Copy the header block (env loading, `admin`/`anon` clients, `signedInUser`) and the `beforeAll` scaffolding verbatim from `lifecycle-rpc.integration.test.ts` (create owner + stranger users, `create_org`, `update_org_scheduling` with a unique handle like `` `adm-cal-${Date.now()}` ``, one 60-min service, rules 09:00–17:00 all weekdays). Then:

```typescript
async function adminBook(
  client: SupabaseClient,
  startsAt: string,
  email: string | null,
  serviceOverride?: string,
) {
  const { tokenHash } = generateAccessToken();
  return client.rpc("create_booking_admin", {
    p_service_id: serviceOverride ?? serviceId,
    p_starts_at: startsAt,
    p_name: "Walk-in Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
  });
}

describe("create_booking_admin", () => {
  it("creates outside open hours (relaxed) and computes ends_at from duration", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T03:00:00Z", "night@example.com");
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("starts_at, ends_at, client_email").eq("id", data as string).single();
    expect(new Date(row!.ends_at).getTime() - new Date(row!.starts_at).getTime()).toBe(60 * 60 * 1000);
    expect(row!.client_email).toBe("night@example.com");
  });

  it("creates without email: client_email and client_id are null", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T05:00:00Z", null);
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("client_email, client_id").eq("id", data as string).single();
    expect(row!.client_email).toBeNull();
    expect(row!.client_id).toBeNull();
  });

  it("with email, upserts the client like create_booking", async () => {
    const { data, error } = await adminBook(owner, "2027-05-03T07:00:00Z", "repeat@example.com");
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings").select("client_id").eq("id", data as string).single();
    expect(row!.client_id).not.toBeNull();
  });

  it("rejects a true overlap via the EXCLUDE guard (23P01)", async () => {
    const first = await adminBook(owner, "2027-05-04T10:00:00Z", null);
    expect(first.error).toBeNull();
    const second = await adminBook(owner, "2027-05-04T10:30:00Z", null);
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23P01");
  });

  it("rejects starts more than 24h in the past and beyond 365 days", async () => {
    const past = await adminBook(owner, "2020-01-01T10:00:00Z", null);
    expect(past.error!.message).toContain("not found");
    const far = await adminBook(owner, "2100-01-01T10:00:00Z", null);
    expect(far.error!.message).toContain("not found");
  });

  it("rejects a non-member (stranger) and anon", async () => {
    const strangerRes = await adminBook(stranger, "2027-05-05T10:00:00Z", null);
    expect(strangerRes.error).not.toBeNull();
    const anonRes = await adminBook(anon as unknown as SupabaseClient, "2027-05-05T11:00:00Z", null);
    expect(anonRes.error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** with `function public.create_booking_admin ... does not exist`:

```bash
npm run test:integration -- admin-booking-rpc
```

- [ ] **Step 4: Make `client_email` nullable**

In `src/db/schema/scheduling.ts` change:

```typescript
    clientEmail: text("client_email"),
```

(drop `.notNull()`; keep the comment above it, append: `// nullable since admin walk-ins (calendar slice)`). Then:

```bash
npm run db:generate
```

Inspect the generated `0029_*.sql` — it must contain only `ALTER TABLE "bookings" ALTER COLUMN "client_email" DROP NOT NULL;`.

- [ ] **Step 5: Write the custom RPC migration**

```bash
npx drizzle-kit generate --custom --name=admin_booking_security
```

Fill `src/db/migrations/0030_admin_booking_security.sql`:

```sql
-- Custom SQL migration file, put your code below! --

-- Admin walk-in creation (calendar slice). DELIBERATELY relaxed versus
-- create_booking: no availability containment, no min-notice, no throttle
-- (authenticated member only), past grace 24h (recording an appointment
-- that already started). The EXCLUDE guard remains the overlap authority;
-- callers map 23P01. Membership check via user_orgs (0028 admin idiom).
create or replace function public.create_booking_admin(
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
  v_service record;
  v_ends_at timestamptz;
  v_client_id uuid;
  v_booking_id uuid;
begin
  select s.id, s.org_id, s.duration_min into v_service
    from public.services s
    where s.id = p_service_id
      and s.org_id in (select public.user_orgs())
      and s.active;
  if v_service.id is null then raise exception 'not found'; end if;

  if p_starts_at is null
     or p_starts_at < now() - interval '24 hours'
     or p_starts_at > now() + interval '365 days' then
    raise exception 'not found';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'not found';
  end if;
  if p_email is not null and (
       length(p_email) > 320
       or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     ) then
    raise exception 'not found';
  end if;
  if p_note is not null and length(p_note) > 2000 then
    raise exception 'not found';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'not found';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_min);

  if p_email is not null then
    insert into public.clients (org_id, name, email)
    values (v_service.org_id, btrim(p_name), lower(p_email))
    on conflict (org_id, lower(email)) where email is not null
    do update set name = excluded.name
    returning id into v_client_id;
  end if;

  insert into public.bookings
    (org_id, service_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note)
  values
    (v_service.org_id, p_service_id, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends_at, 'confirmed', p_token_hash, p_note)
  returning id into v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_booking_admin(uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_booking_admin(uuid, timestamptz, text, text, text, text)
  to authenticated;
```

(`lower(NULL)` is NULL, so the single insert handles both email cases.)

- [ ] **Step 6: Migrate and re-run the test — expect PASS**

```bash
npm run db:migrate
npm run test:integration -- admin-booking-rpc
```

- [ ] **Step 7: Full verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — create_booking_admin RPC, nullable client_email"
```

---

### Task 2: Emailless bookings — drain suppression, admin action guards, display

**Files:**
- Modify: `src/features/scheduling/reminders.ts` (CandidateRow.client_email → `string | null`; skip send)
- Modify: `src/features/scheduling/queries.ts` (`AdminBooking.clientEmail` → `string | null`)
- Modify: `src/features/scheduling/booking-actions.ts` (cancel/reschedule email guards)
- Modify: `src/features/scheduling/components/bookings-list.tsx` (conditional email display + no-email toast)
- Modify: `src/features/scheduling/components/booking-reschedule-dialog.tsx` (no-email toast, same pattern)
- Test: extend `src/features/scheduling/reminder-drain.integration.test.ts`

**Interfaces:**
- Consumes: nullable `client_email` (Task 1).
- Produces: `cancelBookingAdmin` / `rescheduleBookingAdmin` return `{ ok: true; emailed: boolean; noEmail?: boolean }` — `noEmail: true` means no address on file (skip, not failure). Later tasks reuse these results.

- [ ] **Step 1: Write the failing drain test** — in `reminder-drain.integration.test.ts`, add this case, reusing the file's existing org/service fixture variables and its fake/recording transport helper (read the file first; adapt the insert to its established booking-insert idiom, including a valid `cancel_token_hash`):

```typescript
it("stamps emailless bookings as suppressed without sending", async () => {
  const startsAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { data: inserted, error } = await admin
    .from("bookings")
    .insert({
      org_id: orgId,
      service_id: serviceId,
      client_name: "Walk-in",
      client_email: null,
      starts_at: startsAt,
      ends_at: new Date(Date.parse(startsAt) + 60 * 60 * 1000).toISOString(),
      status: "confirmed",
      cancel_token_hash: generateAccessToken().tokenHash,
    })
    .select("id")
    .single();
  expect(error).toBeNull();

  const sends: string[] = [];
  const summary = await runReminderDrain({
    db: admin,
    transport: { send: async (m) => { sends.push(m.to); } },
  });

  expect(summary.failed).toBe(0);
  expect(sends).not.toContain(null);
  const { data: row } = await admin
    .from("bookings")
    .select("reminder_sent_at, reminder_attempts")
    .eq("id", inserted!.id)
    .single();
  expect(row!.reminder_sent_at).not.toBeNull(); // stamped = suppressed, never rescanned
  expect(row!.reminder_attempts).toBe(0);
});
```

- [ ] **Step 2: Run — expect FAIL** (currently it would try to send to `null` and count `failed`):

```bash
npm run test:integration -- reminder-drain
```

- [ ] **Step 3: Implement the skip.** In `reminders.ts`: `CandidateRow.client_email: string | null;` and after the suppress check (line ~85), change to:

```typescript
      if (decision === "suppress" || !row.client_email) {
        summary.skipped += 1; // stamped, never rescanned (suppressed or no address)
        continue;
      }
```

- [ ] **Step 4: Guard the lifecycle emails.** In `booking-actions.ts` both actions: widen the return type with `noEmail?: boolean`; wrap the email block:

```typescript
    let emailed = false;
    let noEmail = false;
    if (!row.client_email) {
      noEmail = true;
    } else {
      emailed = true;
      try { /* existing send block unchanged */ } catch (mailError) { /* existing */ emailed = false; }
    }
    revalidatePath("/bookings");
    return { ok: true, emailed, noEmail };
```

(Same shape in `rescheduleBookingAdmin` with `booking.client_email`.) In `queries.ts` set `clientEmail: string | null` on `AdminBooking` (the mapper needs no change). In `bookings-list.tsx`: render `{booking.clientEmail ? \` · ${booking.clientEmail}\` : ""}` and extend the toast chain: `else if (result.noEmail) toast.success("Booking cancelled — no email on file for this client.")` before the emailed branches. Mirror the same three-way toast in `booking-reschedule-dialog.tsx`'s success handler.

- [ ] **Step 5: Run tests — expect PASS**

```bash
npm run test:integration -- reminder-drain && npm run verify
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: calendar — emailless bookings: drain suppression, honest no-email toasts"
```

---

### Task 3: `day-windows.ts` — pure window math

**Files:**
- Create: `src/features/scheduling/day-windows.ts`
- Test: `src/features/scheduling/day-windows.test.ts`

**Interfaces (produces):**

```typescript
export type DayWindow = { startTime: string; endTime: string }; // "HH:MM", start < end
export function effectiveWindows(
  date: string, // "YYYY-MM-DD"
  rules: Array<{ weekday: number; startTime: string; endTime: string }>,
  exceptions: Array<{ date: string; closed: boolean; startTime: string | null; endTime: string | null }>,
): DayWindow[];
export function subtractRange(windows: DayWindow[], start: string, end: string): DayWindow[];
```

Semantics (mirrors `slots.ts` lines 99–113 exactly — closed kills the day, open exceptions REPLACE rules, else weekday rules): `effectiveWindows` returns sorted windows. `subtractRange` removes `[start,end)` from each window; fragments shorter than 5 minutes are dropped (spec: no degenerate windows). String comparison is safe on `"HH:MM"`.

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { effectiveWindows, subtractRange } from "./day-windows";

const RULES = [
  { weekday: 2, startTime: "09:00", endTime: "12:00" },
  { weekday: 2, startTime: "13:00", endTime: "17:00" },
];
// 2027-05-04 is a Tuesday (weekday 2)
const D = "2027-05-04";

describe("effectiveWindows", () => {
  it("uses weekday rules when no exceptions, sorted", () => {
    expect(effectiveWindows(D, RULES, [])).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "13:00", endTime: "17:00" },
    ]);
  });
  it("closed exception empties the day", () => {
    expect(effectiveWindows(D, RULES, [{ date: D, closed: true, startTime: null, endTime: null }])).toEqual([]);
  });
  it("open exceptions replace the rules", () => {
    expect(
      effectiveWindows(D, RULES, [{ date: D, closed: false, startTime: "10:00", endTime: "14:00" }]),
    ).toEqual([{ startTime: "10:00", endTime: "14:00" }]);
  });
  it("ignores exceptions for other dates", () => {
    expect(effectiveWindows(D, RULES, [{ date: "2027-05-05", closed: true, startTime: null, endTime: null }]))
      .toHaveLength(2);
  });
});

describe("subtractRange", () => {
  const W = [{ startTime: "09:00", endTime: "17:00" }];
  it("splits a window on an interior range", () => {
    expect(subtractRange(W, "12:00", "13:00")).toEqual([
      { startTime: "09:00", endTime: "12:00" },
      { startTime: "13:00", endTime: "17:00" },
    ]);
  });
  it("trims edge overlaps", () => {
    expect(subtractRange(W, "08:00", "10:00")).toEqual([{ startTime: "10:00", endTime: "17:00" }]);
    expect(subtractRange(W, "16:00", "18:00")).toEqual([{ startTime: "09:00", endTime: "16:00" }]);
  });
  it("drops a fully covered window", () => {
    expect(subtractRange(W, "08:00", "18:00")).toEqual([]);
  });
  it("keeps disjoint windows untouched", () => {
    expect(subtractRange(W, "18:00", "19:00")).toEqual(W);
  });
  it("drops fragments shorter than 5 minutes", () => {
    expect(subtractRange(W, "09:03", "16:57")).toEqual([]);
  });
  it("handles multiple windows", () => {
    expect(
      subtractRange(
        [{ startTime: "09:00", endTime: "12:00" }, { startTime: "13:00", endTime: "17:00" }],
        "11:00", "14:00",
      ),
    ).toEqual([{ startTime: "09:00", endTime: "11:00" }, { startTime: "14:00", endTime: "17:00" }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './day-windows'`): `npm run test -- day-windows`

- [ ] **Step 3: Implement**

```typescript
// Pure day-window math for the admin calendar. Mirrors the slot engine's
// COARSE semantics (slots.ts): closed exception kills the day; open
// exceptions REPLACE the weekday rules; otherwise the rules apply.

export type DayWindow = { startTime: string; endTime: string };

const MIN_FRAGMENT_MIN = 5;

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// The org-local date's weekday is a property of the date itself (slots.ts idiom).
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function effectiveWindows(
  date: string,
  rules: Array<{ weekday: number; startTime: string; endTime: string }>,
  exceptions: Array<{ date: string; closed: boolean; startTime: string | null; endTime: string | null }>,
): DayWindow[] {
  const dayExceptions = exceptions.filter((e) => e.date === date);
  if (dayExceptions.some((e) => e.closed)) return [];
  const overrides = dayExceptions.filter((e) => !e.closed);
  const windows =
    overrides.length > 0
      ? overrides.map((e) => ({ startTime: e.startTime!, endTime: e.endTime! }))
      : rules
          .filter((r) => r.weekday === weekdayOf(date))
          .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
  return windows.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function subtractRange(windows: DayWindow[], start: string, end: string): DayWindow[] {
  const out: DayWindow[] = [];
  for (const w of windows) {
    if (end <= w.startTime || start >= w.endTime) {
      out.push(w);
      continue;
    }
    if (start > w.startTime && toMin(start) - toMin(w.startTime) >= MIN_FRAGMENT_MIN) {
      out.push({ startTime: w.startTime, endTime: start });
    }
    if (end < w.endTime && toMin(w.endTime) - toMin(end) >= MIN_FRAGMENT_MIN) {
      out.push({ startTime: end, endTime: w.endTime });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS**: `npm run test -- day-windows`

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/day-windows.ts src/features/scheduling/day-windows.test.ts
git commit -m "feat: calendar — pure day-window math (effective windows, range subtraction)"
```

---

### Task 4: `blockTimeRange` + `reopenDay` server actions

**Files:**
- Modify: `src/features/scheduling/schema.ts` (inputs)
- Modify: `src/features/scheduling/actions.ts` (two actions, availability section)

**Interfaces:**
- Consumes: `effectiveWindows`, `subtractRange` (Task 3); `currentOrgId`, `fail`, `ActionState` already in `actions.ts`.
- Produces: `blockTimeRange(input: unknown): Promise<ActionState>` and `reopenDay(input: unknown): Promise<ActionState>` for Task 10's UI.

- [ ] **Step 1: Add zod inputs** to `schema.ts` (below `exceptionIdInput`):

```typescript
export const blockTimeInput = z
  .object({
    date: z.string().regex(DATE_RE),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });

export const reopenDayInput = z.object({ date: z.string().regex(DATE_RE) });
```

- [ ] **Step 2: Implement the actions** in `actions.ts` (after `deleteAvailabilityException`; import `blockTimeInput`, `reopenDayInput` from `./schema` and `effectiveWindows`, `subtractRange` from `./day-windows`):

```typescript
// Block [startTime,endTime) on one date: rewrite that date's exceptions to
// (effective windows − range). Empty result ⇒ a single closed row. The day's
// prior exceptions are consumed (they fed effectiveWindows). Sequential
// calls, like the sibling availability actions — solo-admin orgs make the
// non-atomic window negligible (spec).
export async function blockTimeRange(input: unknown): Promise<ActionState> {
  const parsed = blockTimeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { date, startTime, endTime } = parsed.data;

  const [rulesRes, exceptionsRes] = await Promise.all([
    supabase.from("availability_rules").select("weekday, start_time, end_time").eq("org_id", orgId),
    supabase.from("availability_exceptions").select("date, closed, start_time, end_time")
      .eq("org_id", orgId).eq("date", date),
  ]);
  if (rulesRes.error) return fail("blockTimeRange", rulesRes.error);
  if (exceptionsRes.error) return fail("blockTimeRange", exceptionsRes.error);

  const windows = effectiveWindows(
    date,
    (rulesRes.data ?? []).map((r) => ({ weekday: r.weekday, startTime: r.start_time, endTime: r.end_time })),
    (exceptionsRes.data ?? []).map((e) => ({
      date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
    })),
  );
  if (windows.length === 0) return { ok: true }; // already fully closed — no-op

  const remaining = subtractRange(windows, startTime, endTime);

  const { error: delError } = await supabase
    .from("availability_exceptions").delete().eq("org_id", orgId).eq("date", date);
  if (delError) return fail("blockTimeRange", delError);

  const rows =
    remaining.length === 0
      ? [{ org_id: orgId, date, closed: true, start_time: null, end_time: null }]
      : remaining.map((w) => ({
          org_id: orgId, date, closed: false, start_time: w.startTime, end_time: w.endTime,
        }));
  const { error: insError } = await supabase.from("availability_exceptions").insert(rows);
  if (insError) return fail("blockTimeRange", insError);

  revalidatePath("/bookings");
  revalidatePath("/availability");
  return { ok: true };
}

// Delete a date's exceptions, restoring the weekly rules (spec: "Reopen day").
export async function reopenDay(input: unknown): Promise<ActionState> {
  const parsed = reopenDayInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions").delete().eq("org_id", orgId).eq("date", parsed.data.date);
  if (error) return fail("reopenDay", error);
  revalidatePath("/bookings");
  revalidatePath("/availability");
  return { ok: true };
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — blockTimeRange and reopenDay actions"
```

---

### Task 5: `createBookingAdmin` server action

**Files:**
- Modify: `src/features/scheduling/schema.ts`
- Modify: `src/features/scheduling/booking-actions.ts`

**Interfaces:**
- Consumes: RPC `create_booking_admin` (Task 1); `bookingConfirmationEmail`, `bookingIdempotencyKey`, `formatWhenLine` from `./templates`; `generateAccessToken`, `buildBookingManageUrl`, `selectTransport`, `env` (already imported in the file or by sibling `public-actions.ts`).
- Produces: `createBookingAdmin(input: unknown): Promise<{ ok: true; emailed: "sent" | "failed" | "none" } | { ok: false; error: string; overlap?: boolean }>` for Task 10's dialog.

- [ ] **Step 1: Add the zod input** to `schema.ts`:

```typescript
export const adminCreateBookingInput = z.object({
  serviceId: z.uuid(),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(200),
  // "" (untouched optional field) → undefined, mirroring the handle preprocess.
  email: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.email().max(320).optional(),
  ),
  note: z.string().trim().max(2000).optional(),
});
```

- [ ] **Step 2: Implement the action** in `booking-actions.ts` (import `adminCreateBookingInput`, plus `bookingConfirmationEmail`, `bookingIdempotencyKey` from `./templates`):

```typescript
const OVERLAP = "That time overlaps an existing booking.";

export async function createBookingAdmin(
  input: unknown,
): Promise<{ ok: true; emailed: "sent" | "failed" | "none" } | { ok: false; error: string; overlap?: boolean }> {
  const parsed = adminCreateBookingInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  try {
    const org = await currentOrg();
    if (!org) return { ok: false, error: GENERIC_WRITE_ERROR };
    const supabase = await createClient();
    const { token, tokenHash } = generateAccessToken();
    const { data: bookingId, error } = await supabase.rpc("create_booking_admin", {
      p_service_id: parsed.data.serviceId,
      p_starts_at: parsed.data.startsAt,
      p_name: parsed.data.name,
      p_email: parsed.data.email ?? null,
      p_note: parsed.data.note ?? null,
      p_token_hash: tokenHash,
    });
    if (error) {
      if (error.code === "23P01") return { ok: false, error: OVERLAP, overlap: true };
      return fail("createBookingAdmin", error);
    }

    let emailed: "sent" | "failed" | "none" = "none";
    if (parsed.data.email) {
      const { data: svc } = await supabase
        .from("services").select("name").eq("id", parsed.data.serviceId).maybeSingle();
      try {
        const msg = bookingConfirmationEmail({
          orgName: org.name,
          serviceName: svc?.name ?? "Appointment",
          whenLine: formatWhenLine(new Date(parsed.data.startsAt), org.timezone),
          manageUrl: buildBookingManageUrl(token),
          icsUrl: `${env.NEXT_PUBLIC_APP_URL}/booking/${token}/calendar.ics`,
        });
        await selectTransport().send({
          to: parsed.data.email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingIdempotencyKey(bookingId as string),
        });
        emailed = "sent";
      } catch (mailError) {
        console.error("[scheduling] admin create email failed:", mailError);
        emailed = "failed";
      }
    }

    revalidatePath("/bookings");
    return { ok: true, emailed };
  } catch (error) {
    return fail("createBookingAdmin", error);
  }
}
```

- [ ] **Step 3: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — createBookingAdmin action (walk-ins, conditional email)"
```

---

### Task 6: `calendar-geometry.ts` — pure layout math

**Files:**
- Create: `src/features/scheduling/calendar-geometry.ts`
- Test: `src/features/scheduling/calendar-geometry.test.ts`

**Interfaces (produces — Task 8/10 consume exactly these):**

```typescript
export function timeToMin(t: string): number;                       // "09:30" → 570
export function minToTime(min: number): string;                     // 570 → "09:30"
export function zonedParts(instant: Date, timeZone: string): { date: string; minutes: number };
export function mondayOf(date: string): string;                     // "YYYY-MM-DD" → its Monday
export function hourRange(windowsByDay: DayWindow[][]): { startHour: number; endHour: number };
export function snap15(min: number): number;                        // floor to 15-min step
export function closedIntervals(windows: DayWindow[], startHour: number, endHour: number): Array<{ startMin: number; endMin: number }>;
export function serviceAccent(serviceId: string): string;           // stable hsl() string
```

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import {
  timeToMin, minToTime, zonedParts, mondayOf, hourRange, snap15,
  closedIntervals, serviceAccent,
} from "./calendar-geometry";

describe("calendar-geometry", () => {
  it("timeToMin/minToTime round-trip", () => {
    expect(timeToMin("09:30")).toBe(570);
    expect(minToTime(570)).toBe("09:30");
    expect(minToTime(65)).toBe("01:05");
  });

  it("zonedParts gives local date and minutes-since-midnight", () => {
    const p = zonedParts(new Date("2027-05-04T12:30:00Z"), "Europe/Berlin"); // UTC+2 in May
    expect(p).toEqual({ date: "2027-05-04", minutes: 14 * 60 + 30 });
  });

  it("mondayOf returns the Monday of the date's week", () => {
    expect(mondayOf("2027-05-06")).toBe("2027-05-03"); // Thu → Mon
    expect(mondayOf("2027-05-03")).toBe("2027-05-03"); // Mon → itself
    expect(mondayOf("2027-05-09")).toBe("2027-05-03"); // Sun → preceding Mon
  });

  it("hourRange pads the union by 1h and clamps", () => {
    expect(hourRange([[{ startTime: "09:00", endTime: "17:00" }], []]))
      .toEqual({ startHour: 8, endHour: 18 });
    expect(hourRange([[{ startTime: "00:30", endTime: "23:45" }]]))
      .toEqual({ startHour: 0, endHour: 24 });
  });

  it("hourRange falls back to 8–18 when nothing is open", () => {
    expect(hourRange([[], []])).toEqual({ startHour: 8, endHour: 18 });
  });

  it("snap15 floors to the grid", () => {
    expect(snap15(547)).toBe(540);
    expect(snap15(540)).toBe(540);
  });

  it("closedIntervals is the complement of windows within the range", () => {
    expect(closedIntervals([{ startTime: "09:00", endTime: "12:00" }], 8, 14)).toEqual([
      { startMin: 480, endMin: 540 },
      { startMin: 720, endMin: 840 },
    ]);
    expect(closedIntervals([], 8, 10)).toEqual([{ startMin: 480, endMin: 600 }]);
  });

  it("serviceAccent is stable and hsl-formatted", () => {
    const a = serviceAccent("3f8b1c2e-0000-4000-8000-000000000001");
    expect(a).toBe(serviceAccent("3f8b1c2e-0000-4000-8000-000000000001"));
    expect(a).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**: `npm run test -- calendar-geometry`

- [ ] **Step 3: Implement**

```typescript
// Pure geometry/formatting for the admin week calendar. No DOM, no clock
// reads — everything injected, like slots.ts.
import type { DayWindow } from "./day-windows";

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// What org-local date + minutes-since-midnight does `instant` land on?
// (Intl formatToParts idiom from slots.ts.)
export function zonedParts(instant: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function mondayOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun
  const back = (wd + 6) % 7; // Mon→0 … Sun→6
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d) - back * 86_400_000).toISOString().slice(0, 10);
}

export function hourRange(windowsByDay: DayWindow[][]): { startHour: number; endHour: number } {
  const all = windowsByDay.flat();
  if (all.length === 0) return { startHour: 8, endHour: 18 };
  const min = Math.min(...all.map((w) => timeToMin(w.startTime)));
  const max = Math.max(...all.map((w) => timeToMin(w.endTime)));
  return {
    startHour: Math.max(0, Math.floor(min / 60) - 1),
    endHour: Math.min(24, Math.ceil(max / 60) + 1),
  };
}

export function snap15(min: number): number {
  return Math.floor(min / 15) * 15;
}

export function closedIntervals(
  windows: DayWindow[],
  startHour: number,
  endHour: number,
): Array<{ startMin: number; endMin: number }> {
  const out: Array<{ startMin: number; endMin: number }> = [];
  let cursor = startHour * 60;
  const end = endHour * 60;
  for (const w of windows) {
    const ws = timeToMin(w.startTime);
    const we = timeToMin(w.endTime);
    if (ws > cursor) out.push({ startMin: cursor, endMin: Math.min(ws, end) });
    cursor = Math.max(cursor, we);
  }
  if (cursor < end) out.push({ startMin: cursor, endMin: end });
  return out.filter((i) => i.startMin < i.endMin);
}

// Stable accent per service — golden-angle hue walk over a hash, avoiding
// a color-settings surface (spec).
export function serviceAccent(serviceId: string): string {
  let h = 0;
  for (let i = 0; i < serviceId.length; i++) h = (h * 31 + serviceId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 55%)`;
}
```

- [ ] **Step 4: Run — expect PASS**: `npm run test -- calendar-geometry`

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/calendar-geometry.ts src/features/scheduling/calendar-geometry.test.ts
git commit -m "feat: calendar — pure grid geometry helpers"
```

---

### Task 7: Week-scoped queries

**Files:**
- Modify: `src/features/scheduling/queries.ts`

**Interfaces:**
- Produces (Task 8 consumes):

```typescript
export async function listConfirmedBookingsBetween(fromIso: string, toIso: string): Promise<AdminBooking[]>;
export async function listExceptionsBetween(fromDate: string, toDate: string): Promise<ExceptionRow[]>; // dates inclusive
```

- [ ] **Step 1: Implement** (append to `queries.ts`, reusing `BOOKING_COLUMNS`, `BookingRow`, `toAdminBooking` and the `ExceptionRow` mapper shapes already in the file):

```typescript
export async function listConfirmedBookingsBetween(
  fromIso: string,
  toIso: string,
): Promise<AdminBooking[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_COLUMNS)
    .eq("status", "confirmed")
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[]).map(toAdminBooking);
}

export async function listExceptionsBetween(
  fromDate: string,
  toDate: string,
): Promise<ExceptionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_exceptions")
    .select("id, date, closed, start_time, end_time")
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date");
  if (error) throw error;
  return (data ?? []).map((e) => ({
    id: e.id, date: e.date, closed: e.closed, startTime: e.start_time, endTime: e.end_time,
  }));
}
```

- [ ] **Step 2: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — week-scoped booking and exception queries"
```

---

### Task 8: `CalendarWeek` static grid + `/bookings` page rework

**Files:**
- Create: `src/features/scheduling/components/calendar-week.tsx`
- Modify: `src/app/(dashboard)/bookings/page.tsx`

**Interfaces:**
- Consumes: Tasks 3/6/7 exports; `wallTimeToUtc`, `addDaysISO`, `dateInZone` from `./slots` (pure, client-safe); `RuleRow`, `ExceptionRow`, `ServiceRow`, `AdminBooking` types.
- Produces: `CalendarWeek({ weekStart, timeZone, bookings, rules, exceptions, services })` client component. This task renders the static grid + cards + hatching + now-line; interactions land in Tasks 9–10 (leave `onSelectBooking`/selection wiring out for now).

- [ ] **Step 0: Read the app-router conventions.** Per `AGENTS.md`, read the relevant guide in `node_modules/next/dist/docs/` (pages, searchParams typing — likely `searchParams: Promise<...>` to be awaited) plus an existing page using searchParams if one exists, before editing `page.tsx`.

- [ ] **Step 1: Rework the server page** (`src/app/(dashboard)/bookings/page.tsx`):

```tsx
import Link from "next/link";
import { listBookings, listConfirmedBookingsBetween, listExceptionsBetween, listServices, getAvailabilityAdmin } from "@/features/scheduling/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { Button } from "@/components/ui/button";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";

  if (params.view === "list") {
    const { upcoming, past } = await listBookings();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Bookings</h1>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/bookings">Calendar view</Link>
          </Button>
        </div>
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} />
      </div>
    );
  }

  const weekStart = mondayOf(
    params.week && DATE_RE.test(params.week) ? params.week : dateInZone(new Date(), timeZone),
  );
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  const [bookings, exceptions, services, { rules }] = await Promise.all([
    listConfirmedBookingsBetween(fromIso, toIso),
    listExceptionsBetween(weekStart, weekEnd),
    listServices(),
    getAvailabilityAdmin(),
  ]);

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Bookings</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/bookings?week=${addDaysISO(weekStart, -7)}`}>←</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/bookings">Today</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/bookings?week=${addDaysISO(weekStart, 7)}`}>→</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/bookings?view=list">List view</Link>
          </Button>
        </div>
      </div>
      <CalendarWeek
        weekStart={weekStart}
        timeZone={timeZone}
        bookings={bookings}
        rules={rules}
        exceptions={exceptions}
        services={services.filter((s) => s.active)}
      />
    </div>
  );
}
```

Note: `getAvailabilityAdmin` filters exceptions to `>= today`, which is why the calendar uses `listExceptionsBetween` for its 7 dates; only `rules` are taken from it. If `slots.ts` doesn't export `wallTimeToUtc`/`addDaysISO`/`dateInZone` already, they are exported — verify (they are, `export function` in the file).

- [ ] **Step 2: Implement the static `CalendarWeek`:**

```tsx
"use client";

import * as React from "react";
import type { AdminBooking, RuleRow, ExceptionRow, ServiceRow } from "@/features/scheduling/queries";
import { effectiveWindows } from "@/features/scheduling/day-windows";
import {
  zonedParts, hourRange, closedIntervals, serviceAccent, timeToMin,
} from "@/features/scheduling/calendar-geometry";
import { addDaysISO } from "@/features/scheduling/slots";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent, transparent 6px, var(--border) 6px, var(--border) 7px)",
};

export function CalendarWeek({
  weekStart, timeZone, bookings, rules, exceptions, services,
}: {
  weekStart: string;
  timeZone: string;
  bookings: AdminBooking[];
  rules: RuleRow[];
  exceptions: ExceptionRow[];
  services: ServiceRow[];
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const windowsByDay = days.map((d) => effectiveWindows(d, rules, exceptions));
  const { startHour, endHour } = hourRange(windowsByDay);
  const totalMin = (endHour - startHour) * 60;
  const pct = (min: number) => ((min - startHour * 60) / totalMin) * 100;

  // Now-line: client clock, re-evaluated every minute. Seeded in useEffect so
  // server and first client render match (no hydration mismatch).
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowParts = now ? zonedParts(now, timeZone) : null;

  const byDay = (date: string) =>
    bookings.filter((b) => zonedParts(new Date(b.startsAt), timeZone).date === date);

  return (
    <div className="overflow-x-auto rounded-md border">
      <div className="grid min-w-[840px] grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
        {/* header row */}
        <div className="sticky top-0 z-10 border-b bg-background" />
        {days.map((d, i) => (
          <div key={d} className="sticky top-0 z-10 border-b border-l bg-background p-2 text-center text-sm">
            <span className="text-muted-foreground">{DAY_LABELS[(i + 1) % 7]}</span>{" "}
            <span className={nowParts?.date === d ? "rounded bg-primary px-1.5 py-0.5 font-semibold text-primary-foreground" : "font-medium"}>
              {Number(d.slice(8, 10))}
            </span>
          </div>
        ))}
        {/* gutter */}
        <div className="relative" style={{ height: `${(endHour - startHour) * 48}px` }}>
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div key={i} className="absolute right-1 -translate-y-1/2 text-xs text-muted-foreground"
              style={{ top: `${pct((startHour + i) * 60)}%` }}>
              {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>
        {/* day columns */}
        {days.map((d, di) => (
          <div key={d} className="relative border-l" style={{ height: `${(endHour - startHour) * 48}px` }}>
            {Array.from({ length: endHour - startHour }, (_, i) => (
              <div key={i} className="absolute inset-x-0 border-t border-border/50"
                style={{ top: `${pct((startHour + i) * 60)}%` }} />
            ))}
            {closedIntervals(windowsByDay[di], startHour, endHour).map((c, i) => (
              <div key={i} className="absolute inset-x-0 bg-muted/30" style={{ ...HATCH, top: `${pct(c.startMin)}%`, height: `${pct(c.endMin) - pct(c.startMin)}%` }} />
            ))}
            {nowParts?.date === d ? (
              <div className="absolute inset-x-0 z-20 border-t-2 border-primary" style={{ top: `${pct(nowParts.minutes)}%` }} />
            ) : null}
            {byDay(d).map((b) => {
              const s = zonedParts(new Date(b.startsAt), timeZone);
              const e = zonedParts(new Date(b.endsAt), timeZone);
              const endMin = e.date === d ? e.minutes : endHour * 60;
              const compact = endMin - s.minutes < 30;
              return (
                <button
                  key={b.id}
                  type="button"
                  className="absolute inset-x-1 z-10 overflow-hidden rounded border bg-card p-1 text-left text-xs shadow-sm hover:shadow"
                  style={{
                    top: `${pct(s.minutes)}%`,
                    height: `${Math.max(pct(endMin) - pct(s.minutes), 1.5)}%`,
                    borderLeft: `3px solid ${serviceAccent(b.serviceId)}`,
                  }}
                >
                  <span className="font-medium">{b.serviceName}</span>
                  {compact ? null : (
                    <span className="block truncate text-muted-foreground">{b.clientName}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```


- [ ] **Step 3: Manual check.** `npm run dev`, open `/bookings` (seeded demo booking should render as a card), check: hatched closed hours, week navigation, List-view toggle, today highlight. Fix what's visibly broken.

- [ ] **Step 4: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — week grid view on /bookings with list toggle"
```

---

### Task 9: Booking detail dialog (click card → manage)

**Files:**
- Create: `src/features/scheduling/components/booking-detail-dialog.tsx`
- Modify: `src/features/scheduling/components/calendar-week.tsx` (wire card clicks)

**Interfaces:**
- Consumes: `cancelBookingAdmin` (Task 2 return shape `{ ok, emailed, noEmail? }`), `BookingRescheduleDialog({ booking, timeZone })`, `formatWhenLine` from `./templates`, `Dialog` primitives from `@/components/ui/dialog` (verify the actual exports in that file and match them).
- Produces: `BookingDetailDialog({ booking, timeZone, open, onOpenChange })` — controlled.

- [ ] **Step 1: Implement the dialog** (cancel-confirm pattern and toast copy copied from `bookings-list.tsx` Row so behavior is identical):

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { formatWhenLine } from "@/features/scheduling/templates";
import { cancelBookingAdmin } from "@/features/scheduling/booking-actions";
import type { AdminBooking } from "@/features/scheduling/queries";
import { BookingRescheduleDialog } from "./booking-reschedule-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function BookingDetailDialog({
  booking, timeZone, open, onOpenChange,
}: {
  booking: AdminBooking | null;
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => { if (!open) setConfirming(false); }, [open]);
  if (!booking) return null;

  const cancel = () =>
    startTransition(async () => {
      const result = await cancelBookingAdmin({ id: booking.id });
      if (!result.ok) toast.error(result.error);
      else if (result.noEmail) toast.success("Booking cancelled — no email on file for this client.");
      else if (result.emailed) toast.success("Booking cancelled — the client has been emailed");
      else toast.warning("Booking cancelled — but the email to the client failed. Contact them directly.");
      onOpenChange(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{booking.serviceName}</DialogTitle>
          <DialogDescription>{formatWhenLine(new Date(booking.startsAt), timeZone)}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {booking.clientName}
          {booking.clientEmail ? ` · ${booking.clientEmail}` : " · no email on file"}
          {booking.note ? ` · “${booking.note}”` : null}
        </p>
        <div className="flex items-center gap-2">
          <BookingRescheduleDialog booking={booking} timeZone={timeZone} />
          {confirming ? (
            <>
              <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>Confirm cancel</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>Keep</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>Cancel booking</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it in `CalendarWeek`:** add `const [selected, setSelected] = React.useState<AdminBooking | null>(null);`, set `onClick={() => setSelected(b)}` on each card button, and render at the root:

```tsx
<BookingDetailDialog
  booking={selected}
  timeZone={timeZone}
  open={selected !== null}
  onOpenChange={(o) => { if (!o) setSelected(null); }}
/>
```

- [ ] **Step 3: Manual check** (click card → dialog; reschedule opens nested dialog; cancel flows + toast), then:

```bash
npm run verify
git add -A && git commit -m "feat: calendar — booking detail dialog with cancel/reschedule"
```

---

### Task 10: Drag-select → create booking / block time / reopen day

**Files:**
- Create: `src/features/scheduling/components/create-booking-dialog.tsx`
- Modify: `src/features/scheduling/components/calendar-week.tsx` (selection state, popover, wiring)

**Interfaces:**
- Consumes: `createBookingAdmin` (Task 5), `blockTimeRange`/`reopenDay` (Task 4), `snap15`, `minToTime`, `timeToMin` (Task 6), `wallTimeToUtc` from `./slots`, `effectiveWindows` (Task 3), `useRouter` from `next/navigation` for `router.refresh()` after mutations (server actions already `revalidatePath`, refresh re-pulls).
- Produces: complete calendar interactions; no exports consumed later.

- [ ] **Step 1: Selection state + pointer handlers in `CalendarWeek`.**

```tsx
type Selection = { date: string; startMin: number; endMin: number };
const [selection, setSelection] = React.useState<Selection | null>(null);
const [dragging, setDragging] = React.useState(false);
const [createOpen, setCreateOpen] = React.useState(false);
const dayHasExceptions = (d: string) => exceptions.some((e) => e.date === d);
```

On each day column `div` add:

```tsx
onPointerDown={(e) => {
  if ((e.target as HTMLElement).closest("button")) return; // cards handle themselves
  const rect = e.currentTarget.getBoundingClientRect();
  const min = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin);
  setSelection({ date: d, startMin: min, endMin: min + 15 });
  setDragging(true);
}}
onPointerMove={(e) => {
  if (!dragging || !selection || selection.date !== d) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const min = snap15(startHour * 60 + ((e.clientY - rect.top) / rect.height) * totalMin) + 15;
  setSelection({ ...selection, endMin: Math.max(min, selection.startMin + 15) });
}}
onPointerUp={() => setDragging(false)}
```

Render the selection overlay + action popover inside the matching column (after `dragging` ends the popover shows; Escape or outside-click clears — add a `useEffect` keydown listener for Escape → `setSelection(null)`):

```tsx
{selection?.date === d ? (
  <div className="absolute inset-x-1 z-20 rounded border border-primary bg-primary/10"
    style={{ top: `${pct(selection.startMin)}%`, height: `${pct(selection.endMin) - pct(selection.startMin)}%` }}>
    {!dragging ? (
      <div className="absolute left-0 top-full z-30 mt-1 flex w-max flex-col gap-1 rounded-md border bg-popover p-2 text-sm shadow-md">
        <span className="text-xs text-muted-foreground">
          {minToTime(selection.startMin)}–{minToTime(selection.endMin)}
        </span>
        <Button size="sm" onClick={() => setCreateOpen(true)}>New booking</Button>
        <Button size="sm" variant="ghost" onClick={blockSelected} disabled={busy}>Block time</Button>
        {dayHasExceptions(d) ? (
          <Button size="sm" variant="ghost" onClick={() => reopenSelected(d)} disabled={busy}>
            Reopen day (restore weekly hours)
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>Dismiss</Button>
      </div>
    ) : null}
  </div>
) : null}
```

with the handlers (at component top; `const router = useRouter();` and `const [busy, startBusy] = React.useTransition();`):

```tsx
const blockSelected = () => {
  if (!selection) return;
  startBusy(async () => {
    const result = await blockTimeRange({
      date: selection.date,
      startTime: minToTime(selection.startMin),
      endTime: minToTime(selection.endMin),
    });
    if (!result.ok) toast.error(result.error);
    else toast.success("Time blocked.");
    setSelection(null);
    router.refresh();
  });
};

const reopenSelected = (date: string) => {
  startBusy(async () => {
    const result = await reopenDay({ date });
    if (!result.ok) toast.error(result.error);
    else toast.success("Day reopened — weekly hours restored.");
    setSelection(null);
    router.refresh();
  });
};
```

- [ ] **Step 2: `CreateBookingDialog`.**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { minToTime, timeToMin } from "@/features/scheduling/calendar-geometry";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

export function CreateBookingDialog({
  open, onOpenChange, date, startMin, timeZone, services, windows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;          // org-local "YYYY-MM-DD"
  startMin: number;      // org-local minutes since midnight (snapped)
  timeZone: string;
  services: ServiceRow[];
  windows: DayWindow[];  // effective windows for `date`, for the warning only
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [serviceId, setServiceId] = React.useState(services[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");

  const service = services.find((s) => s.id === serviceId);
  const endMin = startMin + (service?.durationMin ?? 0);
  const startTime = minToTime(startMin);
  const startsAt = wallTimeToUtc(date, startTime, timeZone);

  const outsideHours =
    !windows.some((w) => timeToMin(w.startTime) <= startMin && endMin <= timeToMin(w.endTime));
  const insideNotice =
    service ? startsAt.getTime() < Date.now() + service.minNoticeMin * 60_000 : false;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await createBookingAdmin({
        serviceId,
        startsAt: startsAt.toISOString(),
        name,
        email,
        note: note || undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.emailed === "sent") toast.success("Booking created — the client has been emailed");
      else if (result.emailed === "failed")
        toast.warning("Booking created — but the confirmation email failed. Contact the client directly.");
      else toast.success("Booking created.");
      onOpenChange(false);
      setName(""); setEmail(""); setNote("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            {date} · {startTime}–{service ? minToTime(endMin) : "?"} ({timeZone})
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-service">Service</Label>
            <select
              id="cb-service"
              className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.durationMin} min)</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-name">Client name</Label>
            <Input id="cb-name" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-email">Email (optional — confirmation is sent only if given)</Label>
            <Input id="cb-email" type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-note">Note (optional)</Label>
            <Textarea id="cb-note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {outsideHours ? (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Outside your open hours — allowed for bookings you create yourself.
            </p>
          ) : null}
          {insideNotice ? (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Inside this service’s minimum-notice window — allowed for bookings you create yourself.
            </p>
          ) : null}
          <Button type="submit" disabled={pending || !serviceId}>
            {pending ? "Creating…" : "Create booking"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the dialog in `CalendarWeek`:**

```tsx
{selection ? (
  <CreateBookingDialog
    open={createOpen}
    onOpenChange={(o) => { setCreateOpen(o); if (!o) setSelection(null); }}
    date={selection.date}
    startMin={selection.startMin}
    timeZone={timeZone}
    services={services}
    windows={windowsByDay[days.indexOf(selection.date)] ?? []}
  />
) : null}
```

- [ ] **Step 4: Manual check** — drag a range: popover appears; "New booking" walk-in without email succeeds (toast "Booking created."), card renders after refresh; creating an overlapping booking shows the overlap error; "Block time" hatches the range and the widget's slots (public page) exclude it; "Reopen day" restores hours. Check `/availability` still lists the created exceptions.

- [ ] **Step 5: Verify + commit**

```bash
npm run verify
git add -A && git commit -m "feat: calendar — drag-select create booking, block time, reopen day"
```

---

### Task 11: Final sweep

**Files:**
- Modify: `docs/superpowers/plans/2026-08-14-admin-calendar.md` (deviation notes, if any accrued)

- [ ] **Step 1: Full test pass** (local Supabase running):

```bash
npm run verify && npm run test:integration
```

- [ ] **Step 2: Update the knowledge graph** (repo rule):

```bash
graphify update .
```

- [ ] **Step 3: Record execution deviations** in this plan file (S2 precedent: a short "Execution deviations" section at the bottom), commit:

```bash
git add -A && git commit -m "docs: calendar plan — record execution deviations"
```

- [ ] **Step 4:** Use superpowers:finishing-a-development-branch (or requesting-code-review first) — PR targets `scheduling-s2` if PR #23 is still open, else `main`.

---

## Execution deviations (recorded post-implementation)

1. **Task 2 test fixture:** the plan's drain-test snippet lacked a `created_at` backdate, so the row would have hit the timing-suppress branch and passed even on unfixed code. Implemented with `created_at` −48h so the null-email guard is genuinely exercised (ruled correct in review).
2. **Base UI, not Radix:** `Button asChild` doesn't exist in this repo's Base UI components — nav links use `buttonVariants` + `Link`; dialogs follow the repo's Base UI dialog API.
3. **Lint-driven adaptations:** `react-hooks/set-state-in-effect` and `react-hooks/purity` are error-level here; the now-line clock and the min-notice `Date.now()` are seeded via `setTimeout` in effects, and the detail dialog's `confirming` reset is `onOpenChange`-driven instead of the plan's `useEffect`.
4. **Pointer capture:** `setPointerCapture` added on pointerdown — fixes a latent stuck-drag bug in the plan's pseudocode when releasing outside the origin column.
5. **Deferred minors** (ledger + final review triage): `BookingRow.client_email` typing, `serviceAccent` comment wording, past-midnight bookings render only on their start column, unclamped extreme drags, whitespace-only note.
6. **Final-review fix wave** (commit 0563ac2): hour range now widens for off-hours bookings (Important); invalid `?week=` NaN guard; inline overlap error in create dialog; time line on cards; real sticky gutter/header via in-container scroll (`max-h-[75vh] overflow-auto`); drag-minute clamps. Residual to eyeball in visual QA: possible card-over-sticky-header paint during scroll (z-10 tie) — if confirmed, bump header cells to `z-20`.
