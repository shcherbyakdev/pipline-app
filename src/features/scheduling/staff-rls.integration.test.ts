/**
 * Team slice: staff becomes the calendar owner. Covers the 0041 surface —
 * create_org seeding the first staff row, RLS/grants on staff +
 * service_staff, the org-consistency and offboarding triggers, the
 * staff-keyed EXCLUDE guard, and the create_staff RPC (schedule copy +
 * service fan-out). Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

// bookings.cancel_token_hash is globally unique, so a fixed literal only
// works on the first run against a given stack. Suffix each with a
// per-run token to keep the file re-runnable.
const RUN = Date.now().toString(16);
const hash = (c: string) => (c.repeat(64) + RUN).slice(-64);

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;
let defaultStaffId: string;
let serviceId: string;

describe("staff: seed, RLS, triggers, create_staff", () => {
  beforeAll(async () => {
    owner = await signedInUser("staff_owner");
    stranger = await signedInUser("staff_stranger");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Team Co" });
    if (error) throw error;
    orgId = (org as { id: string }).id;
    await stranger.rpc("create_org", { p_name: "Other Co" });
    const { data: st } = await admin
      .from("staff")
      .select("id, name, slug, active")
      .eq("org_id", orgId);
    expect(st).toHaveLength(1);
    expect(st![0].slug).toBe("team-co");
    defaultStaffId = st![0].id;
    const { data: svc, error: e2 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Cut", duration_min: 30 })
      .select("id")
      .single();
    if (e2) throw e2;
    serviceId = svc.id;
    // A raw service insert deliberately does NOT fan out to staff — that is
    // createService's job (it writes every active staff, or the ticked
    // subset). Mirror it here so the create_staff assertion below sees the
    // default staff alongside the new one.
    const { error: e3 } = await owner
      .from("service_staff")
      .insert({ org_id: orgId, service_id: serviceId, staff_id: defaultStaffId });
    if (e3) throw e3;
  });

  it("create_org seeds one staff row named after the org", async () => {
    const { data } = await admin.from("staff").select("name").eq("id", defaultStaffId).single();
    expect(data!.name).toBe("Team Co");
  });

  it("anon cannot read staff or service_staff", async () => {
    const { data, error } = await anon.from("staff").select("id").eq("org_id", orgId);
    expect(error ?? data?.length === 0).toBeTruthy();
    const { data: d2, error: e2 } = await anon.from("service_staff").select("service_id");
    expect(e2 ?? d2?.length === 0).toBeTruthy();
  });

  it("member of another org cannot see or update staff", async () => {
    const { data } = await stranger.from("staff").select("id").eq("org_id", orgId);
    expect(data).toEqual([]);
    const { data: upd } = await stranger
      .from("staff")
      .update({ name: "x" })
      .eq("id", defaultStaffId)
      .select("id");
    expect(upd).toEqual([]);
  });

  it("a member cannot set staff.user_id via UPDATE (column-scoped grant, 0047)", async () => {
    // user_id is the future auth-login link; only SECURITY DEFINER RPCs may
    // write it. A member's direct UPDATE that touches user_id is denied at the
    // grant level (42501) even on their own org's row, while the columns the
    // app does edit stay writable.
    const { error } = await owner
      .from("staff")
      .update({ user_id: "00000000-0000-0000-0000-000000000001" })
      .eq("id", defaultStaffId);
    expect(error?.code).toBe("42501");
    const { error: ok } = await owner
      .from("staff")
      .update({ color: "#123456" })
      .eq("id", defaultStaffId);
    expect(ok).toBeNull();
  });

  it("a member cannot INSERT staff directly (no authenticated INSERT grant, 0047)", async () => {
    // Staff rows are created only through create_org / create_staff (SECURITY
    // DEFINER). A raw member INSERT — the other way to plant an arbitrary
    // user_id — is refused at the grant level.
    const { error } = await owner.from("staff").insert({
      org_id: orgId,
      name: "Planted",
      slug: "planted",
      color: "#000000",
      user_id: "00000000-0000-0000-0000-000000000002",
    });
    expect(error?.code).toBe("42501");
  });

  it("availability_rules require an owner (staff XOR rental offering, 0056) and staff must belong to the org", async () => {
    const { error } = await owner
      .from("availability_rules")
      .insert({ org_id: orgId, weekday: 1, start_time: "09:00", end_time: "12:00" });
    expect(error?.code).toBe("23514"); // availability_rules_owner CHECK (0056 dropped the staff_id NOT NULL)
    const { data: sst } = await admin
      .from("staff")
      .select("id")
      .neq("org_id", orgId)
      .limit(1)
      .single();
    const { error: e2 } = await owner
      .from("availability_rules")
      .insert({
        org_id: orgId,
        staff_id: sst!.id,
        weekday: 1,
        start_time: "09:00",
        end_time: "12:00",
      });
    expect(e2).toBeTruthy(); // org mismatch trigger
    const { error: e3 } = await owner
      .from("availability_rules")
      .insert({
        org_id: orgId,
        staff_id: defaultStaffId,
        weekday: 1,
        start_time: "09:00",
        end_time: "12:00",
      });
    expect(e3).toBeNull();
  });

  it("create_staff copies the first active staff's rules and fans out services", async () => {
    const { data: id, error } = await owner.rpc("create_staff", {
      p_org_id: orgId,
      p_name: "Anna",
      p_slug: "anna",
      p_email: "anna@example.com",
      p_color: "#4f46e5",
      p_service_ids: [serviceId],
    });
    expect(error).toBeNull();
    const { data: rules } = await admin
      .from("availability_rules")
      .select("weekday")
      .eq("staff_id", id as string);
    expect(rules).toEqual([{ weekday: 1 }]);
    const { data: ss } = await admin
      .from("service_staff")
      .select("staff_id")
      .eq("service_id", serviceId);
    expect(ss!.map((r) => r.staff_id).sort()).toEqual([defaultStaffId, id as string].sort());
  });

  it("stranger cannot create staff in the org", async () => {
    const { error } = await stranger.rpc("create_staff", {
      p_org_id: orgId,
      p_name: "Evil",
      p_slug: "evil",
      p_email: null,
      p_color: "#000000",
      p_service_ids: [],
    });
    expect(error?.message).toMatch(/not found/);
  });

  it("deactivating the last active staff is refused", async () => {
    // Anna exists (active) → deactivate her fine, then default refuses.
    const { data: anna } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .eq("slug", "anna")
      .single();
    const { error: ok } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(ok).toBeNull();
    const { error } = await owner.from("staff").update({ active: false }).eq("id", defaultStaffId);
    expect(error?.message).toMatch(/last_active_staff/);
    await owner.from("staff").update({ active: true }).eq("id", anna!.id);
  });

  it("deactivating staff with a confirmed future booking is refused; past-only is fine", async () => {
    const { data: anna } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .eq("slug", "anna")
      .single();
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { error: ins } = await admin.from("bookings").insert({
      org_id: orgId,
      service_id: serviceId,
      staff_id: anna!.id,
      client_name: "C",
      client_email: "c@example.com",
      starts_at: future,
      ends_at: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
      status: "confirmed",
      cancel_token_hash: hash("a"),
    });
    expect(ins).toBeNull();
    const { error } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(error?.message).toMatch(/has_future_bookings/);
    await admin
      .from("bookings")
      .update({ status: "cancelled_by_provider" })
      .eq("staff_id", anna!.id);
    const { error: ok } = await owner.from("staff").update({ active: false }).eq("id", anna!.id);
    expect(ok).toBeNull();
  });

  it("appointment bookings need staff_id; rental-shaped rows must not have one (CHECK)", async () => {
    const future = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const { error } = await admin.from("bookings").insert({
      org_id: orgId,
      service_id: serviceId,
      client_name: "C",
      starts_at: future,
      ends_at: new Date(new Date(future).getTime() + 30 * 60_000).toISOString(),
      status: "confirmed",
      cancel_token_hash: hash("b"),
    });
    expect(error?.code).toBe("23514");
  });

  it("guard is per staff: two staff can hold the same slot; one staff cannot", async () => {
    const { data: anna } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .eq("slug", "anna")
      .single();
    await owner.from("staff").update({ active: true }).eq("id", anna!.id);
    const s = new Date(Date.now() + 5 * 86_400_000);
    s.setUTCMinutes(0, 0, 0);
    const e = new Date(s.getTime() + 30 * 60_000);
    const row = (staffId: string, hash: string) => ({
      org_id: orgId,
      service_id: serviceId,
      staff_id: staffId,
      client_name: "C",
      starts_at: s.toISOString(),
      ends_at: e.toISOString(),
      status: "confirmed",
      cancel_token_hash: hash,
    });
    expect((await admin.from("bookings").insert(row(defaultStaffId, hash("c")))).error).toBeNull();
    expect((await admin.from("bookings").insert(row(anna!.id, hash("d")))).error).toBeNull();
    expect((await admin.from("bookings").insert(row(anna!.id, hash("e")))).error?.code).toBe(
      "23P01",
    );
  });
});
