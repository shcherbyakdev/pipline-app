/**
 * 0086 — the client's phone and orgs.client_contact.
 * The SQL half: the contact gate inside create_booking (what the org
 * collects is what a public booking must carry), the client row keyed by
 * phone when there is no address, the carry trigger across a reschedule,
 * and the setting's own RPC. Requires the local Supabase stack.
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

const HANDLE = `phone-${Date.now()}`;

let owner: SupabaseClient;
let orgId: string;
let serviceId: string;
let hour = 9;

// Each booking takes the next free hour of one far-off day: the order the
// tests run in never matters.
function nextSlot(): string {
  return `2027-06-0${1 + Math.floor(hour / 8)}T${String(9 + (hour++ % 8)).padStart(2, "0")}:00:00Z`;
}

async function book(contact: { email?: string | null; phone?: string | null }) {
  const { token, tokenHash } = generateAccessToken();
  const { data, error } = await admin.rpc("create_booking", {
    p_handle: HANDLE,
    p_service_id: serviceId,
    p_starts_at: nextSlot(),
    p_name: "Phone Client",
    p_email: contact.email ?? null,
    p_phone: contact.phone ?? null,
    p_note: null,
    p_token_hash: tokenHash,
    p_staff_id: null,
  });
  if (error) return { error, token, bookingId: null };
  return { error: null, token, bookingId: (data as Array<{ booking_id: string }>)[0]!.booking_id };
}

const row = async (id: string) =>
  (await admin.from("bookings").select("client_email, client_phone, client_id").eq("id", id).single()).data!;

const setContact = (value: string) => owner.rpc("update_org_client_contact", { p_org_id: orgId, p_value: value });

describe("bookings.client_phone + orgs.client_contact (0086)", () => {
  beforeAll(async () => {
    const email = `phone_owner_${Date.now()}@example.com`;
    const password = "Password123!";
    const { error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (userError) throw userError;
    owner = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await owner.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "PhoneCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId, p_handle: HANDLE, p_timezone: "UTC", p_currency: "PLN", p_locale: "en",
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

  it("defaults to email: an address is required, a phone is not", async () => {
    expect((await admin.from("orgs").select("client_contact").eq("id", orgId).single()).data?.client_contact).toBe("email");
    expect((await book({ phone: "600123456" })).error?.message).toContain("not found");
    const { error, bookingId } = await book({ email: "mail@example.com" });
    expect(error).toBeNull();
    expect(await row(bookingId!)).toMatchObject({ client_email: "mail@example.com", client_phone: null });
  });

  it("the setting is the org's to change, and only to the three values", async () => {
    expect((await setContact("fax")).error?.message).toContain("not found");
    const stranger = createClient(url, anonKey, { auth: { persistSession: false } });
    expect((await stranger.rpc("update_org_client_contact", { p_org_id: orgId, p_value: "phone" })).error).not.toBeNull();
    expect((await setContact("phone")).error).toBeNull();
    expect((await admin.from("orgs").select("client_contact").eq("id", orgId).single()).data?.client_contact).toBe("phone");
  });

  it("phone-only: the phone is required, normalised, and keys the client row", async () => {
    await setContact("phone");
    expect((await book({ email: "only@example.com" })).error?.message).toContain("not found");
    expect((await book({ phone: "12" })).error?.message).toContain("not found");
    const first = await book({ phone: " +48 600-123 456 " });
    expect(first.error).toBeNull();
    const a = await row(first.bookingId!);
    expect(a).toMatchObject({ client_email: null, client_phone: "+48600123456" });
    expect(a.client_id).not.toBeNull();
    // Same phone, different spelling: the same client.
    const second = await book({ phone: "+48 (600) 123.456" });
    expect(second.error).toBeNull();
    expect((await row(second.bookingId!)).client_id).toBe(a.client_id);
    expect((await admin.from("clients").select("phone, email").eq("id", a.client_id!).single()).data)
      .toEqual({ phone: "+48600123456", email: null });
  });

  it("both: each is required; an address keys the client and learns the phone", async () => {
    await setContact("both");
    expect((await book({ email: "half@example.com" })).error?.message).toContain("not found");
    expect((await book({ phone: "600123456" })).error?.message).toContain("not found");
    const { error, bookingId } = await book({ email: "mail@example.com", phone: "500 600 700" });
    expect(error).toBeNull();
    const r = await row(bookingId!);
    expect(r).toMatchObject({ client_email: "mail@example.com", client_phone: "500600700" });
    // The client row from the first test (keyed by this address) now carries the phone.
    expect((await admin.from("clients").select("phone").eq("id", r.client_id!).single()).data?.phone).toBe("500600700");
  });

  it("a reschedule carries the phone onto the new row", async () => {
    await setContact("phone");
    const { token, bookingId } = await book({ phone: "700800900" });
    const fresh = generateAccessToken();
    const { error } = await admin.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: nextSlot(),
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    const { data: moved } = await admin
      .from("bookings").select("client_phone").eq("rescheduled_from_id", bookingId!).single();
    expect(moved?.client_phone).toBe("700800900");
  });

  it("the stored form is checked on every write", async () => {
    const { bookingId } = await book({ phone: "700800901" });
    const { error } = await admin.from("bookings").update({ client_phone: "+48 600" }).eq("id", bookingId!);
    expect(error?.message ?? "").toContain("bookings_client_phone_format");
  });
});
