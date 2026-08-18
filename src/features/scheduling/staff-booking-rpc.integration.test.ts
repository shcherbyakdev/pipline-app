/**
 * Team slice: the staff-keyed booking write path. Covers create_booking's
 * new `p_staff_id` (named staff vs "Anyone available" auto-assign via
 * pick_staff_for_slot) and create_booking_admin's now-required staff.
 *
 * The cases run top-down and depend on the booking state earlier ones leave
 * behind (Anna holds one confirmed 09:00 on d(3) going into the auto-assign
 * cases) — keep the order as written. Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone } from "./slots";

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

const TZ = "UTC";
const HANDLE = `staff-bkg-${Date.now()}`;

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

const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);
const at = (n: number, hm: string) => `${d(n)}T${hm}:00Z`;

let owner: SupabaseClient;
let orgId: string;
let serviceId: string;
let defaultStaffId: string;
let annaId: string;

function book(staffId: string | null, hm = "09:00", email = "c@example.com") {
  const { tokenHash } = generateAccessToken();
  return anon.rpc("create_booking", {
    p_handle: HANDLE,
    p_service_id: serviceId,
    p_starts_at: at(3, hm),
    p_name: "Client",
    p_email: email,
    p_note: null,
    p_token_hash: tokenHash,
    p_staff_id: staffId,
  });
}

describe("create_booking per staff", () => {
  beforeAll(async () => {
    owner = await signedInUser("staff_bkg_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "StaffBookCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    // A second org guarantees a *foreign* staff row exists for the
    // cross-org rejection cases below.
    const stranger = await signedInUser("staff_bkg_stranger");
    const { error: e1b } = await stranger.rpc("create_org", { p_name: "StaffBookOther" });
    if (e1b) throw e1b;

    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: orgId,
      p_handle: HANDLE,
      p_timezone: TZ,
    });
    if (e2) throw e2;

    const { data: st, error: e3 } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e3) throw e3;
    defaultStaffId = st!.id;

    const { data: svc, error: e4 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Cut", duration_min: 30, booking_window_days: 365 })
      .select("id")
      .single();
    if (e4) throw e4;
    serviceId = svc!.id;
    // A raw services insert does not fan out to staff — that is
    // createService's job (Task 5). Mirror it for the default staff.
    const { error: e5 } = await admin
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: defaultStaffId });
    if (e5) throw e5;

    // Anna before the rules exist: create_staff copies the source staff's
    // rules, so seeding rules first would collide with the explicit inserts.
    const { data: anna, error: e6 } = await owner.rpc("create_staff", {
      p_org_id: orgId,
      p_name: "Anna",
      p_slug: "anna",
      p_email: "anna@example.com",
      p_color: "#4f46e5",
      p_service_ids: [serviceId],
    });
    if (e6) throw e6;
    annaId = anna as string;

    // service_role holds select-only on availability_rules (0026): seed hours
    // as the org member, like every other suite.
    const { error: e7 } = await owner.from("availability_rules").insert(
      [defaultStaffId, annaId].flatMap((staffId) =>
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          org_id: orgId,
          staff_id: staffId,
          weekday,
          start_time: "09:00",
          end_time: "12:00",
        })),
      ),
    );
    if (e7) throw e7;
  });

  it("named staff: books on that staff and returns staff_name", async () => {
    const { data, error } = await book(annaId);
    expect(error).toBeNull();
    const row = (data as Array<{ booking_id: string; staff_id: string; staff_name: string }>)[0];
    expect(row.staff_id).toBe(annaId);
    expect(row.staff_name).toBe("Anna");
  });

  it("named staff not offering the service → staff_unavailable", async () => {
    await admin
      .from("service_staff")
      .delete()
      .eq("service_id", serviceId)
      .eq("staff_id", annaId);
    const { error } = await book(annaId, "10:00");
    expect(error?.message).toMatch(/staff_unavailable/);
    await admin
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: annaId });
  });

  it("inactive staff → staff_unavailable", async () => {
    // Anna holds the 09:00 booking from the first test — the offboarding
    // trigger refuses deactivation while it is confirmed, so cancel it first.
    await admin
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("staff_id", annaId)
      .eq("status", "confirmed");
    const { error: deact } = await admin.from("staff").update({ active: false }).eq("id", annaId);
    expect(deact).toBeNull();
    const { error } = await book(annaId, "11:00", "i@example.com");
    expect(error?.message).toMatch(/staff_unavailable/);
    await admin.from("staff").update({ active: true }).eq("id", annaId);
    // Restore the 09:00 booking state the load-balancing tests below assume.
    const { error: re } = await book(annaId, "09:00", "c2@example.com");
    expect(re).toBeNull();
  });

  it("named staff outside their hours → not found", async () => {
    const { error } = await book(annaId, "15:00", "late@example.com");
    expect(error?.message).toMatch(/not found/);
  });

  it("named staff double-book surfaces the raw 23P01", async () => {
    const { error } = await book(annaId, "09:00", "dupe@example.com");
    expect(error?.code).toBe("23P01");
  });

  it("null staff: picks the least-loaded eligible staff", async () => {
    // default staff has 0 bookings on d(3), Anna has 1 (09:00) → default
    // picked at 10:00.
    const { data } = await book(null, "10:00", "x@example.com");
    expect((data as Array<{ staff_id: string }>)[0].staff_id).toBe(defaultStaffId);
    // now both have 1 → tie → lowest sort_order (default) at 10:30
    const { data: d2 } = await book(null, "10:30", "y@example.com");
    expect((d2 as Array<{ staff_id: string }>)[0].staff_id).toBe(defaultStaffId);
  });

  it("null staff: skips staff who is busy at that time", async () => {
    // Anna has 09:00 only; default is busy at 10:00 → 10:00 goes to Anna.
    const { data } = await book(null, "10:00", "z@example.com");
    expect((data as Array<{ staff_id: string }>)[0].staff_id).toBe(annaId);
  });

  it("null staff: nobody free → taken", async () => {
    const { error } = await book(null, "10:00", "w@example.com");
    expect(error?.message).toMatch(/taken/);
  });

  it("null staff: outside every staff's hours → not found", async () => {
    const { error } = await book(null, "15:00");
    expect(error?.message).toMatch(/not found/);
  });

  it("create_booking_admin requires an eligible staff", async () => {
    const { tokenHash } = generateAccessToken();
    const { error } = await owner.rpc("create_booking_admin", {
      p_service_id: serviceId,
      p_starts_at: at(4, "09:00"),
      p_name: "W",
      p_email: null,
      p_note: null,
      p_token_hash: tokenHash,
      p_duration_min: null,
      p_staff_id: annaId,
    });
    expect(error).toBeNull();
    const { tokenHash: t2 } = generateAccessToken();
    const { data: foreign } = await admin
      .from("staff")
      .select("id")
      .neq("org_id", orgId)
      .limit(1)
      .single();
    const { error: e2 } = await owner.rpc("create_booking_admin", {
      p_service_id: serviceId,
      p_starts_at: at(4, "10:00"),
      p_name: "W",
      p_email: null,
      p_note: null,
      p_token_hash: t2,
      p_duration_min: null,
      p_staff_id: foreign!.id,
    });
    expect(e2?.message).toMatch(/staff_unavailable/);
  });

  it("reschedule_booking keeps the staff and reports staff_name", async () => {
    const { token, tokenHash } = generateAccessToken();
    await anon.rpc("create_booking", {
      p_handle: HANDLE,
      p_service_id: serviceId,
      p_starts_at: at(6, "09:00"),
      p_name: "R",
      p_email: "r@example.com",
      p_note: null,
      p_token_hash: tokenHash,
      p_staff_id: annaId,
    });
    const fresh = generateAccessToken();
    const { data, error } = await anon.rpc("reschedule_booking", {
      p_token: token,
      p_starts_at: at(6, "10:00"),
      p_new_token_hash: fresh.tokenHash,
    });
    expect(error).toBeNull();
    const row = (data as Array<{ new_booking_id: string; staff_id: string; staff_name: string }>)[0];
    expect(row.staff_id).toBe(annaId);
    expect(row.staff_name).toBe("Anna");
    const { data: r } = await anon.rpc("resolve_booking_token", { p_token: fresh.token });
    const rr = (r as Array<{ staff_id: string; staff_name: string }>)[0];
    expect(rr.staff_id).toBe(annaId);
    expect(rr.staff_name).toBe("Anna");
  });

  it("reschedule_booking_admin moves to another staff (staff_changed=true) and refuses ineligible staff", async () => {
    const { data: b } = await admin
      .from("bookings")
      .select("id")
      .eq("staff_id", annaId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const t1 = generateAccessToken();
    const { data, error } = await owner.rpc("reschedule_booking_admin", {
      p_booking_id: b!.id,
      p_starts_at: at(6, "11:00"),
      p_token_hash: t1.tokenHash,
      p_staff_id: defaultStaffId,
    });
    expect(error).toBeNull();
    const row = (data as Array<{ new_booking_id: string; staff_changed: boolean; staff_name: string }>)[0];
    expect(row.staff_changed).toBe(true);
    const { data: foreign } = await admin
      .from("staff")
      .select("id")
      .neq("org_id", orgId)
      .limit(1)
      .single();
    const t2 = generateAccessToken();
    const { error: e2 } = await owner.rpc("reschedule_booking_admin", {
      p_booking_id: row.new_booking_id,
      p_starts_at: at(6, "11:30"),
      p_token_hash: t2.tokenHash,
      p_staff_id: foreign!.id,
    });
    expect(e2?.message).toMatch(/staff_unavailable/);
  });
});
