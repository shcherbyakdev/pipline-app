/**
 * listPublicCatalog gating (H1): the one gated read the three public
 * booking pages share. Verifies both channels come through untouched when
 * an org offers both, and that turning a channel off (via update_org_modes)
 * drops exactly its half of the bundle — offerings when rentals are off,
 * services/staff when appointments are off — while the other half stays.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BookingOrg } from "./public";

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

// Dynamic imports so env is loaded before src/env.ts parses it.
const { getBookingOrg } = await import("./public");
const { listPublicCatalog } = await import("./catalog");

// getBookingOrg is cache()-wrapped: per *request* in Next, but per import in
// Vitest it memoises across this file's two mode flips below. The first test
// still calls getBookingOrg once (pinning the extended BookingOrg shape);
// every read after a mode flip goes straight to the row via `admin` instead.
async function bookingOrgFromDb(handle: string): Promise<BookingOrg> {
  const { data, error } = await admin
    .from("orgs")
    .select("id, name, timezone, offers_appointments, offers_rentals, currency")
    .eq("handle", handle)
    .single();
  if (error) throw error;
  return {
    orgId: data.id,
    orgName: data.name,
    timeZone: data.timezone,
    offersAppointments: data.offers_appointments,
    offersRentals: data.offers_rentals,
    currency: data.currency,
  };
}

describe("listPublicCatalog gating (H1)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  const HANDLE = `catalog-${Date.now()}`;

  beforeAll(async () => {
    owner = await signedInUser("catalog_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "CatalogCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId, p_handle: HANDLE, p_timezone: "Europe/Berlin", p_currency: "PLN",
    });
    if (e2) throw e2;
    // A service is only public through the people linked to it
    // (bookable.ts filterBookableServices) — create_org seeds one staff row
    // per org (0052/0054), so link it here the way the createService action
    // would, or "Consult" would be invisible to loadPublicOffering.
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Consult", duration_min: 30 })
      .select("id")
      .single();
    if (e3) throw e3;
    const { data: staffRow, error: eStaff } = await owner
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (eStaff) throw eStaff;
    const { error: eLink } = await owner
      .from("service_staff")
      .insert({ org_id: orgId, service_id: svc!.id, staff_id: staffRow!.id });
    if (eLink) throw eLink;
    const { data: off, error: e4 } = await owner
      .from("rental_offerings")
      .insert({ org_id: orgId, name: "Cabin", range_mode: "nights", start_time: "15:00", end_time: "11:00" })
      .select("id")
      .single();
    if (e4) throw e4;
    const { error: e5 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: off!.id, name: "Cabin 1" });
    if (e5) throw e5;
  });

  it("returns both lists when both channels are on", async () => {
    const org = (await getBookingOrg(HANDLE))!;
    expect(org.offersAppointments && org.offersRentals).toBe(true);
    const cat = await listPublicCatalog(org);
    expect(cat.offering.services.map((s) => s.name)).toEqual(["Consult"]);
    expect(cat.offerings.map((o) => o.name)).toEqual(["Cabin"]);
  });

  it("drops offerings when rentals are off, services+staff when appointments are off", async () => {
    await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: true, p_offers_rentals: false });
    let cat = await listPublicCatalog(await bookingOrgFromDb(HANDLE));
    expect(cat.offerings).toEqual([]);
    expect(cat.offering.services).toHaveLength(1);

    await owner.rpc("update_org_modes", { p_org_id: orgId, p_offers_appointments: false, p_offers_rentals: true });
    cat = await listPublicCatalog(await bookingOrgFromDb(HANDLE));
    expect(cat.offering.services).toEqual([]);
    expect(cat.offering.staff).toEqual([]);
    expect(cat.offerings).toHaveLength(1);
  });
});
