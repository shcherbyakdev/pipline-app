import { emailTranslators } from "@/i18n/emails";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import type { RangeMode } from "@/features/rentals/range";
import { resolveClientStaffName } from "@/lib/booking/public";
import { bookingReminderEmail, bookingLifecycleKey, whenLineFor } from "./templates";
import { bookingTitle } from "./booking-label";
import { DEFAULT_REMINDER_LEAD_HOURS, REMINDER_LEAD_HOURS, parseOrgPrefs, reminderPolicy } from "@/features/notifications/prefs";

// Booking reminder drain (chasing idiom): claim-before-send on
// reminder_sent_at, rollback + attempt-count on transport failure,
// transport-level dedupe via a stable idempotency key. All timing is
// injected — no clock reads inside decide.

/** The default lead (Free's only lead). An org may pick another from
    REMINDER_LEAD_HOURS on /notifications (spec 2026-09-05 §5). */
export const REMINDER_LEAD_MS = DEFAULT_REMINDER_LEAD_HOURS * 60 * 60 * 1000;
/** The query bound: the longest lead any org may choose. */
export const REMINDER_MAX_LEAD_MS = Math.max(...REMINDER_LEAD_HOURS) * 60 * 60 * 1000;
/** Sends per tick. */
export const REMINDER_BATCH_LIMIT = 25;
/** Rows read per tick. Wider than the send cap on purpose: with per-org
    leads the window holds rows that are not due yet ("wait"), and a
    starts_at-ordered page of 25 could be all of them while due rows from a
    long-lead org sit behind. ponytail: a 15-minute tick at today's volumes
    never fills 200; page by (starts_at, id) if it ever does. */
export const REMINDER_CANDIDATE_LIMIT = 200;
export const REMINDER_MAX_ATTEMPTS = 5;

export type ReminderSummary = { sent: number; skipped: number; failed: number };

export function decideReminder(
  booking: { startsAt: Date; createdAt: Date },
  now: Date,
  opts: { overQuota?: boolean; leadMs?: number; disabled?: boolean } = {},
): "send" | "suppress" | "wait" {
  // Stamped, never rescanned — same as every other suppress path below.
  // Reminders switched off (org prefs) are the same kind of "no": a booking
  // the drain reached while they were off never gets one.
  if (opts.overQuota || opts.disabled) return "suppress";
  const lead = booking.startsAt.getTime() - (opts.leadMs ?? REMINDER_LEAD_MS);
  if (now.getTime() >= booking.startsAt.getTime()) return "suppress";
  if (now.getTime() < lead) return "wait";
  // Booked inside the lead window: the confirmation email just arrived —
  // a reminder would be noise. Stamped (not skipped-forever-rescanned).
  if (booking.createdAt.getTime() > lead) return "suppress";
  return "send";
}

type CandidateRow = {
  id: string;
  org_id: string;
  client_email: string | null;
  starts_at: string;
  ends_at: string;
  created_at: string;
  reminder_attempts: number;
  rental_unit_id: string | null;
  // The language the client booked in (0072); null on every row written
  // before it existed and on admin-made bookings — then the org's.
  locale: string | null;
  services: { name: string } | null;
  // H2: range_mode alongside name — whenLineFor needs it to render an hourly
  // rental's when-line as a single-day time range instead of nights/days'
  // two-date range.
  rental_offerings: { name: string; range_mode: RangeMode } | null;
  rental_units: { name: string } | null;
  // notification_prefs (0075): the org's reminder on/off + lead; null =
  // the defaults (parseOrgPrefs).
  orgs: { name: string; timezone: string; locale: string; notification_prefs: unknown } | null;
  staff: { name: string } | null;
};

