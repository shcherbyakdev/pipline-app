/**
 * S6 compound resources (0084): booking_units occupancy, composites
 * (whole studio ⊃ rooms), equipment add-ons. Requires the local Supabase
 * stack (npm run setup).
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
const TZ = "Europe/Warsaw";
const d = (n: number) => addDaysISO(dateInZone(new Date(), TZ), n);
const iso = (local: string) => { const [dd, t] = local.split("T"); return wallTimeToUtc(dd, t, TZ).toISOString(); };
const hash = () => generateAccessToken().tokenHash;
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

type Studio = {
  owner: SupabaseClient; orgId: string; handle: string;
  roomA: { id: string; unitId: string }; roomB: { id: string; unitId: string };
  whole: { id: string; unitId: string };
  lamp: { id: string; unitIds: string[] };
};

/** Two hourly rooms, a whole-studio composite including both, and a
    2-unit equipment space (the lamp), all with 7-day 09:00–21:00 hours. */
async function newStudio(tag: string): Promise<Studio> {
  const owner = await signedInUser(tag);
  const { data: org, error: e1 } = await owner.rpc("create_org", {
    p_name: `S6 ${tag}`, p_offers_appointments: false, p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s6-${tag.replace(/_/g, "-")}-${Date.now()}`;
  const { error: e2 } = await owner.rpc("update_org_scheduling", {
    p_org_id: orgId, p_handle: handle, p_timezone: TZ, p_currency: "PLN",
  });
  if (e2) throw e2;

  async function offering(name: string, kind: "space" | "composite" | "equipment", price: number | null) {
    const { data, error } = await owner.from("rental_offerings").insert({
      org_id: orgId, name, kind, range_mode: "hours", unit_selection: "auto",
      slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
      price_cents: price, pricing_mode: "per_unit",
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function unit(offeringId: string, name: string, sort: number) {
    const { data, error } = await owner.from("rental_units")
      .insert({ org_id: orgId, offering_id: offeringId, name, sort_order: sort }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }
  async function hours(offeringId: string) {
    const rules = Array.from({ length: 7 }, (_, weekday) => ({
      org_id: orgId, rental_offering_id: offeringId, weekday, start_time: "09:00", end_time: "21:00",
    }));
    const { error } = await owner.from("availability_rules").insert(rules);
    if (error) throw error;
  }
  const roomAId = await offering("Room A", "space", 10000);
  const roomBId = await offering("Room B", "space", 10000);
  const wholeId = await offering("Whole studio", "composite", 25000);
  const lampId = await offering("ARRI lamp", "equipment", 5000);
  const s: Studio = {
    owner, orgId, handle,
    roomA: { id: roomAId, unitId: await unit(roomAId, "Room A", 0) },
    roomB: { id: roomBId, unitId: await unit(roomBId, "Room B", 0) },
    whole: { id: wholeId, unitId: await unit(wholeId, "Whole studio", 0) },
    lamp: { id: lampId, unitIds: [await unit(lampId, "Lamp 1", 0), await unit(lampId, "Lamp 2", 1)] },
  };
  await hours(roomAId); await hours(roomBId); await hours(wholeId);
  const { error: e3 } = await owner.from("rental_offering_components").insert([
    { composite_id: wholeId, component_id: roomAId, org_id: orgId },
    { composite_id: wholeId, component_id: roomBId, org_id: orgId },
  ]);
  if (e3) throw e3;
  return s;
}

function book(s: Studio, offeringId: string, startsLocal: string, durationMin: number, extra: Row = {}) {
  return admin.rpc("create_rental_booking_hours", {
    p_handle: s.handle, p_offering_id: offeringId, p_unit_id: null,
    p_starts_at: iso(startsLocal), p_duration_min: durationMin,
    p_name: "Client", p_email: `c${Math.random().toString(36).slice(2)}@example.com`,
    p_note: null, p_token_hash: hash(), p_people: null, p_extras: [],
    ...extra,
  });
}

const isTaken = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === "23P01" || /taken/.test(error.message ?? ""));

async function units(bookingId: string): Promise<Row[]> {
  const { data, error } = await admin.from("booking_units").select("rental_unit_id, kind, reserving").eq("booking_id", bookingId);
  if (error) throw error;
  return data as Row[];
}

describe("S6 — booking_units + composites (0084 part A)", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("a"); }, 60_000);

  it("a room booking writes one primary occupancy row", async () => {
    const { data, error } = await book(s, s.roomA.id, `${d(3)}T10:00`, 60);
    expect(error).toBeNull();
    const rows = await units(data as string);
    expect(rows).toEqual([{ rental_unit_id: s.roomA.unitId, kind: "primary", reserving: true }]);
  });

  it("a whole-studio booking writes primary + one component row per room, and both rooms are blocked", async () => {
    const { data, error } = await book(s, s.whole.id, `${d(4)}T10:00`, 120);
    expect(error).toBeNull();
    const rows = await units(data as string);
    expect(rows.map((r) => `${r.kind}:${r.rental_unit_id}`).sort()).toEqual(
      [`primary:${s.whole.unitId}`, `component:${s.roomA.unitId}`, `component:${s.roomB.unitId}`].sort(),
    );
    const a = await book(s, s.roomA.id, `${d(4)}T11:00`, 60);
    expect(isTaken(a.error)).toBe(true);
    const b = await book(s, s.roomB.id, `${d(4)}T09:00`, 90);   // 09:00–10:30 overlaps 10:00
    expect(isTaken(b.error)).toBe(true);
    const c = await book(s, s.roomB.id, `${d(4)}T12:00`, 60);   // right after — free
    expect(c.error).toBeNull();
  });

  it("a room booking blocks the whole studio for that hour", async () => {
    const r = await book(s, s.roomA.id, `${d(5)}T14:00`, 60);
    expect(r.error).toBeNull();
    const w = await book(s, s.whole.id, `${d(5)}T13:00`, 120);
    expect(isTaken(w.error)).toBe(true);
    const w2 = await book(s, s.whole.id, `${d(5)}T15:00`, 60);
    expect(w2.error).toBeNull();
  });

  it("a blackout on an included room blocks the whole studio", async () => {
    const { error } = await s.owner.from("rental_unit_blackouts").insert({
      org_id: s.orgId, rental_unit_id: s.roomB.unitId, start_date: d(6), end_date: d(6), reason: "paint",
    });
    expect(error).toBeNull();
    const w = await book(s, s.whole.id, `${d(6)}T10:00`, 60);
    expect(isTaken(w.error)).toBe(true);
    const a = await book(s, s.roomA.id, `${d(6)}T10:00`, 60);   // room A itself is fine
    expect(a.error).toBeNull();
  });

  it("cancelling clears reserving on every row and frees the rooms", async () => {
    const { data, error } = await book(s, s.whole.id, `${d(7)}T10:00`, 60);
    expect(error).toBeNull();
    const { error: e } = await admin.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", data as string);
    expect(e).toBeNull();
    const rows = await units(data as string);
    expect(rows.every((r) => r.reserving === false)).toBe(true);
    const a = await book(s, s.roomA.id, `${d(7)}T10:00`, 60);
    expect(a.error).toBeNull();
  });

  it("component guard: cross-org, self, non-composite parent, dates-mode child are refused", async () => {
    const other = await newStudio("b");
    const cross = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: other.roomA.id, org_id: s.orgId });
    expect(cross.error).not.toBeNull();
    const self = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: s.whole.id, org_id: s.orgId });
    expect(self.error).not.toBeNull();
    const notComposite = await s.owner.from("rental_offering_components").insert({ composite_id: s.roomA.id, component_id: s.roomB.id, org_id: s.orgId });
    expect(notComposite.error).not.toBeNull();
    const { data: nights, error: e } = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Flat", range_mode: "nights", start_time: "15:00", end_time: "11:00",
    }).select("id").single();
    expect(e).toBeNull();
    const datesChild = await s.owner.from("rental_offering_components").insert({ composite_id: s.whole.id, component_id: nights!.id, org_id: s.orgId });
    expect(datesChild.error).not.toBeNull();
  });

  it("kind CHECK: a composite or equipment space must be hours mode with auto selection", async () => {
    const bad = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Bad", kind: "equipment", range_mode: "nights", start_time: "15:00", end_time: "11:00",
    });
    expect(bad.error?.code).toBe("23514");
    const bad2 = await s.owner.from("rental_offerings").insert({
      org_id: s.orgId, name: "Bad2", kind: "composite", range_mode: "hours", unit_selection: "client_picks",
      slot_increment_min: 30, min_duration_min: 60, max_duration_min: 240,
    });
    expect(bad2.error?.code).toBe("23514");
  });

  it("backfill: every rental booking has exactly one primary row", async () => {
    const { count: bookings } = await admin.from("bookings").select("id", { count: "exact", head: true }).not("rental_unit_id", "is", null);
    const { count: primaries } = await admin.from("booking_units").select("id", { count: "exact", head: true }).eq("kind", "primary");
    expect(primaries).toBe(bookings);
  });
});

describe("S6 — equipment add-ons + reschedule (0084 part B)", () => {
  let s: Studio;
  beforeAll(async () => { s = await newStudio("c"); }, 60_000);

  const lampPick = (qty: number) => ({ p_equipment: [{ offeringId: s.lamp.id, qty }] });

  it("attaches equipment rows, prices them, and the same lamp cannot serve two rooms at once", async () => {
    const a = await book(s, s.roomA.id, `${d(3)}T10:00`, 60, lampPick(2));
    expect(a.error).toBeNull();
    const rows = await units(a.data as string);
    expect(rows.filter((r) => r.kind === "equipment").map((r) => r.rental_unit_id).sort()).toEqual([...s.lamp.unitIds].sort());
    const { data: b } = await admin.from("bookings").select("price_cents, lines").eq("id", a.data as string).single();
    expect(b!.price_cents).toBe(10000 + 2 * 5000);
    expect((b!.lines as Row[]).some((l) => l.kind === "equipment" && l.qty === 2)).toBe(true);
    // Both lamps are gone for that hour: Room B with one lamp fails, without a lamp passes.
    const taken = await book(s, s.roomB.id, `${d(3)}T10:30`, 60, lampPick(1));
    expect(isTaken(taken.error)).toBe(true);
    const free = await book(s, s.roomB.id, `${d(3)}T10:30`, 60);
    expect(free.error).toBeNull();
  });

  it("two rooms, one lamp each, same hour: both pass", async () => {
    const a = await book(s, s.roomA.id, `${d(8)}T10:00`, 60, lampPick(1));
    const b = await book(s, s.roomB.id, `${d(8)}T10:00`, 60, lampPick(1));
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    const ua = await units(a.data as string); const ub = await units(b.data as string);
    const lampA = ua.find((r) => r.kind === "equipment")!.rental_unit_id;
    const lampB = ub.find((r) => r.kind === "equipment")!.rental_unit_id;
    expect(lampA).not.toBe(lampB);
  });

  it("refuses a pick over the unit count and equipment as the primary offering", async () => {
    const over = await book(s, s.roomA.id, `${d(9)}T10:00`, 60, lampPick(3));
    expect(over.error?.message).toMatch(/quote_equipment/);
    const primary = await book(s, s.lamp.id, `${d(9)}T10:00`, 60);
    expect(primary.error?.message).toMatch(/not found/);
  });

  it("reschedule carries the lamp, prefers the same unit, refuses when none is free", async () => {
    const a = await book(s, s.roomA.id, `${d(10)}T10:00`, 60, lampPick(1));
    expect(a.error).toBeNull();
    const lampBefore = (await units(a.data as string)).find((r) => r.kind === "equipment")!.rental_unit_id;
    // Someone else takes the OTHER lamp at 14:00; the move to 14:00 must keep ours.
    const otherLamp = s.lamp.unitIds.find((u) => u !== lampBefore)!;
    const other = await book(s, s.roomB.id, `${d(10)}T14:00`, 60, lampPick(1));
    expect(other.error).toBeNull();
    const otherRows = await units(other.data as string);
    // Auto-pick is by sort_order, so make the assertion independent of which lamp `other` got:
    const otherLampGot = otherRows.find((r) => r.kind === "equipment")!.rental_unit_id;
    const moved = await s.owner.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: a.data, p_unit_id: null, p_starts_at: iso(`${d(10)}T14:00`), p_new_token_hash: hash(),
    });
    expect(moved.error).toBeNull();
    const newId = (moved.data as Row[])[0].new_booking_id as string;
    const after = await units(newId);
    const lampAfter = after.find((r) => r.kind === "equipment")!.rental_unit_id;
    expect(lampAfter).not.toBe(otherLampGot);
    expect([lampBefore, otherLamp]).toContain(lampAfter);
    const { data: nb } = await admin.from("bookings").select("lines").eq("id", newId).single();
    expect((nb!.lines as Row[]).some((l) => l.kind === "equipment")).toBe(true);
    // Old rows released.
    expect((await units(a.data as string)).every((r) => r.reserving === false)).toBe(true);
    // Now both lamps are taken at 16:00 → a move there must refuse.
    const x = await book(s, s.roomB.id, `${d(10)}T16:00`, 60, lampPick(2));
    expect(x.error).toBeNull();
    const refused = await s.owner.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: newId, p_unit_id: null, p_starts_at: iso(`${d(10)}T16:00`), p_new_token_hash: hash(),
    });
    expect(isTaken(refused.error)).toBe(true);
  });

  it("reschedule drops the equipment line when the equipment space is inactive", async () => {
    const t = await newStudio("dgr");
    const a = await book(t, t.roomA.id, `${d(11)}T10:00`, 60, { p_equipment: [{ offeringId: t.lamp.id, qty: 1 }] });
    expect(a.error).toBeNull();
    const { error } = await t.owner.from("rental_offerings").update({ active: false }).eq("id", t.lamp.id);
    expect(error).toBeNull();
    const moved = await t.owner.rpc("reschedule_rental_booking_hours_admin", {
      p_booking_id: a.data, p_unit_id: null, p_starts_at: iso(`${d(11)}T12:00`), p_new_token_hash: hash(),
    });
    expect(moved.error).toBeNull();
    const newId = (moved.data as Row[])[0].new_booking_id as string;
    const { data: nb } = await admin.from("bookings").select("price_cents, lines").eq("id", newId).single();
    expect(nb!.price_cents).toBe(10000);
    expect((await units(newId)).some((r) => r.kind === "equipment")).toBe(false);
  });
});
