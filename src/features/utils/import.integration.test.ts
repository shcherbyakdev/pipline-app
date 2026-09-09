/**
 * S8 migration kit (0085 + import runner): the internal back office imports a
 * studio's future bookings through the admin hours RPC and the cash
 * mark-paid path while acting as service_role (Booklo staff are not members
 * of the studio's org). Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

try { loadEnvFile(".env.local"); } catch { /* CI exports env */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const TZ = "Europe/Warsaw";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);
const iso = (local: string) => { const [dd, t] = local.split("T"); return wallTimeToUtc(dd, t, TZ).toISOString(); };
type Row = Record<string, unknown>;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

type Studio = { owner: SupabaseClient; orgId: string; roomId: string; unitId: string };

/** An org Booklo staff are NOT a member of: one priced hourly room, 7-day hours. */
async function newStudio(tag: string): Promise<Studio> {
  const owner = await signedInUser(tag);
  const { data: org, error: e1 } = await owner.rpc("create_org", {
    p_name: `S8 ${tag}`, p_offers_appointments: false, p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: `s8-${tag}-${Date.now()}`, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: off, error: e3 } = await owner.from("rental_offerings").insert({
    org_id: orgId, name: "Room A", range_mode: "hours", slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
    price_cents: 10000, pricing_mode: "per_unit",
  }).select("id").single();
  if (e3) throw e3;
  const { data: unit, error: e4 } = await owner.from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Room A", sort_order: 0 }).select("id").single();
  if (e4) throw e4;
  const { error: e5 } = await owner.from("availability_rules").insert(
    Array.from({ length: 7 }, (_, weekday) => ({ org_id: orgId, rental_offering_id: off!.id, weekday, start_time: "09:00", end_time: "21:00" })),
  );
  if (e5) throw e5;
  return { owner, orgId, roomId: off!.id as string, unitId: unit!.id as string };
}

const adminCreate = (client: SupabaseClient, s: Studio, startsLocal: string, over: Row = {}) =>
  client.rpc("create_rental_booking_hours_admin", {
    p_offering_id: s.roomId, p_unit_id: null, p_starts_at: iso(startsLocal), p_duration_min: 60,
    p_name: "Imported Client", p_email: null, p_note: null, p_token_hash: generateAccessToken().tokenHash, ...over,
  });

describe("S8 — 0085 lets service_role import and settle bookings", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("gate"); }, 60_000);

  it("service_role creates a booking in an org it is not a member of", async () => {
    const { data, error } = await adminCreate(admin, s, `${d(3)}T10:00`);
    expect(error).toBeNull();
    const { data: b } = await admin.from("bookings").select("status, price_cents, paid_cents").eq("id", data as string).single();
    expect(b).toMatchObject({ status: "confirmed", price_cents: 10000, paid_cents: 0 });
  });

  it("service_role marks that booking paid in full (the S7 cash path)", async () => {
    const { data: id } = await adminCreate(admin, s, `${d(3)}T12:00`);
    const { error } = await admin.rpc("mark_booking_paid", { p_booking_id: id });
    expect(error).toBeNull();
    const { data: b } = await admin.from("bookings").select("paid_cents").eq("id", id as string).single();
    expect(b!.paid_cents).toBe(10000);
  });

  it("anon still cannot call either RPC", async () => {
    const created = await adminCreate(anon, s, `${d(3)}T14:00`);
    expect(created.error).not.toBeNull();
    const { data: id } = await adminCreate(admin, s, `${d(3)}T15:00`);
    const paid = await anon.rpc("mark_booking_paid", { p_booking_id: id });
    expect(paid.error).not.toBeNull();
  });
});
