/**
 * S7 against the local stack: public.booking_balance_cents ≡ balanceCents
 * (the one formula, both twins on the same rows); booking_charges RLS and
 * its cents = qty × unit_cents guard; mark_booking_paid settling a confirmed
 * booking in cash; write_off_booking forgiving the rest; apply_booking_payment
 * crediting a `balance` row without touching the status; rotate_booking_token
 * reissuing an ended booking's link. Requires the local stack (npm run setup).
 */
import { describe, it, expect } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { balanceCents } from "./settlement";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.PAYMENTS_PROVIDER = "fake";
process.env.PAYMENTS_FAKE_SECRET = "test-secret-0123456789abcdef";

const { generateAccessToken } = await import("@/lib/tokens/mint");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
let counter = 0;
type Row = Record<string, unknown>;

// ---------- seeding (the S2 refund suite's helpers + the S3 `startIn`).

/** A start N hours from now, truncated down to the current :00 (the fixture's
    grid is 30 min) — so the actual lead is between N and N-1 hours. Nudged
    forward an hour when that truncated instant's Europe/Warsaw local hour is
    23: the fixture's availability rule is 00:00–23:59, so a 23:00–00:00 slot
    (the default 60 min duration) crosses midnight and gets refused. */
function startIn(hours: number): string {
  const d = new Date(Date.now() + hours * 3_600_000);
  d.setUTCMinutes(0, 0, 0);
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(d),
  );
  if (localHour === 23) d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `s7_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
    p_name: `S7 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s7-${tag.replace(/_/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours space, 100 zł/h flat, open every day, one unit, no deposit (so a
    booking is confirmed and unpaid straight away); `over` wins. */
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
      price_cents: 10000,
      pricing_mode: "per_unit",
      ...over,
    })
    .select("id")
    .single();
  if (e1) throw e1;
  const { error: e2 } = await client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
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
  return { offeringId: off!.id as string };
}

async function activeAccount(orgId: string) {
  const { error } = await admin.from("payment_accounts").insert({
    org_id: orgId,
    stripe_account_id: `acct_test_${orgId.slice(0, 8)}_${counter++}`,
    status: "active",
  });
  if (error) throw error;
}

async function createHours(handle: string, offeringId: string, startsAt: string, durationMin = 60) {
  const t = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: startsAt,
    p_duration_min: durationMin,
    p_name: "Ola",
    p_email: `ola${counter++}@example.com`,
    p_note: null,
    p_token_hash: t.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return { id: data as string, token: t.token };
}

/** The webhook's path: a pending ledger row, then apply_booking_payment. */
async function pay(orgId: string, bookingId: string, cents: number, kind = "deposit") {
  const session = `cs_s7_${bookingId}_${counter++}`;
  const { error } = await admin.from("booking_payments").insert({
    org_id: orgId,
    booking_id: bookingId,
    kind,
    provider: "fake",
    amount_cents: cents,
    currency: "PLN",
    status: "pending",
    checkout_session_id: session,
    stripe_account_id: "acct_fake_x",
  });
  if (error) throw error;
  const { data, error: e } = await admin.rpc("apply_booking_payment", {
    p_session_id: session,
    p_payment_intent_id: `pi_${session}`,
    p_amount_cents: cents,
  });
  if (e) throw e;
  return { session, result: data as string };
}

const bookingRow = async (id: string): Promise<Row> => {
  const { data, error } = await admin.from("bookings").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Row;
};

describe("booking_balance_cents ≡ balanceCents", () => {
  it("no charges / charges / write-off / refund / overpaid", async () => {
    const { client, orgId, handle } = await newOrg("lock");
    const { offeringId } = await hoursFixture(client, orgId, {
      deposit_type: "percent",
      deposit_value: 30,
    });
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // hold
    await pay(orgId, id, 3000); // confirmed, paid 3000

    const expectBalance = async (expected: number) => {
      const { data, error } = await admin.rpc("booking_balance_cents", { p_booking_id: id });
      if (error) throw error;
      const row = await bookingRow(id);
      const { data: ch } = await admin
        .from("booking_charges")
        .select("cents")
        .eq("booking_id", id);
      const twin = balanceCents({
        priceCents: row.price_cents as number | null,
        feeCents: row.fee_cents as number,
        chargesCents: (ch ?? []).reduce((s, c) => s + (c.cents as number), 0),
        writtenOffCents: row.written_off_cents as number,
        paidCents: row.paid_cents as number,
        refundedCents: row.refunded_cents as number,
      });
      expect(data).toBe(expected);
      expect(twin).toBe(expected);
    };

    await expectBalance(7000);
    const { error: chargeError } = await client.from("booking_charges").insert({
      org_id: orgId,
      booking_id: id,
      kind: "cleaning",
      label: "Cleaning",
      qty: 1,
      unit_cents: 15000,
      cents: 15000,
    });
    expect(chargeError).toBeNull();
    await expectBalance(22000);
    await admin.from("bookings").update({ written_off_cents: 2000 }).eq("id", id);
    await expectBalance(20000);
    await admin.from("bookings").update({ refunded_cents: 1000 }).eq("id", id);
    await expectBalance(21000);
    await admin
      .from("bookings")
      .update({ written_off_cents: 0, refunded_cents: 0, paid_cents: 30000 })
      .eq("id", id);
    await expectBalance(-5000);
  });
});

