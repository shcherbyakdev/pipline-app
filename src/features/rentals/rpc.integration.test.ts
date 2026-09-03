/**
 * The anon rental write path: create_rental_booking (0038) — unit
 * auto-assignment with turnover + blackout awareness, org-local instants,
 * the uniform 'not found' validation wall, and the per-offering advisory
 * lock that decides a last-unit race. Also checks that a rental token
 * still resolves + cancels through the v3 RPCs (0037).
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

const HANDLE = `rent-rpc-${Date.now()}`;
const TZ = "Europe/Berlin";
// The RPC's notice/window checks are relative to *today* in the org zone,
// so every date in this file is offset from today rather than fixed.
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

describe("create_rental_booking RPC (0038)", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let offeringId: string;
  let u1: string;
  let u2: string;

  async function newOffering(
    name: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const { data, error } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name,
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 2,
        max_stay: 5,
        turnover_days: 1,
        booking_window_days: 730,
        ...over,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  async function newUnit(offering: string, name: string, sortOrder: number): Promise<string> {
    const { data, error } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offering, name, sort_order: sortOrder })
      .select("id")
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  // 0052: create_rental_booking / cancel_booking are service_role-only —
  // the actions call them through the admin client behind their own
  // engine pre-check. The token is still the credential inside the RPC.
  const book = (over: Record<string, unknown>) =>
    admin.rpc("create_rental_booking", {
      p_handle: HANDLE,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(30),
      p_end_date: d(33),
      p_name: "Jamie Doe",
      p_email: "Jamie@Example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
      ...over,
    });

  beforeAll(async () => {
    owner = await signedInUser("rent_rpc_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "RentalCo", p_offers_appointments: false, p_offers_rentals: true });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ, p_currency: "PLN",
    });
    if (e2) throw e2;
    offeringId = await newOffering("Cabin");
    u1 = await newUnit(offeringId, "U1", 0);
    u2 = await newUnit(offeringId, "U2", 1);
  });

  it("auto-assigns the first free unit and computes org-local instants", async () => {
    const { data, error } = await book({});
    expect(error).toBeNull();
    const { data: row } = await admin
      .from("bookings")
      .select("rental_unit_id, starts_at, ends_at, service_id, client_email")
      .eq("id", data as string)
      .single();
    expect(row!.rental_unit_id).toBe(u1);
    expect(row!.service_id).toBeNull();
    expect(row!.client_email).toBe("jamie@example.com");
    expect(new Date(row!.starts_at).toISOString()).toBe(
      wallTimeToUtc(d(30), "15:00", TZ).toISOString(),
    );
    expect(new Date(row!.ends_at).toISOString()).toBe(
      wallTimeToUtc(d(33), "11:00", TZ).toISOString(),
    );
  });

  it("second overlapping stay lands on U2; third → 'taken'", async () => {
    const b2 = await book({ p_start_date: d(31), p_end_date: d(34) });
    expect(b2.error).toBeNull();
    const { data: row } = await admin
      .from("bookings")
      .select("rental_unit_id")
      .eq("id", b2.data as string)
      .single();
    expect(row!.rental_unit_id).toBe(u2);
    const b3 = await book({ p_start_date: d(32), p_end_date: d(35) });
    expect(b3.error?.message).toContain("taken");
  });

  it("turnover: check-in on U1's checkout day is refused on U1 but a later day is fine", async () => {
    // U1 booked d30→d33 (turnover blocks d33). d33→d35 must not go to U1;
    // U2 busy d31..d33 → also blocked ⇒ taken.
    const t = await book({ p_start_date: d(33), p_end_date: d(35) });
    expect(t.error?.message).toContain("taken");
    const ok = await book({ p_start_date: d(36), p_end_date: d(38) });
    expect(ok.error).toBeNull();
  });

  it("client_picks: explicit unit honoured / refused when busy", async () => {
    const busy = await book({ p_unit_id: u1, p_start_date: d(30), p_end_date: d(32) });
    expect(busy.error?.message).toContain("taken");
    const ok = await book({ p_unit_id: u2, p_start_date: d(50), p_end_date: d(52) });
    expect(ok.error).toBeNull();
    const { data: row } = await admin
      .from("bookings")
      .select("rental_unit_id")
      .eq("id", ok.data as string)
      .single();
    expect(row!.rental_unit_id).toBe(u2);
  });

  it("rejects min/max stay, wrong order, notice, window, blackout", async () => {
    expect((await book({ p_start_date: d(60), p_end_date: d(61) })).error).not.toBeNull(); // 1 night < min 2
    expect((await book({ p_start_date: d(60), p_end_date: d(66) })).error).not.toBeNull(); // 6 > max 5
    expect((await book({ p_start_date: d(60), p_end_date: d(60) })).error).not.toBeNull();
    await owner.from("rental_offerings").update({ min_notice_days: 100 }).eq("id", offeringId);
    expect((await book({ p_start_date: d(60), p_end_date: d(62) })).error).not.toBeNull();
    await owner
      .from("rental_offerings")
      .update({ min_notice_days: 0, booking_window_days: 40 })
      .eq("id", offeringId);
    expect((await book({ p_start_date: d(60), p_end_date: d(62) })).error).not.toBeNull();
    await owner.from("rental_offerings").update({ booking_window_days: 730 }).eq("id", offeringId);
    const { error: blErr } = await owner.from("rental_unit_blackouts").insert([
      { org_id: orgId, rental_unit_id: u1, start_date: d(70), end_date: d(72) },
      { org_id: orgId, rental_unit_id: u2, start_date: d(70), end_date: d(72) },
    ]);
    expect(blErr).toBeNull();
    expect((await book({ p_start_date: d(69), p_end_date: d(71) })).error?.message).toContain(
      "taken",
    );
  });

  it("rejects a stay whose check-in has already passed (it could never be cancelled)", async () => {
    // cancel_booking requires starts_at > now(), so the RPC must refuse a
    // check-in in the past — even though the stay still ends in the future.
    const [hh, mm] = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .split(":")
      .map(Number);
    const sinceMidnight = hh * 60 + mm;
    // A minute ago in Berlin; just after midnight there is no such time, so
    // open the day at 00:00 instead.
    const pad = (n: number) => String(n).padStart(2, "0");
    const past = sinceMidnight < 2 ? "00:00" : `${pad(Math.floor((sinceMidnight - 1) / 60))}:${pad((sinceMidnight - 1) % 60)}`;
    const lateOffering = await newOffering("Late", {
      start_time: past,
      end_time: sinceMidnight < 2 ? "23:59" : "11:00",
      min_stay: 1,
      max_stay: null,
      turnover_days: 0,
      min_notice_days: 0,
    });
    await newUnit(lateOffering, "L1", 0);
    const on = (over: Record<string, unknown>) => book({ p_offering_id: lateOffering, ...over });

    // Today's check-in is already behind us — 'not found', not 'taken'.
    const late = await on({ p_start_date: d(0), p_end_date: d(1) });
    expect(late.error).not.toBeNull();
    expect(late.error!.message).toContain("not found");
    // The same stay one day later is fine.
    const ok = await on({ p_start_date: d(1), p_end_date: d(2) });
    expect(ok.error).toBeNull();
  });

  it("days mode: same-day pickup/return allowed when end_time > start_time; return day is occupied", async () => {
    const daysOffering = await newOffering("Kayak", {
      range_mode: "days",
      start_time: "09:00",
      end_time: "18:00",
      min_stay: 1,
      max_stay: null,
      turnover_days: 0,
    });
    await newUnit(daysOffering, "K1", 0);
    const on = (over: Record<string, unknown>) => book({ p_offering_id: daysOffering, ...over });

    const sameDay = await on({ p_start_date: d(80), p_end_date: d(80) });
    expect(sameDay.error).toBeNull();
    const { data: row } = await admin
      .from("bookings")
      .select("starts_at, ends_at")
      .eq("id", sameDay.data as string)
      .single();
    expect(new Date(row!.starts_at).toISOString()).toBe(
      wallTimeToUtc(d(80), "09:00", TZ).toISOString(),
    );
    expect(new Date(row!.ends_at).toISOString()).toBe(
      wallTimeToUtc(d(80), "18:00", TZ).toISOString(),
    );
    // The return day counts as occupied in days mode.
    expect((await on({ p_start_date: d(80), p_end_date: d(81) })).error?.message).toContain(
      "taken",
    );
    expect((await on({ p_start_date: d(81), p_end_date: d(82) })).error).toBeNull();
  });

  it("resolve + cancel work for a rental token; concurrent last-unit race yields exactly one winner", async () => {
    const { token, tokenHash } = generateAccessToken();
    const created = await book({
      p_start_date: d(90),
      p_end_date: d(92),
      p_token_hash: tokenHash,
    });
    expect(created.error).toBeNull();

    const { data: resolved, error: rErr } = await anon.rpc("resolve_booking_token", {
      p_token: token,
    });
    expect(rErr).toBeNull();
    const hit = (resolved as Array<Record<string, unknown>>)[0];
    expect(hit.booking_id).toBe(created.data);
    expect(hit.service_id).toBeNull();
    expect(hit.range_mode).toBe("nights");
    expect(hit.service_name).toBe("Cabin · U1");
    expect(hit.rental_unit_id).toBe(u1);

    const { data: cancelled, error: cErr } = await admin.rpc("cancel_booking", { p_token: token });
    expect(cErr).toBeNull();
    expect((cancelled as Array<Record<string, unknown>>)[0].booking_id).toBe(created.data);
    const { data: after } = await admin
      .from("bookings")
      .select("status")
      .eq("id", created.data as string)
      .single();
    expect(after!.status).toBe("cancelled_by_client");

    // Race: one unit, two identical requests. The advisory lock serializes
    // the auto-assignment, so exactly one insert may win.
    const raceOffering = await newOffering("Race", { min_stay: 1, turnover_days: 0 });
    await newUnit(raceOffering, "R1", 0);
    const race = (): ReturnType<typeof book> =>
      book({ p_offering_id: raceOffering, p_start_date: d(100), p_end_date: d(102) });
    const [a, b] = await Promise.all([race(), race()]);
    const errors = [a.error, b.error].filter((e) => e !== null);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message.includes("taken") || errors[0]!.code === "23P01").toBe(true);
  });
  it("grants (0052): anon no longer holds EXECUTE on create_rental_booking", async () => {
    const { error } = await anon.rpc("create_rental_booking", {
      p_handle: HANDLE,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(120),
      p_end_date: d(122),
      p_name: "Nobody",
      p_email: "nobody@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(error?.code).toBe("42501");
  });
});
