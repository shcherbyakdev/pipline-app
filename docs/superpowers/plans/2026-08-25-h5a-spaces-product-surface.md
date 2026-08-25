# H5a — Spaces on the Product Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A space owner can present their rooms on the hosted page like a salon presents services — a `spaces` builder section with photos and prices whose cards open that space's booking flow, templates that fit the org's mode (plus a photo-led "Venue" template), and the channel called "Spaces" everywhere a person reads it.

**Architecture:** Pure-first, house pattern. Every decision lives in a pure module with a `.test.ts` (vocab strings, `stayHint`, the `spaces` zod section, `fitToMode` template application, `addableTypes`, the page-state request reducer); React files only consume them. Photos are stored in the page document keyed by offering id (no migration); the section reads live offerings from `RenderContext.offerings`; a card click routes through `PageStateProvider` → `BookingWidget.requestedOffering`, the exact analog of the existing services hand-off.

**Tech Stack:** Next.js (App Router, server components), React 19, zod 4, Vitest (node env, `src/**/*.test.ts` only — no component tests), Tailwind, Base UI, Supabase storage (page-images bucket, unchanged).

**Spec:** `docs/superpowers/specs/2026-08-25-h5a-spaces-product-surface-design.md`

## Global Constraints

- **Branch:** `feat/h5a-spaces`, cut from `main` **after PR #57 and PR #58 are merged** (this plan edits `booking-page-builder.tsx`'s `previewOfferings` prop and `preview-catalog.ts`, both from #58). If they are not merged yet, branch from `fix/previews-render-rentals` and rebase later.
- **No migration.** H4 keeps 0059. Nothing under `supabase/` changes.
- **Code identifiers never change:** `rental_*`, `offersRentals`, `/rentals`, `PublicOffering`, `listOfferings`. Only strings people read say "Spaces".
- **`FORBIDDEN_COPY` (`src/features/marketing/site.ts`) is not touched** — H5b's. `site.test.ts` scans landing copy for those words; the onboarding blurbs below contain none of them.
- **Section ids** must match `/^[a-z0-9]{6,12}$/` (`schema.ts`). Derived thumbnail ids use `("sp" + id).slice(0, 12)`.
- **Preview never fetches.** In preview mode (`ctx.mode === "preview"` / widget `preview` prop) rental cards stay inert and the rental flows never mount (PR #58 rule, extended here to `requestedOffering`).
- **Tests are `.test.ts`, node environment** (`vitest.config.ts` include). Pure logic goes in `.ts` files so it is testable; `.tsx` files stay thin.
- **Verify command:** `npm run verify` (= `eslint` + `next typegen && tsc --noEmit` + `vitest run`). Run it before every commit that touches `.tsx`.
- **Commits** end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`; subject style `feat(booking-page): …` / `feat(rentals): …` / `test(…)`.
- **The canned preview offering** (`preview-catalog.ts`, id `"preview-offering"`) is **not a uuid** — the Spaces inspector must never write a photo row for it.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/features/orgs/vocab.ts` (new) + `.test.ts` | The word "Spaces" and the per-mode meta description, once | 1 |
| `src/components/shell/nav.ts`, `src/features/marketing/site.ts`, `src/features/scheduling/components/booking-widget.tsx` | consume vocab (nav label, onboarding picker, widget heading) | 1 |
| `src/features/booking-page/metadata.ts` + `.test.ts` | mode-aware description | 2 |
| `src/features/rentals/pricing.ts` + `.test.ts` | `stayHint()` shared by widget + section | 3 |
| `src/features/booking-page/schema.ts`, `defaults.ts`, `images.ts`, `doc-ops.ts`, `templates.ts` (+ tests) | the `spaces` section type in the pure layer; `EmptyContext.offeringCount` | 4 |
| `src/features/booking-page/render/page-request.ts` (new) + `.test.ts`, `render/page-state.tsx`, `render/sections/booking.tsx`, `booking-widget.tsx` | offering hand-off | 5 |
| `src/features/booking-page/render/sections/spaces.tsx` (new), `render/page-renderer.tsx` | the section on the page | 6 |
| `src/features/booking-page/gating.ts` + `.test.ts`, `studio/add-section-popover.tsx`, `studio/sections-panel.tsx`, `studio/forms/spaces.tsx` (new), `studio/section-inspector.tsx`, `studio/booking-page-builder.tsx`, `src/app/(dashboard)/booking-page/page.tsx`, `src/lib/booking/preview-catalog.ts` | palette by mode, inspector form, mode threading | 7 |
| `src/features/booking-page/templates.ts` + `.test.ts`, `studio/template-picker.tsx` | `fitToMode`, Venue, `templatesFor` | 8 |
| memory + PR | wrap-up | 9 |

---

### Task 1: Vocabulary — "Spaces" in one module, consumed by nav, onboarding and the widget

**Files:**
- Create: `src/features/orgs/vocab.ts`
- Test: `src/features/orgs/vocab.test.ts`
- Modify: `src/components/shell/nav.ts:43` (the `/rentals` item)
- Modify: `src/components/shell/nav.test.ts` (add one label test)
- Modify: `src/features/marketing/site.ts:201-205` (`ONBOARDING.modes`)
- Modify: `src/features/scheduling/components/booking-widget.tsx:256` (group heading)

**Interfaces:**
- Produces: `SPACES` const and `bookingDescription(mode: OrgMode, orgName: string): string` from `@/features/orgs/vocab`.

- [ ] **Step 1: Write the failing test**

`src/features/orgs/vocab.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SPACES, bookingDescription } from "./vocab";

const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };

describe("SPACES vocabulary", () => {
  it("names the channel Spaces on every surface a person reads", () => {
    expect(SPACES.nav).toBe("Spaces");
    expect(SPACES.widgetGroup).toBe("Spaces");
    expect(SPACES.section).toEqual({ label: "Spaces", description: "Your rooms, studios and gear, with photos and prices." });
    expect(SPACES.pickerTitle).toBe("Spaces");
    expect(SPACES.pickerBlurb).toBe("Rooms, studios and gear, booked by the hour, night or day.");
    expect(SPACES.pickerBothBlurb).toBe("You book people and spaces.");
  });
});

describe("bookingDescription", () => {
  it("appointments-only keeps the historical sentence", () => {
    expect(bookingDescription(APPTS_ONLY, "Anna's")).toBe("Book an appointment with Anna's.");
  });
  it("rentals-only says space", () => {
    expect(bookingDescription(RENTALS_ONLY, "Loft 3")).toBe("Book a space at Loft 3.");
  });
  it("both channels use the neutral sentence", () => {
    expect(bookingDescription(BOTH, "Demo")).toBe("Book with Demo.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/orgs/vocab.test.ts`
Expected: FAIL — `Failed to resolve import "./vocab"`.

- [ ] **Step 3: Write minimal implementation**

`src/features/orgs/vocab.ts`:
```ts
import type { OrgMode } from "./mode";

/* The one place the rentals channel is named for people (H5a ruling:
   "Spaces" — rooms, studios and gear alike, whatever the range mode). Code
   identifiers (rental_*, offersRentals, /rentals) never change; every
   surface a provider or client reads takes its word from here. */
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
} as const;

/** The hosted page's fallback meta description, per channel mix. */
export function bookingDescription(mode: OrgMode, orgName: string): string {
  if (mode.offersRentals && !mode.offersAppointments) return `Book a space at ${orgName}.`;
  if (mode.offersRentals && mode.offersAppointments) return `Book with ${orgName}.`;
  return `Book an appointment with ${orgName}.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/orgs/vocab.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Consume it — nav label**

In `src/components/shell/nav.ts` add `import { SPACES } from "@/features/orgs/vocab";` after the `OrgMode` import, and change the `/rentals` item to:
```ts
  { href: "/rentals", label: SPACES.nav, icon: House01Icon, section: "configure", channel: "rentals" },
```
Append to `src/components/shell/nav.test.ts` (inside the `navItemsFor (flags × mode)` describe, after the appointments-only test):
```ts
  it("the /rentals item is labelled Spaces (H5a vocabulary), and titles its page", () => {
    const item = navItemsFor(FLAGS, BOTH).find((i) => i.href === "/rentals");
    expect(item?.label).toBe("Spaces");
    expect(titleForPath("/rentals", navItemsFor(FLAGS, BOTH))).toBe("Spaces");
  });
```
(`titleForPath` is already imported at the top of that test file; check its signature at `nav.ts:70-75` — it takes `(pathname, items)`. If the parameter order differs, match it.)

- [ ] **Step 6: Consume it — onboarding picker copy**

In `src/features/marketing/site.ts` add `import { SPACES } from "@/features/orgs/vocab";` at the top, and replace the two `modes` entries:
```ts
    { value: "rentals", title: SPACES.pickerTitle, blurb: SPACES.pickerBlurb },
    { value: "both", title: "Both", blurb: SPACES.pickerBothBlurb },
```
(The `appointments` entry stays exactly as it is.)

- [ ] **Step 7: Consume it — widget heading**

In `src/features/scheduling/components/booking-widget.tsx` add `import { SPACES } from "@/features/orgs/vocab";` and change line 256:
```tsx
                <h2 className="text-muted-foreground text-sm font-medium">{SPACES.widgetGroup}</h2>
```

- [ ] **Step 8: Verify and commit**

Run: `npm run verify`
Expected: lint clean, typecheck clean, all tests pass (the `site.test.ts` forbidden-copy scan still passes — none of the new strings contain "google", "calendar sync", "stripe" or "payment").

```bash
git add src/features/orgs/vocab.ts src/features/orgs/vocab.test.ts src/components/shell/nav.ts src/components/shell/nav.test.ts src/features/marketing/site.ts src/features/scheduling/components/booking-widget.tsx
git commit -m "feat(orgs): Spaces vocabulary — nav, onboarding picker, widget heading

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Mode-aware page meta description

**Files:**
- Modify: `src/features/booking-page/metadata.ts:22-29`
- Test: `src/features/booking-page/metadata.test.ts:28-40`

**Interfaces:**
- Consumes: `bookingDescription` (Task 1), `modeOf` from `@/features/orgs/mode`.
- Produces: `pageMetadata(doc, org: { orgName: string; offersAppointments: boolean; offersRentals: boolean }, supabaseUrl)`. Both callers (`src/app/[handle]/page.tsx:27`, `src/app/[handle]/[staffSlug]/page.tsx:29`) already pass a `BookingOrg`, which has those fields — no caller edits.

- [ ] **Step 1: Write the failing test**

Replace the `pageMetadata` describe in `metadata.test.ts` with:
```ts
describe("pageMetadata", () => {
  const APPTS = { orgName: "Anna's", offersAppointments: true, offersRentals: false };
  it("sets title, description and an OG image only when the hero has one", () => {
    const hero = { ...newSection("hero"), headline: "Hair by Anna", imagePath: IMG };
    const meta = pageMetadata({ ...DEFAULT_PAGE, sections: [header, hero, booking] }, APPTS, "http://127.0.0.1:54351");
    expect(meta.title).toBe("Anna's");
    expect(meta.description).toBe("Hair by Anna");
    expect(meta.openGraph?.images).toEqual([`http://127.0.0.1:54351/storage/v1/object/public/branding/${IMG}`]);
    const plain = pageMetadata(DEFAULT_PAGE, APPTS, "http://x");
    expect(plain.description).toBe("Book an appointment with Anna's.");
    expect(plain.openGraph).toBeUndefined();
    expect(heroImagePath(DEFAULT_PAGE)).toBeNull();
  });
  it("the fallback description follows the org's channels", () => {
    expect(pageMetadata(DEFAULT_PAGE, { orgName: "Loft 3", offersAppointments: false, offersRentals: true }, "http://x").description).toBe("Book a space at Loft 3.");
    expect(pageMetadata(DEFAULT_PAGE, { orgName: "Demo", offersAppointments: true, offersRentals: true }, "http://x").description).toBe("Book with Demo.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/booking-page/metadata.test.ts`
Expected: FAIL — the second test gets "Book an appointment with Loft 3." (typecheck also flags the extra fields only once the signature changes; the runtime assertion is the RED).

- [ ] **Step 3: Write minimal implementation**

`metadata.ts`: add imports and change `pageMetadata`:
```ts
import { modeOf, type OrgMode } from "@/features/orgs/mode";
import { bookingDescription } from "@/features/orgs/vocab";
// … existing imports stay

export function pageMetadata(
  doc: PageDocument,
  org: { orgName: string } & Parameters<typeof modeOf>[0],
  supabaseUrl: string,
): Metadata {
  const image = heroImagePath(doc);
  const mode: OrgMode = modeOf(org);
  return {
    title: org.orgName,
    description: pageDescription(doc, bookingDescription(mode, org.orgName)),
    ...(image ? { openGraph: { images: [pageImageUrl(supabaseUrl, image)] } } : {}),
  };
}
```

- [ ] **Step 4: Run tests, verify, commit**

Run: `npx vitest run src/features/booking-page/metadata.test.ts` → PASS. Then `npm run verify` → clean (the two `[handle]` pages compile unchanged because `BookingOrg` carries both flags).

```bash
git add src/features/booking-page/metadata.ts src/features/booking-page/metadata.test.ts
git commit -m "feat(booking-page): meta description follows the org's channels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `stayHint()` — one hint for widget cards and the Spaces section

**Files:**
- Modify: `src/features/rentals/pricing.ts` (append)
- Test: `src/features/rentals/pricing.test.ts` (append a describe)
- Modify: `src/features/scheduling/components/booking-widget.tsx:272-284` (replace the inline ternary)

**Interfaces:**
- Produces: `stayHint(o: { rangeMode: RangeMode; minStay: number; minDurationMin: number | null; maxDurationMin: number | null }): string | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/rentals/pricing.test.ts` (add `stayHint` to the existing import from `./pricing`):
```ts
describe("stayHint", () => {
  it("hourly: the duration range", () => {
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: 60, maxDurationMin: 240 })).toBe("1 h–4 h");
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: 90, maxDurationMin: 150 })).toBe("1 h 30 min–2 h 30 min");
  });
  it("nights/days: the minimum stay when it is more than one", () => {
    expect(stayHint({ rangeMode: "nights", minStay: 2, minDurationMin: null, maxDurationMin: null })).toBe("min 2 nights");
    expect(stayHint({ rangeMode: "days", minStay: 3, minDurationMin: null, maxDurationMin: null })).toBe("min 3 days");
  });
  it("nothing to say: one-night minimum, or an hourly row missing its grid", () => {
    expect(stayHint({ rangeMode: "nights", minStay: 1, minDurationMin: null, maxDurationMin: null })).toBeNull();
    expect(stayHint({ rangeMode: "hours", minStay: 1, minDurationMin: null, maxDurationMin: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/rentals/pricing.test.ts`
Expected: FAIL — `stayHint is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/features/rentals/pricing.ts` (add `import { formatDurationLabel } from "./hourly";` at the top):
```ts
/** The "how much" hint beside a rental's price: hourly → its duration range,
    nights/days → the minimum stay when it is more than one, else nothing.
    Shared by the widget's offering cards and the page-builder Spaces section
    so the two never drift. */
export function stayHint(o: {
  rangeMode: RangeMode;
  minStay: number;
  minDurationMin: number | null;
  maxDurationMin: number | null;
}): string | null {
  if (o.rangeMode === "hours") {
    return o.minDurationMin !== null && o.maxDurationMin !== null
      ? `${formatDurationLabel(o.minDurationMin)}–${formatDurationLabel(o.maxDurationMin)}`
      : null;
  }
  return o.minStay > 1 ? `min ${o.minStay} ${o.rangeMode}` : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/rentals/pricing.test.ts` → PASS.

- [ ] **Step 5: Use it in the widget**

In `booking-widget.tsx`, add `stayHint` to the existing `@/features/rentals/pricing` import (next to `formatOfferingPrice`) and replace the meta ternary (lines ~272-284) so the block reads:
```tsx
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {[formatOfferingPrice(o, currency), stayHint(o)].filter(Boolean).join(" · ")}
                      </span>
```
Remove the now-unused `formatDurationLabel` import from the widget if nothing else in the file uses it (grep the file first).

- [ ] **Step 6: Verify and commit**

Run: `npm run verify` → clean.
```bash
git add src/features/rentals/pricing.ts src/features/rentals/pricing.test.ts src/features/scheduling/components/booking-widget.tsx
git commit -m "feat(rentals): stayHint — shared price hint for offering cards

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The `spaces` section type in the pure layer (schema, defaults, images, doc-ops, stripSample)

**Files:**
- Modify: `src/features/booking-page/schema.ts` (`SECTION_TYPES`, `SINGLE_INSTANCE_TYPES`, new `spacesSection`, union, doc-level rule)
- Modify: `src/features/booking-page/defaults.ts` (`SECTION_META`, `ADDABLE_TYPES`, `newSection`)
- Modify: `src/features/booking-page/images.ts:46-58` (`sectionImagePaths`)
- Modify: `src/features/booking-page/doc-ops.ts:7-34, 93-109` (`EmptyContext`, `isSectionEmpty`, `sectionSummary`)
- Modify: `src/features/booking-page/templates.ts:133-136` (`stripSample` pass-through)
- Modify: `src/features/booking-page/render/page-renderer.tsx:53` and `src/features/booking-page/studio/booking-page-builder.tsx:136` (`EmptyContext.offeringCount` callers)
- Tests: `schema.test.ts`, `images.test.ts`, `doc-ops.test.ts`

**Interfaces:**
- Produces: `SectionOf<"spaces">` = `{ id; hidden; type: "spaces"; title: string; style: "list" | "cards"; showPrices: boolean; showStay: boolean; photos: Array<{ offeringId: string; path: string }> }`; `EmptyContext = { serviceCount; staffCount; offeringCount }`; `newSection("spaces")`; `SECTION_META.spaces`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/booking-page/schema.test.ts` (inside `describe("pageDocumentSchema")`; `newSectionId`, `ADDABLE_TYPES`, `SECTION_META` are already imported there):
```ts
  it("spaces: a live section with per-offering photos, single-instance, one photo per space", () => {
    const OFFERING = "11111111-2222-4333-8444-555555555555";
    const spaces = { ...newSection("spaces"), photos: [{ offeringId: OFFERING, path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, spaces, booking] }).success).toBe(true);
    expect(ADDABLE_TYPES).toContain("spaces");
    expect(SECTION_META.spaces.label).toBe("Spaces");
    // one per page
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, spaces, { ...spaces, id: newSectionId() }, booking] }).success).toBe(false);
    // offeringId must be a uuid (the canned preview offering never gets a photo row)
    const bad = { ...spaces, photos: [{ offeringId: "preview-offering", path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, bad, booking] }).success).toBe(false);
    // one photo per space
    const dup = { ...spaces, photos: [{ offeringId: OFFERING, path: IMG }, { offeringId: OFFERING, path: IMG }] };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, dup, booking] }).success).toBe(false);
    // at most 12 photos, and they count toward the 24-image page cap
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ offeringId: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`, path: IMG }));
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, { ...spaces, photos: many(13) }, booking] }).success).toBe(false);
    const gallery = { ...newSection("gallery"), images: Array.from({ length: 12 }, () => ({ path: IMG, alt: "" })) };
    const hero = { ...newSection("hero"), imagePath: IMG };
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, { ...spaces, photos: many(12) }, booking] }).success).toBe(true);
    expect(pageDocumentSchema.safeParse({ ...DEFAULT_PAGE, sections: [header, gallery, { ...spaces, photos: many(12) }, hero, booking] }).success).toBe(false);
  });
```
Append to the `imagePathsIn / orphanPaths` describe in `src/features/booking-page/images.test.ts`:
```ts
  it("collects spaces photos too", () => {
    const withSpaces = {
      sections: [
        ...doc.sections,
        { id: "spaces01", type: "spaces" as const, hidden: false, title: "Spaces", style: "cards" as const, showPrices: true, showStay: true,
          photos: [{ offeringId: "11111111-2222-4333-8444-555555555555", path: "o/page/d.png" }] },
      ],
    };
    expect(imagePathsIn(withSpaces)).toEqual(["o/page/a.png", "o/page/b.png", "o/page/c.png", "o/page/a.png", "o/page/d.png"]);
  });
```
`EmptyContext` gains a field, and `tsc` covers test files, so two existing fixtures must grow with it: in `src/features/booking-page/doc-ops.test.ts` change the shared context to `const ctx = { serviceCount: 2, staffCount: 1, offeringCount: 1 };`, and in `src/features/booking-page/templates.test.ts` (second test, ~line 19) change `const ctx = { serviceCount: 1, staffCount: 1 };` to `const ctx = { serviceCount: 1, staffCount: 1, offeringCount: 1 };`. Then append inside `describe("isSectionEmpty")` in `doc-ops.test.ts`:
```ts
  it("spaces is empty only when the org has no active offering", () => {
    const spaces = newSection("spaces");
    expect(isSectionEmpty(spaces, ctx)).toBe(false);
    expect(isSectionEmpty(spaces, { ...ctx, offeringCount: 0 })).toBe(true);
    expect(sectionSummary({ ...(spaces as Extract<Section, { type: "spaces" }>), style: "list" })).toBe("List");
    expect(sectionSummary(spaces)).toBe("Cards");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/booking-page/schema.test.ts src/features/booking-page/images.test.ts src/features/booking-page/doc-ops.test.ts`
