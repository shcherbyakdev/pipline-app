/**
 * Tenant-isolation proof, promoted from scripts/verify-foundation.ts into a
 * real test. Requires the local Supabase stack (npm run setup). Creates two
 * throwaway users+orgs per run; a fresh stack (CI) or db:reset clears them.
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

type Req = { id: string; type: string; label: string; required: boolean; position: number; config: Record<string, unknown> };

describe("requirements: snapshot, trust, derivation, override", () => {
  // ORDER-DEPENDENT: sequential, file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let inspectStageId: string;   // program stage WITH requirements
  let signoffStageId: string;   // program stage WITHOUT requirements
  let inspectUnitStageId: string;
  let signoffUnitStageId: string;
  let reqs: Req[] = [];
  const byLabel = (label: string) => reqs.find((r) => r.label === label)!;

  beforeAll(async () => {
    alice = await signedInUser("der_alice");
    bob = await signedInUser("der_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "DerAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "DerBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "Der Template" }).select("id").single();
    const { data: stages } = await alice
      .from("template_stages")
      .insert([
        { template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 },
        { template_id: t!.id, org_id: orgId, name: "Sign-off", position: 1 },
      ])
      .select("id, name");
    const tplInspect = stages!.find((s) => s.name === "Inspect")!.id;
    const { error: reqError } = await alice.from("template_stage_requirements").insert([
      { template_stage_id: tplInspect, org_id: orgId, type: "text", label: "Notes", required: true, config: {}, position: 0 },
      { template_stage_id: tplInspect, org_id: orgId, type: "boolean", label: "Safe to operate", required: true, config: {}, position: 1 },
      { template_stage_id: tplInspect, org_id: orgId, type: "choice", label: "Route", required: true, config: { options: ["Front", "Rear"] }, position: 2 },
      { template_stage_id: tplInspect, org_id: orgId, type: "date", label: "Valid until", required: false, config: {}, position: 3 },
      { template_stage_id: tplInspect, org_id: orgId, type: "checklist", label: "Checks", required: true, config: { items: ["Power", "Clean"] }, position: 4 },
    ]);
    if (reqError) throw reqError;

    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "Der Program",
    });
    if (e3) throw e3;
    const programId = (program as { id: string }).id;

    const { data: pStages } = await alice
      .from("program_stages").select("id, name").eq("program_id", programId);
    inspectStageId = pStages!.find((s) => s.name === "Inspect")!.id;
    signoffStageId = pStages!.find((s) => s.name === "Sign-off")!.id;

    const { data: pReqs } = await alice
      .from("program_stage_requirements")
      .select("id, type, label, required, position, config")
      .eq("program_stage_id", inspectStageId)
      .order("position");
    reqs = pReqs as Req[];

    const { data: unit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 1" })
      .select("id")
      .single();
    // Two round trips, not one insert+embed: the units AFTER INSERT trigger
    // fans out unit_stages, but a single PostgREST insert-with-embed query
    // runs the embed against the pre-trigger snapshot (a documented
    // Postgres WITH-query limitation — a sibling/primary query in the same
    // command does not see an AFTER trigger's writes to another table), so
    // it always comes back empty. Re-querying separately sees the committed
    // rows.
    const { data: unitStages } = await alice
      .from("unit_stages")
      .select("id, program_stage_id")
      .eq("unit_id", unit!.id);
    inspectUnitStageId = unitStages!.find((us) => us.program_stage_id === inspectStageId)!.id;
    signoffUnitStageId = unitStages!.find((us) => us.program_stage_id === signoffStageId)!.id;
  });

  it("snapshot copies requirements and expands the checklist", () => {
    // 4 non-checklist + 2 expanded checklist items = 6, positions 0..5.
    expect(reqs).toHaveLength(6);
    expect(reqs.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(reqs.every((r) => r.type !== "checklist")).toBe(true);
    const power = byLabel("Checks · Power");
    const clean = byLabel("Checks · Clean");
    expect(power.type).toBe("boolean");
    expect(power.required).toBe(true);
    expect(power.config).toEqual({ group: "Checks" });
    expect(clean.type).toBe("boolean");
    expect(byLabel("Route").config).toEqual({ options: ["Front", "Rear"] });
  });

  it("later template edits do not leak into the program", async () => {
    // The template still has its 5 authored requirements; the program copy
    // stays at 6 expanded rows even after another template edit.
    const { data: t } = await alice.from("templates").select("id").eq("org_id", orgId).single();
    const { data: s } = await alice
      .from("template_stages").select("id").eq("template_id", t!.id).eq("name", "Inspect").single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: s!.id, org_id: orgId, type: "text", label: "Added later", required: true, config: {}, position: 9,
    });
    const { data: still } = await alice
      .from("program_stage_requirements").select("id").eq("program_stage_id", inspectStageId);
    expect(still).toHaveLength(6);
  });

  it("program_stage_requirements is immutable to API roles", async () => {
    const { error: insErr } = await alice.from("program_stage_requirements").insert({
      program_stage_id: inspectStageId, program_id: reqs[0].id, org_id: orgId,
      type: "text", label: "Sneak", required: true, config: {}, position: 99,
    });
    expect(insErr).not.toBeNull();
    const { error: updErr, data: updData } = await alice
      .from("program_stage_requirements")
      .update({ label: "Renamed" })
      .eq("id", reqs[0].id)
      .select();
    // Grant-level denial errors; policy-level denial returns 0 rows. Accept either.
    expect(updErr !== null || updData!.length === 0).toBe(true);
  });

  it("responses derive their denormalized columns and reject cross-stage pairs", async () => {
    const { data, error } = await alice
      .from("unit_stage_responses")
      .insert({
        unit_stage_id: inspectUnitStageId,
        program_stage_requirement_id: byLabel("Notes").id,
        value_text: "All fine",
      })
      .select("org_id, unit_id, program_id, type")
      .single();
    expect(error).toBeNull();
    expect(data!.org_id).toBe(orgId);
    expect(data!.type).toBe("text");

    // Same program, wrong stage: the sign-off unit_stage cannot answer an
    // Inspect requirement.
    const { error: crossErr } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: signoffUnitStageId,
      program_stage_requirement_id: byLabel("Route").id,
      value_text: "Front",
    });
    expect(crossErr).not.toBeNull();
  });

  it("the one-value CHECK rejects a wrong-typed value", async () => {
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: inspectUnitStageId,
      program_stage_requirement_id: byLabel("Route").id,
      value_number: 7, // choice wants value_text
    });
    expect(error).not.toBeNull();
  });

  it("derivation completes the stage only when all required are satisfied", async () => {
    const answer = (label: string, cols: Record<string, unknown>) =>
      alice.from("unit_stage_responses").upsert(
        {
          unit_stage_id: inspectUnitStageId,
          program_stage_requirement_id: byLabel(label).id,
          ...cols,
        },
        { onConflict: "unit_stage_id,program_stage_requirement_id" },
      );
    const stage = () =>
      alice.from("unit_stages").select("status, done_source").eq("id", inspectUnitStageId).single();

    // Notes answered in the previous test. Answer everything but leave one
    // checklist item false: still pending.
    expect((await answer("Route", { value_text: "Front" })).error).toBeNull();
    expect((await answer("Safe to operate", { value_bool: true })).error).toBeNull();
    expect((await answer("Checks · Power", { value_bool: true })).error).toBeNull();
    expect((await answer("Checks · Clean", { value_bool: false })).error).toBeNull();
    let s = (await stage()).data!;
    expect(s.status).toBe("pending"); // boolean false is not satisfied

    expect((await answer("Checks · Clean", { value_bool: true })).error).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("done");
    expect(s.done_source).toBe("requirements"); // optional date never blocked

    // Removing a required answer reopens.
    const { error: delErr } = await alice
      .from("unit_stage_responses")
      .delete()
      .eq("unit_stage_id", inspectUnitStageId)
      .eq("program_stage_requirement_id", byLabel("Route").id);
    expect(delErr).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("pending");
    expect(s.done_source).toBeNull();

    expect((await answer("Route", { value_text: "Rear" })).error).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("done");
  });

  it("a status write without responses is recorded as an override", async () => {
    const { error } = await alice
      .from("unit_stages").update({ status: "done" }).eq("id", signoffUnitStageId);
    expect(error).toBeNull();
    const { data } = await alice
      .from("unit_stages").select("status, done_source").eq("id", signoffUnitStageId).single();
    expect(data!.status).toBe("done");
    expect(data!.done_source).toBe("override");

    // Reopen clears the source.
    await alice.from("unit_stages").update({ status: "pending" }).eq("id", signoffUnitStageId);
    const { data: after } = await alice
      .from("unit_stages").select("done_source").eq("id", signoffUnitStageId).single();
    expect(after!.done_source).toBeNull();
  });

  it("clients cannot write done_source directly", async () => {
    const { error } = await alice
      .from("unit_stages")
      .update({ done_source: "requirements" })
      .eq("id", signoffUnitStageId);
    expect(error).not.toBeNull(); // no column grant
  });

  it("a foreign member sees and writes nothing", async () => {
    const { data } = await bob
      .from("unit_stage_responses").select("id").eq("unit_stage_id", inspectUnitStageId);
    expect(data).toHaveLength(0);
    const { error } = await bob.from("unit_stage_responses").insert({
      unit_stage_id: inspectUnitStageId,
      program_stage_requirement_id: byLabel("Notes").id,
      value_text: "intrusion",
    });
    expect(error).not.toBeNull();
  });
});
