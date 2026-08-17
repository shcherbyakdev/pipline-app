/**
 * Booking-kind CHECKs, the split EXCLUDE guards (org-wide for appointments,
 * per-unit for rentals), the org-consistency trigger, and the resolver /
 * cancel RPC v3 shape (0037).
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

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

describe("booking guards (0037)", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let u1: string;
  let u2: string;
  let otherOfferingUnitId: string;
  let serviceId: string;
  // 0041: appointment rows carry a staff_id (rental rows never do).
  let staffId: string;

  const hash = () => generateAccessToken().tokenHash;
  const base = () => ({
    org_id: orgId,
    client_name: "X",
    status: "confirmed",
    cancel_token_hash: hash(),
  });

  async function newOffering(name: string): Promise<string> {
    const { data, error } = await alice
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name,
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  async function newUnit(offering: string, name: string): Promise<string> {
    const { data, error } = await alice
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offering, name })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  beforeAll(async () => {
    alice = await signedInUser("rent_guard");
    const { data: org, error } = await alice.rpc("create_org", { p_name: "RentGuard" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    const { data: st, error: stErr } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (stErr) throw stErr;
    staffId = st!.id;

    offeringId = await newOffering("Studio");
    u1 = await newUnit(offeringId, "U1");
    u2 = await newUnit(offeringId, "U2");

    const otherOfferingId = await newOffering("Cabin");
    otherOfferingUnitId = await newUnit(otherOfferingId, "C1");

    const { data: svc, error: svcErr } = await alice
      .from("services")
      .insert({ org_id: orgId, name: "Consult", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (svcErr) throw svcErr;
    serviceId = svc!.id;
  });

  it("bookings_kind: exactly one of service_id / rental_offering_id", async () => {
    const neither = await admin.from("bookings").insert({
      ...base(),
      starts_at: "2027-06-01T10:00:00Z",
      ends_at: "2027-06-01T11:00:00Z",
    });
    expect(neither.error).not.toBeNull();
    const both = await admin.from("bookings").insert({
      ...base(),
      service_id: serviceId,
      rental_offering_id: offeringId,
      rental_unit_id: u1,
      starts_at: "2027-06-01T10:00:00Z",
      ends_at: "2027-06-01T11:00:00Z",
    });
    expect(both.error).not.toBeNull();
    const rentalNoUnit = await admin.from("bookings").insert({
      ...base(),
      rental_offering_id: offeringId,
      starts_at: "2027-06-01T13:00:00Z",
      ends_at: "2027-06-03T09:00:00Z",
    });
    expect(rentalNoUnit.error).not.toBeNull();
  });

  it("rental unit guard: same unit overlapping → 23P01; other unit → ok; appointment at same time → ok", async () => {
    const a = await admin.from("bookings").insert({
      ...base(),
      rental_offering_id: offeringId,
      rental_unit_id: u1,
      starts_at: "2027-06-10T13:00:00Z",
      ends_at: "2027-06-13T09:00:00Z",
    });
    expect(a.error).toBeNull();
    const clash = await admin.from("bookings").insert({
      ...base(),
      rental_offering_id: offeringId,
      rental_unit_id: u1,
      starts_at: "2027-06-12T13:00:00Z",
      ends_at: "2027-06-15T09:00:00Z",
    });
    expect(clash.error?.code).toBe("23P01");
    const other = await admin.from("bookings").insert({
      ...base(),
      rental_offering_id: offeringId,
      rental_unit_id: u2,
      starts_at: "2027-06-12T13:00:00Z",
      ends_at: "2027-06-15T09:00:00Z",
    });
    expect(other.error).toBeNull();
    const appt = await admin.from("bookings").insert({
      ...base(),
      service_id: serviceId,
      staff_id: staffId,
      starts_at: "2027-06-11T10:00:00Z",
      ends_at: "2027-06-11T11:00:00Z",
    });
    expect(appt.error).toBeNull(); // rentals never block the provider's own calendar
    const appt2 = await admin.from("bookings").insert({
      ...base(),
      service_id: serviceId,
      staff_id: staffId,
      starts_at: "2027-06-11T10:30:00Z",
      ends_at: "2027-06-11T11:30:00Z",
    });
    expect(appt2.error?.code).toBe("23P01"); // appointment guard still live
  });

  it("org guard trigger rejects a unit from another offering on a booking", async () => {
    const cross = await admin.from("bookings").insert({
      ...base(),
      rental_offering_id: offeringId,
      rental_unit_id: otherOfferingUnitId,
      starts_at: "2027-07-01T13:00:00Z",
      ends_at: "2027-07-03T09:00:00Z",
    });
    expect(cross.error).not.toBeNull();
  });

  it("resolve_booking_token labels a rental as 'Offering · Unit' and returns rental_unit_id + range_mode", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { error } = await admin.from("bookings").insert({
      ...base(),
      cancel_token_hash: tokenHash,
      rental_offering_id: offeringId,
      rental_unit_id: u2,
      starts_at: "2027-08-01T13:00:00Z",
      ends_at: "2027-08-03T09:00:00Z",
    });
    expect(error).toBeNull();
    const { data } = await anon.rpc("resolve_booking_token", { p_token: token });
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.service_name).toBe("Studio · U2");
    expect(row.rental_unit_id).toBe(u2);
    expect(row.range_mode).toBe("nights");
    expect(row.service_id).toBeNull();
    // cancel works for a rental and returns ends_at
    const { data: cancelled } = await anon.rpc("cancel_booking", { p_token: token });
    const c = (cancelled as Array<Record<string, unknown>>)[0];
    expect(c.rental_unit_id).toBe(u2);
    expect(c.ends_at).toBeTruthy();
    expect(c.service_name).toBe("Studio · U2");
  });

  it("reschedule_booking refuses a rental token", async () => {
    const { token, tokenHash } = generateAccessToken();
    const { error } = await admin.from("bookings").insert({
      ...base(),
      cancel_token_hash: tokenHash,
      rental_offering_id: offeringId,
      rental_unit_id: u1,
      starts_at: "2027-09-01T13:00:00Z",
      ends_at: "2027-09-03T09:00:00Z",
    });
    expect(error).toBeNull();
    const { error: rescheduleError } = await anon.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-09-05T13:00:00Z",
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(rescheduleError).not.toBeNull();
  });
});