Expected: FAIL — `newSection("spaces")` is a type error at runtime returns `undefined` → the spaces assertions fail; images test gets no `d.png`.

- [ ] **Step 3: Schema**

In `schema.ts`:
```ts
export const SECTION_TYPES = [
  "header", "hero", "about", "services", "staff", "spaces", "gallery", "testimonials", "faq", "links", "location", "booking",
] as const;
// …
export const SINGLE_INSTANCE_TYPES: ReadonlySet<SectionType> = new Set<SectionType>(["header", "booking", "services", "staff", "spaces"]);
// … after staffSection:
/** H5a: the org's rental offerings as cards. Photos live here, keyed by
    offering id (no column on rental_offerings); the offerings themselves
    come from RenderContext at render time. */
export const spacesSection = z.object({
  ...base, type: z.literal("spaces"), title: text(60), style: z.enum(["list", "cards"]), showPrices: z.boolean(), showStay: z.boolean(),
  photos: z.array(z.object({ offeringId: z.string().uuid(), path: imagePath })).max(12),
});
```
Add `spacesSection` to `sectionSchema`'s list (after `staffSection`). In `pageDocumentSchema.superRefine`, after the single-instance loop:
```ts
    for (const s of doc.sections) {
      if (s.type === "spaces" && new Set(s.photos.map((p) => p.offeringId)).size !== s.photos.length) {
        ctx.addIssue({ code: "custom", path: ["sections"], message: "One photo per space." });
      }
    }
```
(zod 4's `discriminatedUnion` takes plain objects — that is why the uniqueness rule sits at document level, next to the other cross-field rules.)

- [ ] **Step 4: Defaults**

In `defaults.ts` add `import { SPACES } from "@/features/orgs/vocab";`, then:
```ts
  staff: { label: "Team", description: "Your bookable team members." },
  spaces: SPACES.section,
```
`ADDABLE_TYPES`: insert `"spaces"` after `"staff"`. In `newSection`:
```ts
    case "spaces": return { ...base, type, title: "Spaces", style: "cards", showPrices: true, showStay: true, photos: [] };
```

- [ ] **Step 5: Images, doc-ops, stripSample, callers**

`images.ts` `sectionImagePaths`: add before `default`:
```ts
    case "spaces":
      return section.photos.map((p) => p.path);
```
`doc-ops.ts`:
```ts
export type EmptyContext = { serviceCount: number; staffCount: number; offeringCount: number };
// isSectionEmpty:
    case "spaces":
      return ctx.offeringCount === 0;
// sectionSummary:
    case "spaces": return section.style === "cards" ? "Cards" : "List";
```
`templates.ts` `stripSample`: add `case "spaces":` to the `services`/`staff`/`booking` pass-through group.
`render/page-renderer.tsx:53`: `publicSections(doc, { serviceCount: ctx.services.length, staffCount: ctx.lockedStaff ? 0 : ctx.staff.length, offeringCount: ctx.offerings.length })`.
`studio/booking-page-builder.tsx:136`: `emptyContext={{ serviceCount: previewServices.length, staffCount: staff.length, offeringCount: previewOfferings.length }}`.

- [ ] **Step 6: Run tests, typecheck, commit**

Run: `npx vitest run src/features/booking-page` → PASS. Then `npm run verify`. Typecheck will now **fail** in two places that switch on section type without a declared return type — `render/page-renderer.tsx` `renderSection` and `studio/section-inspector.tsx` — only if TS infers `undefined` into a JSX position; if it passes, fine; if it errors, add temporary cases `case "spaces": return null;` in both (Tasks 6 and 7 replace them). Commit only when `npm run verify` is clean.

```bash
git add src/features/booking-page/schema.ts src/features/booking-page/schema.test.ts src/features/booking-page/defaults.ts src/features/booking-page/images.ts src/features/booking-page/images.test.ts src/features/booking-page/doc-ops.ts src/features/booking-page/doc-ops.test.ts src/features/booking-page/templates.ts src/features/booking-page/templates.test.ts src/features/booking-page/render/page-renderer.tsx src/features/booking-page/studio/booking-page-builder.tsx src/features/booking-page/studio/section-inspector.tsx
git commit -m "feat(booking-page): spaces section type — schema, defaults, images, empties

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Offering hand-off — page state → booking section → widget `requestedOffering`

**Files:**
- Create: `src/features/booking-page/render/page-request.ts`
- Test: `src/features/booking-page/render/page-request.test.ts`
- Modify: `src/features/booking-page/render/page-state.tsx` (whole file)
- Modify: `src/features/booking-page/render/sections/booking.tsx:30` (`requestedService` line)
- Modify: `src/features/scheduling/components/booking-widget.tsx:37, 56, 100-112, 170`

**Interfaces:**
- Produces: `type PageRequest = { kind: "service" | "offering"; id: string; key: number } | null`; `nextRequest(prev, kind, id)`; `usePageState(): { requested; selectService(id); selectOffering(id) }`; widget prop `requestedOffering?: { id: string; key: number } | null`.

- [ ] **Step 1: Write the failing test**

`src/features/booking-page/render/page-request.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextRequest, initialRequest } from "./page-request";

