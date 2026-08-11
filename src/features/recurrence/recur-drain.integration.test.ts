/**
 * Recurrence drain phase (slice 11, task 4): runRecurPhase wired as phase 1
 * of runDrain — re-arm due stages, auto-start chases, and prove the SAME
 * tick delivers send #0 (recur phase runs before the chase due-scan).
 * Requires the local Supabase stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
const { runDrain } = await import("@/features/chasing/drain");

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

const dateFromToday = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("recurrence: drain phase end to end", () => {
  let alice: SupabaseClient;
  let orgId: string;
  let programId: string;
  let requirementId: string;
  let participantA: string;
  let unitA: string;
  let unitB: string;
  let unitC: string;
  let unitStageA: string;
  let unitStageB: string;
  let unitStageC: string;
  let unitStageFar: string;

  beforeAll(async () => {
    alice = await signedInUser("recur_drain_alice");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RecurDrainOrg" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;

    const { data: template } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Recur Drain Template" })
      .select("id")
      .single();
    const { data: stage } = await alice
      .from("template_stages")
      .insert({ template_id: template!.id, org_id: orgId, name: "Certify", position: 0 })
      .select("id")
      .single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: stage!.id,
      org_id: orgId,
      type: "date",
      label: "Certificate expiry",
      required: true,
      config: {},
      position: 0,
      recur_lead_days: 30,
    });

    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: template!.id,
      p_name: "Recur Drain Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    const { data: req } = await alice
      .from("program_stage_requirements")
      .select("id")
      .eq("program_id", programId)
      .single();
    requirementId = req!.id;

    // Participant A: has email, assigned to unitA.
    const { data: pA } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Alpha", email: `alpha_${Date.now()}@example.com` })
      .select("id")
      .single();
    participantA = pA!.id;

    // Participant B: no email, assigned to unitB.
    const { data: pB } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Beta" })
      .select("id")
      .single();
    const participantB = pB!.id;

    const { data: uA } = await alice
      .from("units")
      .insert({ org_id: orgId, program_id: programId, name: "Unit A", assigned_participant_id: participantA })
      .select("id")
      .single();
    unitA = uA!.id;

    const { data: uB } = await alice
      .from("units")
      .insert({ org_id: orgId, program_id: programId, name: "Unit B", assigned_participant_id: participantB })
      .select("id")
      .single();
    unitB = uB!.id;

    const { data: uC } = await alice
      .from("units")
      .insert({ org_id: orgId, program_id: programId, name: "Unit C" })
      .select("id")
      .single();
    unitC = uC!.id;

    const { data: uFar } = await alice
      .from("units")
      .insert({ org_id: orgId, program_id: programId, name: "Unit Far", assigned_participant_id: participantA })
      .select("id")
      .single();
    const unitFar = uFar!.id;

    const { data: usA } = await alice.from("unit_stages").select("id").eq("unit_id", unitA).single();
    unitStageA = usA!.id;
    const { data: usB } = await alice.from("unit_stages").select("id").eq("unit_id", unitB).single();
    unitStageB = usB!.id;
    const { data: usC } = await alice.from("unit_stages").select("id").eq("unit_id", unitC).single();
    unitStageC = usC!.id;
    const { data: usFar } = await alice.from("unit_stages").select("id").eq("unit_id", unitFar).single();
    unitStageFar = usFar!.id;

    const near = dateFromToday(10); // inside the 30-day window now
    const far = dateFromToday(300); // well outside the window

    for (const [stageId] of [[unitStageA], [unitStageB], [unitStageC]] as const) {
      const { error } = await alice.from("unit_stage_responses").insert({
        unit_stage_id: stageId,
        program_stage_requirement_id: requirementId,
        value_date: near,
      });
      if (error) throw error;
    }
    const { error: eFar } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: unitStageFar,
      program_stage_requirement_id: requirementId,
      value_date: far,
    });
    if (eFar) throw eFar;
  });

  it("one tick: re-arms, starts an automatic chase, and sends email #0", async () => {
    const { sent, transport } = fakeTransport();
    const summary = await runDrain({ db: admin, transport });
    expect(summary.rearmed).toBeGreaterThanOrEqual(1);

    // Stage re-armed with due_at stamped.
    const { data: us } = await admin
      .from("unit_stages")
      .select("status, due_at")
      .eq("id", unitStageA)
      .single();
    expect(us!.status).toBe("pending");
    expect(us!.due_at).not.toBeNull();

    // Round archived.
    const { data: archived } = await admin
      .from("unit_stage_response_archive")
      .select("id")
      .eq("unit_stage_id", unitStageA);
    expect(archived).toHaveLength(1);

    // Automatic chase for the exact scope, created_by null.
    const { data: chase } = await admin
      .from("chases")
      .select("id, created_by, sends_done")
      .eq("participant_id", participantA)
      .eq("program_id", programId)
      .eq("unit_id", unitA)
      .single();
    expect(chase!.created_by).toBeNull();
    // Same tick delivered send #0 (chase phase runs after the recur phase).
    expect(chase!.sends_done).toBe(1);
    expect(sent.some((m) => m.idempotencyKey === `chase/${chase!.id}/send/0`)).toBe(true);
  });

  it("no participant email / no assignment: re-arms without a chase, not an error", async () => {
    for (const [unit, stage] of [
      [unitB, unitStageB],
      [unitC, unitStageC],
    ] as const) {
      const { data: us } = await admin
        .from("unit_stages")
        .select("status, due_at")
        .eq("id", stage)
        .single();
      expect(us!.status).toBe("pending");
      expect(us!.due_at).not.toBeNull();
      const { data: chases } = await admin.from("chases").select("id").eq("unit_id", unit);
      expect(chases).toHaveLength(0);
    }
  });

  it("second tick: nothing new to re-arm, no duplicate chase", async () => {
    const { transport } = fakeTransport();
    await runDrain({ db: admin, transport });
    const { data: archived } = await admin
      .from("unit_stage_response_archive")
      .select("id")
      .eq("unit_stage_id", unitStageA);
    expect(archived).toHaveLength(1); // still one round
    const { data: chases } = await admin.from("chases").select("id").eq("unit_id", unitA);
    expect(chases).toHaveLength(1);
  });

  it("a done stage with a far-future expiry is untouched", async () => {
    const { data: us } = await admin
      .from("unit_stages")
      .select("status, due_at")
      .eq("id", unitStageFar)
      .single();
    expect(us!.status).toBe("done");
    expect(us!.due_at).toBeNull();
  });
});
