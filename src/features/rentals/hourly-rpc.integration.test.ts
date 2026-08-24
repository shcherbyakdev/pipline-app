/**
 * Hourly mode (H2) write RPCs (0056 part B): slot_within_offering_availability
 * + rental_unit_is_free_hours helpers, create_rental_booking_hours (+ admin),
 * and reschedule_rental_booking_hours (+ admin). Mirrors the R2 rental RPCs
 * (0039) with duration-based occupancy instead of date ranges.
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

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

const HANDLE = `h2-${Date.now()}`;
const TZ = "Europe/Warsaw";
// Notice/window offsets are relative to *today* in the org zone (mirrors the
// R2 suite's `d(n)`), used only for the scenarios that are described (not
// given as literal code) so they stay clear of the brief's fixed 2026-09-07+
// calendar dates below.
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
      p_timezone: TZ,
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
      p_starts_at: iso("2026-09-07T10:00"),
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
      const { error } = await createHours({ startsAt: iso("2026-09-07T14:00"), durationMin: dur });
      expect(error?.message).toMatch(/not found/);
    }
  });

  it("rejects a slot outside the offering's opening hours", async () => {
    const { error } = await createHours({ startsAt: iso("2026-09-07T20:30"), durationMin: 60 });
    expect(error?.message).toMatch(/not found/); // ends 21:30 > 21:00
  });

  it("turnover blocks a back-to-back slot but not one past the gap", async () => {
    await createHours({ startsAt: iso("2026-09-08T10:00"), durationMin: 60, unitId: unitAId });
    const tight = await createHours({
      startsAt: iso("2026-09-08T11:00"),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(tight.error?.message).toMatch(/taken/);
    const ok = await createHours({
      startsAt: iso("2026-09-08T11:30"),
      durationMin: 60,
      unitId: unitAId,
    });
    expect(ok.error).toBeNull();
  });

  it("auto-pick falls over to unit B when A is taken", async () => {
    const slot = iso("2026-09-10T10:00");
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
    const { error } = await admin.from("bookings").insert({
      org_id: orgId,
      rental_offering_id: offeringId,
      rental_unit_id: unitAId,
      client_name: "Overlap",
      starts_at: iso("2026-09-07T11:00"),
      ends_at: iso("2026-09-07T13:00"),
      status: "confirmed",
      cancel_token_hash: hash(),
    });
    expect(error?.code).toBe("23P01");
  });

  it("blackout on the org-local day blocks the slot", async () => {
    const { error: blErr } = await owner.from("rental_unit_blackouts").insert({
      org_id: orgId,
      rental_unit_id: unitAId,
      start_date: "2026-09-09",
      end_date: "2026-09-09",
    });
    expect(blErr).toBeNull();

    const { error } = await createHours({
      startsAt: iso("2026-09-09T10:00"),
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

    const slot = iso(`${d(5)}T10:00`);

    const anonPath = await createHours({ startsAt: slot, durationMin: 60, unitId: unitAId });
    expect(anonPath.error?.message).toMatch(/not found/);

    const adminOk = await createHoursAdmin(owner, { startsAt: slot, durationMin: 60, unitId: unitAId });
    expect(adminOk.error).toBeNull();

    const adminTaken = await createHoursAdmin(owner, {
      startsAt: slot,
      durationMin: 60,
      unitId: unitAId,
    });
    expect(adminTaken.error?.message).toMatch(/taken/);

    await owner.from("rental_offerings").update({ min_notice_min: 0 }).eq("id", offeringId);
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

    await owner.from("rental_offerings").update({ min_notice_min: 0 }).eq("id", offeringId);

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
    const off = await signedInUser("hourly_rpc_off");
    const { data: org, error: e1 } = await off.rpc("create_org", {
      p_name: "HourlyOffCo",
      p_offers_appointments: true,
      p_offers_rentals: false,
    });
    expect(e1).toBeNull();
    const offOrgId = (org as { id: string }).id;
    const offHandle = `h2-off-${Date.now()}`;
    const { error: e2 } = await off.rpc("update_org_scheduling", {
      p_org_id: offOrgId,
      p_handle: offHandle,
      p_timezone: TZ,
    });
    expect(e2).toBeNull();

    const { error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: offHandle,
      p_offering_id: crypto.randomUUID(),
      p_unit_id: null,
      p_starts_at: iso("2026-09-07T10:00"),
      p_duration_min: 60,
      p_name: "Nope",
      p_email: "nope@example.com",
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error?.message).toMatch(/not found/);
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
