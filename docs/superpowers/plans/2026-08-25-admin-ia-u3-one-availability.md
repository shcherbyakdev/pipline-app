# Admin IA — U3: One Availability page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hours are edited in exactly one place — `/availability` — for team members AND hourly spaces: an owner switcher with a People cluster and a Spaces cluster, `?staff=` / `?space=` deep links, no redirect for rentals-only orgs (a nights-only org gets an explanatory empty state instead), and a space's detail page shows a one-line summary of its weekly hours with an "Edit hours →" link instead of a second editor.

**Architecture:** Two pure modules carry the logic and the tests — `availability-owner.ts` (`resolveOwner` with the page's forgiving fallback order, `ownerHref`, `availabilityOwnerOf`) and `hours-summary.ts` (`summarizeWeekly`, the grouped "Mon–Fri 9:00–17:00 · Sat 10:00–14:00" line). `OwnerTabs` is a sibling of `StaffTabs` (which stays for the Bookings week header) sharing its segmented-link classes. The Availability page resolves the owner and mounts the existing `WeeklyHours`/`DateOverrides` editors with `{ staffId }` or `{ rentalOfferingId }` — the editors and their actions already support both owners since H2. `availability/layout.tsx` (the `!offersAppointments → /bookings` redirect) is deleted. `setupChecklist` gains `hourlySpaceCount`. No data model, RPC or migration changes.

**Tech Stack:** Next.js 15 App Router (read `node_modules/next/dist/docs/` before touching routes), React 19, Supabase JS (RLS-scoped), Hugeicons free set (`House01Icon`), Vitest 4 in a Node environment (`*.test.ts` only — no DOM tests exist in this repo), ESLint + `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-08-25-admin-ia-mode-separation-design.md` §3 (One Availability page) and the "Set hours" row of §4. Read it first; ruling 4 is binding.

## Global Constraints

- **Base branch:** `main` (U2 merged as fd5e61b). Work on `feat/ia-u3` in worktree `.claude/worktrees/ia-u3` (create it with superpowers:using-git-worktrees). `next dev` inside a nested worktree needs `--webpack`.
- **Code identifiers do not change:** `rental_*`, `rentalOfferingId`, `OfferingRow`, `listOfferings`, `getOfferingAvailabilityAdmin`, `/rentals` — copy only.
- **Forbidden words in provider-facing admin copy:** `rental`, `rentals`, `offering`, `offerings` (any case). Channel words come from `src/features/orgs/vocab.ts` (`SPACES.nav`, and the two new keys below); neutral words ("Opening hours", "Edit hours →", "People", "Whose hours", "Closed — no hours set") stay inline (U1 ruling). `admin-copy.test.ts` guards the SOURCE of each listed surface with a `>…<` regex, so also keep those words out of code comments in the two files this plan adds to `SURFACES` — say "space" / "space row".
- **Owner order** (spec §3): a shape-valid `?staff=` naming an active member → a shape-valid `?space=` naming an active **hourly** space → first active member → first active hourly space → `null`. People are candidates only when the org sells appointments (`eff.offersAppointments`): every org has a staff row (0041 backfill) but a rentals-only org's is not bookable and must not show up as "hours".
- **`OwnerTabs`** renders only when `people.length + spaces.length ≥ 2` (the solo rule, extended); `aria-label="Whose hours"`; hrefs `/availability?staff=<id>` / `/availability?space=<id>`; People items = colour dot + name (as `StaffTabs`), Spaces items = 12px `House01Icon` + name; a hairline separates the clusters when both are non-empty.
- **No redirect.** `src/app/(dashboard)/availability/layout.tsx` is deleted; `src/app/(dashboard)/layout.tsx` already calls `requireOrg()` (auth is not weakened). A `null` owner renders copy, never `redirect()`/`notFound()`.
- **Hours are edited on `/availability` only.** The space detail page's inline `WeeklyHours`/`DateOverrides` block becomes a summary card; `revalidateOwner` in `scheduling/actions.ts` revalidates `/availability` for BOTH owners and additionally `/rentals/<id>` for a space (the card).
- **Tests:** Vitest Node env, `src/**/*.test.ts` only. No migrations. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. After each task: `npx vitest run <touched dirs>` + `npm run typecheck` + `npx eslint <changed files>` green before committing; `npm run verify` once in Task 4; `graphify update .` at the end.

---

## File structure

| File | Responsibility |
|---|---|
| `src/features/scheduling/availability-owner.ts` (create) + `.test.ts` | `Owner`, `resolveOwner()`, `ownerHref()`, `availabilityOwnerOf()` — pure |
| `src/features/scheduling/hours-summary.ts` (create) + `.test.ts` | `summarizeWeekly()`, `NO_HOURS` — pure |
| `src/features/orgs/vocab.ts` (modify) + `vocab.test.ts` | `SPACES.hoursNote`, `SPACES.hoursNightsOnly` |
| `src/features/scheduling/setup-checklist.ts` (modify) + `.test.ts` | `hourlySpaceCount` joins the "Set hours" condition |
| `src/app/(dashboard)/bookings/page.tsx` (modify, one line) | passes `hourlySpaceCount` |
| `src/features/scheduling/components/weekly-hours.tsx` (modify, one comment) | weekday-label ownership note |
| `src/features/scheduling/components/staff-tabs.tsx` (modify) | exports `SEGMENTED_NAV_CLASS` / `segmentedItemClass()`; behaviour unchanged |
| `src/features/scheduling/components/owner-tabs.tsx` (create) | the two-cluster owner switcher |
| `src/app/(dashboard)/availability/page.tsx` (rewrite) | resolves the owner, mounts the editors for either owner, two empty states |
| `src/app/(dashboard)/availability/layout.tsx` (delete) | the redirect guard |
| `src/features/scheduling/actions.ts` (modify `revalidateOwner`) | both paths refresh after an edit |
| `src/components/shell/nav.ts` (modify, one comment) | Availability row's "until U3" note |
| `src/features/orgs/admin-copy.test.ts` (modify) | `SURFACES` gains the page + `owner-tabs.tsx` |
| `src/app/(dashboard)/rentals/[id]/page.tsx` (modify) | hourly spaces: summary card + "Edit hours →" instead of the editors |

---

### Task 1: Pure seams — owner resolution, hours summary, vocab keys, checklist `hourlySpaceCount`

**Files:**
- Create: `src/features/scheduling/availability-owner.ts`, `src/features/scheduling/availability-owner.test.ts`
- Create: `src/features/scheduling/hours-summary.ts`, `src/features/scheduling/hours-summary.test.ts`
- Modify: `src/features/orgs/vocab.ts`, `src/features/orgs/vocab.test.ts`
- Modify: `src/features/scheduling/setup-checklist.ts`, `src/features/scheduling/setup-checklist.test.ts`
- Modify: `src/app/(dashboard)/bookings/page.tsx` (the `setupChecklist({...})` call, ≈ line 109)
- Modify: `src/features/scheduling/components/weekly-hours.tsx` (the comment above `WEEKDAY_ORDER`, ≈ line 28)

**Interfaces:**
- Consumes: `AvailabilityOwner` from `src/features/scheduling/schema.ts` (`{ staffId: string } | { rentalOfferingId: string }`), `RuleRow` shape `{ weekday: number; startTime: string; endTime: string }` from `scheduling/queries.ts` (times are org-local `"HH:MM"` or, straight off PostgREST, `"HH:MM:SS"` — both must work), `OrgMode` from `orgs/mode.ts`.
- Produces (Tasks 2 and 3 rely on these exact names):

```ts
// availability-owner.ts
export type Owner =
  | { kind: "staff"; id: string; name: string; color: string }
  | { kind: "space"; id: string; name: string };
export type OwnerParams = { staff?: string; space?: string };
export type PersonLike = { id: string; name: string; color: string };   // StaffRow satisfies it
export type SpaceLike = { id: string; name: string };                    // OfferingRow satisfies it
export function resolveOwner(params: OwnerParams, people: readonly PersonLike[], spaces: readonly SpaceLike[]): Owner | null;
export function ownerHref(owner: { kind: Owner["kind"]; id: string }): string;
export function availabilityOwnerOf(owner: Owner): AvailabilityOwner;
// hours-summary.ts
export const NO_HOURS = "Closed — no hours set";
export function summarizeWeekly(rules: readonly { weekday: number; startTime: string; endTime: string }[]): string;
// vocab.ts
SPACES.hoursNote; SPACES.hoursNightsOnly;   // strings
// setup-checklist.ts
ChecklistInput.hourlySpaceCount: number;
```

- [ ] **Step 1: Write the failing owner tests**

Create `src/features/scheduling/availability-owner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { availabilityOwnerOf, ownerHref, resolveOwner } from "./availability-owner";

const ANNA = { id: "11111111-1111-4111-8111-111111111111", name: "Anna", color: "#f00" };
const BEN = { id: "22222222-2222-4222-8222-222222222222", name: "Ben", color: "#0f0" };
const ROOM = { id: "33333333-3333-4333-8333-333333333333", name: "Room A" };
const STUDIO = { id: "44444444-4444-4444-8444-444444444444", name: "Studio" };
const STALE = "99999999-9999-4999-8999-999999999999";

describe("resolveOwner (spec §3 — people and hourly spaces are one kind of owner)", () => {
  it("a listed ?staff= wins", () => {
    expect(resolveOwner({ staff: BEN.id }, [ANNA, BEN], [ROOM])).toEqual({ kind: "staff", ...BEN });
  });
  it("a listed ?space= wins when ?staff= is absent or unlisted", () => {
    expect(resolveOwner({ space: STUDIO.id }, [ANNA], [ROOM, STUDIO])).toEqual({ kind: "space", ...STUDIO });
    expect(resolveOwner({ staff: STALE, space: ROOM.id }, [ANNA], [ROOM])).toEqual({ kind: "space", ...ROOM });
  });
  it("both listed: the person wins", () => {
    expect(resolveOwner({ staff: ANNA.id, space: ROOM.id }, [ANNA], [ROOM])?.kind).toBe("staff");
  });
  it("no usable param: first person, else first space, else null", () => {
    expect(resolveOwner({}, [BEN, ANNA], [ROOM])).toEqual({ kind: "staff", ...BEN });
    expect(resolveOwner({ staff: STALE }, [], [STUDIO, ROOM])).toEqual({ kind: "space", ...STUDIO });
    expect(resolveOwner({ space: ROOM.id }, [], [])).toBeNull();
  });
  it("a malformed id never matches, even when a listed id equals the raw string", () => {
    expect(resolveOwner({ staff: "not-a-uuid" }, [BEN, { ...ANNA, id: "not-a-uuid" }], [])).toEqual({ kind: "staff", ...BEN });
    expect(resolveOwner({ space: "not-a-uuid" }, [], [STUDIO, { ...ROOM, id: "not-a-uuid" }])).toEqual({ kind: "space", ...STUDIO });
  });
  it("keeps only the fields the page needs off a wide row", () => {
    const wide = { ...ANNA, slug: "anna", email: null, active: true, sortOrder: 0, serviceIds: [] };
    expect(resolveOwner({}, [wide], [])).toEqual({ kind: "staff", id: ANNA.id, name: "Anna", color: "#f00" });
    const wideSpace = { ...ROOM, rangeMode: "hours", active: true, unitCount: 2 };
    expect(resolveOwner({}, [], [wideSpace])).toEqual({ kind: "space", id: ROOM.id, name: "Room A" });
  });
});

describe("ownerHref / availabilityOwnerOf", () => {
  it("builds the tab and edit links", () => {
    expect(ownerHref({ kind: "staff", id: ANNA.id })).toBe(`/availability?staff=${ANNA.id}`);
    expect(ownerHref({ kind: "space", id: ROOM.id })).toBe(`/availability?space=${ROOM.id}`);
  });
  it("maps to the editor's staffId XOR rentalOfferingId", () => {
    expect(availabilityOwnerOf({ kind: "staff", ...ANNA })).toEqual({ staffId: ANNA.id });
    expect(availabilityOwnerOf({ kind: "space", ...ROOM })).toEqual({ rentalOfferingId: ROOM.id });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/scheduling/availability-owner.test.ts`
Expected: FAIL — "Failed to resolve import ./availability-owner".

- [ ] **Step 3: Implement `availability-owner.ts`**

Create `src/features/scheduling/availability-owner.ts`:

```ts
import type { AvailabilityOwner } from "@/features/scheduling/schema";

/* Whose hours the Availability page shows (admin IA spec §3). Team members
   and hourly spaces are the same kind of owner here (ruling 4 — TIMIFY and
   Skedda treat staff and rooms as one lane type). Pure, so the fallback
   order is tested without a page around it. */
export type Owner =
  | { kind: "staff"; id: string; name: string; color: string }
  | { kind: "space"; id: string; name: string };

export type OwnerParams = { staff?: string; space?: string };
/** Structural minimums — a StaffRow / an OfferingRow satisfy them. */
export type PersonLike = { id: string; name: string; color: string };
export type SpaceLike = { id: string; name: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Order: a shape-valid `?staff=` naming a listed person → a shape-valid
    `?space=` naming a listed space → first person → first space → null.
    Callers pass ACTIVE people and ACTIVE HOURLY spaces only; anything else
    (a stale link, another org's id, a deactivated owner, a nightly space)
    quietly falls through — the page's existing forgiving rule, never a 404. */
export function resolveOwner(
  params: OwnerParams,
  people: readonly PersonLike[],
  spaces: readonly SpaceLike[],
): Owner | null {
  const wantedPerson =
    params.staff && UUID_RE.test(params.staff) ? people.find((p) => p.id === params.staff) : undefined;
  if (wantedPerson) return person(wantedPerson);
  const wantedSpace =
    params.space && UUID_RE.test(params.space) ? spaces.find((s) => s.id === params.space) : undefined;
  if (wantedSpace) return space(wantedSpace);
  if (people[0]) return person(people[0]);
  if (spaces[0]) return space(spaces[0]);
  return null;
}

function person(p: PersonLike): Owner {
  return { kind: "staff", id: p.id, name: p.name, color: p.color };
}
function space(s: SpaceLike): Owner {
  return { kind: "space", id: s.id, name: s.name };
}

/** The `?staff=` / `?space=` link for an owner — OwnerTabs and the space
    detail page's "Edit hours →" both build their hrefs here. */
export function ownerHref(owner: { kind: Owner["kind"]; id: string }): string {
  return owner.kind === "staff" ? `/availability?staff=${owner.id}` : `/availability?space=${owner.id}`;
}

/** The editors' `owner` prop: a staff id XOR a space (rental offering) id. */
export function availabilityOwnerOf(owner: Owner): AvailabilityOwner {
  return owner.kind === "staff" ? { staffId: owner.id } : { rentalOfferingId: owner.id };
}
```

- [ ] **Step 4: Run the owner tests to verify they pass**

Run: `npx vitest run src/features/scheduling/availability-owner.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the failing hours-summary tests**

Create `src/features/scheduling/hours-summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NO_HOURS, summarizeWeekly } from "./hours-summary";

