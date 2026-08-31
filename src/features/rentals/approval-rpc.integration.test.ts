/**
 * Booking approval (request-to-book), rentals half (0062):
 * rental_offerings.requires_approval makes both public create RPCs insert
 * 'pending', and the widened free-checks (rental_unit_is_free /
 * rental_unit_is_free_hours) make that request hold its dates until it is
 * accepted or declined. Requires the local Supabase stack (npm run setup).
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

const HANDLE = `approval-r-${Date.now()}`;
const TZ = "Europe/Warsaw";
// Notice/window checks are wall-clock relative, so every date here is an
// offset from today in the org zone rather than a fixed calendar day
// (r2-rpc/hourly-rpc idiom).
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

describe("booking approval — rentals", () => {
  let owner: SupabaseClient;
  let orgId: string;
  let handle: string;
  let offeringId: string;
  let unitId: string;
  let hoursOfferingId: string;
  let hoursUnitId: string;
  let windowOfferingId: string;
  let windowUnitId: string;

  const bookingRow = async (id: string): Promise<Row> => {
    const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
    if (error) throw error;
    return data as unknown as Row;
  };

  beforeAll(async () => {
    owner = await signedInUser("approval_rentals_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "ApprovalRentalCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    handle = HANDLE;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: handle,
      p_timezone: TZ,
      p_currency: "PLN",
    });
    if (e2) throw e2;

    // Nights offering — the date-range create path.
    const { data: off, error: e3 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Cabin",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        turnover_days: 0,
        booking_window_days: 365,
        requires_approval: true,
      })
      .select("id")
      .single();
    if (e3) throw e3;
    offeringId = off!.id as string;
    const { data: unit, error: e4 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name: "U1", sort_order: 0 })
      .select("id")
      .single();
    if (e4) throw e4;
    unitId = unit!.id as string;

    // Hours offering — the duration create path (hourly-rpc's fixture shape).
    const { data: hoursOff, error: e5 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Studio",
        range_mode: "hours",
        slot_increment_min: 30,
        min_duration_min: 60,
        max_duration_min: 240,
        turnover_min: 0,
        min_notice_min: 0,
        booking_window_days: 365,
        requires_approval: true,
      })
      .select("id")
      .single();
    if (e5) throw e5;
    hoursOfferingId = hoursOff!.id as string;
    const { data: hoursUnit, error: e6 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: hoursOfferingId, name: "Room", sort_order: 0 })
      .select("id")
      .single();
    if (e6) throw e6;
    hoursUnitId = hoursUnit!.id as string;
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId,
      rental_offering_id: hoursOfferingId,
      weekday,
      start_time: "09:00",
      end_time: "21:00",
    }));
    const { error: e7 } = await owner.from("availability_rules").insert(rules);
    if (e7) throw e7;

    // Nights offering with a free-cancellation window (H3) — the two states
    // cancel_booking treats differently live here: a request is always
    // withdrawable, a confirmed stay inside the window is not.
    const { data: winOff, error: e8 } = await owner
      .from("rental_offerings")
      .insert({
        org_id: orgId,
        name: "Lodge",
        range_mode: "nights",
        start_time: "15:00",
        end_time: "11:00",
        min_stay: 1,
        turnover_days: 0,
        booking_window_days: 365,
        requires_approval: true,
        cancel_window_min: 10_080, // 7 days — every date below sits inside it
      })
      .select("id")
      .single();
    if (e8) throw e8;
    windowOfferingId = winOff!.id as string;
    const { data: winUnit, error: e9 } = await owner
      .from("rental_units")
      .insert({ org_id: orgId, offering_id: windowOfferingId, name: "L1", sort_order: 0 })
      .select("id")
      .single();
    if (e9) throw e9;
    windowUnitId = winUnit!.id as string;
  });

  const createWindowStay = (start: string, end: string, email: string) => {
    const t = generateAccessToken();
    return admin
      .rpc("create_rental_booking", {
        p_handle: handle,
        p_offering_id: windowOfferingId,
        p_unit_id: windowUnitId,
        p_start_date: start,
        p_end_date: end,
        p_name: "W",
        p_email: email,
        p_note: null,
        p_token_hash: t.tokenHash,
      })
      .then((r) => ({ ...r, token: t.token }));
  };

  it("range create inserts pending; pending blocks the dates; decline frees them", async () => {
    const h = () => generateAccessToken();
    const t1 = h();
    const { data: id1, error: e1 } = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: unitId,
      p_start_date: d(10),
      p_end_date: d(12),
      p_name: "A",
      p_email: "a@example.com",
      p_note: null,
      p_token_hash: t1.tokenHash,
    });
    expect(e1).toBeNull();
    expect((await bookingRow(id1 as string)).status).toBe("pending");

    const { error: e2 } = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: unitId,
      p_start_date: d(11),
      p_end_date: d(13),
      p_name: "B",
      p_email: "b@example.com",
      p_note: null,
      p_token_hash: h().tokenHash,
    });
    expect(e2).not.toBeNull(); // rental_unit_is_free now sees pending

    // Service role, not `owner`: RLS's authenticated seam (0028) only allows
    // confirmed -> cancelled_by_provider. The provider-facing decline write
    // path is a later task's definer RPC.
    const { error: declineErr } = await admin
      .from("bookings")
      .update({ status: "declined" })
      .eq("id", id1 as string);
    expect(declineErr).toBeNull();
    const { error: e3 } = await admin.rpc("create_rental_booking", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: unitId,
      p_start_date: d(10),
      p_end_date: d(12),
      p_name: "C",
      p_email: "c@example.com",
      p_note: null,
      p_token_hash: h().tokenHash,
    });
    expect(e3).toBeNull();
  });

  it("hours create inserts pending and blocks the slot while pending", async () => {
    const t = generateAccessToken();
    const { data: id, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: hoursOfferingId,
      p_unit_id: hoursUnitId,
      p_starts_at: iso(`${d(20)}T10:00`),
      p_duration_min: 120,
      p_name: "H",
      p_email: "h@example.com",
      p_note: null,
      p_token_hash: t.tokenHash,
    });
    expect(error).toBeNull();
    expect((await bookingRow(id as string)).status).toBe("pending");

    const { error: e2 } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: hoursOfferingId,
      p_unit_id: hoursUnitId,
      p_starts_at: iso(`${d(20)}T11:00`),
      p_duration_min: 120,
      p_name: "H2",
      p_email: "h2@example.com",
      p_note: null,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(e2).not.toBeNull(); // rental_unit_is_free_hours now sees pending
  });

  it("a pending request inside the cancel window is still withdrawable", async () => {
    const { data: id, error, token } = await createWindowStay(d(1), d(3), "win-p@example.com");
    expect(error).toBeNull();
    const { error: cancelErr } = await admin.rpc("cancel_booking", { p_token: token });
    expect(cancelErr).toBeNull();
    expect((await bookingRow(id as string)).status).toBe("cancelled_by_client");
  });

  it("a confirmed stay inside the cancel window raises the cancel_window sentinel", async () => {
    const { data: id, error, token } = await createWindowStay(d(4), d(6), "win-c@example.com");
    expect(error).toBeNull();
    // Service role: the accept write path is authenticated-seam-restricted
    // (0028); only the resulting state matters here.
    const { error: acceptErr } = await admin
      .from("bookings")
      .update({ status: "confirmed" })
      .eq("id", id as string);
    expect(acceptErr).toBeNull();
    const { error: cancelErr } = await admin.rpc("cancel_booking", { p_token: token });
    expect(cancelErr?.message).toMatch(/cancel_window/);
    expect((await bookingRow(id as string)).status).toBe("confirmed");
  });
});
