import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import { bookingReminderEmail, bookingLifecycleKey, whenLineFor } from "./templates";
import { bookingTitle } from "./booking-label";

// Booking reminder drain (chasing idiom): claim-before-send on
// reminder_sent_at, rollback + attempt-count on transport failure,
// transport-level dedupe via a stable idempotency key. All timing is
// injected — no clock reads inside decide.

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
export const REMINDER_BATCH_LIMIT = 25;
export const REMINDER_MAX_ATTEMPTS = 5;

export type ReminderSummary = { sent: number; skipped: number; failed: number };

export function decideReminder(
  booking: { startsAt: Date; createdAt: Date },
  now: Date,
  opts: { overQuota?: boolean } = {},
): "send" | "suppress" | "wait" {
  // Stamped, never rescanned — same as every other suppress path below.
  if (opts.overQuota) return "suppress";
  const lead = booking.startsAt.getTime() - REMINDER_LEAD_MS;
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
  services: { name: string } | null;
  rental_offerings: { name: string } | null;
  rental_units: { name: string } | null;
  orgs: { name: string; timezone: string } | null;
};

export async function runReminderDrain(deps: {
  db: SupabaseClient;
  transport: EmailTransport;
  now?: Date;
  // "Powered by Booklo" for this org's client mail, or null when its plan
  // lets it hide the badge and it did (lib/billing/queries.ts#emailBadgeUrl,
  // which the drain route injects). Optional: tests and any caller that does
  // not care get badge-free reminders, exactly as before billing. A rejected
  // lookup degrades to no badge (`.catch` at the call site): the badge is
  // decoration, it must never burn one of the row's five attempts.
  badgeFor?: (orgId: string) => Promise<string | null>;
  // Free-plan reminder quota (spec §7.10 / lib/billing/queries.ts +
  // entitlements.ts, which the drain route injects). Optional: tests and any
  // caller that does not care get unmetered reminders, exactly as before
  // billing. A failed check degrades to "not over quota" (send) — a missed
  // suppression beats a missed reminder.
  quotaExceeded?: (orgId: string, timeZone: string) => Promise<boolean>;
}): Promise<ReminderSummary> {
  const now = deps.now ?? new Date();
  const summary: ReminderSummary = { sent: 0, skipped: 0, failed: 0 };
  // Memoised per tick: every row for the same org shares one quota read.
  const quotaCache = new Map<string, boolean>();

  const { data, error } = await deps.db
    .from("bookings")
    .select(
      "id, org_id, client_email, starts_at, ends_at, created_at, reminder_attempts, rental_unit_id, services(name), rental_offerings(name), rental_units(name), orgs(name, timezone)",
    )
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .lt("reminder_attempts", REMINDER_MAX_ATTEMPTS)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + REMINDER_LEAD_MS).toISOString())
    .order("starts_at", { ascending: true })
    .limit(REMINDER_BATCH_LIMIT);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as CandidateRow[]) {
    try {
      let overQuota = quotaCache.get(row.org_id);
      if (overQuota === undefined) {
        overQuota = false;
        if (deps.quotaExceeded) {
          try {
            overQuota = await deps.quotaExceeded(row.org_id, row.orgs?.timezone ?? "UTC");
          } catch (e) {
            // spec §7.10: a missed suppression beats a missed reminder.
            console.error("[scheduling] quota check failed (sending):", e);
          }
        }
        quotaCache.set(row.org_id, overQuota);
      }
      const decision = decideReminder(
        { startsAt: new Date(row.starts_at), createdAt: new Date(row.created_at) },
        now,
        { overQuota },
      );
      if (decision === "wait") continue; // defensive: query bounds already exclude

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
        const msg = bookingReminderEmail({
          orgName: row.orgs?.name ?? "Your provider",
          serviceName: bookingTitle(row),
          whenLine: whenLineFor(
            {
              startsAt: new Date(row.starts_at),
              endsAt: new Date(row.ends_at),
              isRental: row.rental_unit_id !== null,
            },
            row.orgs?.timezone ?? "UTC",
          ),
          badgeUrl: deps.badgeFor ? await deps.badgeFor(row.org_id).catch(() => null) : null,
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