describe("booking_charges RLS", () => {
  it("member inserts/reads/deletes; outsider sees nothing and cannot pin a charge to another org's booking", async () => {
    const a = await newOrg("rls_a");
    const b = await newOrg("rls_b");
    const { offeringId } = await hoursFixture(a.client, a.orgId);
    const { id } = await createHours(a.handle, offeringId, startIn(100));
    const ins = await a.client
      .from("booking_charges")
      .insert({
        org_id: a.orgId,
        booking_id: id,
        kind: "other",
        label: "Props",
        qty: 2,
        unit_cents: 500,
        cents: 1000,
      })
      .select("id, created_by")
      .single();
    expect(ins.error).toBeNull();
    // created_by defaults to auth.uid(): the member who added the charge.
    expect(ins.data!.created_by).not.toBeNull();
    expect((await b.client.from("booking_charges").select("id").eq("booking_id", id)).data).toEqual(
      [],
    );
    const bad = await b.client.from("booking_charges").insert({
      org_id: b.orgId,
      booking_id: id,
      kind: "other",
      label: "X",
      qty: 1,
      unit_cents: 100,
      cents: 100,
    });
    expect(bad.error).not.toBeNull(); // WITH CHECK: booking belongs to org a
    const del = await a.client
      .from("booking_charges")
      .delete()
      .eq("id", ins.data!.id)
      .select("id");
    expect(del.data).toHaveLength(1);
  });

  it("cents must equal qty × unit_cents", async () => {
    const { client, orgId, handle } = await newOrg("cents");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100));
    const bad = await client.from("booking_charges").insert({
      org_id: orgId,
      booking_id: id,
      kind: "other",
      label: "Off by one",
      qty: 2,
      unit_cents: 500,
      cents: 999,
    });
    expect(bad.error?.message).toMatch(/booking_charges_check/);
    expect(
      (await admin.from("booking_charges").select("id").eq("booking_id", id)).data,
    ).toEqual([]);
  });
});

describe("mark_booking_paid on a confirmed booking", () => {
  it("records a manual balance row and bumps paid_cents; nothing_due at balance 0", async () => {
    const { client, orgId, handle } = await newOrg("cash");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // confirmed, unpaid, balance 10000
    const { error } = await client.rpc("mark_booking_paid", { p_booking_id: id });
    expect(error).toBeNull();
    const row = await bookingRow(id);
    expect(row.paid_cents).toBe(10000);
    expect(row.status).toBe("confirmed");
    const { data: ledger } = await admin
      .from("booking_payments")
      .select("kind, provider, amount_cents, status")
      .eq("booking_id", id);
    expect(ledger).toEqual([
      { kind: "balance", provider: "manual", amount_cents: 10000, status: "paid" },
    ]);
    const again = await client.rpc("mark_booking_paid", { p_booking_id: id });
    expect(again.error?.message).toMatch(/nothing_due/);
  });
});

