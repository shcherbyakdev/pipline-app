/**
 * S4 morning digest against the local stack: digest_due_orgs picks orgs by
 * local hour + stamp, runDailyDigest claims each org once, skips (but
 * stamps) an empty list, and honours the member's matrix row.
 * Requires `supabase start`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";
import type { PushPayload } from "@/features/notifications/push";

try {
  loadEnvFile(".env.local");
} catch {
  /* CI exports env */
}
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";

const { runDailyDigest } = await import("./digest");
const { generateAccessToken } = await import("@/lib/tokens/mint");
const { wallTimeToUtc } = await import("@/features/scheduling/slots");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const DAY = "2027-08-09";
let counter = 0;

/** A zone where it is past 08:00 right now, and one where it is not. Both
    exist at every UTC hour: the +14/−12 spread covers 26 hours. */
function zones(now = new Date()) {
  const utcHour = now.getUTCHours();
  // local hour = utcHour + offset (mod 24); pick offsets deterministically.
  const past8 = [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11].find(
    (o) => ((utcHour + o + 24) % 24) >= 8 && ((utcHour + o + 24) % 24) <= 22,
  )!;
  const before8 = [-11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].find(
    (o) => ((utcHour + o + 24) % 24) < 7,
  )!;
  const name = (o: number) => (o === 0 ? "Etc/UTC" : `Etc/GMT${o > 0 ? "-" : "+"}${Math.abs(o)}`); // Etc/GMT signs are inverted
  return { past8: name(past8), before8: name(before8) };
}

async function signedInUser(tag: string) {
  const email = `dg_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { client, email, userId: data.user!.id };
}

async function newOrg(tag: string, timezone: string) {
  const user = await signedInUser(tag);
  const { data: org, error: e1 } = await user.client.rpc("create_org", {
    p_name: `S4 ${tag}`,
    p_offers_appointments: false,
    p_offers_rentals: true,
  });
  if (e1) throw e1;
  const orgId = (org as { id: string }).id;
  const handle = `s4dg-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { error: e2 } = await user.client.rpc("update_org_scheduling", {
    p_org_id: orgId,
    p_handle: handle,
    p_timezone: timezone,
    p_currency: "PLN",
  });
  if (e2) throw e2;
  const { data: off, error: e3 } = await user.client
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
  if (e3) throw e3;
  const { error: e4 } = await user.client
    .from("rental_units")
    .insert({ org_id: orgId, offering_id: off!.id, name: "Studio", active: true, sort_order: 0 });
  if (e4) throw e4;
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    org_id: orgId,
    rental_offering_id: off!.id,
    weekday,
    start_time: "00:00",
    end_time: "23:59",
  }));
  const { error: e5 } = await user.client.from("availability_rules").insert(rules);
  if (e5) throw e5;
  return { ...user, orgId, handle, offeringId: off!.id as string, timezone };
}

async function createHours(handle: string, offeringId: string, hour: number, name: string) {
  const token = generateAccessToken();
  const { data, error } = await admin.rpc("create_rental_booking_hours", {
    p_handle: handle,
    p_offering_id: offeringId,
    p_unit_id: null,
    p_starts_at: wallTimeToUtc(DAY, `${String(hour).padStart(2, "0")}:00`, "Etc/UTC").toISOString(),
    p_duration_min: 60,
    p_name: name,
    p_email: `c${counter++}@example.com`,
    p_note: null,
    p_token_hash: token.tokenHash,
    p_people: null,
    p_extras: [],
  });
  if (error) throw error;
  return data as string;
}

function recorder() {
  const sent: OutboundEmail[] = [];
  const pushes: Array<{ userId: string; payload: PushPayload }> = [];
  const transport: EmailTransport = {
    async send(msg) {
      sent.push(msg);
      return { id: `t-${sent.length}` };
    },
  };
  const push = async (userId: string, payload: PushPayload) => {
    pushes.push({ userId, payload });
    return { sent: 1, dropped: 0, failed: 0 };
  };
  return { sent, pushes, transport, push };
}

async function stamp(orgId: string) {
  const { data, error } = await admin.from("orgs").select("digest_sent_on").eq("id", orgId).single();
  if (error) throw error;
  return data.digest_sent_on as string | null;
}

/** The local DB holds every org other integration files ever created, all
    unstamped and therefore due. Stamp them out of the way (the RPC returns
    25 at a time — loop until it is empty) so these tests see only their own. */