const w = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime });
const NINE_TO_FIVE = (d: number) => w(d, "09:00", "17:00");

describe("summarizeWeekly (spec §3 — the space detail card)", () => {
  it("no rules → the closed line", () => {
    expect(summarizeWeekly([])).toBe("Closed — no hours set");
    expect(NO_HOURS).toBe("Closed — no hours set");
  });
  it("groups consecutive weekdays with identical windows; runs are joined with a middle dot", () => {
    const rules = [1, 2, 3, 4, 5].map(NINE_TO_FIVE).concat(w(6, "10:00", "14:00"));
    expect(summarizeWeekly(rules)).toBe("Mon–Fri 9:00–17:00 · Sat 10:00–14:00");
  });
  it("a day without hours or with different hours breaks the run", () => {
    expect(summarizeWeekly([1, 2, 3, 5].map(NINE_TO_FIVE))).toBe("Mon–Wed 9:00–17:00 · Fri 9:00–17:00");
    expect(summarizeWeekly([NINE_TO_FIVE(1), NINE_TO_FIVE(2), w(3, "09:00", "13:00")])).toBe(
      "Mon–Tue 9:00–17:00 · Wed 9:00–13:00",
    );
  });
  it("several windows in one day are joined with a comma, sorted by start", () => {
    expect(summarizeWeekly([w(1, "14:00", "18:00"), w(1, "09:00", "12:00")])).toBe("Mon 9:00–12:00, 14:00–18:00");
  });
  it("the week runs Monday to Sunday", () => {
    expect(summarizeWeekly([w(6, "10:00", "14:00"), w(0, "10:00", "14:00")])).toBe("Sat–Sun 10:00–14:00");
    expect(summarizeWeekly([w(0, "10:00", "14:00"), w(1, "10:00", "14:00")])).toBe("Mon 10:00–14:00 · Sun 10:00–14:00");
  });
  it("accepts PostgREST's HH:MM:SS and unsorted input", () => {
    expect(summarizeWeekly([w(2, "09:00:00", "17:30:00"), w(1, "09:00:00", "17:30:00")])).toBe("Mon–Tue 9:00–17:30");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/features/scheduling/hours-summary.test.ts`
Expected: FAIL — "Failed to resolve import ./hours-summary".

- [ ] **Step 7: Implement `hours-summary.ts`**

Create `src/features/scheduling/hours-summary.ts`:

```ts
/* One line that says when a space is open (admin IA spec §3): the space
   detail page shows this instead of a second hours editor. Pure. Times are
   org-local wall-clock strings as stored ("HH:MM", or "HH:MM:SS" straight
   off PostgREST) — rendered 24-hour without the leading zero, which is
   what the spec's example shows and what every locale reads. */
export type RuleLike = { weekday: number; startTime: string; endTime: string };

export const NO_HOURS = "Closed — no hours set";

// Monday-first, like the editor. Three-letter labels are this module's
// own; weekly-hours.tsx keeps its full/dotted sets for the editor rows.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function short(t: string): string {
  return `${Number(t.slice(0, 2))}:${t.slice(3, 5)}`;
}

/** "Mon–Fri 9:00–17:00 · Sat 10:00–14:00": consecutive weekdays with
    identical windows collapse into a range, several windows in a day are
    joined with ", ", days without hours are skipped (and break a run). */
export function summarizeWeekly(rules: readonly RuleLike[]): string {
  const byDay = new Map<number, string>();
  for (const day of WEEKDAY_ORDER) {
    const windows = rules
      .filter((r) => r.weekday === day)
      .map((r) => ({ start: r.startTime, end: r.endTime }))
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    if (windows.length > 0) byDay.set(day, windows.map((x) => `${short(x.start)}–${short(x.end)}`).join(", "));
  }
  if (byDay.size === 0) return NO_HOURS;

  const parts: string[] = [];
  let i = 0;
  while (i < WEEKDAY_ORDER.length) {
    const text = byDay.get(WEEKDAY_ORDER[i]);
    if (text === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < WEEKDAY_ORDER.length && byDay.get(WEEKDAY_ORDER[j + 1]) === text) j++;
    const from = WEEKDAY_SHORT[WEEKDAY_ORDER[i]];
    const to = WEEKDAY_SHORT[WEEKDAY_ORDER[j]];
    parts.push(`${j === i ? from : `${from}–${to}`} ${text}`);
    i = j + 1;
  }
  return parts.join(" · ");
}
```

- [ ] **Step 8: Run the hours-summary tests to verify they pass**

Run: `npx vitest run src/features/scheduling/hours-summary.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Point weekly-hours.tsx's label comment at the new owner**

In `src/features/scheduling/components/weekly-hours.tsx` replace the two comment lines above `const WEEKDAY_ORDER`:

```ts
// Local to this file — the old editor's copies of these arrays are deleted
// alongside it in Task 8, so nothing else in the app owns weekday labels.
```

with

```ts
// Local to this file (the old editor's copies went with it). The only
// other weekday labels are hours-summary.ts's three-letter set for the
// space detail card's one-line summary.
```

- [ ] **Step 10: Vocab — write the failing test, then add the keys**

Append to the `describe("SPACES vocabulary", …)` block in `src/features/orgs/vocab.test.ts`:

```ts
  it("explains hours for nightly/daily spaces on the Availability page (spec §3)", () => {
    expect(SPACES.hoursNote).toBe(
      "Nightly and daily spaces use check-in and check-out times instead — set those on the space.",
    );
    expect(SPACES.hoursNightsOnly).toBe(
      "Nightly and daily spaces use check-in and check-out times, set on each space. Hourly spaces and team members set their weekly hours here.",
    );
  });
```

Run: `npx vitest run src/features/orgs/vocab.test.ts` → FAIL (`hoursNote` undefined).

Then in `src/features/orgs/vocab.ts`, after the `add: "Add a space",` line inside `SPACES`, add:

```ts
  // ---- /availability (admin IA spec §3, ruling 4: hours are edited in one
  // place for people and hourly spaces; nightly/daily spaces have none).
  /** Second intro line when a space's hours are on screen and the org also has nightly/daily spaces. */
  hoursNote: "Nightly and daily spaces use check-in and check-out times instead — set those on the space.",
  /** The page with nothing to edit (a nights/days-only org); followed by a link whose text is SPACES.nav. */
  hoursNightsOnly:
    "Nightly and daily spaces use check-in and check-out times, set on each space. Hourly spaces and team members set their weekly hours here.",
```

Run: `npx vitest run src/features/orgs/vocab.test.ts` → PASS.

- [ ] **Step 11: Checklist — update the tests, then the condition**

Rewrite `src/features/scheduling/setup-checklist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupChecklist } from "./setup-checklist";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const nothing = { serviceCount: 0, spaceCount: 0, hourlySpaceCount: 0, ownersWithHours: 0, published: false };

describe("setupChecklist (admin IA spec §4)", () => {
  it("both modes: service, space, hours, publish — in that order, all undone", () => {
    const items = setupChecklist({ mode: BOTH, ...nothing });
    expect(items.map((i) => i.id)).toEqual(["service", "space", "hours", "publish"]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.map((i) => i.label)).toEqual(["Add a service", "Add a space", "Set hours", "Publish your page"]);
    expect(items.map((i) => i.href)).toEqual(["/services?new=1", "/rentals?new=1", "/availability", "/booking-page"]);
  });
  it("appointments-only: no space item", () => {
    expect(setupChecklist({ mode: APPTS, ...nothing }).map((i) => i.id)).toEqual(["service", "hours", "publish"]);
  });
  it("rentals-only, nights/days only: space and publish — there are no weekly hours to set", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing }).map((i) => i.id)).toEqual(["space", "publish"]);
  });
  it("rentals-only with an hourly space: hours joins (U3 — /availability serves hourly spaces)", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing, spaceCount: 1, hourlySpaceCount: 1 }).map((i) => i.id)).toEqual([
      "space", "hours", "publish",
    ]);
  });
  it("ticks follow the counts", () => {
    const items = setupChecklist({ mode: BOTH, serviceCount: 2, spaceCount: 0, hourlySpaceCount: 0, ownersWithHours: 1, published: true });
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({
      service: true, space: false, hours: true, publish: true,
    });
  });
});
```

Run: `npx vitest run src/features/scheduling/setup-checklist.test.ts` → FAIL on the new rentals-with-hourly case (hours item missing).

Then in `src/features/scheduling/setup-checklist.ts`:

```ts
export type ChecklistInput = {
  mode: OrgMode;
  serviceCount: number;      // active services
  spaceCount: number;        // active spaces (rental offerings)
  hourlySpaceCount: number;  // of those, booked by the hour — they set weekly hours on /availability (U3)
  ownersWithHours: number;   // team members or hourly spaces with ≥1 weekly rule
  published: boolean;        // booking page has a published document
};
```

and replace the "U1: appointments only…" comment + condition with:

```ts
  // Hours exist for team members and hourly spaces (spec §3, ruling 4);
  // a nights/days-only org sets check-in/out times on the space instead.
  if (i.mode.offersAppointments || i.hourlySpaceCount > 0) {
    items.push({ id: "hours", label: WELCOME.setHours, href: "/availability", done: i.ownersWithHours > 0 });
  }
```

Run: `npx vitest run src/features/scheduling/setup-checklist.test.ts` → PASS (5 tests).

- [ ] **Step 12: The Bookings page passes the count**

In `src/app/(dashboard)/bookings/page.tsx`, the `setupChecklist({ … })` call (≈ line 109) gains one line after `spaceCount: spaces.length,`:

```ts
      hourlySpaceCount: spaces.filter((o) => o.rangeMode === "hours").length,
```

(`spaces` is already the active subset.)

- [ ] **Step 13: Typecheck, lint, commit**

Run: `npm run typecheck && npx eslint src/features/scheduling/availability-owner.ts src/features/scheduling/availability-owner.test.ts src/features/scheduling/hours-summary.ts src/features/scheduling/hours-summary.test.ts src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/features/scheduling/setup-checklist.ts src/features/scheduling/setup-checklist.test.ts "src/app/(dashboard)/bookings/page.tsx" src/features/scheduling/components/weekly-hours.tsx && npx vitest run src/features/scheduling src/features/orgs`
Expected: clean; all scheduling + orgs unit tests pass.

```bash
git add src/features/scheduling/availability-owner.ts src/features/scheduling/availability-owner.test.ts src/features/scheduling/hours-summary.ts src/features/scheduling/hours-summary.test.ts src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/features/scheduling/setup-checklist.ts src/features/scheduling/setup-checklist.test.ts "src/app/(dashboard)/bookings/page.tsx" src/features/scheduling/components/weekly-hours.tsx
git commit -m "feat(availability): pure seams — owner resolution, weekly-hours summary, hours vocab, checklist counts hourly spaces

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `OwnerTabs` and the one Availability page; the redirect is gone

**Files:**
- Modify: `src/features/scheduling/components/staff-tabs.tsx`
- Create: `src/features/scheduling/components/owner-tabs.tsx`
- Rewrite: `src/app/(dashboard)/availability/page.tsx`
- Delete: `src/app/(dashboard)/availability/layout.tsx`
- Modify: `src/features/scheduling/actions.ts` (`revalidateOwner`, ≈ lines 56–59)
- Modify: `src/components/shell/nav.ts` (comment above the `/availability` row, ≈ lines 61–63)
- Modify: `src/features/orgs/admin-copy.test.ts` (`SURFACES`)

**Interfaces:**
- Consumes: `resolveOwner`, `ownerHref`, `availabilityOwnerOf`, `Owner`, `PersonLike`, `SpaceLike` (Task 1); `SPACES.hoursNote`, `SPACES.hoursNightsOnly`, `SPACES.nav` (Task 1); `listActiveStaff(): Promise<StaffRow[]>` (`staff-queries.ts`); `listOfferings(): Promise<OfferingRow[]>` (`rentals/queries.ts` — ALL rows, filter `active` yourself); `getAvailabilityAdmin(staffId, fromDate)` and `getOfferingAvailabilityAdmin(offeringId, fromDate)` (both return `{ rules: RuleRow[]; exceptions: ExceptionRow[] }`); `WeeklyHours({ owner: AvailabilityOwner; rules })`, `DateOverrides({ owner; timeZone; rules; exceptions })`; `requireOrg()` → `{ org }`, `getDashboardFlags(org.id)`, `effectiveMode(flags, modeOf(org))` (the Bookings page's idiom, `bookings/page.tsx` ≈ lines 74–79).
- Produces:

```ts
// staff-tabs.tsx (added exports; StaffTabs itself unchanged in behaviour)
export const SEGMENTED_NAV_CLASS: string;
export function segmentedItemClass(active: boolean): string;
// owner-tabs.tsx
export function OwnerTabs(props: { people: readonly PersonLike[]; spaces: readonly SpaceLike[]; current: Owner }): JSX.Element | null;
```

- [ ] **Step 1: Share the segmented-link classes from `StaffTabs`**

Rewrite `src/features/scheduling/components/staff-tabs.tsx`:

```tsx
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { StaffRow } from "@/features/scheduling/staff-queries";

/* The segmented-link idiom's classes — shared with OwnerTabs (the
   Availability page's people + spaces switcher) so the two rows look
   identical without one component growing modes. */
export const SEGMENTED_NAV_CLASS =
  "border-border bg-muted/40 flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border p-0.5";
export function segmentedItemClass(active: boolean): string {
  return cn(
    "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
    active ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
  );
}

/* Whose week am I looking at? A segmented row of links — navigation, not
   state, so the selected person survives a refresh and can be shared as a
   URL. Used by the Bookings week header; the Availability page has its own
   OwnerTabs (people AND hourly spaces).

   Solo rule: with one active member there is nothing to choose, so the caller
   renders nothing at all and the page looks exactly as it did before the team
   slice. Guarded here too, so no caller can accidentally show a one-tab
   switcher. */
export function StaffTabs({
  staff,
  current,
  hrefFor,
}: {
  staff: StaffRow[];
  current: string;
  hrefFor: (id: string) => string;
}) {
  if (staff.length < 2) return null;
  return (
    <nav aria-label="Team member" className={SEGMENTED_NAV_CLASS}>
      {staff.map((person) => {
        const active = person.id === current;
        return (
          <Link
            key={person.id}
            href={hrefFor(person.id)}
            aria-current={active ? "page" : undefined}
            className={segmentedItemClass(active)}
          >
            <span
              aria-hidden
              style={{ background: person.color }}
              className="size-2 shrink-0 rounded-full"
            />
            {person.name}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create `OwnerTabs`**

Create `src/features/scheduling/components/owner-tabs.tsx`:

```tsx
import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { SPACES } from "@/features/orgs/vocab";
import {
  ownerHref,
  type Owner,
  type PersonLike,
  type SpaceLike,
} from "@/features/scheduling/availability-owner";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "./staff-tabs";

/* Whose hours am I editing? StaffTabs' segmented-link idiom with two
   clusters — People (colour dot) then Spaces (house icon) — separated by a
   hairline (admin IA spec §3, ruling 4: team members and hourly spaces are
   one kind of owner). Navigation, not state, so the choice survives a
   refresh and can be shared as a URL.

   Solo rule, extended: fewer than two owners in total means nothing to
   choose, so render nothing — a one-person team or a single hourly space
   sees the page exactly as before. */
export function OwnerTabs({
  people,
  spaces,
  current,
}: {
  people: readonly PersonLike[];
  spaces: readonly SpaceLike[];
  current: Owner;
}) {
  if (people.length + spaces.length < 2) return null;
  const isCurrent = (kind: Owner["kind"], id: string) => current.kind === kind && current.id === id;
  return (
    <nav aria-label="Whose hours" className={SEGMENTED_NAV_CLASS}>
      {people.length > 0 ? (
        <span role="group" aria-label="People" className="flex items-center gap-0.5">
          {people.map((p) => {
            const active = isCurrent("staff", p.id);
            return (
              <Link
                key={p.id}
                href={ownerHref({ kind: "staff", id: p.id })}
                aria-current={active ? "page" : undefined}
                className={segmentedItemClass(active)}
              >
                <span aria-hidden style={{ background: p.color }} className="size-2 shrink-0 rounded-full" />
                {p.name}
              </Link>
            );
          })}
        </span>
      ) : null}
      {people.length > 0 && spaces.length > 0 ? (
        <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
      ) : null}
      {spaces.length > 0 ? (
        <span role="group" aria-label={SPACES.nav} className="flex items-center gap-0.5">
          {spaces.map((s) => {
            const active = isCurrent("space", s.id);
            return (
              <Link
                key={s.id}
                href={ownerHref({ kind: "space", id: s.id })}
                aria-current={active ? "page" : undefined}
                className={segmentedItemClass(active)}
              >
                <HugeiconsIcon icon={House01Icon} size={12} className="shrink-0" aria-hidden />
                {s.name}
              </Link>
            );
          })}
        </span>
      ) : null}
    </nav>
  );
}
```

- [ ] **Step 3: Rewrite the Availability page**

Replace the whole of `src/app/(dashboard)/availability/page.tsx` with:

```tsx
import Link from "next/link";
import { getAvailabilityAdmin, getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { listActiveStaff } from "@/features/scheduling/staff-queries";
import { listOfferings } from "@/features/rentals/queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { effectiveMode, modeOf } from "@/features/orgs/mode";
import { SPACES } from "@/features/orgs/vocab";
import { availabilityOwnerOf, resolveOwner } from "@/features/scheduling/availability-owner";
import { WeeklyHours } from "@/features/scheduling/components/weekly-hours";
import { DateOverrides } from "@/features/scheduling/components/date-overrides";
import { OwnerTabs } from "@/features/scheduling/components/owner-tabs";
import { dateInZone } from "@/features/scheduling/slots";

/* One Availability page for people AND hourly spaces (admin IA spec §3,
   ruling 4). Nightly/daily spaces have no weekly hours — their check-in and
   check-out times live on the space — so they are never an owner here, and
   a nights/days-only org gets an explanation instead of a redirect. */
export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; space?: string }>;
}) {
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const eff = effectiveMode(flags, modeOf(org));

  // People are owners only where the org sells appointments: every org has
  // a staff row (0041 backfill), but a spaces-only org's is not bookable
  // and must not surface here as hours to set.
  const [params, people, spaceRows, settings] = await Promise.all([
    searchParams,
    eff.offersAppointments ? listActiveStaff() : Promise.resolve([]),
    eff.offersRentals ? listOfferings() : Promise.resolve([]),
    getSchedulingSettings(),
  ]);
  const timezone = settings?.timezone ?? "UTC";
  const activeSpaces = spaceRows.filter((o) => o.active);
  const hourlySpaces = activeSpaces.filter((o) => o.rangeMode === "hours");
  const hasRangeSpaces = activeSpaces.some((o) => o.rangeMode !== "hours");

  // Whose hours are on screen — see resolveOwner for the fallback order.
  const owner = resolveOwner(params, people, hourlySpaces);

  if (!owner) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        {eff.offersAppointments ? (
          <p className="text-muted-foreground text-sm">
            Nobody on the team is active right now.{" "}
            <Link href="/team" className="hover:text-foreground underline underline-offset-3">
              Reactivate someone
            </Link>{" "}
            to set hours.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {SPACES.hoursNightsOnly}{" "}
            <Link href="/rentals" className="hover:text-foreground underline underline-offset-3">
              Open {SPACES.nav} →
            </Link>
          </p>
        )}
      </div>
    );
  }

  // Org-local today: override dates live in the org's timezone, so "still
  // upcoming" has to be judged there, not in UTC.
  const today = dateInZone(new Date(), timezone);
  const { rules, exceptions } =
    owner.kind === "staff"
      ? await getAvailabilityAdmin(owner.id, today)
      : await getOfferingAvailabilityAdmin(owner.id, today);
  const editorOwner = availabilityOwnerOf(owner);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          Times are shown in {timezone} ·{" "}
          <Link href="/booking-page" className="underline underline-offset-3 hover:text-foreground">
            Change on Booking page
          </Link>
        </p>
        {owner.kind === "space" && hasRangeSpaces ? (
          <p className="text-muted-foreground text-sm">{SPACES.hoursNote}</p>
        ) : null}
        {/* Solo rule: one owner in total ⇒ no switcher (OwnerTabs renders
            nothing) and the page is identical to the pre-team one. */}
        <OwnerTabs people={people} spaces={hourlySpaces} current={owner} />
      </div>
      <WeeklyHours owner={editorOwner} rules={rules} />
      <DateOverrides owner={editorOwner} timeZone={timezone} rules={rules} exceptions={exceptions} />
    </div>
  );
}
```

- [ ] **Step 4: Delete the redirect layout**

```bash
git rm "src/app/(dashboard)/availability/layout.tsx"
```

Then confirm auth is still gated one level up: `grep -n "requireOrg" "src/app/(dashboard)/layout.tsx"` → one hit (line ≈ 10). Nothing else imported the deleted file (`grep -rn "availability/layout" src` → no hits).

- [ ] **Step 5: `revalidateOwner` refreshes both pages**

In `src/features/scheduling/actions.ts` replace

```ts
function revalidateOwner(o: Owner) {
  if (o.staffId) revalidatePath("/availability");
  else revalidatePath(`/rentals/${o.rentalOfferingId}`);
}
```

with

```ts
// Hours for both owners are edited on /availability (admin IA U3); a
// space's detail page only summarises them, but that summary must not go
// stale either.
function revalidateOwner(o: Owner) {
  revalidatePath("/availability");
  if (o.rentalOfferingId) revalidatePath(`/rentals/${o.rentalOfferingId}`);
}
```

- [ ] **Step 6: Nav comment and the copy guard**

In `src/components/shell/nav.ts` replace the three comment lines above the `/availability` row:

```ts
  // No channel: it stays for every mode. U3 makes it edit hours for people
  // AND hourly spaces and adds the nights-only empty state; until then a
  // rentals-only org sees its owner's staff hours here.
```

with

```ts
  // No channel: it stays for every mode — hours for people AND hourly
  // spaces are edited there (U3); a nights/days-only org gets an
  // explanatory empty state, never a redirect.
```

In `src/features/orgs/admin-copy.test.ts` append to `SURFACES` (before the closing `];`):

```ts
  "src/app/(dashboard)/availability/page.tsx",
  "src/features/scheduling/components/owner-tabs.tsx",
```

Run: `npx vitest run src/features/orgs/admin-copy.test.ts` → PASS (if the JSX-text regex trips on a comment, reword the comment — never the guard).

- [ ] **Step 7: Typecheck, lint, run the unit suites, commit**

Run: `npm run typecheck && npx eslint src/features/scheduling/components/staff-tabs.tsx src/features/scheduling/components/owner-tabs.tsx "src/app/(dashboard)/availability/page.tsx" src/features/scheduling/actions.ts src/components/shell/nav.ts src/features/orgs/admin-copy.test.ts && npx vitest run src/features/scheduling src/features/orgs src/components/shell`
Expected: clean; `nav.test.ts` still asserts Availability for every mode.

Smoke it in the browser before committing (dev server `npx next dev -p 3001 --webpack`, demo org `demo@rolloutos.local` / `Password123!`, Both mode): `/availability` shows the People cluster, a hairline and the hourly demo space; clicking the space tab loads `?space=<id>` with its own editor; `/availability?space=not-a-uuid` falls back to the first person; Settings › Business → untick Appointments → `/availability` shows ONLY the space (no owner staff row) and does not redirect; re-tick Appointments.

```bash
git add src/features/scheduling/components/staff-tabs.tsx src/features/scheduling/components/owner-tabs.tsx "src/app/(dashboard)/availability/page.tsx" src/features/scheduling/actions.ts src/components/shell/nav.ts src/features/orgs/admin-copy.test.ts
git commit -m "feat(availability): one page for people and hourly spaces — OwnerTabs, ?space= deep link, nights-only empty state, no redirect

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Space detail — hours summary card instead of a second editor

**Files:**
- Modify: `src/app/(dashboard)/rentals/[id]/page.tsx`

**Interfaces:**
- Consumes: `summarizeWeekly(rules)` (Task 1), `ownerHref({ kind: "space", id })` (Task 1), `getOfferingAvailabilityAdmin(offeringId)` (its `rules` half only), `OfferingRow.active`.
- Produces: nothing new.

- [ ] **Step 1: Replace the editor block with the card**

Rewrite `src/app/(dashboard)/rentals/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getOffering, listUnitsWithBlackouts, getOrgCurrency } from "@/features/rentals/queries";
import { formatDurationLabel } from "@/features/rentals/hourly";
import { OfferingDialog } from "@/features/rentals/components/offering-dialog";
import { UnitsEditor } from "@/features/rentals/components/units-editor";
import { Badge } from "@/components/ui/badge";
import { getOfferingAvailabilityAdmin } from "@/features/scheduling/queries";
import { summarizeWeekly } from "@/features/scheduling/hours-summary";
import { ownerHref } from "@/features/scheduling/availability-owner";
import { SPACES } from "@/features/orgs/vocab";

export default async function RentalDetailPage({ params }: PageProps<"/rentals/[id]">) {
  const { id } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (same idiom as programs/[id]/units/[unitId]).
  if (!z.uuid().safeParse(id).success) notFound();

  const offering = await getOffering(id);
  // RLS hides other orgs' rows — indistinguishable from a nonexistent id,
  // which is exactly the 404 we want.
  if (!offering) notFound();
  const units = await listUnitsWithBlackouts(id);
  const currency = await getOrgCurrency();

  const hourly = offering.rangeMode === "hours";
  const nightly = offering.rangeMode === "nights";

  // U3 (ruling 4): hours are edited on /availability; this page only
  // summarises the weekly rules. Overrides are not shown here, so the
  // exceptions half of the read is discarded and no timezone is needed.
  const rules = hourly ? (await getOfferingAvailabilityAdmin(offering.id)).rules : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
          {SPACES.back}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{offering.name}</h1>
              <Badge variant="outline">{hourly ? "Hourly" : nightly ? "Nightly" : "Daily"}</Badge>
              {!offering.active ? <Badge variant="outline">Inactive</Badge> : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {hourly
                ? `${formatDurationLabel(offering.minDurationMin!)}–${formatDurationLabel(offering.maxDurationMin!)} · every ${offering.slotIncrementMin} min`
                : nightly
                  ? `check-in ${offering.startTime} · check-out ${offering.endTime}`
                  : `pickup ${offering.startTime} · return ${offering.endTime}`}
            </p>
          </div>
          <OfferingDialog offering={offering} currency={currency} />
        </div>
      </div>
      <UnitsEditor offeringId={offering.id} units={units} />
      {hourly ? (
        <section
          aria-labelledby="opening-hours"
          className="border-border flex items-start justify-between gap-4 rounded-lg border p-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="opening-hours" className="text-sm font-medium">
              Opening hours
            </h2>
            <p className="text-muted-foreground text-sm">{summarizeWeekly(rules)}</p>
          </div>
          {/* /availability lists ACTIVE hourly spaces only, so an inactive
              one would silently land on another owner's hours — say so
              instead of linking. */}
          {offering.active ? (
            <Link
              href={ownerHref({ kind: "space", id: offering.id })}
              className="hover:text-foreground shrink-0 text-sm underline underline-offset-3"
            >
              Edit hours →
            </Link>
          ) : (
            <span className="text-muted-foreground shrink-0 text-sm">Reactivate to edit hours</span>
          )}
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, copy guard, commit**

Run: `npm run typecheck && npx eslint "src/app/(dashboard)/rentals/[id]/page.tsx" && npx vitest run src/features/orgs/admin-copy.test.ts`
Expected: clean (`WeeklyHours`, `DateOverrides`, `getSchedulingSettings`, `dateInZone` imports are gone — no unused-import lint).

Browser check (same dev server): `/rentals/<hourly id>` shows the "Opening hours" card with a grouped line such as `Mon–Fri 9:00–17:00`; add a Saturday window on `/availability?space=<id>` and come back — the card updated (`revalidateOwner`, Task 2); "Edit hours →" lands on `/availability?space=<id>`; a nightly space's page has no card and keeps its check-in/check-out sub-line.

```bash
git add "src/app/(dashboard)/rentals/[id]/page.tsx"
git commit -m "feat(spaces): detail page summarises opening hours and links to /availability — no second editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Whole-slice verification and browser QA

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: lint 0 errors (1 pre-existing warning), typecheck clean, all tests pass (U2 baseline 922; this slice adds ≈ 17).

- [ ] **Step 2: Browser QA matrix**

Dev server `npx next dev -p 3001 --webpack`. Demo org (`demo@rolloutos.local` / `Password123!`; it has ONE staff row and one hourly space — add a second team member on `/team` first so the People cluster has two entries, and add a nightly space to exercise the note; mode via Settings › Business — restore Both at the end). For the nights-only state use the `qa-u1@rolloutos.local` / `Password123!` org (both-mode, empty) or deactivate the demo hourly space temporarily. Screenshots to `.playwright-mcp/u3-<mode>-<check>.png`; results to `.superpowers/sdd/<this plan's workspace>/qa-ledger.md`.

| check | expected |
|---|---|
| Both-mode `/availability` | People cluster (colour dots) · hairline · Spaces cluster (house icon + name); first person selected; `aria-label="Whose hours"` on the nav |
| Click the space tab | URL `?space=<id>`; its weekly hours + date overrides; the intro's second line "Nightly and daily spaces use check-in…" only while a nightly/daily space is active |
| Edit a window on the space, then open `/rentals/<id>` | "Opening hours" card reads the grouped summary (e.g. `Mon–Fri 9:00–17:00 · Sat 10:00–14:00`); "Edit hours →" returns to `?space=<id>`; no inline editor on the detail page |
| Invalid `?space=` / `?staff=` / another owner's id | falls back to the first person; no 404, no redirect |
| Rentals-only with an hourly space (untick Appointments) | sidebar keeps Availability; page shows the space(s) only — NOT the owner's staff row; no People cluster, no hairline; single hourly space ⇒ no switcher at all |
| Rentals-only, nights/days only (also deactivate the hourly space) | `/availability` renders "Nightly and daily spaces use check-in and check-out times, set on each space…" + "Open Spaces →"; URL stays `/availability` |
| Appointments-only (re-tick Appointments, untick Spaces) | page identical to before U3: people row only, no hairline; one member ⇒ no switcher |
| Welcome checklist (`/bookings?welcome=1`) rentals-only with hourly | "Set hours" chip present, ticks once the space has a weekly rule; nights-only ⇒ chip absent |
| Nightly space detail | header keeps check-in/check-out; no Opening hours card |
| Inactive hourly space detail | card with "Reactivate to edit hours" instead of the link |
| Keyboard | tab through OwnerTabs: focus ring on each item, `aria-current="page"` on the selected one |

- [ ] **Step 3: Knowledge graph + wrap-up**

Run: `graphify update .` (AST-only). Restore the demo org to Both mode and reactivate anything you deactivated. Commit any QA ledger/screenshot bookkeeping that is not gitignored (there should be none) and push `feat/ia-u3`; open the PR against `main` with the QA table in the body.
