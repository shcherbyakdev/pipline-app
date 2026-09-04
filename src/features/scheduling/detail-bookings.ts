import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { bookingTitle } from "./booking-label";

/** One appointment as a detail page lists it (a person's, a service's). */
export type DetailBookingRow = {
  id: string;
  title: string;
  clientName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
};

const LIMIT = 20;
const COLS = "id, client_name, starts_at, ends_at, status, note, services(name)";

/** Appointments for one owner column — `staff_id` (a person's page) or
    `service_id` (a service's) — split around now by /bookings' own rule
    (listBookings in queries.ts): "Upcoming" is a confirmed appointment not
    yet ENDED (one in progress is still coming) or a request whose start is
    still ahead; "Recent" is every terminal row whatever its date, every
    confirmed one that has ended, and every request whose start has passed —
    lapsed, the approval RPC refuses it — so the two pages never disagree
    and nothing falls between the lists. Both sides are capped so a full
    calendar stays two small reads. Rental stays carry neither column, so
    this is appointments only by construction. */
export async function listDetailBookings(
  column: "staff_id" | "service_id",
  id: string,
  now: Date = new Date(),
): Promise<{ upcoming: DetailBookingRow[]; recent: DetailBookingRow[] }> {
  const supabase = await createClient();
  const iso = now.toISOString();
  const [upRes, pastRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(COLS)
      .eq(column, id)
      .or(`status.eq.confirmed,and(status.eq.pending,starts_at.gt.${iso})`)
      .gte("ends_at", iso)
      .order("starts_at")
      .limit(LIMIT),
    supabase
      .from("bookings")
      .select(COLS)
      .eq(column, id)
      .or(
        `status.in.(cancelled_by_client,cancelled_by_provider,rescheduled,declined),` +
          `and(status.eq.confirmed,ends_at.lt.${iso}),` +
          `and(status.eq.pending,starts_at.lte.${iso})`,
      )
      .order("starts_at", { ascending: false })
      .limit(LIMIT),
  ]);
  if (upRes.error) throw upRes.error;
  if (pastRes.error) throw pastRes.error;
  type Row = {
    id: string;
    client_name: string;
    starts_at: string;
    ends_at: string;
    status: string;
    note: string | null;
    services: { name: string } | null;
  };
  // A deleted service leaves no name; the word is the admin's (bookings.fallbackTitle).
  const fallbackTitle = (await getTranslations("bookings"))("fallbackTitle");
  const map = (rows: unknown): DetailBookingRow[] =>
    ((rows ?? []) as Row[]).map((b) => ({
      id: b.id,
      title: bookingTitle(b, fallbackTitle),
      clientName: b.client_name,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      status: b.status,
      note: b.note,
    }));
  return { upcoming: map(upRes.data), recent: map(pastRes.data) };
}
