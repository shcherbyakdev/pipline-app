# Booking-Page Starter Implementation Plan (slice 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first visit to a fresh booking page opens a guided start — *what kind of business is this* → *add your first service (or space) right here* → the page opens on the template that fits, showing the owner's real offering — and the same business-type cards replace the template picker for later visits.

**Architecture:** Three pure modules carry every decision: `business-types.ts` (the type table, 1:1 onto existing templates, and `applyType` = `applyTemplate` + the type's copy), `starter-state.ts` (`isFreshPage`, `skinDefault`, and the step reducer `type → firstItem → done`), and `copy.ts` (every provider-facing string, guarded like `site.ts`). One client component, `StarterDialog`, renders the reducer in two variants — `starter` (opens itself on a fresh page, cannot be dismissed) and `picker` (the old "Start from a template" button) — and hosts two thin forms that call the existing `createService` / `createOffering` actions, then `router.refresh()` so the preview carries the real item. The `/booking-page` route computes `fresh`, `needsFirstItem` and `anyPublished` from data it already loads.

**Tech Stack:** Next.js 16 App Router (server components + server actions, `useRouter().refresh()`), Base UI 1.7 `Dialog` (controlled `open`; no `dismissible` prop — the starter ignores `onOpenChange(false)`), Zod, Vitest (`*.test.ts` pure, node env), Tailwind/shadcn primitives (`Button`, `Checkbox`, `Input`, `Label`, native `<select>` / radio-card idiom).

**Spec:** `docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md` §5 (+ §6 unit items, §7, §8 item 2, and the "Amendments (2026-08-28, at execution)" section — read the amendments, they record what slice 1 changed). Slice 1 is `docs/superpowers/plans/2026-08-28-channel-pages.md`, merged into this branch's base (PR #76).

## Global Constraints

- **Branch `feat/booking-page-starter`, stacked on `feat/channel-pages` (PR #76), in worktree `.claude/worktrees/channel-pages`.** Run everything from that directory. Do not `cd` to the main checkout or any other worktree. The PR for this slice targets `feat/channel-pages` (GitHub retargets to `main` when #76 merges).
- **No migrations, no RPC changes, no document-schema changes.** `bookingSection.title` is `text(60)`, `heroSection.cta` is `text(40).optional()` — the type copy must fit those.
- **Slice-1 facts this plan relies on:** `PageChannel` / `pageChannelMode` in `src/features/booking-page/channel.ts`; `getPageStates(orgId)` → `Partial<Record<PageChannel, PageDraftState>>` and `EMPTY_PAGE_STATE` in `queries.ts`; `BookingPageBuilder` already takes `channel`, `publicReachable`, `crossLink`; the route already computes `has = { services, spaces }`, `mode = pageChannelMode(channel)`, `pages`; `TemplateThumb` in `template-picker.tsx` renders thumbnails with `crossLink: null`; the canned stand-ins are `id === "preview-service"` (`toPreviewServices`) and `id === PREVIEW_OFFERING_ID` (`preview-catalog.ts`).
- **Rulings (spec):** the type choice lives on the first visit (ruling 1); the first item is an inline step with NO skip — the sidebar is the exit (ruling 2); types ARE the picker, template names leave the UI (ruling 4); the look checkbox defaults ON only when no page of the org is published on any channel (§5.3).
- **Copy:** every provider-facing string in `src/features/booking-page/copy.ts` (`STARTER`) or `business-types.ts`; never "rental", "rentals", "offering" in anything a provider reads (`FORBIDDEN_COPY` guard in Task 2 covers the new strings AND slice 1's vocab additions).
- **House test pattern:** pure `.test.ts` next to the module, vitest node env, **no component tests** — components stay thin, decisions live in pure modules.
- **Verify before claiming done:** `npm run verify` (lint + typecheck + unit); `npm run typecheck`, never bare `tsc`. Integration suite is untouched by this slice.
- **Bash guard:** this worktree refuses long compound commands (`a && b | c $(…)`) and silently rejects heredocs with `$`/template literals — plain separate commands; write files with the Write/Edit tools; confirm with `git status`.
- **Byte-for-byte on untouched lines** — typographic quotes (’ “ ”) and em-dashes in comments/copy must survive; never reflow a comment you are not editing.
- **Dev server for walks:** `npm run dev -- -p 3011` from this worktree, always `http://localhost:3011` (never 127.0.0.1); demo org `demo-studio` (`demo@rolloutos.local`, password in `scripts/seed.ts`); local throwaway orgs `task8-appts-only`, `task9-spaces-qa` exist. Local Supabase stack is running (`docker exec supabase_db_pipline-app psql -U postgres -d postgres -c "<sql>"` when `psql` is not on PATH).
- Commit after every task with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` as the trailer.

---

## File map

| File | Responsibility after this plan |
|---|---|
| `src/features/booking-page/business-types.ts` **(new)** | `BusinessType`, `BUSINESS_TYPES`, `typesFor(channel)`, `templateOf(type)`, `applyType(type, mode)` |
| `src/features/booking-page/templates.ts` | `templatesFor` removed (types are the picker); everything else unchanged |
| `src/features/booking-page/copy.ts` **(new)** | `STARTER` — every starter/picker string |
| `src/features/booking-page/studio/starter-state.ts` **(new)** | `isFreshPage`, `skinDefault`, `initialStarterState`, `starterReducer` |
| `src/features/rentals/schema.ts` | `OFFERING_DEFAULTS` (the dialog's defaults, in one place) |
| `src/features/rentals/components/offering-dialog.tsx` | reads `OFFERING_DEFAULTS` |
| `src/features/booking-page/studio/first-item-form.tsx` **(new)** | `FirstServiceForm`, `FirstSpaceForm` — thin forms over `createService` / `createOffering` |
| `src/features/booking-page/studio/starter-dialog.tsx` **(new, replaces `template-picker.tsx`)** | `StarterDialog` (`variant: "starter" \| "picker"`), `TypeThumb` |
| `src/features/booking-page/studio/booking-page-builder.tsx` | `starter` prop; renders the starter instance and hands the picker instance to `SectionsPanel` |
| `src/app/(dashboard)/booking-page/page.tsx` | computes `fresh`, `needsFirstItem`, `anyPublished` |

---

### Task 1: Business types — the table, the filter, `applyType`

**Files:**
- Create: `src/features/booking-page/business-types.ts`, `src/features/booking-page/business-types.test.ts`
- Modify: `src/features/booking-page/templates.ts` (delete `templatesFor`), `src/features/booking-page/templates.test.ts` (delete its `templatesFor` cases)

**Interfaces:**
- Consumes: `TEMPLATES`, `applyTemplate(t, mode)`, `type Template` (`templates.ts`); `PageChannel` (`channel.ts`); `OrgMode`, `PageDocument`, `SectionOf`.
- Produces: `type BusinessType = { id; channel: PageChannel; name; examples; templateId; copy: { bookingTitle: string; cta?: string } }`, `BUSINESS_TYPES: readonly BusinessType[]`, `typesFor(channel): BusinessType[]`, `templateOf(t): Template`, `applyType(t, mode): PageDocument`. Tasks 5 consumes all of these.

- [ ] **Step 1: Write the failing test**

`src/features/booking-page/business-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUSINESS_TYPES, applyType, templateOf, typesFor } from "./business-types";
import { TEMPLATES } from "./templates";
import { pageDocumentSchema } from "./schema";
import { pageChannelMode } from "./channel";
import { isSectionEmpty } from "./doc-ops";

describe("business types (spec 2026-08-28 §5.2)", () => {
  it("ships the nine types, each on a template that exists", () => {
    expect(BUSINESS_TYPES.map((t) => t.id)).toEqual([
      "solo", "salon", "clinic", "team", "online", "rooms", "stays", "other-appointments", "other-spaces",
    ]);
    for (const t of BUSINESS_TYPES) expect(TEMPLATES.some((x) => x.id === t.templateId), t.id).toBe(true);
    for (const t of BUSINESS_TYPES) expect(templateOf(t).id).toBe(t.templateId);
  });
  it("typesFor lists one channel and ends in that channel's Something else", () => {
    expect(typesFor("appointments").map((t) => t.id)).toEqual(["solo", "salon", "clinic", "team", "online", "other-appointments"]);
    expect(typesFor("spaces").map((t) => t.id)).toEqual(["rooms", "stays", "other-spaces"]);
    for (const ch of ["appointments", "spaces"] as const) {
      for (const t of typesFor(ch)) expect(t.channel).toBe(ch);
      expect(typesFor(ch).at(-1)!.name).toBe("Something else");
    }
  });
  it("applyType yields a valid document with the type's widget title and cover button, and no sample copy", () => {
    const ctx = { serviceCount: 1, staffCount: 1, offeringCount: 1 };
    for (const t of BUSINESS_TYPES) {
      const mode = pageChannelMode(t.channel);
      const doc = applyType(t, mode);
      expect(pageDocumentSchema.safeParse(doc).success, t.id).toBe(true);
      const booking = doc.sections.find((s) => s.type === "booking");
      expect(booking?.type === "booking" && booking.title, t.id).toBe(t.copy.bookingTitle);
      const hero = doc.sections.find((s) => s.type === "hero");
      if (hero?.type === "hero") {
        expect(t.copy.cta, `${t.id} has a hero but no cta`).toBeDefined();
        expect(hero.cta).toBe(t.copy.cta);
        expect(hero.headline).toBe("");
      }
      for (const s of doc.sections) {
        if (s.type !== "header" && s.type !== "booking" && s.type !== "services" && s.type !== "staff" && s.type !== "spaces") {
          expect(isSectionEmpty(s, ctx), `${t.id}/${s.type} carries sample copy`).toBe(true);
        }
      }
    }
  });
  it("a spaces type never yields a Services or Team section; an appointments type never a Spaces section", () => {
    for (const t of typesFor("spaces")) {
      const types = applyType(t, pageChannelMode("spaces")).sections.map((s) => s.type);
      expect(types).not.toContain("services");
      expect(types).not.toContain("staff");
    }
    for (const t of typesFor("appointments")) {
      expect(applyType(t, pageChannelMode("appointments")).sections.map((s) => s.type)).not.toContain("spaces");
    }
  });
  it("copy fits the document schema: widget title ≤ 60, cover button ≤ 40", () => {
    for (const t of BUSINESS_TYPES) {
      expect(t.copy.bookingTitle.length).toBeLessThanOrEqual(60);
      if (t.copy.cta) expect(t.copy.cta.length).toBeLessThanOrEqual(40);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/booking-page/business-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/features/booking-page/business-types.ts`**

```ts
import type { OrgMode } from "@/features/orgs/mode";
import type { PageChannel } from "./channel";
import type { PageDocument, Section } from "./schema";
import { TEMPLATES, applyTemplate, type Template } from "./templates";

/* The starter's cards (spec 2026-08-28 §5.2). A type is a business the
   owner recognises — "Salon & beauty", not "Studio template" — mapped 1:1
   onto an existing template plus the two words the page needs from it:
   the widget's title and the cover's Book button. Not persisted: apply is
   a one-shot mapping, and the document is what lives on. Order here is
   the card order; each channel ends in its "Something else". */
export type BusinessType = {
  id: string;
  channel: PageChannel;
  name: string;
  examples: string;
  templateId: Template["id"];
  copy: { bookingTitle: string; cta?: string };
};

export const BUSINESS_TYPES: readonly BusinessType[] = [
  { id: "solo", channel: "appointments", name: "Solo practitioner", examples: "coach, therapist, consultant", templateId: "profile", copy: { bookingTitle: "Book a time", cta: "Book now" } },
  { id: "salon", channel: "appointments", name: "Salon & beauty", examples: "hair, nails, brows, tattoo", templateId: "studio", copy: { bookingTitle: "Book a time", cta: "Book now" } },
  { id: "clinic", channel: "appointments", name: "Clinic & practice", examples: "physio, massage, dentist", templateId: "split", copy: { bookingTitle: "Book a session", cta: "Book a session" } },
  { id: "team", channel: "appointments", name: "Team & shop", examples: "barbershop, multi-chair salon", templateId: "team", copy: { bookingTitle: "Book a chair", cta: "Book now" } },
  { id: "online", channel: "appointments", name: "Online & lessons", examples: "tutoring, classes, remote", templateId: "minimal", copy: { bookingTitle: "Book a lesson", cta: "Book now" } },
  { id: "rooms", channel: "spaces", name: "Rooms, studios & gear", examples: "by the hour", templateId: "venue", copy: { bookingTitle: "Book a space", cta: "Book a space" } },
  { id: "stays", channel: "spaces", name: "Stays", examples: "nights & days", templateId: "venue", copy: { bookingTitle: "Book a stay", cta: "Book a stay" } },
  // Classic: a name and the widget — no cover, so no button.
  { id: "other-appointments", channel: "appointments", name: "Something else", examples: "a name and the widget", templateId: "classic", copy: { bookingTitle: "Book a time" } },
  { id: "other-spaces", channel: "spaces", name: "Something else", examples: "a name and the widget", templateId: "classic", copy: { bookingTitle: "Book a space" } },
];

/** This channel's cards, in card order. */
export function typesFor(channel: PageChannel): BusinessType[] {
  return BUSINESS_TYPES.filter((t) => t.channel === channel);
}

export function templateOf(t: BusinessType): Template {
  const template = TEMPLATES.find((x) => x.id === t.templateId);
  if (!template) throw new Error(`business type ${t.id} names a template that does not exist: ${t.templateId}`);
  return template;
}

function withCopy(section: Section, copy: BusinessType["copy"]): Section {
  if (section.type === "booking") return { ...section, title: copy.bookingTitle };
  if (section.type === "hero" && copy.cta !== undefined) return { ...section, cta: copy.cta };
  return section;
}

/** applyTemplate (sample copy stripped, fresh ids, fitted to the mode) with
    the type's own words on the widget and the cover. */
export function applyType(t: BusinessType, mode: OrgMode): PageDocument {
  const doc = applyTemplate(templateOf(t), mode);
  return { ...doc, sections: doc.sections.map((s) => withCopy(s, t.copy)) };
}
```

- [ ] **Step 4: Remove `templatesFor`**

In `src/features/booking-page/templates.ts` delete the `templatesFor` function and its doc comment (the last export in the file — "Picker order per mode: Venue leads for space owners…"). Nothing else in that file changes.

In `src/features/booking-page/templates.test.ts` remove `templatesFor` from the import line and delete every `it(...)` that calls it (search the file for `templatesFor`; the "Venue first / hidden for appointment-only" cases). Leave every other test byte-for-byte.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/booking-page/business-types.test.ts src/features/booking-page/templates.test.ts`
Expected: PASS.

Then `npm run typecheck` — it must report `templatesFor` as an unresolved import in `src/features/booking-page/studio/template-picker.tsx`. **That is expected here**: Task 5 deletes that file. To keep this task's commit green, change that one import line in `template-picker.tsx` to import `typesFor` and `templateOf` from `"../business-types"` and replace the picker's `templatesFor(mode).map((t) => (` with `typesFor(channel).map((bt) => { const t = templateOf(bt); return (` … `); })` — wait, the picker has no `channel` prop yet. Simpler and still honest: replace `templatesFor(mode)` with `TEMPLATES.filter((t) => t.id !== "venue" || mode.offersRentals)` (import `TEMPLATES` from `"../templates"`), which is exactly what `templatesFor` computed minus the Venue-first ordering. Task 5 deletes the file anyway.

Run: `npm run verify`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/features/booking-page/business-types.ts src/features/booking-page/business-types.test.ts src/features/booking-page/templates.ts src/features/booking-page/templates.test.ts src/features/booking-page/studio/template-picker.tsx
git commit -m "feat(booking-page): business types — the starter's cards, 1:1 onto the templates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Starter copy, guarded

**Files:**
- Create: `src/features/booking-page/copy.ts`, `src/features/booking-page/copy.test.ts`

**Interfaces:**
- Consumes: `FORBIDDEN_COPY` (`src/features/marketing/site.ts`), `BUSINESS_TYPES` (Task 1), `APPOINTMENTS`, `SPACES` (`vocab.ts`).
- Produces: `STARTER` — the exact strings Tasks 4–5 render.

- [ ] **Step 1: Write the failing test**

`src/features/booking-page/copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { STARTER } from "./copy";
import { BUSINESS_TYPES } from "./business-types";
import { FORBIDDEN_COPY } from "@/features/marketing/site";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return [String((value as (...args: string[]) => string)("hour", "PLN"))];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("starter copy (spec 2026-08-28 §1, §5)", () => {
  it("never says rental, rentals or offering — the starter, the type cards, and slice 1's vocab words", () => {
    const corpus = [
      ...strings(STARTER),
      ...BUSINESS_TYPES.flatMap((t) => [t.name, t.examples, t.copy.bookingTitle, t.copy.cta ?? ""]),
      APPOINTMENTS.page, SPACES.page, APPOINTMENTS.crossLink, SPACES.crossLink,
    ].join("\n").toLowerCase();
    for (const word of FORBIDDEN_COPY) expect(corpus, `copy mentions "${word}"`).not.toContain(word);
  });
  it("asks the one question the spec asks, and never offers a skip", () => {
    expect(STARTER.title).toBe("What kind of business is this?");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("skip");
    expect(strings(STARTER).join("\n").toLowerCase()).not.toContain("later");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/booking-page/copy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/features/booking-page/copy.ts`**

```ts
/* Every string the starter and the picker show (spec 2026-08-28 §5). Kept
   out of the components so copy.test.ts can guard it the way site.test.ts
   guards the funnel: no "rental", no "offering", no skip. The "Something
   else" cards and the per-type words live in business-types.ts. */
export const STARTER = {
  title: "What kind of business is this?",
  sub: "Pick the closest match — your page starts from a layout that fits, and you can change everything after.",
  look: "Also apply this look (theme, font, corners)",
  lookHint: "Unlike the sections, this changes the live page and website embed immediately.",
  firstService: {
    title: "Add your first service",
    sub: "It goes straight onto your page. Add more on Services whenever you like.",
    name: "Name",
    namePlaceholder: "e.g. Haircut",
    duration: "Duration",
    price: "Price (optional)",
    pricePlaceholder: (currency: string) => `e.g. 120 ${currency}`,
    submit: "Add service",
  },
  firstSpace: {
    title: "Add your first space",
    sub: "It goes straight onto your page, with one unit. Add more on Spaces whenever you like.",
    name: "Name",
    namePlaceholder: "e.g. Studio A",
    bookedBy: "Booked by",
    hours: "the hour",
    nights: "the night",
    days: "the day",
    price: (per: string, currency: string) => `Price per ${per} (${currency}, optional)`,
    submit: "Add space",
  },
  back: "Back",
  picker: {
    trigger: "Start from a template",
    title: "Start from a template",
    sub: "Pick the closest match, then make it yours. Your published page stays until you publish.",
  },
  replace: {
    title: "Replace your current draft?",
    description: "Your published page stays until you publish.",
    confirm: "Replace",
  },
  applied: "Template applied",
} as const;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/booking-page/copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/copy.ts src/features/booking-page/copy.test.ts
git commit -m "feat(booking-page): starter copy, guarded like the funnel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Starter state — fresh rule, look default, the step reducer

**Files:**
- Create: `src/features/booking-page/studio/starter-state.ts`, `src/features/booking-page/studio/starter-state.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_PAGE` (`../defaults`), `deepEqual` (`../doc-ops`), `PageDocument`, `BusinessType` (Task 1).
- Produces: `isFreshPage({ draft, published }): boolean`, `skinDefault(anyPublished): boolean`, `type StarterStep = "type" | "firstItem" | "done"`, `type StarterState = { step; type: BusinessType | null; applyLook: boolean }`, `type StarterAction`, `initialStarterState({ applyLook }): StarterState`, `starterReducer(state, action): StarterState`. Task 5 consumes all.

- [ ] **Step 1: Write the failing test**

`src/features/booking-page/studio/starter-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialStarterState, isFreshPage, skinDefault, starterReducer } from "./starter-state";
import { DEFAULT_PAGE, newSection } from "../defaults";
import { BUSINESS_TYPES } from "../business-types";

const salon = BUSINESS_TYPES.find((t) => t.id === "salon")!;
const edited = { ...DEFAULT_PAGE, sections: [DEFAULT_PAGE.sections[0]!, newSection("about", "about001"), DEFAULT_PAGE.sections[1]!] };

describe("isFreshPage (spec §5.1)", () => {
  it("fresh = never published and the untouched default composition", () => {
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: null })).toBe(true);
    expect(isFreshPage({ draft: edited, published: null })).toBe(false);
    expect(isFreshPage({ draft: DEFAULT_PAGE, published: DEFAULT_PAGE })).toBe(false);
    expect(isFreshPage({ draft: edited, published: edited })).toBe(false);
  });
});

describe("skinDefault (spec §5.3)", () => {
  it("on when nothing is published anywhere in the org, off otherwise", () => {
    expect(skinDefault(false)).toBe(true);
    expect(skinDefault(true)).toBe(false);
  });
});

describe("starterReducer (spec §5.3)", () => {
  const start = initialStarterState({ applyLook: true });
  it("starts on the type step with the given look default", () => {
    expect(start).toEqual({ step: "type", type: null, applyLook: true });
  });
  it("choosing a type goes to firstItem when the channel has nothing bookable, else straight to done", () => {
    expect(starterReducer(start, { kind: "choose", type: salon, needsFirstItem: true })).toEqual({ ...start, type: salon, step: "firstItem" });
    expect(starterReducer(start, { kind: "choose", type: salon, needsFirstItem: false })).toEqual({ ...start, type: salon, step: "done" });
  });
  it("created moves firstItem to done; back returns to type keeping the choice; both are no-ops elsewhere", () => {
    const waiting = starterReducer(start, { kind: "choose", type: salon, needsFirstItem: true });
    expect(starterReducer(waiting, { kind: "created" })).toEqual({ ...waiting, step: "done" });
    expect(starterReducer(waiting, { kind: "back" })).toEqual({ ...waiting, step: "type" });
    expect(starterReducer(start, { kind: "created" })).toEqual(start);
    expect(starterReducer(start, { kind: "back" })).toEqual(start);
  });
  it("toggling the look never changes the step", () => {
    expect(starterReducer(start, { kind: "toggleLook", value: false })).toEqual({ ...start, applyLook: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/booking-page/studio/starter-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/features/booking-page/studio/starter-state.ts`**

```ts
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";
import type { BusinessType } from "../business-types";

/* The starter's decisions, kept pure so they are testable without React
   (spec 2026-08-28 §5.1, §5.3). StarterDialog renders this; it decides
   nothing on its own. */

/** A page nobody has touched: never published, still the default composition. */
export function isFreshPage(page: { draft: PageDocument; published: PageDocument | null }): boolean {
  return page.published === null && deepEqual(page.draft, DEFAULT_PAGE);
}

/** "Also apply this look" default: on only while the org-wide look is
    unclaimed — no page of the org is published on any channel. Applying
    the skin saves to the live widget theme, which the other page and the
    embed share. */
export function skinDefault(anyPublished: boolean): boolean {
  return !anyPublished;
}

export type StarterStep = "type" | "firstItem" | "done";
export type StarterState = { step: StarterStep; type: BusinessType | null; applyLook: boolean };
export type StarterAction =
  | { kind: "choose"; type: BusinessType; needsFirstItem: boolean }
  | { kind: "created" }
  | { kind: "back" }
  | { kind: "toggleLook"; value: boolean };

export function initialStarterState(opts: { applyLook: boolean }): StarterState {
  return { step: "type", type: null, applyLook: opts.applyLook };
}

/** type → (firstItem when the channel has nothing bookable) → done. No
    skip (ruling 2): the only way past firstItem is `created`. */
export function starterReducer(state: StarterState, action: StarterAction): StarterState {
  switch (action.kind) {
    case "choose":
      return { ...state, type: action.type, step: action.needsFirstItem ? "firstItem" : "done" };
    case "created":
      return state.step === "firstItem" ? { ...state, step: "done" } : state;
    case "back":
      return state.step === "firstItem" ? { ...state, step: "type" } : state;
    case "toggleLook":
      return { ...state, applyLook: action.value };
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/booking-page/studio/starter-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/studio/starter-state.ts src/features/booking-page/studio/starter-state.test.ts
git commit -m "feat(booking-page): starter state — fresh rule, look default, step reducer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `OFFERING_DEFAULTS` and the two first-item forms

**Files:**
- Modify: `src/features/rentals/schema.ts`, `src/features/rentals/schema.test.ts`, `src/features/rentals/components/offering-dialog.tsx`
- Create: `src/features/booking-page/studio/first-item-form.tsx`

**Interfaces:**
- Consumes: `createService` (`@/features/scheduling/actions`), `createOffering` (`@/features/rentals/actions`), `STARTER` (Task 2), `RangeMode` (`@/features/rentals/range`), `Button`, `Input`, `Label`.
- Produces: `OFFERING_DEFAULTS`; `FirstServiceForm({ currency, onCreated, onBack })`, `FirstSpaceForm({ currency, onCreated, onBack })` — both call `onCreated()` only after the action returned `ok: true`. Task 5 consumes the forms.

- [ ] **Step 1: Write the failing schema test**

Append to `describe("offeringInput", …)` in `src/features/rentals/schema.test.ts` (import `OFFERING_DEFAULTS` from `./schema` in the existing import list):

```ts
  it("accepts the starter's minimal payloads built from OFFERING_DEFAULTS (spec §5.3)", () => {
    const hours = offeringInput.safeParse({ name: "Room A", rangeMode: "hours", ...OFFERING_DEFAULTS.hours, priceCents: 5000 });
    expect(hours.success).toBe(true);
    if (hours.success) expect(hours.data).toMatchObject({ slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240, turnoverMin: 0, minNoticeMin: 0, bookingWindowDays: 180 });
    const nights = offeringInput.safeParse({ name: "Cabin", rangeMode: "nights", ...OFFERING_DEFAULTS.stay, priceCents: null });
    expect(nights.success).toBe(true);
    if (nights.success) expect(nights.data).toMatchObject({ startTime: "15:00", endTime: "11:00", minStay: 1, maxStay: null });
    expect(offeringInput.safeParse({ name: "Cabin", rangeMode: "days", ...OFFERING_DEFAULTS.stay, priceCents: null }).success).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/rentals/schema.test.ts`
Expected: FAIL — `OFFERING_DEFAULTS` is not exported.

- [ ] **Step 3: The constant, and the dialog reads it**

In `src/features/rentals/schema.ts`, right after `export const DEPOSIT_TYPES = […]`, add:

```ts
/** The space dialog's defaults, in one place so the booking-page starter's
    minimal form builds the same space the dialog would (spec 2026-08-28
    §5.3). `hours` fills the hoursFields branch, `stay` the rangeFields one;
    everything else is a schema default. */
export const OFFERING_DEFAULTS = {
  hours: { slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 },
  stay: { startTime: "15:00", endTime: "11:00", minStay: 1 },
} as const;
```

In `src/features/rentals/components/offering-dialog.tsx`, import `OFFERING_DEFAULTS` from `"../schema"` (the file already imports from there or from `@/features/rentals/schema` — match its existing import style) and replace the literal defaults with the constant, each on its own line, nothing else on those lines changing:
- `offering?.slotIncrementMin ?? 30` → `offering?.slotIncrementMin ?? OFFERING_DEFAULTS.hours.slotIncrementMin`
- `defaultValue={offering?.minDurationMin ?? 60}` → `defaultValue={offering?.minDurationMin ?? OFFERING_DEFAULTS.hours.minDurationMin}`
- `defaultValue={offering?.maxDurationMin ?? 240}` → `… ?? OFFERING_DEFAULTS.hours.maxDurationMin}`
- `defaultValue={offering?.startTime ?? "15:00"}` → `… ?? OFFERING_DEFAULTS.stay.startTime}`
- `defaultValue={offering?.endTime ?? "11:00"}` → `… ?? OFFERING_DEFAULTS.stay.endTime}`
- `defaultValue={offering?.minStay ?? 1}` → `… ?? OFFERING_DEFAULTS.stay.minStay}`

Run: `npx vitest run src/features/rentals/schema.test.ts` → PASS.

- [ ] **Step 4: Create `src/features/booking-page/studio/first-item-form.tsx`**

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { createService } from "@/features/scheduling/actions";
import { createOffering } from "@/features/rentals/actions";
import { OFFERING_DEFAULTS } from "@/features/rentals/schema";
import type { RangeMode } from "@/features/rentals/range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { STARTER } from "../copy";

/* The starter's second step (spec 2026-08-28 §5.3): the fewest fields that
   make one bookable thing, through the same actions the Services and
   Spaces pages use — zod fills every other default. `onCreated` fires only
   after the action said ok; the caller refreshes the route so the preview
   carries the real item. No skip (ruling 2): Back is the only other way
   out, and it leads to the type step, not the builder. */

// The native-<select> idiom shared by the booking forms (offering-dialog.tsx).
const selectClass = "border-input h-9 rounded-md border bg-transparent px-3 text-sm";
const DURATIONS = [15, 30, 45, 60, 90, 120] as const;

function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="text-destructive text-sm">{message}</p> : null;
}

export function FirstServiceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack: () => void }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const nameId = React.useId();
  const durationId = React.useId();
  const priceId = React.useId();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const priceLabel = String(fd.get("priceLabel") ?? "").trim();
    const payload = { name, durationMin: Number(fd.get("durationMin")), priceLabel: priceLabel === "" ? undefined : priceLabel };
    setError(null);
    startTransition(async () => {
      const result = await createService(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{STARTER.firstService.name}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={STARTER.firstService.namePlaceholder} autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={durationId}>{STARTER.firstService.duration}</Label>
          <select id={durationId} name="durationMin" defaultValue={60} className={selectClass}>
            {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={priceId}>{STARTER.firstService.price}</Label>
          <Input id={priceId} name="priceLabel" maxLength={100} placeholder={STARTER.firstService.pricePlaceholder(currency)} />
        </div>
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{STARTER.back}</Button>
        <Button type="submit" size="sm" disabled={pending}>{STARTER.firstService.submit}</Button>
      </div>
    </form>
  );
}

const MODES: ReadonlyArray<{ value: RangeMode; label: string; per: string }> = [
  { value: "hours", label: STARTER.firstSpace.hours, per: "hour" },
  { value: "nights", label: STARTER.firstSpace.nights, per: "night" },
  { value: "days", label: STARTER.firstSpace.days, per: "day" },
];

export function FirstSpaceForm({ currency, onCreated, onBack }: { currency: string; onCreated: () => void; onBack: () => void }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  // Controlled: the price label and the payload branch both follow it.
  const [rangeMode, setRangeMode] = React.useState<RangeMode>("hours");
  const nameId = React.useId();
  const priceId = React.useId();
  const per = MODES.find((m) => m.value === rangeMode)!.per;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (name === "") return;
    const price = String(fd.get("price") ?? "").trim();
    const priceCents = price === "" ? null : Math.round(Number(price) * 100);
    // The zod branches are `.strict()` (schema.ts): only that mode's own
    // fields go in; every other field is a schema default.
    const payload =
      rangeMode === "hours"
        ? { name, rangeMode: "hours" as const, ...OFFERING_DEFAULTS.hours, priceCents }
        : { name, rangeMode, ...OFFERING_DEFAULTS.stay, priceCents };
    setError(null);
    startTransition(async () => {
      const result = await createOffering(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A notice means the space saved but its first unit or hours did not
      // (plan cap) — the page still needs it, so say so and carry on.
      if (result.notice) toast.warning(result.notice);
      onCreated();
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>{STARTER.firstSpace.name}</Label>
        <Input id={nameId} name="name" required maxLength={200} placeholder={STARTER.firstSpace.namePlaceholder} autoFocus />
      </div>
      {/* Native radios in label-cards (the onboarding picker's idiom). */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{STARTER.firstSpace.bookedBy}</legend>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const selected = rangeMode === m.value;
            return (
              <label
                key={m.value}
                className={cn(
                  "flex cursor-pointer items-center justify-center rounded-md border p-2 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                  selected ? "border-foreground/40 bg-accent font-medium" : "hover:bg-accent/60",
                )}
              >
                <input type="radio" name="rangeMode" value={m.value} className="sr-only" checked={selected} onChange={() => setRangeMode(m.value)} />
                {m.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={priceId}>{STARTER.firstSpace.price(per, currency)}</Label>
        <Input id={priceId} name="price" type="number" min={0} step="0.01" inputMode="decimal" />
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack} disabled={pending}>{STARTER.back}</Button>
        <Button type="submit" size="sm" disabled={pending}>{STARTER.firstSpace.submit}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: green (the new component compiles; nothing renders it yet — Task 5 does).

- [ ] **Step 6: Commit**

```bash
git add src/features/rentals/schema.ts src/features/rentals/schema.test.ts src/features/rentals/components/offering-dialog.tsx src/features/booking-page/studio/first-item-form.tsx
git commit -m "feat(booking-page): first-service and first-space forms over the existing actions; OFFERING_DEFAULTS in one place

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `StarterDialog` replaces the template picker; the route and builder wire it

**Files:**
- Create: `src/features/booking-page/studio/starter-dialog.tsx`
- Delete: `src/features/booking-page/studio/template-picker.tsx`
- Modify: `src/features/booking-page/studio/booking-page-builder.tsx`, `src/app/(dashboard)/booking-page/page.tsx`, `src/features/booking-page/studio/sections-panel.tsx` (one comment)

**Interfaces:**
- Consumes: Tasks 1–4; `templatePreview`, `type Template`, `type TemplateSkin` (`../templates`); `PageRenderer`, `pageContainerClass`; `WidgetTheme`; `ConfirmDialog`; `Dialog*` primitives; `Checkbox`; `useRouter`.
- Produces: `StarterDialog` props `{ variant: "starter" | "picker"; channel: PageChannel; doc: PageDocument; ctx: RenderContext; mode: OrgMode; needsFirstItem: boolean; applyLookDefault: boolean; currency: string; onApply: (next: PageDocument, skin: TemplateSkin | null) => void }`; `BookingPageBuilder` prop `starter: { fresh: boolean; needsFirstItem: boolean; anyPublished: boolean }`.

- [ ] **Step 1: Create `src/features/booking-page/studio/starter-dialog.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { WidgetTheme } from "@/components/widget-theme";
import type { OrgMode } from "@/features/orgs/mode";
import type { WidgetThemeConfig } from "@/lib/widget-theme";
import { cn } from "@/lib/utils";
import { DEFAULT_PAGE } from "../defaults";
import { deepEqual } from "../doc-ops";
import type { PageDocument } from "../schema";
import type { PageChannel } from "../channel";
import type { RenderContext } from "../render/context";
import { PageRenderer, pageContainerClass } from "../render/page-renderer";
import { templatePreview, type Template, type TemplateSkin } from "../templates";
import { applyType, templateOf, typesFor, type BusinessType } from "../business-types";
import { STARTER } from "../copy";
import { initialStarterState, starterReducer, type StarterAction, type StarterState } from "./starter-state";
import { ConfirmDialog } from "./confirm-dialog";
import { FirstServiceForm, FirstSpaceForm } from "./first-item-form";

/* Live thumbnails: the real PageRenderer, scaled, with the org's own
   name/logo/services and the template's sample copy. `inert` keeps the
   widget inside from taking focus or clicks. The skin layers over the org's
   theme exactly as applySkin does — colour overrides included — so the
   thumbnail is what you'd actually get. A thumbnail is a template, not a
   page: no cross-link. */
function TypeThumb({ template, ctx, mode }: { template: Template; ctx: RenderContext; mode: OrgMode }) {
  const base: WidgetThemeConfig = template.skin ? { ...ctx.theme, ...template.skin } : ctx.theme;
  const scheme = base.theme === "auto" ? "light" : base.theme;
  const theme: WidgetThemeConfig = { ...base, theme: scheme };
  return (
    <div className="bg-muted relative aspect-[3/4] w-full overflow-hidden rounded-md border" aria-hidden inert>
      <div className={cn("pointer-events-none absolute top-0 left-0 w-[900px] origin-top-left scale-[0.3] p-8", scheme, "bg-background text-foreground")}>
        <WidgetTheme config={theme} accentColor={ctx.branding.accentColor} transparent>
          <div className={cn("mx-auto", pageContainerClass(template.layout))}>
            <PageRenderer doc={templatePreview(template, mode)} ctx={{ ...ctx, theme, mode: "preview", crossLink: null }} />
          </div>
        </WidgetTheme>
      </div>
    </div>
  );
}

/* The starter (spec 2026-08-28 §5) and, in `picker` mode, the "Start from a
   template" dialog it replaces — one component, one reducer
   (starter-state.ts). Starter: opens itself on a fresh page and cannot be
   dismissed (Base UI 1.7 has no `dismissible`, so `open` is controlled and
   every `onOpenChange(false)` is ignored; the admin sidebar is the way
   out — ruling 2). Picker: a trigger button, dismissable, and the old
   "replace your draft?" confirm when the draft is not the default. */
export function StarterDialog({
  variant, channel, doc, ctx, mode, needsFirstItem, applyLookDefault, currency, onApply,
}: {
  variant: "starter" | "picker";
  channel: PageChannel;
  doc: PageDocument;
  ctx: RenderContext;
  mode: OrgMode;
  needsFirstItem: boolean;
  applyLookDefault: boolean;
  currency: string;
  onApply: (next: PageDocument, skin: TemplateSkin | null) => void;
}) {
  const router = useRouter();
  const starter = variant === "starter";
  const [open, setOpen] = React.useState(starter);
  const [state, setState] = React.useState<StarterState>(() => initialStarterState({ applyLook: applyLookDefault }));
  // Picker only: the type chosen while the draft still needs confirming.
  const [pending, setPending] = React.useState<BusinessType | null>(null);
  const dirty = !deepEqual(doc, DEFAULT_PAGE);

  const reset = () => setState(initialStarterState({ applyLook: applyLookDefault }));

  const finish = (next: StarterState) => {
    if (!next.type) return;
    const template = templateOf(next.type);
    onApply(applyType(next.type, mode), next.applyLook && template.skin ? template.skin : null);
    reset();
    setOpen(false);
  };
  const dispatch = (action: StarterAction) => {
    const next = starterReducer(state, action);
    setState(next);
    if (next.step === "done") finish(next);
  };
  const choose = (t: BusinessType) => {
    if (!starter && dirty) setPending(t);
    else dispatch({ kind: "choose", type: t, needsFirstItem });
  };
  const onCreated = () => {
    // The route re-renders with the real service/space in the preview
    // catalogue; the draft hook is seeded once, so this never resets the draft.
    router.refresh();
    dispatch({ kind: "created" });
  };
  const onOpenChange = (next: boolean) => {
    if (starter && !next) return;
    setOpen(next);
    if (!next) reset();
  };

  const types = typesFor(channel);
  const title = starter ? STARTER.title : STARTER.picker.title;
  const sub = starter ? STARTER.sub : STARTER.picker.sub;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {starter ? null : <DialogTrigger render={<Button variant="outline" size="sm">{STARTER.picker.trigger}</Button>} />}
        <DialogContent className="sm:max-w-3xl" showCloseButton={!starter}>
          {state.step === "firstItem" && state.type ? (
            <>
              <DialogHeader>
                <DialogTitle>{channel === "appointments" ? STARTER.firstService.title : STARTER.firstSpace.title}</DialogTitle>
                <DialogDescription>{channel === "appointments" ? STARTER.firstService.sub : STARTER.firstSpace.sub}</DialogDescription>
              </DialogHeader>
              {channel === "appointments" ? (
                <FirstServiceForm currency={currency} onCreated={onCreated} onBack={() => dispatch({ kind: "back" })} />
              ) : (
                <FirstSpaceForm currency={currency} onCreated={onCreated} onBack={() => dispatch({ kind: "back" })} />
              )}
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{sub}</DialogDescription>
              </DialogHeader>
              {/* Off unless the org-wide look is unclaimed (skinDefault): unlike
                  the sections, the look saves straight to the live page and embed. */}
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={state.applyLook} onCheckedChange={(c) => dispatch({ kind: "toggleLook", value: c === true })} />
                <span>
                  {STARTER.look}
                  <span className="text-muted-foreground block text-xs">{STARTER.lookHint}</span>
                </span>
              </label>
              <ul className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
                {types.map((t) => (
                  <li key={t.id}>
                    {/* Click anywhere on the card selects; the name/examples is a
                        real <button>, so Enter/Space come for free and bubble to the
                        wrapper as a click. The thumbnail stays an inert sibling — never
                        a descendant of an interactive role. */}
                    <div
                      onClick={() => choose(t)}
                      className="hover:border-primary has-[button:focus-visible]:ring-ring/50 flex w-full cursor-pointer flex-col gap-2 rounded-lg border p-2 has-[button:focus-visible]:ring-2"
                    >
                      <TypeThumb template={templateOf(t)} ctx={ctx} mode={mode} />
                      <button type="button" className="flex flex-col items-start gap-0.5 text-left outline-none" aria-label={`${t.name} — ${t.examples}`}>
                        <span className="text-sm font-medium">{t.name}</span>
                        <span className="text-muted-foreground text-xs">{t.examples}</span>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={pending !== null}
        title={STARTER.replace.title}
        description={STARTER.replace.description}
        confirmLabel={STARTER.replace.confirm}
        onConfirm={() => {
          const t = pending;
          setPending(null);
          if (t) dispatch({ kind: "choose", type: t, needsFirstItem });
        }}
        onClose={() => setPending(null)}
      />
    </>
  );
}
```

- [ ] **Step 2: Delete the old picker and wire the builder**

Delete `src/features/booking-page/studio/template-picker.tsx` (`git rm`).

In `src/features/booking-page/studio/booking-page-builder.tsx`:
- Replace `import { TemplatePicker } from "./template-picker";` with `import { StarterDialog } from "./starter-dialog";` and add `import { skinDefault } from "./starter-state";` and `import { STARTER } from "../copy";`.
- Add to the props type, after `crossLink: RenderContext["crossLink"];`:
  ```ts
  /** The starter (spec §5): opens on a fresh page; `needsFirstItem` when the
      page's channel has nothing bookable yet; `anyPublished` decides the
      look checkbox's default. */
  starter: { fresh: boolean; needsFirstItem: boolean; anyPublished: boolean };
  ```
  and `starter` to the destructuring list.
- In `onApplyTemplate`, change `toast.success("Template applied");` to `toast.success(STARTER.applied);`.
- Replace the `templatePicker={<TemplatePicker … />}` prop with:
  ```tsx
            templatePicker={
              <StarterDialog
                variant="picker"
                channel={channel}
                doc={draft.doc}
                ctx={ctx}
                mode={mode}
                needsFirstItem={starter.needsFirstItem}
                applyLookDefault={false}
                currency={scheduling.currency}
                onApply={onApplyTemplate}
              />
            }
  ```
- Right after the opening `<div className="grid gap-8 lg:grid-cols-…">` line, before the left column, render the starter instance:
  ```tsx
      {starter.fresh ? (
        <StarterDialog
          variant="starter"
          channel={channel}
          doc={draft.doc}
          ctx={ctx}
          mode={mode}
          needsFirstItem={starter.needsFirstItem}
          applyLookDefault={skinDefault(starter.anyPublished)}
          currency={scheduling.currency}
          onApply={onApplyTemplate}
        />
      ) : null}
  ```
  (A Dialog renders through a portal, so its position in the tree does not affect layout.)

In `src/features/booking-page/studio/sections-panel.tsx`, change the prop comment `/** "Start from a template" (Task 16); null until then. */` to `/** The picker-mode StarterDialog (spec 2026-08-28 §5.4). */`. Nothing else in that file changes.

- [ ] **Step 3: The route computes the starter's facts**

In `src/app/(dashboard)/booking-page/page.tsx`:
- Add `import { isFreshPage } from "@/features/booking-page/studio/starter-state";`.
- After `const page = pages[channel] ?? EMPTY_PAGE_STATE;` add:
  ```ts
  // The starter (spec §5): a page nobody touched opens it; the channel with
  // nothing bookable makes it ask for the first service/space; the look
  // checkbox defaults on only while nothing is published anywhere.
  const starter = {
    fresh: isFreshPage(page),
    needsFirstItem: channel === "appointments" ? !has.services : !has.spaces,
    anyPublished: Object.values(pages).some((p) => p.published !== null),
  };
  ```
- Pass `starter={starter}` to `<BookingPageBuilder>` (next to `publicReachable`).

- [ ] **Step 4: Verify and walk it**

Run: `npm run verify`
Expected: green; lint must not report `template-picker.tsx` or an unused import.

Dev server (`npm run dev -- -p 3011`, `http://localhost:3011`, Playwright MCP for the signed-in parts):
1. **Fresh appointments page, no service.** Sign up a throwaway org at `/signup` (confirm via Mailpit `http://localhost:54354`, rewrite the link's port to 3011), pick **Appointments** at `/onboarding`, then open `/booking-page`: the starter is open with "What kind of business is this?", six cards (five types + Something else), thumbnails rendered, look checkbox ON. Press Esc and click the backdrop → it stays open. Click *Salon & beauty* → "Add your first service" form. Click Back → the cards again (choice kept is not visible — fine). Click *Salon & beauty* again, type `Balayage`, duration 120, price `450 zł`, Add service → the dialog closes, toast "Template applied", the preview shows the Studio layout with **Balayage** in the Services cards and the widget, the sections list shows the Studio sections, autosave says Saved. Reload → no starter; "Start from a template" opens the picker (cards, checkbox OFF, close button present); pick *Solo practitioner* → "Replace your current draft?" → Replace → Profile layout applied.
2. **Both-channel org, spaces page.** On `demo-studio` (which has spaces) the spaces page is not fresh (Task 8 published it) — instead use the builder's picker on `/booking-page?page=spaces`: only *Rooms, studios & gear*, *Stays*, *Something else*; pick *Stays* → Replace → Venue layout, widget title "Book a stay", cover button "Book a stay". Do not publish.
3. **Spaces page needing its first space.** On `task8-appts-only` (appointments-only) enable Spaces in Settings › Business (if the *Spaces page* switch still does not appear on `/booking-page`, the org's `rentals` kill-switch flag is off — set it with `docker exec supabase_db_pipline-app psql -U postgres -d postgres -c "insert into org_feature_flags (org_id, flag, enabled) select id, 'rentals', true from orgs where handle = 'task8-appts-only' on conflict (org_id, flag) do update set enabled = true"`; if that table's columns differ, `\d org_feature_flags` first and adapt), open `/booking-page?page=spaces` → the starter opens (fresh page, no spaces) → *Rooms, studios & gear* → "Add your first space": name `Room A`, booked by the hour, price 50 → Add space → toast may warn about the plan cap on Free (a notice, not a failure) → dialog closes, Venue applied, the preview lists **Room A**. Turn Spaces back off afterwards.
4. `npm run verify` again after the walk (nothing should have changed).

Record every observation in the report.

- [ ] **Step 5: Commit**

```bash
git add src/features/booking-page/studio src/app/(dashboard)/booking-page/page.tsx
git commit -m "feat(booking-page): the starter — business-type cards, inline first service/space, template applied with real data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Whole-branch verification, spec amendments, PR

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md` (amendments)

- [ ] **Step 1: Full verification**

Run: `npm run verify` and `npm run test:integration`.
Expected: both green (integration is untouched by this slice; it proves nothing regressed under it).

- [ ] **Step 2: Amend the spec**

Append to the existing `## Amendments (2026-08-28, at execution)` list (byte-for-byte on the existing bullets):

```markdown
- Slice 2: `OFFERING_DEFAULTS` follows the space dialog — hours increment **30** (not 60), 60–240 min; stays 15:00 → 11:00, min stay 1 — so the starter builds the same space the dialog would.
- Slice 2: `templatesFor` is gone; `typesFor(channel)` (business-types.ts) is the card order. The starter and the picker are one component, `StarterDialog`, driven by `starterReducer`; "Back" from the first-item step returns to the cards (it is not a skip — the builder still only opens once something is bookable).
- Slice 2: `router.refresh()` after the first item lands re-renders the route with the real service/space in the preview catalogue; `usePageDraft` seeds from its props once, so the draft is untouched.
- Slice 2, §5.1 corrected: the starter is a modal (focus trapped, outside pointer disabled), so "the admin sidebar stays usable" was never true at runtime. The exit is explicit and inside the dialog — **"Leave for now"** (`STARTER.leave`) returns to `/bookings` from either step. It is not a skip: the builder still opens only once the channel has something bookable (ruling 2). Focus returns to the sections panel when the starter closes (`finalFocus`).
```

- [ ] **Step 3: Commit, push, open the PR against `feat/channel-pages`**

```bash
git add docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md
git commit -m "docs(specs): booking-page starter — execution amendments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin feat/booking-page-starter
```

Then `gh pr create --base feat/channel-pages --head feat/booking-page-starter --title "feat(booking-page): the starter — what kind of business, first service inline, template applied with real data" --body-file <a file with the body below>`:

```
Slice 2 of docs/superpowers/specs/2026-08-28-channel-pages-and-starter-design.md (§5), stacked on #76.

- first visit to a fresh page opens "What kind of business is this?" — nine business types 1:1 onto the existing templates (types are the picker; template names leave the UI)
- a channel with nothing bookable gets an inline "Add your first service / space" step (existing createService / createOffering; no skip)
- the template is applied with the type's copy (widget title, cover button), the look checkbox defaults on only while nothing is published org-wide
- "Start from a template" is the same dialog in picker mode

Verify: <paste>. Integration: <paste>. Walk: <the four items from Task 5 step 4>.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Memory** (outside the repo): `channel-pages-starter-notes.md` — slice 2 BUILT, PR number, deferred items; `MEMORY.md` index line.

---

## Self-review

**Spec coverage.** §5.1 (fresh rule, non-dismissable) → Tasks 3, 5. §5.2 (type table, `typesFor`, `applyType`, thumbnails) → Tasks 1, 5. §5.3 (steps, forms, defaults, refresh, look default) → Tasks 3, 4, 5. §5.4 (picker mode, replace confirm, `templatesFor` gone) → Tasks 1, 5. §5.5 (end-to-end) → Task 5 walk. §6 unit items: business-types (T1), starter-state (T3), copy + FORBIDDEN_COPY incl. slice-1 vocab (T2), `OFFERING_DEFAULTS` payloads (T4). §8 item 2 → this plan. §7 out-of-scope respected: no skip, no persisted type, no per-page skins.

**Placeholder scan.** Every code step carries its code; the only "<paste>" tokens are in the PR body, filled at Task 6.

**Type consistency.** `BusinessType.copy.cta` optional (T1) ↔ `applyType`'s `withCopy` ↔ T1 test's `if (hero) expect(cta).toBeDefined()`; `StarterAction`/`StarterState` (T3) ↔ `dispatch` in T5; `FirstServiceForm`/`FirstSpaceForm` props `{ currency, onCreated, onBack }` (T4) ↔ T5; `StarterDialog` props (T5) ↔ builder's two instances; builder `starter` prop ↔ route's `starter` object; `skinDefault(anyPublished)` (T3) ↔ builder; `OFFERING_DEFAULTS.hours`/`.stay` (T4) ↔ form payloads ↔ schema test.
