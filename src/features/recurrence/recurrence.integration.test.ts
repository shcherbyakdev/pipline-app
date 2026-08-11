/**
 * Recurrence SQL surface (slice 11, task 3): CHECKs, snapshot copy, the
 * recur_due scan, recur_rearm atomicity, and archive RLS/grants — against
 * the local stack. Requires `npm run setup`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

const dateFromToday = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

describe("recurrence: SQL surface", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient; // foreign org
  let orgId: string;
  let templateStageId: string;
  let programId: string;
  let participantId: string;
  let unitId: string;
  let unitStageId: string; // the done stage carrying the near-expiry driver
  let requirementId: string; // program-side driver requirement

  beforeAll(async () => {
    alice = await signedInUser("recur_alice");
    bob = await signedInUser("recur_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RecurOrg" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    await bob.rpc("create_org", { p_name: "RecurForeignOrg" });

    const { data: template } = await alice
      .from("templates").insert({ org_id: orgId, name: "Recur Template" }).select("id").single();
    const { data: stage } = await alice
      .from("template_stages")
      .insert({ template_id: template!.id, org_id: orgId, name: "Certify", position: 0 })
      .select("id").single();
    templateStageId = stage!.id;
    // THE driver: a required date requirement with a 30-day lead.
    await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "date", label: "Certificate expiry", required: true,
      config: {}, position: 0, recur_lead_days: 30,
    });

    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: template!.id, p_name: "Recur Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    const { data: req } = await alice
      .from("program_stage_requirements")
      .select("id, recur_lead_days").eq("program_id", programId).single();
    requirementId = req!.id;

    const { data: participant } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Dana", email: `dana_${Date.now()}@example.com` })
      .select("id").single();
    participantId = participant!.id;

    const { data: unit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 1", assigned_participant_id: participantId })
      .select("id").single();
    unitId = unit!.id;

    const { data: us } = await alice
      .from("unit_stages").select("id").eq("unit_id", unitId).single();
    unitStageId = us!.id;

    // Expiry 10 days out with a 30-day lead → inside the window NOW; the
    // response insert also derives the stage to 'done'.
    const { error: e3 } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(10),
    });
    if (e3) throw e3;
    const { data: check } = await alice
      .from("unit_stages").select("status").eq("id", unitStageId).single();
    expect(check!.status).toBe("done");
  });

  it("CHECK rejects recur_lead_days on a non-date requirement", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "text", label: "Notes", required: false, config: {}, position: 1,
      recur_lead_days: 30,
    });
    expect(error).not.toBeNull();
  });

  it("CHECK rejects a non-positive lead", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "date", label: "Bad lead", required: false, config: {}, position: 2,
      recur_lead_days: 0,
    });
    expect(error).not.toBeNull();
  });

  it("create_program copied recur_lead_days into the snapshot", async () => {
    const { data } = await alice
      .from("program_stage_requirements")
      .select("recur_lead_days").eq("id", requirementId).single();
    expect(data!.recur_lead_days).toBe(30);
  });

  it("recur_due surfaces the done stage inside its window, with scope + participant email", async () => {
    const { data, error } = await admin.rpc("recur_due", { p_today: today(), p_limit: 100 });
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>).find((r) => r.unit_stage_id === unitStageId);
    expect(row).toBeDefined();
    expect(row!.unit_id).toBe(unitId);
    expect(row!.org_id).toBe(orgId);
    expect(row!.recur_lead_days).toBe(30);
    expect(row!.assigned_participant_id).toBe(participantId);
    expect(typeof row!.participant_email).toBe("string");
  });

  it("recur_due ignores a stage whose window has not opened", async () => {
    // Second unit, expiry 60 days out (lead 30) → due only from day 30.
    const { data: unit2 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 2" })
      .select("id").single();
    const { data: us2 } = await alice
      .from("unit_stages").select("id").eq("unit_id", unit2!.id).single();
    await alice.from("unit_stage_responses").insert({
      unit_stage_id: us2!.id,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(60),
    });
    const { data } = await admin.rpc("recur_due", { p_today: today(), p_limit: 100 });
    expect((data as Array<Record<string, unknown>>).some((r) => r.unit_stage_id === us2!.id)).toBe(false);
  });

  it("neither RPC is callable by authenticated or anon", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const client of [alice, anon]) {
      const { error: e1 } = await client.rpc("recur_due", { p_today: today(), p_limit: 1 });
      expect(e1).not.toBeNull();
      const { error: e2 } = await client.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
      expect(e2).not.toBeNull();
    }
  });

  it("recur_rearm archives the round, clears live rows, flips the stage, stamps due_at — atomically", async () => {
    const expiry = dateFromToday(10);
    const { data: claimed, error } = await admin.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
    expect(error).toBeNull();
    expect(claimed).toBe(true);

    const { data: us } = await admin
      .from("unit_stages").select("status, done_source, done_at, due_at").eq("id", unitStageId).single();
    expect(us!.status).toBe("pending");
    expect(us!.done_source).toBeNull();
    expect(us!.done_at).toBeNull();
    expect(us!.due_at).not.toBeNull();
    expect((us!.due_at as string).slice(0, 10)).toBe(expiry);

    const { data: live } = await admin
      .from("unit_stage_responses").select("id").eq("unit_stage_id", unitStageId);
    expect(live).toHaveLength(0);

    const { data: archived } = await admin
      .from("unit_stage_response_archive")
      .select("id, value_date, superseded_at").eq("unit_stage_id", unitStageId);
    expect(archived).toHaveLength(1);
    expect(archived![0].value_date).toBe(expiry);
    expect(archived![0].superseded_at).not.toBeNull();
  });

  it("recur_rearm returns false when there is nothing to re-arm (idempotent)", async () => {
    const { data: again } = await admin.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
    expect(again).toBe(false);
  });

  it("a fresh response inserts cleanly after re-arm (upsert path unbroken) and re-derives done", async () => {
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(365),
    });
    expect(error).toBeNull();
    const { data: us } = await alice
      .from("unit_stages").select("status").eq("id", unitStageId).single();
    expect(us!.status).toBe("done");
  });

  it("archive: member reads own org, foreign org sees nothing, nobody client-writes", async () => {
    const { data: mine, error: e1 } = await alice
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageId);
    expect(e1).toBeNull();
    expect(mine!.length).toBeGreaterThan(0);

    const { data: foreign } = await bob
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageId);
    expect(foreign).toHaveLength(0);

    const { error: insErr } = await alice.from("unit_stage_response_archive").insert({
      id: crypto.randomUUID(), unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId, unit_id: unitId,
      program_id: programId, org_id: orgId, type: "date",
      value_date: today(), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), superseded_at: new Date().toISOString(),
    });
    expect(insErr).not.toBeNull();
  });
});
