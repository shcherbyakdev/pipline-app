import { z } from "zod";
import { TIME_RE, HANDLE_RE } from "@/features/scheduling/schema";
import { daysBetween } from "./range";
export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RANGE_MODES = ["nights", "days"] as const;
export const UNIT_SELECTIONS = ["auto", "client_picks"] as const;

const offeringBase = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priceLabel: z.string().trim().max(100).optional(),
  rangeMode: z.enum(RANGE_MODES),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  minStay: z.number().int().min(1).max(365).default(1),
  maxStay: z.number().int().min(1).max(365).nullable().default(null),
  turnoverDays: z.number().int().min(0).max(30).default(0),
  minNoticeDays: z.number().int().min(0).max(365).default(0),
  bookingWindowDays: z.number().int().min(1).max(730).default(180),
  unitSelection: z.enum(UNIT_SELECTIONS).default("auto"),
  active: z.boolean().default(true),
});
const stayOrder = (o: { minStay: number; maxStay: number | null }) => o.maxStay === null || o.maxStay >= o.minStay;
export const offeringInput = offeringBase.refine(stayOrder, { message: "max stay must be ≥ min stay" });
export const updateOfferingInput = offeringBase.extend({ id: z.uuid() }).refine(stayOrder, { message: "max stay must be ≥ min stay" });
export const offeringIdInput = z.object({ id: z.uuid() });

export const unitInput = z.object({
  offeringId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  active: z.boolean().default(true),
});
export const updateUnitInput = z.object({
  id: z.uuid(),
  offeringId: z.uuid(), // for revalidatePath only; the write is scoped by id + org
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  active: z.boolean().default(true),
});
export const unitIdInput = z.object({ id: z.uuid(), offeringId: z.uuid() });

export const blackoutInput = z
  .object({
    offeringId: z.uuid(), // revalidatePath only
    rentalUnitId: z.uuid(),
    startDate: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.endDate >= b.startDate, { message: "end must not precede start" })
  // Bound the span server-side: the availability engine reasons in days, and
  // an open-ended blackout is never a legitimate input.
  .refine((b) => b.endDate < b.startDate || daysBetween(b.startDate, b.endDate) <= 730, {
    message: "Blackout can span at most 2 years",
  });
export const blackoutIdInput = z.object({ id: z.uuid(), offeringId: z.uuid() });

// Lives here, not in public-actions.ts: a file-level "use server" module may
// only export async functions, and the public booking UI needs this string to
// recognise a lost-dates failure.
export const DATES_TAKEN = "Those dates were just taken — please pick again.";

export const getRangeAvailabilityInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  offeringId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(93),
});
export const createRentalBookingInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  offeringId: z.uuid(),
  unitId: z.uuid().nullable(),
  startDate: z.string().regex(DATE_RE),
  endDate: z.string().regex(DATE_RE),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  note: z.string().trim().max(2000).optional(),
});
