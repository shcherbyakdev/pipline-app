/**
 * Hourly mode (H2) write RPCs (0056 part B): slot_within_offering_availability
 * + rental_unit_is_free_hours helpers, create_rental_booking_hours (+ admin),
 * and reschedule_rental_booking_hours (+ admin). Mirrors the R2 rental RPCs
 * (0039) with duration-based occupancy instead of date ranges.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// ---- Task 10: the admin actions in booking-actions.ts (below, its own
// describe block) run under `currentOrg()`, which reads the session through
// `@/lib/supabase/server`'s cookie-based createClient — there is no Next
// request context under vitest to carry a real session cookie. Swapped for
// a directly authenticated supabase-js client instead (auth/actions.test.ts's
// own mock-the-client-boundary idiom, but backed by the real local stack
// rather than fully mocked): everything past that boundary — Zod
// validation, the engine pre-check, the RPC call, the error mapping — runs
// for real. `next/cache`'s revalidatePath is a plain no-op mock
// (utils/actions.test.ts idiom): it throws outside a request scope.
const actingClient = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => actingClient.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// Dynamic imports so env is loaded (loadEnvFile above) before src/env.ts
// (booking-actions.ts's own import) parses it (hourly-flow.integration.test.ts
// idiom).
const bookingActions = await import("./booking-actions");
const { SESSION_STARTED } = await import("./schema");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const HANDLE = `h2-${Date.now()}`;
const TZ = "Europe/Warsaw";
// All calendar dates in this file are offsets from *today* in the org zone
// (mirrors the R2 suite's `d(n)`), not fixed calendar literals — the fixture
// offering's min_notice/booking_window checks are wall-clock relative, so a
// hard-coded date would eventually fall in the past and either hard-fail or
// (worse) silently pass for the wrong reason once notice-rejection kicks in.
// The availability rules cover all 7 weekdays identically, so no offset
// needs to avoid a particular weekday.
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

type Row = Record<string, unknown>;

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

/** Wall-clock "YYYY-MM-DDTHH:MM" in the org zone -> timestamptz ISO string. */
function iso(dateHour: string): string {
  const [date, time] = dateHour.split("T");
  return wallTimeToUtc(date, time, TZ).toISOString();
}

const hash = () => generateAccessToken().tokenHash;

