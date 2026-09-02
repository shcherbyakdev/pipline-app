/**
 * H5b per-resource cap against the real DB. A Free (no subscription row)
 * spaces-only org with the `billing` flag on gets ONE bookable resource;
 * its backfilled staff row must not spend it, so the first unit is public
 * and the second is hidden: not listed, not offered by the engine, and never
 * auto-assigned by the RPC (the action names the allowed unit explicitly).
 * A second org without the billing flag proves the uncapped path is
 * untouched. Requires the local Supabase stack (npm run setup).
 */
import { enTranslator } from "@/i18n/test-translator";
const ERR = enTranslator("errors");
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const net = vi.hoisted(() => ({ clientIp: "203.0.113.50" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": net.clientIp }),
}));
// Capture every send (Task 7 asserts the provider notice); nothing leaves.
const mail = vi.hoisted(() => ({ sent: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/email/transport", () => ({
  selectTransport: () => ({
    send: async (msg: Record<string, unknown>) => {
      mail.sent.push(msg);
    },
  }),
}));

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const publicActions = await import("@/features/rentals/public-actions");
const { listPublicCatalog } = await import("./catalog");
const { getBookingOrg } = await import("./public");
const { loadPublicOffering } = await import("./public-offering");
const { addDaysISO, dateInZone } = await import("@/features/scheduling/slots");


const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const TZ = "Europe/Berlin";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

async function signedInUser(tag: string): Promise<{ client: SupabaseClient; email: string }> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { client, email };
}

// A spaces-only org with one nights space and three units; `billing` on or
// off. Off also pins the premium waitlist flag off (it defaults on and would
// cap the org at Free's two resources), so "off" means "no cap" here.
async function seedOrg(tag: string, billing: boolean) {
  const { client: owner, email: ownerEmail } = await signedInUser(tag);
  const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: `${tag}Co` });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const flags = [{ org_id: orgId, flag: "rentals", enabled: true, updated_by: "h5b-test" }];
  if (billing) flags.push({ org_id: orgId, flag: "billing", enabled: true, updated_by: "h5b-test" });
  else flags.push({ org_id: orgId, flag: "premium_waitlist", enabled: false, updated_by: "h5b-test" });
  const { error: eFlag } = await admin.from("org_feature_flags").insert(flags);
  if (eFlag) throw eFlag;
  const handle = `${tag}-${Date.now()}`;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: handle, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;
  const { error: eMode } = await owner.rpc("update_org_modes", {
    p_org_id: orgId, p_offers_appointments: false, p_offers_rentals: true,
  });
  if (eMode) throw eMode;
  const { data: offering, error: e3 } = await owner
    .from("rental_offerings")
    .insert({
      org_id: orgId, name: "Cabin", range_mode: "nights", start_time: "15:00", end_time: "11:00",
      min_stay: 1, max_stay: 14, turnover_days: 0, booking_window_days: 365,
    })
    .select("id")
    .single();
  if (e3) throw e3;
  const offeringId = offering!.id as string;
  const { data: units, error: e4 } = await owner
    .from("rental_units")
    .insert([
      { org_id: orgId, offering_id: offeringId, name: "Cabin 1", sort_order: 0 },
      { org_id: orgId, offering_id: offeringId, name: "Cabin 2", sort_order: 1 },
      { org_id: orgId, offering_id: offeringId, name: "Cabin 3", sort_order: 2 },
    ])
    .select("id, name");
  if (e4) throw e4;
  const unitA = units!.find((u) => u.name === "Cabin 1")!.id as string;
  const unitB = units!.find((u) => u.name === "Cabin 2")!.id as string;
  const unitC = units!.find((u) => u.name === "Cabin 3")!.id as string;
  return { orgId, handle, offeringId, unitA, unitB, unitC, ownerEmail };
}

const startDate = d(30);
const endDate = d(32);

