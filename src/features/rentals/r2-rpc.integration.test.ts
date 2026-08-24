/**
 * Rentals R2 write RPCs (0039): the shared rental_unit_is_free helper,
 * client + admin rental reschedule (old row → 'rescheduled', token
 * rotation, unit kept when free, started stays immovable), and admin
 * walk-in creation (no notice/window/throttle, email optional).
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

const HANDLE = `r2-${Date.now()}`;
const TZ = "Europe/Berlin";
// Notice/window checks are relative to *today* in the org zone, so every
// date in this file is an offset from today rather than a fixed calendar day.
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

describe("rental reschedule + admin walk-in RPCs (0039)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let u1: string;
  let u2: string;

  async function newUnit(offering: string, name: string, sortOrder: number): Promise<string> {
    const { data, error } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offering, name, sort_order: sortOrder })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  /** create_rental_booking (0038) — the fixture for every reschedule. Service
      role since 0052 took the client RPCs off the anon surface (the actions
      call them through the admin client; the token is still the credential). */
  const book = (over: Row = {}) =>
    admin.rpc("create_rental_booking", {
      p_handle: HANDLE,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(20),
      p_end_date: d(23),
      p_name: "Jamie Doe",
      p_email: "Jamie@Example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
      ...over,
    });

  const resch = (
    token: string,
    unitId: string | null,
    start: string,
    end: string,
    newHash: string,
  ) =>
    admin.rpc("reschedule_rental_booking", {
      p_token: token,
      p_unit_id: unitId,
      p_start_date: start,
      p_end_date: end,
      p_new_token_hash: newHash,
    });

  const reschAdmin = (
    client: SupabaseClient,
    bookingId: string,
    unitId: string | null,
    start: string,
    end: string,
    newHash: string,
  ) =>
    client.rpc("reschedule_rental_booking_admin", {
      p_booking_id: bookingId,
      p_unit_id: unitId,
      p_start_date: start,
      p_end_date: end,
      p_new_token_hash: newHash,
    });

  const createAdmin = (client: SupabaseClient, over: Row = {}) =>
    client.rpc("create_rental_booking_admin", {
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(70),
      p_end_date: d(72),
      p_name: "Walk In",
      p_email: null,
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
      ...over,
    });

  const first = (data: unknown): Row => (data as Row[])[0];

  const bookingRow = async (id: string, cols: string) => {
    const { data, error } = await admin.from("bookings").select(cols).eq("id", id).single();
    if (error) throw error;
    return data as unknown as Row;
  };

  beforeAll(async () => {
    owner = await signedInUser("r2_rpc_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentalCo R2" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    const { data: off, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Cabin",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        max_stay: 10,
        turnover_days: 1,
        booking_window_days: 730,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = off!.id as string;
    u1 = await newUnit(offeringId, "U1", 0);
    u2 = await newUnit(offeringId, "U2", 1);
  });

  it("client reschedule: dates move, unit stays, old row is 'rescheduled', token rotates", async () => {
    const t1 = generateAccessToken();
    const created = await book({
      p_start_date: d(20),
      p_end_date: d(23),
      p_token_hash: t1.tokenHash,
    });
    expect(created.error).toBeNull();
    const oldId = created.data as string;

    const t2 = generateAccessToken();
    const { data, error } = await resch(t1.token, null, d(30), d(33), t2.tokenHash);
    expect(error).toBeNull();
    const row = first(data);
    expect(row.unit_changed).toBe(false);
    expect(row.dates_changed).toBe(true);
    expect(row.org_id).toBe(orgId);
    expect(row.org_timezone).toBe(TZ);
    expect(row.service_name).toBe("Cabin · U1");
    expect(row.client_email).toBe("jamie@example.com");
    expect(new Date(row.old_starts_at as string).toISOString()).toBe(
      wallTimeToUtc(d(20), "15:00", TZ).toISOString(),
    );
    expect(new Date(row.new_starts_at as string).toISOString()).toBe(
      wallTimeToUtc(d(30), "15:00", TZ).toISOString(),
    );
    expect(new Date(row.new_ends_at as string).toISOString()).toBe(
      wallTimeToUtc(d(33), "11:00", TZ).toISOString(),
    );

    expect((await bookingRow(oldId, "status")).status).toBe("rescheduled");
    const newRow = await bookingRow(
      row.new_booking_id as string,
      "status, rental_unit_id, rescheduled_from_id, client_id, note",
    );
    expect(newRow.status).toBe("confirmed");
    expect(newRow.rental_unit_id).toBe(u1);
    expect(newRow.rescheduled_from_id).toBe(oldId);

    // The resolver is not status-filtered: the old token still resolves, but
    // to a 'rescheduled' row (that is how the manage page explains itself).
    const { data: oldResolved } = await anon.rpc("resolve_booking_token", { p_token: t1.token });
    expect(first(oldResolved).booking_id).toBe(oldId);
    expect(first(oldResolved).booking_status).toBe("rescheduled");
    const { data: newResolved } = await anon.rpc("resolve_booking_token", { p_token: t2.token });
    expect(first(newResolved).booking_id).toBe(row.new_booking_id);
    expect(first(newResolved).booking_status).toBe("confirmed");
  });

  it("a shift shorter than the stay does not self-conflict (old row freed first)", async () => {
    const t = generateAccessToken();
    const created = await book({
      p_unit_id: u1,
      p_start_date: d(40),
      p_end_date: d(45),
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    const { data, error } = await resch(
      t.token,
      u1,
      d(42),
      d(47),
      generateAccessToken().tokenHash,
    );
    expect(error).toBeNull();
    const row = first(data);
    expect(row.unit_changed).toBe(false);
    expect(row.dates_changed).toBe(true);
    expect((await bookingRow(row.new_booking_id as string, "rental_unit_id")).rental_unit_id).toBe(
      u1,
    );
  });

  it("admin reschedule: unit swap keeps the dates", async () => {
    const t = generateAccessToken();
    const created = await book({
      p_unit_id: u1,
      p_start_date: d(100),
      p_end_date: d(102),
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    const { data, error } = await reschAdmin(
      owner,
      created.data as string,
      u2,
      d(100),
      d(102),
      generateAccessToken().tokenHash,
    );
    expect(error).toBeNull();
    const row = first(data);
    expect(row.unit_changed).toBe(true);
    expect(row.dates_changed).toBe(false);
    expect(row.service_name).toBe("Cabin · U2");
    const newRow = await bookingRow(
      row.new_booking_id as string,
      "rental_unit_id, rescheduled_from_id",
    );
    expect(newRow.rental_unit_id).toBe(u2);
    expect(newRow.rescheduled_from_id).toBe(created.data);
    expect((await bookingRow(created.data as string, "status")).status).toBe("rescheduled");
  });

  it("auto assignment prefers the old unit when it is free", async () => {
    const t = generateAccessToken();
    const created = await book({
      p_unit_id: u2,
      p_start_date: d(120),
      p_end_date: d(122),
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    // Both units are free for d126..d128, and U1 sorts first — a plain
    // "first free unit" scan would move the stay. It must stay on U2.
    const { data, error } = await resch(
      t.token,
      null,
      d(126),
      d(128),
      generateAccessToken().tokenHash,
    );
    expect(error).toBeNull();
    expect(first(data).unit_changed).toBe(false);
    expect(
      (await bookingRow(first(data).new_booking_id as string, "rental_unit_id")).rental_unit_id,
    ).toBe(u2);

    // Control: U1 really was free for those dates (0038 auto-assign picks it).
    const control = await book({ p_start_date: d(126), p_end_date: d(128) });
    expect(control.error).toBeNull();
    expect((await bookingRow(control.data as string, "rental_unit_id")).rental_unit_id).toBe(u1);
  });

  it("'taken' when every unit is blocked for the target range, and the old row survives", async () => {
    const { error: blErr } = await owner.from("rental_unit_blackouts").insert([
      { org_id: orgId, rental_unit_id: u1, start_date: d(140), end_date: d(145) },
      { org_id: orgId, rental_unit_id: u2, start_date: d(140), end_date: d(145) },
    ]);
    expect(blErr).toBeNull();

    const t = generateAccessToken();
    const created = await book({
      p_unit_id: u1,
      p_start_date: d(130),
      p_end_date: d(132),
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    const taken = await resch(t.token, null, d(141), d(143), generateAccessToken().tokenHash);
    expect(taken.error?.message).toContain("taken");
    // The raise rolls back the "free the old row first" update.
    expect((await bookingRow(created.data as string, "status")).status).toBe("confirmed");

    const takenAdmin = await reschAdmin(
      owner,
      created.data as string,
      null,
      d(141),
      d(143),
      generateAccessToken().tokenHash,
    );
    expect(takenAdmin.error?.message).toContain("taken");
  });

  it("a started stay is immovable for both client and admin", async () => {
    const t = generateAccessToken();
    const { data: ins, error: insErr } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        rental_offering_id: offeringId,
        rental_unit_id: u1,
        client_name: "Started Stay",
        starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        status: "confirmed",
        cancel_token_hash: t.tokenHash,
      })
      .select("id")
      .single();
    expect(insErr).toBeNull();

    const client = await resch(t.token, null, d(160), d(162), generateAccessToken().tokenHash);
    expect(client.error?.message).toContain("started");
    const adminSide = await reschAdmin(
      owner,
      ins!.id as string,
      null,
      d(160),
      d(162),
      generateAccessToken().tokenHash,
    );
    expect(adminSide.error?.message).toContain("started");
    expect((await bookingRow(ins!.id as string, "status")).status).toBe("confirmed");
  });

  it("client reschedule honours notice + window; the admin path ignores them", async () => {
    const t = generateAccessToken();
    const created = await book({
      p_unit_id: u1,
      p_start_date: d(200),
      p_end_date: d(202),
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    await owner
      .from("rental_offerings")
      .update({ min_notice_days: 30, booking_window_days: 10 })
      .eq("id", offeringId);

    const tooSoon = await resch(t.token, null, d(5), d(7), generateAccessToken().tokenHash);
    expect(tooSoon.error?.message).toContain("not found");
    const tooFar = await resch(t.token, null, d(300), d(302), generateAccessToken().tokenHash);
    expect(tooFar.error?.message).toContain("not found");

    // Same dates, admin path: notice/window are provider policy, not a rule
    // the provider is bound by.
    const ok = await reschAdmin(
      owner,
      created.data as string,
      null,
      d(5),
      d(7),
      generateAccessToken().tokenHash,
    );
    expect(ok.error).toBeNull();
    expect(new Date(first(ok.data).new_starts_at as string).toISOString()).toBe(
      wallTimeToUtc(d(5), "15:00", TZ).toISOString(),
    );

    await owner
      .from("rental_offerings")
      .update({ min_notice_days: 0, booking_window_days: 730 })
      .eq("id", offeringId);
  });

  it("admin walk-in: email optional, client upserted when given, 'taken' respected, org-scoped", async () => {
    const walkIn = await createAdmin(owner, { p_start_date: d(70), p_end_date: d(72) });
    expect(walkIn.error).toBeNull();
    const row = await bookingRow(
      walkIn.data as string,
      "client_email, client_id, client_name, rental_unit_id, starts_at, ends_at, service_id",
    );
    expect(row.client_email).toBeNull();
    expect(row.client_id).toBeNull();
    expect(row.client_name).toBe("Walk In");
    expect(row.service_id).toBeNull();
    expect(row.rental_unit_id).toBe(u1);
    expect(new Date(row.starts_at as string).toISOString()).toBe(
      wallTimeToUtc(d(70), "15:00", TZ).toISOString(),
    );
    expect(new Date(row.ends_at as string).toISOString()).toBe(
      wallTimeToUtc(d(72), "11:00", TZ).toISOString(),
    );

    const email = `Walkin-${Date.now()}@Example.com`;
    const withEmail = await createAdmin(owner, {
      p_start_date: d(75),
      p_end_date: d(77),
      p_name: "Ada Walk",
      p_email: email,
    });
    expect(withEmail.error).toBeNull();
    const row2 = await bookingRow(withEmail.data as string, "client_email, client_id");
    expect(row2.client_email).toBe(email.toLowerCase());
    expect(row2.client_id).not.toBeNull();
    const { data: client } = await admin
      .from("clients")
      .select("email, org_id")
      .eq("id", row2.client_id as string)
      .single();
    expect(client!.email).toBe(email.toLowerCase());
    expect(client!.org_id).toBe(orgId);

    const { error: blErr } = await owner.from("rental_unit_blackouts").insert([
      { org_id: orgId, rental_unit_id: u1, start_date: d(80), end_date: d(81) },
      { org_id: orgId, rental_unit_id: u2, start_date: d(80), end_date: d(81) },
    ]);
    expect(blErr).toBeNull();
    const taken = await createAdmin(owner, { p_start_date: d(80), p_end_date: d(82) });
    expect(taken.error?.message).toContain("taken");

    const bob = await signedInUser("r2_rpc_bob");
    const foreign = await createAdmin(bob, { p_start_date: d(90), p_end_date: d(92) });
    expect(foreign.error?.message).toContain("not found");
  });

  it("grants: the admin RPCs are authenticated-only, the client RPC service_role-only (0052)", async () => {
    const anonAdminResch = await reschAdmin(
      anon,
      crypto.randomUUID(),
      null,
      d(10),
      d(12),
      generateAccessToken().tokenHash,
    );
    expect(anonAdminResch.error?.code).toBe("42501");
    const anonAdminCreate = await createAdmin(anon, {});
    expect(anonAdminCreate.error?.code).toBe("42501");

    const authClientResch = await owner.rpc("reschedule_rental_booking", {
      p_token: generateAccessToken().token,
      p_unit_id: null,
      p_start_date: d(10),
      p_end_date: d(12),
      p_new_token_hash: generateAccessToken().tokenHash,
    });
    expect(authClientResch.error?.code).toBe("42501");

    // The shared move core is internal too: only the two wrappers above may
    // call it, so neither client-facing role holds EXECUTE.
    const applyArgs = {
      p_old_id: crypto.randomUUID(),
      p_unit_id: null,
      p_start_date: d(10),
      p_end_date: d(12),
      p_new_token_hash: generateAccessToken().tokenHash,
      p_enforce_limits: false,
    };
    const anonApply = await anon.rpc("reschedule_rental_apply", applyArgs);
    expect(anonApply.error?.code).toBe("42501");
    const authApply = await owner.rpc("reschedule_rental_apply", applyArgs);
    expect(authApply.error?.code).toBe("42501");

    // The shared helper is internal: no role holds EXECUTE.
    const helper = await anon.rpc("rental_unit_is_free", {
      p_unit_id: u1,
      p_timezone: TZ,
      p_range_mode: "nights",
      p_occ_start: d(10),
      p_occ_end: d(11),
      p_turnover: 1,
      p_exclude_booking_id: null,
    });
    expect(helper.error?.code).toBe("42501");
  });
});
