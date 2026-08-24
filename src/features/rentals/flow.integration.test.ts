/**
 * Rentals e2e of the action layer, both token-authenticated client flows:
 *   R1 — getRangeAvailability → createRentalBooking (auto-assign) →
 *        cancelBooking (the shared manage action) → the dates free up again.
 *   R2 — createRentalBooking → getManageRangeAvailability →
 *        rescheduleRentalBooking → the new token is confirmed on the new
 *        dates, the old one reads 'rescheduled', and the vacated dates free
 *        up while the new ones fill.
 *   Gate — with the org's `rentals` flag off again, the public and the
 *        token-authenticated actions all refuse with the generic error.
 * Emails are best-effort inside the actions; transport failures must not
 * fail either flow. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Every public/token action rate-limits per client key (x-forwarded-for,
// lib/tokens/rate-limit). One key for the whole file would let the tests
// spend each other's 10/min budget, so each test picks its own address.
const net = vi.hoisted(() => ({ clientIp: "203.0.113.1" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": net.clientIp }),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic imports so env is loaded before src/env.ts parses it.
const publicActions = await import("./public-actions");
const rentalManage = await import("./manage-actions");
const manageActions = await import("@/features/scheduling/manage-actions");
const { resolveBookingToken } = await import("@/lib/tokens/booking");
const { addDaysISO, dateInZone } = await import("@/features/scheduling/slots");
const { GENERIC_WRITE_ERROR, TERMS_REQUIRED } = await import("./schema");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TZ = "Europe/Berlin";
const HANDLE = `rentflow-${Date.now()}`;
const CLIENT_EMAIL = `rentflow-${Date.now()}@example.com`;
const MOVE_EMAIL = `rentmove-${Date.now()}@example.com`;
// Notice/window checks are relative to *today* in the org zone.
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

let orgId: string;
let offeringId: string;
// The reschedule test's fresh token, re-used by the gate test below.
let movedToken: string;
const startDate = d(30);
const endDate = d(32);
// Far enough from the first test's window that neither stay (nor its
// turnover tail) can reach the other.
const moveFrom = d(40);
const moveFromEnd = d(42);
const moveTo = d(45);
const moveToEnd = d(47);

// Rentals are un-parked by default (FLAG_DEFAULTS.rentals is on, lib/flags),
// but every rental action still refuses unless the org's flag resolves true,
// so the suite pins its own org to an explicit `org_feature_flags` row
// (service role — members may only read the table, see utils tests) rather
// than relying on the ambient default either way. The last test flips that
// same row to enabled:false and watches the same actions refuse.
describe("rental flow e2e (action layer)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("rentflow_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentFlowCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: eFlag } = await admin
      .from("org_feature_flags")
      .insert({ org_id: orgId, flag: "rentals", enabled: true, updated_by: "flow-test" });
    if (eFlag) throw eFlag;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    // turnover 0 so a cancelled stay frees its own dates with nothing left
    // over — the "bookable again" assertion is then exact.
    const { data: offering, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Loft",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        max_stay: 14,
        turnover_days: 0,
        booking_window_days: 365,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = offering!.id as string;
    const { error: e4 } = await owner.from("rental_units").insert([
      { org_id: orgId, offering_id: offeringId, name: "Unit A", sort_order: 0 },
      { org_id: orgId, offering_id: offeringId, name: "Unit B", sort_order: 1 },
    ]);
    if (e4) throw e4;
  });

  it("books a stay, cancels it, and frees the dates again", async () => {
    net.clientIp = "203.0.113.1";
    const availability = () =>
      publicActions.getRangeAvailability({ handle: HANDLE, offeringId, fromDate: startDate, days: 5 });

    const before = await availability();
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.units).toHaveLength(2);
    expect(before.availability.dates[startDate].free).toBe(2);

    const created = await publicActions.createRentalBooking({
      handle: HANDLE,
      offeringId,
      unitId: null, // auto-assign
      startDate,
      endDate,
      name: "Rent Client",
      email: CLIENT_EMAIL,
      note: "e2e",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const { data: bookedRows } = await admin
      .from("bookings")
      .select("status, service_id, rental_offering_id, rental_unit_id")
      .eq("org_id", orgId)
      .eq("client_email", CLIENT_EMAIL);
    expect(bookedRows).toHaveLength(1);
    expect(bookedRows![0].status).toBe("confirmed");
    expect(bookedRows![0].service_id).toBeNull();
    expect(bookedRows![0].rental_offering_id).toBe(offeringId);
    expect(bookedRows![0].rental_unit_id).not.toBeNull();

    // One of the two units is now taken across the stay.
    const during = await availability();
    expect(during.ok).toBe(true);
    if (!during.ok) return;
    expect(during.availability.dates[startDate].free).toBe(1);

    // The shared manage action handles rentals: cancel by token.
    const cancelled = await manageActions.cancelBooking({ token: created.token });
    expect(cancelled.ok).toBe(true);

    const { data: cancelledRows } = await admin
      .from("bookings")
      .select("status")
      .eq("org_id", orgId)
      .eq("client_email", CLIENT_EMAIL);
    expect(cancelledRows![0].status).toBe("cancelled_by_client");

    const after = await availability();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.availability.dates[startDate].free).toBe(2);
    expect(after.availability.dates[addDaysISO(startDate, 1)].free).toBe(2);
  });

  it("reschedules a stay by token: new link, dead old token, freed dates", async () => {
    net.clientIp = "203.0.113.2";
    const created = await publicActions.createRentalBooking({
      handle: HANDLE,
      offeringId,
      unitId: null,
      startDate: moveFrom,
      endDate: moveFromEnd,
      name: "Move Client",
      email: MOVE_EMAIL,
      note: "e2e move",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The picker's own loader speaks for the same booking: its dates read as
    // free (the stay does not block itself).
    const picker = await rentalManage.getManageRangeAvailability({
      token: created.token,
      fromDate: moveFrom,
      days: 20,
    });
    expect(picker.ok).toBe(true);
    if (!picker.ok) return;
    expect(picker.availability.dates[moveFrom].free).toBe(2);
    expect(picker.units).toHaveLength(2);
    expect(picker.currentUnitId).not.toBeNull();

    const moved = await rentalManage.rescheduleRentalBooking({
      token: created.token,
      unitId: null, // auto — keep the current unit if it is still free
      startDate: moveTo,
      endDate: moveToEnd,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.token).not.toBe(created.token);
    movedToken = moved.token;

    // The new token resolves to a confirmed stay on the new dates…
    const fresh = await resolveBookingToken(moved.token, "flow-test");
    expect(fresh.status).toBe("ok");
    if (fresh.status !== "ok") return;
    expect(fresh.booking.status).toBe("confirmed");
    expect(dateInZone(fresh.booking.startsAt, TZ)).toBe(moveTo);
    expect(dateInZone(fresh.booking.endsAt, TZ)).toBe(moveToEnd);
    // H3: the resolver's four money/cancel-window columns are wired through —
    // this fixture's offering has no price/deposit set (null) and the
    // column's own default cancel window (0), so the manage page's gate
    // reads canCancel === true for it.
    expect(fresh.booking.priceCents).toBeNull();
    expect(fresh.booking.currency).toBeNull();
    expect(fresh.booking.depositCents).toBeNull();
    expect(fresh.booking.cancelWindowMin).toBe(0);

    // …and the old one is dead: it still resolves (the manage page says so)
    // but only as a rescheduled row.
    const stale = await resolveBookingToken(created.token, "flow-test");
    expect(stale.status).toBe("ok");
    if (stale.status !== "ok") return;
    expect(stale.booking.status).toBe("rescheduled");

    const moveAvailability = await publicActions.getRangeAvailability({
      handle: HANDLE,
      offeringId,
      fromDate: moveFrom,
      days: 20,
    });
    expect(moveAvailability.ok).toBe(true);
    if (!moveAvailability.ok) return;
    // The vacated dates are fully free again; the new ones hold one unit.
    expect(moveAvailability.availability.dates[moveFrom].free).toBe(2);
    expect(moveAvailability.availability.dates[addDaysISO(moveFrom, 1)].free).toBe(2);
    expect(moveAvailability.availability.dates[moveTo].free).toBe(1);
    expect(moveAvailability.availability.dates[addDaysISO(moveTo, 1)].free).toBe(1);
  });

  it("refuses the public and the token actions once the org's rentals flag is off", async () => {
    net.clientIp = "203.0.113.3";
    expect(movedToken).toBeDefined();
    const { error } = await admin
      .from("org_feature_flags")
      .update({ enabled: false })
      .eq("org_id", orgId)
      .eq("flag", "rentals");
    if (error) throw error;

    // A live, confirmed, future stay — the only thing standing in the way
    // of each action is the flag, and each says the same uniform thing.
    const availability = await publicActions.getRangeAvailability({
      handle: HANDLE,
      offeringId,
      fromDate: moveTo,
      days: 5,
    });
    expect(availability).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });
    const picker = await rentalManage.getManageRangeAvailability({
      token: movedToken,
      fromDate: moveTo,
      days: 5,
    });
    expect(picker).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });
    const moved = await rentalManage.rescheduleRentalBooking({
      token: movedToken,
      unitId: null,
      startDate: addDaysISO(moveTo, 5),
      endDate: addDaysISO(moveToEnd, 5),
    });
    expect(moved).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });

    // Nothing moved: the stay is still on its dates under the same token.
    const still = await resolveBookingToken(movedToken, "flow-test");
    expect(still.status).toBe("ok");
    if (still.status !== "ok") return;
    expect(still.booking.status).toBe("confirmed");
    expect(dateInZone(still.booking.startsAt, TZ)).toBe(moveTo);
  });
});

// H2 review Finding 3: before H2 no offering could be rangeMode "hours", so
// the date-range action layer never needed to check. 0056 makes it possible;
// loadOrgRangeContext (public.ts) now refuses one right after it resolves —
// proved here at the action layer, not just as a unit-tested return value.
describe("hourly offering rejected by the date-range action layer", () => {
  const HOURLY_HANDLE = `rentflow-hours-${Date.now()}`;
  let hourlyOfferingId: string;

  beforeAll(async () => {
    const owner = await signedInUser("rentflow_hours_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentFlowHoursCo" });
    if (e1) throw e1;
    const hourlyOrgId = (org as { id: string }).id;
    const { error: eFlag } = await admin
      .from("org_feature_flags")
      .insert({ org_id: hourlyOrgId, flag: "rentals", enabled: true, updated_by: "flow-test" });
    if (eFlag) throw eFlag;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: hourlyOrgId,
      p_handle: HOURLY_HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    const { data: offering, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: hourlyOrgId,
        name: "Court",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    hourlyOfferingId = offering!.id as string;
  });

  it("getRangeAvailability refuses an active hours offering with the generic error", async () => {
    net.clientIp = "203.0.113.4";
    const result = await publicActions.getRangeAvailability({
      handle: HOURLY_HANDLE,
      offeringId: hourlyOfferingId,
      fromDate: d(30),
      days: 5,
    });
    expect(result).toEqual({ ok: false, error: GENERIC_WRITE_ERROR });
  });
});

// H3 (task 6): the create action refuses a termed offering unless the
// caller checked the box — the RPC stamps terms_accepted_at on its own
// regardless of the action's decision, so this is the actual enforcement,
// proved at the action layer rather than just against the schema.
describe("terms acceptance gate (date-range action layer)", () => {
  const TERMS_HANDLE = `rentflow-terms-${Date.now()}`;
  let termsOrgId: string;
  let termedOfferingId: string;
  let plainOfferingId: string;

  beforeAll(async () => {
    const owner = await signedInUser("rentflow_terms_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentFlowTermsCo" });
    if (e1) throw e1;
    termsOrgId = (org as { id: string }).id;
    const { error: eFlag } = await admin
      .from("org_feature_flags")
      .insert({ org_id: termsOrgId, flag: "rentals", enabled: true, updated_by: "flow-test" });
    if (eFlag) throw eFlag;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: termsOrgId,
      p_handle: TERMS_HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    const { data: termed, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: termsOrgId,
        name: "Termed Loft",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        max_stay: 14,
        turnover_days: 0,
        booking_window_days: 365,
        terms_text: "No smoking. No pets.",
      })
      .select("id")
      .single();
    if (e3) throw e3;
    termedOfferingId = termed!.id as string;
    const { error: e4 } = await owner
      .from("rental_units")
      .insert({ org_id: termsOrgId, offering_id: termedOfferingId, name: "Unit A", sort_order: 0 });
    if (e4) throw e4;

    const { data: plain, error: e5 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: termsOrgId,
        name: "Plain Loft",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        max_stay: 14,
        turnover_days: 0,
        booking_window_days: 365,
      })
      .select("id")
      .single();
    if (e5) throw e5;
    plainOfferingId = plain!.id as string;
    const { error: e6 } = await owner
      .from("rental_units")
      .insert({ org_id: termsOrgId, offering_id: plainOfferingId, name: "Unit A", sort_order: 0 });
    if (e6) throw e6;
  });

  it("(a) refuses a termed offering when termsAccepted is omitted, and creates no row", async () => {
    net.clientIp = "203.0.113.31";
    const email = `terms-a-${Date.now()}@example.com`;
    const result = await publicActions.createRentalBooking({
      handle: TERMS_HANDLE,
      offeringId: termedOfferingId,
      unitId: null,
      startDate: d(50),
      endDate: d(52),
      name: "Terms Client",
      email,
    });
    expect(result).toEqual({ ok: false, error: TERMS_REQUIRED });
    const { data: rows } = await admin
      .from("bookings")
      .select("id")
      .eq("org_id", termsOrgId)
      .eq("client_email", email);
    expect(rows).toHaveLength(0);
  });

  it("(b) books a termed offering when termsAccepted is true, and stamps terms_accepted_at", async () => {
    net.clientIp = "203.0.113.32";
    const email = `terms-b-${Date.now()}@example.com`;
    const result = await publicActions.createRentalBooking({
      handle: TERMS_HANDLE,
      offeringId: termedOfferingId,
      unitId: null,
      startDate: d(55),
      endDate: d(57),
      name: "Terms Client",
      email,
      termsAccepted: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data: rows } = await admin
      .from("bookings")
      .select("terms_accepted_at")
      .eq("org_id", termsOrgId)
      .eq("client_email", email);
    expect(rows).toHaveLength(1);
    expect(rows![0].terms_accepted_at).not.toBeNull();
  });

  it("(c) books an offering with no terms when termsAccepted is omitted (no regression)", async () => {
    net.clientIp = "203.0.113.33";
    const email = `terms-c-${Date.now()}@example.com`;
    const result = await publicActions.createRentalBooking({
      handle: TERMS_HANDLE,
      offeringId: plainOfferingId,
      unitId: null,
      startDate: d(60),
      endDate: d(62),
      name: "No Terms Client",
      email,
    });
    expect(result.ok).toBe(true);
  });
});
