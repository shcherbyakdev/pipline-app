// S1 pricing rules (spec 2026-09-07-s1-pricing-rules-design.md): the JSON
// that lives in rental_offerings.pricing, the zod that guards every write,
// and the Line shape the quote produces. Pure — imported by the SQL-mirror
// (pricing.ts), the actions, the form and the widget alike.
import { z } from "zod";
import { TIME_RE } from "@/features/scheduling/schema";

const CENTS_MAX = 100_000_000;
const cents = z.number().int().min(0).max(CENTS_MAX);
export const EXTRA_ID_RE = /^[a-z0-9-]{1,32}$/;

export const OFFERING_KINDS = ["space", "composite", "equipment"] as const;
export type OfferingKind = (typeof OFFERING_KINDS)[number];

export type Band = { fromMin: number; perHourCents?: number; totalCents?: number };
export type Surcharge = { label: string; pct: number; days: number[]; from: string; to: string };
export type People = { included: number; extraCents: number; max: number };
export type Extra = { id: string; label: string; unit: "hour" | "piece"; priceCents: number; maxQty: number };
export type PricingRules = { bands: Band[]; surcharges: Surcharge[]; people?: People; extras: Extra[] };

export type Line =
  | { kind: "base"; qty: number; unitCents: number | null; cents: number }
  | { kind: "surcharge"; qty: number; unitCents: null; cents: number; label: string; pct: number }
  | { kind: "people"; qty: number; unitCents: number; cents: number }
  | { kind: "extra"; qty: number; unitCents: number; cents: number; extraId: string; label: string; unit: "hour" | "piece" }
  // S6: an equipment space attached to the booking — qty items of one space,
  // priced by that space's own price (per hour or flat per booking).
  | { kind: "equipment"; qty: number; unitCents: number; cents: number; offeringId: string; label: string; unit: "hour" | "flat" };

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

export type EquipmentPick = { offeringId: string; qty: number };
export const equipmentPicksSchema: z.ZodType<EquipmentPick[]> = z
  .array(z.object({ offeringId: z.uuid(), qty: z.number().int().min(1).max(99) }).strict())
  .max(12)
  .refine((p) => new Set(p.map((x) => x.offeringId)).size === p.length, { message: "equipment repeats" });

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
