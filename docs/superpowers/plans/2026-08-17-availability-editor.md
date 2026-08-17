# Availability Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/availability` Calendly-style: day rows with typeable 15-min time comboboxes, per-interval delete, `+` add with smart defaults, "Copy hours to…" popover, autosave, three-layer overlap rejection, and "Date overrides" with multi-interval custom hours.

**Architecture:** Pure time logic lives in a new `time-options.ts` module (unit-tested); UI is thin Base UI-based client components calling granular member-RLS server actions (autosave per mutation); migration 0035 adds EXCLUDE no-overlap constraints (via an immutable `hm_to_min` helper + `int4range`, because times are stored as text "HH:MM") plus the missing column-scoped UPDATE grant/policy on `availability_rules`. The slot/day-window engines already support every target semantic — they are not touched.

**Tech Stack:** Next.js App Router (NOTE: newer Next than your training data — check `node_modules/next/dist/docs/` if any App Router API surprises you), **Base UI** (`@base-ui/react` — NOT Radix; verify component APIs against `node_modules/@base-ui/react/<component>/index.d.ts` and the package's `docs/` folder before use), Supabase RLS + Drizzle migrations, Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-16-availability-editor-design.md`

## Global Constraints

- Branch: `availability-editor` (worktree at `/Users/andriishcherbiak/Pet projects/pipline-app/.claude/worktrees/availability-editor`, already created, deps installed, `.env.local` present). Local Supabase stack running (ports shifted +30).
- Commands: `npm run verify` (lint+typecheck+unit), `npm run test:integration` (needs stack + `npm run db:migrate`), custom migration via `npx drizzle-kit generate --custom --name=<name>`.
- Times are org-local wall-clock **text** `"HH:MM"` end to end (storage, actions, component values); locale formatting only at the display edge. Overlap rule everywhere: `start < end`, no overlaps within a day/date, **touching allowed**.
- The overlap error message is exactly `Times overlap with another set of times.` — exported once as `OVERLAP_ERROR` from `features/scheduling/schema.ts` and reused by client and actions.
- RLS predicate for new policies (copy verbatim): `org_id in (select public.user_orgs())`, `to authenticated`.
- No changes to `slots.ts` / `day-windows.ts` — consumption semantics are already correct and pinned by their suites.
- A PreToolUse hook may demand `graphify query` before reading source files; briefs contain full orientation — reading files named in the brief directly is fine.
- Commit messages: conventional, each ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Pure time helpers (TDD)

**Files:**
- Create: `src/features/scheduling/time-options.ts`
- Test: `src/features/scheduling/time-options.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (verbatim names/signatures — Tasks 2, 6, 7, 8 import these):
  - `type Interval = { startTime: string; endTime: string }`
  - `TIME_OPTIONS: string[]` (00:00…23:45, 15-min steps)
  - `endOptions(start: string): string[]`
  - `parseTimeInput(raw: string): string | null`
  - `formatTime(hm: string, locale?: string): string`
  - `nextInterval(existing: Interval[]): Interval | null`
  - `overlapsSiblings(candidate: Interval, siblings: Interval[]): boolean`
  - `hasOverlap(intervals: Interval[]): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/features/scheduling/time-options.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  TIME_OPTIONS,
  endOptions,
  parseTimeInput,
  formatTime,
  nextInterval,
  overlapsSiblings,
  hasOverlap,
} from "./time-options";

describe("TIME_OPTIONS", () => {
  it("covers the day in 15-minute steps", () => {
    expect(TIME_OPTIONS).toHaveLength(96);
    expect(TIME_OPTIONS[0]).toBe("00:00");
    expect(TIME_OPTIONS[35]).toBe("08:45");
    expect(TIME_OPTIONS[95]).toBe("23:45");
  });
});

describe("endOptions", () => {
  it("lists only times after start, terminated by 23:59", () => {
    const opts = endOptions("23:30");
    expect(opts).toEqual(["23:45", "23:59"]);
  });
  it("always offers 23:59 even after the last grid step", () => {
    expect(endOptions("23:45")).toEqual(["23:59"]);
  });
});

describe("parseTimeInput", () => {
  const cases: Array<[string, string | null]> = [
    ["9", "09:00"],
    ["17", "17:00"],
    ["9:15", "09:15"],
    ["915", "09:15"],
    ["0915", "09:15"],
    ["1730", "17:30"],
    ["9:15pm", "21:15"],
    ["9:15 PM", "21:15"],
    ["9 pm", "21:00"],
    ["12am", "00:00"],
    ["12:30 am", "00:30"],
    ["12pm", "12:00"],
    ["23:59", "23:59"],
    ["00:00", "00:00"],
    ["24:00", null],
    ["9:70", null],
    ["13pm", null],
    ["0am", null],
    ["", null],
    ["abc", null],
  ];
  for (const [raw, expected] of cases) {
    it(`parses ${JSON.stringify(raw)} → ${expected}`, () => {
      expect(parseTimeInput(raw)).toBe(expected);
    });
  }
});

describe("formatTime", () => {
  it("formats 12h for en-US", () => {
    expect(formatTime("09:00", "en-US")).toBe("9:00 AM");
    expect(formatTime("13:05", "en-US")).toBe("1:05 PM");
  });
  it("formats 24h for de-DE", () => {
    // If these literals differ on your ICU version (zero-padding varies),
    // the binding invariant is: 24h clock, no AM/PM. Verify that, then
    // update the literal to the actual output — note it in your report.
    expect(formatTime("09:00", "de-DE")).toBe("09:00");
    expect(formatTime("13:05", "de-DE")).toBe("13:05");
  });
});