async function drainDueOrgs() {
  for (let guard = 0; guard < 200; guard++) {
    const { data, error } = await admin.rpc("digest_due_orgs");
    if (error) throw error;
    const rows = (data ?? []) as Array<{ id: string; local_date: string }>;
    if (rows.length === 0) return;
    for (const r of rows) {
      const { error: e } = await admin.from("orgs").update({ digest_sent_on: r.local_date }).eq("id", r.id);
      if (e) throw e;
    }
  }
  throw new Error("digest_due_orgs never drained");
}

beforeAll(drainDueOrgs);

describe("digest_due_orgs", () => {
  it("picks by local hour and stamp", async () => {
    const z = zones();
    const due = await newOrg("due", z.past8);
    const early = await newOrg("early", z.before8);
    const done = await newOrg("done", z.past8);
    const { data: local } = await admin.rpc("digest_due_orgs");
    const todayThere = (local as Array<{ id: string; local_date: string }>).find((r) => r.id === due.orgId)!.local_date;
    await admin.from("orgs").update({ digest_sent_on: todayThere }).eq("id", done.orgId);
    const yesterday = await newOrg("yesterday", z.past8);
    const y = new Date(new Date(todayThere).getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await admin.from("orgs").update({ digest_sent_on: y }).eq("id", yesterday.orgId);

    const { data, error } = await admin.rpc("digest_due_orgs");
    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(due.orgId);
    expect(ids).toContain(yesterday.orgId);
    expect(ids).not.toContain(early.orgId);
    expect(ids).not.toContain(done.orgId);
  });

  it("is service-role only", async () => {
    const user = await signedInUser("nope");
    const { error } = await user.client.rpc("digest_due_orgs");
    expect(error).not.toBeNull();
  });
});

describe("runDailyDigest", () => {
  let org: Awaited<ReturnType<typeof newOrg>>;

  beforeAll(async () => {
    // The digest_due_orgs tests above left "due" and "yesterday" unstamped.
    await drainDueOrgs();
    org = await newOrg("run", zones().past8);
    const request = await createHours(org.handle, org.offeringId, 8, "Anna");
    await admin.from("bookings").update({ status: "pending" }).eq("id", request);
    const hold = await createHours(org.handle, org.offeringId, 10, "Ola");
    await admin
      .from("bookings")
      .update({ status: "pending_payment", hold_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() })
      .eq("id", hold);
  });

  it("sends once per org per local day, then the claim holds", async () => {
    const r = recorder();
    const first = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(first.sent).toBe(1);
    expect(first.failed).toBe(0);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].to).toBe(org.email);
    expect(r.sent[0].subject).toBe("2 things need you today");
    expect(r.sent[0].text).toContain("Anna");
    expect(r.sent[0].text).toContain("Ola");
    expect(r.sent[0].idempotencyKey).toMatch(new RegExp(`^digest:${org.orgId}:\\d{4}-\\d{2}-\\d{2}$`));
    expect(r.pushes).toEqual([
      { userId: org.userId, payload: { title: "Your morning list", body: "2 things need you today", url: "/overview", tag: r.sent[0].idempotencyKey } },
    ]);
    expect(await stamp(org.orgId)).not.toBeNull();

    const again = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(again.sent).toBe(0);
    expect(r.sent).toHaveLength(1);
  });

  it("an empty list is stamped and counted as skipped", async () => {
    const quiet = await newOrg("quiet", zones().past8);
    const r = recorder();
    const out = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(out.skipped).toBe(1);
    expect(out.sent).toBe(0);
    expect(r.sent).toEqual([]);
    expect(await stamp(quiet.orgId)).not.toBeNull();
  });

  it("a member with email off gets push only", async () => {
    const o = await newOrg("pushonly", zones().past8);
    await o.client.rpc("update_member_notification_prefs", {
      p_org_id: o.orgId,
      p_prefs: {
        newBooking: { email: true, push: true },
        newRequest: { email: true, push: true },
        cancelled: { email: true, push: true },
        rescheduled: { email: true, push: true },
        dailyDigest: { email: false, push: true },
      },
    });
    const request = await createHours(o.handle, o.offeringId, 12, "Kasia");
    await admin.from("bookings").update({ status: "pending" }).eq("id", request);
    const r = recorder();
    const out = await runDailyDigest({ db: admin, transport: r.transport, push: r.push });
    expect(out.sent).toBe(1);
    expect(r.sent).toEqual([]);
    expect(r.pushes.map((p) => p.userId)).toEqual([o.userId]);
  });
});
