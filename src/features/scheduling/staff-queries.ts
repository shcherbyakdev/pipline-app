import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { bookingTitle } from "@/features/scheduling/booking-label";

// Admin-side reads for the Team page (RLS client — the org scope comes from
// the policies, not a WHERE clause). The public/anon surface has its own,
// narrower loaders in `@/lib/booking/public` (PublicStaff): `email` and
// `active` must never leave the authenticated side.
export type StaffRow = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  color: string;
  active: boolean;
  sortOrder: number;
  serviceIds: string[];
};

const STAFF_COLS = "id, name, slug, email, color, active, sort_order";

type StaffDbRow = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  color: string;
  active: boolean;
  sort_order: number;
};

function toRow(s: StaffDbRow, serviceIds: string[]): StaffRow {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    email: s.email,
    color: s.color,
    active: s.active,
    sortOrder: s.sort_order,
    serviceIds,
  };
}

/** Everyone, active first-class and deactivated alike — the Team page shows
    both (there is no delete). `serviceIds` comes from one extra select, not a
    per-row join, so the list stays two queries at any team size. */
export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();
  const [staffRes, linkRes] = await Promise.all([
    supabase.from("staff").select(STAFF_COLS).order("sort_order").order("name"),
    supabase.from("service_staff").select("service_id, staff_id"),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (linkRes.error) throw linkRes.error;

  const byStaff = new Map<string, string[]>();
  for (const row of linkRes.data ?? []) {
    const ids = byStaff.get(row.staff_id);
    if (ids) ids.push(row.service_id);
    else byStaff.set(row.staff_id, [row.service_id]);
  }

  return (staffRes.data ?? []).map((s) => toRow(s, byStaff.get(s.id) ?? []));
}

/** One person with their service links, or null — RLS hides other orgs'
    rows, indistinguishable from a nonexistent id, which is the 404 the
    member page wants. */
export async function getStaff(id: string): Promise<StaffRow | null> {
  const supabase = await createClient();
  const [staffRes, linkRes] = await Promise.all([
    supabase.from("staff").select(STAFF_COLS).eq("id", id).maybeSingle(),
    supabase.from("service_staff").select("service_id").eq("staff_id", id),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (linkRes.error) throw linkRes.error;
  if (!staffRes.data) return null;
  return toRow(
    staffRes.data,
    (linkRes.data ?? []).map((l) => l.service_id),
  );
}

export async function listActiveStaff(): Promise<StaffRow[]> {
  return (await listStaff()).filter((s) => s.active);
}

/** The default staff for admin surfaces that need exactly one (availability
    editor, calendar). Ordered like `create_staff`'s schedule-source pick
    (sort_order, created_at) so "the first person" means the same thing in the
    app and in the database. */
export async function firstActiveStaffId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("active", true)
    .order("sort_order")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export type StaffBookingRow = {
  id: string;
  title: string;
  clientName: string;
  startsAt: string;
  endsAt: string;
  status: string;
  note: string | null;
};

const STAFF_BOOKINGS_LIMIT = 20;
const STAFF_BOOKING_COLS = "id, client_name, starts_at, ends_at, status, note, services(name)";

/** A person's appointments split around now — the next ones first-to-last,
    the latest past ones newest-first. Both sides are capped so a full
    calendar stays two small reads. "Upcoming" is what will still happen
    (confirmed or awaiting approval, not yet ENDED — one in progress is still
    coming, the /bookings rule); "Recent" is everything ended plus every
    cancelled, declined or moved row whatever its date, so nothing falls
    between the two. Rental stays never carry a staff_id, so this is
    appointments only by construction. */
export async function listStaffBookings(
  staffId: string,
  now: Date = new Date(),
): Promise<{ upcoming: StaffBookingRow[]; recent: StaffBookingRow[] }> {
  const supabase = await createClient();
  const iso = now.toISOString();
  const [upRes, pastRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(STAFF_BOOKING_COLS)
      .eq("staff_id", staffId)
      .in("status", ["confirmed", "pending"])
      .gte("ends_at", iso)
      .order("starts_at")
      .limit(STAFF_BOOKINGS_LIMIT),
    supabase
      .from("bookings")
      .select(STAFF_BOOKING_COLS)
      .eq("staff_id", staffId)
      .or(`ends_at.lt.${iso},status.in.(cancelled_by_client,cancelled_by_provider,rescheduled,declined)`)
      .order("starts_at", { ascending: false })
      .limit(STAFF_BOOKINGS_LIMIT),
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
  const map = (rows: unknown): StaffBookingRow[] =>
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
