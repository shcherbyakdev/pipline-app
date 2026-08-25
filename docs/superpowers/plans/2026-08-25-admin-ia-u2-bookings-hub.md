# Admin IA — U2: Bookings hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Bookings screen for a mixed org — the same `Week · Timeline · List` switcher from every view, ONE "New booking" entry whose first field picks a service or a space, appointment walk-ins creatable without dragging, space bookings visibly distinct, and a staff lens that says how many space bookings it hid.

**Architecture:** Three pure modules carry the logic and the tests — `bookings-views.ts` (switcher items), `staff-lens.ts` (in-memory lens + hidden count), `booking-kinds.ts` (picker label, default selection, drag prefill). The two existing walk-in dialogs are split into a form each (`AppointmentBookingForm`, `SpaceBookingForm`) under one `NewBookingDialog` shell that owns the grouped `<select>` and mounts the chosen form **keyed by the picked id**. The page fetches the week unfiltered and applies the lens in memory. No data model, RPC or migration changes.

**Tech Stack:** Next.js 15 App Router (read `node_modules/next/dist/docs/` before touching routes), React 19, Supabase JS (RLS-scoped), Hugeicons free set (`House01Icon`), Vitest 4 in a Node environment (`*.test.ts` only — no DOM tests exist in this repo), ESLint + `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-08-25-admin-ia-mode-separation-design.md` §2 (Bookings hub). Read it first; its rulings 5 and 6 are binding.

## Global Constraints

