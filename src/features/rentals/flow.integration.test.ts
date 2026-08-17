/**
 * Rentals R1 e2e of the action layer: getRangeAvailability →
 * createRentalBooking (auto-assign) → cancelBooking (the shared
 * token-authenticated manage action) → the dates are bookable again.
 * Emails are best-effort inside the actions; transport failures must not
 * fail the flow. Requires the local Supabase stack (npm run setup).
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
const manageActions = await import("@/features/scheduling/manage-actions");
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
});
