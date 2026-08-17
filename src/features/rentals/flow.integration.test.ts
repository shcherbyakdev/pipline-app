/**
 * Rentals e2e of the action layer, both token-authenticated client flows:
 *   R1 — getRangeAvailability → createRentalBooking (auto-assign) →
 *        cancelBooking (the shared manage action) → the dates free up again.
 *   R2 — createRentalBooking → getManageRangeAvailability →
 *        rescheduleRentalBooking → the new token is confirmed on the new
 *        dates, the old one reads 'rescheduled', and the vacated dates free
 *        up while the new ones fill.
 * Emails are best-effort inside the actions; transport failures must not
 * fail either flow. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
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
const startDate = d(30);
const endDate = d(32);
// Far enough from the first test's window that neither stay (nor its
// turnover tail) can reach the other.
const moveFrom = d(40);
const moveFromEnd = d(42);
const moveTo = d(45);
const moveToEnd = d(47);

describe("rental flow e2e (action layer)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("rentflow_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentFlowCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ,
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

    // The new token resolves to a confirmed stay on the new dates…
    const fresh = await resolveBookingToken(moved.token, "flow-test");
    expect(fresh.status).toBe("ok");
    if (fresh.status !== "ok") return;
    expect(fresh.booking.status).toBe("confirmed");
    expect(dateInZone(fresh.booking.startsAt, TZ)).toBe(moveTo);
    expect(dateInZone(fresh.booking.endsAt, TZ)).toBe(moveToEnd);

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
});
