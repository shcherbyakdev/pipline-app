/**
 * Chase drain engine (slice 10, task 6): runDrain against the local stack —
 * due-scan, send, claim/rollback, stop, and completion. Exercises drain.ts
 * against real Postgres RPCs (mint_chase_token, complete_chase) and the
 * unit_stages fan-out trigger that makes "outstanding work" real.
 * Requires the local Supabase stack (npm run setup).
 *
 * NOTE on assertions: runDrain's due-scan is table-wide (no org filter —
 * that's the whole point of a drain). Under `npm run test:integration` the
 * full suite runs, and other integration files (e.g. chases.integration
 * .test.ts) insert their own due chases. This file's assertions are
 * therefore scoped to OUR chase ids / idempotency keys rather than raw
 * array indices or exact global summary equality, so a foreign due row
 * landing in the same batch can never flip these tests red.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chaseIdempotencyKey } from "./cadence";
import type { OutboundEmail, EmailTransport } from "@/lib/email/transport";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Deferred: static imports are hoisted and evaluate before the loadEnvFile
// call above runs, but drain.ts transitively imports @/env, which parses
// process.env eagerly at module scope. A dynamic import keeps that
// evaluation AFTER .env.local is loaded.
const { runDrain } = await import("./drain");

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

// Records every send. `fail` simulates a transport-layer failure.
function fakeTransport(fail = false) {
  const sent: OutboundEmail[] = [];
  const transport: EmailTransport = {
    async send(msg) {
      if (fail) throw new Error("boom");
      sent.push(msg);
      return { id: `fake-${sent.length}` };
    },
  };
  return { sent, transport };
}

const past = (msAgo = 60_000) => new Date(Date.now() - msAgo).toISOString();

describe("drain: runDrain against the local stack", () => {
  // ORDER-DEPENDENT: one chase (pinned to unit1) is driven through send →
  // send → failed-send → stop across the first five tests; a second chase
  // (unit2) is used for the completion path in test 6; a third (also
  // unit1 — chaseId is stopped by then, freeing the scope) covers the
  // retry-cap/stall path in test 7.
  let alice: SupabaseClient;
  let userId: string;
  let orgId: string;
  let programId: string;
  let participantId: string;
  let participantEmail: string;
  let unit1: string;
  let unit2: string;
  let chaseId: string;

  const { sent, transport } = fakeTransport();
  const sentFor = (chase: string, sendIndex: number) =>
    sent.find((m) => m.idempotencyKey === chaseIdempotencyKey(chase, sendIndex));

  beforeAll(async () => {
    alice = await signedInUser("drain_alice");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "DrainOrg" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: me } = await alice.auth.getUser();
    userId = me.user!.id;

    // `programs` has no insert policy — only create_program (copy-on-use
    // snapshot) can create one, and it needs a template with >=1 stage.
    // Mirrors tokens.integration.test.ts's beforeAll.
    const { data: template } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Drain Template" })
      .select("id")
      .single();
    const { data: stage } = await alice
      .from("template_stages")
      .insert({ template_id: template!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: stage!.id,
      org_id: orgId,
      type: "text",
      label: "Notes",
      required: true,
      config: {},
      position: 0,
    });
    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: template!.id,
      p_name: "Drain Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    participantEmail = `dave_${Date.now()}@example.com`;
    const { data: participant } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Dave", email: participantEmail })
      .select("id")
      .single();
    participantId = participant!.id;

    // Two units assigned to the same participant. unit1 carries the
    // send/claim/rollback/stop lifecycle; unit2 is held back for the
    // completion test so its (participant, program, unit) scope stays free
    // for a second live chase (the partial-unique index is per-scope).
    const { data: u1 } = await alice
      .from("units")
      .insert({
        org_id: orgId,
        program_id: programId,
        name: "Unit 1",
        assigned_participant_id: participantId,
      })
      .select("id")
      .single();
    unit1 = u1!.id;
    const { data: u2 } = await alice
      .from("units")
      .insert({
        org_id: orgId,
        program_id: programId,
        name: "Unit 2",
        assigned_participant_id: participantId,
      })
      .select("id")
      .single();
    unit2 = u2!.id;
  });

  it("due chase → one send, token minted with chase_id, sends_done advanced", async () => {
    const { data: chase, error } = await alice
      .from("chases")
      .insert({
        org_id: orgId,
        participant_id: participantId,
        program_id: programId,
        unit_id: unit1,
        next_send_at: new Date().toISOString(),
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    chaseId = chase!.id;
    // Force due regardless of clock skew between insert and the drain call.
    await admin.from("chases").update({ next_send_at: past() }).eq("id", chaseId);

    const summary = await runDrain({ db: admin, transport, now: new Date() });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const { data: tokens } = await admin
      .from("access_tokens")
      .select("chase_id")
      .eq("chase_id", chaseId);
    expect(tokens).toHaveLength(1);

    const { data: c } = await admin.from("chases").select("sends_done").eq("id", chaseId).single();
    expect(c!.sends_done).toBe(1);

    const mine = sentFor(chaseId, 0);
    expect(mine).toBeDefined();
    expect(mine!.to).toBe(participantEmail);
    expect(mine!.html).toContain("/p/");
    expect(mine!.html).toContain("/stop");
  });

  it("immediate second drain → zero sends (advance moved the clock)", async () => {
    // sends_done=1 moved next_send_at to createdAt + 3 days — genuinely
    // future, so this chase falls OUT of the due-scan window entirely.
    await runDrain({ db: admin, transport, now: new Date() });
    expect(sentFor(chaseId, 1)).toBeUndefined();
    const { data: c } = await admin.from("chases").select("sends_done").eq("id", chaseId).single();
    expect(c!.sends_done).toBe(1); // untouched
  });

  it("advancing the clock past offset 1 → second send with sendIndex 1 idempotency key", async () => {
    await admin.from("chases").update({ next_send_at: past() }).eq("id", chaseId);
    const summary = await runDrain({ db: admin, transport, now: new Date() });
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const mine = sentFor(chaseId, 1);
    expect(mine).toBeDefined();
    expect(mine!.idempotencyKey).toBe(`chase/${chaseId}/send/1`);

    const { data: c } = await admin.from("chases").select("sends_done").eq("id", chaseId).single();
    expect(c!.sends_done).toBe(2);
  });

  it("transport failure → last_error set, sends_done rolled back, row still due, attempt_count bumped", async () => {
    const { data: before } = await admin
      .from("chases")
      .select("sends_done, attempt_count")
      .eq("id", chaseId)
      .single();
    await admin.from("chases").update({ next_send_at: past() }).eq("id", chaseId);

    const failing = fakeTransport(true);
    const summary = await runDrain({ db: admin, transport: failing.transport, now: new Date() });
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(failing.sent).toHaveLength(0); // the failing transport never records a send

    const { data: after } = await admin
      .from("chases")
      .select("sends_done, next_send_at, last_error, attempt_count")
      .eq("id", chaseId)
      .single();
    expect(after!.sends_done).toBe(before!.sends_done); // rolled back, not advanced
    expect(after!.last_error).toContain("boom");
    // attempt_count is the retry cap's only input (CHASE_MAX_ATTEMPTS in
    // drain.ts) — a regression that stops bumping it here would silently
    // disable the cap and let a permanently-failing row monopolize every
    // due-scan batch forever.
    expect(after!.attempt_count).toBe(before!.attempt_count + 1);
    // Rolled back to the same forced-past next_send_at — still due.
    expect(new Date(after!.next_send_at!).getTime()).toBeLessThanOrEqual(Date.now());
    // The real transport (used by earlier tests) never saw this attempt.
    expect(sentFor(chaseId, 2)).toBeUndefined();
  });

  it("stopped chase → untouched by the drain", async () => {
    await admin
      .from("chases")
      .update({ stopped_at: new Date().toISOString(), next_send_at: past() })
      .eq("id", chaseId);
    const { data: tokensBefore } = await admin
      .from("access_tokens")
      .select("id")
      .eq("chase_id", chaseId);

    await runDrain({ db: admin, transport, now: new Date() });

    const { data: tokensAfter } = await admin
      .from("access_tokens")
      .select("id")
      .eq("chase_id", chaseId);
    expect(tokensAfter).toHaveLength(tokensBefore!.length); // no new mint
    expect(sentFor(chaseId, 2)).toBeUndefined();
    const { data: c } = await admin.from("chases").select("sends_done").eq("id", chaseId).single();
    expect(c!.sends_done).toBe(2); // untouched
  });

  it("completed work → drain completes the chase and revokes its tokens, sends nothing", async () => {
    const { sent: sent2, transport: transport2 } = fakeTransport();
    const sentFor2 = (chase: string, sendIndex: number) =>
      sent2.find((m) => m.idempotencyKey === chaseIdempotencyKey(chase, sendIndex));

    const { data: chase2, error } = await alice
      .from("chases")
      .insert({
        org_id: orgId,
        participant_id: participantId,
        program_id: programId,
        unit_id: unit2,
        next_send_at: past(),
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const chase2Id = chase2!.id;

    // Seed a real, revocable token: unit2's stage is still pending here, so
    // this tick sends (proves completion actually revokes something real,
    // not an empty set).
    const seedSummary = await runDrain({ db: admin, transport: transport2, now: new Date() });
    expect(seedSummary.sent).toBeGreaterThanOrEqual(1);
    expect(sentFor2(chase2Id, 0)).toBeDefined();

    // Finish unit2's outstanding work directly — the recipe's "admin update
    // status='done'", standing in for the participant completing the form.
    await admin.from("unit_stages").update({ status: "done" }).eq("unit_id", unit2);
    await admin.from("chases").update({ next_send_at: past() }).eq("id", chase2Id);

    const beforeSentCount = sent2.length;
    const summary = await runDrain({ db: admin, transport: transport2, now: new Date() });
    expect(summary.completed).toBeGreaterThanOrEqual(1);
    expect(sent2).toHaveLength(beforeSentCount); // no send on the completing tick

    const { data: c2 } = await admin
      .from("chases")
      .select("completed_at")
      .eq("id", chase2Id)
      .single();
    expect(c2!.completed_at).not.toBeNull();

    const { data: tokens } = await admin
      .from("access_tokens")
      .select("revoked_at")
      .eq("chase_id", chase2Id);
    expect(tokens!.length).toBeGreaterThan(0);
    for (const t of tokens!) expect(t.revoked_at).not.toBeNull();
  });

  it("attempt cap reached → drain gives up: no mint, no send, next_send_at cleared, last_error set", async () => {
    // A fresh chase reusing unit1's scope — chaseId is stopped by now, so
    // the live-scope index doesn't block this insert. unit1's stage is
    // still pending (never marked done), so this chase has real outstanding
    // work and would otherwise take the send path.
    const { sent: sent3, transport: transport3 } = fakeTransport();
    const { data: chase3, error } = await alice
      .from("chases")
      .insert({
        org_id: orgId,
        participant_id: participantId,
        program_id: programId,
        unit_id: unit1,
        next_send_at: past(),
        created_by: userId,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const chase3Id = chase3!.id;
    // Simulate 5 prior failed attempts without actually driving the chase
    // through them — attempt_count is the only thing the cap reads.
    await admin.from("chases").update({ attempt_count: 5, next_send_at: past() }).eq("id", chase3Id);

    const { data: tokensBefore } = await admin
      .from("access_tokens")
      .select("id")
      .eq("chase_id", chase3Id);

    const summary = await runDrain({ db: admin, transport: transport3, now: new Date() });
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    expect(sent3).toHaveLength(0); // never reached the send

    const { data: tokensAfter } = await admin
      .from("access_tokens")
      .select("id")
      .eq("chase_id", chase3Id);
    expect(tokensAfter).toHaveLength(tokensBefore!.length); // no mint either

    const { data: c3 } = await admin
      .from("chases")
      .select("next_send_at, last_error, sends_done")
      .eq("id", chase3Id)
      .single();
    expect(c3!.next_send_at).toBeNull();
    expect(c3!.last_error).toContain("gave up after 5 attempts");
    expect(c3!.sends_done).toBe(0); // never claimed
  });
});