describe("hourly rental RPCs (0056 part B)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let handle: string;
  let offeringId: string;
  let unitAId: string;
  let unitBId: string;

  async function newUnit(offering: string, name: string, sortOrder: number): Promise<string> {
    const { data, error } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offering, name, sort_order: sortOrder })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  /** A full, independent org + active hours offering + unit + availability
      (all 7 weekdays, 09:00-21:00), owned by a freshly signed-in user. Used
      wherever a test needs a booking attempt that would fully succeed but
      for the one thing under test (an org-level gate, or a per-org
      throttle) — a fake/missing offering or a shared org would make such a
      test unable to fail for the right reason. */
  async function newHoursOrg(
    tag: string,
    name: string,
    opts: { offersRentals?: boolean } = {},
  ): Promise<{
    client: SupabaseClient;
    orgId: string;
    handle: string;
    offeringId: string;
    unitId: string;
  }> {
    const client = await signedInUser(tag);
    const { data: org, error: e1 } = await client.rpc("create_org", {
      p_name: name,
      p_offers_appointments: true,
      p_offers_rentals: opts.offersRentals ?? true,
    });
    if (e1) throw e1;
    const newOrgId = (org as { id: string }).id;
    // Handles only allow lowercase letters, digits and hyphens — tags use
    // underscores (matching signedInUser's own tag convention).
    const newHandle = `h2-${tag.replace(/_/g, "-")}-${Date.now()}`;
    const { error: e2 } = await client.rpc("update_org_scheduling", {
      p_org_id: newOrgId,
      p_handle: newHandle,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    const { data: off, error: e3 } = await client
      .from("rental_offerings")
      .insert({
        org_id: newOrgId,
        name: `${name} Studio`,
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    const newOfferingId = off!.id as string;
    const { data: unit, error: e4 } = await client
      .from("rental_units")
      .insert({ org_id: newOrgId, offering_id: newOfferingId, name: "Unit", sort_order: 0 })
      .select("id")
      .single();
    if (e4) throw e4;
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: newOrgId,
      rental_offering_id: newOfferingId,
      weekday,
      start_time: "09:00",
      end_time: "21:00",
    }));
    const { error: e5 } = await client.from("availability_rules").insert(rules);
    if (e5) throw e5;
    return { client, orgId: newOrgId, handle: newHandle, offeringId: newOfferingId, unitId: unit!.id as string };
  }

  const bookingRow = async (id: string): Promise<Row> => {
    const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
    if (error) throw error;
    return data as unknown as Row;
  };

  const first = (data: unknown): Row => (data as Row[])[0];

  type CreateOver = {
    startsAt: string;
    durationMin: number;
    unitId?: string | null;
    name?: string;
    email?: string;
    tokenHash?: string;
  };

  const createHours = (over: CreateOver) =>
    admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: over.unitId ?? null,
      p_starts_at: over.startsAt,
      p_duration_min: over.durationMin,
      p_name: over.name ?? "Kasia",
      p_email: over.email ?? `kasia-${Date.now()}-${Math.random()}@example.com`,
      p_note: null,
      p_token_hash: over.tokenHash ?? hash(),
    });

  const createHoursAdmin = (client: SupabaseClient, over: CreateOver) =>
    client.rpc("create_rental_booking_hours_admin", {
      p_offering_id: offeringId,
      p_unit_id: over.unitId ?? null,
      p_starts_at: over.startsAt,
      p_duration_min: over.durationMin,
      p_name: over.name ?? "Walk In",
      p_email: over.email ?? null,
      p_note: null,
      p_token_hash: over.tokenHash ?? hash(),
    });

  const reschHours = (
    token: string,
    unitId: string | null,
    startsAt: string,
    newHash: string,
  ) =>
    admin.rpc("reschedule_rental_booking_hours", {
      p_token: token,
      p_unit_id: unitId,
      p_starts_at: startsAt,
      p_new_token_hash: newHash,
    });

  const reschHoursAdmin = (
    client: SupabaseClient,
    bookingId: string,
    unitId: string | null,
    startsAt: string,
    newHash: string,
  ) =>
    client.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: bookingId,
      p_unit_id: unitId,
      p_starts_at: startsAt,
      p_new_token_hash: newHash,
    });

  beforeAll(async () => {
    owner = await signedInUser("hourly_rpc_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "HourlyRpcCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    handle = HANDLE;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: handle,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;

    const { data: off, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
        turnover_min: 30,
        min_notice_min: 0,
        booking_window_days: 60,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = off!.id as string;
    unitAId = await newUnit(offeringId, "Unit A", 0);
    unitBId = await newUnit(offeringId, "Unit B", 1);

    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId,
      rental_offering_id: offeringId,
      weekday,
      start_time: "09:00",
      end_time: "21:00",
    }));
    const { error: e4 } = await owner.from("availability_rules").insert(rules);
    if (e4) throw e4;
  });

  it("books a free 2h slot and auto-picks unit A", async () => {
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 120,
      p_name: "Kasia",
      p_email: "kasia@example.com",
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.rental_unit_id).toBe(unitAId);
    expect(new Date(row.ends_at as string).getTime() - new Date(row.starts_at as string).getTime()).toBe(
      120 * 60_000,
    );
  });

  it("rejects a duration off the grid / below min / above max", async () => {
    for (const dur of [45, 30, 270]) {
      const { error } = await createHours({ startsAt: iso(`${d(1)}T14:00`), durationMin: dur });
      expect(error?.message).toMatch(/not found/);
    }
  });

  it("rejects a slot outside the offering's opening hours", async () => {
    const { error } = await createHours({ startsAt: iso(`${d(1)}T20:30`), durationMin: 60 });
    expect(error?.message).toMatch(/not found/); // ends 21:30 > 21:00
  });

  it("turnover blocks a back-to-back slot but not one past the gap", async () => {
    await createHours({ startsAt: iso(`${d(2)}T10:00`), durationMin: 60, unitId: unitAId });
    const tight = await createHours({
      startsAt: iso(`${d(2)}T11:00`),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(tight.error?.message).toMatch(/taken/);
    const ok = await createHours({
      startsAt: iso(`${d(2)}T11:30`),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(ok.error).toBeNull();
  });

  it("auto-pick falls over to unit B when A is taken", async () => {
    const slot = iso(`${d(3)}T10:00`);
    const firstBooking = await createHours({ startsAt: slot, durationMin: 60, unitId: unitAId });
    expect(firstBooking.error).toBeNull();
    const { data, error } = await createHours({ startsAt: slot, durationMin: 60 });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.rental_unit_id).toBe(unitBId);
  });

  it("a physically overlapping insert loses to the EXCLUDE guard", async () => {
    // Bypass the RPC: direct insert of an overlapping confirmed row on the
    // same unit must raise 23P01 (bookings_rental_unit_no_overlap, 0037).
    // Overlaps the Test-1 booking (unit A, d(1) 10:00-12:00).
    const { error } = await admin.from("bookings").insert({
      org_id: orgId,
      rental_offering_id: offeringId,
      rental_unit_id: unitAId,
      client_name: "Overlap",
      starts_at: iso(`${d(1)}T11:00`),
      ends_at: iso(`${d(1)}T13:00`),
      status: "confirmed",
      cancel_token_hash: hash(),
    });
    expect(error?.code).toBe("23P01");
  });

  it("blackout on the org-local day blocks the slot", async () => {
    const blackoutDate = d(4);
    const { error: blErr } = await owner.from("rental_unit_blackouts").insert({
      org_id: orgId,
      rental_unit_id: unitAId,
      start_date: blackoutDate,
      end_date: blackoutDate,
    });
    expect(blErr).toBeNull();

    const { error } = await createHours({
      startsAt: iso(`${blackoutDate}T10:00`),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(error?.message).toMatch(/taken/);
  });

  it("admin variant ignores min_notice/window but not occupancy", async () => {
    await owner
      .from("rental_offerings")
      .update({ min_notice_min: 43200 }) // 30 days (CHECK max)
      .eq("id", offeringId);
    try {
      const slot = iso(`${d(5)}T10:00`);

      const anonPath = await createHours({ startsAt: slot, durationMin: 60, unitId: unitAId });
      expect(anonPath.error?.message).toMatch(/not found/);

      const adminOk = await createHoursAdmin(owner, {
        startsAt: slot,
        durationMin: 60,
        unitId: unitAId,
      });
      expect(adminOk.error).toBeNull();

      const adminTaken = await createHoursAdmin(owner, {
        startsAt: slot,
        durationMin: 60,
        unitId: unitAId,
      });
      expect(adminTaken.error?.message).toMatch(/taken/);
    } finally {
      // Reset even if an assertion above throws — a leaked 30-day notice
      // would otherwise time-bomb every later test in this file.
      await owner.from("rental_offerings").update({ min_notice_min: 0 }).eq("id", offeringId);
    }

    // Window half: booking_window_days is 60 in the fixture (untouched by
    // the notice mutation above) — a slot 70 days out is beyond it, so the
    // anon path must reject it while the admin path ignores the window.
    const beyondWindow = iso(`${d(70)}T10:00`);
    const anonBeyondWindow = await createHours({
      startsAt: beyondWindow,
      durationMin: 60,
      unitId: unitAId,
    });
    expect(anonBeyondWindow.error?.message).toMatch(/not found/);
    const adminBeyondWindow = await createHoursAdmin(owner, {
      startsAt: beyondWindow,
      durationMin: 60,
      unitId: unitAId,
    });
    expect(adminBeyondWindow.error).toBeNull();
  });

  it("hours reschedule frees the old row, keeps duration, rotates the token", async () => {
    const t1 = generateAccessToken();
    const created = await createHours({
      startsAt: iso(`${d(20)}T10:00`),
      durationMin: 120,
      unitId: unitAId,
      tokenHash: t1.tokenHash,
    });
    expect(created.error).toBeNull();
    const oldId = created.data as string;

    const t2 = generateAccessToken();
    const { data, error } = await reschHoursAdmin(
      owner,
      oldId,
      null,
      iso(`${d(20)}T15:00`),
      t2.tokenHash,
    );
    expect(error).toBeNull();
    const row = first(data);
    expect(row.unit_changed).toBe(false);
    expect(row.dates_changed).toBe(true);

    expect((await bookingRow(oldId)).status).toBe("rescheduled");
    const newRow = await bookingRow(row.new_booking_id as string);
    expect(newRow.status).toBe("confirmed");
    expect(newRow.rental_unit_id).toBe(unitAId);
    expect(newRow.rescheduled_from_id).toBe(oldId);
    expect(newRow.cancel_token_hash).toBe(t2.tokenHash);
    expect(
      new Date(newRow.ends_at as string).getTime() - new Date(newRow.starts_at as string).getTime(),
    ).toBe(120 * 60_000);
    expect(new Date(newRow.starts_at as string).toISOString()).toBe(iso(`${d(20)}T15:00`));
    expect(new Date(newRow.ends_at as string).toISOString()).toBe(iso(`${d(20)}T17:00`));
  });

  it("client reschedule via token enforces limits; a started booking raises 'started'", async () => {
    // -- limits: notice is enforced for the token wrapper, not for admin.
    await owner.from("rental_offerings").update({ min_notice_min: 43200 }).eq("id", offeringId);
    try {
      const t = generateAccessToken();
      const created = await createHoursAdmin(owner, {
        startsAt: iso(`${d(6)}T10:00`),
        durationMin: 60,
        unitId: unitBId,
        tokenHash: t.tokenHash,
      });
      expect(created.error).toBeNull();

      const tooSoon = await reschHours(
        t.token,
        null,
        iso(`${d(7)}T10:00`),
        generateAccessToken().tokenHash,
      );
      expect(tooSoon.error?.message).toMatch(/not found/);
    } finally {
      await owner.from("rental_offerings").update({ min_notice_min: 0 }).eq("id", offeringId);
    }

    // -- a started booking (starts_at in the past) is immovable, client + admin.
    const startedToken = generateAccessToken();
    const { data: ins, error: insErr } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: offeringId,
        rental_unit_id: unitBId,
        client_name: "Started",
        starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: "confirmed",
        cancel_token_hash: startedToken.tokenHash,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();

    const clientStarted = await reschHours(
      startedToken.token,
      null,
      iso(`${d(8)}T10:00`),
      generateAccessToken().tokenHash,
    );
    expect(clientStarted.error?.message).toMatch(/started/);

    const adminStarted = await reschHoursAdmin(
      owner,
      ins!.id as string,
      null,
      iso(`${d(8)}T10:00`),
      generateAccessToken().tokenHash,
    );
    expect(adminStarted.error?.message).toMatch(/started/);
  });

  it("create on a rentals-off org raises 'not found'", async () => {
    // Everything else about this call must be capable of succeeding — a
    // real active hours offering, a unit, and matching availability — so a
    // 'not found' here can only be the offers_rentals gate, not a
    // coincidental failure further down. (A bogus offering id would "prove"
    // the gate no matter what, even if it had been deleted.)
    const offOrg = await newHoursOrg("hourly_rpc_off", "HourlyOffCo", { offersRentals: false });

    const { error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: offOrg.handle,
      p_offering_id: offOrg.offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(9)}T10:00`),
      p_duration_min: 60,
      p_name: "Nope",
      p_email: "nope@example.com",
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("tenant isolation: a stranger cannot touch this org's offering or booking via the _admin RPCs", async () => {
    const stranger = await signedInUser("hourly_rpc_stranger");
    const { error: e1 } = await stranger.rpc("create_org", { p_name: "StrangerCo" });
    expect(e1).toBeNull();

    // org_id in (select user_orgs()) is all that stops a logged-in user
    // from writing into another org — prove it holds for both _admin RPCs.
    const foreignCreate = await createHoursAdmin(stranger, {
      startsAt: iso(`${d(11)}T10:00`),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(foreignCreate.error?.message).toMatch(/not found/);

    // A real booking in this fixture's own org, to prove the reschedule
    // RPC is scoped the same way.
    const created = await createHoursAdmin(owner, {
      startsAt: iso(`${d(12)}T10:00`),
      durationMin: 60,
      unitId: unitBId,
    });
    expect(created.error).toBeNull();

    const foreignResch = await reschHoursAdmin(
      stranger,
      created.data as string,
      null,
      iso(`${d(12)}T15:00`),
      generateAccessToken().tokenHash,
    );
    expect(foreignResch.error?.message).toMatch(/not found/);
    expect((await bookingRow(created.data as string)).status).toBe("confirmed");
  });

  it("too_many: the per-email hourly cap rejects the 6th booking from the same address", async () => {
    // Dedicated org: the per-org 30/min throttle is scoped to org_id, so a
    // fresh org (starting at 0 bookings) keeps that throttle from ever
    // interacting with however many bookings the rest of this file has
    // already made in the shared fixture org.
    const cap = await newHoursOrg("hourly_rpc_too_many", "TooManyCo");
    const email = `too-many-${Date.now()}@example.com`;
    // Six slots 2h apart (well past the offering's turnover) so occupancy
    // never rejects a call — the per-email cap must be the only thing that
    // can reject the 6th.
    const hours = [9, 11, 13, 15, 17, 19];
    const messages: (string | undefined)[] = [];
    for (const hour of hours) {
      const { error } = await admin.rpc("create_rental_booking_hours", {
        p_handle: cap.handle,
        p_offering_id: cap.offeringId,
        p_unit_id: null,
        p_starts_at: iso(`${d(1)}T${String(hour).padStart(2, "0")}:00`),
        p_duration_min: 60,
        p_name: "Repeat Client",
        p_email: email,
        p_note: null,
        p_token_hash: hash(),
      });
      messages.push(error?.message);
    }
    expect(messages.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(messages[5]).toMatch(/too_many/);
  });

  it("grants: create/reschedule client RPCs are service_role-only, admin RPCs authenticated-only", async () => {
    const anonCreateDirect = await anon.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_duration_min: 60,
      p_name: "Nope",
      p_email: "nope@example.com",
      p_note: null,
      p_token_hash: hash(),
    });
    expect(anonCreateDirect.error?.code).toBe("42501");

    const authCreateDirect = await owner.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_duration_min: 60,
      p_name: "Nope",
      p_email: "nope@example.com",
      p_note: null,
      p_token_hash: hash(),
    });
    expect(authCreateDirect.error?.code).toBe("42501");

    const anonAdminCreate = await createHoursAdmin(anon, {
      startsAt: iso("2026-09-07T10:00"),
      durationMin: 60,
    });
    expect(anonAdminCreate.error?.code).toBe("42501");

    const anonResch = await anon.rpc("reschedule_rental_booking_hours", {
      p_token: generateAccessToken().token,
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(anonResch.error?.code).toBe("42501");

    const authResch = await owner.rpc("reschedule_rental_booking_hours", {
      p_token: generateAccessToken().token,
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(authResch.error?.code).toBe("42501");

    const anonReschAdmin = await reschHoursAdmin(
      anon,
      crypto.randomUUID(),
      null,
      iso("2026-09-07T10:00"),
      generateAccessToken().tokenHash,
    );
    expect(anonReschAdmin.error?.code).toBe("42501");

    // Internal helpers/apply core: no role holds EXECUTE.
    const anonHelper = await anon.rpc("rental_unit_is_free_hours", {
      p_unit_id: unitAId,
      p_timezone: TZ,
      p_starts_at: iso("2026-09-07T10:00"),
      p_ends_at: iso("2026-09-07T11:00"),
      p_turnover_min: 30,
      p_exclude_booking_id: null,
    });
    expect(anonHelper.error?.code).toBe("42501");

    const anonApply = await anon.rpc("reschedule_rental_hours_apply", {
      p_old_id: crypto.randomUUID(),
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_new_token_hash: generateAccessToken().tokenHash,
      p_enforce_limits: false,
    });
    expect(anonApply.error?.code).toBe("42501");
  });
});

// Task 10: the three admin actions (booking-actions.ts) — Zod input,
// currentOrg() guard, the engine pre-check with the admin posture override
// (minNoticeMin: 0, bookingWindowDays: 366), the RPC call, and the error
// mapping. The RPC's own admin behaviour (ignores notice/window, still
// enforces occupancy; reschedule keeps duration + rotates the token; a
// started booking raises 'started') is already covered above by the
// "admin variant ignores min_notice/window" and "hours reschedule..."/
// "client reschedule..." tests — this block only adds what's new: that the
// ACTION layer's own SlotService override actually reaches the engine
// pre-check (not just the RPC), and the create/move/error-mapping contract
// each action promises.
describe("hourly admin actions (Task 10, action layer)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let unitAId: string;
  let unitBId: string;

  beforeAll(async () => {
    owner = await signedInUser("hourly_admin_actions_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", {
      p_name: "HourlyAdminActionsCo",
    });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: `h2-admin-actions-${Date.now()}`,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;

    // Deliberately restrictive notice/window: a plain (non-admin) call
    // against this offering would reject every slot used below, so a test
    // that only passes WITH the action's admin-posture override in place
    // actually proves the override reaches the engine pre-check, not just
    // the RPC (which the RPC-level suite above already covers on its own).
    const { data: off, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
        turnover_min: 30,
        min_notice_min: 43200, // 30 days (CHECK max)
        booking_window_days: 1,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = off!.id as string;
    const { data: uA, error: e4 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Unit A", sort_order: 0 })
      .select("id")
      .single();
    if (e4) throw e4;
    unitAId = uA!.id as string;
    const { data: uB, error: e5 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "Unit B", sort_order: 1 })
      .select("id")
      .single();
    if (e5) throw e5;
    unitBId = uB!.id as string;
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId,
      rental_offering_id: offeringId,
      weekday,
      start_time: "09:00",
      end_time: "21:00",
    }));
    const { error: e6 } = await owner.from("availability_rules").insert(rules);
    if (e6) throw e6;

    // The `createClient()` swap (top of file): this org's own owner acts
    // as "the session" for every test below.
    actingClient.current = owner;
  });

  it("getAdminHourlySlots offers a slot beyond the offering's own notice/window", async () => {
    // d(2): inside the 30-day notice, well past the 1-day booking window —
    // a plain caller would see neither.
    const result = await bookingActions.getAdminHourlySlots({
      offeringId,
      durationMin: 60,
      fromDate: d(2),
      days: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slots.some((s) => s.startsAt === iso(`${d(2)}T10:00`))).toBe(true);
  });

  it("admin walk-in inside the notice window succeeds", async () => {
    const startsAt = iso(`${d(1)}T10:00`);
    const result = await bookingActions.createRentalBookingHoursAdmin({
      offeringId,
      unitId: unitAId,
      startsAt,
      durationMin: 60,
      name: "Walk In",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No address on file — the confirmation email never fires.
    expect(result.emailed).toBe(false);

    const { data: rows, error } = await admin
      .from("bookings")
      .select("rental_unit_id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("client_name", "Walk In");
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0].rental_unit_id).toBe(unitAId);
    expect(new Date(rows![0].starts_at as string).getTime()).toBe(new Date(startsAt).getTime());
    expect(
      new Date(rows![0].ends_at as string).getTime() - new Date(rows![0].starts_at as string).getTime(),
    ).toBe(60 * 60_000);
  });

  it("admin move keeps duration and prefers the booking's own unit when it's still free", async () => {
    const created = await bookingActions.createRentalBookingHoursAdmin({
      offeringId,
      unitId: unitAId,
      startsAt: iso(`${d(3)}T10:00`),
      durationMin: 120,
      name: "Mover",
    });
    expect(created.ok).toBe(true);

    const { data: row, error: readError } = await admin
      .from("bookings")
      .select("id")
      .eq("org_id", orgId)
      .eq("client_name", "Mover")
      .single();
    expect(readError).toBeNull();
    const bookingId = row!.id as string;

    // d(3), still inside the fixture's own 30-day notice but past its
    // 1-day window — proves the override on the MOVE path too.
    const moveResult = await bookingActions.rescheduleRentalHoursAdmin({
      id: bookingId,
      unitId: null, // auto: keep the old unit if it's still free.
      startsAt: iso(`${d(3)}T15:00`),
    });
    expect(moveResult.ok).toBe(true);
    if (!moveResult.ok) return;
    expect(moveResult.unitChanged).toBe(false);
    expect(moveResult.datesChanged).toBe(true);

    const { data: oldRow } = await admin
      .from("bookings")
      .select("status")
      .eq("id", bookingId)
      .single();
    expect(oldRow!.status).toBe("rescheduled");

    const { data: rows } = await admin
      .from("bookings")
      .select("status, rental_unit_id, starts_at, ends_at")
      .eq("org_id", orgId)
      .eq("client_name", "Mover")
      .eq("status", "confirmed");
    expect(rows).toHaveLength(1);
    expect(rows![0].rental_unit_id).toBe(unitAId);
    expect(
      new Date(rows![0].ends_at as string).getTime() - new Date(rows![0].starts_at as string).getTime(),
    ).toBe(120 * 60_000);
  });

  // The action re-reads the booking's own starts_at and refuses a move
  // before ever calling the RPC (STAY_STARTED's own pre-check, mirrored) —
  // the RPC's own 'started' raise (same condition, one column) is therefore
  // unreachable from here in any realistic run; it stays covered by the
  // RPC-level "a started booking is immovable" test above, which calls the
  // RPC directly. This proves the observable, end-to-end contract: moving a
  // started booking through the action returns SESSION_STARTED.
  it("moving a started booking fails with SESSION_STARTED", async () => {
    const startedToken = generateAccessToken();
    const { data: ins, error: insErr } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: offeringId,
        rental_unit_id: unitBId,
        client_name: "Started Admin",
        starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        status: "confirmed",
        cancel_token_hash: startedToken.tokenHash,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();

    const result = await bookingActions.rescheduleRentalHoursAdmin({
      id: ins!.id as string,
      unitId: null,
      startsAt: iso(`${d(4)}T10:00`),
    });
    expect(result).toEqual({ ok: false, error: SESSION_STARTED });
  });
});
