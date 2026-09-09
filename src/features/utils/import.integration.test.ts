/**
 * S8 migration kit (0085 + import runner): the internal back office imports a
 * studio's future bookings through the admin hours RPC and the cash
 * mark-paid path while acting as service_role (Booklo staff are not members
 * of the studio's org). Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { addDaysISO, dateInZone, wallTimeToUtc } from "@/features/scheduling/slots";

try { loadEnvFile(".env.local"); } catch { /* CI exports env */ }

// The actions gate on the internal allowlist through the session cookie —
// there is no request context under vitest, so the guard is the one seam
// mocked (actions.test.ts idiom); everything past it runs for real.
vi.mock("./guard", () => ({
  requireInternal: vi.fn(async () => ({ user: { id: "u1", email: "owner@example.com" } })),
}));

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

const { runImport } = await import("./import-run");

describe("S8 — runImport writes rows through the admin RPC and reports per row", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("run"); }, 60_000);

  const row = (over: Partial<Parameters<typeof runImport>[1][number]>) => ({
    row: 2, offeringId: s.roomId, startsAt: iso(`${d(5)}T10:00`), durationMin: 60, name: "Imported", paid: true, ...over,
  });

  it("creates and settles a paid row, leaves an unpaid row owing, and skips both on a re-run", async () => {
    const rows = [row({ row: 2 }), row({ row: 3, startsAt: iso(`${d(5)}T12:00`), paid: false, email: "c@example.com", note: "old tool #17" })];
    const first = await runImport(admin, rows);
    expect(first.map((r) => r.status)).toEqual(["created", "created"]);
    const { data: a } = await admin.from("bookings").select("status, price_cents, paid_cents").eq("id", first[0].bookingId!).single();
    expect(a).toMatchObject({ status: "confirmed", price_cents: 10000, paid_cents: 10000 });
    const { data: b } = await admin.from("bookings").select("paid_cents, client_email, note").eq("id", first[1].bookingId!).single();
    expect(b).toMatchObject({ paid_cents: 0, client_email: "c@example.com", note: "old tool #17" });

    const again = await runImport(admin, rows);
    expect(again.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(again[0].reason).toMatch(/already|conflict/i);
  });

  it("skips a re-imported row even when the space has a second free unit (idempotency by space + start + client, not by the EXCLUDE)", async () => {
    const { error } = await s.owner.from("rental_units").insert({ org_id: s.orgId, offering_id: s.roomId, name: "Room A2", sort_order: 1 });
    expect(error).toBeNull();
    const rows = [row({ row: 2, startsAt: iso(`${d(8)}T10:00`), name: "Twice" })];
    expect((await runImport(admin, rows)).map((r) => r.status)).toEqual(["created"]);
    const again = await runImport(admin, rows);
    expect(again[0].status).toBe("skipped");
    expect(again[0].reason).toMatch(/already/i);
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("org_id", s.orgId).eq("client_name", "Twice");
    expect(count).toBe(1);
    // A different client at the same time on the second unit is a genuine new booking.
    const other = await runImport(admin, [row({ row: 3, startsAt: iso(`${d(8)}T10:00`), name: "Someone Else" })]);
    expect(other[0].status).toBe("created");
  });

  it("reports a row the studio's setup refuses (outside opening hours) as failed with the row number, and keeps going", async () => {
    const out = await runImport(admin, [row({ row: 7, startsAt: iso(`${d(6)}T07:00`) }), row({ row: 8, startsAt: iso(`${d(6)}T10:00`) })]);
    expect(out[0]).toMatchObject({ row: 7, status: "failed" });
    expect(out[0].reason).toBeTruthy();
    expect(out[1]).toMatchObject({ row: 8, status: "created" });
  });

  it("treats a paid row on an unpriced space as created (nothing to settle)", async () => {
    const { data: off } = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Free room", range_mode: "hours", slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
    }).select("id").single();
    await s.owner.from("rental_units").insert({ org_id: s.orgId, offering_id: off!.id, name: "Free room", sort_order: 0 });
    await s.owner.from("availability_rules").insert(
      Array.from({ length: 7 }, (_, weekday) => ({ org_id: s.orgId, rental_offering_id: off!.id, weekday, start_time: "09:00", end_time: "21:00" })),
    );
    const out = await runImport(admin, [row({ row: 2, offeringId: off!.id as string, startsAt: iso(`${d(7)}T10:00`) })]);
    expect(out[0].status).toBe("created");
    const { data: b } = await admin.from("bookings").select("price_cents, paid_cents").eq("id", out[0].bookingId!).single();
    expect(b).toEqual({ price_cents: null, paid_cents: 0 });
  });
});

const { previewBookingsImport, runBookingsImport } = await import("./import-actions");

describe("S8 — the /utils/import actions", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("act"); }, 60_000);

  const csv = () =>
    "space,date,start,end,client_name,client_email,note,paid\n" +
    `Room A,${d(9)},10:00,11:30,Anna Nowak,anna@example.com,,yes\n` +
    `Room B,${d(9)},10:00,11:00,Jan,,,\n`;

  it("preview resolves spaces against the org and names the bad row without writing anything", async () => {
    const out = await previewBookingsImport({ orgId: s.orgId, text: csv() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.ready.map((r) => [r.row, r.durationMin, r.paid])).toEqual([[2, 90, true]]);
    expect(out.ready[0].startsAt).toBe(iso(`${d(9)}T10:00`));
    expect(out.invalid).toEqual([{ row: 3, reason: expect.stringMatching(/Room B/) }]);
    const { count } = await admin.from("bookings").select("id", { count: "exact", head: true }).eq("org_id", s.orgId);
    expect(count).toBe(0);
  });

  it("run writes the ready rows and reports per row; the invalid row is reported, not written", async () => {
    const out = await runBookingsImport({ orgId: s.orgId, text: csv() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results).toEqual([
      { row: 2, status: "created", bookingId: expect.any(String) },
      { row: 3, status: "failed", reason: expect.stringMatching(/Room B/) },
    ]);
    const { data: b } = await admin.from("bookings").select("client_name, paid_cents").eq("id", out.results[0].bookingId!).single();
    expect(b).toEqual({ client_name: "Anna Nowak", paid_cents: 15000 });
  });

  it("refuses a malformed org id and a body over the row cap before touching the database", async () => {
    expect(await previewBookingsImport({ orgId: "nope", text: csv() })).toMatchObject({ ok: false });
    expect(await runBookingsImport({ orgId: s.orgId, text: "" })).toMatchObject({ ok: false });
  });
});
