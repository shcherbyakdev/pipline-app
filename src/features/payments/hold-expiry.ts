import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { EmailTransport } from "@/lib/email/transport";
import type { PaymentsProvider } from "@/lib/payments/provider";
import { emailTranslators } from "@/i18n/emails";
import { emailBadgeUrl } from "@/lib/billing/queries";
import { withUnit } from "@/features/rentals/unit-label";
import { bookingLifecycleKey, holdExpiredEmail, whenLineFor } from "@/features/scheduling/templates";
import { expireOpenCheckouts } from "./checkout";
import type { RangeMode } from "@/features/rentals/range";

export const HOLD_EXPIRY_BATCH = 25;

type Row = {
  id: string;
  org_id: string;
  client_email: string | null;
  locale: string | null;
  starts_at: string;
  ends_at: string;
  rental_offerings: { name: string; range_mode: RangeMode } | null;
  rental_units: { name: string } | null;
  orgs: { name: string; handle: string; timezone: string; locale: string } | null;
};

/** Drain phase (spec §Flows): flip lapsed holds to 'expired' (the durable
    part — the slot is free from this instant), expire their open Checkout
    sessions best-effort, mail the client once. No retry path: a mail that
    fails is logged; the flip already happened.
    ponytail: the drain runs every 15 min, so a lapsed hold can block its slot
    up to 15 min longer — a sweep inside the create RPCs is the upgrade. */
export async function runHoldExpiry(deps: {
  db: SupabaseClient;
  transport: EmailTransport;
  provider?: PaymentsProvider;
  now?: Date;
}): Promise<{ expired: number; mailed: number; failed: number }> {
  const now = deps.now ?? new Date();
  const { data: due, error: dueError } = await deps.db
    .from("bookings")
    .select("id")
    .eq("status", "pending_payment")
    .lte("hold_expires_at", now.toISOString())
    .order("hold_expires_at")
    .limit(HOLD_EXPIRY_BATCH);
  if (dueError) throw dueError;
  const ids = (due ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { expired: 0, mailed: 0, failed: 0 };
  // The claim: exactly one tick wins each row (reminders.ts idiom).
  const { data: claimed, error } = await deps.db
    .from("bookings")
    .update({ status: "expired" })
    .in("id", ids)
    .eq("status", "pending_payment")
    .select(
      "id, org_id, client_email, locale, starts_at, ends_at, rental_offerings(name, range_mode), rental_units(name), orgs(name, handle, timezone, locale)",
    );
  if (error) throw error;
  let mailed = 0;
  let failed = 0;
  for (const raw of (claimed ?? []) as unknown as Row[]) {
    await expireOpenCheckouts(raw.id, { db: deps.db, provider: deps.provider });
    if (!raw.client_email || !raw.orgs) continue;
    try {
      const client = await emailTranslators(raw.locale ?? raw.orgs.locale);
      const msg = holdExpiredEmail(client.t, {
        orgName: raw.orgs.name,
        serviceName: withUnit(raw.rental_offerings?.name ?? "", raw.rental_units?.name ?? null),
        whenLine: whenLineFor(
          {
            startsAt: new Date(raw.starts_at),
            endsAt: new Date(raw.ends_at),
            isRental: true,
            rangeMode: raw.rental_offerings?.range_mode ?? null,
          },
          raw.orgs.timezone,
          client.intlLocale,
        ),
        bookAgainUrl: `${env.NEXT_PUBLIC_APP_URL}/${raw.orgs.handle}`,
        badgeUrl: await emailBadgeUrl(raw.org_id),
      });
      await deps.transport.send({
        to: raw.client_email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        idempotencyKey: bookingLifecycleKey(raw.id, "hold-expired"),
      });
      mailed += 1;
    } catch (e) {
      failed += 1;
      console.error("[payments] hold-expired mail failed:", e);
    }
  }
  return { expired: (claimed ?? []).length, mailed, failed };
}