describe("H5b resource cap: Free spaces-only org, three units, billing on", () => {
  let capped: Awaited<ReturnType<typeof seedOrg>>;
  beforeAll(async () => {
    capped = await seedOrg("h5bcap", true);
  });

  it("lists the space, allows exactly the first two units (Free = 2)", async () => {
    const org = (await getBookingOrg(capped.handle))!;
    const cat = await listPublicCatalog(org);
    expect(cat.offerings.map((o) => o.name)).toEqual(["Cabin"]);
    const offering = await loadPublicOffering(capped.orgId);
    expect(offering.entitlements.plan).toBe("free");
    expect(offering.entitlements.bookableResources).toBe(2);
    expect([...offering.allowedUnitIds!]).toEqual([capped.unitA, capped.unitB]);
    expect([...offering.allowedSpaceIds!]).toEqual([capped.offeringId]);
  });

  it("offers two units, auto-assigns them, and refuses a third stay instead of taking the hidden unit", async () => {
    net.clientIp = "203.0.113.51";
    const before = await publicActions.getRangeAvailability({
      handle: capped.handle, offeringId: capped.offeringId, fromDate: startDate, days: 5,
    });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.units.map((u) => u.id)).toEqual([capped.unitA, capped.unitB]);
    expect(before.availability.dates[startDate].free).toBe(2);

    const first = await publicActions.createRentalBooking({
      handle: capped.handle, offeringId: capped.offeringId, unitId: null,
      startDate, endDate, name: "Cap Client", email: `cap-${Date.now()}@example.com`, note: "h5b",
    });
    expect(first.ok).toBe(true);

    const second = await publicActions.createRentalBooking({
      handle: capped.handle, offeringId: capped.offeringId, unitId: null,
      startDate, endDate, name: "Cap Client 2", email: `cap2-${Date.now()}@example.com`, note: "h5b",
    });
    expect(second.ok).toBe(true);

    const third = await publicActions.createRentalBooking({
      handle: capped.handle, offeringId: capped.offeringId, unitId: null,
      startDate, endDate, name: "Cap Client 3", email: `cap3-${Date.now()}@example.com`, note: "h5b",
    });
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third.error).toBe(ERR("datesTaken"));

    const { data: rows } = await admin
      .from("bookings")
      .select("rental_unit_id")
      .eq("org_id", capped.orgId)
      .eq("status", "confirmed");
    expect(rows).toHaveLength(2);
    expect(new Set(rows!.map((r) => r.rental_unit_id))).toEqual(new Set([capped.unitA, capped.unitB]));
  });

  it("a nights booking sends the provider their own copy (H3 gap closed)", async () => {
    // The first stay landed on Cabin 1 (auto-assign takes units in order).
    const { data: rows } = await admin
      .from("bookings")
      .select("id, client_email")
      .eq("org_id", capped.orgId)
      .eq("status", "confirmed")
      .eq("rental_unit_id", capped.unitA);
    const bookingId = rows![0].id as string;
    const notice = mail.sent.find((m) => m.idempotencyKey === `booking/${bookingId}/provider-new`);
    expect(notice).toBeDefined();
    expect(notice!.to).toBe(capped.ownerEmail);
    expect(notice!.replyTo).toBe(rows![0].client_email);
    expect(String(notice!.subject)).toContain("New booking — Cabin · Cabin 1");
    expect(String(notice!.text)).toContain("Cap Client booked with you.");
  });
});

describe("H5b resource cap: the same org shape with neither billing nor the waitlist flag is uncapped", () => {
  it("offers all three units", async () => {
    net.clientIp = "203.0.113.52";
    const open = await seedOrg("h5bopen", false);
    const offering = await loadPublicOffering(open.orgId);
    expect(offering.allowedUnitIds).toBeNull();
    const avail = await publicActions.getRangeAvailability({
      handle: open.handle, offeringId: open.offeringId, fromDate: startDate, days: 5,
    });
    expect(avail.ok).toBe(true);
    if (!avail.ok) return;
    expect(avail.units).toHaveLength(3);
    expect(avail.availability.dates[startDate].free).toBe(3);
  });
});
