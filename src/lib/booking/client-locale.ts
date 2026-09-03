import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "@/i18n/config";
import { publicLocale } from "@/i18n/public";
import { emailTranslators, type EmailsT } from "@/i18n/emails";
import type { Translator } from "@/i18n/translator";
import { bookingTitle } from "@/features/scheduling/booking-label";
import { whenLineFor } from "@/features/scheduling/templates";
import type { RangeMode } from "@/features/rentals/range";

type EmailsUnitsT = Translator<"public.units">;

/* The language the CLIENT booked in (0072). Stamped on the fresh row by the
   three public create actions, so the mails that arrive later — the reminder
   drain, an accept or decline, a provider-side move — can still speak it.

   Resolved exactly like the page the visitor was looking at: `?lang=` off
   the proxy's x-pathname, then their region, then the org (i18n spec §4).
   It is written even when it equals the org's language: the row records
   what the client actually saw, so an org that later switches languages
   does not retro-translate mail about a booking already made.

   Best-effort, like everything past the RPC — the booking is committed and
   nothing here may fail the action. A failed write leaves NULL, which every
   reader treats as "the org's language": exactly the old behaviour. */
export async function stampBookingLocale(
  admin: SupabaseClient,
  bookingId: string,
  orgLocale: string | null | undefined,
): Promise<Locale> {
  const locale = await publicLocale(orgLocale);
  const { error } = await admin.from("bookings").update({ locale }).eq("id", bookingId);
  if (error) console.error("[i18n] booking locale stamp failed:", error);
  return locale;
}

/** A booking row as the lifecycle mails read it, plus the stamped locale. */
export type ClientMailRow = {
  starts_at: string;
  ends_at: string;
  rental_unit_id: string | null;
  locale: string | null;
  services?: { name: string } | null;
  rental_offerings?: { name: string; range_mode?: RangeMode | null } | null;
  rental_units?: { name: string } | null;
};

/** The client's half of a lifecycle mail (cancel, accept, decline …): the
    translator for the language they booked in, and the two strings that are
    formatted in it. The provider's and the staff member's copies keep the
    org's own translator — same booking, two languages. */
export async function clientMailCopy(
  row: ClientMailRow,
  org: { locale: string; timezone: string },
): Promise<{ t: EmailsT; tUnits: EmailsUnitsT; intlLocale: string; serviceName: string; whenLine: string }> {
  const mail = await emailTranslators(row.locale ?? org.locale);
  return {
    t: mail.t,
    // The money lines' units ("night", "hour") are client copy too.
    tUnits: mail.tUnits,
    intlLocale: mail.intlLocale,
    serviceName: bookingTitle(row, mail.t("appointment")),
    whenLine: whenLineFor(
      {
        startsAt: new Date(row.starts_at),
        endsAt: new Date(row.ends_at),
        isRental: row.rental_unit_id !== null,
        rangeMode: row.rental_offerings?.range_mode ?? null,
      },
      org.timezone,
      mail.intlLocale,
    ),
  };
}
