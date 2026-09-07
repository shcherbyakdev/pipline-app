/**
 * H3 prices & terms (0058 part B): the booking-write RPCs snapshot
 * price_cents/currency/deposit_cents onto the row at write time
 * (rental_total_cents / rental_deposit_cents, mirrored in pricing.ts), the
 * public create paths stamp terms_accepted_at when the offering has
 * terms_text (admin walk-ins never do), reschedule recomputes at the LIVE
 * offering price while carrying terms_accepted_at forward, cancel_booking
 * gates a self-cancel inside the offering's free-cancellation window
 * ('cancel_window' sentinel) and leaves appointments untouched,
 * update_org_scheduling persists currency without touching existing
 * snapshots, resolve_booking_token exposes the same four money columns, and
 * the 0058 part A CHECKs reject invalid deposit configurations.
 * Requires the local Supabase stack (npm run setup).
 *
 * Each case gets its own signed-in owner + org (+ offering/unit), rather
 * than one shared fixture — several cases mutate the offering's live price
 * mid-test (the reschedule-recompute proof) or the org's currency, and nothing
 * here needs cross-case bookings to collide with. Mirrors the hourly-rpc /
 * r2-rpc suites' `d(n)` idiom: every date is an offset from *today* in the
 * org zone, never a fixed calendar literal.
 */
import { describe, it, expect } from "vitest";
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

const TZ = "Europe/Warsaw";
// Every date in this file is an offset from *today* in the org zone (R2/H2
// suites' own `d(n)`) — the fixture offerings' notice/window checks are
// wall-clock relative, so a hard-coded calendar date would eventually land
// in the past.
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);

type Row = Record<string, unknown>;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
const first = (data: unknown): Row => (data as Row[])[0];

/** A fresh signed-in owner + org (spaces unless said otherwise — one
    channel per org since 0073), timezone/currency set (update_org_scheduling
    now takes p_currency — every fixture across the suite exercises that). */
