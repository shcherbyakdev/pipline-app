import { z } from "zod";
import { STAFF_SLUG_RE } from "./staff-slug";

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

// An optional text input that was rendered but never filled arrives as "" —
// treat that as "not provided" rather than as an invalid value.
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

export const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const timeField = z.string().regex(TIME_RE);

export const serviceInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  durationMin: z.number().int().min(5).max(480),
  priceLabel: z.string().trim().max(100).optional(),
  bufferBeforeMin: z.number().int().min(0).max(240).default(0),
  bufferAfterMin: z.number().int().min(0).max(240).default(0),
  minNoticeMin: z.number().int().min(0).max(20160).default(0),
  maxPerDay: z.number().int().min(1).max(100).nullable().default(null),
  bookingWindowDays: z.number().int().min(1).max(365).default(60),
  active: z.boolean().default(true),
  // Team (multi-staff): who can be booked for this service. Optional, and the
  // absence is meaningful — a solo org's dialog never renders the checklist,
  // so `createService` assigns every active member and `updateService` leaves
  // the existing links alone. An empty array is a deliberate "nobody".
  staffIds: z.array(z.uuid()).optional(),
});
export const updateServiceInput = serviceInput.extend({ id: z.uuid() });
export const serviceIdInput = z.object({ id: z.uuid() });

// Team (multi-staff): hours and overrides hang off a person, not the org, so
// every input that creates such a row — or that is keyed by (staff, weekday)
// or (staff, date) — carries the staff id. Row-id-keyed inputs (`ruleIdInput`,
// `updateRuleInput`) don't: the row already knows whose it is.
export const availabilityRuleInput = z
  .object({
    staffId: z.uuid(),
    weekday: z.number().int().min(0).max(6),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });
export const ruleIdInput = z.object({ id: z.uuid() });

export const blockTimeInput = z
  .object({
    staffId: z.uuid(),
    date: z.string().regex(DATE_RE),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });

export const reopenDayInput = z.object({
  staffId: z.uuid(),
  date: z.string().regex(DATE_RE),
});

export const schedulingSettingsInput = z.object({
  // "" (cleared field) → null: the provider can unpublish the booking page
  // or set a timezone before ever choosing a handle (S1 deferral).
  // update_org_scheduling already accepts a null handle.
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.union([z.string().regex(HANDLE_RE), z.null()]),
  ),
  timezone: z.string().min(1).max(64),
});

// Team (multi-staff), admin side. `slug` is the person's booking-link name —
// same regex as the DB CHECK on staff.slug (0041). `email` is optional and
// normalised to lowercase here because that CHECK requires it (create_staff
// lowers it server-side; the plain UPDATE in updateStaff does not).
export const staffInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(STAFF_SLUG_RE),
  email: z.preprocess(
    (v) => (typeof v === "string" ? emptyToUndefined(v.toLowerCase()) : v),
    z.email().max(320).optional(),
  ),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  serviceIds: z.array(z.uuid()),
});
export const updateStaffInput = staffInput.extend({ id: z.uuid() });
export const staffActiveInput = z.object({ id: z.uuid(), active: z.boolean() });

export const LAST_ACTIVE_STAFF_ERROR = "You need at least one active team member.";
export const PLAN_LIMIT_STAFF_ERROR = "Team members are on the Team plan. Upgrade in Billing to add people.";
export const PLAN_LIMIT_SERVICES_ERROR = "Free includes 3 services. Upgrade in Billing for unlimited.";
/** The staff refusal, told by the cap the plan actually allows. One person =
    the plan has no team layer at all ("Team members are on the Team plan");
    more than one = the org IS on Team and has filled its seats, where that
    sentence would be nonsense. */
export function planLimitStaffError(max: number): string {
  return max === 1
    ? PLAN_LIMIT_STAFF_ERROR
    : `Your plan allows ${max} team members. Upgrade in Billing to add more.`;
}
export const STAFF_SLUG_TAKEN_ERROR = "That link name is already used.";
export function staffFutureBookingsError(name: string): string {
  return `${name} has upcoming bookings — move or cancel them first.`;
}

// Team (multi-staff): the public surface either names a staff member or asks
// for "any" (auto-assign). Defaulted rather than required so a solo org's
// widget — and any caller predating the team slice — keeps working; the
// parsed type is the same `"any" | uuid` either way.
export const staffChoice = z.union([z.literal("any"), z.uuid()]);

export const getSlotsInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
  staffId: staffChoice.default("any"),
});

export const createBookingInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  note: z.string().trim().max(2000).optional(),
  staffId: staffChoice.default("any"),
});

const tokenField = z.string().min(20).max(200);

export const manageTokenInput = z.object({ token: tokenField });

export const manageSlotsInput = z.object({
  token: tokenField,
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});

export const rescheduleBookingInput = z.object({
  token: tokenField,
  startsAt: z.iso.datetime(),
});

export const bookingIdInput = z.object({ id: z.uuid() });

export const adminRescheduleInput = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  // Team (multi-staff): a move may also hand the booking to someone else.
  // Optional — omitted means "same person, new time", which is all this
  // dialog could do before the team slice (the RPC's own default).
  staffId: z.uuid().optional(),
});

// Admin-side slots and walk-ins always name a person: unlike the public
// surface there is no "any" here — the dialogs pick a default and send it.
export const adminSlotsInput = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});

export const adminCreateBookingInput = z.object({
  serviceId: z.uuid(),
  staffId: z.uuid(),
  startsAt: z.iso.datetime(),
  // Per-booking span (calendar dialog's editable end time); omitted =
  // service duration, matching the RPC default.
  durationMin: z.number().int().min(5).max(480).optional(),
  name: z.string().trim().min(1).max(200),
  // "" (untouched optional field) → undefined, mirroring the handle preprocess.
  email: z.preprocess(emptyToUndefined, z.email().max(320).optional()),
  note: z.string().trim().max(2000).optional(),
});

export const OVERLAP_ERROR = "Times overlap with another set of times.";

export const updateRuleInput = z
  .object({ id: z.uuid(), startTime: timeField, endTime: timeField })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });

export const copyDayHoursInput = z
  .object({
    staffId: z.uuid(),
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
    staffId: z.uuid(),
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

export const deleteOverrideInput = z.object({
  staffId: z.uuid(),
  date: z.string().regex(DATE_RE),
});