describe("write_off_booking", () => {
  it("sets written_off_cents to the balance with a note; nothing_due when settled; org-gated", async () => {
    const { client, orgId, handle } = await newOrg("wo");
    const other = await newOrg("wo_out");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // balance 10000

    // Another org's member cannot reach it at all.
    const outsider = await other.client.rpc("write_off_booking", {
      p_booking_id: id,
      p_note: "mine now",
    });
    expect(outsider.error?.message).toMatch(/not found/);
    expect((await bookingRow(id)).written_off_cents).toBe(0);

    const { data, error } = await client.rpc("write_off_booking", {
      p_booking_id: id,
      p_note: "damaged lamp",
    });
    expect(error).toBeNull();
    expect(data).toBe(id);
    const row = await bookingRow(id);
    expect(row.written_off_cents).toBe(10000);
    expect(row.written_off_note).toBe("damaged lamp");
    expect((await admin.rpc("booking_balance_cents", { p_booking_id: id })).data).toBe(0);

    const again = await client.rpc("write_off_booking", { p_booking_id: id, p_note: "again" });
    expect(again.error?.message).toMatch(/nothing_due/);
    expect((await bookingRow(id)).written_off_note).toBe("damaged lamp"); // untouched

    // An empty note is stored as NULL, not as ''.
    const { id: id2 } = await createHours(handle, offeringId, startIn(120));
    const blank = await client.rpc("write_off_booking", { p_booking_id: id2, p_note: "" });
    expect(blank.error).toBeNull();
    const row2 = await bookingRow(id2);
    expect(row2.written_off_cents).toBe(10000);
    expect(row2.written_off_note).toBeNull();
  });
});

describe("apply_booking_payment with a balance row", () => {
  it("credits a confirmed booking without changing status; slot_lost on a cancelled one", async () => {
    const { client, orgId, handle } = await newOrg("bal");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100)); // confirmed, balance 10000
    const { result } = await pay(orgId, id, 10000, "balance");
    expect(result).toBe("balance");
    const row = await bookingRow(id);
    expect(row.paid_cents).toBe(10000);
    expect(row.status).toBe("confirmed");
    expect((await admin.rpc("booking_balance_cents", { p_booking_id: id })).data).toBe(0);

    // Money for a booking that is gone: the ledger row is still marked paid
    // (the caller refunds it), but the booking is never credited.
    const { id: dead } = await createHours(handle, offeringId, startIn(120));
    await admin.from("bookings").update({ status: "cancelled_by_provider" }).eq("id", dead);
    const { session, result: lost } = await pay(orgId, dead, 10000, "balance");
    expect(lost).toBe("slot_lost");
    const deadRow = await bookingRow(dead);
    expect(deadRow.paid_cents).toBe(0);
    expect(deadRow.status).toBe("cancelled_by_provider");
    const { data: ledger } = await admin
      .from("booking_payments")
      .select("status")
      .eq("checkout_session_id", session)
      .single();
    expect(ledger).toEqual({ status: "paid" });
  });
});

describe("rotate_booking_token after the session", () => {
  it("accepts an ended confirmed booking, refuses one ended more than 30 days ago and a pending request that started", async () => {
    const { client, orgId, handle } = await newOrg("rot");
    const { offeringId } = await hoursFixture(client, orgId);
    const { id } = await createHours(handle, offeringId, startIn(100));
    const day = 86_400_000;
    const move = async (bookingId: string, startsAgoDays: number) =>
      admin
        .from("bookings")
        .update({
          starts_at: new Date(Date.now() - startsAgoDays * day).toISOString(),
          ends_at: new Date(Date.now() - startsAgoDays * day + 3_600_000).toISOString(),
        })
        .eq("id", bookingId);

    // Yesterday's confirmed booking: the link can be reissued (30-day window).
    await move(id, 1);
    const fresh = generateAccessToken();
    const ok = await client.rpc("rotate_booking_token", {
      p_booking_id: id,
      p_token_hash: fresh.tokenHash,
    });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe(id);
    expect((await bookingRow(id)).cancel_token_hash).toBe(fresh.tokenHash);

    // 40 days ago: past resolve_booking_token's window, so refused.
    await move(id, 40);
    const stale = generateAccessToken();
    const old = await client.rpc("rotate_booking_token", {
      p_booking_id: id,
      p_token_hash: stale.tokenHash,
    });
    expect(old.error?.message).toMatch(/not found/);
    expect((await bookingRow(id)).cancel_token_hash).toBe(fresh.tokenHash); // untouched

    // A request that has already started keeps the old rule: no rotation.
    const { id: req } = await createHours(handle, offeringId, startIn(120));
    await move(req, 1);
    await admin.from("bookings").update({ status: "pending" }).eq("id", req);
    const pending = await client.rpc("rotate_booking_token", {
      p_booking_id: req,
      p_token_hash: generateAccessToken().tokenHash,
    });
    expect(pending.error?.message).toMatch(/not found/);
  });
});