async function newOrg(
  tag: string,
  name: string,
  channel: "rentals" | "appointments" = "rentals",
): Promise<{ client: SupabaseClient; orgId: string; handle: string }> {
  const client = await signedInUser(tag);
  const { data: org, error: e1 } = await client.rpc("create_org", {
    p_name: name,
    p_offers_appointments: channel === "appointments",
    p_offers_rentals: channel === "rentals",
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `h3-${tag.replace(/_/g, "-")}-${Date.now()}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Active hours-mode offering (grid: 30 min increment, 60-240 min) + one
    unit + all-week 09:00-21:00 availability, money/terms fields overridable. */
async function hoursFixture(
  client: SupabaseClient,
  orgId: string,
  over: Record<string, unknown> = {},
): Promise<{ offeringId: string; unitId: string }> {
  const { data: off, error: e1 } = await client
    .from("rental_offerings")
    .insert({
      org_id: orgId,
      name: "Studio",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const offeringId = off!.id as string;
  const { data: unit, error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: offeringId, name: "Unit", sort_order: 0 })
    .select("id")
    .single();
  if (e2) throw e2;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: offeringId,
    weekday,
    start_time: "09:00",
    end_time: "21:00",
  }));
  const { error: e3 } = await client.from("availability_rules").insert(rules);
  if (e3) throw e3;
  return { offeringId, unitId: unit!.id as string };
}

/** Active nights/days offering (15:00 check-in / 11:00 check-out) + one
    unit, money/policy fields overridable. */
async function rangeFixture(
  client: SupabaseClient,
  orgId: string,
  mode: "nights" | "days",
  over: Record<string, unknown> = {},
): Promise<{ offeringId: string; unitId: string }> {
  const { data: off, error: e1 } = await client
    .from("rental_offerings")
    .insert({
      org_id: orgId,
      name: "Cabin",
      range_mode: mode,
      start_time: "15:00",
      end_time: "11:00",
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const offeringId = off!.id as string;
  const { data: unit, error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: offeringId, name: "Unit", sort_order: 0 })
    .select("id")
    .single();
  if (e2) throw e2;
  return { offeringId, unitId: unit!.id as string };
}

/** A single active service + the org's auto-created staff, linked and given
    all-week 09:00-17:00 availability — the minimal appointment fixture the
    "rentals unaffected" and "resolver nulls" cases need. */
async function serviceFixture(
  client: SupabaseClient,
  orgId: string,
): Promise<{ serviceId: string }> {
  const { data: svc, error: e1 } = await client
    .from("services")
    .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
    .select("id")
    .single();
  if (e1) throw e1;
  const serviceId = svc!.id as string;
  const { data: staff, error: e2 } = await admin
    .from("staff")
    .select("id")
    .eq("org_id", orgId)
    .single();
  if (e2) throw e2;
  const staffId = staff!.id as string;
  const { error: e3 } = await client
    .from("service_staff")
    .insert({ org_id: orgId, service_id: serviceId, staff_id: staffId });
  if (e3) throw e3;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    staff_id: staffId,
    weekday,
    start_time: "09:00",
    end_time: "17:00",
  }));
  const { error: e4 } = await client.from("availability_rules").insert(rules);
  if (e4) throw e4;
  return { serviceId };
}

const bookingRow = async (id: string): Promise<Row> => {
  const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as Row;
};

describe("H3 money RPC snapshot, terms, cancel-window, resolver (0058 part B)", () => {
  it("case 1: hours create snapshots money + terms", async () => {
    const { client, orgId, handle } = await newOrg("h3_c1", "MoneyHoursCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      price_cents: 12000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 20,
      terms_text: "House rules apply.",
    });
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 90,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBe(18000); // 12000 * 90/60
    expect(row.deposit_cents).toBe(3600); // 20% of 18000
    expect(row.currency).toBe("PLN");
    expect(row.terms_accepted_at).not.toBeNull();
    // S1 ruling 6: a flat-rate space (pricing NULL) stays exactly as it was
    // before 0078 — the quote's single base line is never snapshotted.
    expect(row.lines).toBeNull();
  });

  it("case 2: admin hours create snapshots money but never stamps terms", async () => {
    const { client, orgId } = await newOrg("h3_c2", "MoneyHoursAdminCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      price_cents: 12000,
      pricing_mode: "per_unit",
      deposit_type: "percent",
      deposit_value: 20,
      terms_text: "House rules apply.",
    });
    const { data, error } = await client.rpc("create_rental_booking_hours_admin", {
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 90,
      p_name: "Walk In",
      p_email: null,
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBe(18000);
    expect(row.deposit_cents).toBe(3600);
    expect(row.currency).toBe("PLN");
    expect(row.terms_accepted_at).toBeNull();
  });

  it("case 3: nights create snapshots the stay total with a capped fixed deposit", async () => {
    const { client, orgId, handle } = await newOrg("h3_c3", "MoneyNightsCo");
    const { offeringId } = await rangeFixture(client, orgId, "nights", {
      price_cents: 10000,
      deposit_type: "fixed",
      deposit_value: 50000,
    });
    const { data, error } = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(10),
      p_end_date: d(13), // 3 nights
      p_name: "Jamie",
      p_email: `jamie-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBe(30000); // 10000 * 3 nights
    expect(row.deposit_cents).toBe(30000); // fixed 50000, capped at the 30000 total
    expect(row.currency).toBe("PLN");
  });

  it("case 4: days create counts the range inclusively", async () => {
    const { client, orgId } = await newOrg("h3_c4", "MoneyDaysCo");
    const { offeringId } = await rangeFixture(client, orgId, "days", {
      price_cents: 10000,
    });
    const { data, error } = await client.rpc("create_rental_booking_admin", {
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(20),
      p_end_date: d(22), // inclusive: 3 days
      p_name: "Walk In",
      p_email: null,
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBe(30000); // 10000 * 3 days
  });

  it("case 5: flat pricing ignores duration/length entirely", async () => {
    const { client, orgId, handle } = await newOrg("h3_c5", "MoneyFlatCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      pricing_mode: "flat",
      price_cents: 50000,
    });
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 120,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBe(50000);
  });

  it("case 6: unpriced offering with a fixed deposit snapshots the deposit alone", async () => {
    const { client, orgId, handle } = await newOrg("h3_c6", "MoneyUnpricedFixedCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      deposit_type: "fixed",
      deposit_value: 20000,
    });
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 60,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBeNull();
    expect(row.deposit_cents).toBe(20000);
    expect(row.currency).toBe("PLN");
  });

  it("case 7: unpriced offering with no deposit leaves every money column null", async () => {
    const { client, orgId, handle } = await newOrg("h3_c7", "MoneyUnpricedNoneCo");
    const { offeringId } = await hoursFixture(client, orgId, {});
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 60,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.price_cents).toBeNull();
    expect(row.deposit_cents).toBeNull();
    expect(row.currency).toBeNull();
  });

  it("case 8: admin date-range reschedule recomputes at the live price; the old row keeps its snapshot; terms carry over", async () => {
    const { client, orgId, handle } = await newOrg("h3_c8", "MoneyReschAdminCo");
    const { offeringId } = await rangeFixture(client, orgId, "nights", {
      price_cents: 10000,
      terms_text: "House rules.",
    });
    const created = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(40),
      p_end_date: d(42), // 2 nights
      p_name: "Jamie",
      p_email: `jamie-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
    });
    expect(created.error).toBeNull();
    const oldId = created.data as string;
    const oldRow = await bookingRow(oldId);
    expect(oldRow.price_cents).toBe(20000); // 10000 * 2
    expect(oldRow.terms_accepted_at).not.toBeNull();

    const { error: updErr } = await client
      .from("rental_offerings")
      .update({ price_cents: 20000 })
      .eq("id", offeringId);
    expect(updErr).toBeNull();

    const { data, error } = await client.rpc("reschedule_rental_booking_admin", {
      p_booking_id: oldId,
      p_unit_id: null,
      p_start_date: d(40),
      p_end_date: d(45), // 5 nights, longer than before
      p_new_token_hash: hash(),
    });
    expect(error).toBeNull();
    const newId = first(data).new_booking_id as string;
    const newRow = await bookingRow(newId);
    expect(newRow.price_cents).toBe(100000); // live price 20000 * 5 nights
    expect(newRow.terms_accepted_at).toEqual(oldRow.terms_accepted_at);

    const oldRowAfter = await bookingRow(oldId);
    expect(oldRowAfter.price_cents).toBe(20000); // untouched snapshot from creation time
  });

  it("case 9: reschedule_rental_booking_hours keeps duration and re-snapshots at the live price", async () => {
    const { client, orgId, handle } = await newOrg("h3_c9", "MoneyReschHoursCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      price_cents: 12000,
    });
    const t1 = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(5)}T10:00`),
      p_duration_min: 90,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t1.tokenHash,
      p_people: null,
      p_extras: [],
    });
    expect(created.error).toBeNull();
    const oldRow = await bookingRow(created.data as string);
    expect(oldRow.price_cents).toBe(18000); // 12000 * 90/60

    const { error: updErr } = await client
      .from("rental_offerings")
      .update({ price_cents: 16000 })
      .eq("id", offeringId);
    expect(updErr).toBeNull();

    const { data, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: t1.token,
      p_unit_id: null,
      p_starts_at: iso(`${d(5)}T15:00`),
      p_new_token_hash: hash(),
    });
    expect(error).toBeNull();
    const newId = first(data).new_booking_id as string;
    const newRow = await bookingRow(newId);
    expect(newRow.price_cents).toBe(24000); // live price 16000 * 90/60
    expect(
      new Date(newRow.ends_at as string).getTime() - new Date(newRow.starts_at as string).getTime(),
    ).toBe(90 * 60_000);
  });

  it("case 10: cancel_booking raises 'cancel_window' inside the offering's free-cancellation window", async () => {
    const { client, orgId, handle } = await newOrg("h3_c10", "CancelWindowInCo");
    const { offeringId } = await rangeFixture(client, orgId, "nights", {
      cancel_window_min: 2880, // 2 days — well past a d(1) check-in
    });
    const t = generateAccessToken();
    const created = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(1),
      p_end_date: d(3),
      p_name: "Jamie",
      p_email: `jamie-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    const { error } = await admin.rpc("cancel_booking", { p_token: t.token });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("cancel_window");

    const row = await bookingRow(created.data as string);
    expect(row.status).toBe("confirmed");
  });

  it("case 11: cancel_booking succeeds once the free-cancellation window has passed", async () => {
    const { client, orgId, handle } = await newOrg("h3_c11", "CancelWindowOutCo");
    const { offeringId } = await rangeFixture(client, orgId, "nights", {
      cancel_window_min: 60, // 1 hour — far short of a d(2) check-in
    });
    const t = generateAccessToken();
    const created = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_start_date: d(2),
      p_end_date: d(4),
      p_name: "Jamie",
      p_email: `jamie-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t.tokenHash,
    });
    expect(created.error).toBeNull();

    const { error } = await admin.rpc("cancel_booking", { p_token: t.token });
    expect(error).toBeNull();

    const row = await bookingRow(created.data as string);
    expect(row.status).toBe("cancelled_by_client");
  });

  it("case 12: appointments are unaffected by the rental cancel-window gate", async () => {
    const { client, orgId, handle } = await newOrg("h3_c12", "CancelWindowApptCo", "appointments");
    const { serviceId } = await serviceFixture(client, orgId);

    const t = generateAccessToken();
    const { data, error: bookErr } = await admin.rpc("create_booking", {
      p_handle: handle,
      p_service_id: serviceId,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_name: "Client",
      p_email: `client-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t.tokenHash,
      p_staff_id: null,
      p_candidates: null,
    });
    expect(bookErr).toBeNull();
    const bookingId = (data as Array<{ booking_id: string }>)[0].booking_id;

    const { error } = await admin.rpc("cancel_booking", { p_token: t.token });
    expect(error).toBeNull();

    const row = await bookingRow(bookingId);
    expect(row.status).toBe("cancelled_by_client");
  });

  it("case 13: update_org_scheduling persists currency; an invalid one raises; existing snapshots are unaffected", async () => {
    const { client, orgId, handle } = await newOrg("h3_c13", "CurrencyCo");
    const { offeringId } = await hoursFixture(client, orgId, { price_cents: 5000 });
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 60,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [],
    });
    expect(created.error).toBeNull();
    const bookingId = created.data as string;
    const before = await bookingRow(bookingId);
    expect(before.currency).toBe("PLN");

    const { error: eurErr } = await client.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: handle,
      p_timezone: TZ,
      p_currency: "EUR",
    });
    expect(eurErr).toBeNull();
    const { data: org } = await admin.from("orgs").select("currency").eq("id", orgId).single();
    expect(org!.currency).toBe("EUR");

    const after = await bookingRow(bookingId);
    expect(after.currency).toBe("PLN"); // snapshot, not re-derived from the org

    const { error: badErr } = await client.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: handle,
      p_timezone: TZ,
      p_currency: "ZZZ",
    });
    expect(badErr?.message).toMatch(/invalid currency/);
  });

  it("case 14: resolve_booking_token returns money + cancel window for a rental, nulls for an appointment", async () => {
    const { client, orgId, handle } = await newOrg("h3_c14", "ResolverMoneyCo");
    const { offeringId } = await hoursFixture(client, orgId, {
      price_cents: 8000,
      deposit_type: "percent",
      deposit_value: 10,
      cancel_window_min: 120,
    });
    const t = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: iso(`${d(1)}T10:00`),
      p_duration_min: 60,
      p_name: "Kasia",
      p_email: `kasia-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t.tokenHash,
      p_people: null,
      p_extras: [],
    });
    expect(created.error).toBeNull();

    const { data: resolved, error: resolveErr } = await anon.rpc("resolve_booking_token", {
      p_token: t.token,
    });
    expect(resolveErr).toBeNull();
    const row = first(resolved);
    expect(row.price_cents).toBe(8000);
    expect(row.currency).toBe("PLN");
    expect(row.deposit_cents).toBe(800); // 10% of 8000
    expect(row.cancel_window_min).toBe(120);

    // Appointment side: its own org (one channel per org since 0073, and a
    // live space forbids switching) — the resolver resolves by token, whatever
    // the org.
    const appt = await newOrg("h3_c14_appt", "ResolverMoneyApptCo", "appointments");
    const { serviceId } = await serviceFixture(appt.client, appt.orgId);
    const t2 = generateAccessToken();
    const { error: apptErr } = await admin.rpc("create_booking", {
      p_handle: appt.handle,
      p_service_id: serviceId,
      p_starts_at: iso(`${d(2)}T10:00`),
      p_name: "Client",
      p_email: `client-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: t2.tokenHash,
      p_staff_id: null,
      p_candidates: null,
    });
    expect(apptErr).toBeNull();

    const { data: apptResolved } = await anon.rpc("resolve_booking_token", { p_token: t2.token });
    const apptRow = first(apptResolved);
    expect(apptRow.price_cents).toBeNull();
    expect(apptRow.currency).toBeNull();
    expect(apptRow.deposit_cents).toBeNull();
    expect(apptRow.cancel_window_min).toBeNull();
  });

  it("case 15: CHECK guards reject invalid deposit configurations", async () => {
    const { client, orgId } = await newOrg("h3_c15", "CheckGuardsCo");
    const base = {
      org_id: orgId,
      range_mode: "nights" as const,
      start_time: "15:00",
      end_time: "11:00",
    };

    const percentOutOfRange = await client.from("rental_offerings").insert({
      ...base,
      name: "Bad Percent Value",
      price_cents: 10000,
      deposit_type: "percent",
      deposit_value: 150,
    });
    expect(percentOutOfRange.error).not.toBeNull();

    const percentNeedsPrice = await client.from("rental_offerings").insert({
      ...base,
      name: "Bad Percent No Price",
      price_cents: null,
      deposit_type: "percent",
      deposit_value: 20,
    });
    expect(percentNeedsPrice.error).not.toBeNull();

    const noneWithValue = await client.from("rental_offerings").insert({
      ...base,
      name: "Bad None With Value",
      deposit_type: "none",
      deposit_value: 100,
    });
    expect(noneWithValue.error).not.toBeNull();
  });
});