export async function runReminderDrain(deps: {
  db: SupabaseClient;
  transport: EmailTransport;
  now?: Date;
  // "Powered by Booklo" for this org's client mail, or null when its plan
  // lets it hide the badge and it did (lib/billing/queries.ts#emailBadgeUrl,
  // which the drain route injects). Optional: tests and any caller that does
  // not care get badge-free reminders, exactly as before billing. Called at
  // most once per org per tick (badgeUrlFor below); a rejected lookup
  // degrades to no badge: the badge is decoration, it must never burn one of
  // the row's five attempts.
  badgeFor?: (orgId: string) => Promise<string | null>;
  // Free-plan reminder quota (spec §7.10 / lib/billing/queries.ts +
  // entitlements.ts, which the drain route injects). Optional: tests and any
  // caller that does not care get unmetered reminders, exactly as before
  // billing. A failed check degrades to "not over quota" (send) — a missed
  // suppression beats a missed reminder.
  //
  // Asked PER BOOKING, with that booking's own created_at, because the quota
  // is ordinal: "reminders for the first 30 bookings each month" (spec §3)
  // asks whether THIS booking is the org's 31st or later, not whether the
  // org happens to be over 30 right now.
  quotaExceeded?: (orgId: string, timeZone: string, bookingCreatedAt: string) => Promise<boolean>;
  // May this org use a lead other than the default (the plan's
  // `customReminders` perk, lib/billing/plans.ts)? The route injects the
  // entitlement read while plans are enforced; tests and scripts get the
  // prefs as written. Asked once per org per tick. A failed check degrades
  // to the default lead — the safe reading of an unknown plan.
  customRemindersAllowed?: (orgId: string) => Promise<boolean>;
}): Promise<ReminderSummary> {
  const now = deps.now ?? new Date();
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  // Memoised per tick: the badge answer is per ORG (plan + the org's toggle),
  // so a batch of rows from one org shares a single lookup. Promises, not
  // values, so two rows resolved in the same pass can't both start one.
  const badgeCache = new Map<string, Promise<string | null>>();
  const badgeUrlFor = (orgId: string): Promise<string | null> => {
    const lookup = deps.badgeFor;
    if (!lookup) return Promise.resolve(null);
    let pending = badgeCache.get(orgId);
    if (!pending) {
      pending = lookup(orgId).catch(() => null);
      badgeCache.set(orgId, pending);
    }
    return pending;
  };

  // Team (multi-staff): the reminder carries the "With {staff}" line under
  // the same rule as every other client-facing mail. resolveClientStaffName
  // is the one place that rule lives (solo orgs never name a staff member;
  // it swallows its own errors → null, so a failed lookup costs the line,
  // never one of the row's attempts). Its answer is a per-ORG count, but the
  // name is per row, so the memo is keyed on both: one lookup per org per
  // staff member per tick, and the rule stays in one place instead of being
  // re-derived here to make the key org-only.
  const staffNameCache = new Map<string, Promise<string | null>>();
  const staffNameFor = (orgId: string, name: string | null): Promise<string | null> => {
    if (!name) return Promise.resolve(null);
    const key = `${orgId}/${name}`;
    let pending = staffNameCache.get(key);
    if (!pending) {
      pending = resolveClientStaffName(orgId, name);
      staffNameCache.set(key, pending);
    }
    return pending;
  };

  const customCache = new Map<string, Promise<boolean>>();
  const customAllowedFor = (orgId: string): Promise<boolean> => {
    const lookup = deps.customRemindersAllowed;
    if (!lookup) return Promise.resolve(true);
    let pending = customCache.get(orgId);
    if (!pending) {
      pending = lookup(orgId).catch((e) => {
        console.error("[scheduling] custom-reminders check failed (default lead):", e);
        return false;
      });
      customCache.set(orgId, pending);
    }
    return pending;
  };

  // The window is the LONGEST lead any org may choose; each row is then
  // judged against its own org's lead (a shorter one simply waits).
  const { data, error } = await deps.db
    .from("bookings")
    .select(
      "id, org_id, client_email, starts_at, ends_at, created_at, reminder_attempts, rental_unit_id, locale, services(name), rental_offerings(name, range_mode), rental_units(name), orgs(name, timezone, locale, notification_prefs), staff(name)",
    )
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .lt("reminder_attempts", REMINDER_MAX_ATTEMPTS)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + REMINDER_MAX_LEAD_MS).toISOString())
    .order("starts_at", { ascending: true })
    .limit(REMINDER_CANDIDATE_LIMIT);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as CandidateRow[]) {
    if (summary.sent + summary.failed >= REMINDER_BATCH_LIMIT) break;
    try {
      const policy = reminderPolicy(parseOrgPrefs(row.orgs?.notification_prefs), await customAllowedFor(row.org_id));
      let overQuota = false;
      if (deps.quotaExceeded) {
        try {
          overQuota = await deps.quotaExceeded(row.org_id, row.orgs?.timezone ?? "UTC", row.created_at);
        } catch (e) {
          // spec §7.10: a missed suppression beats a missed reminder.
          console.error("[scheduling] quota check failed (sending):", e);
        }
      }
      const decision = decideReminder(
        { startsAt: new Date(row.starts_at), createdAt: new Date(row.created_at) },
        now,
        { overQuota, leadMs: policy.leadMs, disabled: !policy.enabled },
      );
      if (decision === "wait") continue; // not due for THIS org's lead yet — untouched, next tick

      // Optimistic claim (chasing idiom): exactly one drain wins the row.
      const { data: claimed, error: claimError } = await deps.db
        .from("bookings")
        .update({ reminder_sent_at: now.toISOString() })
        .eq("id", row.id)
        .is("reminder_sent_at", null)
        .eq("status", "confirmed")
        .select("id");
      if (claimError) throw claimError;
      if (!claimed || claimed.length === 0) {
        summary.skipped += 1; // lost the race
        continue;
      }

      if (decision === "suppress" || !row.client_email) {
        summary.skipped += 1; // stamped, never rescanned (suppressed or no address)
        continue;
      }

      try {
        // The org's language (spec D4) — joined above, no extra read per row.
        // A reminder is a client mail: the client's language, the org's only
        // when the row has none (spec §4, amended 2026-09-03).
        const mail = await emailTranslators(row.locale ?? row.orgs?.locale);
        const msg = bookingReminderEmail(mail.t, {
          orgName: row.orgs?.name ?? "",
          serviceName: bookingTitle(row, mail.t("appointment")),
          whenLine: whenLineFor(
            {
              startsAt: new Date(row.starts_at),
              endsAt: new Date(row.ends_at),
              isRental: row.rental_unit_id !== null,
              rangeMode: row.rental_offerings?.range_mode ?? null,
            },
            row.orgs?.timezone ?? "UTC",
            mail.intlLocale,
          ),
          staffName: await staffNameFor(row.org_id, row.staff?.name ?? null),
          badgeUrl: await badgeUrlFor(row.org_id),
        });
        await deps.transport.send({
          to: row.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(row.id, "reminder"),
        });
        summary.sent += 1;
      } catch (sendError) {
        // Roll the claim back so the row is due next tick; cap attempts.
        const message = sendError instanceof Error ? sendError.message : String(sendError);
        const { error: rollbackError } = await deps.db
          .from("bookings")
          .update({
            reminder_sent_at: null,
            reminder_attempts: row.reminder_attempts + 1,
            reminder_last_error: message.slice(0, 500),
          })
          .eq("id", row.id)
          .eq("reminder_attempts", row.reminder_attempts);
        if (rollbackError) {
          console.error("[scheduling] reminder rollback failed (row stays claimed):", rollbackError);
        }
        summary.failed += 1;
      }
    } catch (rowError) {
      // Per-row isolation: one bad row never stops the batch.
      console.error("[scheduling] reminder row failed:", rowError);
      try {
        const message = rowError instanceof Error ? rowError.message : String(rowError);
        await deps.db
          .from("bookings")
          .update({
            reminder_sent_at: null,
            reminder_attempts: row.reminder_attempts + 1,
            reminder_last_error: message.slice(0, 500),
          })
          .eq("id", row.id)
          .eq("reminder_attempts", row.reminder_attempts);
      } catch {
        // best-effort: the console.error above is the last resort
      }
      summary.failed += 1;
    }
  }

  return summary;
}
