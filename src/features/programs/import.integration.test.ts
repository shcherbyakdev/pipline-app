/**
 * import_units RPC proof (slice 5b): idempotent upsert on
 * (program_id, external_ref), invoker security (RLS + 0008 column grants
 * still gate), atomicity, and the 500-row/<10s roadmap criterion.
 * Requires the local Supabase stack (npm run setup). Mirrors the fixture
 * idiom of programs/rls.integration.test.ts; `it` blocks are
 * ORDER-DEPENDENT and must run sequentially in file order.
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

const rows = (refs: string[], name = (r: string) => `Unit ${r}`) =>
  refs.map((r) => ({ name: name(r), external_ref: r }));

describe("import_units", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let programId: string;
  let secondProgramId: string;

  beforeAll(async () => {
    // Distinct tags: this file shares the serial integration process with
    // suites using "program_*" / other tags — same-millisecond collisions
    // on identical tags are real (see rls.integration.test.ts).
    alice = await signedInUser("import_alice");
    bob = await signedInUser("import_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ImportCo" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "OtherCo" });
    if (e2) throw e2;

    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Import Fixture" })
      .select("id")
      .single();
    if (e3) throw e3;
    const templateId = (template as { id: string }).id;
    const { error: e4 } = await alice.from("template_stages").insert(
      ["S1", "S2"].map((name, position) => ({
        template_id: templateId,
        org_id: aliceOrgId,
        name,
        position,
      })),
    );
    if (e4) throw e4;

    const { data: p1, error: e5 } = await alice.rpc("create_program", {
      p_template_id: templateId,
      p_name: "Import P1",
    });
    if (e5) throw e5;
    programId = (p1 as { id: string }).id;
    const { data: p2, error: e6 } = await alice.rpc("create_program", {
      p_template_id: templateId,
      p_name: "Import P2",
    });
    if (e6) throw e6;
    secondProgramId = (p2 as { id: string }).id;
  });

  it("imports new units, returns counts, fans out unit_stages", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 3, updated: 0 });

    const { data: units } = await alice
      .from("units")
      .select("id, name, external_ref")
      .eq("program_id", programId);
    expect(units).toHaveLength(3);

    const { count } = await alice
      .from("unit_stages")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(6); // 3 units × 2 snapshot stages
  });

  it("re-importing the same rows is a counted no-op (idempotent)", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 0, updated: 3 });
    const { count } = await alice
      .from("units")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(3);
  });

  it("re-import updates a changed name and leaves progress untouched", async () => {
    // Mark one stage done first; the re-import must not reset it.
    const { data: unit } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "S-1")
      .single();
    const unitId = (unit as { id: string }).id;
    const { data: stage } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", unitId)
      .limit(1)
      .single();
    const stageId = (stage as { id: string }).id;
    const { error: doneError } = await alice
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", stageId);
    expect(doneError).toBeNull();

    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"], (r) => (r === "S-1" ? "Renamed S-1" : `Unit ${r}`)),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 0, updated: 3 });

    const { data: renamed } = await alice.from("units").select("name").eq("id", unitId).single();
    expect(renamed!.name).toBe("Renamed S-1");
    const { data: stageAfter } = await alice
      .from("unit_stages")
      .select("status")
      .eq("id", stageId)
      .single();
    expect(stageAfter!.status).toBe("done");
    const { count } = await alice
      .from("unit_stages")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(6); // no re-fan-out on update
  });

  it("a second program imports the same refs independently", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: secondProgramId,
      p_rows: rows(["S-1", "S-2"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 2, updated: 0 });
  });

  it("manual units without refs coexist (NULLs distinct under the constraint)", async () => {
    for (const name of ["Manual A", "Manual B"]) {
      const { error } = await alice
        .from("units")
        .insert({ program_id: programId, org_id: aliceOrgId, name });
      expect(error).toBeNull();
    }
  });

  it("duplicate refs within one payload are rejected atomically", async () => {
    const { error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: [...rows(["DUP-1"]), ...rows(["DUP-1"])],
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "DUP-1");
    expect(data).toHaveLength(0); // the valid first row rolled back too
  });

  it("rejects blank names / blank refs without writing", async () => {
    const { error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: [{ name: "  ", external_ref: "BLANK-1" }],
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "BLANK-1");
    expect(data).toHaveLength(0);
  });

  it("a foreign member's import into the program fails", async () => {
    const { error } = await bob.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["INTRUDER-1"]),
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "INTRUDER-1");
    expect(data).toHaveLength(0);
  });

  it(
    "imports 500 rows in under 10s with full fan-out (roadmap criterion)",
    async () => {
      const refs = Array.from({ length: 500 }, (_, i) => `PERF-${i}`);
      const started = performance.now();
      const { data, error } = await alice.rpc("import_units", {
        p_program_id: secondProgramId,
        p_rows: rows(refs),
      });
      const elapsed = performance.now() - started;
      expect(error).toBeNull();
      expect(data).toEqual({ inserted: 500, updated: 0 });
      expect(elapsed).toBeLessThan(10_000);

      const { count } = await alice
        .from("unit_stages")
        .select("id", { count: "exact", head: true })
        .eq("program_id", secondProgramId);
      expect(count).toBe(1004); // (500 + 2 earlier units) × 2 stages
    },
    15_000,
  );
});