describe("nextInterval", () => {
  it("defaults an empty day to 09:00–17:00", () => {
    expect(nextInterval([])).toEqual({ startTime: "09:00", endTime: "17:00" });
  });
  it("starts 1h after the last end, 4h long", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "13:00" }])).toEqual({
      startTime: "14:00",
      endTime: "18:00",
    });
  });
  it("clamps the end to 23:59", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "20:00" }])).toEqual({
      startTime: "21:00",
      endTime: "23:59",
    });
  });
  it("drops the 1h gap when it would not fit", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "23:00" }])).toEqual({
      startTime: "23:00",
      endTime: "23:59",
    });
  });
  it("returns null when nothing fits (last end past 23:44)", () => {
    expect(nextInterval([{ startTime: "09:00", endTime: "23:45" }])).toBeNull();
  });
  it("uses the max end across unsorted intervals", () => {
    expect(
      nextInterval([
        { startTime: "14:00", endTime: "18:00" },
        { startTime: "09:00", endTime: "13:00" },
      ]),
    ).toEqual({ startTime: "19:00", endTime: "23:00" });
  });
});

describe("overlapsSiblings", () => {
  const siblings = [
    { startTime: "09:00", endTime: "13:00" },
    { startTime: "14:00", endTime: "18:00" },
  ];
  it("rejects an overlap", () => {
    expect(overlapsSiblings({ startTime: "12:00", endTime: "14:30" }, siblings)).toBe(true);
  });
  it("allows touching", () => {
    expect(overlapsSiblings({ startTime: "13:00", endTime: "14:00" }, siblings)).toBe(false);
  });
  it("rejects containment", () => {
    expect(overlapsSiblings({ startTime: "10:00", endTime: "11:00" }, siblings)).toBe(true);
  });
});

describe("hasOverlap", () => {
  it("accepts sorted touching intervals", () => {
    expect(
      hasOverlap([
        { startTime: "09:00", endTime: "13:00" },
        { startTime: "13:00", endTime: "17:00" },
      ]),
    ).toBe(false);
  });
  it("catches containment past the immediate neighbor", () => {
    expect(
      hasOverlap([
        { startTime: "09:00", endTime: "18:00" },
        { startTime: "10:00", endTime: "11:00" },
        { startTime: "12:00", endTime: "13:00" },
      ]),
    ).toBe(true);
  });
  it("accepts empty and single", () => {
    expect(hasOverlap([])).toBe(false);
    expect(hasOverlap([{ startTime: "09:00", endTime: "17:00" }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/scheduling/time-options.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/features/scheduling/time-options.ts`:

```ts
// Pure time helpers for the availability editor. All times are org-local
// wall-clock "HH:MM" strings (the storage format, see 0026's format CHECK);
// minutes-since-midnight exists only inside this module.

export type Interval = { startTime: string; endTime: string };

const DAY_END = "23:59";

function toMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

function toHM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export const TIME_OPTIONS: string[] = Array.from({ length: 96 }, (_, i) => toHM(i * 15));

// End-time box options: strictly after `start`, plus 23:59 as the
// end-of-day terminator (Calendly behavior).
export function endOptions(start: string): string[] {
  return [...TIME_OPTIONS.filter((t) => t > start), DAY_END];
}

// Lenient parser for typed input → canonical "HH:MM" | null.
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\./g, "");
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const suffix = m[3];
  if (minute > 59) return null;
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) return null;
  return toHM(hour * 60 + minute);
}

// Locale-aware display. Components call it without `locale` (browser
// default); tests pass one explicitly to stay deterministic.
export function formatTime(hm: string, locale?: string): string {
  const d = new Date(Date.UTC(2000, 0, 1, Number(hm.slice(0, 2)), Number(hm.slice(3, 5))));
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

// The `+` button's default (spec): empty day → 09:00–17:00; else start =
// last end + 1h (drop the gap if nothing would fit), end = start + 4h,
// clamped to 23:59. null = nothing fits → the button disables.
export function nextInterval(existing: Interval[]): Interval | null {
  if (existing.length === 0) return { startTime: "09:00", endTime: "17:00" };
  const lastEnd = Math.max(...existing.map((i) => toMin(i.endTime)));
  const dayEnd = toMin(DAY_END);
  let start = lastEnd + 60;
  if (start + 15 > dayEnd) start = lastEnd;
  if (start + 15 > dayEnd) return null;
  return { startTime: toHM(start), endTime: toHM(Math.min(start + 240, dayEnd)) };
}

// Overlap checks: half-open intervals, touching allowed.
export function overlapsSiblings(candidate: Interval, siblings: Interval[]): boolean {
  const s = toMin(candidate.startTime);
  const e = toMin(candidate.endTime);
  return siblings.some((o) => s < toMin(o.endTime) && toMin(o.startTime) < e);
}

export function hasOverlap(intervals: Interval[]): boolean {
  const sorted = [...intervals].sort((a, b) => a.startTime.localeCompare(b.startTime));
  let maxEnd = "";
  for (const cur of sorted) {
    if (maxEnd && cur.startTime < maxEnd) return true;
    if (cur.endTime > maxEnd) maxEnd = cur.endTime;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/features/scheduling/time-options.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/time-options.ts src/features/scheduling/time-options.test.ts
git commit -m "feat: pure time helpers for the availability editor"
```

---

### Task 2: Zod inputs for the new actions (TDD)

**Files:**
- Modify: `src/features/scheduling/schema.ts`
- Modify (add cases): `src/features/scheduling/schema.test.ts`

**Interfaces:**
- Consumes: existing `timeField`, `DATE_RE` (module-private — the additions live in the same file).
- Produces (Task 4 imports): `OVERLAP_ERROR: string`, `updateRuleInput`, `copyDayHoursInput`, `dateOverrideInput`, `deleteOverrideInput`.

- [ ] **Step 1: Write failing tests**

Append to `src/features/scheduling/schema.test.ts` (follow the file's existing describe/it style):

```ts
import {
  OVERLAP_ERROR,
  updateRuleInput,
  copyDayHoursInput,
  dateOverrideInput,
  deleteOverrideInput,
} from "./schema";

describe("updateRuleInput", () => {
  it("accepts an ordered window", () => {
    expect(
      updateRuleInput.safeParse({
        id: "6f6f38d4-7d33-4f0f-9d7e-51f6bd3c8a01",
        startTime: "09:00",
        endTime: "13:00",
      }).success,
    ).toBe(true);
  });
  it("rejects start >= end", () => {
    expect(
      updateRuleInput.safeParse({
        id: "6f6f38d4-7d33-4f0f-9d7e-51f6bd3c8a01",
        startTime: "13:00",
        endTime: "13:00",
      }).success,
    ).toBe(false);
  });
});

describe("copyDayHoursInput", () => {
  it("accepts distinct targets", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [2, 3] }).success).toBe(true);
  });
  it("rejects copying onto itself", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [1] }).success).toBe(false);
  });
  it("rejects duplicates and empty targets", () => {
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [2, 2] }).success).toBe(false);
    expect(copyDayHoursInput.safeParse({ sourceWeekday: 1, targetWeekdays: [] }).success).toBe(false);
  });
});

