# S1 Pricing Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An hourly space's published price list (rates by length, time surcharges, per-person surcharge, extras) becomes the price a client is quoted, books at, and sees itemised on the booking — computed in the database, mirrored in the widget.

**Architecture:** A `pricing jsonb` column on `rental_offerings` holds the rules (NULL = today's flat rate, nothing changes). One SQL function `rental_quote_hours` turns rules + a booking request into an array of line items; the four hourly booking RPCs call it and snapshot the lines onto `bookings.lines` with `price_cents` = sum. `pricing.ts` carries `quoteHours`, the same algorithm in TypeScript, for the widget; an integration test feeds one fixture through both and asserts equality. The admin form gets four row editors; the widget gets a people stepper, extras with quantities, and an itemised confirm step.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (plpgsql `security definer` RPCs, migrations under `src/db/migrations`), Drizzle schema, zod 4, next-intl (en/uk/pl parity test), Vitest (unit + `vitest.integration.config.ts` against the local Supabase stack).

**Spec:** `docs/superpowers/specs/2026-09-07-s1-pricing-rules-design.md`

## Global Constraints

- Hourly offerings only (`range_mode = 'hours'`); nights/days untouched.
- Money is never a client input: the RPCs compute; the TS mirror is display-only.
- `pricing` NULL ⇒ every existing behaviour and test is unchanged.
- Lines store numbers and the studio's own words (`label` as typed), never translated sentences.
- Amounts are non-negative integer cents; rounding at line level; SQL `round()` and JS `Math.round` agree on non-negative halves.
- Migration is `0078_pricing_rules.sql`; function-only + two columns; journal entry idx 78; a meta snapshot is needed because columns change (copy `0077_snapshot.json` → `0078_snapshot.json` and add the two columns, per the 0058 precedent).
- Every new user-facing string exists in `messages/en.json`, `uk.json` and `pl.json` (`src/i18n/messages.test.ts` refuses a partial locale). Forbidden words: en `rental`, `offering`, `skip`; uk `оренда`, `офер`, `пропустити`; pl `wynaj`, `pomiń`. The studio namespace never says "later"/"пізніше"/"później".
- Integration tests run with `npm run test:integration -- <file>` and need the local stack (`npm run setup` once; migrations applied with `npm run db:migrate`).
- Commit after every task with the trailer:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5`.
- Branch: `feat/s1-pricing-rules` off `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/features/rentals/pricing-rules.ts` (new) | The `PricingRules` type, zod schema `pricingRulesSchema`, `Line` type, slug helper. Pure, no React. |
| `src/features/rentals/pricing-rules.test.ts` (new) | Schema rules, one failing case per rule. |
| `src/features/rentals/pricing.ts` (modify) | `quoteHours`, `sumLines`, `headlinePrice`; `moneyInfoLines` gains `lines`; `formatLine`. |
| `src/features/rentals/pricing.test.ts` (new) | `quoteHours` on the shared fixture; `formatLine`. |
| `src/features/rentals/pricing-fixture.ts` (new) | The one fixture (rules + cases + expected lines) both the unit and integration tests import. |
| `src/db/migrations/0078_pricing_rules.sql` (new) | Columns, CHECK, `rental_quote_hours`, four RPC bodies. |
| `src/db/migrations/meta/_journal.json`, `meta/0078_snapshot.json` | Register the migration. |
| `src/db/schema/rentals.ts`, `src/db/schema/scheduling.ts` (modify) | `pricing`, `lines`, `people` columns for Drizzle. |
| `src/features/rentals/pricing-quote.integration.test.ts` (new) | SQL ≡ TS on the fixture; snapshot; re-quote; refusals; resolver. |
| `src/features/rentals/schema.ts` (modify) | `pricing` on the hours branches; `people`/`extras` on `createRentalBookingHoursInput`. |
| `src/features/rentals/actions.ts` (modify) | `pricing` travels through `toOfferingSettingsRow`. |
| `src/features/rentals/queries.ts` (modify) | `OfferingRow.pricing`; column list. |
| `src/lib/booking/public.ts` (modify) | `PublicOffering.pricing`; column list. |
| `src/lib/tokens/booking.ts` (modify) | resolver returns `lines`, `people`. |
| `src/features/rentals/hourly-actions.ts` (modify) | passes `people`/`extras`; maps `quote` sentinel; emails use lines. |
| `src/features/rentals/components/pricing-rules-editor.tsx` (new) | The four row editors, controlled, emits `PricingRules | null`. |
| `src/features/rentals/components/offering-form.tsx` (modify) | Mounts the editor for hours mode; posts `pricing`. |
| `src/features/rentals/components/hourly-booking-flow.tsx` (modify) | People stepper, extras, itemised confirm; pills show base. |
| `src/features/rentals/components/booking-money-summary.tsx` (modify) | Renders `lines`. |
| `src/app/booking/[token]/page.tsx` (modify) | Passes `lines` to `moneyInfoLines`. |
| `messages/{en,uk,pl}.json`, `messages/GLOSSARY.md` (modify) | Strings + glossary terms. |

---

### Task 1: Rules type and zod schema

**Files:**
- Create: `src/features/rentals/pricing-rules.ts`
- Test: `src/features/rentals/pricing-rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Band = { fromMin: number; perHourCents?: number; totalCents?: number };
  export type Surcharge = { label: string; pct: number; days: number[]; from: string; to: string };
  export type People = { included: number; extraCents: number; max: number };
  export type Extra = { id: string; label: string; unit: "hour" | "piece"; priceCents: number; maxQty: number };
  export type PricingRules = { bands: Band[]; surcharges: Surcharge[]; people?: People; extras: Extra[] };
  export type Line =
    | { kind: "base"; qty: number; unitCents: number | null; cents: number }
    | { kind: "surcharge"; qty: number; unitCents: null; cents: number; label: string; pct: number }
    | { kind: "people"; qty: number; unitCents: number; cents: number }
    | { kind: "extra"; qty: number; unitCents: number; cents: number; extraId: string; label: string; unit: "hour" | "piece" };
  export type ExtraPick = { id: string; qty: number };
  export const pricingRulesSchema: z.ZodType<PricingRules>;          // refinements below
  export function pricingRulesFor(minDurationMin: number): z.ZodType<PricingRules>; // adds the bands[0].fromMin ≤ min check
  export function slugify(label: string): string;                     // "ARRI 2 kW" → "arri-2-kw"
  export const extraPicksSchema: z.ZodType<ExtraPick[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/features/rentals/pricing-rules.test.ts
import { describe, it, expect } from "vitest";
import { pricingRulesFor, pricingRulesSchema, slugify, extraPicksSchema } from "./pricing-rules";

const ok = {
  bands: [{ fromMin: 60, perHourCents: 14000 }, { fromMin: 120, perHourCents: 12000 }],
  surcharges: [{ label: "Noc", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" }],
  people: { included: 5, extraCents: 1000, max: 10 },
  extras: [{ id: "arri-2-kw", label: "ARRI 2 kW", unit: "hour", priceCents: 5000, maxQty: 2 }],
};

describe("pricingRulesSchema", () => {
  it("accepts the reference rules", () => {
    expect(pricingRulesSchema.safeParse(ok).success).toBe(true);
  });
  it("accepts an empty ruleset apart from one band", () => {
    expect(pricingRulesSchema.safeParse({ bands: [{ fromMin: 30, totalCents: 5000 }], surcharges: [], extras: [] }).success).toBe(true);
  });
  const bad = (patch: Record<string, unknown>, path: string) => {
    const r = pricingRulesSchema.safeParse({ ...ok, ...patch });
    expect(r.success, path).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join(".")).some((p) => p.startsWith(path)), path).toBe(true);
  };
  it("needs at least one band and at most eight", () => {
    bad({ bands: [] }, "bands");
    bad({ bands: Array.from({ length: 9 }, (_, i) => ({ fromMin: 60 + i * 30, perHourCents: 100 })) }, "bands");
  });
  it("bands ascend by fromMin without repeats", () => {
    bad({ bands: [{ fromMin: 120, perHourCents: 1 }, { fromMin: 60, perHourCents: 1 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 1 }, { fromMin: 60, totalCents: 1 }] }, "bands");
  });
  it("a band carries exactly one of perHourCents / totalCents", () => {
    bad({ bands: [{ fromMin: 60 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 1, totalCents: 1 }] }, "bands");
  });
  it("surcharge pct 1–200, days a non-empty subset of 0–6, from ≠ to", () => {
    bad({ surcharges: [{ ...ok.surcharges[0], pct: 0 }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], pct: 201 }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], days: [] }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], days: [7] }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], from: "22:00", to: "22:00" }] }, "surcharges");
    bad({ surcharges: [{ ...ok.surcharges[0], from: "22" }] }, "surcharges");
  });
  it("people: max ≥ included, max ≤ 500", () => {
    bad({ people: { included: 6, extraCents: 100, max: 5 } }, "people");
    bad({ people: { included: 0, extraCents: 100, max: 501 } }, "people");
  });
  it("extras: unique slug ids, unit hour|piece, maxQty 1–99, label ≤ 60", () => {
    bad({ extras: [ok.extras[0], { ...ok.extras[0] }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], id: "ARRI" }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], unit: "day" }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], maxQty: 0 }] }, "extras");
    bad({ extras: [{ ...ok.extras[0], label: "x".repeat(61) }] }, "extras");
  });
  it("pricingRulesFor(min) refuses a first band above the minimum duration", () => {
    expect(pricingRulesFor(60).safeParse(ok).success).toBe(true);
    expect(pricingRulesFor(30).safeParse(ok).success).toBe(false);
  });
  it("cents are integers within 0–100 000 000", () => {
    bad({ bands: [{ fromMin: 60, perHourCents: 1.5 }] }, "bands");
    bad({ bands: [{ fromMin: 60, perHourCents: 100_000_001 }] }, "bands");
  });
});

describe("slugify", () => {
  it("lowercases, strips diacritics and punctuation, joins with dashes, caps at 32", () => {
    expect(slugify("ARRI 2 kW")).toBe("arri-2-kw");
    expect(slugify("Tło kartonowe (biały)")).toBe("tlo-kartonowe-bialy");
    expect(slugify("x".repeat(40))).toHaveLength(32);
    expect(slugify("   ")).toBe("");
  });
});

