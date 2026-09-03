/**
 * 0072 — bookings.locale: the language the client booked in.
 * The SQL half only: the format CHECK, and the carry-forward trigger that
 * keeps a reschedule (which writes a NEW row) speaking the same language.
 * Requires the local Supabase stack.
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

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const HANDLE = `loc-${Date.now()}`;

let owner: SupabaseClient;
let orgId: string;
let serviceId: string;

async function book(startsAt: string, email: string) {
  const { token, tokenHash } = generateAccessToken();
  const { data, error } = await admin.rpc("create_booking", {
    p_handle: HANDLE,
    p_service_id: serviceId,
    p_starts_at: startsAt,
    p_name: "Locale Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
    p_staff_id: null,
  });
  if (error) throw error;
  return { token, bookingId: (data as Array<{ booking_id: string }>)[0]!.booking_id };
}

const localeOf = async (id: string) =>
  (await admin.from("bookings").select("locale").eq("id", id).single()).data?.locale ?? null;

describe("bookings.locale (0072)", () => {
  beforeAll(async () => {
    const email = `loc_owner_${Date.now()}@example.com`;
    const password = "Password123!";
    const { error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (userError) throw userError;
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await owner.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "LocaleCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // A Ukrainian-speaking org: the fallback every NULL locale lands on.
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId, p_handle: HANDLE, p_timezone: "UTC", p_currency: "PLN", p_locale: "uk",
    });
    if (e2) throw e2;
    const { data: svc, error: e3 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Session", duration_min: 60, booking_window_days: 365 })
      .select("id")
      .single();
    if (e3) throw e3;
    serviceId = svc!.id;
    const { data: staffRow, error: e4 } = await admin.from("staff").select("id").eq("org_id", orgId).single();
    if (e4) throw e4;
    const { error: e5 } = await owner
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: staffRow!.id });
    if (e5) throw e5;
    const { error: e6 } = await owner.from("availability_rules").insert(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        org_id: orgId, staff_id: staffRow!.id, weekday, start_time: "09:00", end_time: "17:00",
      })),
    );
    if (e6) throw e6;
  });

  it("a fresh booking has no language until one is stamped", async () => {
    // create_booking takes no locale (deliberately — see the migration);
    // the action stamps it right after, which is what this asserts is possible.
    const { bookingId } = await book("2027-05-03T10:00:00Z", "fresh@example.com");
    expect(await localeOf(bookingId)).toBeNull();
    const { error } = await admin.from("bookings").update({ locale: "en" }).eq("id", bookingId);
    expect(error).toBeNull();
    expect(await localeOf(bookingId)).toBe("en");
  });

  it("rejects a value that is not a language code", async () => {
    const { bookingId } = await book("2027-05-03T11:00:00Z", "bad@example.com");
    const { error } = await admin.from("bookings").update({ locale: "english" }).eq("id", bookingId);
    expect(error?.message ?? "").toContain("bookings_locale_format");
  });

  it("a reschedule carries the client's language onto the new row", async () => {
    const { token, bookingId } = await book("2027-05-04T10:00:00Z", "move@example.com");
    await admin.from("bookings").update({ locale: "en" }).eq("id", bookingId);
    const fresh = generateAccessToken();
    const { error } = await admin.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-05-04T14:00:00Z",
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    const { data: moved } = await admin
      .from("bookings").select("id, locale").eq("rescheduled_from_id", bookingId).single();
    // Without bookings_locale_carry this is null and the client's next mail
    // silently reverts to the org's Ukrainian.
    expect(moved?.locale).toBe("en");
  });

  it("leaves a language-less booking language-less through a reschedule", async () => {
    const { token, bookingId } = await book("2027-05-05T10:00:00Z", "legacy@example.com");
    const fresh = generateAccessToken();
    const { error } = await admin.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: "2027-05-05T14:00:00Z",
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    const { data: moved } = await admin
      .from("bookings").select("locale").eq("rescheduled_from_id", bookingId).single();
    expect(moved?.locale).toBeNull();
  });
});
