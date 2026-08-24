/**
 * Public hourly booking flow (H2, task 8) e2e of the ACTION layer:
 *   getHourlySlots → createRentalBookingHours, the increment-grid slot list
 *   (not a single per-day block — proves the union runs on the offering's
 *   `slotIncrementMin` grid, not the requested duration), the mode gate
 *   (kill switch + offers_rentals channel), and the stale-slot race.
 * Mirrors flow.integration.test.ts's harness (dynamic imports so env loads
 * before src/env.ts parses it, one client IP per test against the shared
 * rate limiters). Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const net = vi.hoisted(() => ({ clientIp: "203.0.113.11" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": net.clientIp }),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic imports so env is loaded before src/env.ts parses it.
const hourlyActions = await import("./hourly-actions");
const { GENERIC_WRITE_ERROR, SLOT_TAKEN_HOURLY } = await import("./schema");
const { addDaysISO, dateInZone, wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TZ = "Europe/Warsaw";
const HANDLE = `h2flow-${Date.now()}`;

// All calendar dates are offsets from *today* in the org zone (0056 suites'
// `d(n)` idiom) — the fixture's min-notice/booking-window checks are
// wall-clock relative, so a fixed calendar literal would eventually fall in
// the past or fail for the wrong reason once notice-rejection kicks in.
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);
/** Org-local "YYYY-MM-DDTHH:MM" -> timestamptz ISO string. */
const iso = (dateHour: string) => {
  const [date, time] = dateHour.split("T");
  return wallTimeToUtc(date, time, TZ).toISOString();
};

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

describe("hourly public booking flow (action layer)", () => {
  let orgId: string;
  let offeringId: string;

  beforeAll(async () => {
    const owner = await signedInUser("h2flow_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "H2FlowCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // Pin the org's own row rather than rely on the ambient FLAG_DEFAULTS
    // (flow.integration.test.ts precedent) — the mode-gate test below flips
    // this same row.
    const { error: eFlag } = await admin
      .from("org_feature_flags")
      .insert({ org_id: orgId, flag: "rentals", enabled: true, updated_by: "h2-flow-test" });
    if (eFlag) throw eFlag;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ,
    });
    if (e2) throw e2;
    const { data: offering, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Court",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
        turnover_min: 0,
        min_notice_min: 0,
        booking_window_days: 60,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = offering!.id as string;
    const { error: e4 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Court A", sort_order: 0 });
    if (e4) throw e4;
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId,
      rental_offering_id: offeringId,
      weekday,
      start_time: "09:00",
      end_time: "21:00",
    }));
    const { error: e5 } = await owner.from("availability_rules").insert(rules);
    if (e5) throw e5;
  });

  it("lists slots on the increment grid and books one", async () => {
    net.clientIp = "203.0.113.11";
    const day = d(7);
    const slots = await hourlyActions.getHourlySlots({
      handle: HANDLE,
      offeringId,
      durationMin: 120,
      fromDate: day,
      days: 7,
    });
    expect(slots.ok).toBe(true);
    if (!slots.ok) return;
    // Grid, not block: a 120-min duration still offers a candidate every
    // 30-min increment, not only every 2h from opening.
    expect(slots.slots.some((s) => s.startsAt === iso(`${day}T09:30`))).toBe(true);

    const created = await hourlyActions.createRentalBookingHours({
      handle: HANDLE,
      offeringId,
      unitId: null,
      startsAt: slots.slots[0].startsAt,
      durationMin: 120,
      name: "Kasia",
      email: "kasia@example.com",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.token).toBeTruthy();

    const { data: rows } = await admin
      .from("bookings")
      .select("status, rental_offering_id, rental_unit_id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("client_email", "kasia@example.com");
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("confirmed");
    expect(rows![0].rental_offering_id).toBe(offeringId);
    // Postgres echoes timestamptz in its own offset format, not ISO — compare
    // the instant, not the string.
    expect(new Date(rows![0].starts_at as string).getTime()).toBe(
      new Date(slots.slots[0].startsAt).getTime(),
    );
  });

  it("mode-gates: rentals kill switch off → generic error, no slot disclosure", async () => {
    net.clientIp = "203.0.113.12";
    const { error } = await admin
      .from("org_feature_flags")
      .update({ enabled: false })
      .eq("org_id", orgId)
      .eq("flag", "rentals");
    if (error) throw error;

    try {
      const day = d(8);
      const slots = await hourlyActions.getHourlySlots({
        handle: HANDLE,
        offeringId,
        durationMin: 120,
        fromDate: day,
        days: 7,
      });
      expect(slots).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });

      const created = await hourlyActions.createRentalBookingHours({
        handle: HANDLE,
        offeringId,
        unitId: null,
        startsAt: iso(`${day}T10:00`),
        durationMin: 120,
        name: "Gate Test",
        email: "gate@example.com",
      });
      expect(created).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });
    } finally {
      const { error: restoreError } = await admin
        .from("org_feature_flags")
        .update({ enabled: true })
        .eq("org_id", orgId)
        .eq("flag", "rentals");
      if (restoreError) throw restoreError;
    }
  });

  it("a stale slot returns slotTaken so the flow refetches", async () => {
    net.clientIp = "203.0.113.13";
    const startsAt = iso(`${d(9)}T10:00`);
    const first = await hourlyActions.createRentalBookingHours({
      handle: HANDLE,
      offeringId,
      unitId: null,
      startsAt,
      durationMin: 60,
      name: "First",
      email: "stale-first@example.com",
    });
    expect(first.ok).toBe(true);

    const second = await hourlyActions.createRentalBookingHours({
      handle: HANDLE,
      offeringId,
      unitId: null,
      startsAt,
      durationMin: 60,
      name: "Second",
      email: "stale-second@example.com",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.slotTaken).toBe(true);
    expect(second.error).toBe(SLOT_TAKEN_HOURLY);
  });
});