describe("extraPicksSchema", () => {
  it("accepts picks and refuses duplicates, zero qty, bad ids", () => {
    expect(extraPicksSchema.safeParse([{ id: "arri-2-kw", qty: 1 }]).success).toBe(true);
    expect(extraPicksSchema.safeParse([{ id: "a", qty: 1 }, { id: "a", qty: 1 }]).success).toBe(false);
    expect(extraPicksSchema.safeParse([{ id: "a", qty: 0 }]).success).toBe(false);
    expect(extraPicksSchema.safeParse([{ id: "A!", qty: 1 }]).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/rentals/pricing-rules.test.ts`
Expected: FAIL — `Cannot find module './pricing-rules'`

- [ ] **Step 3: Write the implementation**

```ts
// src/features/rentals/pricing-rules.ts
// S1 pricing rules (spec 2026-09-07-s1-pricing-rules-design.md): the JSON
// that lives in rental_offerings.pricing, the zod that guards every write,
// and the Line shape the quote produces. Pure — imported by the SQL-mirror
// (pricing.ts), the actions, the form and the widget alike.
import { z } from "zod";
import { TIME_RE } from "@/features/scheduling/schema";

const CENTS_MAX = 100_000_000;
const cents = z.number().int().min(0).max(CENTS_MAX);
export const EXTRA_ID_RE = /^[a-z0-9-]{1,32}$/;

export type Band = { fromMin: number; perHourCents?: number; totalCents?: number };
export type Surcharge = { label: string; pct: number; days: number[]; from: string; to: string };
export type People = { included: number; extraCents: number; max: number };
export type Extra = { id: string; label: string; unit: "hour" | "piece"; priceCents: number; maxQty: number };
export type PricingRules = { bands: Band[]; surcharges: Surcharge[]; people?: People; extras: Extra[] };

export type Line =
  | { kind: "base"; qty: number; unitCents: number | null; cents: number }
  | { kind: "surcharge"; qty: number; unitCents: null; cents: number; label: string; pct: number }
  | { kind: "people"; qty: number; unitCents: number; cents: number }
  | { kind: "extra"; qty: number; unitCents: number; cents: number; extraId: string; label: string; unit: "hour" | "piece" };

export type ExtraPick = { id: string; qty: number };

const band = z
  .object({ fromMin: z.number().int().min(5).max(1440), perHourCents: cents.optional(), totalCents: cents.optional() })
  .strict()
  .refine((b) => (b.perHourCents === undefined) !== (b.totalCents === undefined), {
    message: "a band carries exactly one of perHourCents / totalCents",
  });

const surcharge = z
  .object({
    label: z.string().trim().min(1).max(60),
    pct: z.number().int().min(1).max(200),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: z.string().regex(TIME_RE),
    to: z.string().regex(TIME_RE),
  })
  .strict()
  .refine((s) => new Set(s.days).size === s.days.length, { message: "days repeat", path: ["days"] })
  .refine((s) => s.from !== s.to, { message: "from and to must differ", path: ["to"] });

const people = z
  .object({ included: z.number().int().min(0).max(500), extraCents: cents, max: z.number().int().min(0).max(500) })
  .strict()
  .refine((p) => p.max >= p.included, { message: "max must be ≥ included", path: ["max"] });

const extra = z
  .object({
    id: z.string().regex(EXTRA_ID_RE),
    label: z.string().trim().min(1).max(60),
    unit: z.enum(["hour", "piece"]),
    priceCents: cents,
    maxQty: z.number().int().min(1).max(99),
  })
  .strict();

export const pricingRulesSchema: z.ZodType<PricingRules> = z
  .object({
    bands: z.array(band).min(1).max(8),
    surcharges: z.array(surcharge).max(4),
    people: people.optional(),
    extras: z.array(extra).max(12),
  })
  .strict()
  .refine((r) => r.bands.every((b, i) => i === 0 || b.fromMin > r.bands[i - 1].fromMin), {
    message: "bands must ascend by fromMin without repeats",
    path: ["bands"],
  })
  .refine((r) => new Set(r.extras.map((e) => e.id)).size === r.extras.length, {
    message: "extra ids repeat",
    path: ["extras"],
  });

/** The offering-aware schema: the first band must cover the shortest
    bookable duration, or a legal booking would have no price. */
export function pricingRulesFor(minDurationMin: number): z.ZodType<PricingRules> {
  return pricingRulesSchema.refine((r) => r.bands[0].fromMin <= minDurationMin, {
    message: "the first band must start at or below the minimum duration",
    path: ["bands", 0, "fromMin"],
  });
}

export const extraPicksSchema: z.ZodType<ExtraPick[]> = z
  .array(z.object({ id: z.string().regex(EXTRA_ID_RE), qty: z.number().int().min(1).max(99) }).strict())
  .max(12)
  .refine((p) => new Set(p.map((x) => x.id)).size === p.length, { message: "extra ids repeat" });

/** Label → id. Never shown; stable across renames only if the studio keeps
    the id (the editor generates it once and keeps it). */
export function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l").replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/rentals/pricing-rules.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/features/rentals/pricing-rules.ts src/features/rentals/pricing-rules.test.ts
git commit -m "feat(rentals): pricing rules type and zod schema (S1)"
```

---

### Task 2: The shared fixture and the TypeScript quote

**Files:**
- Create: `src/features/rentals/pricing-fixture.ts`
- Modify: `src/features/rentals/pricing.ts`
- Test: `src/features/rentals/pricing.test.ts`

**Interfaces:**
- Consumes: `PricingRules`, `Line`, `ExtraPick` from Task 1.
- Produces:
  ```ts
  // pricing.ts
  export type QuoteOffering = { pricing: PricingRules | null; priceCents: number | null; pricingMode: PricingMode };
  export function quoteHours(o: QuoteOffering, startsAt: Date, durationMin: number, people: number | null, extras: ExtraPick[], timeZone: string): Line[];
  // throws Error("quote_band" | "quote_people" | "quote_extra") — the same three sentinels the SQL raises
  export function sumLines(lines: Line[]): number;
  export function headlinePrice(o: QuoteOffering & { rangeMode: RangeMode }, currency: string, t: UnitsT): string | null;
  export function formatLine(l: Line, currency: string, t: UnitsT): string;
  // moneyInfoLines gains `lines?: Line[] | null` on its input; when present and non-empty it emits one formatted line per item BEFORE the total.
  // pricing-fixture.ts
  export const FIXTURE_RULES: PricingRules;
  export const FIXTURE_CASES: { name: string; startsLocal: string /* "YYYY-MM-DDTHH:MM" in Europe/Warsaw, relative dates resolved by the test */; durationMin: number; people: number | null; extras: ExtraPick[]; expect: Line[] | "quote_band" | "quote_people" | "quote_extra" }[];
  ```

- [ ] **Step 1: Write the fixture**

Dates are Warsaw wall-clock on a fixed week in the future so weekdays are known: use `2027-03-01` (a Monday) as `MON`, `2027-03-06` (Saturday) `SAT`, `2027-03-07` (Sunday) `SUN`. No DST change in that week.

```ts
// src/features/rentals/pricing-fixture.ts
// The one fixture the TS quote (pricing.test.ts) and the SQL quote
// (pricing-quote.integration.test.ts) both run — the lockstep contract.
import type { ExtraPick, Line, PricingRules } from "./pricing-rules";

export const FIXTURE_TZ = "Europe/Warsaw";
export const MON = "2027-03-01";
export const SAT = "2027-03-06";
export const SUN = "2027-03-07";

export const FIXTURE_RULES: PricingRules = {
  bands: [
    { fromMin: 60, perHourCents: 14000 },
    { fromMin: 90, totalCents: 19500 },
    { fromMin: 120, perHourCents: 12000 },
  ],
  surcharges: [
    { label: "Noc", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" },
    { label: "Niedziela", pct: 10, days: [0], from: "08:00", to: "22:00" },
  ],
  people: { included: 5, extraCents: 1000, max: 10 },
  extras: [
    { id: "arri", label: "ARRI 2 kW", unit: "hour", priceCents: 5000, maxQty: 2 },
    { id: "tlo", label: "Tło kartonowe", unit: "piece", priceCents: 1500, maxQty: 10 },
  ],
};

const base = (qty: number, unitCents: number | null, cents: number): Line => ({ kind: "base", qty, unitCents, cents });

export const FIXTURE_CASES: {
  name: string; startsLocal: string; durationMin: number; people: number | null; extras: ExtraPick[];
  expect: Line[] | "quote_band" | "quote_people" | "quote_extra";
}[] = [
  { name: "60 min Monday noon: first band", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [],
    expect: [base(1, 14000, 14000)] },
  { name: "90 min: fixed-total band", startsLocal: `${MON}T12:00`, durationMin: 90, people: null, extras: [],
    expect: [base(1.5, null, 19500)] },
  { name: "120 min: third band applies to the whole booking", startsLocal: `${MON}T12:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000)] },
  { name: "150 min: still the third band (last with fromMin ≤ duration)", startsLocal: `${MON}T12:00`, durationMin: 150, people: null, extras: [],
    expect: [base(2.5, 12000, 30000)] },
  { name: "30 min: below the first band", startsLocal: `${MON}T12:00`, durationMin: 30, people: null, extras: [], expect: "quote_band" },
  { name: "21:00–23:00 Monday: 60 of 120 min in the night window", startsLocal: `${MON}T21:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000), { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 }] },
  { name: "23:00 Sat → 01:00 Sun: whole booking in a window that crosses midnight", startsLocal: `${SAT}T23:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000), { kind: "surcharge", qty: 120, unitCents: null, cents: 6000, label: "Noc", pct: 25 }] },
  { name: "Sunday 10:00: the Sunday-only window, not the night one", startsLocal: `${SUN}T10:00`, durationMin: 60, people: null, extras: [],
    expect: [base(1, 14000, 14000), { kind: "surcharge", qty: 60, unitCents: null, cents: 1400, label: "Niedziela", pct: 10 }] },
  { name: "Sunday 21:00–23:00: both windows overlap, two lines", startsLocal: `${SUN}T21:00`, durationMin: 120, people: null, extras: [],
    expect: [base(2, 12000, 24000),
      { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 },
      { kind: "surcharge", qty: 60, unitCents: null, cents: 1200, label: "Niedziela", pct: 10 }] },
  { name: "people at the included count: no line", startsLocal: `${MON}T12:00`, durationMin: 60, people: 5, extras: [],
    expect: [base(1, 14000, 14000)] },
  { name: "people above included", startsLocal: `${MON}T12:00`, durationMin: 60, people: 7, extras: [],
    expect: [base(1, 14000, 14000), { kind: "people", qty: 2, unitCents: 1000, cents: 2000 }] },
  { name: "people above max", startsLocal: `${MON}T12:00`, durationMin: 60, people: 11, extras: [], expect: "quote_people" },
  { name: "extra per hour × 2 over 90 min (fixed-total band)", startsLocal: `${MON}T12:00`, durationMin: 90, people: null, extras: [{ id: "arri", qty: 2 }],
    expect: [base(1.5, null, 19500), { kind: "extra", qty: 2, unitCents: 5000, cents: 15000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" }] },
  { name: "extra per piece × 3", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "tlo", qty: 3 }],
    expect: [base(1, 14000, 14000), { kind: "extra", qty: 3, unitCents: 1500, cents: 4500, extraId: "tlo", label: "Tło kartonowe", unit: "piece" }] },
  { name: "extra over maxQty", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "arri", qty: 3 }], expect: "quote_extra" },
  { name: "unknown extra", startsLocal: `${MON}T12:00`, durationMin: 60, people: null, extras: [{ id: "fog", qty: 1 }], expect: "quote_extra" },
  { name: "everything at once, Sunday night", startsLocal: `${SUN}T21:00`, durationMin: 120, people: 8, extras: [{ id: "arri", qty: 1 }, { id: "tlo", qty: 2 }],
    expect: [base(2, 12000, 24000),
      { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 },
      { kind: "surcharge", qty: 60, unitCents: null, cents: 1200, label: "Niedziela", pct: 10 },
      { kind: "people", qty: 3, unitCents: 1000, cents: 3000 },
      { kind: "extra", qty: 1, unitCents: 5000, cents: 10000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" },
      { kind: "extra", qty: 2, unitCents: 1500, cents: 3000, extraId: "tlo", label: "Tło kartonowe", unit: "piece" }] },
];

/** NULL-pricing fallback cases: the H3 flat rate, unchanged. */
export const FALLBACK_CASES = [
  { name: "per_unit 120 zł/h × 90 min", priceCents: 12000, pricingMode: "per_unit" as const, durationMin: 90, expect: [base(1.5, 12000, 18000)] },
  { name: "flat 300 zł regardless of length", priceCents: 30000, pricingMode: "flat" as const, durationMin: 90, expect: [base(1.5, null, 30000)] },
  { name: "unpriced: no lines", priceCents: null, pricingMode: "per_unit" as const, durationMin: 90, expect: [] as Line[] },
];
```

- [ ] **Step 2: Write the failing unit test**

```ts
// src/features/rentals/pricing.test.ts
import { describe, it, expect } from "vitest";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { enTranslator } from "@/i18n/test-translator";
import { quoteHours, sumLines, formatLine, headlinePrice, moneyInfoLines } from "./pricing";
import { FIXTURE_CASES, FIXTURE_RULES, FIXTURE_TZ, FALLBACK_CASES } from "./pricing-fixture";

const tu = enTranslator("public.units");
const at = (local: string) => {
  const [date, time] = local.split("T");
  return wallTimeToUtc(date, time, FIXTURE_TZ);
};
const offering = { pricing: FIXTURE_RULES, priceCents: null, pricingMode: "per_unit" as const };

describe("quoteHours (TS mirror of rental_quote_hours)", () => {
  for (const c of FIXTURE_CASES) {
    it(c.name, () => {
      if (typeof c.expect === "string") {
        expect(() => quoteHours(offering, at(c.startsLocal), c.durationMin, c.people, c.extras, FIXTURE_TZ)).toThrow(c.expect);
      } else {
        expect(quoteHours(offering, at(c.startsLocal), c.durationMin, c.people, c.extras, FIXTURE_TZ)).toEqual(c.expect);
      }
    });
  }
  for (const c of FALLBACK_CASES) {
    it(`pricing NULL — ${c.name}`, () => {
      const o = { pricing: null, priceCents: c.priceCents, pricingMode: c.pricingMode };
      expect(quoteHours(o, at("2027-03-01T12:00"), c.durationMin, null, [], FIXTURE_TZ)).toEqual(c.expect);
    });
  }
  it("people is ignored when the offering has no people rule", () => {
    const o = { pricing: { ...FIXTURE_RULES, people: undefined }, priceCents: null, pricingMode: "per_unit" as const };
    expect(quoteHours(o, at("2027-03-01T12:00"), 60, 50, [], FIXTURE_TZ)).toEqual([{ kind: "base", qty: 1, unitCents: 14000, cents: 14000 }]);
  });
  it("sumLines adds cents", () => {
    expect(sumLines([{ kind: "base", qty: 1, unitCents: 1, cents: 100 }, { kind: "people", qty: 1, unitCents: 5, cents: 5 }])).toBe(105);
    expect(sumLines([])).toBe(0);
  });
});

describe("formatting", () => {
  it("formatLine renders each kind in the viewer's words with the studio's label", () => {
    expect(formatLine({ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, "PLN", tu)).toBe("2 hours × 120,00 zł");
    expect(formatLine({ kind: "base", qty: 1.5, unitCents: null, cents: 19500 }, "PLN", tu)).toBe("1 h 30 min");
    expect(formatLine({ kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 }, "PLN", tu)).toBe("Noc +25%");
    expect(formatLine({ kind: "people", qty: 2, unitCents: 1000, cents: 2000 }, "PLN", tu)).toBe("2 extra people × 10,00 zł");
    expect(formatLine({ kind: "extra", qty: 2, unitCents: 5000, cents: 15000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" }, "PLN", tu)).toBe("ARRI 2 kW × 2");
  });
  it("headlinePrice shows the lowest hourly band with 'from' when rules are set", () => {
    expect(headlinePrice({ ...offering, rangeMode: "hours" }, "PLN", tu)).toBe("from 120,00 zł / hour");
    const totalsOnly = { pricing: { bands: [{ fromMin: 60, totalCents: 19700 }], surcharges: [], extras: [] }, priceCents: null, pricingMode: "per_unit" as const, rangeMode: "hours" as const };
    expect(headlinePrice(totalsOnly, "PLN", tu)).toBe("197,00 zł / 1 hour");
    expect(headlinePrice({ pricing: null, priceCents: 12000, pricingMode: "per_unit", rangeMode: "hours" }, "PLN", tu)).toBe("120,00 zł / hour");
  });
  it("moneyInfoLines prints the lines before the total", () => {
    const lines = moneyInfoLines(
      { totalCents: 26000, depositCents: null, currency: "PLN", cancelWindowMin: 0,
        lines: [{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, { kind: "people", qty: 2, unitCents: 1000, cents: 2000 }] },
      tu,
    );
    expect(lines).toEqual(["2 hours × 120,00 zł — 240,00 zł", "2 extra people × 10,00 zł — 20,00 zł", "Total: 260,00 zł", "Payment: pay at the venue"]);
  });
});
```

Check how `formatMoney(12000, "PLN")` renders in this repo before relying on `"120,00 zł"`: run `node -e "import('./src/lib/money.ts')"` is not possible under Vitest's tsconfig paths, so instead run the test once and correct the four expected money strings to whatever `formatMoney` produces (the assertion is about shape, not the locale's thousands separator).

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/features/rentals/pricing.test.ts`
Expected: FAIL — `quoteHours is not a function` (and friends)

- [ ] **Step 4: Implement in `pricing.ts`**

Add these imports at the top of `src/features/rentals/pricing.ts`:

```ts
import { dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";
import type { ExtraPick, Line, PricingRules } from "./pricing-rules";
```

Append after `stayHint`:

```ts
// ---------- S1: the quote (mirror of public.rental_quote_hours, 0078).
// Every rule here has a line-for-line twin in the SQL; the lockstep test
// (pricing-quote.integration.test.ts) fails if they drift.

export type QuoteOffering = { pricing: PricingRules | null; priceCents: number | null; pricingMode: PricingMode };

const MIN = 60_000;

function minutesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const s = Math.max(aStart, bStart);
  const e = Math.min(aEnd, bEnd);
  return e > s ? Math.round((e - s) / MIN) : 0;
}

export function quoteHours(
  o: QuoteOffering,
  startsAt: Date,
  durationMin: number,
  people: number | null,
  extras: ExtraPick[],
  timeZone: string,
): Line[] {
  const lines: Line[] = [];
  const hours = durationMin / 60;
  // 1. Base.
  if (o.pricing === null) {
    const total = totalCents(o, hours);
    if (total === null) return [];
    return [{ kind: "base", qty: hours, unitCents: o.pricingMode === "flat" ? null : o.priceCents, cents: total }];
  }
  const band = [...o.pricing.bands].reverse().find((b) => b.fromMin <= durationMin);
  if (!band) throw new Error("quote_band");
  const baseCents = band.totalCents !== undefined ? band.totalCents : Math.round(band.perHourCents! * hours);
  lines.push({ kind: "base", qty: hours, unitCents: band.totalCents !== undefined ? null : band.perHourCents!, cents: baseCents });
  // 2. Surcharges — pro-rata by overlapping minutes, on the base only.
  const start = startsAt.getTime();
  const end = start + durationMin * MIN;
  const firstDay = dateInZone(new Date(start - 24 * 60 * MIN), timeZone);
  const lastDay = dateInZone(new Date(end), timeZone);
  for (const s of o.pricing.surcharges) {
    let overlap = 0;
    for (let d = firstDay; d <= lastDay; d = nextDay(d)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (!s.days.includes(dow)) continue;
      const wStart = wallTimeToUtc(d, s.from, timeZone).getTime();
      const wEnd = wallTimeToUtc(s.to < s.from ? nextDay(d) : d, s.to, timeZone).getTime();
      overlap += minutesOverlap(start, end, wStart, wEnd);
    }
    if (overlap === 0) continue;
    lines.push({ kind: "surcharge", qty: overlap, unitCents: null, cents: Math.round((baseCents * s.pct) / 100 * overlap / durationMin), label: s.label, pct: s.pct });
  }
  // 3. People.
  if (o.pricing.people) {
    const p = o.pricing.people;
    const n = people ?? p.included;
    if (n > p.max) throw new Error("quote_people");
    const qty = Math.max(0, n - p.included);
    if (qty > 0) lines.push({ kind: "people", qty, unitCents: p.extraCents, cents: qty * p.extraCents });
  }
  // 4. Extras.
  const seen = new Set<string>();
  for (const pick of extras) {
    const def = o.pricing.extras.find((e) => e.id === pick.id);
    if (!def || seen.has(pick.id) || pick.qty < 1 || pick.qty > def.maxQty) throw new Error("quote_extra");
    seen.add(pick.id);
    const cents = def.unit === "hour" ? Math.round(def.priceCents * pick.qty * hours) : def.priceCents * pick.qty;
    lines.push({ kind: "extra", qty: pick.qty, unitCents: def.priceCents, cents, extraId: def.id, label: def.label, unit: def.unit });
  }
  return lines;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function sumLines(lines: Line[]): number {
  return lines.reduce((acc, l) => acc + l.cents, 0);
}

/** One line of the breakdown in the viewer's language; the studio's own
    label where a line has one. The amount is appended by moneyInfoLines. */
export function formatLine(l: Line, currency: string, t: UnitsT): string {
  switch (l.kind) {
    case "base":
      return l.unitCents === null
        ? formatDurationLabel(Math.round(l.qty * 60), t)
        : t("line.base", { hours: formatDurationLabel(Math.round(l.qty * 60), t), rate: formatMoney(l.unitCents, currency) });
    case "surcharge":
      return t("line.surcharge", { label: l.label, pct: l.pct });
    case "people":
      return t("line.people", { count: l.qty, each: formatMoney(l.unitCents, currency) });
    case "extra":
      return t("line.extra", { label: l.label, qty: l.qty });
  }
}

/** The card/list/header price. Rules → the cheapest hourly band, prefixed
    "from"; totals-only rules → the first band's total for its hours; no
    rules → the H3 label. */
export function headlinePrice(
  o: QuoteOffering & { rangeMode: RangeMode },
  currency: string,
  t: UnitsT,
): string | null {
  if (o.rangeMode !== "hours" || o.pricing === null) return formatOfferingPrice(o, currency, t);
  const hourly = o.pricing.bands.filter((b) => b.perHourCents !== undefined).map((b) => b.perHourCents!);
  if (hourly.length > 0) return t("fromPerHour", { amount: formatMoney(Math.min(...hourly), currency) });
  const first = o.pricing.bands[0];
  return t("totalFor", { amount: formatMoney(first.totalCents!, currency), length: formatDurationLabel(first.fromMin, t) });
}
```

Then change `moneyInfoLines` so its input accepts `lines?: Line[] | null` and the breakdown prints first:

```ts
export function moneyInfoLines(
  i: { totalCents: number | null; depositCents: number | null; currency: string | null; cancelWindowMin: number; lines?: Line[] | null },
  t: UnitsT,
): string[] {
  const lines: string[] = [];
  if (i.lines && i.lines.length > 0 && i.currency) {
    for (const l of i.lines) lines.push(`${formatLine(l, i.currency, t)} — ${formatMoney(l.cents, i.currency)}`);
  }
  if (i.totalCents !== null && i.currency) lines.push(t("total", { amount: formatMoney(i.totalCents, i.currency) }));
  if (i.depositCents !== null && i.currency) lines.push(t("depositDue", { amount: formatMoney(i.depositCents, i.currency) }));
  if (lines.length > 0) lines.push(t("payAtVenue"));
  if (i.cancelWindowMin > 0) lines.push(t("freeCancellation", { window: formatCancelWindow(i.cancelWindowMin, t) }));
  return lines;
}
```

Note `booking-money-summary.tsx` relies on "the total is first" (`i === 0 && total !== null` bolds it); Task 9 fixes that.

- [ ] **Step 5: Add the i18n keys the formatter uses** — in `messages/en.json` under `public.units` (and the uk/pl twins in Task 10; for now add English only and run only this test file):

```json
"fromPerHour": "from {amount} / hour",
"totalFor": "{amount} / {length}",
"line": {
  "base": "{hours} × {rate}",
  "surcharge": "{label} +{pct}%",
  "people": "{count, plural, one {# extra person} other {# extra people}} × {each}",
  "extra": "{label} × {qty}"
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/features/rentals/pricing.test.ts src/features/rentals/hourly.test.ts`
Expected: PASS. (Fix the four money-string expectations to `formatMoney`'s actual output if they differ only in separators.)

- [ ] **Step 7: Commit**

```bash
git add src/features/rentals/pricing.ts src/features/rentals/pricing.test.ts src/features/rentals/pricing-fixture.ts messages/en.json
git commit -m "feat(rentals): quoteHours — the TypeScript quote and its fixture (S1)"
```

---

### Task 3: Migration 0078 — columns, `rental_quote_hours`, RPC bodies

**Files:**
- Create: `src/db/migrations/0078_pricing_rules.sql`
- Create: `src/db/migrations/meta/0078_snapshot.json` (copy of `0077_snapshot.json` with the three columns added)
- Modify: `src/db/migrations/meta/_journal.json` (append idx 78, tag `0078_pricing_rules`, `when` = now in ms)
- Modify: `src/db/schema/rentals.ts` (add `pricing: jsonb("pricing")`), `src/db/schema/scheduling.ts` (add `lines: jsonb("lines")`, `people: integer("people")` after `depositCents`)
- Test: `src/features/rentals/pricing-quote.integration.test.ts`

**Interfaces:**
- Produces (SQL):
  - `public.rental_quote_hours(p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb) returns jsonb` — revoked from all roles.
  - `create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb)` — two new trailing params `p_people`, `p_extras`; old 9-arg signature dropped.
  - `create_rental_booking_hours_admin` unchanged signature; quotes with `null`, `'[]'`.
  - `reschedule_rental_hours_apply` unchanged signature; re-quotes from the old row's `people` and `extra` lines.
  - `resolve_booking_token` returns two more columns: `lines jsonb, people int`.
- The three sentinels: `raise exception 'quote_band'`, `'quote_people'`, `'quote_extra'` (single lowercase token idiom of `isRpcSentinel`).

- [ ] **Step 1: Write the failing integration test**

```ts
// src/features/rentals/pricing-quote.integration.test.ts
/**
 * S1 lockstep contract: public.rental_quote_hours (0078) and quoteHours
 * (pricing.ts) produce identical lines for every fixture case; the hourly
 * RPCs snapshot lines/people/price_cents; reschedule re-quotes at the new
 * time; refusals surface as sentinels; resolve_booking_token returns the
 * lines. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { quoteHours, sumLines } from "./pricing";
import { FIXTURE_CASES, FIXTURE_RULES, FIXTURE_TZ, FALLBACK_CASES, MON, SUN } from "./pricing-fixture";

try { loadEnvFile(".env.local"); } catch { /* CI exports env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const at = (local: string) => { const [d, t] = local.split("T"); return wallTimeToUtc(d, t, FIXTURE_TZ).toISOString(); };
const hash = () => generateAccessToken().tokenHash;
type Row = Record<string, unknown>;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

async function newOrg(tag: string) {
  const client = await signedInUser(tag);
  const { data: org, error: e1 } = await client.rpc("create_org", { p_name: `S1 ${tag}`, p_offers_appointments: false, p_offers_rentals: true });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s1-${tag.replace(/_/g, "-")}-${Date.now()}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", { p_org_id: orgId, p_handle: handle, p_timezone: FIXTURE_TZ, p_currency: "PLN" });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours offering 30/60–240, one unit, open every day 00:00–24:00 so the
    fixture's night bookings are inside availability; booking window 2 years
    so 2027-03 is bookable. */
async function hoursFixture(client: SupabaseClient, orgId: string, over: Record<string, unknown> = {}) {
  const { data: off, error: e1 } = await client.from("rental_offerings").insert({
    org_id: orgId, name: "Studio", range_mode: "hours", slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
    turnover_min: 0, min_notice_min: 0, booking_window_days: 730, unit_selection: "auto", active: true,
    pricing: FIXTURE_RULES, ...over,
  }).select("id").single();
  if (e1) throw e1;
  const { data: unit, error: e2 } = await client.from("rental_units").insert({ org_id: orgId, offering_id: off.id, name: "Studio", active: true }).select("id").single();
  if (e2) throw e2;
  const rules = Array.from({ length: 7 }, (_, dow) => ({ org_id: orgId, rental_offering_id: off.id, day_of_week: dow, start_time: "00:00", end_time: "24:00" }));
  const { error: e3 } = await client.from("availability_rules").insert(rules);
  if (e3) throw e3;
  return { offeringId: off.id as string, unitId: unit.id as string };
}

const bookingRow = async (id: string): Promise<Row> => {
  const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Row;
};

describe("rental_quote_hours ≡ quoteHours", () => {
  let offeringId: string;
  beforeAll(async () => {
    const { client, orgId } = await newOrg("lockstep");
    ({ offeringId } = await hoursFixture(client, orgId));
  });

  for (const c of FIXTURE_CASES) {
    it(c.name, async () => {
      const { data, error } = await admin.rpc("rental_quote_hours_test", {
        p_offering_id: offeringId, p_starts_at: at(c.startsLocal), p_duration_min: c.durationMin, p_people: c.people, p_extras: c.extras,
      });
      if (typeof c.expect === "string") {
        expect(error?.message).toContain(c.expect);
      } else {
        expect(error).toBeNull();
        expect(data).toEqual(c.expect);
        expect(data).toEqual(quoteHours({ pricing: FIXTURE_RULES, priceCents: null, pricingMode: "per_unit" }, new Date(at(c.startsLocal)), c.durationMin, c.people, c.extras, FIXTURE_TZ));
      }
    });
  }

  for (const c of FALLBACK_CASES) {
    it(`pricing NULL — ${c.name}`, async () => {
      const { client, orgId } = await newOrg("fallback");
      const { offeringId: id } = await hoursFixture(client, orgId, { pricing: null, price_cents: c.priceCents, pricing_mode: c.pricingMode });
      const { data, error } = await admin.rpc("rental_quote_hours_test", { p_offering_id: id, p_starts_at: at(`${MON}T12:00`), p_duration_min: c.durationMin, p_people: null, p_extras: [] });
      expect(error).toBeNull();
      expect(data).toEqual(c.expect);
    });
  }
});

describe("hourly RPCs snapshot the quote", () => {
  it("public create writes lines, people, price_cents = sum, deposit from the total", async () => {
    const { client, orgId, handle } = await newOrg("snap");
    const { offeringId } = await hoursFixture(client, orgId, { deposit_type: "percent", deposit_value: 50 });
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle, p_offering_id: offeringId, p_unit_id: null, p_starts_at: at(`${SUN}T21:00`), p_duration_min: 120,
      p_name: "Ola", p_email: `ola-${Date.now()}@example.com`, p_note: null, p_token_hash: hash(), p_people: 8, p_extras: [{ id: "arri", qty: 1 }, { id: "tlo", qty: 2 }],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    const expected = FIXTURE_CASES.find((c) => c.name.startsWith("everything at once"))!.expect;
    expect(row.lines).toEqual(expected);
    expect(row.people).toBe(8);
    expect(row.price_cents).toBe(sumLines(expected as never)); // 44200
    expect(row.deposit_cents).toBe(22100);
    expect(row.currency).toBe("PLN");
  });

  it("public create refuses people over max and unknown extras with sentinels", async () => {
    const { client, orgId, handle } = await newOrg("refuse");
    const { offeringId } = await hoursFixture(client, orgId);
    const base = { p_handle: handle, p_offering_id: offeringId, p_unit_id: null, p_starts_at: at(`${MON}T12:00`), p_duration_min: 60, p_name: "A", p_email: `a-${Date.now()}@example.com`, p_note: null };
    const r1 = await admin.rpc("create_rental_booking_hours", { ...base, p_token_hash: hash(), p_people: 11, p_extras: [] });
    expect(r1.error?.message).toContain("quote_people");
    const r2 = await admin.rpc("create_rental_booking_hours", { ...base, p_token_hash: hash(), p_people: null, p_extras: [{ id: "fog", qty: 1 }] });
    expect(r2.error?.message).toContain("quote_extra");
  });

  it("admin create quotes base + surcharges with no people/extras", async () => {
    const { client, orgId } = await newOrg("adm");
    const { offeringId } = await hoursFixture(client, orgId);
    const { data, error } = await client.rpc("create_rental_booking_hours_admin", {
      p_offering_id: offeringId, p_unit_id: null, p_starts_at: at(`${MON}T21:00`), p_duration_min: 120, p_name: "Walk-in", p_email: null, p_note: null, p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.lines).toEqual([{ kind: "base", qty: 2, unitCents: 12000, cents: 24000 }, { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 }]);
    expect(row.people).toBeNull();
    expect(row.price_cents).toBe(27000);
  });

  it("reschedule re-quotes at the new time with the same people and extras (Sunday night → Monday noon drops both surcharges)", async () => {
    const { client, orgId, handle } = await newOrg("resched");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle, p_offering_id: offeringId, p_unit_id: null, p_starts_at: at(`${SUN}T21:00`), p_duration_min: 120,
      p_name: "Ola", p_email: `ola2-${Date.now()}@example.com`, p_note: null, p_token_hash: tokenHash, p_people: 8, p_extras: [{ id: "arri", qty: 1 }],
    });
    expect(created.error).toBeNull();
    const { data: moved, error } = await admin.rpc("reschedule_rental_booking_hours", { p_token: token, p_unit_id: null, p_starts_at: at(`${MON}T12:00`), p_new_token_hash: hash() });
    expect(error).toBeNull();
    const row = await bookingRow((moved as Row[])[0].new_booking_id as string);
    expect(row.lines).toEqual([
      { kind: "base", qty: 2, unitCents: 12000, cents: 24000 },
      { kind: "people", qty: 3, unitCents: 1000, cents: 3000 },
      { kind: "extra", qty: 1, unitCents: 5000, cents: 10000, extraId: "arri", label: "ARRI 2 kW", unit: "hour" },
    ]);
    expect(row.people).toBe(8);
    expect(row.price_cents).toBe(37000);
    const old = await bookingRow(created.data as string);
    expect(old.price_cents).toBe(41200); // 24000+3000+1200+3000+10000 — the old snapshot is untouched
  });

  it("resolve_booking_token returns lines and people", async () => {
    const { client, orgId, handle } = await newOrg("resolve");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle, p_offering_id: offeringId, p_unit_id: null, p_starts_at: at(`${MON}T12:00`), p_duration_min: 60,
      p_name: "R", p_email: `r-${Date.now()}@example.com`, p_note: null, p_token_hash: tokenHash, p_people: 6, p_extras: [],
    });
    expect(created.error).toBeNull();
    const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
    expect(error).toBeNull();
    const row = (data as Row[])[0];
    expect(row.lines).toEqual([{ kind: "base", qty: 1, unitCents: 14000, cents: 14000 }, { kind: "people", qty: 1, unitCents: 1000, cents: 1000 }]);
    expect(row.people).toBe(6);
  });

  it("the pricing CHECK refuses a non-object", async () => {
    const { client, orgId } = await newOrg("check");
    const { error } = await client.from("rental_offerings").insert({
      org_id: orgId, name: "Bad", range_mode: "hours", slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240, pricing: [1, 2],
    });
    expect(error?.code).toBe("23514");
  });
});
```

`rental_quote_hours_test` is a thin `security definer` wrapper granted to `service_role` only, created in the migration under a `-- test seam` comment, so the lockstep test can call the revoked function directly. It returns `public.rental_quote_hours(...)` verbatim.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/features/rentals/pricing-quote.integration.test.ts`
Expected: FAIL — `column "pricing" does not exist` / function not found.

- [ ] **Step 3: Write the migration**

Create `src/db/migrations/0078_pricing_rules.sql`. The RPC bodies below are the 0062 / 0058 / 0070 bodies with only the marked deltas; copy the rest verbatim from those files (Global Constraint: bodies are copied, never retyped from memory).

```sql
-- 0078 (S1 pricing rules, spec 2026-09-07-s1-pricing-rules-design.md):
-- rental_offerings.pricing holds an hourly space's rules; rental_quote_hours
-- turns rules + a request into line items; the four hourly RPCs snapshot
-- those lines on bookings.lines with price_cents = their sum. pricing NULL
-- keeps every pre-0078 path byte-for-byte.

-- ---------- columns
alter table public.rental_offerings
  add column pricing jsonb,
  add constraint rental_offerings_pricing_ck
    check (pricing is null or jsonb_typeof(pricing) = 'object');

alter table public.bookings
  add column lines jsonb,
  add column people int,
  add constraint bookings_lines_ck check (lines is null or jsonb_typeof(lines) = 'array'),
  add constraint bookings_people_ck check (people is null or people >= 0);

-- ---------- the quote. Mirrored line-for-line by pricing.ts quoteHours —
-- the lockstep test (pricing-quote.integration.test.ts) keeps them equal.
create function public.rental_quote_hours(
  p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_off record; v_tz text; v_rules jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_hours numeric := p_duration_min / 60.0;
  v_band jsonb; v_base int; v_unit int;
  v_s jsonb; v_overlap int; v_day date; v_first date; v_last date;
  v_from text; v_to text; v_wstart timestamptz; v_wend timestamptz; v_dow int;
  v_starts timestamptz := p_starts_at; v_ends timestamptz := p_starts_at + make_interval(mins => p_duration_min);
  v_people jsonb; v_n int; v_qty int;
  v_pick jsonb; v_def jsonb; v_seen text[] := '{}'; v_cents int;
begin
  select ro.pricing, ro.pricing_mode, ro.price_cents, o.timezone
    into v_off from public.rental_offerings ro join public.orgs o on o.id = ro.org_id
    where ro.id = p_offering_id;
  if v_off is null then raise exception 'not found'; end if;
  v_tz := v_off.timezone; v_rules := v_off.pricing;

  -- 1. Base.
  if v_rules is null then
    v_base := public.rental_total_cents(v_off.pricing_mode, v_off.price_cents, v_hours);
    if v_base is null then return '[]'::jsonb; end if;
    return jsonb_build_array(jsonb_build_object(
      'kind', 'base', 'qty', v_hours, 'cents', v_base,
      'unitCents', case when v_off.pricing_mode = 'flat' then null else v_off.price_cents end));
  end if;
  select b into v_band from jsonb_array_elements(v_rules->'bands') b
    where (b->>'fromMin')::int <= p_duration_min
    order by (b->>'fromMin')::int desc limit 1;
  if v_band is null then raise exception 'quote_band'; end if;
  if v_band ? 'totalCents' then
    v_base := (v_band->>'totalCents')::int; v_unit := null;
  else
    v_unit := (v_band->>'perHourCents')::int; v_base := round(v_unit * v_hours)::int;
  end if;
  v_lines := v_lines || jsonb_build_object('kind', 'base', 'qty', v_hours, 'unitCents', v_unit, 'cents', v_base);

  -- 2. Surcharges: minutes of overlap with each window, pro-rata on the base.
  v_first := ((v_starts - interval '1 day') at time zone v_tz)::date;
  v_last := (v_ends at time zone v_tz)::date;
  for v_s in select s from jsonb_array_elements(coalesce(v_rules->'surcharges', '[]'::jsonb)) s loop
    v_overlap := 0; v_from := v_s->>'from'; v_to := v_s->>'to';
    v_day := v_first;
    while v_day <= v_last loop
      v_dow := extract(dow from v_day)::int;
      if (v_s->'days') @> to_jsonb(v_dow) then
        v_wstart := (v_day::text || ' ' || v_from)::timestamp at time zone v_tz;
        v_wend := ((case when v_to < v_from then v_day + 1 else v_day end)::text || ' ' || v_to)::timestamp at time zone v_tz;
        if least(v_ends, v_wend) > greatest(v_starts, v_wstart) then
          v_overlap := v_overlap + round(extract(epoch from (least(v_ends, v_wend) - greatest(v_starts, v_wstart))) / 60)::int;
        end if;
      end if;
      v_day := v_day + 1;
    end loop;
    if v_overlap > 0 then
      v_lines := v_lines || jsonb_build_object(
        'kind', 'surcharge', 'qty', v_overlap, 'unitCents', null,
        'cents', round(v_base * (v_s->>'pct')::int / 100.0 * v_overlap / p_duration_min)::int,
        'label', v_s->>'label', 'pct', (v_s->>'pct')::int);
    end if;
  end loop;

  -- 3. People.
  v_people := v_rules->'people';
  if v_people is not null then
    v_n := coalesce(p_people, (v_people->>'included')::int);
    if v_n > (v_people->>'max')::int then raise exception 'quote_people'; end if;
    v_qty := greatest(0, v_n - (v_people->>'included')::int);
    if v_qty > 0 then
      v_lines := v_lines || jsonb_build_object('kind', 'people', 'qty', v_qty,
        'unitCents', (v_people->>'extraCents')::int, 'cents', v_qty * (v_people->>'extraCents')::int);
    end if;
  end if;

  -- 4. Extras.
  for v_pick in select e from jsonb_array_elements(coalesce(p_extras, '[]'::jsonb)) e loop
    select d into v_def from jsonb_array_elements(coalesce(v_rules->'extras', '[]'::jsonb)) d where d->>'id' = v_pick->>'id';
    if v_def is null or (v_pick->>'id') = any(v_seen)
       or (v_pick->>'qty')::int < 1 or (v_pick->>'qty')::int > (v_def->>'maxQty')::int then
      raise exception 'quote_extra';
    end if;
    v_seen := v_seen || (v_pick->>'id');
    v_cents := case when v_def->>'unit' = 'hour'
      then round((v_def->>'priceCents')::int * (v_pick->>'qty')::int * v_hours)::int
      else (v_def->>'priceCents')::int * (v_pick->>'qty')::int end;
    v_lines := v_lines || jsonb_build_object('kind', 'extra', 'qty', (v_pick->>'qty')::int,
      'unitCents', (v_def->>'priceCents')::int, 'cents', v_cents,
      'extraId', v_def->>'id', 'label', v_def->>'label', 'unit', v_def->>'unit');
  end loop;
  return v_lines;
end; $$;
revoke all on function public.rental_quote_hours(uuid, timestamptz, int, int, jsonb)
  from public, anon, authenticated, service_role;

create function public.rental_lines_total(p_lines jsonb) returns int language sql immutable set search_path = '' as $$
  select coalesce((select sum((l->>'cents')::int) from jsonb_array_elements(p_lines) l), 0)::int;
$$;
revoke all on function public.rental_lines_total(jsonb) from public, anon, authenticated, service_role;

-- test seam: the lockstep test calls the revoked quote through this wrapper.
create function public.rental_quote_hours_test(
  p_offering_id uuid, p_starts_at timestamptz, p_duration_min int, p_people int, p_extras jsonb
) returns jsonb language sql stable security definer set search_path = '' as $$
  select public.rental_quote_hours(p_offering_id, p_starts_at, p_duration_min, p_people, p_extras);
$$;
revoke all on function public.rental_quote_hours_test(uuid, timestamptz, int, int, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.rental_quote_hours_test(uuid, timestamptz, int, int, jsonb) to service_role;
```

Then the four RPCs. For `create_rental_booking_hours` (base: 0062) — signature changes, so:

```sql
drop function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text);
create function public.create_rental_booking_hours(
  p_handle text, p_offering_id uuid, p_unit_id uuid, p_starts_at timestamptz,
  p_duration_min int, p_name text, p_email text, p_note text, p_token_hash text,
  p_people int, p_extras jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org record; v_off record; v_ends timestamptz; v_unit uuid;
  v_client_id uuid; v_booking_id uuid; v_recent int;
  v_total int; v_deposit int; v_snap_currency text;
  v_lines jsonb;                                                    -- S1
begin
  -- … 0062 body verbatim up to and including `v_ends := …;` …
  -- S1: the quote replaces rental_total_cents.
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, p_people, coalesce(p_extras, '[]'::jsonb));
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
  v_deposit := public.rental_deposit_cents(v_off.deposit_type, v_off.deposit_value, v_total);
  v_snap_currency := case when v_total is not null or v_deposit is not null then v_org.currency end;
  -- … 0062 body verbatim (notice, window, availability, rate caps, lock, unit pick, client upsert) …
  insert into public.bookings
    (org_id, rental_offering_id, rental_unit_id, client_id, client_name, client_email,
     starts_at, ends_at, status, cancel_token_hash, note, price_cents, currency, deposit_cents, terms_accepted_at,
     lines, people)                                                                 -- S1
  values
    (v_org.id, v_off.id, v_unit, v_client_id, btrim(p_name), lower(p_email),
     p_starts_at, v_ends,
     case when v_off.requires_approval then 'pending' else 'confirmed' end,
     p_token_hash, p_note, v_total, v_snap_currency, v_deposit,
     case when v_off.terms_text is not null then now() end,
     case when jsonb_array_length(v_lines) = 0 then null else v_lines end,          -- S1
     case when v_off.pricing ? 'people' then coalesce(p_people, (v_off.pricing->'people'->>'included')::int) end)  -- S1
  returning id into v_booking_id;
  return v_booking_id;
end; $$;
revoke all on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_rental_booking_hours(text, uuid, uuid, timestamptz, int, text, text, text, text, int, jsonb) to service_role;
```

`create_rental_booking_hours_admin` (base: **0058**, `create or replace`, signature unchanged): declare `v_lines jsonb;`, replace the `v_total := public.rental_total_cents(...)` line with

```sql
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, p_duration_min, null, '[]'::jsonb);
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
```

and add `lines, people` to the insert with values `case when jsonb_array_length(v_lines) = 0 then null else v_lines end, null`.

`reschedule_rental_hours_apply` (base: **0070**, `create or replace`): add `b.lines, b.people` to the `select … into v_old`, declare `v_lines jsonb; v_extras jsonb;`, replace the `v_total := …` line with

```sql
  -- S1: re-quote at the new time with the booking's own people and extras.
  select coalesce(jsonb_agg(jsonb_build_object('id', l->>'extraId', 'qty', (l->>'qty')::int)), '[]'::jsonb)
    into v_extras from jsonb_array_elements(coalesce(v_old.lines, '[]'::jsonb)) l where l->>'kind' = 'extra';
  v_lines := public.rental_quote_hours(v_off.id, p_starts_at, v_duration, v_old.people, v_extras);
  v_total := case when jsonb_array_length(v_lines) = 0 then null else public.rental_lines_total(v_lines) end;
```

and add `lines, people` to the insert with values `case when jsonb_array_length(v_lines) = 0 then null else v_lines end, v_old.people`.

`resolve_booking_token` (base: **0070**): `drop function public.resolve_booking_token(text);` then recreate with `lines jsonb, people int` appended to the `returns table (...)` and `b.lines, b.people` appended to the select; regrant `to anon, service_role`.

Footer comment listing the rollback (drop the three functions, drop the columns, recreate the 9-arg `create_rental_booking_hours` from 0062 and `resolve_booking_token` from 0070).

- [ ] **Step 4: Register the migration**

Append to `src/db/migrations/meta/_journal.json`:
```json
{ "idx": 78, "version": "7", "when": <Date.now()>, "tag": "0078_pricing_rules", "breakpoints": true }
```
Copy `meta/0077_snapshot.json` to `meta/0078_snapshot.json`; in it add to `public.rental_offerings.columns` `"pricing": { "name": "pricing", "type": "jsonb", "primaryKey": false, "notNull": false }` and to `public.bookings.columns` `"lines": { "name": "lines", "type": "jsonb", "primaryKey": false, "notNull": false }`, `"people": { "name": "people", "type": "integer", "primaryKey": false, "notNull": false }`; set the snapshot `id` to a fresh UUID and `prevId` to 0077's `id`.

Drizzle schema: in `src/db/schema/rentals.ts` add `jsonb` to the import and after `termsText`:
```ts
    // S1: hourly pricing rules (spec 2026-09-07). NULL = the H3 flat rate.
    pricing: jsonb("pricing"),
```
In `src/db/schema/scheduling.ts` add `jsonb` to the import and after `depositCents`:
```ts
    // S1: the itemised quote the booking was made at (price_cents = sum)
    // and the people count the client chose; NULL before 0078 / no rules.
    lines: jsonb("lines"),
    people: integer("people"),
```

- [ ] **Step 5: Apply and run**

Run: `npm run db:migrate && npm run test:integration -- src/features/rentals/pricing-quote.integration.test.ts src/features/rentals/h3-money-rpc.integration.test.ts src/features/rentals/hourly-rpc.integration.test.ts`
Expected: PASS. `h3-money` and `hourly-rpc` call `create_rental_booking_hours` with 9 args — update those calls to add `p_people: null, p_extras: []` (PostgREST needs the full argument list to resolve the overload; with the old signature dropped, 9 args is an error).

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/0078_pricing_rules.sql src/db/migrations/meta src/db/schema/rentals.ts src/db/schema/scheduling.ts src/features/rentals/pricing-quote.integration.test.ts src/features/rentals/h3-money-rpc.integration.test.ts src/features/rentals/hourly-rpc.integration.test.ts
git commit -m "feat(db): 0078 pricing rules — rental_quote_hours and the lines snapshot (S1)"
```

---

### Task 4: Rules travel through the admin write path

**Files:**
- Modify: `src/features/rentals/schema.ts`, `src/features/rentals/actions.ts`, `src/features/rentals/queries.ts`
- Test: `src/features/rentals/schema.test.ts` (exists — append), `src/features/rentals/queries.integration.test.ts` (exists — append one case)

**Interfaces:**
- Produces: `hoursOffering` / the hours branch of `updateOfferingInput` accept `pricing: PricingRules | null` (default `null`), refined with `pricingRulesFor(minDurationMin)`; the nights/days branches stay `.strict()` and refuse `pricing`. `OfferingRow.pricing: PricingRules | null`. `toOfferingSettingsRow` writes `pricing` for hours, `null` for nights/days.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/rentals/schema.test.ts`:
```ts
import { offeringInput, updateOfferingInput } from "./schema";
import { FIXTURE_RULES } from "./pricing-fixture";

describe("S1 pricing on the offering schemas", () => {
  const hours = { name: "Studio", rangeMode: "hours", slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 240 };
  it("hours accepts rules and defaults to null", () => {
    expect(offeringInput.safeParse({ ...hours, pricing: FIXTURE_RULES }).success).toBe(true);
    const r = offeringInput.safeParse(hours);
    expect(r.success && (r.data as { pricing: unknown }).pricing).toBeNull();
  });
  it("hours refuses a first band above the minimum duration", () => {
    expect(offeringInput.safeParse({ ...hours, minDurationMin: 30, pricing: FIXTURE_RULES }).success).toBe(false);
  });
  it("nights refuses pricing (strict)", () => {
    expect(offeringInput.safeParse({ name: "Cabin", rangeMode: "nights", startTime: "15:00", endTime: "11:00", pricing: FIXTURE_RULES }).success).toBe(false);
  });
  it("the settings form carries it too", () => {
    const { name: _n, ...settings } = hours;
    expect(updateOfferingInput.safeParse({ id: "8d0b9f2e-3c1a-4b5e-9f6a-1c2d3e4f5a6b", ...settings, pricing: FIXTURE_RULES }).success).toBe(true);
  });
});
```

Append to `src/features/rentals/queries.integration.test.ts` (inside its existing describe, using its existing org/offering helpers):
```ts
  it("OfferingRow carries pricing", async () => {
    // insert an hours offering with FIXTURE_RULES via the signed-in client, then
    const rows = await listOfferings(orgId /* the suite's org */);
    expect(rows.find((r) => r.name === "Studio S1")?.pricing).toEqual(FIXTURE_RULES);
  });
```
(Adapt to the file's own fixture names; the assertion is that `listOfferings` returns `pricing` parsed as JSON.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/rentals/schema.test.ts`
Expected: FAIL — hours refuses unknown key `pricing` (strict).

- [ ] **Step 3: Implement**

`schema.ts`: import `pricingRulesSchema, pricingRulesFor` from `./pricing-rules`; add to `hoursFields`:
```ts
  // S1: NULL = the flat price above applies; rules make price_cents inert.
  pricing: pricingRulesSchema.nullable().default(null),
```
and add to both hours branches (create and update) after `.refine(hoursGrid, …)`:
```ts
  .refine((o) => o.pricing === null || pricingRulesFor(o.minDurationMin).safeParse(o.pricing).success, {
    message: "the first rate band must start at or below the minimum duration", path: ["pricing", "bands", 0, "fromMin"],
  })
```

`actions.ts` `toOfferingSettingsRow`: in the hours branch add `pricing: d.pricing,`; in the nights/days branch add `pricing: null,`.

`queries.ts`: add `pricing` to `OFFERING_COLUMNS` (after `terms_text`), `pricing: PricingRules | null` to `OfferingDb` and `OfferingRow`, `pricing: o.pricing` in `toOffering`. Import the type from `./pricing-rules`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/rentals && npm run test:integration -- src/features/rentals/queries.integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/rentals/schema.ts src/features/rentals/schema.test.ts src/features/rentals/actions.ts src/features/rentals/queries.ts src/features/rentals/queries.integration.test.ts
git commit -m "feat(rentals): pricing rules travel through the offering schema, actions and queries (S1)"
```

---

### Task 5: Public offering, token resolver and the hourly action

**Files:**
- Modify: `src/lib/booking/public.ts`, `src/lib/tokens/booking.ts`, `src/features/rentals/schema.ts` (`createRentalBookingHoursInput`), `src/features/rentals/hourly-actions.ts`, `messages/en.json` (`errors.rentals.quote`)
- Test: `src/features/rentals/hourly-flow.integration.test.ts` (exists — append two cases)

**Interfaces:**
- Produces: `PublicOffering.pricing: PricingRules | null`; `ResolveBookingResult.booking.lines: Line[] | null`, `.people: number | null`; `createRentalBookingHoursInput` gains `people: z.number().int().min(0).max(500).nullable().default(null)` and `extras: extraPicksSchema.default([])`; `createRentalBookingHours` passes `p_people`, `p_extras`, maps sentinels `quote_band|quote_people|quote_extra` → `publicError(orgLocale, "rentalsQuote")` with `{ quote: true }` so the flow can re-open the step; emails use `lines` from the booking row.

- [ ] **Step 1: Write the failing tests** (append to `hourly-flow.integration.test.ts`, inside the first describe, after the existing create case; the suite's offering is a flat-rate one, so add a second offering with `pricing: FIXTURE_RULES` in `beforeAll` the same way it inserts the first, with `booking_window_days: 730` and all-day rules):

```ts
  it("S1: a booking with people and extras is quoted and the email lists the lines", async () => {
    net.clientIp = "203.0.113.61";
    const res = await hourlyActions.createRentalBookingHours({
      handle: HANDLE, offeringId: rulesOfferingId, unitId: null, startsAt: iso(`${d(3)}T21:00`), durationMin: 120,
      name: "Ola", email: `ola-s1-${Date.now()}@example.com`, people: 7, extras: [{ id: "arri", qty: 1 }], termsAccepted: false,
    });
    expect(res.ok).toBe(true);
    const { data: row } = await admin.from("bookings").select("lines, people, price_cents").eq("cancel_token_hash", /* hash of res.token */ hashOf((res as { token: string }).token)).single();
    expect(row!.people).toBe(7);
    expect((row!.lines as unknown[]).map((l) => (l as { kind: string }).kind)).toEqual(["base", "surcharge", "people", "extra"]);
  });

  it("S1: people over the max is refused with the quote error and never books", async () => {
    net.clientIp = "203.0.113.62";
    const res = await hourlyActions.createRentalBookingHours({
      handle: HANDLE, offeringId: rulesOfferingId, unitId: null, startsAt: iso(`${d(3)}T12:00`), durationMin: 60,
      name: "Ola", email: `ola-s1b-${Date.now()}@example.com`, people: 11, extras: [], termsAccepted: false,
    });
    expect(res).toEqual({ ok: false, error: ERR("rentals.quote"), quote: true });
  });
```
(`hashOf` = `sha256` hex of the token — reuse `hashToken` from `@/lib/tokens` if exported, otherwise `createHash("sha256").update(token).digest("hex")` from `node:crypto`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:integration -- src/features/rentals/hourly-flow.integration.test.ts`
Expected: FAIL — zod strips `people`/`extras` (RPC called with 9 args → PostgREST "function not found"), and the second case returns the generic error.

- [ ] **Step 3: Implement**

`public.ts`: add `pricing` to `PUBLIC_OFFERING_COLUMNS`, `pricing: PricingRules | null` to `PublicOfferingDb` and `PublicOffering`, `pricing: o.pricing` in `toPublicOffering`.

`lib/tokens/booking.ts`: add `lines: Line[] | null; people: number | null;` to the booking type, `lines: unknown; people: number | null;` to the row type, and `lines: (row.lines as Line[] | null) ?? null, people: row.people ?? null` in the mapping.

`schema.ts`:
```ts
export const createRentalBookingHoursInput = z.object({
  /* … existing … */
  // S1: the client's people count (null = the offering's included count) and extras.
  people: z.number().int().min(0).max(500).nullable().default(null),
  extras: extraPicksSchema.default([]),
});
```

`hourly-actions.ts`: destructure `people, extras`; add `p_people: people, p_extras: extras` to the `call`; after the `too_many` check add
```ts
      if (isRpcSentinel(error, "quote_band") || isRpcSentinel(error, "quote_people") || isRpcSentinel(error, "quote_extra")) {
        return publicError(orgLocale, "rentalsQuote", { quote: true });
      }
```
and widen the return type with `quote?: boolean`. In the mail prep, replace the `totalCents`/`depositCents` computation with a read of the committed row — extend the existing `statusRow` select to `"status, lines, people, price_cents, deposit_cents"` and build
```ts
      const money = {
        totalCents: statusRow?.price_cents ?? null,
        depositCents: statusRow?.deposit_cents ?? null,
        currency: ctx.org.currency,
        cancelWindowMin: ctx.offering.cancelWindowMin,
        lines: (statusRow?.lines as Line[] | null) ?? null,
      };
```
(the RPC's snapshot is the truth; the TS mirror is for the widget only). Remove the now-unused `totalCents, depositCents` imports.

`messages/en.json` under `errors`: `"rentals": { "quote": "The price for that choice can't be worked out — pick again." }`. Check `publicError`'s key type: it takes a key of `errors`; if the type is a flat union of top-level keys, add `rentalsQuote` at the top level instead of nesting — follow whatever `public.ts`'s `publicError` signature allows and use the same key in the test's `ERR(...)`.

- [ ] **Step 4: Run**

Run: `npm run test:integration -- src/features/rentals/hourly-flow.integration.test.ts && npx vitest run src/lib src/features/rentals`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/booking/public.ts src/lib/tokens/booking.ts src/features/rentals/schema.ts src/features/rentals/hourly-actions.ts src/features/rentals/hourly-flow.integration.test.ts messages/en.json
git commit -m "feat(rentals): people and extras reach the hourly RPC; emails print the quoted lines (S1)"
```

---

### Task 6: The rules editor component

**Files:**
- Create: `src/features/rentals/components/pricing-rules-editor.tsx`
- Modify: `messages/en.json` (`spaces.form.pricing.*`)

**Interfaces:**
- Produces:
  ```tsx
  export function PricingRulesEditor({ value, onChange, currency, minDurationMin }: {
    value: PricingRules | null; onChange: (next: PricingRules | null) => void; currency: string; minDurationMin: number;
  }): JSX.Element;
  ```
  Controlled. `value === null` renders the "Use rates by length instead of one price" switch off; switching it on seeds `{ bands: [{ fromMin: minDurationMin, perHourCents: 0 }], surcharges: [], extras: [] }`. Amounts are edited in major units (zł) and stored as cents; extras get their `id` from `slugify(label)` once, at creation, and keep it.

- [ ] **Step 1: Write the component** (no DOM tests in this repo — Vitest runs in node; the integration proof is Task 7's form round-trip)

```tsx
// src/features/rentals/components/pricing-rules-editor.tsx
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, nativeSelectClass } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeCombobox } from "@/features/scheduling/components/time-combobox";
import { TIME_OPTIONS } from "@/features/scheduling/time-options";
import { slugify, type Band, type Extra, type PricingRules, type Surcharge } from "@/features/rentals/pricing-rules";
import { cn } from "@/lib/utils";

const major = (cents: number | undefined) => (cents === undefined ? "" : String(cents / 100));
const toCents = (s: string) => (s.trim() === "" ? 0 : Math.round(Number(s) * 100));

function RowRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" aria-label={label} onClick={onClick} className="shrink-0">
      <X className="size-4" />
    </Button>
  );
}

/* The four row editors of the Pricing section for an hourly space (spec
   2026-09-07 §Admin). Controlled: the form owns the value and posts it as
   one `pricing` object; every amount is typed in major units and stored in
   cents. Row idiom follows the availability day-interval editor: add,
   remove, no drag. */
export function PricingRulesEditor({
  value, onChange, currency, minDurationMin,
}: {
  value: PricingRules | null;
  onChange: (next: PricingRules | null) => void;
  currency: string;
  minDurationMin: number;
}) {
  const t = useTranslations("spaces.form.pricing");
  const tw = useTranslations("availability");
  const weekdays = tw("weekdaysShort").split(" "); // Sun … Sat (0…6)
  const rules = value;
  const set = (patch: Partial<PricingRules>) => onChange({ ...(rules ?? { bands: [], surcharges: [], extras: [] }), ...patch });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <Label htmlFor="pricing-rules-on">{t("useRules")}</Label>
          <span className="text-muted-foreground text-xs">{t("useRulesHint")}</span>
        </div>
        <Switch
          id="pricing-rules-on"
          checked={rules !== null}
          onCheckedChange={(on) => onChange(on ? { bands: [{ fromMin: minDurationMin, perHourCents: 0 }], surcharges: [], extras: [] } : null)}
        />
      </div>
      {rules === null ? null : (
        <>
          {/* Rates by length */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("bands.title")}</legend>
            {rules.bands.map((b, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2">
                <span className="text-muted-foreground text-xs">{t("bands.from")}</span>
                <Input aria-label={t("bands.fromAria", { n: i + 1 })} type="number" min={5} step={5} value={b.fromMin / 60}
                  disabled={i === 0}
                  onChange={(e) => set({ bands: rules.bands.map((x, j) => j === i ? { ...x, fromMin: Math.round(Number(e.target.value) * 60) } : x) })} />
                <select aria-label={t("bands.kindAria", { n: i + 1 })} className={nativeSelectClass}
                  value={b.totalCents !== undefined ? "total" : "perHour"}
                  onChange={(e) => set({ bands: rules.bands.map((x, j) => j === i
                    ? (e.target.value === "total" ? { fromMin: x.fromMin, totalCents: x.perHourCents ?? 0 } : { fromMin: x.fromMin, perHourCents: x.totalCents ?? 0 })
                    : x) })}>
                  <option value="perHour">{t("bands.perHour", { currency })}</option>
                  <option value="total">{t("bands.total", { currency })}</option>
                </select>
                <Input aria-label={t("bands.amountAria", { n: i + 1 })} type="number" min={0} step="0.01"
                  value={major(b.totalCents ?? b.perHourCents)}
                  onChange={(e) => set({ bands: rules.bands.map((x, j) => j === i
                    ? (x.totalCents !== undefined ? { ...x, totalCents: toCents(e.target.value) } : { ...x, perHourCents: toCents(e.target.value) })
                    : x) })} />
                {i === 0 ? <span /> : <RowRemove label={t("bands.remove", { n: i + 1 })} onClick={() => set({ bands: rules.bands.filter((_, j) => j !== i) })} />}
              </div>
            ))}
            {rules.bands.length < 8 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => set({ bands: [...rules.bands, { fromMin: (rules.bands.at(-1)?.fromMin ?? minDurationMin) + 60, perHourCents: rules.bands.at(-1)?.perHourCents ?? 0 }] })}>
                {t("bands.add")}
              </Button>
            ) : null}
          </fieldset>

          {/* Surcharges */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("surcharges.title")}</legend>
            {rules.surcharges.map((s, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <Input aria-label={t("surcharges.labelAria", { n: i + 1 })} maxLength={60} placeholder={t("surcharges.labelPlaceholder")} value={s.label}
                    onChange={(e) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground text-xs">+</span>
                    <Input aria-label={t("surcharges.pctAria", { n: i + 1 })} type="number" min={1} max={200} className="w-20" value={s.pct}
                      onChange={(e) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, pct: Number(e.target.value) } : x) })} />
                    <span className="text-muted-foreground text-xs">%</span>
                  </div>
                  <RowRemove label={t("surcharges.remove", { n: i + 1 })} onClick={() => set({ surcharges: rules.surcharges.filter((_, j) => j !== i) })} />
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label={t("surcharges.days")}>
                  {weekdays.map((name, dow) => (
                    <button key={dow} type="button" aria-pressed={s.days.includes(dow)}
                      className={cn("rounded-md border px-2 py-1 text-xs", s.days.includes(dow) ? "bg-foreground text-background" : "text-muted-foreground")}
                      onClick={() => set({ surcharges: rules.surcharges.map((x, j) => j === i
                        ? { ...x, days: x.days.includes(dow) ? x.days.filter((d) => d !== dow) : [...x.days, dow].sort() } : x) })}>
                      {name}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TimeCombobox id={`surcharge-${i}-from`} label={t("surcharges.from")} value={s.from} options={TIME_OPTIONS}
                    onCommit={(v) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, from: v } : x) })} />
                  <TimeCombobox id={`surcharge-${i}-to`} label={t("surcharges.to")} value={s.to} options={TIME_OPTIONS}
                    onCommit={(v) => set({ surcharges: rules.surcharges.map((x, j) => j === i ? { ...x, to: v } : x) })} />
                </div>
              </div>
            ))}
            {rules.surcharges.length < 4 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => set({ surcharges: [...rules.surcharges, { label: "", pct: 25, days: [0, 1, 2, 3, 4, 5, 6], from: "22:00", to: "08:00" } satisfies Surcharge] })}>
                {t("surcharges.add")}
              </Button>
            ) : null}
          </fieldset>

          {/* People */}
          <fieldset className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <legend className="text-sm font-medium">{t("people.title")}</legend>
              <Switch aria-label={t("people.title")} checked={rules.people !== undefined}
                onCheckedChange={(on) => set({ people: on ? { included: 5, extraCents: 0, max: 10 } : undefined })} />
            </div>
            {rules.people ? (
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-included">{t("people.included")}</Label>
                  <Input id="people-included" type="number" min={0} max={500} value={rules.people.included}
                    onChange={(e) => set({ people: { ...rules.people!, included: Number(e.target.value) } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-extra">{t("people.extra", { currency })}</Label>
                  <Input id="people-extra" type="number" min={0} step="0.01" value={major(rules.people.extraCents)}
                    onChange={(e) => set({ people: { ...rules.people!, extraCents: toCents(e.target.value) } })} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="people-max">{t("people.max")}</Label>
                  <Input id="people-max" type="number" min={0} max={500} value={rules.people.max}
                    onChange={(e) => set({ people: { ...rules.people!, max: Number(e.target.value) } })} />
                </div>
              </div>
            ) : null}
          </fieldset>

          {/* Extras */}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("extras.title")}</legend>
            {rules.extras.map((x, i) => (
              <div key={x.id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2">
                <Input aria-label={t("extras.labelAria", { n: i + 1 })} maxLength={60} placeholder={t("extras.labelPlaceholder")} value={x.label}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, label: e.target.value } : y) })} />
                <select aria-label={t("extras.unitAria", { n: i + 1 })} className={nativeSelectClass} value={x.unit}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, unit: e.target.value as Extra["unit"] } : y) })}>
                  <option value="hour">{t("extras.perHour")}</option>
                  <option value="piece">{t("extras.perPiece")}</option>
                </select>
                <Input aria-label={t("extras.priceAria", { n: i + 1 })} type="number" min={0} step="0.01" className="w-24" value={major(x.priceCents)}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, priceCents: toCents(e.target.value) } : y) })} />
                <Input aria-label={t("extras.maxAria", { n: i + 1 })} type="number" min={1} max={99} className="w-16" value={x.maxQty}
                  onChange={(e) => set({ extras: rules.extras.map((y, j) => j === i ? { ...y, maxQty: Number(e.target.value) } : y) })} />
                <RowRemove label={t("extras.remove", { n: i + 1 })} onClick={() => set({ extras: rules.extras.filter((_, j) => j !== i) })} />
              </div>
            ))}
            {rules.extras.length < 12 ? (
              <Button type="button" variant="ghost" size="sm" className="self-start"
                onClick={() => {
                  // A fresh id once; a later relabel keeps it (existing bookings' lines reference it).
                  const n = rules.extras.length + 1;
                  const id = `extra-${n}-${Date.now().toString(36)}`.slice(0, 32);
                  set({ extras: [...rules.extras, { id, label: "", unit: "hour", priceCents: 0, maxQty: 1 }] });
                }}>
                {t("extras.add")}
              </Button>
            ) : null}
          </fieldset>
        </>
      )}
    </div>
  );
}
```

Note: extras' `id` is generated as `extra-N-<base36>` rather than from the label, because the label is empty when the row is created and must never change the id afterwards; `slugify` stays in `pricing-rules.ts` for the migration kit (S8). Amend the spec's "generated from the label" line in the spec file to match (one-line edit, commit together).

- [ ] **Step 2: Add the English strings** under `spaces.form`:

```json
"pricing": {
  "useRules": "Rates by length, surcharges and extras",
  "useRulesHint": "Instead of one price per hour. The price is worked out for each booking and shown before the client confirms.",
  "bands": { "title": "Rates by length", "from": "from", "fromAria": "Rate {n} applies from (hours)", "kindAria": "Rate {n} kind", "amountAria": "Rate {n} amount", "perHour": "{currency} per hour", "total": "{currency} total", "add": "Add a rate", "remove": "Remove rate {n}" },
  "surcharges": { "title": "Surcharges", "labelAria": "Surcharge {n} name", "labelPlaceholder": "Night", "pctAria": "Surcharge {n} percent", "days": "Days", "from": "From", "to": "To", "add": "Add a surcharge", "remove": "Remove surcharge {n}" },
  "people": { "title": "People", "included": "Included", "extra": "Per extra person ({currency})", "max": "Maximum" },
  "extras": { "title": "Extras", "labelAria": "Extra {n} name", "labelPlaceholder": "ARRI 2 kW", "unitAria": "Extra {n} unit", "perHour": "per hour", "perPiece": "per piece", "priceAria": "Extra {n} price", "maxAria": "Extra {n} maximum", "add": "Add an extra", "remove": "Remove extra {n}" }
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/rentals/components/pricing-rules-editor.tsx messages/en.json docs/superpowers/specs/2026-09-07-s1-pricing-rules-design.md
git commit -m "feat(rentals): pricing rules editor — rates by length, surcharges, people, extras (S1)"
```

---

### Task 7: The space form posts `pricing`

**Files:**
- Modify: `src/features/rentals/components/offering-form.tsx`
- Modify: `src/features/rentals/components/offerings-list.tsx`, `src/app/(dashboard)/rentals/[id]/page.tsx` (headline price via `headlinePrice`)

**Interfaces:**
- Consumes: `PricingRulesEditor` (Task 6), `headlinePrice` (Task 2), `OfferingRow.pricing` (Task 4).

- [ ] **Step 1: Wire the editor**

In `offering-form.tsx`:
- import `PricingRulesEditor` and `type PricingRules`;
- add state `const [pricing, setPricing] = React.useState<PricingRules | null>(offering?.pricing ?? null);` and `const [minDurationMin, setMinDurationMin] = React.useState<number>(offering?.minDurationMin ?? OFFERING_DEFAULTS.hours.minDurationMin);` — make the existing min-duration `<Input>` controlled with it (`value={minDurationMin} onChange={(e) => setMinDurationMin(Number(e.target.value))}`), so the editor's first band follows it;
- in the hours payload add `pricing`;
- in the Pricing section, for `rangeMode === "hours"`, render the existing Price/Pricing-mode grid only when `pricing === null`, and below it `<PricingRulesEditor value={pricing} onChange={setPricing} currency={currency} minDurationMin={minDurationMin} />`. Nights/days render exactly what they render today.
- When `pricing` is non-null, submit `priceCents: null, pricingMode: "per_unit"` for hours so the two models never disagree on the row.

- [ ] **Step 2: Headline price**

In `offerings-list.tsx` and the space page header, replace the `formatOfferingPrice(offering, currency, tu)` call with `headlinePrice(offering, currency, tu)` (same signature plus `rangeMode`, which `OfferingRow` has). Add `spaces.list.from`-style copy? No — `headlinePrice` already returns "from …"; no new keys.

- [ ] **Step 3: Verify by hand and by test**

Run: `npm run verify` (lint, typecheck, unit). Then, with the dev server up and a spaces org: open `/rentals/new`, pick Hourly, switch on the rules, add a second rate, one surcharge, people, one extra, save; reopen the space and confirm every value round-trips (the form reads `offering.pricing`). Check the list row reads "from 120,00 zł / hour".

- [ ] **Step 4: Commit**

```bash
git add src/features/rentals/components/offering-form.tsx src/features/rentals/components/offerings-list.tsx "src/app/(dashboard)/rentals/[id]/page.tsx"
git commit -m "feat(rentals): the space form edits pricing rules; lists show the headline rate (S1)"
```

---

### Task 8: The widget — people, extras, itemised confirm

**Files:**
- Modify: `src/features/rentals/components/hourly-booking-flow.tsx`, `src/features/rentals/components/booking-money-summary.tsx`
- Modify: `messages/en.json` (`public.widget.people`, `public.widget.extras`, `public.widget.included`, `public.units.from`)

**Interfaces:**
- Consumes: `quoteHours`, `sumLines`, `headlinePrice` (Task 2); `PublicOffering.pricing` (Task 5); `createRentalBookingHours` accepting `people`/`extras` (Task 5).
- Produces: `BookingMoneySummary` gains `lines: Line[] | null` and `totalCents: number | null` props (it no longer computes; the flow does).

- [ ] **Step 1: `booking-money-summary.tsx`** — replace the `units` prop with `lines` and `totalCents`:

```tsx
export function BookingMoneySummary({
  offering, currency, lines, totalCents, termsAccepted, onTermsChange, idPrefix = "",
}: {
  offering: MoneyFields & { cancelWindowMin: number; termsText: string | null };
  currency: string;
  /** The quote (S1) — null while the picker hasn't settled; [] for an unpriced offering. */
  lines: Line[] | null;
  totalCents: number | null;
  termsAccepted: boolean;
  onTermsChange: (v: boolean) => void;
  idPrefix?: string;
}) {
  const t = useTranslations("public.stay");
  const tu = useTranslations("public.units");
  const deposit = depositCents(offering, totalCents);
  const info = moneyInfoLines({ totalCents, depositCents: deposit, currency, cancelWindowMin: offering.cancelWindowMin, lines }, tu);
  if (info.length === 0 && offering.termsText === null) return null;
  const totalIdx = totalCents === null ? -1 : (lines?.length ?? 0);
  // … render `info` with `i === totalIdx ? "font-medium" : "text-muted-foreground"`; terms block unchanged …
```
`RentalBookingFlow` (nights/days) calls this too: pass `lines={null}` and `totalCents={units === null ? null : totalCents(offering, units)}` there.

- [ ] **Step 2: `hourly-booking-flow.tsx`**

- State: `const [people, setPeople] = React.useState<number | null>(null); const [extras, setExtras] = React.useState<ExtraPick[]>([]);` reset both in `changeDuration(null)` and `backToTime`.
- Quote for the pills (base only): replace the `hourly.pricingMode === "per_unit" && …` branches with
  ```tsx
  const pillPrice = (d: number) => {
    try {
      const lines = quoteHours(hourly, new Date(), d, null, [], orgTimeZone).filter((l) => l.kind === "base");
      if (lines.length === 0) return null;
      const amount = formatMoney(sumLines(lines), currency);
      return hourly.pricing?.surcharges.length ? tu("from", { amount }) : amount;
    } catch { return null; }
  };
  ```
  and render `pillPrice(d)` where the old total was (flat/unpriced offerings render nothing, as before).
- Live quote once a slot is picked:
  ```tsx
  const quote = React.useMemo(() => {
    if (!slot || !durationMin) return null;
    try { return quoteHours(hourly, new Date(slot), durationMin, people, extras, orgTimeZone); } catch { return null; }
  }, [hourly, slot, durationMin, people, extras, orgTimeZone]);
  ```
- In the confirm form, after `ClientDetailsFields` and before `BookingMoneySummary`:
  ```tsx
  {hourly.pricing?.people ? (
    <div className="flex items-center justify-between gap-3">
      <span className={STEP_LABEL}>{t("people")} <span className="text-muted-foreground">{t("included", { count: hourly.pricing.people.included })}</span></span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-label={t("fewer")} disabled={(people ?? hourly.pricing.people.included) <= 1} onClick={() => setPeople((people ?? hourly.pricing!.people!.included) - 1)}>−</Button>
        <span className="w-6 text-center tabular-nums">{people ?? hourly.pricing.people.included}</span>
        <Button type="button" variant="outline" size="sm" aria-label={t("more")} disabled={(people ?? hourly.pricing.people.included) >= hourly.pricing.people.max} onClick={() => setPeople((people ?? hourly.pricing!.people!.included) + 1)}>+</Button>
      </div>
    </div>
  ) : null}
  {hourly.pricing && hourly.pricing.extras.length > 0 ? (
    <ul className={ROW_LIST} aria-label={t("extras")}>
      {hourly.pricing.extras.map((x) => {
        const qty = extras.find((e) => e.id === x.id)?.qty ?? 0;
        const setQty = (q: number) => setExtras(q <= 0 ? extras.filter((e) => e.id !== x.id) : [...extras.filter((e) => e.id !== x.id), { id: x.id, qty: q }]);
        return (
          <li key={x.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0"><span className="block">{x.label}</span>
              <span className="text-muted-foreground block text-xs">{formatMoney(x.priceCents, currency)} · {x.unit === "hour" ? tu("perHourShort") : tu("perPiece")}</span></span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" aria-label={t("fewerOf", { label: x.label })} disabled={qty === 0} onClick={() => setQty(qty - 1)}>−</Button>
              <span className="w-6 text-center tabular-nums">{qty}</span>
              <Button type="button" variant="outline" size="sm" aria-label={t("moreOf", { label: x.label })} disabled={qty >= x.maxQty} onClick={() => setQty(qty + 1)}>+</Button>
            </div>
          </li>
        );
      })}
    </ul>
  ) : null}
  <BookingMoneySummary offering={offering} currency={currency} lines={quote} totalCents={quote === null ? null : (quote.length === 0 ? null : sumLines(quote))} termsAccepted={termsAccepted} onTermsChange={setTermsAccepted} idPrefix="hourly-" />
  ```
- `submit`: pass `people, extras`; on `result.quote` do `setExtras([]); setPeople(null);` and keep the error visible.
- Header price: `const priceLabel = headlinePrice(offering, currency, tu);`.

- [ ] **Step 3: English keys** — `public.widget`: `"people": "People"`, `"included": "up to {count} included"`, `"fewer": "Fewer people"`, `"more": "More people"`, `"extras": "Extras"`, `"fewerOf": "Fewer: {label}"`, `"moreOf": "More: {label}"`; `public.units`: `"from": "from {amount}"`, `"perHourShort": "per hour"`, `"perPiece": "per piece"`.

- [ ] **Step 4: Verify**

Run: `npm run verify`. Then in the browser on a rules space: pills read "from 240,00 zł" (surcharges set) / plain when not; pick a 21:00 slot → the confirm step lists base + Noc + people + extras with amounts and the total; change people → total updates; submit → confirmation email (Mailpit at :54354) lists the same lines; the manage page (`/booking/<token>`) lists them; over-max people is impossible in the UI (stepper caps), so force it via the action test from Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/features/rentals/components/hourly-booking-flow.tsx src/features/rentals/components/booking-money-summary.tsx src/features/rentals/components/rental-booking-flow.tsx messages/en.json
git commit -m "feat(widget): people, extras and an itemised quote in the hourly flow (S1)"
```

---

### Task 9: The manage page and emails read the snapshot

**Files:**
- Modify: `src/app/booking/[token]/page.tsx`
- Modify: `src/features/rentals/manage-actions.ts` (the hourly reschedule's emails), `src/features/rentals/booking-actions.ts` (admin hourly create/reschedule emails)

**Interfaces:**
- Consumes: `resolveBookingToken(...).booking.lines` (Task 5); `moneyInfoLines({ …, lines })` (Task 2).

- [ ] **Step 1: Manage page** — in `page.tsx` add `lines: b.lines` to the `moneyInfoLines` input.

- [ ] **Step 2: Reschedule and admin emails** — wherever these actions build `money` for `moneyInfoLines` from `totalCents(ctx.offering, …)`, replace with a read of the new row's `lines, price_cents, deposit_cents` (the RPC returns `new_booking_id`; one `admin.from("bookings").select("lines, price_cents, deposit_cents").eq("id", id).maybeSingle()`), same pattern as Task 5's create path. Grep: `grep -n "totalCents(" src/features/rentals/*.ts` — every remaining call site outside `pricing.ts` and the nights/days paths is one to convert.

- [ ] **Step 3: Run**

Run: `npm run test:integration -- src/features/rentals && npm run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/booking/[token]/page.tsx" src/features/rentals/manage-actions.ts src/features/rentals/booking-actions.ts
git commit -m "feat(rentals): manage page and lifecycle emails print the quoted lines (S1)"
```

---

### Task 10: Ukrainian and Polish strings, glossary

**Files:**
- Modify: `messages/uk.json`, `messages/pl.json`, `messages/GLOSSARY.md`

- [ ] **Step 1: Run the parity test to list the gap**

Run: `npx vitest run src/i18n/messages.test.ts`
Expected: FAIL naming every key added in Tasks 2, 5, 6, 8 as missing from `uk` and `pl`.

- [ ] **Step 2: Translate**

Add every listed key to both files at the same path. Polish (glossary terms: stawka za długość · dopłata · dodatek · w cenie):

- `public.units.fromPerHour` "od {amount} / godz." · `totalFor` "{amount} / {length}" · `from` "od {amount}" · `perHourShort` "za godzinę" · `perPiece` "za sztukę" · `line.base` "{hours} × {rate}" · `line.surcharge` "{label} +{pct}%" · `line.people` "{count, plural, one {# dodatkowa osoba} few {# dodatkowe osoby} many {# dodatkowych osób} other {# dodatkowej osoby}} × {each}" · `line.extra` "{label} × {qty}"
- `public.widget.people` "Osoby" · `included` "do {count} w cenie" · `fewer` "Mniej osób" · `more` "Więcej osób" · `extras` "Dodatki" · `fewerOf` "Mniej: {label}" · `moreOf` "Więcej: {label}"
- `errors.rentals.quote` "Nie udało się wyliczyć ceny dla tego wyboru — wybierz ponownie."
- `spaces.form.pricing.*`: useRules "Stawki za długość, dopłaty i dodatki" · useRulesHint "Zamiast jednej ceny za godzinę. Cena jest wyliczana dla każdej rezerwacji i pokazywana, zanim klient potwierdzi." · bands: title "Stawki za długość", from "od", fromAria "Stawka {n} obowiązuje od (godzin)", kindAria "Rodzaj stawki {n}", amountAria "Kwota stawki {n}", perHour "{currency} za godzinę", total "{currency} łącznie", add "Dodaj stawkę", remove "Usuń stawkę {n}" · surcharges: title "Dopłaty", labelAria "Nazwa dopłaty {n}", labelPlaceholder "Noc", pctAria "Procent dopłaty {n}", days "Dni", from "Od", to "Do", add "Dodaj dopłatę", remove "Usuń dopłatę {n}" · people: title "Osoby", included "W cenie", extra "Za dodatkową osobę ({currency})", max "Maksymalnie" · extras: title "Dodatki", labelAria "Nazwa dodatku {n}", labelPlaceholder "ARRI 2 kW", unitAria "Jednostka dodatku {n}", perHour "za godzinę", perPiece "za sztukę", priceAria "Cena dodatku {n}", maxAria "Maksimum dodatku {n}", add "Dodaj dodatek", remove "Usuń dodatek {n}"

Ukrainian (glossary: ставка за тривалість · надбавка · додаток · у вартості): mirror the above — `fromPerHour` "від {amount} / год" · `from` "від {amount}" · `perHourShort` "за годину" · `perPiece` "за штуку" · `line.people` "{count, plural, one {# додаткова особа} few {# додаткові особи} many {# додаткових осіб} other {# додаткової особи}} × {each}" · widget people "Кількість осіб", included "до {count} у вартості", fewer "Менше осіб", more "Більше осіб", extras "Додатки", fewerOf "Менше: {label}", moreOf "Більше: {label}" · error "Не вдалося порахувати ціну для цього вибору — оберіть ще раз." · form: useRules "Ставки за тривалість, надбавки та додатки", useRulesHint "Замість однієї ціни за годину. Ціна рахується для кожного бронювання і показується до підтвердження.", bands title "Ставки за тривалість", from "від", fromAria "Ставка {n} діє від (годин)", kindAria "Тип ставки {n}", amountAria "Сума ставки {n}", perHour "{currency} за годину", total "{currency} разом", add "Додати ставку", remove "Видалити ставку {n}"; surcharges title "Надбавки", labelAria "Назва надбавки {n}", labelPlaceholder "Ніч", pctAria "Відсоток надбавки {n}", days "Дні", from "З", to "До", add "Додати надбавку", remove "Видалити надбавку {n}"; people title "Кількість осіб", included "У вартості", extra "За додаткову особу ({currency})", max "Максимум"; extras title "Додатки", labelAria "Назва додатка {n}", labelPlaceholder "ARRI 2 kW", unitAria "Одиниця додатка {n}", perHour "за годину", perPiece "за штуку", priceAria "Ціна додатка {n}", maxAria "Максимум додатка {n}", add "Додати додаток", remove "Видалити додаток {n}".

Add the four terms to both glossary tables.

- [ ] **Step 3: Run**

Run: `npx vitest run src/i18n`
Expected: PASS (parity, ICU, plurals, forbidden words). If `line.base` etc. are flagged as "same as English", add them to `SAME_IN_EVERY_LOCALE` — they are placeholder-only patterns like `public.units.summary`.

- [ ] **Step 4: Commit**

```bash
git add messages
git commit -m "i18n(rentals): pricing rules and quote lines in Ukrainian and Polish (S1)"
```

---

### Task 11: Full verify, merge main, PR

- [ ] **Step 1:** `git fetch origin && git merge --no-edit origin/main` — resolve `messages/*.json` conflicts by keeping both sides' keys (rerun the parity test).
- [ ] **Step 2:** `npm run verify && npm run test:integration` — all green.
- [ ] **Step 3:** `graphify update .`
- [ ] **Step 4:** Push and open the PR:

```bash
git push -u origin feat/s1-pricing-rules
gh pr create --title "feat(rentals): pricing rules for hourly spaces — quoted, itemised, snapshotted (S1)" --body "$(cat <<'EOF'
## Summary
- `rental_offerings.pricing` (rates by length, time surcharges, per-person, extras) for hourly spaces; NULL keeps the H3 flat rate
- `rental_quote_hours` in SQL + `quoteHours` in TS under a lockstep fixture test; the four hourly RPCs snapshot `bookings.lines` (price_cents = sum) — migration 0078
- Space form: four row editors; lists show "from … / hour"
- Widget: people stepper, extras with quantities, itemised confirm; manage page and emails print the same lines
- en / uk / pl

## Test plan
- [ ] `npm run verify` + `npm run test:integration` green
- [ ] Round-trip the rules on /rentals/new → /rentals/[id]
- [ ] Book a 21:00 slot with 7 people + 1 extra; the confirmation mail and /booking/<token> list base + Noc + people + extra
- [ ] A pre-0078 booking still renders its total only

Spec: docs/superpowers/specs/2026-09-07-s1-pricing-rules-design.md · Plan: docs/superpowers/plans/2026-09-07-s1-pricing-rules.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HwfEz5zNxoUcCZgEVGz8a5
EOF
)"
```

---

## Self-review

**Spec coverage.** Data model → Task 3 (+4 Drizzle). Rules validation → Task 1, wired in Task 4. Quote (SQL) → Task 3; TS mirror → Task 2; lockstep test → Task 3. RPC deltas (create public, create admin, reschedule apply, resolver) → Task 3; the spec table said the admin create's base is 0056 — it is **0058** (the plan uses 0058). Action validation + sentinel mapping → Task 5. Admin form + headline price → Tasks 6–7. Widget (pills = base with "from", people, extras, itemised confirm, refusal handling) → Task 8. Manage page + emails → Tasks 5, 9. i18n → Tasks 2, 5, 6, 8 (en) and 10 (uk, pl) + glossary. Tests listed in the spec → Tasks 1, 2, 3, 4, 5. Out-of-scope list — nothing here builds any of it.

**Placeholders.** None; RPC bodies are "copied verbatim from 0062/0058/0070 with the marked deltas" by constraint, with every delta shown.

**Type consistency.** `Line`, `ExtraPick`, `PricingRules` defined once in Task 1 and imported by name everywhere; `quoteHours(o, startsAt, durationMin, people, extras, timeZone)` signature identical in Tasks 2, 3 (test), 8; sentinels `quote_band | quote_people | quote_extra` in Task 3 SQL, Task 3 test (`replace("quote: ", "quote_")` maps the fixture's `"quote: no band"` → `"quote_no_band"` — **fix:** make the fixture's strings `"quote_band" | "quote_people" | "quote_extra"` and have `quoteHours` throw exactly those, dropping the replace), Task 5 action. `BookingMoneySummary` props changed in Task 8 and its nights/days caller updated in the same task. `headlinePrice` takes `rangeMode` — `OfferingRow` and `PublicOffering` both carry it.

Applied inline: the fixture and `quoteHours` use `quote_band` / `quote_people` / `quote_extra` verbatim; the Task 3 test compares `error.message` with `toContain(c.expect)` and no `replace`.
