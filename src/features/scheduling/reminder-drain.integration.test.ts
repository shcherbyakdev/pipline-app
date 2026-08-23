/**
 * Reminder drain against the real DB: claim, suppress-stamp, rollback on
 * transport failure, idempotent second tick. Requires the local stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic import so env is loaded before src/env.ts parses it: reminders.ts
// reaches @/env through @/lib/booking/public (the staff-name rule) and a
// static import would be hoisted above the loadEnvFile call
// (booking-flow.integration.test.ts precedent).
const { runReminderDrain } = await import("./reminders");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

const failingTransport: EmailTransport = {
  async send() {
    throw new Error("smtp exploded");
  },
};

const now = new Date();
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000).toISOString();

let orgId: string;
let serviceId: string;
let staffId: string;
let dueId: string;
let lateId: string;

describe("reminder drain", () => {
  beforeAll(async () => {
    const owner = await signedInUser("rem_owner");
    const { data: org, error: e1 } = await owner.rpc("create_org", { p_name: "ReminderCo" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: svc, error: e2 } = await owner
      .from("services")
      .insert({ org_id: orgId, name: "Reminded", duration_min: 60 })
      .select("id")
      .single();
    if (e2) throw e2;
    serviceId = svc!.id;
    // 0041: appointment bookings must name the staff who owns the slot.
    const { data: st, error: e3 } = await admin
      .from("staff")
      .select("id")
      .eq("org_id", orgId)
      .single();
    if (e3) throw e3;
    staffId = st!.id;

    const insert = (over: Record<string, unknown>) =>
      admin
        .from("bookings")
        .insert({
          org_id: orgId,
          service_id: serviceId,
          staff_id: staffId,
          client_name: "R Client",
          client_email: "reminded@example.com",
          cancel_token_hash: generateAccessToken().tokenHash,
          status: "confirmed",
          ...over,
        })
        .select("id")
        .single();

    // Due: starts in 2h, created 2 days ago.
    const due = await insert({
      starts_at: hours(2),
      ends_at: hours(3),
      created_at: hours(-48),
    });
    if (due.error) throw due.error;
    dueId = due.data!.id;

    // Late-created: starts in 5h, created 1h ago → suppress-stamp.
    const late = await insert({
      starts_at: hours(5),
      ends_at: hours(6),
      created_at: hours(-1),
    });
    if (late.error) throw late.error;
    lateId = late.data!.id;

    // Outside the lead window: untouched by every tick below.
    const far = await insert({
      starts_at: hours(40),
      ends_at: hours(41),
      created_at: hours(-48),
    });
    if (far.error) throw far.error;

    // Cancelled: never reminded.
    const cancelled = await insert({
      starts_at: hours(8),
      ends_at: hours(9),
      created_at: hours(-48),
      status: "cancelled_by_client",
    });
    if (cancelled.error) throw cancelled.error;
  });

  // Every tick below is table-wide (a drain has no org scoping — that is the
  // point of a drain), so rows left behind by other integration files share
  // the batch. Assertions therefore read THIS file's rows back by id; the
  // summary counters are only ever checked with >= where they are checked
  // at all.
  it("failed send rolls the claim back and counts an attempt", async () => {
    const summary = await runReminderDrain({ db: admin, transport: failingTransport });
    expect(summary.failed).toBeGreaterThanOrEqual(1); // the due row
    expect(summary.skipped).toBeGreaterThanOrEqual(1); // the late row got stamped
    const { data } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts, reminder_last_error")
      .eq("id", dueId)
      .single();
    expect(data!.reminder_sent_at).toBeNull();
    expect(data!.reminder_attempts).toBe(1);
    expect(data!.reminder_last_error).toContain("smtp exploded");
  });

  it("suppressed late booking was stamped, not left for rescan", async () => {
    const { data } = await admin
      .from("bookings")
      .select("reminder_sent_at")
      .eq("id", lateId)
      .single();
    expect(data!.reminder_sent_at).not.toBeNull();
  });

  it("second tick sends the due reminder with a stable idempotency key", async () => {
    const { transport, sent } = recordingTransport();
    // The badge is looked up per row, with that row's own org id (the drain
    // spans every org, so a single shared answer would be wrong).
    const badgeUrl = "https://x/?ref=badge";
    const asked: string[] = [];
    const summary = await runReminderDrain({
      db: admin,
      transport,
      badgeFor: async (id) => {
        asked.push(id);
        return badgeUrl;
      },
    });
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    const mine = sent.find((m) => m.idempotencyKey === `booking/${dueId}/reminder`);
    expect(mine).toBeDefined();
    expect(mine!.to).toBe("reminded@example.com");
    expect(asked).toContain(orgId);
    // Memoised per org per tick: a batch of rows from one org must not
    // re-run the badge lookup (plan read + orgs read) once per row.
    expect(new Set(asked).size).toBe(asked.length);
    expect(mine!.html).toContain("Powered by Booklo");
    expect(mine!.html).toContain(badgeUrl);
    // Still link-free apart from the badge: the manage credential cannot be
    // reconstructed at drain time and must never appear in a reminder.
    expect(mine!.html.replaceAll(badgeUrl, "")).not.toContain("http");
    // Solo org (create_org seeded exactly one staff row): no "With" line,
    // byte-identical to the pre-team copy. The multi-staff case is the last
    // test in this file.
    expect(mine!.html).not.toContain("With ");
    const { data: row } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", dueId)
      .single();
    expect(row!.reminder_sent_at).not.toBeNull(); // claimed and kept
    expect(row!.reminder_attempts).toBe(1); // the failed first tick, nothing since
  });

  it("third tick does not touch the already-sent row", async () => {
    const { data: before } = await admin
      .from("bookings")
      .select("reminder_sent_at")
      .eq("id", dueId)
      .single();
    const { transport, sent } = recordingTransport();
    await runReminderDrain({ db: admin, transport });
    expect(sent.some((m) => m.idempotencyKey === `booking/${dueId}/reminder`)).toBe(false);
    const { data: after } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", dueId)
      .single();
    expect(after!.reminder_sent_at).toBe(before!.reminder_sent_at); // stamp untouched
    expect(after!.reminder_attempts).toBe(1);
  });

  it("stamps emailless bookings as suppressed without sending", async () => {
    // Booked well in advance (like the "due" fixture above) so decideReminder
    // returns "send", not the lateness "suppress" — the only way to prove
    // the null-email guard, not the timing guard, is what skips this row.
    const { data: inserted, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        service_id: serviceId,
        staff_id: staffId,
        client_name: "Walk-in",
        client_email: null,
        starts_at: hours(12),
        ends_at: hours(13),
        created_at: hours(-48),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    expect(error).toBeNull();

    const sends: (string | null)[] = [];
    await runReminderDrain({
      db: admin,
      transport: {
        send: async (m) => {
          sends.push(m.to);
          return { id: "t-emailless" };
        },
      },
    });

    expect(sends).not.toContain(null);
    const { data: row } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", inserted!.id)
      .single();
    expect(row!.reminder_sent_at).not.toBeNull(); // stamped = suppressed, never rescanned
    expect(row!.reminder_attempts).toBe(0);
  });

  it("suppresses a due booking when the org is over its free reminder quota", async () => {
    const { data: inserted, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        service_id: serviceId,
        staff_id: staffId,
        client_name: "Over Quota",
        client_email: "overquota@example.com",
        starts_at: hours(14),
        ends_at: hours(15),
        created_at: hours(-48),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const overQuotaId = inserted!.id;

    const { transport, sent } = recordingTransport();
    // The quota is ordinal, so the drain hands the check the BOOKING's own
    // created_at (not just the org): "is this booking the org's 31st this
    // month?", answered the same way on every future tick.
    const asked: Array<[string, string, string]> = [];
    const summary = await runReminderDrain({
      db: admin,
      transport,
      quotaExceeded: async (org, tz, createdAt) => {
        asked.push([org, tz, createdAt]);
        return true;
      },
    });

    expect(asked.some(([org, , createdAt]) => org === orgId && !Number.isNaN(Date.parse(createdAt)))).toBe(true);
    expect(summary.skipped).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.to === "overquota@example.com")).toBe(false);
    const { data: row } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", overQuotaId)
      .single();
    expect(row!.reminder_sent_at).not.toBeNull(); // stamped = suppressed, never rescanned
    expect(row!.reminder_attempts).toBe(0);
  });

  it("sends a due booking when the org is under its free reminder quota", async () => {
    const { data: inserted, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        service_id: serviceId,
        staff_id: staffId,
        client_name: "Under Quota",
        client_email: "underquota@example.com",
        starts_at: hours(16),
        ends_at: hours(17),
        created_at: hours(-48),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const underQuotaId = inserted!.id;

    const { transport, sent } = recordingTransport();
    const summary = await runReminderDrain({
      db: admin,
      transport,
      quotaExceeded: async (_org, _tz, createdAt) => {
        // Per booking, not per tick: the check must see a real timestamp for
        // each candidate row.
        expect(typeof createdAt).toBe("string");
        return false;
      },
    });

    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.to === "underquota@example.com")).toBe(true);
    const { data: row } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", underQuotaId)
      .single();
    expect(row!.reminder_sent_at).not.toBeNull();
    expect(row!.reminder_attempts).toBe(0);
  });

  // Team spec: once an org has more than one active staff member, every
  // client-facing mail names who the appointment is with — reminders
  // included. Last in the file on purpose: adding the second staff row flips
  // the org from solo to team for every later tick.
  it("names the staff member on a reminder once the org has a team", async () => {
    const { data: second, error: staffError } = await admin
      .from("staff")
      .insert({ org_id: orgId, name: "Dana Second", slug: "dana-second", color: "#336699" })
      .select("id")
      .single();
    expect(staffError).toBeNull();

    const { data: inserted, error } = await admin
      .from("bookings")
      .insert({
        org_id: orgId,
        service_id: serviceId,
        staff_id: second!.id,
        client_name: "Team Client",
        client_email: "teamclient@example.com",
        starts_at: hours(18),
        ends_at: hours(19),
        created_at: hours(-48),
        status: "confirmed",
        cancel_token_hash: generateAccessToken().tokenHash,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const teamBookingId = inserted!.id;

    const { transport, sent } = recordingTransport();
    await runReminderDrain({ db: admin, transport });

    const mine = sent.find((m) => m.idempotencyKey === `booking/${teamBookingId}/reminder`);
    expect(mine).toBeDefined();
    expect(mine!.to).toBe("teamclient@example.com");
    expect(mine!.html).toContain("With Dana Second");
    expect(mine!.text).toContain("With Dana Second");
    const { data: row } = await admin
      .from("bookings")
      .select("reminder_sent_at, reminder_attempts")
      .eq("id", teamBookingId)
      .single();
    expect(row!.reminder_sent_at).not.toBeNull();
    expect(row!.reminder_attempts).toBe(0);
  });
});