- **Base branch:** `feat/ia-u1` (PR #61) until it merges into `main`, then `main`. Work on `feat/ia-u2`. U1's `SPACES`/`APPOINTMENTS` vocabulary and `admin-copy.test.ts` guard are prerequisites.
- **Code identifiers do not change:** `rental_*`, `rentalUnitId`, `rentalOfferingId`, `OfferingRow`, `listOfferings`, `createRentalBookingAdmin`, `createRentalBookingHoursAdmin`, `/rentals` — copy only.
- **Forbidden words in provider-facing admin copy:** `rental`, `rentals`, `offering`, `offerings` (any case). Channel words come from `src/features/orgs/vocab.ts`; the neutral words "New booking", "Services" (as an optgroup label — it is the nav noun), "Team member", "Unit", "Show everyone" may be inline.
- **The three views share one switcher with exactly the labels `Week`, `Timeline`, `List`.** `Week` always renders; `Timeline` only when the org has an active nights/days space (`hasRangeOfferings`); the week link keeps the `?staff=` lens, the others drop it. Default view stays `defaultBookingsView(eff, hasHourly)`.
- **One "New booking" entry.** Toolbar button (all three views, when ≥1 active service or space), drag-select on the week grid, and a timeline empty-cell click all open `NewBookingDialog`. Title "New booking"; description "Recorded on your behalf — notice and booking-window limits don’t apply." (curly apostrophe, as today).
- **Picker label** adapts: `SPACES.pickerBoth` ("Service or space") when both groups have entries, `APPOINTMENTS.field` ("Service") when only services, `SPACES.field` ("Space") when only spaces. Groups: `<optgroup label="Services">` and `<optgroup label={SPACES.nav}>`; option values are `service:<id>` / `space:<id>`.
- **The mounted form is keyed by the picked id** (`key={id}`) — state never survives a switch (H5a lesson).
- **Appointment form gains Date + Start fields** (`<input type="date">`, `<input type="time" step={900}>`); prefilled from a drag, else today (org zone) and the next 15-minute snap. The "Outside your open hours" hint renders only when the form was opened from a drag AND the date is still the dragged date (spec §2 — a plan deviation from the spec's `<select>` of snaps: a time input matches the existing "Ends at" control).
- **Drag prefill:** any active service → service form with date/start/length from the drag; no services but an hourly space → space form with the date; neither → the popover shows no "New booking" button (`canCreateFromDrag`).
- **Kind cues:** on the week grid a space booking (`rentalUnitId !== null`) gets a **dashed** 3px accent bar (appointments keep solid) plus a 12px house icon with a screen-reader label; list rows and client-history rows get `<Badge variant="outline">{SPACES.badge}</Badge>` **only when the org also offers appointments** (`offersAppointments`).
- **Staff lens:** the week is fetched UNFILTERED (`listConfirmedBookingsBetween(fromIso, toIso)` with no third argument) and narrowed in memory by `applyStaffLens`; when narrowed and `hiddenSpaces > 0` the toolbar shows a chip `{SPACES.hidden(n)} · Show everyone` linking to the same week without `?staff=`.
- **Tests:** Vitest Node env, `src/**/*.test.ts` only. No migrations. Spec deviation: no new integration test for "an appointment walk-in from a manually chosen date/start" — the form computes `startsAt` with `wallTimeToUtc(date, startTime, timeZone)`, already covered by `slots` tests, and `createBookingAdmin` by `admin-booking-rpc.integration.test.ts`; the manual path is exercised in Task 7's browser QA. Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. After each task: `npx vitest run <touched dirs>` + `npm run typecheck` + `npx eslint <changed files>` green before committing; `npm run verify` once in Task 7; `graphify update .` at the end.

---

## File structure

| File | Responsibility |
|---|---|
| `src/features/rentals/offering-option.ts` (create) | the `OfferingOption` row shape + `hourlyGrid()` — pure, shared by the space form, the picker and the timeline |
| `src/features/scheduling/bookings-views.ts` (create) + `.test.ts` | `viewSwitcherItems()` — the switcher's items per view |
| `src/features/scheduling/staff-lens.ts` (create) + `.test.ts` | `applyStaffLens()` — in-memory lens + hidden-spaces count |
| `src/features/scheduling/booking-kinds.ts` (create) + `.test.ts` | picker label, default selection, drag prefill, `canCreate*` |
| `src/features/orgs/vocab.ts` (modify) + `vocab.test.ts` | `SPACES.pickerBoth`, `SPACES.badge`, `SPACES.hidden(n)`, `APPOINTMENTS.field`; `SPACES.walkIn` removed in Task 6 |
| `src/features/scheduling/components/view-switcher.tsx` (create) | segmented links from `viewSwitcherItems` |
| `src/features/scheduling/components/appointment-booking-form.tsx` (create) | the appointment walk-in form (from `create-booking-dialog.tsx`) + Date/Start |
| `src/features/rentals/components/space-booking-form.tsx` (create) | the space walk-in form (from `new-rental-booking-dialog.tsx`) minus its own picker |
| `src/features/scheduling/components/new-booking-dialog.tsx` (create) | the shell: grouped select + keyed form |
| `src/features/scheduling/components/new-booking-button.tsx` (create) | toolbar trigger, conditional mount |
| `src/app/(dashboard)/bookings/page.tsx` (rewrite) | up-front fetches, per-view toolbar, lens + chip |
| `src/features/scheduling/components/calendar-week.tsx` (modify) | drag → `NewBookingDialog`; kind cues |
| `src/features/rentals/components/timeline.tsx` (modify) | cell click → `NewBookingDialog`; internal button removed |
| `src/features/scheduling/components/bookings-list.tsx`, `src/app/(dashboard)/clients/[id]/page.tsx` (modify) | kind badge |
| Deleted in Task 6 | `create-booking-dialog.tsx`, `new-rental-booking-dialog.tsx`, `rental-walk-in-button.tsx`, `rentals/walk-in.ts`, `rentals/walk-in.test.ts` |
| `src/features/orgs/admin-copy.test.ts` (modify) | `SURFACES` gains the new components, loses the deleted files |

---

### Task 1: Pure seams — `OfferingOption`, switcher items, staff lens, booking kinds, vocab keys

**Files:**
- Create: `src/features/rentals/offering-option.ts`
- Create: `src/features/scheduling/bookings-views.ts`, `src/features/scheduling/bookings-views.test.ts`
- Create: `src/features/scheduling/staff-lens.ts`, `src/features/scheduling/staff-lens.test.ts`
- Create: `src/features/scheduling/booking-kinds.ts`, `src/features/scheduling/booking-kinds.test.ts`
- Modify: `src/features/orgs/vocab.ts`, `src/features/orgs/vocab.test.ts`
- Modify: `src/features/rentals/components/new-rental-booking-dialog.tsx` (import the moved type; re-export it)

**Interfaces:**
- Produces (used by every later task):

```ts
// offering-option.ts
export type OfferingOption = { id: string; name: string; rangeMode?: RangeMode; slotIncrementMin?: number | null; minDurationMin?: number | null; maxDurationMin?: number | null };
export type HourGrid = { minDurationMin: number; maxDurationMin: number; slotIncrementMin: number };
export function hourlyGrid(o: OfferingOption): HourGrid | null;
// bookings-views.ts
export type BookingsView = "week" | "timeline" | "list";
export type ViewItem = { view: BookingsView; label: string; href: string; current: boolean };
export function viewSwitcherItems(input: { current: BookingsView; showTimeline: boolean; staffQuery?: string }): ViewItem[];
// staff-lens.ts
export function applyStaffLens(bookings: AdminBooking[], staffIds: string[] | undefined): { visible: AdminBooking[]; hiddenSpaces: number };
// booking-kinds.ts
export type BookingKind = "service" | "space";
export type KindSelection = { kind: BookingKind; id: string };
export type Initial =
  | { kind: "service"; serviceId?: string; date: string; startMin: number; dragEndMin: number; windows: DayWindow[] }
  | { kind: "space"; offeringId?: string; unitId?: string | null; date?: string };
export function pickerLabel(hasServices: boolean, hasSpaces: boolean): string;
export function canCreateWalkIn(services: readonly { id: string }[], spaces: readonly { id: string }[]): boolean;
export function defaultSelection(services: readonly { id: string }[], spaces: readonly { id: string }[], initial?: Initial): KindSelection | null;
export function parseSelection(value: string): KindSelection | null;   // "service:<id>" | "space:<id>"
export function dragInitial(sel: { date: string; startMin: number; endMin: number }, services: readonly { id: string }[], spaces: readonly OfferingOption[], windows: DayWindow[]): Initial | null;
// vocab.ts additions
SPACES.pickerBoth: "Service or space"; SPACES.badge: "Space"; SPACES.hidden: (n: number) => string; APPOINTMENTS.field: "Service"
```

- [ ] **Step 1: Write the failing tests**

`src/features/scheduling/bookings-views.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { viewSwitcherItems } from "./bookings-views";

describe("viewSwitcherItems (spec §2 — the same three words from every view)", () => {
  it("week, timeline, list — in that order, with the current one flagged", () => {
    const items = viewSwitcherItems({ current: "timeline", showTimeline: true });
    expect(items.map((i) => i.label)).toEqual(["Week", "Timeline", "List"]);
    expect(items.map((i) => i.href)).toEqual(["/bookings", "/bookings?view=timeline", "/bookings?view=list"]);
    expect(items.map((i) => i.current)).toEqual([false, true, false]);
  });
  it("drops Timeline when the org has no nights/days space", () => {
    expect(viewSwitcherItems({ current: "list", showTimeline: false }).map((i) => i.label)).toEqual(["Week", "List"]);
  });
  it("only the week link carries the staff lens", () => {
    const items = viewSwitcherItems({ current: "week", showTimeline: true, staffQuery: "staff=a,b" });
    expect(items[0].href).toBe("/bookings?staff=a,b");
    expect(items[1].href).toBe("/bookings?view=timeline");
    expect(items[2].href).toBe("/bookings?view=list");
  });
});
```

`src/features/scheduling/staff-lens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyStaffLens } from "./staff-lens";
import type { AdminBooking } from "@/features/scheduling/queries";

const base = {
  serviceId: null, rentalOfferingId: null, rentalUnitId: null, rangeMode: null, serviceName: "x",
  clientName: "c", clientEmail: null, startsAt: "2026-08-25T09:00:00Z", endsAt: "2026-08-25T10:00:00Z",
  status: "confirmed", note: null, rescheduledFromId: null, staffId: null, staffName: null, staffColor: null,
} as unknown as AdminBooking;
const appt = (id: string, staffId: string): AdminBooking => ({ ...base, id, serviceId: "svc", staffId });
const space = (id: string): AdminBooking => ({ ...base, id, rentalOfferingId: "off", rentalUnitId: "unit", rangeMode: "hours" });

describe("applyStaffLens (spec §2 — a person's lens hides spaces but says so)", () => {
  const rows = [appt("a1", "anna"), appt("b1", "ben"), space("s1"), space("s2")];
  it("no lens: everything visible, nothing hidden", () => {
    expect(applyStaffLens(rows, undefined)).toEqual({ visible: rows, hiddenSpaces: 0 });
  });
  it("a lens keeps only that person's appointments and counts the dropped spaces", () => {
    const r = applyStaffLens(rows, ["anna"]);
    expect(r.visible.map((b) => b.id)).toEqual(["a1"]);
    expect(r.hiddenSpaces).toBe(2);
  });
  it("a lens on a week without spaces hides nothing to report", () => {
    expect(applyStaffLens([appt("a1", "anna"), appt("b1", "ben")], ["ben"]).hiddenSpaces).toBe(0);
  });
});
```

`src/features/scheduling/booking-kinds.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canCreateWalkIn, defaultSelection, dragInitial, parseSelection, pickerLabel } from "./booking-kinds";

const services = [{ id: "s1" }, { id: "s2" }];
const hourly = { id: "h1", name: "Room", rangeMode: "hours" as const, slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 };
const nightly = { id: "n1", name: "Flat", rangeMode: "nights" as const };
const sel = { date: "2026-08-25", startMin: 600, endMin: 660 };

describe("pickerLabel", () => {
  it("names both, one, or the other", () => {
    expect(pickerLabel(true, true)).toBe("Service or space");
    expect(pickerLabel(true, false)).toBe("Service");
    expect(pickerLabel(false, true)).toBe("Space");
  });
});

describe("defaultSelection", () => {
  it("a prefilled id wins, then the first service, then the first space, then nothing", () => {
    expect(defaultSelection(services, [hourly], { kind: "service", serviceId: "s2", ...sel, dragEndMin: 660, windows: [] })).toEqual({ kind: "service", id: "s2" });
    expect(defaultSelection(services, [hourly], { kind: "space", offeringId: "h1" })).toEqual({ kind: "space", id: "h1" });
    expect(defaultSelection(services, [hourly])).toEqual({ kind: "service", id: "s1" });
    expect(defaultSelection([], [nightly, hourly])).toEqual({ kind: "space", id: "n1" });
    expect(defaultSelection([], [])).toBeNull();
  });
  it("ignores a prefilled id that is not in the lists", () => {
    expect(defaultSelection(services, [], { kind: "space", offeringId: "gone" })).toEqual({ kind: "service", id: "s1" });
  });
});

describe("parseSelection", () => {
  it("round-trips the select's option values", () => {
    expect(parseSelection("service:s1")).toEqual({ kind: "service", id: "s1" });
    expect(parseSelection("space:h1")).toEqual({ kind: "space", id: "h1" });
    expect(parseSelection("")).toBeNull();
    expect(parseSelection("other:x")).toBeNull();
  });
});

describe("dragInitial (spec §2 — drag on the week grid)", () => {
  it("any service ⇒ the appointment form with the drag's date, start and length", () => {
    expect(dragInitial(sel, services, [hourly], [])).toEqual({ kind: "service", date: "2026-08-25", startMin: 600, dragEndMin: 660, windows: [] });
  });
  it("no services but an hourly space ⇒ that space with the day prefilled", () => {
    expect(dragInitial(sel, [], [nightly, hourly], [])).toEqual({ kind: "space", offeringId: "h1", date: "2026-08-25" });
  });
  it("nights-only, no services ⇒ nothing to create from a drag", () => {
    expect(dragInitial(sel, [], [nightly], [])).toBeNull();
  });
});

describe("canCreateWalkIn", () => {
  it("true with any service or space, false with neither", () => {
    expect(canCreateWalkIn(services, [])).toBe(true);
    expect(canCreateWalkIn([], [nightly])).toBe(true);
    expect(canCreateWalkIn([], [])).toBe(false);
  });
});
```

Append to the "names every admin surface this slice touches" test in `src/features/orgs/vocab.test.ts`:

```ts
    expect(SPACES.pickerBoth).toBe("Service or space");
    expect(SPACES.badge).toBe("Space");
    expect(SPACES.hidden(1)).toBe("1 space booking hidden");
    expect(SPACES.hidden(3)).toBe("3 space bookings hidden");
    expect(APPOINTMENTS.field).toBe("Service");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/scheduling/bookings-views.test.ts src/features/scheduling/staff-lens.test.ts src/features/scheduling/booking-kinds.test.ts src/features/orgs/vocab.test.ts`
Expected: the three new files FAIL with "Cannot find module"; vocab FAILS on `SPACES.pickerBoth` undefined.

- [ ] **Step 3: Vocab keys**

In `src/features/orgs/vocab.ts` add to `SPACES`, right after `field`:

```ts
  /** The New-booking picker's label when both services and spaces are listed. */
  pickerBoth: "Service or space",
  /** Kind badge on list rows, client history and the week grid (sr-only). */
  badge: "Space",
  /** Toolbar chip when a staff lens hides space bookings from the week. */
  hidden: (n: number) => `${n} space booking${n === 1 ? "" : "s"} hidden`,
```

and to `APPOINTMENTS`:

```ts
  /** The New-booking picker's label when only services are listed. */
  field: "Service",
```

(`SPACES.walkIn` stays for now — Task 6 removes it once its last consumers are gone.)

- [ ] **Step 4: `offering-option.ts` — move the type out of the dialog**

Create `src/features/rentals/offering-option.ts`:

```ts
import type { RangeMode } from "@/features/rentals/range";

/* The row shape the New-booking picker and the space form work from —
   deliberately NOT the full OfferingRow: the timeline hands over
   `{id, name, rangeMode}` and the hourly fields stay optional so that keeps
   compiling; the Bookings page passes real OfferingRows, whose extra fields
   structurally satisfy this. (Moved from new-rental-booking-dialog.tsx.) */
export type OfferingOption = {
  id: string;
  name: string;
  rangeMode?: RangeMode;
  slotIncrementMin?: number | null;
  minDurationMin?: number | null;
  maxDurationMin?: number | null;
};

export type HourGrid = { minDurationMin: number; maxDurationMin: number; slotIncrementMin: number };

/** The hourly trio, or null for nights/days (or an hourly row missing it). */
export function hourlyGrid(o: OfferingOption): HourGrid | null {
  if (o.rangeMode !== "hours" || o.minDurationMin == null || o.maxDurationMin == null || o.slotIncrementMin == null) {
    return null;
  }
  return { minDurationMin: o.minDurationMin, maxDurationMin: o.maxDurationMin, slotIncrementMin: o.slotIncrementMin };
}
```

In `src/features/rentals/components/new-rental-booking-dialog.tsx` delete its local `export type OfferingOption = {…}`, `type HourGrid = …` and `function hourlyGrid(…) {…}` and replace them with:

```ts
import { hourlyGrid, type OfferingOption } from "@/features/rentals/offering-option";
export type { OfferingOption };
```

(Existing importers — `timeline.tsx`, `rental-walk-in-button.tsx` — keep compiling through the re-export until Task 6 deletes the dialog.)

- [ ] **Step 5: `bookings-views.ts`**

```ts
export type BookingsView = "week" | "timeline" | "list";
export type ViewItem = { view: BookingsView; label: string; href: string; current: boolean };

/* Week · Timeline · List — the same three words from every view (admin IA
   spec §2). Week always renders (a nights-only org still sees its stays as
   all-day chips there); Timeline only when a nights/days space exists. The
   week link keeps the staff lens (`staffQuery` = "staff=a,b" or empty);
   the others drop it — they have no lens. */
export function viewSwitcherItems(input: {
  current: BookingsView;
  showTimeline: boolean;
  staffQuery?: string;
}): ViewItem[] {
  const weekHref = input.staffQuery ? `/bookings?${input.staffQuery}` : "/bookings";
  const items: ViewItem[] = [{ view: "week", label: "Week", href: weekHref, current: input.current === "week" }];
  if (input.showTimeline) {
    items.push({ view: "timeline", label: "Timeline", href: "/bookings?view=timeline", current: input.current === "timeline" });
  }
  items.push({ view: "list", label: "List", href: "/bookings?view=list", current: input.current === "list" });
  return items;
}
```

- [ ] **Step 6: `staff-lens.ts`**

```ts
import type { AdminBooking } from "@/features/scheduling/queries";

/* A narrowing staff filter is a lens on a person's work (H2 ruling): only
   their appointments stay. A space booking is nobody's work, so it drops
   out — but the count comes back so the toolbar can say so instead of
   silently deleting rows (admin IA spec §2, ruling 6). No lens (undefined)
   means the "everyone" week: everything stays. */
export function applyStaffLens(
  bookings: AdminBooking[],
  staffIds: string[] | undefined,
): { visible: AdminBooking[]; hiddenSpaces: number } {
  if (staffIds === undefined) return { visible: bookings, hiddenSpaces: 0 };
  const ids = new Set(staffIds);
  const visible: AdminBooking[] = [];
  let hiddenSpaces = 0;
  for (const b of bookings) {
    if (b.rentalUnitId !== null) {
      hiddenSpaces += 1;
      continue;
    }
    if (b.staffId !== null && ids.has(b.staffId)) visible.push(b);
  }
  return { visible, hiddenSpaces };
}
```

- [ ] **Step 7: `booking-kinds.ts`**

```ts
import type { DayWindow } from "@/features/scheduling/day-windows";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";

/* What a walk-in is for. One entry point, the kind is a field (admin IA
   spec §2, ruling 5): these helpers decide the picker's label, what it
   starts on, and what a drag on the week grid pre-fills. Pure. */
export type BookingKind = "service" | "space";
export type KindSelection = { kind: BookingKind; id: string };

export type Initial =
  | {
      kind: "service";
      serviceId?: string;
      date: string;       // org-local YYYY-MM-DD
      startMin: number;   // org-local minutes since midnight (snapped)
      dragEndMin: number; // a real drag (> one 15-min snap) sets the default length
      windows: DayWindow[]; // effective windows for `date` — the outside-hours hint only
    }
  | { kind: "space"; offeringId?: string; unitId?: string | null; date?: string };

type Row = { id: string };

export function pickerLabel(hasServices: boolean, hasSpaces: boolean): string {
  if (hasServices && hasSpaces) return SPACES.pickerBoth;
  return hasSpaces ? SPACES.field : APPOINTMENTS.field;
}

export function canCreateWalkIn(services: readonly Row[], spaces: readonly Row[]): boolean {
  return services.length > 0 || spaces.length > 0;
}

/** A prefilled id wins when it is really listed; else first service, else first space. */
export function defaultSelection(
  services: readonly Row[],
  spaces: readonly Row[],
  initial?: Initial,
): KindSelection | null {
  if (initial?.kind === "service" && initial.serviceId && services.some((s) => s.id === initial.serviceId)) {
    return { kind: "service", id: initial.serviceId };
  }
  if (initial?.kind === "space" && initial.offeringId && spaces.some((o) => o.id === initial.offeringId)) {
    return { kind: "space", id: initial.offeringId };
  }
  if (services[0]) return { kind: "service", id: services[0].id };
  if (spaces[0]) return { kind: "space", id: spaces[0].id };
  return null;
}

/** The picker's option values are `service:<id>` / `space:<id>`. */
export function parseSelection(value: string): KindSelection | null {
  const i = value.indexOf(":");
  if (i < 0) return null;
  const kind = value.slice(0, i);
  const id = value.slice(i + 1);
  return (kind === "service" || kind === "space") && id ? { kind, id } : null;
}

export function selectionValue(sel: KindSelection): string {
  return `${sel.kind}:${sel.id}`;
}

/* Drag on the week grid: an appointment when the org sells any (the drag's
   date, start and length carry over); else the first hourly space with the
   day prefilled; else nothing — the popover then shows no "New booking". */
export function dragInitial(
  sel: { date: string; startMin: number; endMin: number },
  services: readonly Row[],
  spaces: readonly OfferingOption[],
  windows: DayWindow[],
): Initial | null {
  if (services.length > 0) {
    return { kind: "service", date: sel.date, startMin: sel.startMin, dragEndMin: sel.endMin, windows };
  }
  const hourly = spaces.find((o) => o.rangeMode === "hours");
  if (hourly) return { kind: "space", offeringId: hourly.id, date: sel.date };
  return null;
}
```

- [ ] **Step 8: Run the tests, typecheck, lint**

Run: `npx vitest run src/features/scheduling src/features/orgs src/features/rentals && npm run typecheck && npx eslint src/features/scheduling/bookings-views.ts src/features/scheduling/staff-lens.ts src/features/scheduling/booking-kinds.ts src/features/rentals/offering-option.ts src/features/orgs/vocab.ts src/features/rentals/components/new-rental-booking-dialog.tsx`
Expected: all PASS; typecheck and lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/features/rentals/offering-option.ts src/features/scheduling/bookings-views.ts src/features/scheduling/bookings-views.test.ts src/features/scheduling/staff-lens.ts src/features/scheduling/staff-lens.test.ts src/features/scheduling/booking-kinds.ts src/features/scheduling/booking-kinds.test.ts src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/features/rentals/components/new-rental-booking-dialog.tsx
git commit -m "feat(bookings): pure seams for the hub — view items, staff lens, booking kinds, OfferingOption

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `ViewSwitcher` + the page toolbar, unfiltered week + lens chip

**Files:**
- Create: `src/features/scheduling/components/view-switcher.tsx`
- Rewrite: `src/app/(dashboard)/bookings/page.tsx`
- Modify: `src/features/orgs/admin-copy.test.ts` (add `view-switcher.tsx` and `src/app/(dashboard)/bookings/page.tsx` to `SURFACES`)

**Interfaces:**
- Consumes: `viewSwitcherItems`, `applyStaffLens`, `SPACES.hidden`, `SPACES.walkIn` (still, via `RentalWalkInButton` — Task 3 replaces it), `walkInOfferings` (until Task 3).
- Produces: `<ViewSwitcher current showTimeline staffQuery />`; the page's new shape (up-front `services`/`activeStaff`/`orgOfferings`, a `toolbar(view)` helper) that Task 3 extends with the button.

- [ ] **Step 1: Extend the guard (red)**

In `src/features/orgs/admin-copy.test.ts` append to `SURFACES`:

```ts
  "src/features/scheduling/components/view-switcher.tsx",
  "src/app/(dashboard)/bookings/page.tsx",
```

Run: `npx vitest run src/features/orgs/admin-copy.test.ts` — Expected: FAIL only for `view-switcher.tsx` (file missing → `readFileSync` throws); `bookings/page.tsx` passes already (it has no forbidden JSX text).

- [ ] **Step 2: `ViewSwitcher`**

Create `src/features/scheduling/components/view-switcher.tsx`:

```tsx
import Link from "next/link";
import { viewSwitcherItems, type BookingsView } from "@/features/scheduling/bookings-views";
import { cn } from "@/lib/utils";

/* Week · Timeline · List — a segmented row of links (staff-tabs.tsx idiom:
   navigation, not state, so the view survives a refresh and can be shared).
   Rendered by every branch of the Bookings page so the three words never
   drift again (admin IA spec §2). */
export function ViewSwitcher({
  current,
  showTimeline,
  staffQuery,
}: {
  current: BookingsView;
  showTimeline: boolean;
  staffQuery?: string;
}) {
  const items = viewSwitcherItems({ current, showTimeline, staffQuery });
  return (
    <nav
      aria-label="Bookings view"
      className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5"
    >
      {items.map((item) => (
        <Link
          key={item.view}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
            item.current
              ? "bg-background text-foreground font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Rewrite `bookings/page.tsx`**

Replace the whole file with:

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import {
  listBookings,
  listConfirmedBookingsBetween,
  listExceptionsBetween,
  listServices,
  getAvailabilityAdmin,
  countHoursOwners,
} from "@/features/scheduling/queries";
import { listActiveStaff, type StaffRow } from "@/features/scheduling/staff-queries";
import { getSchedulingSettings } from "@/features/orgs/queries";
import { listOfferings, listTimelineData } from "@/features/rentals/queries";
import { walkInOfferings } from "@/features/rentals/walk-in";
import { RentalWalkInButton } from "@/features/rentals/components/rental-walk-in-button";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";
import { defaultBookingsView, effectiveMode, modeOf } from "@/features/orgs/mode";
import { SPACES } from "@/features/orgs/vocab";
import { TIMELINE_DAYS, timelineDefaultStart } from "@/features/rentals/timeline-geometry";
import { BookingsList } from "@/features/scheduling/components/bookings-list";
import { CalendarWeek } from "@/features/scheduling/components/calendar-week";
import { ViewSwitcher } from "@/features/scheduling/components/view-switcher";
import { applyStaffLens } from "@/features/scheduling/staff-lens";
import type { BookingsView } from "@/features/scheduling/bookings-views";
import { mondayOf } from "@/features/scheduling/calendar-geometry";
import { unionWindows, weekdayOf } from "@/features/scheduling/day-windows";
import { wallTimeToUtc, addDaysISO, dateInZone } from "@/features/scheduling/slots";
import { getPageDraftState } from "@/features/booking-page/queries";
import { setupChecklist, type ChecklistItem } from "@/features/scheduling/setup-checklist";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { env } from "@/env";
import { WelcomeBanner } from "@/features/scheduling/components/welcome-banner";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team (multi-staff): `?staff=a,b` narrows the week to those people. Only ids
// that name an active member count — a stale link, another org's id or plain
// junk quietly falls back to "everyone", the same forgiving rule the
// availability page applies to its own `?staff=`.
function parseStaffParam(param: string | undefined, active: StaffRow[]): string[] {
  const wanted = (param ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID_RE.test(id));
  const picked = active.filter((s) => wanted.includes(s.id));
  return picked.length > 0 ? picked.map((s) => s.id) : active.map((s) => s.id);
}

// A well-shaped date param (DATE_RE) can still be calendrically invalid
// (e.g. "2027-13-45") — `new Date(...)` on it yields NaN, which would blow
// up downstream date maths with a 500. Anything that doesn't parse falls
// back to the caller's default.
function validDate(param: string | undefined, fallback: string): string {
  return param !== undefined &&
    DATE_RE.test(param) &&
    !Number.isNaN(new Date(`${param}T12:00:00Z`).getTime())
    ? param
    : fallback;
}

function asView(param: string | undefined, fallback: BookingsView): BookingsView {
  return param === "week" || param === "timeline" || param === "list" ? param : fallback;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; week?: string; from?: string; staff?: string; welcome?: string }>;
}) {
  const params = await searchParams;
  const settings = await getSchedulingSettings();
  const timeZone = settings?.timezone ?? "UTC";
  const today = dateInZone(new Date(), timeZone);
  const { org } = await requireOrg();
  const flags = await getDashboardFlags(org.id);
  const mode = modeOf(org);
  const eff = effectiveMode(flags, mode);
  const rentals = eff.offersRentals;

  // Fetched once, up front, for every view: the catalogue decides the
  // default view, the Timeline link and (Task 3) the New-booking picker;
  // the roster drives the week's lens and the walk-in's staff picker.
  const [orgOfferings, services, activeStaff] = await Promise.all([
    rentals ? listOfferings() : Promise.resolve([]),
    eff.offersAppointments ? listServices() : Promise.resolve([]),
    eff.offersAppointments ? listActiveStaff() : Promise.resolve([]),
  ]);
  const spaces = orgOfferings.filter((o) => o.active);
  const activeServices = services.filter((s) => s.active);
  const hasHourly = spaces.some((o) => o.rangeMode === "hours");
  const hasRangeOfferings = spaces.some((o) => o.rangeMode !== "hours");
  const view = asView(params.view, rentals ? defaultBookingsView(eff, hasHourly) : "week");
  // The switcher's Timeline item only makes sense once the org sells spaces
  // AND has a nights/days one to show there (hourly bookings live on the
  // week grid). The branch itself still answers an explicit ?view=timeline
  // (and the nights-only default) with the Timeline's own empty state.
  const showTimeline = rentals && hasRangeOfferings;

  // Welcome checklist: three cheap reads, only on the one request that
  // carries ?welcome=1 (nothing is persisted — spec §4 ruling 8).
  let checklist: ChecklistItem[] = [];
  if (params.welcome === "1") {
    const [ownersWithHours, page] = await Promise.all([countHoursOwners(), getPageDraftState(org.id)]);
    checklist = setupChecklist({
      mode: eff,
      serviceCount: activeServices.length,
      spaceCount: spaces.length,
      ownersWithHours,
      published: page.published !== null,
    });
  }
  const welcome =
    params.welcome === "1" ? (
      <WelcomeBanner
        handle={settings?.handle ?? null}
        appUrl={env.NEXT_PUBLIC_APP_URL}
        mode={eff}
        checklist={checklist}
      />
    ) : null;

  // Task 3 swaps this for the unified New-booking button.
  const rentalWalkIn = walkInOfferings(orgOfferings);
  const newBooking =
    rentalWalkIn.length > 0 ? <RentalWalkInButton offerings={rentalWalkIn} timeZone={timeZone} /> : null;

  // One toolbar shape for every view: primary action on the left, view
  // controls on the right (admin IA spec §2). `right` is the per-view slot
  // before the switcher (the week's Today link, the lens chip).
  const toolbar = (current: BookingsView, right: ReactNode = null, staffQuery?: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>{newBooking}</div>
      <div className="flex items-center gap-2">
        {right}
        <ViewSwitcher current={current} showTimeline={showTimeline} staffQuery={staffQuery} />
      </div>
    </div>
  );

  if (rentals && view === "timeline") {
    // The timeline (a client component) is only pulled in when this branch
    // actually renders it.
    const { Timeline } = await import("@/features/rentals/components/timeline");
    const fromDate = validDate(params.from, timelineDefaultStart(today));
    const { offerings, blackouts, bookings } = await listTimelineData(fromDate, timeZone, TIMELINE_DAYS);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {welcome}
        {toolbar("timeline")}
        <Timeline
          fromDate={fromDate}
          timeZone={timeZone}
          offerings={offerings}
          blackouts={blackouts}
          bookings={bookings}
          prevHref={`/bookings?view=timeline&from=${addDaysISO(fromDate, -7)}`}
          nextHref={`/bookings?view=timeline&from=${addDaysISO(fromDate, 7)}`}
          todayHref="/bookings?view=timeline"
        />
      </div>
    );
  }

  if (view === "list") {
    const { upcoming, past } = await listBookings();
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        {welcome}
        {toolbar("list")}
        <BookingsList upcoming={upcoming} past={past} timeZone={timeZone} staff={activeStaff} mode={eff} />
      </div>
    );
  }

  const weekStart = mondayOf(validDate(params.week, today));
  const weekEnd = addDaysISO(weekStart, 6);
  const fromIso = wallTimeToUtc(weekStart, "00:00", timeZone).toISOString();
  const toIso = wallTimeToUtc(addDaysISO(weekStart, 7), "00:00", timeZone).toISOString();

  // Availability is per staff (Team slice), so the week is drawn for the
  // selected people: one selected ⇒ exactly their hours (the solo org is
  // always this case); several ⇒ the union, where an open tile means
  // "someone is open".
  const selectedStaffIds = parseStaffParam(params.staff, activeStaff);
  // Only a real narrowing is a lens; the "everyone" week shows spaces too.
  const staffFilter =
    selectedStaffIds.length < activeStaff.length ? selectedStaffIds : undefined;
  const [rawBookings, exceptions, availability] = await Promise.all([
    // Fetched UNFILTERED and narrowed in memory (one org-week of rows) — that
    // is what yields the hidden-spaces count for the chip below.
    listConfirmedBookingsBetween(fromIso, toIso),
    selectedStaffIds.length > 0 ? listExceptionsBetween(weekStart, weekEnd, selectedStaffIds) : [],
    Promise.all(selectedStaffIds.map((id) => getAvailabilityAdmin(id, today))),
  ]);
  const { visible: bookings, hiddenSpaces } = applyStaffLens(rawBookings, staffFilter);
  // One person ⇒ their rows go straight through (so the grid's block/unblock
  // and "Reopen day" keep working off real exceptions). Several ⇒ each
  // person's day is resolved on its own and the results unioned
  // (unionWindows) — pooling everyone's rules AND exceptions into one call
  // would let one member's closed day empty the whole column, and one open
  // override replace everybody's hours. The union is handed to CalendarWeek
  // as a week of synthetic rules (one per date's weekday + window, overrides
  // already folded in, so no exceptions ride along): for seven consecutive
  // dates the weekday is unique, so effectiveWindows reads them back verbatim.
  const solo = selectedStaffIds.length === 1;
  const perStaff = selectedStaffIds.map((id, i) => ({
    rules: availability[i].rules,
    exceptions: exceptions.filter((e) => e.staffId === id),
  }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const rules = solo
    ? availability[0].rules
    : weekDays.flatMap((date) =>
        unionWindows(date, perStaff).map((w, i) => ({
          id: `union-${date}-${i}`,
          weekday: weekdayOf(date),
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      );
  const weekExceptions = solo ? exceptions : [];
  // The week arrows are plain links — they have to carry the lens with them.
  const staffQuery = staffFilter ? `staff=${staffFilter.join(",")}` : "";
  const staffSuffix = staffQuery ? `&${staffQuery}` : "";
  const todayHref = staffQuery ? `/bookings?${staffQuery}` : "/bookings";
  // The lens hides space bookings (a room is nobody's work) — say so, with
  // the way out, instead of silently dropping rows (spec §2, ruling 6).
  const hiddenChip =
    staffFilter && hiddenSpaces > 0 ? (
      <Link
        href={`/bookings?week=${weekStart}`}
        className="text-muted-foreground hover:text-foreground rounded-md border border-dashed px-2 py-1 text-xs"
      >
        {SPACES.hidden(hiddenSpaces)} · Show everyone
      </Link>
    ) : null;

  return (
    // flex-1 + min-h-0: the calendar fills main's leftover viewport height
    // (week arrows live inside the grid header; see CalendarWeek).
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {welcome}
      {toolbar(
        "week",
        <>
          {hiddenChip}
          <Link href={todayHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Today
          </Link>
        </>,
        staffQuery,
      )}
      <CalendarWeek
        weekStart={weekStart}
        timeZone={timeZone}
        staff={activeStaff}
        selectedStaffIds={selectedStaffIds}
        // A walk-in drawn on a one-person week belongs to that person;
        // on the "everyone" week it defaults to the first active member.
        defaultStaffId={(selectedStaffIds.length === 1 ? selectedStaffIds[0] : activeStaff[0]?.id) ?? ""}
        bookings={bookings}
        rules={rules}
        exceptions={weekExceptions}
        services={activeServices}
        prevHref={`/bookings?week=${addDaysISO(weekStart, -7)}${staffSuffix}`}
        nextHref={`/bookings?week=${addDaysISO(weekStart, 7)}${staffSuffix}`}
      />
    </div>
  );
}
```

Notes for the implementer: the list branch previously fetched `listActiveStaff()` itself; it now reuses `activeStaff`. `services` was previously fetched only in the week branch; `CalendarWeek` used to receive `services.filter((s) => s.active)` — it now receives `activeServices`, the same rows.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `npm run typecheck && npx eslint "src/app/(dashboard)/bookings/page.tsx" src/features/scheduling/components/view-switcher.tsx && npx vitest run src/features/orgs src/features/scheduling`
Expected: clean / PASS (the guard now passes for both new surfaces).

- [ ] **Step 5: Look at it**

Start `npx next dev -p 3001 --webpack` from this checkout (Turbopack fails in nested worktrees; `.env.local` present; local Supabase up). Sign in as `demo@rolloutos.local` / `Password123!`. Check: `/bookings` shows the toolbar with `Week · Timeline · List` (Timeline present — the demo org has nightly spaces), `Today` left of it; `/bookings?view=timeline` and `/bookings?view=list` show the SAME switcher with the same words; on the week, click one team member in the staff filter — a chip "N space bookings hidden · Show everyone" appears when the week has space bookings (the seed has a nightly stay on flat1 and hourly Rehearsal Room bookings; pick the week that shows them) and "Show everyone" clears the lens. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/features/scheduling/components/view-switcher.tsx "src/app/(dashboard)/bookings/page.tsx" src/features/orgs/admin-copy.test.ts
git commit -m "feat(bookings): one Week · Timeline · List switcher; unfiltered week with an honest staff lens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `AppointmentBookingForm` (with Date + Start), `SpaceBookingForm`, `NewBookingDialog`, `NewBookingButton`

**Files:**
- Create: `src/features/scheduling/components/appointment-booking-form.tsx`
- Create: `src/features/rentals/components/space-booking-form.tsx`
- Create: `src/features/scheduling/components/new-booking-dialog.tsx`
- Create: `src/features/scheduling/components/new-booking-button.tsx`
- Modify: `src/app/(dashboard)/bookings/page.tsx` (the `newBooking` block)
- Modify: `src/features/orgs/admin-copy.test.ts` (`SURFACES` gains the four new components)

**Interfaces:**
- Consumes: Task 1's `booking-kinds.ts`, `offering-option.ts`, vocab keys.
- Produces:

```tsx
<AppointmentBookingForm serviceId services staff defaultStaffId timeZone drag onDone />
  // drag: { date: string; startMin: number; dragEndMin: number; windows: DayWindow[] } | null
<SpaceBookingForm offering timeZone initialUnitId initialStartDate onDone />
<NewBookingDialog open onOpenChange services spaces staff defaultStaffId timeZone initial? />
<NewBookingButton services spaces staff defaultStaffId timeZone />
```

- [ ] **Step 1: Extend the guard (red)**

Append to `SURFACES` in `src/features/orgs/admin-copy.test.ts`:

```ts
  "src/features/scheduling/components/appointment-booking-form.tsx",
  "src/features/rentals/components/space-booking-form.tsx",
  "src/features/scheduling/components/new-booking-dialog.tsx",
  "src/features/scheduling/components/new-booking-button.tsx",
```

Run: `npx vitest run src/features/orgs/admin-copy.test.ts` — Expected: FAIL (four files missing).

- [ ] **Step 2: `AppointmentBookingForm`**

Create `src/features/scheduling/components/appointment-booking-form.tsx` — the body of `create-booking-dialog.tsx` as a form, without the service `<select>` (the shell owns it), plus Date and Start fields:

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBookingAdmin } from "@/features/scheduling/booking-actions";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { DayWindow } from "@/features/scheduling/day-windows";
import { minToTime, snap15, timeToMin, zonedParts } from "@/features/scheduling/calendar-geometry";
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* The appointment half of the New-booking dialog (admin IA spec §2). The
   shell owns WHICH service; this form owns when, who and for whom. Opened
   from a drag it is prefilled and keeps the drag's default length; opened
   from the toolbar it starts on today at the next quarter hour — the one
   thing the old drag-only dialog could not do. */
export type DragPrefill = { date: string; startMin: number; dragEndMin: number; windows: DayWindow[] };

export function AppointmentBookingForm({
  serviceId, services, staff, defaultStaffId, timeZone, drag, onDone,
}: {
  serviceId: string;
  services: ServiceRow[];
  // Team (multi-staff): a walk-in belongs to someone. The picker only appears
  // for a real team — a solo org sends its one member's id silently.
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
  drag: DragPrefill | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const service = services.find((s) => s.id === serviceId);

  // Date + start are editable; the drag seeds them. `new Date()` inside the
  // useState initializer is the new-rental-booking-dialog precedent — it runs
  // once, not on every render.
  const [date, setDate] = React.useState(() => drag?.date ?? dateInZone(new Date(), timeZone));
  const [startTime, setStartTime] = React.useState(() =>
    drag ? minToTime(drag.startMin) : minToTime(Math.min(snap15(zonedParts(new Date(), timeZone).minutes) + 15, 23 * 60 + 45)),
  );
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [note, setNote] = React.useState("");
  // Overlap failures render inline (spec: this is a validation error tied
  // to the form, not a fire-and-forget notification) rather than only a
  // toast; cleared on the next submit or whenever an input changes so a
  // stale error can't linger against edited values.
  const [overlapError, setOverlapError] = React.useState<string | null>(null);
  const clearOverlap = () => setOverlapError(null);

  // `Date.now()` is an impure call and react-hooks/purity (React Compiler
  // rule) forbids calling it during render. Snapshot it once via the same
  // setTimeout-seed idiom calendar-week.tsx uses for its now-line.
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const seed = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(seed);
  }, []);

  // Who can take this service (0040 links), among active members.
  const activeStaff = staff.filter((s) => s.active);
  const eligible = activeStaff.filter((s) => service?.staffIds.includes(s.id));
  const [pickedStaffId, setPickedStaffId] = React.useState<string | null>(null);
  const staffId =
    (pickedStaffId && eligible.some((s) => s.id === pickedStaffId) ? pickedStaffId : null) ??
    (eligible.some((s) => s.id === defaultStaffId) ? defaultStaffId : eligible[0]?.id) ??
    "";

  const validStart = TIME_RE.test(startTime);
  const validDate = DATE_RE.test(date) && !Number.isNaN(new Date(`${date}T12:00:00Z`).getTime());
  const startMin = validStart ? timeToMin(startTime) : 0;
  // End time is editable. Default: a real drag (more than one 15-min snap
  // unit) sets the length; otherwise the service duration. Until the user
  // touches the end, it follows the start and the service.
  const dragged = drag !== null && drag.dragEndMin - drag.startMin > 15;
  const defaultEndMin = dragged && drag ? drag.dragEndMin : startMin + (service?.durationMin ?? 60);
  const [endTouched, setEndTouched] = React.useState(false);
  const [endTime, setEndTime] = React.useState(minToTime(Math.min(defaultEndMin, 24 * 60 - 1)));
  const effectiveEndTime = endTouched ? endTime : minToTime(Math.min(defaultEndMin, 24 * 60 - 1));
  const endMin = timeToMin(effectiveEndTime);
  const durationMin = endMin - startMin;
  const invalidDuration = durationMin < 5 || durationMin > 480;
  const startsAt = validDate && validStart ? wallTimeToUtc(date, startTime, timeZone) : null;

  // The outside-hours hint is advisory and only meaningful for the day the
  // drag came from — the form has no windows for any other date, and admin
  // bookings ignore hours anyway.
  const outsideHours =
    drag !== null &&
    date === drag.date &&
    !drag.windows.some((w) => timeToMin(w.startTime) <= startMin && endMin <= timeToMin(w.endTime));
  const insideNotice =
    service && nowMs !== null && startsAt ? startsAt.getTime() < nowMs + service.minNoticeMin * 60_000 : false;
  // The create_booking_admin RPC rejects starts older than 24h (walk-in
  // grace window) — surface that here instead of letting the submit fail.
  const tooFarPast = nowMs !== null && startsAt !== null && startsAt.getTime() < nowMs - 24 * 60 * 60 * 1000;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startsAt) return;
    setOverlapError(null);
    startTransition(async () => {
      const result = await createBookingAdmin({
        serviceId,
        staffId,
        startsAt: startsAt.toISOString(),
        durationMin,
        name,
        email,
        note: note || undefined,
      });
      if (!result.ok) {
        if (result.overlap) setOverlapError(result.error);
        else toast.error(result.error);
        return;
      }
      if (result.emailed === "sent") toast.success("Booking created — the client has been emailed");
      else if (result.emailed === "failed")
        toast.warning("Booking created — but the confirmation email failed. Contact the client directly.");
      else toast.success("Booking created.");
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-date">Date</Label>
          <Input
            id="ab-date"
            type="date"
            required
            value={date}
            onChange={(e) => { setDate(e.target.value); clearOverlap(); }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-start">Starts at</Label>
          <Input
            id="ab-start"
            type="time"
            step={900}
            required
            value={startTime}
            onChange={(e) => { setStartTime(e.target.value); clearOverlap(); }}
          />
        </div>
      </div>
      {activeStaff.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ab-staff">Team member</Label>
          <select
            id="ab-staff"
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
            value={staffId}
            disabled={eligible.length === 0}
            onChange={(e) => { setPickedStaffId(e.target.value); clearOverlap(); }}
          >
            {eligible.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-end">
          Ends at{" "}
          <span className="text-muted-foreground font-normal">
            ({durationMin > 0 ? `${durationMin} min` : "—"})
          </span>
        </Label>
        <Input
          id="ab-end"
          type="time"
          step={300}
          value={effectiveEndTime}
          onChange={(e) => { setEndTouched(true); setEndTime(e.target.value); clearOverlap(); }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-name">Client name</Label>
        <Input id="ab-name" required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); clearOverlap(); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-email">Email (optional — confirmation is sent only if given)</Label>
        <Input id="ab-email" type="email" maxLength={320} value={email} onChange={(e) => { setEmail(e.target.value); clearOverlap(); }} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ab-note">Note (optional)</Label>
        <Textarea id="ab-note" maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); clearOverlap(); }} />
      </div>
      {outsideHours ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Outside your open hours — allowed for bookings you create yourself.
        </p>
      ) : null}
      {insideNotice && !tooFarPast ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          Inside this service’s minimum-notice window — allowed for bookings you create yourself.
        </p>
      ) : null}
      {tooFarPast ? (
        <p className="text-destructive text-sm">
          This time is more than 24 hours in the past — bookings can’t be recorded that far
          back. Pick a slot from the last day, or a future one.
        </p>
      ) : null}
      {invalidDuration ? (
        <p className="text-destructive text-sm">
          End must be after the start — between 5 minutes and 8 hours long.
        </p>
      ) : null}
      {serviceId && !staffId ? (
        <p className="text-destructive text-sm">
          Nobody on the team offers this service yet — assign someone on the Services page.
        </p>
      ) : null}
      {overlapError ? <p className="text-destructive text-sm">{overlapError}</p> : null}
      <Button
        type="submit"
        disabled={pending || !serviceId || !staffId || tooFarPast || invalidDuration || !validDate || !validStart}
      >
        {pending ? "Creating…" : "Create booking"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: `SpaceBookingForm` — extract from `new-rental-booking-dialog.tsx`**

Create `src/features/rentals/components/space-booking-form.tsx` by copying `new-rental-booking-dialog.tsx` and applying exactly these edits (anchors are the existing comments/identifiers — the file has no line numbers you can rely on):

1. Replace the `NewRentalBookingDialog` function signature and its first state line with:

```tsx
/* The space half of the New-booking dialog (admin IA spec §2). The shell
   owns WHICH space; this form owns dates (nights/days: RangePicker + range
   engine), or duration + time slot (hourly), then unit and client. The
   prefill props seed state on mount only — the shell mounts this keyed by
   the space id, so a switch always starts clean. */
export function SpaceBookingForm({
  offering,
  initialUnitId,
  initialStartDate,
  timeZone,
  onDone,
}: {
  offering: OfferingOption;
  initialUnitId?: string | null;
  initialStartDate?: string;
  timeZone: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const offeringId = offering.id;
  const grid = hourlyGrid(offering);
```

   and delete the old lines `const [offeringId, setOfferingId] = React.useState(() => initialOfferingId ?? offerings[0]?.id ?? "");`, `const selected = offerings.find((o) => o.id === offeringId) ?? null;` and `const grid = selected ? hourlyGrid(selected) : null;`. Keep `const hourly = grid !== null;` and `const hourOptions = grid ? durationOptions(grid) : [];`.
2. Delete the whole `function changeOffering(id: string) {…}`.
3. In the two `React.useEffect` blocks, drop `open` from the guard and the dependency array: `if (hourly) return; load(offeringId, month);` with `[hourly, offeringId, month, load]`, and `if (!hourly || durationMin === null) return; loadHours(…)` with `[hourly, offeringId, durationMin, hourFromDate, loadHours]`.
4. Replace every `onOpenChange(false);` (two occurrences, both success paths in `submit`) with `onDone();`.
5. Replace the returned JSX: delete the `<Dialog …>`, `<DialogContent …>`, `<DialogHeader>…</DialogHeader>` wrappers and the whole `<div className="flex flex-col gap-1.5"> <Label htmlFor="new-rental-offering">…</select> </div>` picker block; the component now returns

```tsx
  return (
    <div className="flex flex-col gap-4">
      {hourly ? ( …unchanged hourly branch… ) : offering === null ? ( …unchanged… ) : ( …unchanged nights/days branch… )}
    </div>
  );
```

   i.e. exactly the previous ternary, wrapped in one `div`. Rename the inner `const [offering, setOffering] = React.useState<PublicOffering | null>(null);` to `const [loaded, setLoaded] = React.useState<PublicOffering | null>(null);` and update its uses (`setOffering(result.offering)` → `setLoaded(result.offering)`, the `offering === null ?` branch → `loaded === null ?`, `validateStay(asEngineOffering(offering), …)` → `validateStay(asEngineOffering(loaded), …)`, `<RangePicker … offering={offering}` → `offering={loaded}`), so the prop and the fetched engine row cannot be confused.
6. Imports: remove `Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription` and `SPACES`; add `import { hourlyGrid, type OfferingOption } from "@/features/rentals/offering-option";` (and delete the dialog's own `hourlyGrid`/`OfferingOption` import of Task 1 if you copied it).
7. Keep `WINDOW_DAYS`, `HOUR_WINDOW_DAYS`, `selectClass`, `MAX_PILL_OPTIONS`, `HourlySlot`, both request-ordering refs, `load`, `loadHours`, `changeMonth`, `changeRange`, `changeDuration`, `navigateHours`, `pickSlot`, `backToTime`, `stay`/`freeUnitIds`/`effectiveUnitId`, the hourly equivalents, and `submit` — unchanged apart from edits 3–5.

Leave `new-rental-booking-dialog.tsx` in place for now (Task 5 stops using it; Task 6 deletes it).

- [ ] **Step 4: `NewBookingDialog`**

Create `src/features/scheduling/components/new-booking-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { SPACES } from "@/features/orgs/vocab";
import {
  defaultSelection, parseSelection, pickerLabel, selectionValue, type Initial, type KindSelection,
} from "@/features/scheduling/booking-kinds";
import { AppointmentBookingForm } from "./appointment-booking-form";
import { SpaceBookingForm } from "@/features/rentals/components/space-booking-form";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";

/* The one walk-in entry (admin IA spec §2, ruling 5): the first field picks
   a service or a space; the matching form mounts below it KEYED BY THE
   PICKED ID, so nothing — dates, unit, client fields — survives a switch
   (H5a lesson). Callers mount this per opening (conditional mount, the
   timeline idiom) so every open starts clean. */
export function NewBookingDialog({
  open, onOpenChange, services, spaces, staff, defaultStaffId, timeZone, initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceRow[];      // active
  spaces: OfferingOption[];    // active, any range mode
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
  initial?: Initial;
}) {
  const [selected, setSelected] = React.useState<KindSelection | null>(() =>
    defaultSelection(services, spaces, initial),
  );
  const label = pickerLabel(services.length > 0, spaces.length > 0);
  const close = () => onOpenChange(false);
  const space = selected?.kind === "space" ? (spaces.find((o) => o.id === selected.id) ?? null) : null;
  const spacePrefill = initial?.kind === "space" && space && initial.offeringId === space.id ? initial : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[85vh] overflow-y-auto", selected?.kind === "space" && "sm:max-w-2xl")}>
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            Recorded on your behalf — notice and booking-window limits don’t apply.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nb-what">{label}</Label>
          <select
            id="nb-what"
            className={selectClass}
            value={selected ? selectionValue(selected) : ""}
            onChange={(e) => setSelected(parseSelection(e.target.value))}
          >
            {services.length > 0 ? (
              <optgroup label="Services">
                {services.map((s) => (
                  <option key={s.id} value={selectionValue({ kind: "service", id: s.id })}>
                    {s.name} ({s.durationMin} min)
                  </option>
                ))}
              </optgroup>
            ) : null}
            {spaces.length > 0 ? (
              <optgroup label={SPACES.nav}>
                {spaces.map((o) => (
                  <option key={o.id} value={selectionValue({ kind: "space", id: o.id })}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>
        {selected?.kind === "service" ? (
          <AppointmentBookingForm
            key={selected.id}
            serviceId={selected.id}
            services={services}
            staff={staff}
            defaultStaffId={defaultStaffId}
            timeZone={timeZone}
            drag={initial?.kind === "service" ? initial : null}
            onDone={close}
          />
        ) : space ? (
          <SpaceBookingForm
            key={space.id}
            offering={space}
            timeZone={timeZone}
            initialUnitId={spacePrefill?.unitId ?? null}
            initialStartDate={spacePrefill?.date}
            onDone={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: `NewBookingButton`**

Create `src/features/scheduling/components/new-booking-button.tsx`:

```tsx
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { ServiceRow } from "@/features/scheduling/queries";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { Button } from "@/components/ui/button";
import { NewBookingDialog } from "./new-booking-dialog";

/* The Bookings toolbar's primary action — the same on every view. Conditional
   mount (timeline.tsx idiom): each open gets a fresh dialog, and a walk-in
   created through the dialog's own router.refresh() leaves no stale picker
   behind for the next one. The page renders this only when there is at
   least one service or space to book (canCreateWalkIn). */
export function NewBookingButton({
  services, spaces, staff, defaultStaffId, timeZone,
}: {
  services: ServiceRow[];
  spaces: OfferingOption[];
  staff: StaffRow[];
  defaultStaffId: string;
  timeZone: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New booking
      </Button>
      {open ? (
        <NewBookingDialog
          open
          onOpenChange={setOpen}
          services={services}
          spaces={spaces}
          staff={staff}
          defaultStaffId={defaultStaffId}
          timeZone={timeZone}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 6: Wire the toolbar button in `bookings/page.tsx`**

Replace the imports of `walkInOfferings` and `RentalWalkInButton` with:

```ts
import { NewBookingButton } from "@/features/scheduling/components/new-booking-button";
import { canCreateWalkIn } from "@/features/scheduling/booking-kinds";
```

and replace the `rentalWalkIn` / `newBooking` block with:

```tsx
  // One entry for every kind of walk-in (spec §2, ruling 5). On the
  // "everyone" week a walk-in defaults to the first active member; the week
  // branch below overrides that for a one-person lens.
  const newBookingFor = (defaultStaffId: string) =>
    canCreateWalkIn(activeServices, spaces) ? (
      <NewBookingButton
        services={activeServices}
        spaces={spaces}
        staff={activeStaff}
        defaultStaffId={defaultStaffId}
        timeZone={timeZone}
      />
    ) : null;
```

then change `toolbar`'s signature to `(current: BookingsView, defaultStaffId: string, right: ReactNode = null, staffQuery?: string)` rendering `<div>{newBookingFor(defaultStaffId)}</div>`, and update the three call sites: timeline → `toolbar("timeline", activeStaff[0]?.id ?? "")`, list → `toolbar("list", activeStaff[0]?.id ?? "")`, week → `toolbar("week", (selectedStaffIds.length === 1 ? selectedStaffIds[0] : activeStaff[0]?.id) ?? "", <>…</>, staffQuery)` (the same expression `CalendarWeek` gets as `defaultStaffId` — hoist it into `const defaultStaffId = …` above the return and use it in both places).

- [ ] **Step 7: Typecheck, lint, tests**

Run: `npm run typecheck && npx eslint src/features/scheduling/components/appointment-booking-form.tsx src/features/rentals/components/space-booking-form.tsx src/features/scheduling/components/new-booking-dialog.tsx src/features/scheduling/components/new-booking-button.tsx "src/app/(dashboard)/bookings/page.tsx" && npx vitest run src/features/orgs src/features/scheduling src/features/rentals`
Expected: clean / PASS (guard green for the four new files — none contains a forbidden word in JSX text or labelled props).

- [ ] **Step 8: Look at it**

Dev server as in Task 2. Demo org, `/bookings`: the toolbar's left button reads **New booking**; the dialog's first field is labelled **Service or space** with groups *Services* / *Spaces*; picking *Consultation* shows Date (today) + Starts at (next quarter hour) + Ends at + client fields — create one for tomorrow 10:00 and confirm it appears on the week; picking *Rehearsal Room* shows the duration pills, then the slot grid; picking *Test* (nightly) shows the range picker. Switch between two entries with a half-filled form and confirm the fields reset. Save `.playwright-mcp/u2-dialog-*.png`. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add src/features/scheduling/components/appointment-booking-form.tsx src/features/rentals/components/space-booking-form.tsx src/features/scheduling/components/new-booking-dialog.tsx src/features/scheduling/components/new-booking-button.tsx "src/app/(dashboard)/bookings/page.tsx" src/features/orgs/admin-copy.test.ts
git commit -m "feat(bookings): one New booking dialog — service or space picker, keyed forms, appointment date + start

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Week grid — drag opens the unified dialog; space bookings look different

**Files:**
- Modify: `src/features/scheduling/components/calendar-week.tsx`
- Modify: `src/app/(dashboard)/bookings/page.tsx` (pass `spaces` to `CalendarWeek`)
- Modify: `src/features/orgs/admin-copy.test.ts` (`SURFACES` gains `calendar-week.tsx`)

**Interfaces:**
- Consumes: `NewBookingDialog`, `dragInitial`, `SPACES.badge`, `OfferingOption`.
- Produces: `CalendarWeek` prop `spaces: OfferingOption[]`.

- [ ] **Step 1: Put the grid under the copy guard**

Append `"src/features/scheduling/components/calendar-week.tsx"` to `SURFACES`. Run: `npx vitest run src/features/orgs/admin-copy.test.ts` — Expected: PASS (verified while planning: the grid's "rental" mentions are identifiers and comments the regexes skip). This task's red is the typecheck in Step 4, taken before the page passes the new prop.

- [ ] **Step 2: Swap the dialog and gate the popover**

In `calendar-week.tsx`:

- Replace `import { CreateBookingDialog } from "./create-booking-dialog";` with

```ts
import { NewBookingDialog } from "./new-booking-dialog";
import { dragInitial } from "@/features/scheduling/booking-kinds";
import type { OfferingOption } from "@/features/rentals/offering-option";
import { SPACES } from "@/features/orgs/vocab";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
```

- Add the prop `spaces: OfferingOption[];` (after `services: ServiceRow[];`, with the comment `// Active spaces — a drag on an org without services pre-fills the first hourly one.`) and destructure it.
- Where the popover renders `New booking`, gate it: compute `const initial = dragInitial(selection, services, spaces, windowsByDay[days.indexOf(selection.date)] ?? []);` inside the existing `(() => { … })()` block (next to `openMin`) and render

```tsx
                      {initial ? (
                        <Button size="sm" className="h-7" onClick={() => setCreateOpen(true)}>
                          New booking
                        </Button>
                      ) : null}
```

- Replace the `<CreateBookingDialog … />` mount at the bottom with

```tsx
      {selection && createOpen ? (
        <NewBookingDialog
          open
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setSelection(null); }}
          services={services}
          spaces={spaces}
          staff={staff}
          defaultStaffId={defaultStaffId}
          timeZone={timeZone}
          initial={dragInitial(selection, services, spaces, windowsByDay[days.indexOf(selection.date)] ?? []) ?? undefined}
        />
      ) : null}
```

(`selection && createOpen` — conditional mount per opening, so `defaultSelection` runs on the drag's `initial`.)

- [ ] **Step 3: Kind cues on timed blocks**

In the timed-block `<button>` (the one with `top: pct(s.minutes)`), add `const isSpace = b.rentalUnitId !== null;` before the `return (` and:

- the `borderLeft` style becomes `` `3px ${isSpace ? "dashed" : "solid"} ${(isTeam ? b.staffColor : null) ?? serviceAccent(b.serviceId ?? b.rentalOfferingId ?? "")}` ``
- both name renderings (`<span className="truncate font-medium">{b.serviceName}</span>` and `<span className="font-medium">{b.serviceName}</span>`) get a leading kind mark:

```tsx
{isSpace ? (
  <>
    <HugeiconsIcon icon={House01Icon} size={12} className="inline-block shrink-0 align-[-1px]" aria-hidden />
    <span className="sr-only">{SPACES.badge} · </span>{" "}
  </>
) : null}
```

  placed immediately before `{b.serviceName}` inside each span. Colour alone never carries the distinction (design-skill rule); the dashed bar and the icon do.

- [ ] **Step 4: Pass `spaces` from the page**

In `bookings/page.tsx` add `spaces={spaces}` to `<CalendarWeek …>` (next to `services={activeServices}`). Run `npm run typecheck` BEFORE this edit to see it fail on the missing prop (that is this task's red), then after — clean.

- [ ] **Step 5: Lint, tests**

Run: `npx eslint src/features/scheduling/components/calendar-week.tsx "src/app/(dashboard)/bookings/page.tsx" && npx vitest run src/features/orgs src/features/scheduling`
Expected: clean / PASS.

- [ ] **Step 6: Look at it**

Dev server. Demo org week: drag on a day → popover **New booking** → dialog opens on *Services* with the dragged date/start/end filled; hourly Rehearsal Room bookings show a house icon and a dashed bar, appointments a solid bar. Then Settings › Business → untick Appointments (rentals-only): drag → the dialog opens on **Rehearsal Room** with the date filled (no empty Service select any more). Re-tick Appointments. Screenshots `.playwright-mcp/u2-week-*.png`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/features/scheduling/components/calendar-week.tsx "src/app/(dashboard)/bookings/page.tsx" src/features/orgs/admin-copy.test.ts
git commit -m "feat(bookings): drag on the week opens the unified dialog; space bookings get a dashed bar + house icon

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Timeline — cell click opens the unified dialog; internal button gone

**Files:**
- Modify: `src/features/rentals/components/timeline.tsx`

**Interfaces:**
- Consumes: `NewBookingDialog`, `OfferingOption` (from `offering-option.ts`).

- [ ] **Step 1: Confirm the starting point**

`grep -n "NewRentalBookingDialog\|SPACES.walkIn" src/features/rentals/components/timeline.tsx` — Expected: the import, the mount and the button (three hits). This task has no unit test (client component, no DOM env); typecheck after Step 2 is the gate and Step 4 is the behavioural check.

- [ ] **Step 2: Edit `timeline.tsx`**

- Replace `import { NewRentalBookingDialog } from "./new-rental-booking-dialog";` with `import { NewBookingDialog } from "@/features/scheduling/components/new-booking-dialog";` and `import type { OfferingOption } from "@/features/rentals/offering-option";`. Remove the `SPACES` import if nothing else in the file uses it (the empty state still does — keep it in that case).
- `offeringOptions` becomes

```ts
  const offeringOptions = React.useMemo<OfferingOption[]>(
    () => offerings.map((o) => ({ id: o.id, name: o.name, rangeMode: o.rangeMode })),
    [offerings],
  );
```

- Delete the toolbar block

```tsx
      <div className="flex items-center justify-end">
        <Button variant="outline" size="sm" onClick={() => setNewStay({})}>
          {SPACES.walkIn}
        </Button>
      </div>
```

  (the page's toolbar owns the button now). If `Button` is no longer used elsewhere in the file, drop it from the import (keep `buttonVariants`).
- Replace the `<NewRentalBookingDialog …/>` mount with

```tsx
      {newStay === null ? null : (
        <NewBookingDialog
          open
          onOpenChange={(o) => { if (!o) setNewStay(null); }}
          services={[]}
          spaces={offeringOptions}
          staff={[]}
          defaultStaffId=""
          timeZone={timeZone}
          initial={{ kind: "space", offeringId: newStay.offeringId, unitId: newStay.unitId ?? null, date: newStay.date }}
        />
      )}
```

  With `services={[]}` the picker is labelled `Space` and lists only the timeline's nights/days spaces — the cell click behaves exactly as before, just through the one dialog.

- [ ] **Step 3: Typecheck, lint, guard**

Run: `npm run typecheck && npx eslint src/features/rentals/components/timeline.tsx && npx vitest run src/features/orgs`
Expected: clean / PASS.

- [ ] **Step 4: Look at it**

Dev server, `/bookings?view=timeline`: no button inside the timeline (the toolbar's **New booking** is the only one); clicking an empty cell opens **New booking** on that space with the unit and check-in date prefilled. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/features/rentals/components/timeline.tsx
git commit -m "feat(bookings): timeline cell click opens the unified dialog; its own button is gone

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Kind badges on list + client history; delete the old dialogs and `walkIn`

**Files:**
- Modify: `src/features/scheduling/components/bookings-list.tsx`
- Modify: `src/app/(dashboard)/clients/[id]/page.tsx`
- Delete: `src/features/scheduling/components/create-booking-dialog.tsx`, `src/features/rentals/components/new-rental-booking-dialog.tsx`, `src/features/rentals/components/rental-walk-in-button.tsx`, `src/features/rentals/walk-in.ts`, `src/features/rentals/walk-in.test.ts`
- Modify: `src/features/orgs/vocab.ts`, `src/features/orgs/vocab.test.ts` (remove `walkIn`), `src/features/orgs/admin-copy.test.ts` (`SURFACES`: remove the two deleted files, add `bookings-list.tsx` is already there, add `src/app/(dashboard)/clients/[id]/page.tsx`)

- [ ] **Step 1: Red — vocab and guard**

In `vocab.test.ts` delete the line `expect(SPACES.walkIn).toBe("New space booking");`. In `admin-copy.test.ts` remove `"src/features/rentals/components/new-rental-booking-dialog.tsx"` and `"src/features/rentals/components/rental-walk-in-button.tsx"` from `SURFACES` and append `"src/app/(dashboard)/clients/[id]/page.tsx"`. Run `npx vitest run src/features/orgs` — Expected: PASS (nothing red yet); the red is the typecheck after Step 3 removes `walkIn` while nothing references it — i.e. confirm with `grep -rn "SPACES.walkIn" src` → must list only the two files being deleted.

- [ ] **Step 2: Badges**

`bookings-list.tsx` — `Row` gets a prop `showKind: boolean` and renders the badge next to the name:

```tsx
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          {booking.serviceName}
          {showKind && booking.rentalUnitId !== null ? <Badge variant="outline">{SPACES.badge}</Badge> : null}
        </p>
        {actionable ? null : (
          <Badge variant="secondary">{STATUS_LABEL[booking.status] ?? booking.status}</Badge>
        )}
      </div>
```

Both `<Row …>` call sites pass `showKind={mode.offersAppointments}` (a rentals-only org would badge every row; the badge exists to tell kinds apart).

`clients/[id]/page.tsx` — add `import { requireOrg } from "@/lib/auth/session";` and `import { SPACES } from "@/features/orgs/vocab";`, fetch `const { org } = await requireOrg();` alongside the other reads (add it to the `Promise.all`), and render

```tsx
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 font-medium">
                    {b.serviceName}
                    {org.offersAppointments && b.rentalUnitId !== null ? (
                      <Badge variant="outline">{SPACES.badge}</Badge>
                    ) : null}
                  </p>
                  <Badge variant="secondary">{STATUS_LABEL[b.status] ?? b.status}</Badge>
                </div>
```

- [ ] **Step 3: Delete the superseded files and the `walkIn` key**

```bash
git rm src/features/scheduling/components/create-booking-dialog.tsx src/features/rentals/components/new-rental-booking-dialog.tsx src/features/rentals/components/rental-walk-in-button.tsx src/features/rentals/walk-in.ts src/features/rentals/walk-in.test.ts
```

In `vocab.ts` delete the `walkIn` line and its comment. Then `grep -rn "walkInOfferings\|RentalWalkInButton\|NewRentalBookingDialog\|CreateBookingDialog\|SPACES.walkIn" src` — Expected: no matches.

- [ ] **Step 4: Typecheck, lint, tests**

Run: `npm run typecheck && npx eslint src/features/scheduling/components/bookings-list.tsx "src/app/(dashboard)/clients/[id]/page.tsx" src/features/orgs/vocab.ts && npx vitest run src/features/orgs src/features/scheduling src/features/rentals`
Expected: clean / PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/features/scheduling/components src/features/rentals src/features/orgs "src/app/(dashboard)/clients/[id]/page.tsx"
git commit -m "feat(bookings): Space badge on list rows and client history; retire the two old walk-in dialogs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-slice verification and browser QA

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: lint 0 errors (1 pre-existing warning), typecheck clean, all tests pass (U1 baseline 905; this slice adds ≈ 15 and removes `walk-in.test.ts`'s).

- [ ] **Step 2: Browser QA matrix**

Dev server `npx next dev -p 3001 --webpack`. Demo org (`demo@rolloutos.local` / `Password123!`; mode via Settings › Business — restore Both at the end) and, for empty states, the `qa-u1@rolloutos.local` / `Password123!` org from U1's QA (both-mode, empty). Screenshots to `.playwright-mcp/u2-<mode>-<check>.png`; results to `.superpowers/sdd/<this plan's workspace>/qa-ledger.md`.

| check | expected |
|---|---|
| Switcher, all three views, both/appointments-only/rentals-only | identical `Week · Timeline · List` words; Timeline absent for appointments-only and for a rentals-only org with only hourly spaces; the current item highlighted |
| Toolbar button | **New booking** on every view when anything is bookable; absent on the empty org |
| Dialog picker label | "Service or space" (both) / "Service" / "Space" |
| Toolbar → service | Date today, Starts at next quarter hour; create tomorrow 10:00 → appears on the week |
| Toolbar → hourly space / nightly space | duration pills + slot grid / range picker; create one of each |
| Switch entries mid-form | fields reset (keyed remount) |
| Drag, both-mode | service form prefilled with the dragged range; dashed/house cue on hourly space blocks |
| Drag, rentals-only with hourly | space form with the date |
| Drag, nights-only org (untick Appointments and temporarily deactivate the hourly space, or use a fresh org) | popover shows no New booking |
| Timeline cell click | dialog on that space with unit + check-in prefilled; no button inside the timeline |
| Staff lens | pick one member on a week with space bookings → chip "N space bookings hidden · Show everyone"; clicking it clears the lens |
| List + client history, both-mode | `Space` badge on space rows only; rentals-only → no badges |

- [ ] **Step 3: `graphify update .`**

- [ ] **Step 4: Commit QA fixes if any** (`fix(ia-u2): …` + trailer), then hand off via `superpowers:finishing-a-development-branch`.