describe("dateOverrideInput", () => {
  it("accepts closed with no windows", () => {
    expect(dateOverrideInput.safeParse({ date: "2026-09-01", closed: true, windows: [] }).success).toBe(true);
  });
  it("accepts open with sorted touching windows", () => {
    expect(
      dateOverrideInput.safeParse({
        date: "2026-09-01",
        closed: false,
        windows: [
          { startTime: "09:00", endTime: "13:00" },
          { startTime: "13:00", endTime: "17:00" },
        ],
      }).success,
    ).toBe(true);
  });
  it("rejects open with no windows and closed with windows", () => {
    expect(dateOverrideInput.safeParse({ date: "2026-09-01", closed: false, windows: [] }).success).toBe(false);
    expect(
      dateOverrideInput.safeParse({
        date: "2026-09-01",
        closed: true,
        windows: [{ startTime: "09:00", endTime: "10:00" }],
      }).success,
    ).toBe(false);
  });
  it("rejects overlapping windows with the shared message", () => {
    const result = dateOverrideInput.safeParse({
      date: "2026-09-01",
      closed: false,
      windows: [
        { startTime: "09:00", endTime: "13:00" },
        { startTime: "12:00", endTime: "14:00" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === OVERLAP_ERROR)).toBe(true);
    }
  });
});

describe("deleteOverrideInput", () => {
  it("accepts a date and rejects garbage", () => {
    expect(deleteOverrideInput.safeParse({ date: "2026-09-01" }).success).toBe(true);
    expect(deleteOverrideInput.safeParse({ date: "not-a-date" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/scheduling/schema.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 3: Implement** (append to `src/features/scheduling/schema.ts`)

```ts
export const OVERLAP_ERROR = "Times overlap with another set of times.";

export const updateRuleInput = z
  .object({ id: z.uuid(), startTime: timeField, endTime: timeField })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });

export const copyDayHoursInput = z
  .object({
    sourceWeekday: z.number().int().min(0).max(6),
    targetWeekdays: z.array(z.number().int().min(0).max(6)).min(1).max(6),
  })
  .refine((i) => !i.targetWeekdays.includes(i.sourceWeekday), {
    message: "cannot copy a day onto itself",
  })
  .refine((i) => new Set(i.targetWeekdays).size === i.targetWeekdays.length, {
    message: "duplicate target days",
  });

const overrideWindow = z
  .object({ startTime: timeField, endTime: timeField })
  .refine((w) => w.startTime < w.endTime, { message: "start must precede end" });

export const dateOverrideInput = z
  .object({
    date: z.string().regex(DATE_RE),
    closed: z.boolean(),
    windows: z.array(overrideWindow).max(10).default([]),
  })
  .refine((o) => (o.closed ? o.windows.length === 0 : o.windows.length > 0), {
    message: "closed override has no windows; open override needs at least one",
  })
  .refine(
    (o) => {
      const sorted = [...o.windows].sort((a, b) => a.startTime.localeCompare(b.startTime));
      let maxEnd = "";
      for (const w of sorted) {
        if (maxEnd && w.startTime < maxEnd) return false;
        if (w.endTime > maxEnd) maxEnd = w.endTime;
      }
      return true;
    },
    { message: OVERLAP_ERROR },
  );

export const deleteOverrideInput = z.object({ date: z.string().regex(DATE_RE) });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/features/scheduling/schema.test.ts` — expected PASS. Then `npm run verify` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/schema.ts src/features/scheduling/schema.test.ts
git commit -m "feat: zod inputs for availability update/copy/date-override actions"
```

---

### Task 3: Migration 0035 — overlap EXCLUDE guards + update grant/policy

**Files:**
- Create: `src/db/migrations/0035_availability_overlap_guard.sql` (via `npx drizzle-kit generate --custom --name=availability_overlap_guard`)
- Test: `src/features/scheduling/availability-guard.integration.test.ts` (new)

**Interfaces:**
- Consumes: existing tables (times are TEXT "HH:MM"; format CHECKs from 0026 make the substr math safe), `btree_gist` (enabled in 0026), RLS predicate `org_id in (select public.user_orgs())`.
- Produces: constraints `availability_rules_no_overlap`, `availability_exceptions_no_overlap` (violations = SQLSTATE `23P01`); `hm_to_min(text)` immutable helper; UPDATE(start_time, end_time) grant + `availability_rules_update_member` policy (Task 4's `updateAvailabilityRule` depends on both).

- [ ] **Step 1: Write the failing integration test**

Create `src/features/scheduling/availability-guard.integration.test.ts` (copy the env/bootstrap idiom — `loadEnvFile`, `admin`, `signedInUser`, `create_org` — from the top of `src/features/scheduling/booking-rpc.integration.test.ts`):

```ts
/**
 * 0035: overlap EXCLUDE guards on availability tables + the member UPDATE
 * path on availability_rules. Requires the local Supabase stack.
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

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("availability overlap guards (0035)", () => {
  let owner: SupabaseClient;
  let orgId: string;

  beforeAll(async () => {
    owner = await signedInUser("avail_guard");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "AvailGuardCo" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
  });

  it("rejects an overlapping rule with 23P01, allows touching", async () => {
    const { error: first } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 1, start_time: "09:00", end_time: "13:00" });
    expect(first).toBeNull();
    const { error: overlap } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 1, start_time: "12:00", end_time: "14:00" });
    expect(overlap?.code).toBe("23P01");
    const { error: touching } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 1, start_time: "13:00", end_time: "17:00" });
    expect(touching).toBeNull();
    // Same window on another weekday is fine.
    const { error: otherDay } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 2, start_time: "09:00", end_time: "13:00" });
    expect(otherDay).toBeNull();
  });

  it("member can update a rule's times; updating into overlap is 23P01", async () => {
    const { data: row, error } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 3, start_time: "09:00", end_time: "11:00" })
      .select("id")
      .single();
    expect(error).toBeNull();
    const { error: e2 } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 3, start_time: "12:00", end_time: "14:00" });
    expect(e2).toBeNull();

    const { data: updated, error: updateError } = await owner
      .from("availability_rules")
      .update({ start_time: "08:00", end_time: "10:00" })
      .eq("id", row!.id)
      .select("id")
      .maybeSingle();
    expect(updateError).toBeNull();
    expect(updated?.id).toBe(row!.id);

    const { error: overlapUpdate } = await owner
      .from("availability_rules")
      .update({ end_time: "12:30" })
      .eq("id", row!.id);
    expect(overlapUpdate?.code).toBe("23P01");
  });

  it("open override windows can't overlap on one date; closed rows are exempt", async () => {
    const DATE = "2027-06-01";
    const { error: w1 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: DATE, closed: false, start_time: "09:00", end_time: "12:00" });
    expect(w1).toBeNull();
    const { error: w2 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: DATE, closed: false, start_time: "11:00", end_time: "13:00" });
    expect(w2?.code).toBe("23P01");
    const { error: touching } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: DATE, closed: false, start_time: "12:00", end_time: "14:00" });
    expect(touching).toBeNull();
    // A closed row on another date never trips the (partial) constraint,
    // and two closed rows may coexist.
    const CLOSED = "2027-06-02";
    const { error: c1 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: CLOSED, closed: true, start_time: null, end_time: null });
    expect(c1).toBeNull();
    const { error: c2 } = await owner
      .from("availability_exceptions")
      .insert({ org_id: orgId, date: CLOSED, closed: true, start_time: null, end_time: null });
    expect(c2).toBeNull();
  });
});
```

Run: `npm run db:migrate` (no-op) then `npm run test:integration -- availability-guard`
Expected: FAIL — the update is rejected (no UPDATE grant yet) and overlap inserts succeed (no constraint yet).

- [ ] **Step 2: Create and fill the migration**

Run `npx drizzle-kit generate --custom --name=availability_overlap_guard`, then fill `src/db/migrations/0035_availability_overlap_guard.sql`:

```sql
-- 0035: availability overlap guards + member update path.
--
-- 1. hm_to_min: immutable "HH:MM"(text) → minutes. Times are stored as
--    text (0025/0026 decision); text::time casts are only STABLE, so an
--    EXCLUDE expression needs this immutable helper + int4range instead
--    of a time-range type.
-- 2. Pre-merge: union any existing overlapping intervals per (org,
--    weekday) / (org, date, open) — addRange semantics — so the
--    constraints can land on live data.
-- 3. EXCLUDE constraints (btree_gist, enabled in 0026): no overlapping
--    windows per org+weekday (rules) / per org+date among open rows
--    (exceptions). int4range is half-open — touching rows coexist.
-- 4. availability_rules gains the member UPDATE path (column-scoped
--    grant per the 0008 idiom + policy) for in-place interval editing;
--    0026 deliberately granted only select/insert/delete.

create or replace function public.hm_to_min(t text) returns integer
language sql immutable strict
set search_path = ''
as $$
  select substr(t, 1, 2)::int * 60 + substr(t, 4, 2)::int
$$;
--> statement-breakpoint

do $$
declare
  g record;
  r record;
  cs int;
  ce int;
  started boolean;
begin
  create temporary table _merged (org_id uuid, weekday int, s int, e int) on commit drop;

  for g in
    select distinct a.org_id, a.weekday
    from public.availability_rules a
    join public.availability_rules b
      on a.org_id = b.org_id and a.weekday = b.weekday and a.id <> b.id
     and public.hm_to_min(a.start_time) < public.hm_to_min(b.end_time)
     and public.hm_to_min(b.start_time) < public.hm_to_min(a.end_time)
  loop
    started := false;
    for r in
      select public.hm_to_min(start_time) as s, public.hm_to_min(end_time) as e
      from public.availability_rules
      where org_id = g.org_id and weekday = g.weekday
      order by 1, 2
    loop
      if not started then
        cs := r.s; ce := r.e; started := true;
      elsif r.s <= ce then
        ce := greatest(ce, r.e);
      else
        insert into _merged values (g.org_id, g.weekday, cs, ce);
        cs := r.s; ce := r.e;
      end if;
    end loop;
    if started then insert into _merged values (g.org_id, g.weekday, cs, ce); end if;
    delete from public.availability_rules where org_id = g.org_id and weekday = g.weekday;
  end loop;

  insert into public.availability_rules (org_id, weekday, start_time, end_time)
  select org_id, weekday,
         lpad((s / 60)::text, 2, '0') || ':' || lpad((s % 60)::text, 2, '0'),
         lpad((e / 60)::text, 2, '0') || ':' || lpad((e % 60)::text, 2, '0')
  from _merged;
end $$;
--> statement-breakpoint

do $$
declare
  g record;
  r record;
  cs int;
  ce int;
  started boolean;
begin
  create temporary table _merged_ex (org_id uuid, date date, s int, e int) on commit drop;

  for g in
    select distinct a.org_id, a.date
    from public.availability_exceptions a
    join public.availability_exceptions b
      on a.org_id = b.org_id and a.date = b.date and a.id <> b.id
     and not a.closed and not b.closed
     and public.hm_to_min(a.start_time) < public.hm_to_min(b.end_time)
     and public.hm_to_min(b.start_time) < public.hm_to_min(a.end_time)
  loop
    started := false;
    for r in
      select public.hm_to_min(start_time) as s, public.hm_to_min(end_time) as e
      from public.availability_exceptions
      where org_id = g.org_id and date = g.date and not closed
      order by 1, 2
    loop
      if not started then
        cs := r.s; ce := r.e; started := true;
      elsif r.s <= ce then
        ce := greatest(ce, r.e);
      else
        insert into _merged_ex values (g.org_id, g.date, cs, ce);
        cs := r.s; ce := r.e;
      end if;
    end loop;
    if started then insert into _merged_ex values (g.org_id, g.date, cs, ce); end if;
    delete from public.availability_exceptions
      where org_id = g.org_id and date = g.date and not closed;
  end loop;

  insert into public.availability_exceptions (org_id, date, closed, start_time, end_time)
  select org_id, date, false,
         lpad((s / 60)::text, 2, '0') || ':' || lpad((s % 60)::text, 2, '0'),
         lpad((e / 60)::text, 2, '0') || ':' || lpad((e % 60)::text, 2, '0')
  from _merged_ex;
end $$;
--> statement-breakpoint

alter table public.availability_rules
  add constraint availability_rules_no_overlap
  exclude using gist (
    org_id with =,
    weekday with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&
  );
--> statement-breakpoint

alter table public.availability_exceptions
  add constraint availability_exceptions_no_overlap
  exclude using gist (
    org_id with =,
    date with =,
    int4range(public.hm_to_min(start_time), public.hm_to_min(end_time)) with &&
  ) where (not closed);
--> statement-breakpoint

grant update (start_time, end_time) on table public.availability_rules to authenticated;
--> statement-breakpoint

create policy "availability_rules_update_member" on public.availability_rules
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
```

Note: if `drizzle-kit migrate` runs each statement separately and complains about the `--> statement-breakpoint` placement inside DO blocks, adjust breakpoints to sit only between top-level statements (DO blocks are single statements) — the repo's earlier custom migrations (0026, 0028) are the reference for breakpoint style.

- [ ] **Step 3: Apply and verify green**

Run: `npm run db:migrate`, then `npm run test:integration -- availability-guard`
Expected: PASS (all 3). Then run the full `npm run test:integration` — the pre-existing suites (incl. `rls.integration.test.ts`, whose fixtures may insert availability rows) must stay green; if any fixture trips the new constraint, fix the FIXTURE (its windows were arbitrary), never the constraint.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/0035_availability_overlap_guard.sql src/db/migrations/meta src/features/scheduling/availability-guard.integration.test.ts
git commit -m "feat: overlap EXCLUDE guards + member update path for availability (0035)"
```

---

### Task 4: Server actions — update, copy, date overrides, 23P01 mapping

**Files:**
- Modify: `src/features/scheduling/actions.ts`

**Interfaces:**
- Consumes: Task 2 inputs + `OVERLAP_ERROR`; Task 3 constraints (23P01) and update policy; existing `currentOrgId()`, `fail()`, `ActionState`, `GENERIC_WRITE_ERROR` idioms in the same file.
- Produces (Tasks 7/8 import): `updateAvailabilityRule(input)`, `copyDayHours(input)`, `setDateOverride(input)`, `deleteDateOverride(input)` — all `Promise<ActionState>`. Existing `addAvailabilityRule`/`deleteAvailabilityRule` keep their signatures (add gains the 23P01 mapping). `addAvailabilityException`/`deleteAvailabilityException` remain for now (the old editor still compiles against them) — Task 8 removes them.

- [ ] **Step 1: Implement**

At the top of the availability section add:

```ts
// EXCLUDE-guard violations (0035) — the DB is the authority on overlaps;
// map to the same message the client shows.
const OVERLAP_DB_CODE = "23P01";
```

Extend the imports from `./schema` with `OVERLAP_ERROR, updateRuleInput, copyDayHoursInput, dateOverrideInput, deleteOverrideInput`.

In `addAvailabilityRule`, replace `if (error) return fail("addAvailabilityRule", error);` with:

```ts
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("addAvailabilityRule", error);
  }
```

and add `revalidatePath("/bookings");` after the existing `revalidatePath("/availability");` (the admin calendar renders availability windows). Do the same `/bookings` addition in `deleteAvailabilityRule`.

Append the new actions:

```ts
export async function updateAvailabilityRule(input: unknown): Promise<ActionState> {
  const parsed = updateRuleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .update({ start_time: parsed.data.startTime, end_time: parsed.data.endTime })
    .eq("id", parsed.data.id)
    // Explicit org scope (defense-in-depth, mirrors the delete actions).
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("updateAvailabilityRule", error);
  }
  if (!data) return fail("updateAvailabilityRule", "rule not visible");
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

// Overwrite semantics (spec): each target day's rows are replaced by the
// source day's rows — including "no rows" when the source day is empty.
// The source is read server-side, never client-supplied. Delete-then-insert
// is not atomic; a failure between the two leaves targets empty — visible
// and retryable, accepted for a single-editor solo product (spec).
export async function copyDayHours(input: unknown): Promise<ActionState> {
  const parsed = copyDayHoursInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data: source, error: readError } = await supabase
    .from("availability_rules")
    .select("start_time, end_time")
    .eq("org_id", orgId)
    .eq("weekday", parsed.data.sourceWeekday);
  if (readError) return fail("copyDayHours", readError);
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .eq("org_id", orgId)
    .in("weekday", parsed.data.targetWeekdays);
  if (deleteError) return fail("copyDayHours", deleteError);
  if ((source ?? []).length > 0) {
    const rows = parsed.data.targetWeekdays.flatMap((weekday) =>
      (source ?? []).map((w) => ({
        org_id: orgId,
        weekday,
        start_time: w.start_time,
        end_time: w.end_time,
      })),
    );
    const { error: insertError } = await supabase.from("availability_rules").insert(rows);
    if (insertError) return fail("copyDayHours", insertError);
  }
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

// Replace-all-rows-for-the-date semantics (spec): one closed row, or N
// window rows. Same non-atomicity note as copyDayHours.
export async function setDateOverride(input: unknown): Promise<ActionState> {
  const parsed = dateOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error: deleteError } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("org_id", orgId)
    .eq("date", parsed.data.date);
  if (deleteError) return fail("setDateOverride", deleteError);
  const rows = parsed.data.closed
    ? [{ org_id: orgId, date: parsed.data.date, closed: true, start_time: null, end_time: null }]
    : parsed.data.windows.map((w) => ({
        org_id: orgId,
        date: parsed.data.date,
        closed: false,
        start_time: w.startTime,
        end_time: w.endTime,
      }));
  const { error: insertError } = await supabase.from("availability_exceptions").insert(rows);
  if (insertError) {
    if (insertError.code === OVERLAP_DB_CODE) return { ok: false, error: OVERLAP_ERROR };
    return fail("setDateOverride", insertError);
  }
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}

export async function deleteDateOverride(input: unknown): Promise<ActionState> {
  const parsed = deleteOverrideInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_exceptions")
    .delete()
    .eq("org_id", orgId)
    .eq("date", parsed.data.date);
  if (error) return fail("deleteDateOverride", error);
  revalidatePath("/availability");
  revalidatePath("/bookings");
  return { ok: true };
}
```

Plan deviation note (recorded): the spec said single-interval actions also "read the day's sibling rows and reject overlap" app-side. That read would be racy and the 0035 constraint is authoritative; the 23P01 mapping delivers the identical user-facing behavior without the extra query. The client-side check (Task 7) still prevents the round-trip in the common case.

- [ ] **Step 2: Verify**

Run: `npm run verify` — expected PASS (the old editor still compiles; no consumer of the new actions yet).

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/actions.ts
git commit -m "feat: availability actions — update, copy day hours, date overrides"
```

---

### Task 5: UI primitives — Popover and Checkbox wrappers

**Files:**
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/ui/checkbox.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/popover` and `@base-ui/react/checkbox`. **Before writing code, read `node_modules/@base-ui/react/popover/index.d.ts` and `node_modules/@base-ui/react/checkbox/index.d.ts` (plus the package's `docs/` folder if present) — this repo uses Base UI, not Radix, and prop/part names differ.** Mirror the wrapper idiom of `src/components/ui/dialog.tsx` (part composition, `cn()` class merging, `data-slot` attributes if dialog.tsx uses them, popup/backdrop styling tokens).
- Produces: `Popover`, `PopoverTrigger`, `PopoverContent` (positioned popup with the app's border/background tokens, focus managed by Base UI); `Checkbox` (labeled-checkbox-compatible control matching the app's input styling). Task 7 consumes both; Task 8 consumes `Checkbox`.

- [ ] **Step 1: Implement both wrappers**

Follow `dialog.tsx` as the structural template. `PopoverContent` should render Base UI's Positioner + Popup with classes consistent with the dropdown-menu popup styling already in `src/components/ui/dropdown-menu.tsx` (same rounded/border/bg/shadow token set), accept `className`, `align`/`side` positioning props (whatever Base UI's positioner names them), and default to an 8px offset. `Checkbox` renders Base UI's Checkbox root + indicator with a check icon from `lucide-react`, sized `size-4`, focus-visible ring per `input.tsx`.

- [ ] **Step 2: Verify**

Run: `npm run verify` — expected PASS (typecheck confirms the Base UI API usage compiles; components are not yet consumed).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/popover.tsx src/components/ui/checkbox.tsx
git commit -m "feat: Popover and Checkbox UI primitives (Base UI wrappers)"
```

---

### Task 6: TimeCombobox

**Files:**
- Create: `src/features/scheduling/components/time-combobox.tsx`

**Interfaces:**
- Consumes: `TIME_OPTIONS`-shaped option lists (passed in), `parseTimeInput`, `formatTime` from `../time-options`; `@base-ui/react/combobox` (**read `node_modules/@base-ui/react/combobox/index.d.ts` + its docs first**; if the Combobox API can't cleanly support free-text commit, fall back to composing `Input` + `Popover` + a manual listbox — the behavioral contract below is what's binding, not the library part names).
- Produces:

```ts
export function TimeCombobox(props: {
  value: string;                    // canonical "HH:MM"
  options: string[];                // dropdown list, canonical "HH:MM"
  onCommit: (hm: string) => void;   // fires only with a parsed, changed value
  label: string;                    // aria-label, e.g. "Monday start time"
  invalid?: boolean;                // red outline + aria-invalid
  describedBy?: string;             // id of the error message element
  disabled?: boolean;
}): React.ReactNode;
```

**Behavioral contract (binding):**
1. Closed state shows `formatTime(value)` (browser locale — 12h/24h automatically).
2. Opening shows `options` formatted via `formatTime`; typing filters against both the formatted label and the canonical value; the current value is highlighted.
3. Selecting an option calls `onCommit(canonical)` immediately and closes.
4. Typed free text commits on Enter or blur: `parseTimeInput(text)` — parsed and different from `value` → `onCommit`; unparseable → revert the display to `formatTime(value)`, no commit. Off-grid parsed values (e.g. "9:10") are legal commits.
5. Escape reverts and closes. `invalid` renders `aria-invalid` and a destructive-color border; `describedBy` wires `aria-describedby`.
6. The control is keyboard-complete (arrow keys through options, Enter selects) — Base UI's combobox provides this; a manual fallback must too.

- [ ] **Step 1: Implement** per the contract, styling the trigger like the screenshot's boxes: `Input`-like bordered box, compact width (`w-28`), centered text.

- [ ] **Step 2: Verify**

Run: `npm run verify` — expected PASS. (Behavior is exercised in Task 9's browser smoke; the parsing/formatting logic it delegates to is already unit-tested.)

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/components/time-combobox.tsx
git commit -m "feat: TimeCombobox — typeable locale-aware time input"
```

---

### Task 7: Weekly hours editor

**Files:**
- Create: `src/features/scheduling/components/weekly-hours.tsx`

**Interfaces:**
- Consumes: `RuleRow` from `../queries` (`{ id, weekday, startTime, endTime }`); actions `addAvailabilityRule`, `updateAvailabilityRule`, `deleteAvailabilityRule`, `copyDayHours`; `TimeCombobox` (Task 6); `TIME_OPTIONS`, `endOptions`, `nextInterval`, `overlapsSiblings`, type `Interval` from `../time-options`; `OVERLAP_ERROR` from `../schema`; `Popover`/`PopoverTrigger`/`PopoverContent`, `Checkbox`, `Button` primitives; `Plus`, `Copy`, `Trash2` icons from `lucide-react`; `toast` from `sonner`.
- Produces: `WeeklyHours({ rules }: { rules: RuleRow[] })` — client component; Task 8's page renders it.

**Behavioral contract (binding):**
- Rows Mon→Sun: define `const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]` and the label arrays locally in this file (the old editor that held them is deleted in Task 8); short labels `"Mon." … "Sun."` in rows, full names for aria-labels and the copy popover.
- Each rule renders one interval line: start `TimeCombobox` (options `TIME_OPTIONS`) – en-dash – end `TimeCombobox` (options `endOptions(startTime)`) – trash icon-button (`aria-label` "Remove {day} {start}–{end}").
- Empty day: muted "Unavailable" text in the intervals column.
- Committing a time edit: build the candidate interval; if `overlapsSiblings(candidate, otherIntervalsOfDay)` → set that rule's conflict state (both boxes `invalid`, message `OVERLAP_ERROR` in a `<p className="text-destructive text-xs" id={...}>` under the line, wired via `describedBy`) and do NOT call the action. Otherwise clear conflict and call `updateAvailabilityRule`; on `!result.ok` toast the error (the server may still answer with `OVERLAP_ERROR` — the 23P01 path).
- If the user commits an end ≤ start (possible by typing), treat it as a conflict with message "End must be after start." — same inline presentation, no action call.
- `+` button (aria-label "Add interval to {day}"): computes `nextInterval(dayIntervals)`; `null` → button disabled with `title="No room left after the last interval"`; otherwise calls `addAvailabilityRule({ weekday, ...interval })`. Errors toast.
- Copy button (aria-label "Copy {day} hours to other days") opens a `Popover`: heading "Copy hours to…", one labeled `Checkbox` per other day (Mon→Sun order, full names), Apply `Button` (disabled until ≥1 checked, and while pending). Apply calls `copyDayHours({ sourceWeekday, targetWeekdays })`, closes on success, toasts on error. Checkbox state resets when the popover closes.
- All mutations run in `useTransition`; controls disable while pending (the existing editor's pattern).
- Layout: bordered card list like the screenshot — each day a row with the label column (`w-12 shrink-0 pt-2 text-sm font-medium`), intervals stacked in the middle, `+`/copy icon-buttons right-aligned; `border-b` between days.

- [ ] **Step 1: Implement** (suggested internal split: `WeeklyHours` → `DayRow` → `IntervalLine`; conflict state lives in `DayRow` as `{ ruleId, message } | null`).

- [ ] **Step 2: Verify**

Run: `npm run verify` — expected PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/scheduling/components/weekly-hours.tsx
git commit -m "feat: Calendly-style weekly hours editor"
```

---

### Task 8: Date overrides, page composition, legacy removal

**Files:**
- Create: `src/features/scheduling/components/date-overrides.tsx`
- Modify: `src/app/(dashboard)/availability/page.tsx`
- Delete: `src/features/scheduling/components/availability-editor.tsx`
- Modify: `src/features/scheduling/actions.ts` (remove `addAvailabilityException`, `deleteAvailabilityException`)
- Modify: `src/features/scheduling/schema.ts` + `schema.test.ts` (remove `availabilityExceptionInput`, `exceptionIdInput` and their tests — first `grep -rn` both names to confirm the old editor was the only consumer; `blockTimeInput`/`reopenDayInput` are separate and stay)

**Interfaces:**
- Consumes: `RuleRow`, `ExceptionRow` from `../queries`; `setDateOverride`, `deleteDateOverride` actions; `effectiveWindows` from `../day-windows` (pure, client-safe); `TimeCombobox`, `Checkbox`, `Dialog` parts, `Button`, `Input` (for the native date field); `TIME_OPTIONS`, `endOptions`, `nextInterval`, `hasOverlap`, type `Interval` from `../time-options`; `OVERLAP_ERROR` from `../schema`; `getSchedulingSettings` (page, server-side).
- Produces: `DateOverrides({ rules, exceptions }: { rules: RuleRow[]; exceptions: ExceptionRow[] })` — client component with list + dialog; the rewritten page.

**Behavioral contract (binding):**
- Section header "Date overrides", subtitle "Days when your availability differs from your weekly hours.", and an "Add a date override" button opening the dialog.
- List: exceptions grouped by date ascending; each row shows the date formatted `weekday, day month year` (`Intl.DateTimeFormat` browser locale, e.g. "Mon, 1 Jun 2027"), then either "Unavailable" (any closed row) or its windows formatted `formatTime(start)–formatTime(end)` sorted by start; a delete icon-button (aria-label "Remove override for {date}") calling `deleteDateOverride({ date })`; clicking the row body reopens the dialog prefilled for editing.
- Dialog (Base UI Dialog parts, per `client-header.tsx` usage): native `<input type="date">` (`min` = today, org-agnostic browser today is acceptable), an "Unavailable" `Checkbox`, and — when not unavailable — an interval editor: lines of two `TimeCombobox`es + remove buttons, an "Add interval" button using `nextInterval` (disabled at `null` or 10 windows, the zod cap).
- Prefill: opening for a NEW override seeds date = today and windows = `effectiveWindows(date, rules, exceptions)` (what the schedule already gives that date; empty result seeds `closed=true`). Changing the date re-seeds windows ONLY while the draft is untouched (a `touched` flag set by any window/unavailable edit). Opening to EDIT seeds from the existing rows.
- Save button: client-validates (`hasOverlap` → inline `OVERLAP_ERROR`; each window ordered → "End must be after start."; open needs ≥1 window) then calls `setDateOverride({ date, closed, windows })`; success closes + toasts; failure toasts the returned error. Editing an existing date and saving replaces it (same action — replace semantics).
- Page rewrite (`availability/page.tsx`): server component fetching `getAvailabilityAdmin()` + `getSchedulingSettings()`; renders the `max-w-2xl` column: `h1` "Availability", the timezone line `Times are shown in {timezone} · <Link href="/settings">Change in Settings</Link>` (muted, `timezone = settings?.timezone ?? "UTC"`), `<WeeklyHours rules={rules} />`, `<DateOverrides rules={rules} exceptions={exceptions} />`.

- [ ] **Step 1: Implement the component and page; delete the legacy editor; remove the two dead actions + two dead schemas and their tests** (after the grep confirms no other consumers).

- [ ] **Step 2: Verify**

Run: `npm run verify` and `npm run test:integration` — expected PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: date overrides dialog + availability page rewrite; drop legacy editor"
```

---

### Task 9: Final verification

- [ ] **Step 1: Full suites** — `npm run verify` + `npm run test:integration`, both green.
- [ ] **Step 2: Browser smoke** (dev server; login `demo@rolloutos.local` / `Password123!`): edit an interval via dropdown and via typing ("9:15pm"); overlap edit shows the inline message and doesn't save; `+` on empty and full days; copy hours to two days (targets overwritten); add a date override with two windows; mark a date Unavailable; delete an override; keyboard-only pass over one interval edit; confirm `/bookings` calendar reflects a changed weekly window.
- [ ] **Step 3:** `graphify update .`
- [ ] **Step 4: Self-review against the spec, push, PR** titled `feat: availability editor — Calendly-style weekly hours + date overrides`, body summarizing the sections above, ending with the repo's generated-with line.
