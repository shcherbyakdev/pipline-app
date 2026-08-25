# Admin IA — U1: sidebar groups, vocabulary lock, first-run checklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regroup the admin sidebar into *Offer / Share / (account)*, make every admin surface call the rentals channel "Spaces" (never "rental" or "offering"), and turn the first-run welcome banner into a per-mode setup checklist.

**Architecture:** Three pure, testable seams carry the change — `nav.ts` (section enum + ordered list), `orgs/vocab.ts` (`SPACES` / `APPOINTMENTS` constants) and a new `setupChecklist()` function — and every JSX surface consumes them instead of inlining strings. Vitest runs in a Node environment with no DOM, so JSX copy is guarded by a *source-text* test (`admin-copy.test.ts`) that fails on the old literals and on any "rental"/"offering" word in JSX text or labelled props. No data model, RPC or migration changes.

**Tech Stack:** Next.js 15 App Router (see `node_modules/next/dist/docs/` before touching routes), React 19, Supabase JS (RLS-scoped `createClient()` from `@/lib/supabase/server`), Hugeicons free set (`<HugeiconsIcon icon={…} />` from `@hugeicons/react` + `@hugeicons/core-free-icons`), Vitest 4 (`npx vitest run <file>`), ESLint + `tsc --noEmit` (`npm run typecheck`).

**Spec:** `docs/superpowers/specs/2026-08-25-admin-ia-mode-separation-design.md` — §1 (Sidebar and vocabulary) and §4 (First run per mode). Read it first; the rulings there are not re-decided here.

## Global Constraints

