import { z } from "zod";
import { TIME_RE, HANDLE_RE } from "@/features/scheduling/schema";
import { daysBetween } from "./range";
export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const RANGE_MODES = ["nights", "days", "hours"] as const;
export const UNIT_SELECTIONS = ["auto", "client_picks"] as const;

const offeringCommon = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priceLabel: z.string().trim().max(100).optional(),
  bookingWindowDays: z.number().int().min(1).max(730).default(180),
  unitSelection: z.enum(UNIT_SELECTIONS).default("auto"),
  active: z.boolean().default(true),
});
const rangeFields = z.object({
  rangeMode: z.enum(["nights", "days"]),
  startTime: z.string().regex(TIME_RE),
  endTime: z.string().regex(TIME_RE),
  minStay: z.number().int().min(1).max(365).default(1),
  maxStay: z.number().int().min(1).max(365).nullable().default(null),
  turnoverDays: z.number().int().min(0).max(30).default(0),
  minNoticeDays: z.number().int().min(0).max(365).default(0),
});
const hoursFields = z.object({
  rangeMode: z.literal("hours"),
  slotIncrementMin: z.number().int().min(5).max(240),
  minDurationMin: z.number().int().min(5).max(1440),
  maxDurationMin: z.number().int().min(5).max(1440),
  turnoverMin: z.number().int().min(0).max(1440).default(0),
  minNoticeMin: z.number().int().min(0).max(43200).default(0),
});
const stayOrder = (o: { minStay: number; maxStay: number | null }) =>
  o.maxStay === null || o.maxStay >= o.minStay;
export const HOURS_GRID_MSG = "durations must be multiples of the increment, max ≥ min";
const hoursGrid = (o: z.infer<typeof hoursFields>) =>
  o.maxDurationMin >= o.minDurationMin &&
  o.minDurationMin % o.slotIncrementMin === 0 &&
  o.maxDurationMin % o.slotIncrementMin === 0;

// `strict()` on each branch so hours fields on a nights offering (and vice
// versa) are rejected rather than silently dropped.
const rangeOffering = offeringCommon.extend(rangeFields.shape).strict()
  .refine(stayOrder, { message: "max stay must be ≥ min stay" });
const hoursOffering = offeringCommon.extend(hoursFields.shape).strict()
  .refine(hoursGrid, { message: HOURS_GRID_MSG });
export const offeringInput = z.union([rangeOffering, hoursOffering]);
export const updateOfferingInput = z.union([
  offeringCommon.extend(rangeFields.shape).extend({ id: z.uuid() }).strict()
    .refine(stayOrder, { message: "max stay must be ≥ min stay" }),
  offeringCommon.extend(hoursFields.shape).extend({ id: z.uuid() }).strict()
    .refine(hoursGrid, { message: HOURS_GRID_MSG }),
]);
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

export const BLACKOUT_ORDER_MSG = "end must not precede start";
export const BLACKOUT_SPAN_MSG = "Blackout can span at most 2 years";

export const blackoutInput = z
  .object({
    offeringId: z.uuid(), // revalidatePath only
    rentalUnitId: z.uuid(),
    startDate: z.string().regex(DATE_RE),
    endDate: z.string().regex(DATE_RE),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.endDate >= b.startDate, { message: BLACKOUT_ORDER_MSG })
  // Bound the span server-side: the availability engine reasons in days, and
  // an open-ended blackout is never a legitimate input.
  .refine((b) => b.endDate < b.startDate || daysBetween(b.startDate, b.endDate) <= 730, {
    message: BLACKOUT_SPAN_MSG,
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

// ---------- Reschedule (R2), client + admin. Same reasons as DATES_TAKEN:
// a "use server" module may only export async functions, so the shared copy
// lives here where both the actions and their dialogs can reach it.

// A stay that has begun is immovable (0039 raises 'started').
export const STAY_STARTED = "This stay has already started.";
// The RPCs also refuse a stay whose check-in has already passed (`v_starts
// <= now()`), which comes back as the uniform 'not found' raise — the app
// says what actually went wrong where it can tell.
export const CHECK_IN_PASSED = "That check-in time has already passed — pick a later date.";

// Token-scoped manage surface: the booking is identified by its cancel
// token, so neither shape carries a handle or an offering id.
export const manageRangeAvailabilityInput = z.object({
  token: z.string().min(20).max(200),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(93),
});
export const rescheduleRentalInput = z.object({
  token: z.string().min(20).max(200),
  unitId: z.uuid().nullable(),
  startDate: z.string().regex(DATE_RE),
  endDate: z.string().regex(DATE_RE),
});

// ---------- Admin (R2). Same shapes minus the handle — the org comes from
// the session — and with the client's email made optional (walk-ins).

export const adminRangeAvailabilityInput = z.object({
  offeringId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(93),
  // The booking being moved: its own occupancy is ignored so the dates it
  // currently holds read as free.
  excludeBookingId: z.uuid().nullable().default(null),
});
export const rescheduleRentalAdminInput = z.object({
  id: z.uuid(),
  unitId: z.uuid().nullable(),
  startDate: z.string().regex(DATE_RE),
  endDate: z.string().regex(DATE_RE),
});
export const createRentalAdminInput = z.object({
  offeringId: z.uuid(),
  unitId: z.uuid().nullable(),
  startDate: z.string().regex(DATE_RE),
  endDate: z.string().regex(DATE_RE),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320).optional(),
  note: z.string().trim().max(2000).optional(),
});
