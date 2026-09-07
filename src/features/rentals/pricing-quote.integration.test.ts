/**
 * S1 lockstep contract: public.rental_quote_hours (0078) and quoteHours
 * (pricing.ts) produce identical lines for every fixture case; the hourly
 * RPCs snapshot lines/people/price_cents; reschedule re-quotes at the new
 * time; refusals surface as sentinels; resolve_booking_token returns the
 * lines. Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { wallTimeToUtc } from "@/features/scheduling/slots";
import { quoteHours, sumLines } from "./pricing";
import {
  FIXTURE_CASES,
  FIXTURE_RULES,
  FIXTURE_TZ,
  FALLBACK_CASES,
  MON,
  SUN,
} from "./pricing-fixture";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const at = (local: string) => {
  const [d, t] = local.split("T");
  return wallTimeToUtc(d, t, FIXTURE_TZ).toISOString();
};
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

async function newOrg(tag: string) {
  const client = await signedInUser(tag);
  const { data: org, error: e1 } = await client.rpc("create_org", {
    p_name: `S1 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s1-${tag.replace(/_/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: FIXTURE_TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours offering 30/60–240, one unit, open every day 00:00–23:59 (the 0026
    CHECK caps end_time at 23:59, so "all day" is that) — every fixture case
    the RPCs create ends at 23:00 at the latest. Booking window 2 years so
    the fixture's 2027-03 dates are bookable. */
async function hoursFixture(
  client: SupabaseClient,
  orgId: string,
  over: Record<string, unknown> = {},
) {
  const { data: off, error: e1 } = await client
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
      booking_window_days: 730,
      unit_selection: "auto",
      active: true,
      pricing: FIXTURE_RULES,
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { data: unit, error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 })
    .select("id")
    .single();
  if (e2) throw e2;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e3 } = await client.from("availability_rules").insert(rules);
  if (e3) throw e3;
  return { offeringId: off!.id as string, unitId: unit!.id as string };
}

const bookingRow = async (id: string): Promise<Row> => {
  const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Row;
};

describe("rental_quote_hours ≡ quoteHours", () => {
  let offeringId: string;
  beforeAll(async () => {
    const { client, orgId } = await newOrg("lockstep");
    ({ offeringId } = await hoursFixture(client, orgId));
  });

  for (const c of FIXTURE_CASES) {
    it(c.name, async () => {
      const { data, error } = await admin.rpc("rental_quote_hours_test", {
        p_offering_id: offeringId,
        p_starts_at: at(c.startsLocal),
        p_duration_min: c.durationMin,
        p_people: c.people,
        p_extras: c.extras,
      });
      if (typeof c.expect === "string") {
        expect(error?.message).toContain(c.expect);
      } else {
        expect(error).toBeNull();
        expect(data).toEqual(c.expect);
        expect(data).toEqual(
          quoteHours(
            { pricing: FIXTURE_RULES, priceCents: null, pricingMode: "per_unit" },
            new Date(at(c.startsLocal)),
            c.durationMin,
            c.people,
            c.extras,
            FIXTURE_TZ,
          ),
        );
      }
    });
  }

  for (const c of FALLBACK_CASES) {
    it(`pricing NULL — ${c.name}`, async () => {
      const { client, orgId } = await newOrg("fallback");
      const { offeringId: id } = await hoursFixture(client, orgId, {
        pricing: null,
        price_cents: c.priceCents,
        pricing_mode: c.pricingMode,
      });
      const { data, error } = await admin.rpc("rental_quote_hours_test", {
        p_offering_id: id,
        p_starts_at: at(`${MON}T12:00`),
        p_duration_min: c.durationMin,
        p_people: null,
        p_extras: [],
      });
      expect(error).toBeNull();
      expect(data).toEqual(c.expect);
    });
  }
});