- **Base branch:** `feat/h5a-to-main` (PR #60) until it merges into `main`, then `main`. Work on `feat/ia-u1`. Never base on `main` while `main` lacks `src/features/orgs/vocab.ts`.
- **Code identifiers do not change:** `rental_*` tables/columns, `rental_offerings`, `offersRentals`, `/rentals` route, `OfferingRow`, `OfferingDialog`, `listOfferings` — copy only (spec ruling 3).
- **Forbidden words in provider-facing admin copy:** `rental`, `rentals`, `offering`, `offerings` (any case). Allowed exceptions: the range-mode badges `Hourly` / `Nightly` / `Daily`, code identifiers, comments.
- **Every provider-facing string introduced by this slice lives in `src/features/orgs/vocab.ts` (`SPACES`, `APPOINTMENTS`) or `src/features/marketing/site.ts` (`WELCOME`)** — never inlined in JSX.
- **Nav order is fixed regardless of mode:** `/bookings, /clients | /services, /rentals, /team, /availability | /booking-page, /embed | /billing, /settings` (`/overview` first when its flag is on).
- **No migrations.** H4 keeps `0059`.
- **Tests:** Vitest Node environment, `src/**/*.test.ts` only — there are no DOM/component tests in this repo; do not add `@testing-library` or jsdom.
- **Marketing copy guard:** `site.test.ts` scans every `WELCOME` value with `FORBIDDEN_COPY = ["google", "calendar sync", "stripe", "payment"]` — keep `WELCOME` values flat strings or `(x) => string` functions.
- **Commits:** conventional prefix (`feat(nav):`, `feat(vocab):` …), end the message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- After each task: `npx vitest run <changed test files>` and `npm run typecheck` must be green before committing. `npm run verify` (lint + typecheck + all tests) once at the end (Task 7).
- After the last commit run `graphify update .` (project rule, AST-only).

---

## File structure

| File | Responsibility |
|---|---|
| `src/components/shell/nav.ts` (modify) | `NavSection` type, `NAV_SECTIONS` order, `NAV_SECTION_LABELS`, the one ordered `ALL_NAV_ITEMS` list |
| `src/components/shell/nav.test.ts` (modify) | per-mode rows in order, section membership, labels |
| `src/components/shell/sidebar-body.tsx` (modify) | iterates `NAV_SECTIONS` instead of a local literal |
| `src/features/orgs/vocab.ts` (modify) | `SPACES` gains admin words; new `APPOINTMENTS` |
| `src/features/orgs/vocab.test.ts` (modify) | admin words present; no forbidden words in the constants |
| `src/features/orgs/admin-copy.test.ts` (create) | source-text guard over every admin surface this slice touches |
| `src/app/(dashboard)/rentals/page.tsx`, `src/app/(dashboard)/rentals/[id]/page.tsx`, `src/features/rentals/components/offering-dialog.tsx`, `src/features/rentals/components/units-editor.tsx`, `src/features/rentals/components/new-rental-booking-dialog.tsx` (modify) | Spaces pages consume `SPACES` |
| `src/components/command-menu.tsx`, `src/features/orgs/components/business-settings.tsx`, `src/app/(dashboard)/team/page.tsx`, `src/features/scheduling/components/scheduling-settings-form.tsx`, `src/features/scheduling/components/bookings-list.tsx` (modify) | remaining admin copy consumes `SPACES` / `APPOINTMENTS` |
| `src/features/scheduling/setup-checklist.ts` (create) + `.test.ts` (create) | pure `setupChecklist(input) → items` |
| `src/features/marketing/site.ts` (modify) | `WELCOME` per-mode subtitles + checklist labels |
| `src/features/scheduling/queries.ts` (modify) | `countHoursOwners()` |
| `src/app/(dashboard)/bookings/page.tsx` (modify) | computes checklist inputs only under `?welcome=1` |
| `src/features/scheduling/components/welcome-banner.tsx` (modify) | renders the checklist chips |

---

### Task 1: Nav sections — Offer / Share / account

**Files:**
- Modify: `src/components/shell/nav.ts`
- Modify: `src/components/shell/sidebar-body.tsx:37`
- Test: `src/components/shell/nav.test.ts`

**Interfaces:**
- Consumes: `SPACES.nav` from `@/features/orgs/vocab` (exists on the base branch).
- Produces: `export type NavSection = "main" | "offer" | "share" | "account"`, `export const NAV_SECTIONS: readonly NavSection[]`, `export const NAV_SECTION_LABELS: Record<NavSection, string | null>`, `NavItem.section: NavSection`. `navItemsFor(flags, mode)` and `titleForPath` keep their signatures.

- [ ] **Step 1: Replace the `navItemsFor` tests with order + section assertions**

Replace the whole `describe("navItemsFor (flags × mode)", …)` block in `src/components/shell/nav.test.ts` with:

```ts
import { navItemsFor, titleForPath, NAV_SECTIONS, NAV_SECTION_LABELS } from "./nav";
// (keep the other imports and the RENTALS_ONLY / APPTS_ONLY / FLAGS / hrefs helpers as they are)

describe("navItemsFor (flags × mode) — spec §1 table, fixed order", () => {
  it("both channels: every row, in the spec's order", () => {
    expect(hrefs(FLAGS, BOTH)).toEqual([
      "/bookings", "/clients",
      "/services", "/rentals", "/team", "/availability",
      "/booking-page", "/embed",
      "/settings",
    ]);
  });
  it("rentals-only: keeps Availability (it covers spaces from U3), hides Services and Team", () => {
    expect(hrefs(FLAGS, RENTALS_ONLY)).toEqual([
      "/bookings", "/clients", "/rentals", "/availability", "/booking-page", "/embed", "/settings",
    ]);
  });
  it("appointments-only: hides Spaces, keeps the rest in order", () => {
    expect(hrefs(FLAGS, APPTS_ONLY)).toEqual([
      "/bookings", "/clients", "/services", "/team", "/availability", "/booking-page", "/embed", "/settings",
    ]);
  });
  it("sections: Offer holds the catalogue nouns, Share the channels, account the rest", () => {
    const all = navItemsFor({ ...FLAGS, billing: true, overview: true }, BOTH);
    const by = (s: (typeof NAV_SECTIONS)[number]) => all.filter((i) => i.section === s).map((i) => i.href);
    expect(by("main")).toEqual(["/overview", "/bookings", "/clients"]);
    expect(by("offer")).toEqual(["/services", "/rentals", "/team", "/availability"]);
    expect(by("share")).toEqual(["/booking-page", "/embed"]);
    expect(by("account")).toEqual(["/billing", "/settings"]);
    for (const i of all) expect(NAV_SECTIONS).toContain(i.section);
  });
  it("section labels: Offer and Share are labelled, main and account are not", () => {
    expect(NAV_SECTIONS).toEqual(["main", "offer", "share", "account"]);
    expect(NAV_SECTION_LABELS).toEqual({ main: null, offer: "Offer", share: "Share", account: null });
  });
  it("the /rentals item is labelled Spaces (H5a vocabulary), and titles its page", () => {
    const item = navItemsFor(FLAGS, BOTH).find((i) => i.href === "/rentals");
    expect(item?.label).toBe("Spaces");
    expect(titleForPath("/rentals", navItemsFor(FLAGS, BOTH))).toBe("Spaces");
  });
  it("the rentals kill-switch beats the mode", () => {
    expect(hrefs({ ...FLAGS, rentals: false }, BOTH)).not.toContain("/rentals");
  });
  it("existing flag gating is untouched", () => {
    const h = hrefs(FLAGS, BOTH); // billing + overview off in FLAG_DEFAULTS
    expect(h).not.toContain("/billing");
    expect(h).not.toContain("/overview");
  });
});
```

Leave the `describe("titleForPath", …)` block unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/shell/nav.test.ts`
Expected: FAIL — `NAV_SECTIONS` is not exported; the "both channels" order differs (`/rentals` currently sits after `/availability`); rentals-only currently lacks `/availability`.

- [ ] **Step 3: Rewrite the list and sections in `nav.ts`**

Replace everything from the header comment through `NAV_SECTION_LABELS` in `src/components/shell/nav.ts` with:

```ts
// Post-pivot nav (S5): Bookings leads and stays the post-login surface (S2
// user ruling). The command menu derives from this list. `section` splits
// the sidebar Linear-style (admin IA spec 2026-08-25 §1): day-to-day views
// on top, then "Offer" (what the org sells — Services, Spaces, Team,
// Availability), then "Share" (where clients book — the two channels), then
// an unlabelled account group (Billing, Settings). The order is fixed
// regardless of mode: a single-mode org loses rows, it never reorders.
// Settings holds only admin-panel preferences plus the org's "what you
// offer" group (R3 relaxation of the 2026-08-17 ruling). Icons are Hugeicons
// stroke-rounded (free set) — render with <HugeiconsIcon icon={…} />.
export type NavSection = "main" | "offer" | "share" | "account";

/** Sidebar render order. The sidebar iterates this, so a section added here
    cannot be forgotten there. */
export const NAV_SECTIONS: readonly NavSection[] = ["main", "offer", "share", "account"];

export const NAV_SECTION_LABELS: Record<NavSection, string | null> = {
  main: null,
  offer: "Offer",
  share: "Share",
  account: null,
};

export type NavItem = {
  href: string;
  label: string;
  icon: IconSvgElement;
  section: NavSection;
  /** Set when the item belongs to one booking channel; omitted = always
      shown. navItemsFor filters on it. */
  channel?: Channel;
};

const ALL_NAV_ITEMS: readonly NavItem[] = [
  // Shown only when the org's `overview` flag resolves true (lib/flags).
  { href: "/overview", label: "Overview", icon: DashboardSquare01Icon, section: "main" },
  { href: "/bookings", label: "Bookings", icon: Calendar03Icon, section: "main" },
  { href: "/clients", label: "Clients", icon: UserMultipleIcon, section: "main" },
  { href: "/services", label: "Services", icon: Briefcase01Icon, section: "offer", channel: "appointments" },
  { href: "/rentals", label: SPACES.nav, icon: House01Icon, section: "offer", channel: "rentals" },
  // Always present, solo or not: a solo provider sees one row (themselves).
  { href: "/team", label: "Team", icon: UserGroupIcon, section: "offer", channel: "appointments" },
  // No channel: from U3 it edits hours for people AND hourly spaces, so it
  // stays for every mode (a nights-only org gets an explanatory empty state).
  { href: "/availability", label: "Availability", icon: Clock01Icon, section: "offer" },
  { href: "/booking-page", label: "Booking page", icon: Globe02Icon, section: "share" },
  { href: "/embed", label: "Website embed", icon: SourceCodeIcon, section: "share" },
  // Shown only when the org's `billing` flag resolves true; the route 404s
  // in the same world.
  { href: "/billing", label: "Billing", icon: CreditCardIcon, section: "account" },
  { href: "/settings", label: "Settings", icon: Settings01Icon, section: "account" },
];
```

Keep `navItemsFor` and `titleForPath` exactly as they are (the `/availability` row simply no longer has a `channel`, so the appointments filter no longer removes it). Delete the old `export const NAV_SECTION_LABELS = { main: null, configure: "Configure" } as const;` line.

- [ ] **Step 4: Make the sidebar iterate `NAV_SECTIONS`**

In `src/components/shell/sidebar-body.tsx`:

```ts
// line 7 — extend the import
import { navItemsFor, NAV_SECTIONS, NAV_SECTION_LABELS } from "./nav";
```

and replace line 37:

```ts
  const sections = ["main", "configure"] as const;
```

with

```ts
  const sections = NAV_SECTIONS;
```

Nothing else in the file changes — the `sections.map(...)` below already renders a label only when `NAV_SECTION_LABELS[section]` is non-null, so the unlabelled `account` group is separated by the existing `gap-4` alone.

- [ ] **Step 5: Confirm nothing else names the old section**

Run: `grep -rn '"configure"' src` — Expected: no matches. (Comments may still mention "Configure" in prose; `grep -rn 'Configure' src` should show only comments — update any that describe the old grouping to say Offer/Share.)

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run src/components/shell/nav.test.ts && npm run typecheck`
Expected: nav tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/shell/nav.ts src/components/shell/nav.test.ts src/components/shell/sidebar-body.tsx
git commit -m "feat(nav): group the sidebar into Offer / Share / account; Availability for every mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Vocabulary constants — `SPACES` admin words, `APPOINTMENTS`

**Files:**
- Modify: `src/features/orgs/vocab.ts`
- Test: `src/features/orgs/vocab.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–6):

```ts
SPACES.one: "space"
SPACES.newButton: "New space"
SPACES.dialogTitle: { new: "New space"; edit: "Edit space" }
SPACES.back: "← Spaces"
SPACES.empty: string
SPACES.unitsHint: string
SPACES.unitsEmpty: string
SPACES.field: "Space"
SPACES.command: "New space"
SPACES.settings: { label: "Spaces"; blurb: string }
SPACES.add: "Add a space"
APPOINTMENTS.settings: { label: "Appointments"; blurb: string }
APPOINTMENTS.add: "Add a service"
```

- [ ] **Step 1: Add the failing tests**

Append to `src/features/orgs/vocab.test.ts` (and extend its first import line to `import { SPACES, APPOINTMENTS, bookingDescription } from "./vocab";`):

```ts
describe("admin vocabulary (admin IA spec §1)", () => {
  const flatten = (v: unknown): string[] =>
    typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(flatten) : [];

  it("never says rental or offering to a provider", () => {
    const corpus = [...flatten(SPACES), ...flatten(APPOINTMENTS)].join("\n").toLowerCase();
    for (const word of ["rental", "offering"]) {
      expect(corpus, `vocab mentions "${word}"`).not.toContain(word);
    }
  });

  it("names every admin surface this slice touches", () => {
    expect(SPACES.one).toBe("space");
    expect(SPACES.newButton).toBe("New space");
    expect(SPACES.dialogTitle).toEqual({ new: "New space", edit: "Edit space" });
    expect(SPACES.back).toBe("← Spaces");
    expect(SPACES.empty).toBe(
      "No spaces yet — a space is a room, studio or item clients book by the hour, night or day. Add one, then add its units.",
    );
    expect(SPACES.unitsHint).toBe("Units are the individual rooms or items a client is assigned — one per room.");
    expect(SPACES.unitsEmpty).toBe(
      "No units yet — the space won't appear on your booking page until it has an active unit.",
    );
    expect(SPACES.field).toBe("Space");
    expect(SPACES.command).toBe("New space");
    expect(SPACES.settings).toEqual({
      label: "Spaces",
      blurb: "Rooms, studios and gear, booked by the hour, night or day.",
    });
    expect(SPACES.add).toBe("Add a space");
    expect(APPOINTMENTS.settings).toEqual({
      label: "Appointments",
      blurb: "Services booked as time slots with your team.",
    });
    expect(APPOINTMENTS.add).toBe("Add a service");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/orgs/vocab.test.ts`
Expected: FAIL — `APPOINTMENTS` is not exported (TypeScript/ESM import error) and the `SPACES.*` admin keys are `undefined`.

- [ ] **Step 3: Extend `vocab.ts`**

Replace the `SPACES` object in `src/features/orgs/vocab.ts` with:

```ts
export const SPACES = {
  /** Sidebar item for /rentals; the admin page title follows via titleForPath. */
  nav: "Spaces",
  /** Widget group heading above the rental cards (shown only next to services). */
  widgetGroup: "Spaces",
  /** Page-builder section label + description (SECTION_META.spaces). */
  section: { label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." },
  /** Onboarding mode picker. */
  pickerTitle: "Spaces",
  pickerBlurb: "Rooms, studios and gear, booked by the hour, night or day.",
  pickerBothBlurb: "You book people and spaces.",

  // ---- admin surfaces (admin IA spec 2026-08-25 §1). "Offering" and
  // "rental" never reach a provider's eyes; the code keeps its identifiers.
  one: "space",
  newButton: "New space",
  dialogTitle: { new: "New space", edit: "Edit space" },
  /** Back link on the space detail page. */
  back: "← Spaces",
  /** /rentals list with nothing in it. */
  empty:
    "No spaces yet — a space is a room, studio or item clients book by the hour, night or day. Add one, then add its units.",
  /** One muted line above the units editor. */
  unitsHint: "Units are the individual rooms or items a client is assigned — one per room.",
  unitsEmpty: "No units yet — the space won't appear on your booking page until it has an active unit.",
  /** Label of the walk-in dialog's picker when only spaces are listed. */
  field: "Space",
  /** ⌘K action. */
  command: "New space",
  /** Settings › Business row. */
  settings: { label: "Spaces", blurb: "Rooms, studios and gear, booked by the hour, night or day." },
  /** Welcome checklist item + Bookings empty state. */
  add: "Add a space",
} as const;

/** The appointments channel's few provider-facing words that sit next to
    SPACES' (Settings row, welcome checklist). */
export const APPOINTMENTS = {
  settings: { label: "Appointments", blurb: "Services booked as time slots with your team." },
  add: "Add a service",
} as const;
```

`bookingDescription` stays as it is.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/orgs/vocab.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts
git commit -m "feat(vocab): SPACES admin words and APPOINTMENTS constants

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Spaces pages say "space" (+ the source-text copy guard)

**Files:**
- Create: `src/features/orgs/admin-copy.test.ts`
- Modify: `src/app/(dashboard)/rentals/page.tsx:13-17`
- Modify: `src/app/(dashboard)/rentals/[id]/page.tsx:47-49`
- Modify: `src/features/rentals/components/offering-dialog.tsx:156-159, 165, 299`
- Modify: `src/features/rentals/components/units-editor.tsx:44-49, 54-57`
- Modify: `src/features/rentals/components/new-rental-booking-dialog.tsx:345`

**Interfaces:**
- Consumes: `SPACES` (Task 2).
- Produces: `admin-copy.test.ts` with an exported-by-convention `SURFACES` list that Task 4 extends.

- [ ] **Step 1: Write the guard test**

Create `src/features/orgs/admin-copy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/* Provider-facing admin copy never says "rental" or "offering" (admin IA
   spec §1, ruling 3). Vitest runs in Node with no DOM, so this guards the
   SOURCE of each surface: JSX text nodes and the labelled string props.
   Identifiers (`listOfferings`, `rentalOfferingId`) live inside `{…}` or
   before `(`/`.` and are never matched. Extend SURFACES as surfaces migrate. */
export const SURFACES = [
  "src/app/(dashboard)/rentals/page.tsx",
  "src/app/(dashboard)/rentals/[id]/page.tsx",
  "src/features/rentals/components/offering-dialog.tsx",
  "src/features/rentals/components/units-editor.tsx",
  "src/features/rentals/components/new-rental-booking-dialog.tsx",
];

/* The exact literals the audit found. Cheap, unambiguous, and the first thing
   to fail when someone re-inlines a string. */
const FORBIDDEN_LITERALS = [
  "No rentals yet",
  "New rental",
  "Edit rental",
  "← Rentals",
  ">Offering<",
  "Clients see the rental",
  "the offering won",
];

/* JSX text between tags — `>text<` — that contains a forbidden word and no
   code punctuation; and a labelled string prop with one. */
const JSX_TEXT = />\s*[^<>{}();]*\b(rentals?|offerings?)\b[^<>{}();]*</gi;
const LABEL_PROP = /\b(label|title|hint|placeholder|description|aria-label)=["'][^"']*\b(rentals?|offerings?)\b[^"']*["']/gi;

describe("admin copy guard", () => {
  for (const file of SURFACES) {
    it(`${file} never shows "rental" or "offering" to a provider`, () => {
      const src = readFileSync(file, "utf8");
      for (const lit of FORBIDDEN_LITERALS) {
        expect(src, `${file} still contains "${lit}"`).not.toContain(lit);
      }
      const text = src.match(JSX_TEXT) ?? [];
      expect(text, `${file} JSX text: ${text.join(" | ")}`).toEqual([]);
      const props = src.match(LABEL_PROP) ?? [];
      expect(props, `${file} labelled props: ${props.join(" | ")}`).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/orgs/admin-copy.test.ts`
Expected: FAIL for all five files — the literal list catches "No rentals yet", "New rental", "Edit rental", "← Rentals", ">Offering<", "Clients see the rental", "the offering won"; `JSX_TEXT` additionally reports the empty-state sentences.

- [ ] **Step 3: Migrate `/rentals` page**

In `src/app/(dashboard)/rentals/page.tsx` add `import { SPACES } from "@/features/orgs/vocab";` and replace lines 13–17:

```tsx
      {offerings.length === 0 ? (
        <p className="text-muted-foreground text-sm">{SPACES.empty}</p>
      ) : (
```

- [ ] **Step 4: Migrate the offering dialog**

In `src/features/rentals/components/offering-dialog.tsx` add `import { SPACES } from "@/features/orgs/vocab";` and change:

```tsx
            <Button size="sm">
              <Plus className="size-4" /> {SPACES.newButton}
            </Button>
```

```tsx
          <DialogTitle>{isEdit ? SPACES.dialogTitle.edit : SPACES.dialogTitle.new}</DialogTitle>
```

```tsx
          {/* "Stay" is a hotel word; an hourly room is a session. `rangeMode`
              is the dialog's own live state (the select just below). */}
          <SectionHeading>{rangeMode === "hours" ? "Session" : "Stay"}</SectionHeading>
```

- [ ] **Step 5: Migrate the units editor**

In `src/features/rentals/components/units-editor.tsx` add `import { SPACES } from "@/features/orgs/vocab";` and replace the intro paragraph and the empty state:

```tsx
        <p className="text-muted-foreground text-xs">{SPACES.unitsHint}</p>
```

```tsx
      {units.length === 0 ? (
        <p className="text-muted-foreground text-sm">{SPACES.unitsEmpty}</p>
      ) : (
```

- [ ] **Step 6: Migrate the detail page's back link and the walk-in label**

`src/app/(dashboard)/rentals/[id]/page.tsx` — add `import { SPACES } from "@/features/orgs/vocab";` and:

```tsx
        <Link href="/rentals" className="text-muted-foreground w-fit text-xs hover:underline">
          {SPACES.back}
        </Link>
```

`src/features/rentals/components/new-rental-booking-dialog.tsx` — add `import { SPACES } from "@/features/orgs/vocab";` and:

```tsx
          <Label htmlFor="new-rental-offering">{SPACES.field}</Label>
```

(The `id`/`htmlFor` stay — they are code, not copy.)

- [ ] **Step 7: Run the guard, then the whole suite for the touched features**

Run: `npx vitest run src/features/orgs src/features/rentals && npm run typecheck`
Expected: PASS. If the guard reports something the steps above did not cover, read the snippet in the assertion message — it prints the match. If it is copy (e.g. a hint inside `offering-dialog.tsx` that says "this offering"), reword it in place with the word **space** ("this space"). If it is genuinely code (a comparison whose operands mention an identifier), wrap that expression in `{…}` braces or move it off the JSX line rather than loosening the regex.

- [ ] **Step 8: Commit**

```bash
git add src/features/orgs/admin-copy.test.ts "src/app/(dashboard)/rentals/page.tsx" "src/app/(dashboard)/rentals/[id]/page.tsx" src/features/rentals/components/offering-dialog.tsx src/features/rentals/components/units-editor.tsx src/features/rentals/components/new-rental-booking-dialog.tsx
git commit -m "feat(spaces): Spaces pages speak 'space' — list, dialog, units, detail, walk-in; source-text copy guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The rest of the admin copy — ⌘K, Settings, Team, currency, Bookings empty state

**Files:**
- Modify: `src/features/orgs/admin-copy.test.ts` (extend `SURFACES` and `FORBIDDEN_LITERALS`)
- Modify: `src/components/command-menu.tsx:72-76`
- Modify: `src/features/orgs/components/business-settings.tsx:11-14`
- Modify: `src/app/(dashboard)/team/page.tsx:27-29`
- Modify: `src/features/scheduling/components/scheduling-settings-form.tsx:154`
- Modify: `src/features/scheduling/components/bookings-list.tsx:168-184`

**Interfaces:**
- Consumes: `SPACES.command`, `SPACES.settings`, `SPACES.add`, `APPOINTMENTS.settings`, `APPOINTMENTS.add` (Task 2).

- [ ] **Step 1: Extend the guard**

In `src/features/orgs/admin-copy.test.ts` append to `SURFACES`:

```ts
  "src/components/command-menu.tsx",
  "src/features/orgs/components/business-settings.tsx",
  "src/app/(dashboard)/team/page.tsx",
  "src/features/scheduling/components/scheduling-settings-form.tsx",
  "src/features/scheduling/components/bookings-list.tsx",
```

and to `FORBIDDEN_LITERALS`:

```ts
  "New rental offering",
  "Units booked by the night or day",
  "Services booked as time slots on your calendar",
  "Everyone who can be booked",
  "Shown on rental prices",
  "a rental offering",
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/orgs/admin-copy.test.ts`
Expected: FAIL for the five new files.

- [ ] **Step 3: ⌘K action**

`src/components/command-menu.tsx` — add `import { SPACES } from "@/features/orgs/vocab";` and:

```tsx
          {mode.offersRentals && (
            <CommandItem onSelect={() => go("/rentals?new=1")}>
              <Plus className="size-4" /> {SPACES.command}
            </CommandItem>
          )}
```

- [ ] **Step 4: Settings › Business rows**

`src/features/orgs/components/business-settings.tsx` — add `import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";` and replace `ROWS`:

```ts
const ROWS = [
  { key: "offersAppointments", ...APPOINTMENTS.settings },
  { key: "offersRentals", ...SPACES.settings },
] as const;
```

(`row.label` / `row.blurb` below keep working — the spread supplies both.)

- [ ] **Step 5: Team intro and currency hint**

`src/app/(dashboard)/team/page.tsx`:

```tsx
      <PageIntro>
        Your bookable people. Each has their own hours, services and booking link.
      </PageIntro>
```

`src/features/scheduling/components/scheduling-settings-form.tsx` line 154:

```tsx
        hint="Shown on prices and deposits."
```

- [ ] **Step 6: Bookings empty state**

`src/features/scheduling/components/bookings-list.tsx` — add `import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";` and replace the empty-state `<p>` (lines 168–184):

```tsx
          <p className="text-muted-foreground text-sm">
            No upcoming bookings.{" "}
            {mode.offersAppointments ? (
              <Link href="/services" className="underline">{APPOINTMENTS.add}</Link>
            ) : null}
            {mode.offersAppointments && mode.offersRentals ? " or " : null}
            {mode.offersRentals ? (
              <Link href="/rentals" className="underline">
                {mode.offersAppointments ? SPACES.add.toLowerCase() : SPACES.add}
              </Link>
            ) : null}
            , then share your booking page.
          </p>
```

Renders as "No upcoming bookings. Add a service or add a space, then share your booking page." for both modes; "…Add a space, then…" for rentals-only.

- [ ] **Step 7: Run the guard, related suites and typecheck**

Run: `npx vitest run src/features/orgs src/features/scheduling src/components && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/orgs/admin-copy.test.ts src/components/command-menu.tsx src/features/orgs/components/business-settings.tsx "src/app/(dashboard)/team/page.tsx" src/features/scheduling/components/scheduling-settings-form.tsx src/features/scheduling/components/bookings-list.tsx
git commit -m "feat(copy): Spaces vocabulary on ⌘K, Settings, Team, currency hint and the Bookings empty state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `setupChecklist()` and the per-mode `WELCOME` copy

**Files:**
- Create: `src/features/scheduling/setup-checklist.ts`
- Create: `src/features/scheduling/setup-checklist.test.ts`
- Modify: `src/features/marketing/site.ts:212-227` (`WELCOME`)

**Interfaces:**
- Consumes: `APPOINTMENTS.add`, `SPACES.add` (Task 2); `WELCOME.setHours`, `WELCOME.publish` (this task).
- Produces (consumed by Task 6):

```ts
export type ChecklistInput = {
  mode: OrgMode; serviceCount: number; spaceCount: number; ownersWithHours: number; published: boolean;
};
export type ChecklistItem = { id: "service" | "space" | "hours" | "publish"; label: string; href: string; done: boolean };
export function setupChecklist(input: ChecklistInput): ChecklistItem[];
```

Spec deviation, on purpose: the spec's "Set hours" item is shown when `offersAppointments || hourlySpaceCount > 0`. In U1 `/availability` still redirects rentals-only orgs (U3 lifts that), so U1 shows "Set hours" only when `offersAppointments`; U3 adds the `hourlySpaceCount` input and condition. Note it in the U3 plan.

- [ ] **Step 1: Write the failing tests**

Create `src/features/scheduling/setup-checklist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setupChecklist } from "./setup-checklist";

const BOTH = { offersAppointments: true, offersRentals: true };
const APPTS = { offersAppointments: true, offersRentals: false };
const RENTALS = { offersAppointments: false, offersRentals: true };
const nothing = { serviceCount: 0, spaceCount: 0, ownersWithHours: 0, published: false };

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
  it("rentals-only: space and publish only (hours joins in U3 when /availability serves spaces)", () => {
    expect(setupChecklist({ mode: RENTALS, ...nothing }).map((i) => i.id)).toEqual(["space", "publish"]);
  });
  it("ticks follow the counts", () => {
    const items = setupChecklist({ mode: BOTH, serviceCount: 2, spaceCount: 0, ownersWithHours: 1, published: true });
    expect(Object.fromEntries(items.map((i) => [i.id, i.done]))).toEqual({
      service: true, space: false, hours: true, publish: true,
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/scheduling/setup-checklist.test.ts`
Expected: FAIL — module `./setup-checklist` not found.

- [ ] **Step 3: Add the `WELCOME` copy**

In `src/features/marketing/site.ts` replace the `WELCOME` object:

```ts
/** First screen after onboarding (/bookings?welcome=1). One subtitle per
    mode; the checklist labels below are the chips' text (setup-checklist.ts). */
export const WELCOME = {
  owned: (url: string) => `${url} is yours.`,
  sub: "Add a service and set your hours to go live.",
  subRentals: "Add a space and its units to go live.",
  subBoth: "Add what you offer, set hours, publish — then share your link.",
  setHours: "Set hours",
  publish: "Publish your page",
  // Still referenced by welcome-banner.tsx until Task 6 rewrites it; Task 6
  // deletes these two lines.
  addService: "Add a service",
  addOffering: "Add a rental offering",
  copyLink: "Copy link",
  copied: "Copied",
  noHandle: "Your workspace is ready.",
  noHandleSub: "Pick a page address and you're bookable.",
  setUpPage: "Set up your booking page",
  dismiss: "Dismiss",
} as const;
```

(`site.test.ts` keeps scanning every value; all stay flat strings or `(url) => string`.)

- [ ] **Step 4: Implement `setupChecklist`**

Create `src/features/scheduling/setup-checklist.ts`:

```ts
import type { OrgMode } from "@/features/orgs/mode";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import { WELCOME } from "@/features/marketing/site";

/* The welcome banner's setup chips (admin IA spec §4). Pure: the Bookings
   page gathers the counts only under ?welcome=1 and nothing is persisted —
   every tick is derived from data that already exists. */
export type ChecklistInput = {
  mode: OrgMode;
  serviceCount: number;      // active services
  spaceCount: number;        // active spaces (rental offerings)
  ownersWithHours: number;   // team members or hourly spaces with ≥1 weekly rule
  published: boolean;        // booking page has a published document
};

export type ChecklistItem = {
  id: "service" | "space" | "hours" | "publish";
  label: string;
  href: string;
  done: boolean;
};

export function setupChecklist(i: ChecklistInput): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  if (i.mode.offersAppointments) {
    items.push({ id: "service", label: APPOINTMENTS.add, href: "/services?new=1", done: i.serviceCount > 0 });
  }
  if (i.mode.offersRentals) {
    items.push({ id: "space", label: SPACES.add, href: "/rentals?new=1", done: i.spaceCount > 0 });
  }
  // U1: appointments only. U3 makes /availability serve hourly spaces and
  // adds `hourlySpaceCount > 0` to this condition.
  if (i.mode.offersAppointments) {
    items.push({ id: "hours", label: WELCOME.setHours, href: "/availability", done: i.ownersWithHours > 0 });
  }
  items.push({ id: "publish", label: WELCOME.publish, href: "/booking-page", done: i.published });
  return items;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/scheduling/setup-checklist.test.ts src/features/marketing/site.test.ts && npm run typecheck`
Expected: checklist tests PASS; `site.test.ts` PASS (WELCOME still scanned, no forbidden word); typecheck clean (`welcome-banner.tsx` still reads `addService`/`addOffering`, which Task 6 removes).

- [ ] **Step 6: Commit**

```bash
git add src/features/scheduling/setup-checklist.ts src/features/scheduling/setup-checklist.test.ts src/features/marketing/site.ts
git commit -m "feat(welcome): setupChecklist() and per-mode WELCOME copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire the checklist into the welcome banner

**Files:**
- Modify: `src/features/scheduling/queries.ts` (add `countHoursOwners`)
- Modify: `src/app/(dashboard)/bookings/page.tsx:26, 56-83`
- Modify: `src/features/scheduling/components/welcome-banner.tsx`

**Interfaces:**
- Consumes: `setupChecklist`, `ChecklistItem` (Task 5); `WELCOME.subBoth/sub/subRentals` (Task 5); `getPageDraftState(orgId)` from `@/features/booking-page/queries` (exists: returns `{ draft, published: PageDocument | null, publishedAt }`); `listServices()` (`ServiceRow.active`), `listOfferings()` (`OfferingRow.active`) — both exist.
- Produces: `countHoursOwners(): Promise<number>`; `WelcomeBanner` prop `checklist: ChecklistItem[]`.

- [ ] **Step 1: Add `countHoursOwners` to `src/features/scheduling/queries.ts`**

Append (next to `getAvailabilityAdmin`):

```ts
/** How many owners — team members or hourly spaces — have at least one weekly
    rule. Drives the welcome checklist's "Set hours" tick. RLS scopes the
    read to the caller's org; rows carry exactly one of staff_id /
    rental_offering_id (0056 XOR check), so the owner key is whichever is set. */
export async function countHoursOwners(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("staff_id, rental_offering_id");
  if (error) throw error;
  const owners = new Set<string>();
  for (const r of data ?? []) {
    const key = r.staff_id ?? r.rental_offering_id;
    if (key) owners.add(key);
  }
  return owners.size;
}
```

There is no unit test for this (it is a one-statement RLS read like its neighbours); the browser QA in Task 7 exercises it.

- [ ] **Step 2: Compute the checklist in `bookings/page.tsx`**

Add imports:

```ts
import { countHoursOwners } from "@/features/scheduling/queries"; // extend the existing queries import
import { getPageDraftState } from "@/features/booking-page/queries";
import { setupChecklist, type ChecklistItem } from "@/features/scheduling/setup-checklist";
```

Replace the `welcome` computation (lines 80–83):

```ts
  // Welcome checklist: three cheap reads, only on the one request that
  // carries ?welcome=1 (nothing is persisted — spec §4 ruling 8).
  // `orgOfferings` was already fetched above when the org sells spaces.
  let checklist: ChecklistItem[] = [];
  if (params.welcome === "1") {
    const [services, ownersWithHours, page] = await Promise.all([
      eff.offersAppointments ? listServices() : Promise.resolve([]),
      countHoursOwners(),
      getPageDraftState(org.id),
    ]);
    checklist = setupChecklist({
      mode: eff,
      serviceCount: services.filter((s) => s.active).length,
      spaceCount: orgOfferings.filter((o) => o.active).length,
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
```

- [ ] **Step 3: Render the chips in `welcome-banner.tsx`**

Replace the file's imports, props and JSX as follows (the `copy` handler and the `router` stay exactly as they are):

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, CheckmarkCircle01Icon, CircleIcon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { WELCOME } from "@/features/marketing/site";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrgMode } from "@/features/orgs/mode";
import type { ChecklistItem } from "@/features/scheduling/setup-checklist";

// Shown once, driven by ?welcome=1 (nothing persisted). The public page 404s
// until something is bookable, so the promise is "yours", not "live". `mode`
// is the EFFECTIVE mode (features/orgs/mode.ts effectiveMode — the caller
// composes it with the rentals kill switch). The checklist is computed by the
// page (setup-checklist.ts) from data that already exists.
export function WelcomeBanner({
  handle,
  appUrl,
  mode,
  checklist,
}: {
  handle: string | null;
  appUrl: string;
  mode: OrgMode;
  checklist: ChecklistItem[];
}) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const url = handle ? bookingUrl(appUrl, handle) : null;
  const sub =
    mode.offersAppointments && mode.offersRentals
      ? WELCOME.subBoth
      : mode.offersAppointments
        ? WELCOME.sub
        : WELCOME.subRentals;

  // Awaited: a refused clipboard write must not flip the button to "Copied"
  // (portal-links-panel.tsx precedent).
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the link text and copy manually.");
    }
  };

  return (
    <div role="status" className="bg-card flex flex-col gap-3 rounded-xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-medium">
            {url ? WELCOME.owned(`${hostLabel(appUrl)}/${handle}`) : WELCOME.noHandle}
          </p>
          <p className="text-muted-foreground text-xs">{url ? sub : WELCOME.noHandleSub}</p>
        </div>
        {url ? (
          <Button size="sm" variant="outline" onClick={copy}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
            {copied ? WELCOME.copied : WELCOME.copyLink}
          </Button>
        ) : (
          <Link href="/booking-page" className={cn(buttonVariants({ size: "sm" }))}>
            {WELCOME.setUpPage}
          </Link>
        )}
        <Button size="sm" variant="ghost" aria-label={WELCOME.dismiss} onClick={() => router.replace("/bookings")}>
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </Button>
      </div>
      {/* Setup chips: one per channel the org sells, plus hours and publish.
          A done item stays visible (struck through) so the row reads as
          progress, not as a shrinking to-do list. */}
      {url && checklist.length > 0 ? (
        <ul aria-label="Setup checklist" className="flex flex-wrap items-center gap-2">
          {checklist.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-label={item.done ? `${item.label} — done` : item.label}
                className={cn(buttonVariants({ size: "sm", variant: item.done ? "ghost" : "outline" }))}
              >
                <HugeiconsIcon
                  icon={item.done ? CheckmarkCircle01Icon : CircleIcon}
                  size={14}
                  className={item.done ? "text-primary" : "text-muted-foreground"}
                />
                <span className={item.done ? "line-through opacity-70" : undefined}>{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Drop the two now-unused `WELCOME` keys**

In `src/features/marketing/site.ts` delete the `addService` and `addOffering` lines (and their two-line comment) from `WELCOME`. Then `grep -rn "addService\|addOffering" src` — Expected: no matches.

- [ ] **Step 5: Typecheck, lint, related tests**

Run: `npm run typecheck && npx eslint src/features/scheduling src/app/\(dashboard\)/bookings && npx vitest run src/features/scheduling src/features/marketing`
Expected: all clean/PASS.

- [ ] **Step 6: Look at it**

With the local stack up (`npm run dev` from this checkout; Supabase per README), sign in as `demo@rolloutos.local` / `Password123!` and open `http://localhost:3000/bookings?welcome=1`. Expected: banner with subtitle "Add what you offer, set hours, publish — then share your link." and four chips — `Add a service` ✓ (demo seeds services), `Add a space` ✓, `Set hours` ✓, `Publish your page` ○ (unless you published) — each a link to its page; Copy link and Dismiss still work. Save a screenshot to `.playwright-mcp/u1-welcome.png` (gitignored) for the QA ledger.

- [ ] **Step 7: Commit**

```bash
git add src/features/scheduling/queries.ts "src/app/(dashboard)/bookings/page.tsx" src/features/scheduling/components/welcome-banner.tsx src/features/marketing/site.ts
git commit -m "feat(welcome): per-mode setup checklist on the first-run banner

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-slice verification and browser QA

**Files:**
- No new files; fixes only if QA finds something (commit them with `fix(ia-u1): …`).

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: lint 0 errors, typecheck clean, all tests pass (baseline on the base branch: 885; this slice adds ≈ 15).

- [ ] **Step 2: Browser QA matrix**

Sign in as the demo org. For each mode — set it in **Settings › Business** (both boxes on = both; untick one for the single modes; the last one is locked) — check and screenshot into `.playwright-mcp/u1-<mode>-<page>.png`:

| check | expected |
|---|---|
| Sidebar | groups `Offer` / `Share` labelled; `Billing`/`Settings` unlabelled below a gap; rows in Global-Constraints order; rentals-only shows `Spaces · Availability` under Offer, appointments-only shows `Services · Team · Availability` |
| Top-bar title on `/rentals` and `/rentals/<id>` | "Spaces" |
| `/rentals` | button **New space**; empty state is `SPACES.empty` when no spaces (create a throwaway org via `/onboarding` if the demo has spaces, or temporarily delete them) ; dialog title **New space** / **Edit space**; section heading **Session** for an hourly space, **Stay** for nightly |
| `/rentals/<id>` | back link **← Spaces**; units intro `SPACES.unitsHint` |
| Bookings week → **New rental booking** dialog | picker label **Space** (button label itself is U2's job) |
| ⌘K | action reads **New space** |
| Settings › Business | rows **Appointments — Services booked as time slots with your team.** / **Spaces — Rooms, studios and gear, booked by the hour, night or day.** |
| `/team` | intro "Your bookable people. …" |
| Booking page › Settings › Currency | hint "Shown on prices and deposits." |
| `/bookings?view=list` with no upcoming bookings | "No upcoming bookings. Add a service or add a space, then share your booking page." (cancel the seeded bookings or use the fresh org) |
| `/bookings?welcome=1` | subtitle + chips per mode (both: 4 chips; appointments-only: 3; rentals-only: 2) |

Record each row's result in `.superpowers/sdd/2026-08-25-admin-ia-u1/progress.md` (the H5a ledger convention).

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`
Expected: completes without error (AST-only).

- [ ] **Step 4: Commit any QA fixes**

```bash
git add -A src
git commit -m "fix(ia-u1): QA follow-ups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip if there is nothing to commit.) Then hand off via `superpowers:finishing-a-development-branch` — PR against `main` once #60 has merged (rebase first if it merged after this branch was cut).