describe("page request reducer", () => {
  it("starts from the ?service= deep link, or empty", () => {
    expect(initialRequest("svc1")).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(initialRequest(null)).toBeNull();
  });
  it("every request gets a new key, so re-picking the same thing still lands", () => {
    const a = nextRequest(null, "service", "svc1");
    const b = nextRequest(a, "service", "svc1");
    expect(a).toEqual({ kind: "service", id: "svc1", key: 1 });
    expect(b).toEqual({ kind: "service", id: "svc1", key: 2 });
  });
  it("switches kind freely — a space after a service, and back", () => {
    const s = nextRequest(null, "service", "svc1");
    const o = nextRequest(s, "offering", "off1");
    expect(o).toEqual({ kind: "offering", id: "off1", key: 2 });
    expect(nextRequest(o, "service", "svc2")).toEqual({ kind: "service", id: "svc2", key: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/booking-page/render/page-request.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the reducer**

`src/features/booking-page/render/page-request.ts`:
```ts
/* The section → widget hand-off, as data. A services or spaces card asks the
   booking widget to open on one thing; the key makes every ask distinct so
   picking the same card twice (after "change") still lands. Pure, so the
   provider stays a thin React shell. */
export type RequestKind = "service" | "offering";
export type PageRequest = { kind: RequestKind; id: string; key: number } | null;

export function initialRequest(serviceId: string | null): PageRequest {
  return serviceId ? { kind: "service", id: serviceId, key: 1 } : null;
}

export function nextRequest(prev: PageRequest, kind: RequestKind, id: string): PageRequest {
  return { kind, id, key: (prev?.key ?? 0) + 1 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/booking-page/render/page-request.test.ts` → PASS.

- [ ] **Step 5: Provider**

Replace `src/features/booking-page/render/page-state.tsx` with:
```tsx
"use client";

import * as React from "react";
import { initialRequest, nextRequest, type PageRequest } from "./page-request";

type PageState = { requested: PageRequest; selectService: (id: string) => void; selectOffering: (id: string) => void };

const Ctx = React.createContext<PageState>({ requested: null, selectService: () => {}, selectOffering: () => {} });

/* Services / Spaces section → booking widget hand-off (see page-request.ts). */
export function PageStateProvider({ initialServiceId, children }: { initialServiceId: string | null; children: React.ReactNode }) {
  const [requested, setRequested] = React.useState<PageRequest>(() => initialRequest(initialServiceId));
  const selectService = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "service", id)), []);
  const selectOffering = React.useCallback((id: string) => setRequested((prev) => nextRequest(prev, "offering", id)), []);
  const value = React.useMemo(() => ({ requested, selectService, selectOffering }), [requested, selectService, selectOffering]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageState(): PageState {
  return React.useContext(Ctx);
}
```

- [ ] **Step 6: Booking section passes both kinds**

In `render/sections/booking.tsx` replace `requestedService={requested}` with:
```tsx
          requestedService={requested?.kind === "service" ? requested : null}
          requestedOffering={requested?.kind === "offering" ? requested : null}
```

- [ ] **Step 7: Widget applies `requestedOffering`**

In `booking-widget.tsx`:
- destructure `requestedOffering = null,` next to `requestedService = null,` (line ~37) and add to the props type (line ~56):
  ```ts
  /** A Spaces-section card asked for this offering (page-state.tsx). Same
      once-per-key contract as requestedService. */
  requestedOffering?: { id: string; key: number } | null;
  ```
- after the `requestedService` apply block (ends ~line 112) add:
  ```ts
  const [appliedOfferingKey, setAppliedOfferingKey] = React.useState<number | null>(null);
  if (requestedOffering && requestedOffering.key !== appliedOfferingKey) {
    setAppliedOfferingKey(requestedOffering.key);
    const found = offerings.find((o) => o.id === requestedOffering.id);
    if (found) {
      setOffering(found);
      setService(null);
      setStaffChoice(null);
      setSlot(null);
    }
  }
  ```
- change the flows branch at line ~170 from `if (offering) {` to:
  ```ts
  // Preview (admin live previews / template thumbnails) never mounts the
  // rental flows — they fetch availability (PR #58's inert rule). A Spaces
  // card click in preview still records the request; the list just stays.
  if (offering && !preview) {
  ```

- [ ] **Step 8: Verify and commit**

Run: `npm run verify` → clean.
```bash
git add src/features/booking-page/render/page-request.ts src/features/booking-page/render/page-request.test.ts src/features/booking-page/render/page-state.tsx src/features/booking-page/render/sections/booking.tsx src/features/scheduling/components/booking-widget.tsx
git commit -m "feat(booking-page): offering hand-off — page state → widget requestedOffering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The Spaces section on the page

**Files:**
- Create: `src/features/booking-page/render/sections/spaces.tsx`
- Modify: `src/features/booking-page/render/page-renderer.tsx` (import + `case "spaces"`)

**Interfaces:**
- Consumes: `SectionOf<"spaces">` (Task 4), `usePageState().selectOffering` (Task 5), `formatOfferingPrice` + `stayHint` (Task 3), `pageImageUrl` (`../../images`), `Ghost`.

No unit test is possible for a `.tsx` section (house rule); the deliverable is typecheck + the browser QA in Task 9.

- [ ] **Step 1: Write the section**

`src/features/booking-page/render/sections/spaces.tsx`:
```tsx
"use client";

import { cn } from "@/lib/utils";
import { formatOfferingPrice, stayHint } from "@/features/rentals/pricing";
import type { SectionOf } from "../../schema";
import { pageImageUrl } from "../../images";
import type { RenderContext } from "../context";
import { Ghost } from "../ghost";
import { usePageState } from "../page-state";

/* The org's rental offerings as cards (services.tsx's twin). Offerings come
   live from ctx — every active one, catalogue order; the section only owns
   presentation (style, which meta to show) and the photos, keyed by
   offering id. A click hands the offering to the booking widget. */
export function SpacesSection({ section, ctx }: { section: SectionOf<"spaces">; ctx: RenderContext }) {
  const { selectOffering } = usePageState();
  if (ctx.offerings.length === 0) return <Ghost mode={ctx.mode} label="Add a space and it shows here" />;
  const photoFor = new Map(section.photos.map((p) => [p.offeringId, p.path] as const));
  const pick = (id: string) => {
    selectOffering(id);
    // The preview sits inside the admin page: no scrolling there.
    if (ctx.mode === "public") document.getElementById("book")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const cards = section.style === "cards";
  return (
    <section className="flex flex-col gap-3">
      {section.title.trim() ? <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2> : null}
      <ul className={cn(cards ? "grid gap-3 sm:grid-cols-2" : "flex flex-col divide-y rounded-[var(--widget-radius)] border")}>
        {ctx.offerings.map((o) => {
          const photo = photoFor.get(o.id);
          const meta = [section.showPrices ? formatOfferingPrice(o, ctx.org.currency) : null, section.showStay ? stayHint(o) : null]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => pick(o.id)}
                className={cn(
                  "wt-surface flex w-full text-left",
                  cards ? "h-full flex-col items-start gap-2 rounded-[var(--widget-radius)] border p-4" : "items-center gap-3 px-4 py-3",
                )}
              >
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={pageImageUrl(ctx.supabaseUrl, photo)}
                    alt=""
                    className={cn("shrink-0 rounded-[var(--widget-radius)] object-cover", cards ? "aspect-[4/3] w-full" : "size-16")}
                  />
                ) : null}
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{o.name}</span>
                  {o.description ? <span className="text-muted-foreground text-sm">{o.description}</span> : null}
                  {meta ? <span className="text-muted-foreground text-xs">{meta}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Wire the renderer**

In `render/page-renderer.tsx` add `import { SpacesSection } from "./sections/spaces";` (after `StaffSection`) and in `renderSection`:
```tsx
    case "spaces": return <SpacesSection section={section} ctx={ctx} />;
```
(Remove the temporary `case "spaces": return null;` if Task 4 added one.)

- [ ] **Step 3: Verify and commit**

Run: `npm run verify` → clean.
```bash
git add src/features/booking-page/render/sections/spaces.tsx src/features/booking-page/render/page-renderer.tsx
git commit -m "feat(booking-page): Spaces section renders offerings with photos and prices

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Builder — palette by mode, the Spaces inspector form, mode threading

**Files:**
- Modify: `src/features/booking-page/gating.ts` (add `addableTypes`)
- Test: `src/features/booking-page/gating.test.ts`
- Modify: `src/lib/booking/preview-catalog.ts` (export the canned id)
- Create: `src/features/booking-page/studio/forms/spaces.tsx`
- Modify: `src/features/booking-page/studio/section-inspector.tsx` (`offerings` prop, `case "spaces"`)
- Modify: `src/features/booking-page/studio/add-section-popover.tsx` (`mode` prop, `addableTypes`)
- Modify: `src/features/booking-page/studio/sections-panel.tsx` (`mode` prop through)
- Modify: `src/features/booking-page/studio/booking-page-builder.tsx` (`mode` prop; pass to panel + inspector)
- Modify: `src/app/(dashboard)/booking-page/page.tsx` (`mode={mode}`)

**Interfaces:**
- Produces: `addableTypes(mode: OrgMode): SectionType[]`; `PREVIEW_OFFERING_ID = "preview-offering"`; `BookingPageBuilder` prop `mode: OrgMode` (Task 8's picker reads it too).

- [ ] **Step 1: Write the failing test**

Append to `src/features/booking-page/gating.test.ts` (add `addableTypes` to the import from `./gating`):
```ts
describe("addableTypes (palette by org mode)", () => {
  const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
  const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
  const BOTH = { offersAppointments: true, offersRentals: true };
  it("appointments-only never offers Spaces", () => {
    const t = addableTypes(APPTS_ONLY);
    expect(t).not.toContain("spaces");
    expect(t).toContain("services");
    expect(t).toContain("staff");
  });
  it("rentals-only offers Spaces and hides Services and Team", () => {
    const t = addableTypes(RENTALS_ONLY);
    expect(t).toContain("spaces");
    expect(t).not.toContain("services");
    expect(t).not.toContain("staff");
  });
  it("both channels: the full palette, in ADDABLE_TYPES order", () => {
    expect(addableTypes(BOTH)).toEqual([...ADDABLE_TYPES]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/booking-page/gating.test.ts` → FAIL (`addableTypes` not exported).

- [ ] **Step 3: Implement `addableTypes`**

In `gating.ts` add `import type { OrgMode } from "@/features/orgs/mode";` and `import { ADDABLE_TYPES } from "./defaults";`, then:
```ts
/** The palette for an org: a channel it doesn't sell gets no section. */
export function addableTypes(mode: OrgMode): SectionType[] {
  return ADDABLE_TYPES.filter((t) => {
    if (t === "spaces") return mode.offersRentals;
    if (t === "services" || t === "staff") return mode.offersAppointments;
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/booking-page/gating.test.ts` → PASS.

- [ ] **Step 5: Export the canned id**

In `src/lib/booking/preview-catalog.ts` add above `CANNED_PREVIEW_OFFERING`:
```ts
/** The stand-in's id — callers that must not treat it as a real offering
    (the Spaces inspector's photo rows) filter on this. */
export const PREVIEW_OFFERING_ID = "preview-offering";
```
and use it: `id: PREVIEW_OFFERING_ID,`.

- [ ] **Step 6: The inspector form**

`src/features/booking-page/studio/forms/spaces.tsx`:
```tsx
"use client";
import Link from "next/link";
import type { PublicOffering } from "@/lib/booking/public";
import { PREVIEW_OFFERING_ID } from "@/lib/booking/preview-catalog";
import { CheckboxField, FieldError, SelectField, TextField } from "../fields";
import { ImageField } from "../image-field";
import { patch, type FormProps } from "./types";

/* Spaces: presentation toggles plus one photo per offering. The offerings
   are the org's real catalogue (read-only here — "Manage spaces" edits them);
   the canned preview stand-in is never offered a photo row, its id isn't a
   uuid and the schema would refuse it. */
export function SpacesForm({ section, issues, supabaseUrl, offerings, onChange }: FormProps<"spaces"> & { offerings: PublicOffering[] }) {
  const real = offerings.filter((o) => o.id !== PREVIEW_OFFERING_ID);
  const photoFor = (id: string) => section.photos.find((p) => p.offeringId === id)?.path;
  const setPhoto = (offeringId: string, path: string | undefined) => {
    // Rebuilt from the live catalogue on every edit: a photo for a space
    // that no longer exists is dropped here rather than failing anywhere.
    const kept = section.photos.filter((p) => p.offeringId !== offeringId && real.some((o) => o.id === p.offeringId));
    onChange(patch(section, { photos: path ? [...kept, { offeringId, path }] : kept }));
  };
  return (
    <>
      <TextField id="sec-spaces-title" label="Title" value={section.title} max={60} error={issues.title} onChange={(v) => onChange(patch(section, { title: v }))} />
      <SelectField id="sec-spaces-style" label="Style" value={section.style} options={[{ value: "list", label: "List" }, { value: "cards", label: "Cards" }]} onChange={(style) => onChange(patch(section, { style }))} />
      <CheckboxField id="sec-spaces-prices" label="Show prices" checked={section.showPrices} onChange={(showPrices) => onChange(patch(section, { showPrices }))} />
      <CheckboxField id="sec-spaces-stay" label="Show stay / duration" checked={section.showStay} onChange={(showStay) => onChange(patch(section, { showStay }))} />
      {real.length === 0 ? (
        <p className="text-muted-foreground px-4 py-3 text-sm">
          Add a space first — <Link href="/rentals" className="underline underline-offset-3">Manage spaces</Link>.
        </p>
      ) : (
        real.map((o) => (
          <ImageField key={o.id} id={`sec-spaces-photo-${o.id}`} label={o.name} path={photoFor(o.id)} supabaseUrl={supabaseUrl} onChange={(p) => setPhoto(o.id, p)} shape="wide" />
        ))
      )}
      <FieldError message={issues.photos} />
    </>
  );
}
```

- [ ] **Step 7: Inspector, popover, panel, builder, page**

`section-inspector.tsx`: add `import type { PublicOffering } from "@/lib/booking/public";` and `import { SpacesForm } from "./forms/spaces";`; add `offerings: PublicOffering[]` to the props (destructure it) and the case:
```tsx
      case "spaces": return <SpacesForm section={section} offerings={offerings} {...common} />;
```
(Remove the temporary `case "spaces": return null;` if Task 4 added one.)

`add-section-popover.tsx`: add `import type { OrgMode } from "@/features/orgs/mode";`, `import { addableTypes, sectionAllowed } from "../gating";` (drop the `ADDABLE_TYPES` import), add `mode: OrgMode` to the props, and map `addableTypes(mode)` instead of `ADDABLE_TYPES`.

`sections-panel.tsx`: add `mode: OrgMode` to the props (import the type) and pass `mode={mode}` to `<AddSectionPopover … />`.

`booking-page-builder.tsx`: add `mode: OrgMode` to the props (`import type { OrgMode } from "@/features/orgs/mode";`), pass `mode={mode}` to `<SectionsPanel …>` and `offerings={previewOfferings}` to `<SectionInspector …>`.

`src/app/(dashboard)/booking-page/page.tsx`: add `mode={mode}` to `<BookingPageBuilder …>` (`mode` is already computed there since PR #58).

- [ ] **Step 8: Verify and commit**

Run: `npm run verify` → clean.
```bash
git add src/features/booking-page/gating.ts src/features/booking-page/gating.test.ts src/lib/booking/preview-catalog.ts src/features/booking-page/studio/forms/spaces.tsx src/features/booking-page/studio/section-inspector.tsx src/features/booking-page/studio/add-section-popover.tsx src/features/booking-page/studio/sections-panel.tsx src/features/booking-page/studio/booking-page-builder.tsx "src/app/(dashboard)/booking-page/page.tsx"
git commit -m "feat(booking-page): Spaces inspector with per-offering photos; palette follows org mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Templates fit the mode; the "Venue" template; picker order

**Files:**
- Modify: `src/features/booking-page/templates.ts` (add Venue, `fitToMode`, `templatesFor`, mode params on `applyTemplate`/`templatePreview`)
- Test: `src/features/booking-page/templates.test.ts`
- Modify: `src/features/booking-page/studio/template-picker.tsx` (`mode` prop)
- Modify: `src/features/booking-page/studio/booking-page-builder.tsx:137` (`<TemplatePicker … mode={mode} />`)

**Interfaces:**
- Produces: `fitToMode(sections: Section[], mode: OrgMode, idFor: (source: Section) => string): Section[]`; `applyTemplate(t, mode)`; `templatePreview(t, mode)`; `templatesFor(mode): Template[]`; `TEMPLATES` now has seven entries, `venue` after `studio`.

- [ ] **Step 1: Write the failing tests**

Rewrite the first `it` in `templates.test.ts` and append the new describes. Add to the imports: `fitToMode, templatesFor` from `./templates`, and at the top:
```ts
const APPTS_ONLY = { offersAppointments: true, offersRentals: false };
const RENTALS_ONLY = { offersAppointments: false, offersRentals: true };
const BOTH = { offersAppointments: true, offersRentals: true };
```
Replace the first test with:
```ts
  it("ships seven, each a valid preview and applied document in every mode", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["classic", "profile", "studio", "venue", "split", "team", "minimal"]);
    for (const t of TEMPLATES) for (const mode of [APPTS_ONLY, RENTALS_ONLY, BOTH]) {
      expect(pageDocumentSchema.safeParse(templatePreview(t, mode)).success, `${t.id} preview`).toBe(true);
      const applied = applyTemplate(t, mode);
      expect(pageDocumentSchema.safeParse(applied).success, `${t.id} applied`).toBe(true);
      expect(applied.layout).toBe(t.layout);
    }
    // appointments-only leaves the legacy six exactly as authored
    for (const t of TEMPLATES.filter((x) => x.id !== "venue")) {
      expect(applyTemplate(t, APPTS_ONLY).sections.map((s) => s.type)).toEqual(t.sections.map((s) => s.type));
    }
  });
```
In the second test, change `applyTemplate(t)` → `applyTemplate(t, BOTH)` and extend the "live section" exclusion with `&& s.type !== "spaces"`. Then append:
```ts
describe("fitToMode", () => {
  const studio = TEMPLATES.find((t) => t.id === "studio")!;
  const team = TEMPLATES.find((t) => t.id === "team")!;
  const venue = TEMPLATES.find((t) => t.id === "venue")!;
  const types = (s: { type: string }[]) => s.map((x) => x.type);
  const stable = (s: { id: string }) => ("sp" + s.id).slice(0, 12);

  it("rentals-only: services becomes spaces (style kept), staff is dropped", () => {
    const out = fitToMode(studio.sections, RENTALS_ONLY, stable);
    expect(types(out)).toEqual(["hero", "spaces", "gallery", "testimonials", "booking", "location"]);
    const spaces = out.find((s) => s.type === "spaces");
    expect(spaces?.type === "spaces" && spaces.style).toBe("cards");
    expect(spaces?.type === "spaces" && spaces.title).toBe("Spaces");
    expect(types(fitToMode(team.sections, RENTALS_ONLY, stable))).toEqual(["header", "spaces", "booking", "location"]);
  });
  it("both: spaces is inserted right after services", () => {
    expect(types(fitToMode(studio.sections, BOTH, stable))).toEqual(["hero", "services", "spaces", "gallery", "testimonials", "booking", "location"]);
  });
  it("appointments-only: spaces sections are dropped", () => {
    expect(types(fitToMode(venue.sections, APPTS_ONLY, stable))).not.toContain("spaces");
  });
  it("derived ids are stable per source and schema-shaped", () => {
    const a = fitToMode(studio.sections, BOTH, stable);
    const b = fitToMode(studio.sections, BOTH, stable);
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    for (const s of a) expect(s.id).toMatch(/^[a-z0-9]{6,12}$/);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });
  it("applyTemplate assigns fresh ids even to the sections fitToMode created", () => {
    const applied = applyTemplate(studio, BOTH);
    for (const s of applied.sections) expect(studio.sections.some((o) => o.id === s.id || stable(o) === s.id)).toBe(false);
  });
});

describe("templatesFor", () => {
  it("rentals-only puts Venue first; both keeps source order; appointments-only hides Venue", () => {
    expect(templatesFor(RENTALS_ONLY)[0]?.id).toBe("venue");
    expect(templatesFor(BOTH).map((t) => t.id)).toEqual(TEMPLATES.map((t) => t.id));
    expect(templatesFor(APPTS_ONLY).map((t) => t.id)).not.toContain("venue");
    expect(templatesFor(APPTS_ONLY)).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/booking-page/templates.test.ts` → FAIL (`fitToMode`/`templatesFor` missing; six ids not seven).

- [ ] **Step 3: Implement**

In `templates.ts` add `import type { OrgMode } from "@/features/orgs/mode";`. Insert the Venue template **after** the `studio` entry in `TEMPLATES`:
```ts
  {
    id: "venue",
    name: "Venue",
    description: "Photo-led cover, your spaces with prices, a gallery and where to find you.",
    layout: "column",
    sections: [
      s("hero", "tplhero07", { headline: "Rooms by the hour in Podgórze", subheadline: "Rehearsal, recording and workshop space. Pick a room, choose your hours, book online.", align: "center" }),
      s("spaces", "tplspc007", { style: "cards" }),
      s("gallery", "tplgal007", { columns: 3 }),
      s("location", "tplloc007", { address: "ul. Józefa 12\n31-056 Kraków", mapsUrl: "https://maps.app.goo.gl/example" }),
      s("booking", "tplbook07", { title: "Book a space" }),
      s("faq", "tplfaq007", { items: [
        { q: "Can I cancel?", a: "Yes — see the cancellation window on each space." },
        { q: "What's included?", a: "The room, the listed gear, and the door code by email." },
      ] }),
    ],
    skin: { theme: "light", radius: "subtle", font: "system" },
  },
```
Replace `applyTemplate`/`templatePreview` with:
```ts
function spacesFrom(services: SectionOf<"services">, id: string): Section {
  return { ...newSection("spaces", id), style: services.style, title: "Spaces" } as Section;
}

/** Make a template's sections fit what the org sells: a rentals-only org
    gets Spaces where the template had Services (and no Team); a mixed org
    gets Spaces right after Services; an appointments-only org never sees
    Spaces. `idFor` names the sections this creates — fresh for applying,
    derived-and-stable for thumbnails. */
export function fitToMode(sections: Section[], mode: OrgMode, idFor: (source: Section) => string): Section[] {
  const out: Section[] = [];
  for (const section of sections) {
    if (section.type === "services") {
      if (mode.offersAppointments) {
        out.push(section);
        if (mode.offersRentals) out.push({ ...newSection("spaces", idFor(section)), style: "cards" } as Section);
      } else if (mode.offersRentals) {
        out.push(spacesFrom(section, idFor(section)));
      }
      continue;
    }
    if (section.type === "staff" && !mode.offersAppointments) continue;
    if (section.type === "spaces" && !mode.offersRentals) continue;
    out.push(section);
  }
  return out;
}

export function applyTemplate(t: Template, mode: OrgMode): PageDocument {
  return { version: 1, layout: t.layout, sections: fitToMode(t.sections, mode, () => newSectionId()).map(stripSample) };
}

/** The thumbnail document: sample copy intact, ids stable across renders. */
export function templatePreview(t: Template, mode: OrgMode): PageDocument {
  return { version: 1, layout: t.layout, sections: fitToMode(t.sections, mode, (s) => ("sp" + s.id).slice(0, 12)) };
}

/** Picker order per mode: Venue leads for space owners, hides for appointment-only orgs. */
export function templatesFor(mode: OrgMode): Template[] {
  const venue = TEMPLATES.filter((t) => t.id === "venue");
  const rest = TEMPLATES.filter((t) => t.id !== "venue");
  if (!mode.offersRentals) return rest;
  if (!mode.offersAppointments) return [...venue, ...rest];
  return [...TEMPLATES];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/booking-page/templates.test.ts` → PASS.

- [ ] **Step 5: Picker takes the mode**

`template-picker.tsx`: import `type OrgMode` from `@/features/orgs/mode` and `templatesFor` from `../templates` (drop `TEMPLATES` from that import); add `mode: OrgMode` to `TemplatePicker`'s props and to `TemplateThumb`'s props; `templatePreview(template, mode)` in the thumb; `applyTemplate(t, mode)` in `commit`; `templatesFor(mode).map(…)` in the list; pass `mode={mode}` to `<TemplateThumb …>`.

`booking-page-builder.tsx:137`: `<TemplatePicker doc={draft.doc} ctx={ctx} mode={mode} onApply={onApplyTemplate} />`.

- [ ] **Step 6: Verify and commit**

Run: `npm run verify` → clean.
```bash
git add src/features/booking-page/templates.ts src/features/booking-page/templates.test.ts src/features/booking-page/studio/template-picker.tsx src/features/booking-page/studio/booking-page-builder.tsx
git commit -m "feat(booking-page): templates fit the org mode; Venue template for space owners

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Browser QA matrix, memory, PR

**Files:**
- Modify: `~/.claude/projects/-Users-andriishcherbiak-Pet-projects-pipline-app/memory/product-direction.md` (H5a BUILT line)
- No source changes expected; fix-ups get their own commits.

- [ ] **Step 1: Full verification**

Run: `npm run verify` → clean. Run: `graphify update .`.

- [ ] **Step 2: Browser QA — mixed org (demo user `demo@rolloutos.local` / `Password123!`, local stack, `npm run dev` on :3000)**

Use the Playwright MCP. For each row, record PASS/FAIL in the PR body.
1. `/booking-page` → Add section → the list offers **Spaces**; add it → inspector shows Title / Style / Show prices / Show stay / one `ImageField` per real offering (Rehearsal Room, Test) and none for a stand-in. Upload a PNG for "Test" → preview card shows the photo; `imagePathsIn` count visible in the draft (no error).
2. Preview: cards show "120 zł / hour · 1 h–4 h" and "200 zł / night"; click a card → nothing fetches (network log shows no server-action POST), the widget list stays.
3. Publish → `/demo-studio` shows the Spaces section; click "Test" → the page scrolls to `#book` and the widget opens on Test's date picker (range picker rendered, not the list).
4. Start from a template → **Venue** listed after Studio; its thumbnail shows a spaces section. Apply Studio → the draft has `services` then `spaces`.
5. Sidebar says **Spaces**; `/rentals` page title reads "Spaces"; `/embed` snippet title "Book online" (from #58).
6. `curl -s http://localhost:3000/demo-studio | grep -o '<meta name="description" content="[^"]*"'` → `Book with Demo Programs.` unless a hero headline overrides it.
7. Sign out → `/` claim bar → the mode picker reads "Spaces — Rooms, studios and gear, booked by the hour, night or day." (do not submit).

- [ ] **Step 3: Browser QA — rentals-only (flip the demo org temporarily)**

```bash
docker exec -i supabase_db_pipline-app psql -U postgres -d postgres -X -c "update orgs set offers_appointments=false where handle='demo-studio';"
```
1. `/booking-page` palette: no Services, no Team, Spaces present. Template picker: Venue **first**; applying Team yields header · spaces · booking · location.
2. Existing `services` section in the draft (if any) shows the Ghost; the published page skips it.
3. `/demo-studio` meta description `Book a space at Demo Programs.`; the widget lists only rental cards with no group heading.
Restore:
```bash
docker exec -i supabase_db_pipline-app psql -U postgres -d postgres -X -c "update orgs set offers_appointments=true where handle='demo-studio';"
```

- [ ] **Step 4: Browser QA — appointments-only (flip rentals off)**

```bash
docker exec -i supabase_db_pipline-app psql -U postgres -d postgres -X -c "update orgs set offers_rentals=false where handle='demo-studio';"
```
Palette has no Spaces; picker has no Venue; a `spaces` section left in the draft renders the Ghost in preview and nothing publicly. Restore with `offers_rentals=true`.

- [ ] **Step 5: Memory + PR**

Append to the H5 line in `product-direction.md`: `H5a BUILT <date> on feat/h5a-spaces — PR #<n>; rulings held (doc photos, "Spaces", Venue-first, claim untouched); deferred list in the spec.`

```bash
git push -u origin feat/h5a-spaces
gh pr create --base main --title "feat(booking-page): H5a — Spaces section, mode-fit templates, Venue, Spaces vocabulary" --body-file - <<'EOF'
## What
H5a of the resource-booking pivot (spec: docs/superpowers/specs/2026-08-25-h5a-spaces-product-surface-design.md).
- `spaces` page-builder section: the org's offerings as list/cards with price, stay hint and a per-offering photo stored in the page document (no migration).
- Card click → `requestedOffering` hand-off into the booking widget (services' twin); inert in previews.
- Templates fit the org's mode (`fitToMode`); new photo-led **Venue** template, first in the picker for rentals-only orgs; claim flow untouched.
- "Spaces" vocabulary (`orgs/vocab.ts`): nav, onboarding picker, widget heading, `SECTION_META`, meta description per mode.

## Tests
`npm run verify` clean — new: vocab, metadata modes, stayHint, spaces schema/images/empties, page-request reducer, addableTypes, fitToMode/templatesFor.

## Browser QA
<paste the three matrices with PASS/FAIL>

## Deferred (spec §Out of scope)
Photo on the offering row; email/admin copy audit; per-offering links; claim-flow template seeding; H5b landing/pricing/FORBIDDEN_COPY.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```
