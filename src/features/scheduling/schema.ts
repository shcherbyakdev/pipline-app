import { z } from "zod";

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

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
});
export const updateServiceInput = serviceInput.extend({ id: z.uuid() });
export const serviceIdInput = z.object({ id: z.uuid() });

export const availabilityRuleInput = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });
export const ruleIdInput = z.object({ id: z.uuid() });

export const availabilityExceptionInput = z
  .object({
    date: z.string().regex(DATE_RE),
    closed: z.boolean(),
    startTime: timeField.optional(),
    endTime: timeField.optional(),
  })
  .refine(
    (e) =>
      e.closed
        ? e.startTime === undefined && e.endTime === undefined
        : e.startTime !== undefined && e.endTime !== undefined && e.startTime < e.endTime,
    { message: "closed day has no window; open exception needs an ordered window" },
  );
export const exceptionIdInput = z.object({ id: z.uuid() });

export const blockTimeInput = z
  .object({
    date: z.string().regex(DATE_RE),
    startTime: timeField,
    endTime: timeField,
  })
  .refine((r) => r.startTime < r.endTime, { message: "start must precede end" });

export const reopenDayInput = z.object({ date: z.string().regex(DATE_RE) });

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

export const getSlotsInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});

export const createBookingInput = z.object({
  handle: z.string().regex(HANDLE_RE),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  note: z.string().trim().max(2000).optional(),
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
});

export const adminSlotsInput = z.object({
  serviceId: z.uuid(),
  fromDate: z.string().regex(DATE_RE),
  days: z.number().int().min(1).max(31),
});
