/**
 * S2 hold expiry against the local stack: the drain phase flips a lapsed
 * hold to 'expired', expires its open Checkout session/ledger row, mails the
 * client once, and is a no-op on a second tick. Requires `supabase start`.
 *
 * Import order matters: `@/env` parses process.env at module load, so the
 * app URL is set BEFORE the dynamic imports below (the webhook test's idiom).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { runHoldExpiry } = await import("./hold-expiry");
const { fakePaymentsProvider } = await import("@/lib/payments/fake");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const TZ = "Europe/Warsaw";
const DAY = "2027-07-19";
let counter = 0;

// ---------- seeding (holds.integration.test.ts's helpers, which are local
// to that file — the two suites seed the same shape).

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `hx_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
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
    p_name: `S2 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s2hx-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: TZ,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  return { client, orgId, handle };
}

/** Hours offering, one unit, open all day. Flat 100 zł/h with a 50 % deposit
    (H3), so every booking below owes 5000 cents. */
async function hoursFixture(client: SupabaseClient, orgId: string) {
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
      deposit_type: "percent",
      deposit_value: 50,
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

async function createHours(handle: string, offeringId: string, hour: number) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, TZ).toISOString(),
    p_duration_min: 60,
    p_name: "Ola",
    p_email: `ola${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return { id: data as string };
}

function recordingTransport(): { transport: EmailTransport; sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    transport: {
      async send(msg) {
        sent.push(msg);
        return { id: `t-${sent.length}` };
      },
    },
  };
}

async function lapsedHold(tag: string) {
  const { client, orgId, handle } = await newOrg(tag);
  const { offeringId } = await hoursFixture(client, orgId);
  await activeAccount(orgId);
  const { id } = await createHours(handle, offeringId, 10);
  await admin
    .from("bookings")
    .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", id);
  await admin.from("booking_payments").insert({
    org_id: orgId,
    booking_id: id,
    kind: "deposit",
    provider: "fake",
    amount_cents: 5000,
    currency: "PLN",
    status: "pending",
    checkout_session_id: `cs_exp_${id}`,
    stripe_account_id: "acct_fake_x",
  });
  return { id, handle };
}

/** The drain is table-wide by design, so a previous run's stale holds would
    otherwise ride along (and could fill the batch ahead of this suite's
    rows). Clear the field once, up front. */
beforeAll(async () => {
  const { error } = await admin
    .from("bookings")
    .update({ status: "expired" })
    .eq("status", "pending_payment")
    .lte("hold_expires_at", new Date().toISOString());
  if (error) throw error;
});

const releases = (sent: OutboundEmail[], handle: string) =>
  sent.filter((m) => m.subject.startsWith("Reservation released") && m.text.includes(`/${handle}`));

describe("runHoldExpiry", () => {
  it("flips a lapsed hold to expired, expires its ledger row, mails once; a second tick is a no-op", async () => {
    const { id, handle } = await lapsedHold("exp");
    const { transport, sent } = recordingTransport();
    const first = await runHoldExpiry({ db: admin, transport, provider: fakePaymentsProvider() });
    expect(first.expired).toBeGreaterThanOrEqual(1);
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe(
      "expired",
    );
    expect(
      (await admin.from("booking_payments").select("status").eq("booking_id", id).single()).data!
        .status,
    ).toBe("expired");
    expect(releases(sent, handle)[0]?.text).toContain(`/${handle}`);
    const again = await runHoldExpiry({ db: admin, transport, provider: fakePaymentsProvider() });
    expect(releases(sent, handle)).toHaveLength(1);
    expect(again.expired).toBe(0);
  });

  it("leaves a live hold alone", async () => {
    const { client, orgId, handle } = await newOrg("live");
    const { offeringId } = await hoursFixture(client, orgId);
    await activeAccount(orgId);
    const { id } = await createHours(handle, offeringId, 10);
    await runHoldExpiry({ db: admin, transport: recordingTransport().transport });
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe(
      "pending_payment",
    );
  });

  it("two concurrent ticks expire a row exactly once", async () => {
    const { id, handle } = await lapsedHold("race");
    const a = recordingTransport();
    const b = recordingTransport();
    await Promise.all([
      runHoldExpiry({ db: admin, transport: a.transport }),
      runHoldExpiry({ db: admin, transport: b.transport }),
    ]);
    expect((await admin.from("bookings").select("status").eq("id", id).single()).data!.status).toBe(
      "expired",
    );
    // Other lapsed rows may ride along; THIS booking's mail is exactly one
    // across both ticks — that is what the claim buys.
    expect(releases(a.sent, handle).length + releases(b.sent, handle).length).toBe(1);
  });
});
