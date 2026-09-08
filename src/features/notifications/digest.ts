import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport } from "@/lib/email/transport";
import { emailTranslators } from "@/i18n/emails";
import { formatMoney } from "@/lib/money";
import { loadDailyList } from "@/features/scheduling/daily-list";
import { formatUntil, whenLineFor, type DigestRow } from "@/features/scheduling/templates";
import type { AdminBooking } from "@/features/scheduling/queries";
import { notifyMembers } from "./notify";
import type { PushPayload } from "./push";

/* S4 morning digest (spec 2026-09-08 §Digest). Drain phase: the orgs past
   08:00 local time and not yet stamped for their local date come back from
   digest_due_orgs() (the hour lives there too — keep the two in step); each
   is CLAIMED by stamping its local date (one tick wins, the reminders.ts
   idiom), the list is loaded with the admin client, an empty list is
   skipped, anything else goes to notifyMembers as one dailyDigest notice.
   A failed send is not retried today: the stamp stands, the summary and the
   Worker's healthcheck make it visible. */

export const DIGEST_LOCAL_HOUR = 8; // mirrors digest_due_orgs() in 0083
export const DIGEST_BATCH = 25; // mirrors the RPC's LIMIT

type DueOrg = { id: string; name: string; timezone: string; locale: string; local_date: string };

export async function runDailyDigest(deps: {
  db: SupabaseClient;
  transport?: EmailTransport;
  push?: (userId: string, payload: PushPayload) => Promise<unknown>;
  now?: Date;
}): Promise<{ sent: number; skipped: number; failed: number }> {
  const now = deps.now ?? new Date();
  const { data, error } = await deps.db.rpc("digest_due_orgs");
  if (error) throw error;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const org of ((data ?? []) as DueOrg[]).slice(0, DIGEST_BATCH)) {
    try {
      // The claim: only the tick that moves the stamp forward proceeds.
      // Two conditional updates, not one `.or(...)`: against this stack's
      // PostgREST, an `or=` filter on an UPDATE+select is evaluated against
      // the RETURNING row (post-update), so "digest_sent_on.is.null" can
      // never match once the same request just set it — the update claims
      // 0 rows every time (reproduced directly: plain `.is()`/`.lt()`
      // filters are evaluated pre-update and work correctly; `.or()` does
      // not). Never-sent and stale-stamped are therefore two attempts.
      const claimNever = await deps.db.from("orgs").update({ digest_sent_on: org.local_date }).eq("id", org.id).is("digest_sent_on", null).select("id");
      if (claimNever.error) throw claimNever.error;
      let claimed = claimNever.data;
      if (!claimed || claimed.length === 0) {
        const claimStale = await deps.db
          .from("orgs")
          .update({ digest_sent_on: org.local_date })
          .eq("id", org.id)
          .lt("digest_sent_on", org.local_date)
          .select("id");
        if (claimStale.error) throw claimStale.error;
        claimed = claimStale.data;
      }
      if (!claimed || claimed.length === 0) continue;

      const mail = await emailTranslators(org.locale);
      const list = await loadDailyList(deps.db, org.id, mail.t("digest.fallbackTitle"), now);
      if (list.requests.length + list.holds.length + list.balances.length === 0) {
        skipped++;
        continue;
      }
      const when = (b: AdminBooking) =>
        whenLineFor(
          { startsAt: new Date(b.startsAt), endsAt: new Date(b.endsAt), isRental: b.rentalUnitId !== null, rangeMode: b.rangeMode },
          org.timezone,
          mail.intlLocale,
        );
      const money = (cents: number, currency: string | null) => formatMoney(cents, currency ?? "PLN");
      const requests: DigestRow[] = list.requests.map((b) => ({ clientName: b.clientName, whenLine: when(b), note: b.serviceName }));
      const holds: DigestRow[] = list.holds.map((b) => {
        const deadline = b.holdExpiresAt ? new Date(b.holdExpiresAt) : null;
        const amount = money(b.depositCents ?? 0, b.currency);
        const note =
          deadline && deadline.getTime() > now.getTime()
            ? mail.t("digest.deposit", { amount, time: formatUntil(deadline, org.timezone, mail.intlLocale) })
            : mail.t("digest.lapsed", { amount });
        return { clientName: b.clientName, whenLine: when(b), note };
      });
      const balances: DigestRow[] = list.balances.map((b) => ({
        clientName: b.clientName,
        whenLine: when(b),
        note: mail.t("digest.due", { amount: money(b.balanceCents, b.currency) }),
      }));

      await notifyMembers(
        { event: "dailyDigest", orgId: org.id, idempotencyKey: `digest:${org.id}:${org.local_date}`, requests, holds, balances },
        { db: deps.db, transport: deps.transport, push: deps.push },
      );
      sent++;
    } catch (error) {
      console.error(`[digest] org ${org.id} failed:`, error);
      failed++;
    }
  }
  return { sent, skipped, failed };
}
