/**
 * Verifies the PostgREST count embed shape (`rental_units(count)`) that
 * queries.ts's OFFERING_COLUMNS relies on for OfferingRow.unitCount.
 * queries.ts itself uses the cookie-bound server client, which doesn't work
 * outside a request — so that first suite runs the same SELECT string
 * through a signed-in test client instead.
 *
 * The second suite below (`listTimelineData` turnover padding) exercises
 * the real function: `@/lib/supabase/server`'s createClient is swapped for
 * a directly authenticated supabase-js client (the hourly-rpc.integration
 * idiom — auth/actions.test.ts's mock-the-client-boundary applied against
 * the real local stack), since there is no Next request context under
 * vitest to carry a session cookie.
 *
 * Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, wallTimeToUtc } from "@/features/scheduling/slots";
import { FIXTURE_RULES } from "./pricing-fixture";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const actingClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => actingClient.current,
}));

// Dynamic, not static: queries.ts pulls in @/lib/supabase/server → @/env,
// which parses process.env eagerly at module load. A static import would
// resolve (and fail) before the loadEnvFile() call above ever runs.
const { OFFERING_COLUMNS, listOfferings, getOffering, listTimelineData } = await import("./queries");

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

describe("queries OFFERING_COLUMNS count embed", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let offeringId: string;

  beforeAll(async () => {
    alice = await signedInUser("rentq_alice");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RentQAlpha", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: off, error: e2 } = await alice
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
      })
      .select("id")
      .single();
    if (e2) throw e2;
    offeringId = off!.id;

    const { error: e3 } = await alice
      .from("rental_units")
      .insert([
        { org_id: orgId, offering_id: offeringId, name: "Unit A" },
        { org_id: orgId, offering_id: offeringId, name: "Unit B" },
      ]);
    if (e3) throw e3;
  });

  it("rental_units(count) embed resolves to [{count: n}]", async () => {
    const { data, error } = await alice
      .from("rental_offerings")
      .select(OFFERING_COLUMNS)
      .eq("id", offeringId)
      .single();
    expect(error).toBeNull();
    const row = data as unknown as { rental_units: Array<{ count: number }> };
    expect(row.rental_units).toBeInstanceOf(Array);
    expect(row.rental_units[0].count).toBe(2);
  });
});

// A space is listed publicly only once it has an ACTIVE unit
// (lib/booking/public.ts listPublicOfferings). The admin list and the welcome
// checklist judge "bookable" by the same measure, so listOfferings carries an
// active-unit count next to the plain one — asserted against live PostgREST
// (a filtered, aliased second embed of the same table).
describe("listOfferings activeUnitCount", () => {
  let alice: SupabaseClient;
  let orgId: string;

  beforeAll(async () => {
    alice = await signedInUser("rentq_active");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RentQActive", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    actingClient.current = alice;
  });

  async function seedSpace(name: string, units: Array<{ name: string; active?: boolean }>): Promise<string> {
    const { data: off, error } = await alice
      .from("rental_offerings")
      .insert({ org_id: orgId, name, range_mode: "nights", start_time: "15:00", end_time: "11:00" })
      .select("id")
      .single();
    if (error) throw error;
    if (units.length) {
      const { error: e } = await alice
        .from("rental_units")
        // Bulk inserts send null for keys a row lacks; spell `active` out.
        .insert(units.map((u) => ({ org_id: orgId, offering_id: off!.id, name: u.name, active: u.active ?? true })));
      if (e) throw e;
    }
    return off!.id;
  }

  it("counts all units and active units separately", async () => {
    const id = await seedSpace("Loft", [{ name: "Live" }, { name: "Parked", active: false }]);
    const row = (await listOfferings()).find((o) => o.id === id)!;
    expect(row.unitCount).toBe(2);
    expect(row.activeUnitCount).toBe(1);
  });

  it("a space whose only unit is inactive has zero active units — not bookable", async () => {
    const id = await seedSpace("Shed", [{ name: "Only", active: false }]);
    const row = (await listOfferings()).find((o) => o.id === id)!;
    expect(row.unitCount).toBe(1);
    expect(row.activeUnitCount).toBe(0);
  });

  it("a space with no units at all has zero of both", async () => {
    const id = await seedSpace("Bare", []);
    const row = (await listOfferings()).find((o) => o.id === id)!;
    expect(row.unitCount).toBe(0);
    expect(row.activeUnitCount).toBe(0);
  });

  // S1: OFFERING_COLUMNS carries pricing, and PostgREST hands the jsonb
  // column back already parsed.
  it("OfferingRow carries pricing", async () => {
    const { data: off, error } = await alice
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio S1",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
        pricing: FIXTURE_RULES,
      })
      .select("id")
      .single();
    if (error) throw error;
    const row = (await listOfferings()).find((o) => o.id === off!.id)!;
    expect(row.pricing).toEqual(FIXTURE_RULES);
  });

  // S6: rental_offering_components points at rental_offerings twice, so the
  // embed has to name its FK — a guess would resolve to the wrong side (or
  // to nothing). Asserted against live PostgREST, like the count embeds above.
  it("a composite carries the ids of the rooms it includes", async () => {
    const hourly = async (name: string) => {
      const { data, error } = await alice
        .from("rental_offerings")
        .insert({
          org_id: orgId,
          name,
          range_mode: "hours",
          slot_increment_min: 30,
          min_duration_min: 60,
          max_duration_min: 240,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data!.id as string;
    };
    const [roomA, roomB] = await Promise.all([hourly("Room A"), hourly("Room B")]);
    const { data: composite, error } = await alice
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Whole studio",
        kind: "composite",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: linkError } = await alice.from("rental_offering_components").insert([
      { composite_id: composite!.id, component_id: roomA, org_id: orgId },
      { composite_id: composite!.id, component_id: roomB, org_id: orgId },
    ]);
    if (linkError) throw linkError;

    const row = (await getOffering(composite!.id))!;
    expect(row.kind).toBe("composite");
    expect([...row.componentIds].sort()).toEqual([roomA, roomB].sort());
    // A plain room is nobody's composite.
    expect((await getOffering(roomA))!.componentIds).toEqual([]);

    // updateOffering's replace: add-then-drop, so a half-done save can never
    // leave a studio including nothing. The two statements are exercised
    // here because the action itself needs a request-scoped session.
    const roomC = await hourly("Room C");
    const next = [roomA, roomC];
    const { error: upsertError } = await alice
      .from("rental_offering_components")
      .upsert(
        next.map((component_id) => ({ composite_id: composite!.id, component_id, org_id: orgId })),
        { onConflict: "composite_id,component_id", ignoreDuplicates: true },
      );
    expect(upsertError).toBeNull();
    const { error: dropError } = await alice
      .from("rental_offering_components")
      .delete()
      .eq("composite_id", composite!.id)
      .eq("org_id", orgId)
      .not("component_id", "in", `(${next.join(",")})`);
    expect(dropError).toBeNull();
    expect([...(await getOffering(composite!.id))!.componentIds].sort()).toEqual([...next].sort());
  });
});

// R2 deferral (Task 12): a stay whose checkout falls before the timeline's
// window can still leave its turnover tail (the post-checkout cleaning/prep
// days) hanging into the window — `listTimelineData` has to pad the
// bookings fetch's lower bound by the widest turnover_days among the org's
// offerings, or that tail's owning booking never comes back at all.
describe("listTimelineData turnover padding", () => {
  const TZ = "Europe/Berlin";
  const FROM_DATE = "2027-03-10";

  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let unitId: string;

  beforeAll(async () => {
    owner = await signedInUser("rentq_timeline_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentQTimeline", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: off, error: e2 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Cabin",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        turnover_days: 2,
      })
      .select("id")
      .single();
    if (e2) throw e2;
    offeringId = off!.id;

    const { data: unit, error: e3 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Unit A" })
      .select("id")
      .single();
    if (e3) throw e3;
    unitId = unit!.id;

    // This org's owner acts as "the session" for every listTimelineData
    // call below (the createClient() swap at the top of the file).
    actingClient.current = owner;
  });

  async function insertBooking(startDate: string, endDate: string): Promise<string> {
    const { data, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: offeringId,
        rental_unit_id: unitId,
        client_name: "Jamie Doe",
        client_email: "jamie@example.com",
        starts_at: wallTimeToUtc(startDate, "15:00", TZ).toISOString(),
        ends_at: wallTimeToUtc(endDate, "11:00", TZ).toISOString(),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  it("includes a booking that checked out the day before the window when its turnover tail crosses in", async () => {
    // Checks out the day before FROM_DATE; turnover_days=2 means the
    // cleaning tail covers [checkout, checkout+1] = [FROM_DATE-1, FROM_DATE]
    // — the second tail day lands inside the window.
    const tailBookingId = await insertBooking(addDaysISO(FROM_DATE, -3), addDaysISO(FROM_DATE, -1));

    const { bookings } = await listTimelineData(FROM_DATE, TZ);
    expect(bookings.some((b) => b.id === tailBookingId)).toBe(true);
  });

  it("does not reach back further than the widest turnover_days (no tail, no fetch)", async () => {
    // Checks out three days before FROM_DATE; turnover_days=2 means the
    // tail covers [checkout, checkout+1], both still before the window —
    // padding by exactly maxTurnover must not overshoot and pull this in.
    const tooEarlyId = await insertBooking(addDaysISO(FROM_DATE, -5), addDaysISO(FROM_DATE, -3));

    const { bookings } = await listTimelineData(FROM_DATE, TZ);
    expect(bookings.some((b) => b.id === tooEarlyId)).toBe(false);
  });

  // Timeline v2: every space is on the tape chart — an hourly room is a
  // lane whose days carry chips, so hours-mode offerings, their units and
  // their bookings all come back (the R2 exclusion is lifted).
  it("includes hours-mode offerings, their units and their bookings", async () => {
    const { data: hoursOffering, error: e1 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Rehearsal Room",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 120,
      })
      .select("id")
      .single();
    if (e1) throw e1;
    const { data: room, error: e2 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: hoursOffering!.id, name: "Room A" })
      .select("id")
      .single();
    if (e2) throw e2;
    const { data: hourlyBooking, error: e3 } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: hoursOffering!.id,
        rental_unit_id: room!.id,
        client_name: "Sam Hour",
        client_email: "sam@example.com",
        starts_at: wallTimeToUtc(addDaysISO(FROM_DATE, 2), "10:00", TZ).toISOString(),
        ends_at: wallTimeToUtc(addDaysISO(FROM_DATE, 2), "12:00", TZ).toISOString(),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    if (e3) throw e3;

    const { offerings, bookings } = await listTimelineData(FROM_DATE, TZ);
    const room_ = offerings.find((o) => o.id === hoursOffering!.id);
    expect(room_?.rangeMode).toBe("hours");
    expect(room_?.units.map((u) => u.id)).toEqual([room!.id]);
    expect(bookings.some((b) => b.id === hourlyBooking!.id)).toBe(true);
    // The New-booking dialog tells hourly from nightly by the slot trio
    // (offering-option.ts hourlyGrid) — without it the room would be sent
    // to the nights/days engine.
    expect(room_).toMatchObject({ slotIncrementMin: 30, minDurationMin: 60, maxDurationMin: 120 });
    expect(offerings.find((o) => o.id === offeringId)).toMatchObject({ slotIncrementMin: null, minDurationMin: null, maxDurationMin: null });
  });
});

// S6: a whole-studio booking occupies its own unit AND every room the
// composite includes (0084's sync_booking_units trigger). The tape chart has
// to hear about those rooms — `placements` is what puts the ghost bar on
// their lanes — and the primary row must NOT come back, since the booking's
// own lane is already drawn from the bookings feed.
describe("listTimelineData placements", () => {
  const TZ = "Europe/Berlin";
  const FROM_DATE = "2027-06-14";

  let owner: SupabaseClient;
  let orgId: string;
  let wholeUnitId: string;
  let roomUnitIds: string[];
  let bookingId: string;

  beforeAll(async () => {
    owner = await signedInUser("rentq_placements");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentQPlacements", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    actingClient.current = owner;

    const hourly = async (name: string, kind: "space" | "composite") => {
      const { data: off, error } = await owner
        .from("rental_offerings")
        .insert({ org_id: orgId, name, kind, range_mode: "hours", slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240 })
        .select("id")
        .single();
      if (error) throw error;
      const { data: unit, error: uErr } = await owner
        .from("rental_units")
        .insert({ org_id: orgId, offering_id: off!.id, name: `${name} unit` })
        .select("id")
        .single();
      if (uErr) throw uErr;
      return { id: off!.id as string, unitId: unit!.id as string };
    };
    const [roomA, roomB, whole] = [await hourly("Room A", "space"), await hourly("Room B", "space"), await hourly("Whole studio", "composite")];
    wholeUnitId = whole.unitId;
    roomUnitIds = [roomA.unitId, roomB.unitId];
    const { error: linkError } = await owner.from("rental_offering_components").insert([
      { composite_id: whole.id, component_id: roomA.id, org_id: orgId },
      { composite_id: whole.id, component_id: roomB.id, org_id: orgId },
    ]);
    if (linkError) throw linkError;

    // The trigger writes the occupancy rows on any insert, RPC or not.
    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: whole.id,
        rental_unit_id: whole.unitId,
        client_name: "Wes Whole",
        client_email: "wes@example.com",
        starts_at: wallTimeToUtc(addDaysISO(FROM_DATE, 1), "10:00", TZ).toISOString(),
        ends_at: wallTimeToUtc(addDaysISO(FROM_DATE, 1), "14:00", TZ).toISOString(),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    if (bErr) throw bErr;
    bookingId = booking!.id as string;
  });

  it("returns one component placement per room the whole studio blocks, and no primary row", async () => {
    const { bookings, placements } = await listTimelineData(FROM_DATE, TZ);
    expect(bookings.some((b) => b.id === bookingId)).toBe(true);
    const mine = placements.filter((p) => p.bookingId === bookingId);
    expect(mine.map((p) => p.unitId).sort()).toEqual([...roomUnitIds].sort());
    expect(mine.every((p) => p.kind === "component")).toBe(true);
    expect(mine.some((p) => p.unitId === wholeUnitId)).toBe(false);
  });
});
