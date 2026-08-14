/**
 * Reminder drain against the real DB: claim, suppress-stamp, rollback on
 * transport failure, idempotent second tick. Requires the local stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateAccessToken } from "@/lib/tokens/mint";
import { runReminderDrain } from "./reminders";
import type { EmailTransport, OutboundEmail } from "@/lib/email/transport";

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

    const insert = (over: Record<string, unknown>) =>
      admin
        .from("bookings")
        .insert({
          org_id: orgId,
          service_id: serviceId,
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

  it("failed send rolls the claim back and counts an attempt", async () => {
    const summary = await runReminderDrain({ db: admin, transport: failingTransport });
    expect(summary.failed).toBe(1); // the due row
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
    const summary = await runReminderDrain({ db: admin, transport });
    expect(summary.sent).toBe(1);
    expect(sent[0].to).toBe("reminded@example.com");
    expect(sent[0].idempotencyKey).toBe(`booking/${dueId}/reminder`);
    expect(sent[0].html).not.toContain("http"); // link-free by design
  });

  it("third tick is a no-op", async () => {
    const { transport, sent } = recordingTransport();
    const summary = await runReminderDrain({ db: admin, transport });
    expect(summary.sent).toBe(0);
    expect(sent.length).toBe(0);
  });
});
