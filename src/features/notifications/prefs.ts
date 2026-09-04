import { z } from "zod";

/* Notification preferences (spec 2026-09-05). Two shapes, two homes:
   MemberPrefs = what a PERSON hears about (org_members.notification_prefs),
   OrgPrefs = what the org's CLIENTS receive (orgs.notification_prefs). Both
   columns are nullable and null means "defaults", so every row written
   before this slice behaves exactly as it did. Pure: no I/O, no clock. The
   two definer RPCs in 0075 validate the same keys and values in SQL. */

export const MEMBER_EVENTS = ["newBooking", "newRequest", "cancelled", "rescheduled"] as const;
export type MemberEvent = (typeof MEMBER_EVENTS)[number];
export type Channel = "email" | "push";
export type ChannelPrefs = Record<Channel, boolean>;
export type MemberPrefs = Record<MemberEvent, ChannelPrefs>;

const channelPrefsSchema = z.object({ email: z.boolean(), push: z.boolean() });

export const memberPrefsSchema = z.object({
  newBooking: channelPrefsSchema,
  newRequest: channelPrefsSchema,
  cancelled: channelPrefsSchema,
  rescheduled: channelPrefsSchema,
}) satisfies z.ZodType<MemberPrefs>;

/** Email is today's behaviour; push is on so the first enabled device just
    works. Nothing is sent on a channel the member has no address/device for. */
export const DEFAULT_MEMBER_PREFS: MemberPrefs = Object.freeze({
  newBooking: { email: true, push: true },
  newRequest: { email: true, push: true },
  cancelled: { email: true, push: true },
  rescheduled: { email: true, push: true },
}) as MemberPrefs;

/** Tolerant on the way in: a partial or half-written object keeps defaults
    for what it lacks (a column written by an older build must never switch
    an event off by accident). Strict on the way out — the RPC gets the full
    object. */
export function parseMemberPrefs(raw: unknown): MemberPrefs {
  const src = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as MemberPrefs;
  for (const event of MEMBER_EVENTS) {
    const got = channelPrefsSchema.partial().safeParse(src[event]);
    out[event] = { ...DEFAULT_MEMBER_PREFS[event], ...(got.success ? got.data : {}) };
  }
  return out;
}

export function setMemberChannel(prefs: MemberPrefs, event: MemberEvent, channel: Channel, enabled: boolean): MemberPrefs {
  return { ...prefs, [event]: { ...prefs[event], [channel]: enabled } };
}

export const REMINDER_LEAD_HOURS = [1, 2, 3, 6, 12, 24, 48] as const;
export type ReminderLeadHours = (typeof REMINDER_LEAD_HOURS)[number];
export const DEFAULT_REMINDER_LEAD_HOURS: ReminderLeadHours = 24;

export type OrgPrefs = { reminder: { enabled: boolean; leadHours: ReminderLeadHours } };

export const orgPrefsSchema = z.object({
  reminder: z.object({
    enabled: z.boolean(),
    leadHours: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6), z.literal(12), z.literal(24), z.literal(48)]),
  }),
}) satisfies z.ZodType<OrgPrefs>;

export const DEFAULT_ORG_PREFS: OrgPrefs = Object.freeze({
  reminder: { enabled: true, leadHours: DEFAULT_REMINDER_LEAD_HOURS },
}) as OrgPrefs;

export function parseOrgPrefs(raw: unknown): OrgPrefs {
  const got = orgPrefsSchema.safeParse(raw);
  return got.success ? got.data : DEFAULT_ORG_PREFS;
}

export type ReminderPolicy = { enabled: boolean; leadMs: number };

/** What the drain acts on. `customAllowed` is the plan's `customReminders`
    perk (false pins the lead to the default): enforced here, at read time,
    so a lapsed Pro falls back on its own — the badge idiom. */
export function reminderPolicy(prefs: OrgPrefs, customAllowed: boolean): ReminderPolicy {
  const hours = customAllowed ? prefs.reminder.leadHours : DEFAULT_REMINDER_LEAD_HOURS;
  return { enabled: prefs.reminder.enabled, leadMs: hours * 3_600_000 };
}
