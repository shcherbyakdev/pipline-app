import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysISO, type SlotRule, type SlotException } from "@/features/scheduling/slots";

// Admin-client reads for the anonymous booking page (getOrgBranding
// precedent: the public surface stays off the anon SQL grant surface;
// every query here is scoped by an explicitly resolved handle/orgId).

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceLabel: string | null;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxPerDay: number | null;
  bookingWindowDays: number;
};

export async function getBookingOrg(
  handle: string,
): Promise<{ orgId: string; orgName: string; timeZone: string } | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone")
    .eq("handle", handle)
    .maybeSingle();
  if (error || !data) return null;
  return { orgId: data.id, orgName: data.name, timeZone: data.timezone };
}

export async function listPublicServices(orgId: string): Promise<PublicService[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("services")
    .select(
      "id, name, description, duration_min, price_label, buffer_before_min, buffer_after_min, min_notice_min, max_per_day, booking_window_days",
    )
    .eq("org_id", orgId)
    .eq("active", true)
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    durationMin: s.duration_min,
    priceLabel: s.price_label,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    minNoticeMin: s.min_notice_min,
    maxPerDay: s.max_per_day,
    bookingWindowDays: s.booking_window_days,
  }));
}

export async function getAvailability(
  orgId: string,
): Promise<{ rules: SlotRule[]; exceptions: SlotException[] }> {
  const admin = createAdminClient();
  const [rulesRes, exceptionsRes] = await Promise.all([
    admin
      .from("availability_rules")
      .select("weekday, start_time, end_time")
      .eq("org_id", orgId),
    admin
      .from("availability_exceptions")
      .select("date, closed, start_time, end_time")
      .eq("org_id", orgId),
  ]);
  if (rulesRes.error) throw rulesRes.error;
  if (exceptionsRes.error) throw exceptionsRes.error;
  return {
    rules: (rulesRes.data ?? []).map((r) => ({
      weekday: r.weekday,
      startTime: r.start_time,
      endTime: r.end_time,
    })),
    exceptions: (exceptionsRes.data ?? []).map((e) => ({
      date: e.date,
      closed: e.closed,
      startTime: e.start_time,
      endTime: e.end_time,
    })),
  };
}

export async function getBusyIntervals(
  orgId: string,
  fromIso: string,
  toIso: string,
  excludeBookingId?: string,
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const admin = createAdminClient();
  let query = admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  // Reschedule pickers drop the booking's own interval: the RPC frees the
  // old row before inserting, so "overlaps itself" is a legal target.
  if (excludeBookingId) query = query.neq("id", excludeBookingId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
}

export async function getPublicServiceById(
  orgId: string,
  serviceId: string,
): Promise<PublicService | null> {
  const services = await listPublicServices(orgId);
  return services.find((s) => s.id === serviceId) ?? null;
}

// Everything the slot engine needs for one org+service. Shared by the
// public booking page, the tokenized manage page, and the admin
// reschedule dialog (public-actions' former loadSlotContext, org-keyed).
export async function loadOrgSlotContext(
  orgId: string,
  serviceId: string,
  fromDate: string,
  days: number,
  opts?: { excludeBookingId?: string },
): Promise<{
  service: PublicService;
  rules: SlotRule[];
  exceptions: SlotException[];
  busy: Array<{ startsAt: Date; endsAt: Date }>;
} | null> {
  const service = await getPublicServiceById(orgId, serviceId);
  if (!service) return null;
  const { rules, exceptions } = await getAvailability(orgId);
  // Fetch busy one day beyond both edges — buffers can reach across
  // org-local midnight in UTC terms.
  const busy = await getBusyIntervals(
    orgId,
    `${addDaysISO(fromDate, -1)}T00:00:00Z`,
    `${addDaysISO(fromDate, days + 1)}T23:59:59Z`,
    opts?.excludeBookingId,
  );
  return { service, rules, exceptions, busy };
}