describe("hourly RPCs snapshot the quote", () => {
  it("public create writes lines, people, price_cents = sum, deposit from the total", async () => {
    const { client, orgId, handle } = await newOrg("snap");
    const { offeringId } = await hoursFixture(client, orgId, {
      deposit_type: "percent",
      deposit_value: 50,
    });
    const { data, error } = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${SUN}T21:00`),
      p_duration_min: 120,
      p_name: "Ola",
      p_email: `ola-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: hash(),
      p_people: 8,
      p_extras: [
        { id: "arri", qty: 1 },
        { id: "tlo", qty: 2 },
      ],
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    const expected = FIXTURE_CASES.find((c) => c.name.startsWith("everything at once"))!.expect;
    expect(row.lines).toEqual(expected);
    expect(row.people).toBe(8);
    expect(row.price_cents).toBe(sumLines(expected as never)); // 44200
    expect(row.deposit_cents).toBe(22100);
    expect(row.currency).toBe("PLN");
  });

  it("public create refuses people over max and unknown extras with sentinels", async () => {
    const { client, orgId, handle } = await newOrg("refuse");
    const { offeringId } = await hoursFixture(client, orgId);
    const base = {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${MON}T12:00`),
      p_duration_min: 60,
      p_name: "A",
      p_email: `a-${Date.now()}@example.com`,
      p_note: null,
    };
    const r1 = await admin.rpc("create_rental_booking_hours", {
      ...base,
      p_token_hash: hash(),
      p_people: 11,
      p_extras: [],
    });
    expect(r1.error?.message).toContain("quote_people");
    const r2 = await admin.rpc("create_rental_booking_hours", {
      ...base,
      p_token_hash: hash(),
      p_people: null,
      p_extras: [{ id: "fog", qty: 1 }],
    });
    expect(r2.error?.message).toContain("quote_extra");
  });

  it("admin create quotes base + surcharges with no people/extras", async () => {
    const { client, orgId } = await newOrg("adm");
    const { offeringId } = await hoursFixture(client, orgId);
    const { data, error } = await client.rpc("create_rental_booking_hours_admin", {
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${MON}T21:00`),
      p_duration_min: 120,
      p_name: "Walk-in",
      p_email: null,
      p_note: null,
      p_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow(data as string);
    expect(row.lines).toEqual([
      { kind: "base", qty: 2, unitCents: 12000, cents: 24000 },
      { kind: "surcharge", qty: 60, unitCents: null, cents: 3000, label: "Noc", pct: 25 },
    ]);
    expect(row.people).toBeNull();
    expect(row.price_cents).toBe(27000);
  });

  it("reschedule re-quotes at the new time with the same people and extras (Sunday night → Monday noon drops both surcharges)", async () => {
    const { client, orgId, handle } = await newOrg("resched");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${SUN}T21:00`),
      p_duration_min: 120,
      p_name: "Ola",
      p_email: `ola2-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: tokenHash,
      p_people: 8,
      p_extras: [{ id: "arri", qty: 1 }],
    });
    expect(created.error).toBeNull();
    const { data: moved, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token,
      p_unit_id: null,
      p_starts_at: at(`${MON}T12:00`),
      p_new_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow((moved as Row[])[0].new_booking_id as string);
    expect(row.lines).toEqual([
      { kind: "base", qty: 2, unitCents: 12000, cents: 24000 },
      { kind: "people", qty: 3, unitCents: 1000, cents: 3000 },
      {
        kind: "extra",
        qty: 1,
        unitCents: 5000,
        cents: 10000,
        extraId: "arri",
        label: "ARRI 2 kW",
        unit: "hour",
      },
    ]);
    expect(row.people).toBe(8);
    expect(row.price_cents).toBe(37000);
    const old = await bookingRow(created.data as string);
    expect(old.price_cents).toBe(41200); // 24000+3000+1200+3000+10000 — the old snapshot is untouched
  });

  it("resolve_booking_token returns lines and people", async () => {
    const { client, orgId, handle } = await newOrg("resolve");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${MON}T12:00`),
      p_duration_min: 60,
      p_name: "R",
      p_email: `r-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: tokenHash,
      p_people: 6,
      p_extras: [],
    });
    expect(created.error).toBeNull();
    const { data, error } = await anon.rpc("resolve_booking_token", { p_token: token });
    expect(error).toBeNull();
    const row = (data as Row[])[0];
    expect(row.lines).toEqual([
      { kind: "base", qty: 1, unitCents: 14000, cents: 14000 },
      { kind: "people", qty: 1, unitCents: 1000, cents: 1000 },
    ]);
    expect(row.people).toBe(6);
  });

  // Ruling 3 (S1): a confirmed booking must never be stranded by a menu
  // edit — the re-quote drops picks the studio deleted, clamps what it
  // lowered, and falls back to the old snapshot when it still refuses.
  it("a reschedule degrades when the menu changed: dropped extra, clamped qty, clamped people", async () => {
    const { client, orgId, handle } = await newOrg("degrade");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${MON}T12:00`),
      p_duration_min: 120,
      p_name: "Ola",
      p_email: `deg-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: tokenHash,
      p_people: 8,
      p_extras: [
        { id: "arri", qty: 2 },
        { id: "tlo", qty: 4 },
      ],
    });
    expect(created.error).toBeNull();
    expect((await bookingRow(created.data as string)).price_cents).toBe(53000);

    // The studio sells the ARRI no more, caps backdrops at 2 and seats 6.
    const { error: patched } = await admin
      .from("rental_offerings")
      .update({
        pricing: {
          ...FIXTURE_RULES,
          people: { ...FIXTURE_RULES.people!, max: 6 },
          extras: FIXTURE_RULES.extras.filter((e) => e.id === "tlo").map((e) => ({ ...e, maxQty: 2 })),
        },
      })
      .eq("id", offeringId);
    expect(patched).toBeNull();

    const { data: moved, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token,
      p_unit_id: null,
      p_starts_at: at(`${MON}T15:00`),
      p_new_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow((moved as Row[])[0].new_booking_id as string);
    expect(row.lines).toEqual([
      { kind: "base", qty: 2, unitCents: 12000, cents: 24000 },
      { kind: "people", qty: 1, unitCents: 1000, cents: 1000 },
      { kind: "extra", qty: 2, unitCents: 1500, cents: 3000, extraId: "tlo", label: "Tło kartonowe", unit: "piece" },
    ]);
    expect(row.people).toBe(6);
    expect(row.price_cents).toBe(28000);
  });

  it("a reschedule carries the old snapshot forward when the quote can no longer be worked out", async () => {
    const { client, orgId, handle } = await newOrg("carry");
    const { offeringId } = await hoursFixture(client, orgId);
    const { token, tokenHash } = generateAccessToken();
    const created = await admin.rpc("create_rental_booking_hours", {
      p_handle: handle,
      p_offering_id: offeringId,
      p_unit_id: null,
      p_starts_at: at(`${MON}T12:00`),
      p_duration_min: 120,
      p_name: "Ola",
      p_email: `carry-${Date.now()}@example.com`,
      p_note: null,
      p_token_hash: tokenHash,
      p_people: null,
      p_extras: [],
    });
    expect(created.error).toBeNull();
    const old = await bookingRow(created.data as string);
    expect(old.price_cents).toBe(24000);

    // The studio raises its minimum to 3 h: the 2 h booking has no band left.
    const { error: patched } = await admin
      .from("rental_offerings")
      .update({
        min_duration_min: 180,
        pricing: { ...FIXTURE_RULES, bands: [{ fromMin: 180, perHourCents: 12000 }] },
      })
      .eq("id", offeringId);
    expect(patched).toBeNull();

    const { data: moved, error } = await admin.rpc("reschedule_rental_booking_hours", {
      p_token: token,
      p_unit_id: null,
      p_starts_at: at(`${MON}T15:00`),
      p_new_token_hash: hash(),
    });
    expect(error).toBeNull();
    const row = await bookingRow((moved as Row[])[0].new_booking_id as string);
    expect(row.lines).toEqual(old.lines);
    expect(row.price_cents).toBe(old.price_cents);
  });

  it("the pricing CHECK refuses a non-object", async () => {
    const { client, orgId } = await newOrg("check");
    const { error } = await client.from("rental_offerings").insert({
      org_id: orgId,
      name: "Bad",
      range_mode: "hours",
      slot_increment_min: 30,
      min_duration_min: 60,
      max_duration_min: 240,
      pricing: [1, 2],
    });
    expect(error?.code).toBe("23514");
  });

  it("the pricing CHECK refuses rules on a non-hourly space", async () => {
    const { client, orgId } = await newOrg("nights");
    const { error } = await client.from("rental_offerings").insert({
      org_id: orgId,
      name: "Cabin",
      range_mode: "nights",
      start_time: "15:00",
      end_time: "11:00",
      min_stay: 1,
      turnover_days: 0,
      pricing: FIXTURE_RULES,
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("rental_offerings_pricing_hours_ck");
  });
});
