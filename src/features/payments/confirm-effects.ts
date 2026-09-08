import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectTransport, type EmailTransport } from "@/lib/email/transport";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { notifyMembers } from "@/features/notifications/notify";
import { kickCalendarSync } from "@/features/calendar-sync/run";
import { withUnit } from "@/features/rentals/unit-label";
import { moneyInfoLines } from "@/features/rentals/pricing";
import type { Line } from "@/features/rentals/pricing-rules";
import type { CancelPolicy } from "@/features/rentals/cancel-policy";
import { bookingLifecycleKey, paymentReceivedEmail, whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

const COLS =
  "id, org_id, client_name, client_email, starts_at, ends_at, rental_unit_id, locale, note, price_cents, currency, deposit_cents, cancel_policy, fee_cents, paid_cents, refunded_cents, lines, rental_offerings(name, range_mode), rental_units(name), orgs(name, timezone, locale)";

type Row = {
  id: string;
  org_id: string;
  client_name: string;
  client_email: string | null;
  starts_at: string;
  ends_at: string;
  rental_unit_id: string | null;
  locale: string | null;
  note: string | null;
  price_cents: number | null;
  currency: string | null;
  deposit_cents: number | null;
  cancel_policy: CancelPolicy | null;
  fee_cents: number;
  paid_cents: number;
  refunded_cents: number;
  lines: unknown;
  rental_offerings: { name: string; range_mode: RangeMode } | null;
  rental_units: { name: string } | null;
  orgs: { name: string; timezone: string; locale: string } | null;
};

/** Everything a confirmation-by-payment triggers (spec §Flows, "one helper"):
    the client's payment-received mail (no manage link — the raw token is
    never stored), the provider's newBooking notice, the Google mirror.
    Best effort: logs, never throws. */
export async function sendPaymentReceived(
  bookingId: string,
  deps: { db?: SupabaseClient; transport?: EmailTransport } = {},
): Promise<void> {
  const db = deps.db ?? createAdminClient();
  try {
    const { data, error } = await db.from("bookings").select(COLS).eq("id", bookingId).maybeSingle();
    if (error || !data) {
      console.error("[payments] sendPaymentReceived read:", error);
      return;
    }
    const row = data as unknown as Row;
    const org = row.orgs!;
    const serviceName = withUnit(row.rental_offerings?.name ?? "", row.rental_units?.name ?? null);
    const client = await emailTranslators(row.locale ?? org.locale);
    const mail = await emailTranslators(org.locale);
    const b = {
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      isRental: row.rental_unit_id !== null,
      rangeMode: row.rental_offerings?.range_mode ?? null,
    };
    const money = {
      totalCents: row.price_cents,
      depositCents: row.deposit_cents,
      currency: row.currency,
      cancelPolicy: row.cancel_policy,
      feeCents: row.fee_cents,
      lines: (row.lines as Line[] | null) ?? null,
      paidCents: row.paid_cents,
      refundedCents: row.refunded_cents,
    };
    kickCalendarSync(row.org_id);
    if (row.client_email) {
      try {
        const msg = paymentReceivedEmail(client.t, {
          orgName: org.name,
          serviceName,
          whenLine: whenLineFor(b, org.timezone, client.intlLocale),
          badgeUrl: await emailBadgeUrl(row.org_id),
          infoLines: moneyInfoLines(money, client.tUnits),
        });
        await (deps.transport ?? selectTransport()).send({
          to: row.client_email,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          idempotencyKey: bookingLifecycleKey(row.id, "payment-received"),
        });
      } catch (e) {
        console.error("[payments] payment-received mail failed:", e);
      }
    }
    await notifyMembers(
      {
        orgId: row.org_id,
        event: "newBooking",
        serviceName,
        clientName: row.client_name,
        clientEmail: row.client_email ?? "",
        whenLine: whenLineFor(b, org.timezone, mail.intlLocale),
        note: row.note,
        infoLines: moneyInfoLines(money, mail.tUnits),
        idempotencyKey: bookingLifecycleKey(row.id, "provider-new"),
      },
      { db, transport: deps.transport },
    );
  } catch (e) {
    console.error("[payments] sendPaymentReceived:", e);
  }
}
