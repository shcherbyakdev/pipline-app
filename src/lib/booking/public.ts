import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SlotRule, SlotException } from "@/features/scheduling/slots";

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
): Promise<Array<{ startsAt: Date; endsAt: Date }>> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("org_id", orgId)
    .eq("status", "confirmed")
    .gte("ends_at", fromIso)
    .lte("starts_at", toIso);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    startsAt: new Date(b.starts_at),
    endsAt: new Date(b.ends_at),
  }));
}
