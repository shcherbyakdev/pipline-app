/**
 * Portal TypeScript read layer (slice 9): resolvePortalToken, getPortalUnits,
 * getPortalUnitDetail — scope isolation, program grouping, the done-expands
 * rule, and the no-attribution guarantee. Requires the local stack (npm run
 * setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import type { PortalScope } from "@/lib/tokens";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

// Dynamic import, deliberately AFTER loadEnvFile: @/lib/tokens pulls in
// @/env, which validates process.env at module-evaluation time. A static
// import is hoisted above the env load and would fail that validation.
// (`import type` above is erased, so it costs nothing at runtime.)
const { resolvePortalToken, getPortalUnits, getPortalUnitDetail } = await import("@/lib/tokens");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

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

function mint(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

describe("portal readers: scope, grouping, the done-expands rule, no names", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let aliceId: string;
  let orgId: string;
  let programId: string;
  let textReqId: string;
  let unitA: string; // client Acme
  let unitB: string; // client Bridge
  let unitNone: string; // no client
  let acme: string;
  let bridge: string;
  let scopeA: PortalScope;

  beforeAll(async () => {
    alice = await signedInUser("preaders_alice");
    const { data: me } = await alice.auth.getUser();
    aliceId = me.user!.id;
    const { data: org } = await alice.rpc("create_org", { p_name: "ReadersOrg" });
    orgId = (org as { id: string }).id;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "R Template" }).select("id").single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id").single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: s!.id, org_id: orgId, type: "text", label: "Notes",
      required: true, config: {}, position: 0,
    });
    const { data: program } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "R Program",
    });
    programId = (program as { id: string }).id;
    const { data: reqs } = await alice
      .from("program_stage_requirements").select("id").eq("program_id", programId);
    textReqId = reqs![0].id;

    const { data: cA } = await alice
      .from("clients").insert({ org_id: orgId, name: "Acme" }).select("id").single();
    acme = cA!.id;
    const { data: cB } = await alice
      .from("clients").insert({ org_id: orgId, name: "Bridge" }).select("id").single();
    bridge = cB!.id;

    const insertUnit = async (name: string, clientId: string | null) => {
      const { data: u } = await alice
        .from("units")
        .insert({ program_id: programId, org_id: orgId, name, client_id: clientId })
        .select("id").single();
      return u!.id;
    };
    unitA = await insertUnit("Site A", acme);
    unitB = await insertUnit("Site B", bridge);
    unitNone = await insertUnit("Site None", null);

    const tA = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tA.tokenHash, kind: "portal", client_id: acme,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    const resolved = await resolvePortalToken(tA.token, "test");
    if (resolved.status !== "ok") throw new Error(`resolve failed: ${resolved.status}`);
    scopeA = resolved.scope;
  });

  it("resolves through the chokepoint with client identity", () => {
    expect(scopeA.clientName).toBe("Acme");
    expect(scopeA.orgName).toBe("ReadersOrg");
  });

  it("unknown token → not_found through the chokepoint", async () => {
    const r = await resolvePortalToken(mint().token, "test");
    expect(r.status).toBe("not_found");
  });

  it("home lists ONLY the token's client's units, grouped by program", async () => {
    const groups = await getPortalUnits(scopeA);
    expect(groups).toHaveLength(1);
    expect(groups[0].programName).toBe("R Program");
    expect(groups[0].units.map((u) => u.name)).toEqual(["Site A"]);
    expect(groups[0].units[0].lastActivity).toBeNull(); // nothing happened yet
  });

  it("detail: cross-client and unclaimed units read as nonexistent", async () => {
    expect(await getPortalUnitDetail(scopeA, unitB)).toBeNull();
    expect(await getPortalUnitDetail(scopeA, unitNone)).toBeNull();
  });

  it("pending stages carry a name and NOTHING else", async () => {
    const detail = await getPortalUnitDetail(scopeA, unitA);
    expect(detail).not.toBeNull();
    expect(detail!.stages).toHaveLength(1);
    expect(detail!.stages[0].status).toBe("pending");
    expect(detail!.stages[0].items).toEqual([]); // the portal rule
  });

  it("a done stage expands with answers, and lastActivity moves — with no names anywhere", async () => {
    // Answer via the PARTICIPANT surface so attribution gets set — the
    // strongest no-leak setup: the response row genuinely carries a
    // participant id, and the portal read model must still show no name.
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "LEAKYNAME" }).select("id").single();
    await alice.from("units").update({ assigned_participant_id: p!.id }).eq("id", unitA);
    const tP = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tP.tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    const { error: submitErr } = await anon.rpc("submit_participant_response", {
      p_token: tP.token, p_unit_id: unitA, p_requirement_id: textReqId,
      p_value_text: "All clear", p_value_number: null, p_value_bool: null, p_value_date: null,
    });
    expect(submitErr).toBeNull();

    const detail = await getPortalUnitDetail(scopeA, unitA);
    expect(detail!.stages[0].status).toBe("done"); // derive trigger fired
    expect(detail!.stages[0].doneAt).not.toBeNull();
    expect(detail!.stages[0].items).toEqual([
      expect.objectContaining({ label: "Notes", type: "text", value: "All clear" }),
    ]);
    // Attribution is excluded at the type level — prove it end to end.
    expect(JSON.stringify(detail)).not.toContain("LEAKYNAME");

    const groups = await getPortalUnits(scopeA);
    expect(groups[0].units[0].done).toBe(1);
    expect(groups[0].units[0].lastActivity).not.toBeNull();
    expect(JSON.stringify(groups)).not.toContain("LEAKYNAME");
  });
});
