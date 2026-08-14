/**
 * Portal token security core (slice 9): resolve_portal_token, portal/
 * participant scope CHECKs, org guards, client lifecycle cascades, clients
 * RLS, update_org_branding. Requires the local stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

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

type PortalRow = {
  status: "ok" | "expired" | "revoked";
  org_id: string;
  org_name: string;
  client_id: string;
  client_name: string;
};

describe("portal tokens: resolve, scope CHECKs, guards, cascade, branding", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceId: string;
  let orgId: string;
  let bobOrgId: string;
  let programId: string;
  let unit1: string;
  let clientA: string; // Acme — unit1 belongs to it
  let bobClient: string;
  let tA: { token: string; tokenHash: string };

  const resolve = async (token: string) => anon.rpc("resolve_portal_token", { p_token: token });

  beforeAll(async () => {
    alice = await signedInUser("portal_alice");
    bob = await signedInUser("portal_bob");
    const { data: me } = await alice.auth.getUser();
    aliceId = me.user!.id;
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "PortalAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: bOrg, error: e2 } = await bob.rpc("create_org", { p_name: "PortalBeta" });
    if (e2) throw e2;
    bobOrgId = (bOrg as { id: string }).id;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "Portal Template" }).select("id").single();
    await alice.from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 });
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "Portal Program",
    });
    if (e3) throw e3;
    programId = (program as { id: string }).id;
    const { data: u } = await alice
      .from("units").insert({ program_id: programId, org_id: orgId, name: "Site 1" })
      .select("id").single();
    unit1 = u!.id;

    const { data: cA } = await alice
      .from("clients").insert({ org_id: orgId, name: "Acme Retail" }).select("id").single();
    clientA = cA!.id;
    const { data: cBob } = await bob
      .from("clients").insert({ org_id: bobOrgId, name: "BetaCorp" }).select("id").single();
    bobClient = cBob!.id;

    const { error: assignErr } = await alice
      .from("units").update({ client_id: clientA }).eq("id", unit1);
    if (assignErr) throw assignErr;

    tA = mint();
    const { error: mintErr } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tA.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    if (mintErr) throw mintErr;
  });

  it("resolves a live portal token with org + client identity", async () => {
    const { data, error } = await resolve(tA.token);
    expect(error).toBeNull();
    const row = (data as PortalRow[])[0];
    expect(row.status).toBe("ok");
    expect(row.org_name).toBe("PortalAlpha");
    expect(row.client_id).toBe(clientA);
    expect(row.client_name).toBe("Acme Retail");
  });

  it("updates last_used_at on resolve (revocation hygiene)", async () => {
    const { data } = await admin
      .from("access_tokens").select("last_used_at").eq("token_hash", tA.tokenHash).single();
    expect(data!.last_used_at).not.toBeNull();
  });

  it("unknown token resolves to empty (uniform not-found)", async () => {
    const { data, error } = await resolve(mint().token);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("kind isolation: a portal token is invisible to the participant resolver, and vice versa", async () => {
    const { data: viaParticipant } = await anon.rpc("resolve_participant_token", { p_token: tA.token });
    expect(viaParticipant).toEqual([]);

    // Mint a participant token and check the portal resolver ignores it.
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "Iso Engineer" }).select("id").single();
    const tP = mint();
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tP.tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).toBeNull();
    const { data: viaPortal } = await resolve(tP.token);
    expect(viaPortal).toEqual([]);
  });

  it("expired and revoked report their status, not not-found", async () => {
    const tExp = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tExp.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() - 1000).toISOString(), created_by: aliceId,
    });
    const { data: exp } = await resolve(tExp.token);
    expect((exp as PortalRow[])[0].status).toBe("expired");

    const tRev = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tRev.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    await alice.from("access_tokens")
      .update({ revoked_at: new Date().toISOString() }).eq("token_hash", tRev.tokenHash);
    const { data: rev } = await resolve(tRev.token);
    expect((rev as PortalRow[])[0].status).toBe("revoked");
  });

  it("portal scope CHECK: client required; participant/program/unit must be null", async () => {
    // A null client_id on a portal row never reaches the CHECK: the
    // check_access_token_org BEFORE INSERT trigger's portal branch (0018)
    // does `select org_id from clients where id = new.client_id` first,
    // finds no row for a null id, and raises 'client not found' (P0001)
    // ahead of access_tokens_portal_scope_check. So this half pins the
    // trigger's shadowing behavior, not the CHECK's client-required
    // clause — asserting the exact error keeps it from going vacuous if
    // that clause were ever loosened.
    const noClient = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(noClient.error?.code).toBe("P0001");
    expect(noClient.error?.message).toBe("client not found");

    const withProgram = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal", client_id: clientA,
      program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(withProgram.error).not.toBeNull();
  });

  it("participant scope CHECK (tightened): a participant token cannot carry a client_id", async () => {
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "Check Engineer" }).select("id").single();
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId, client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).not.toBeNull();
  });

  it("org guard: minting a portal token for a foreign client fails", async () => {
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal", client_id: bobClient,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).not.toBeNull(); // RLS-invisible foreign client → 'client not found'
  });

  it("org guard: assigning a foreign client to a unit fails", async () => {
    const { error } = await alice.from("units").update({ client_id: bobClient }).eq("id", unit1);
    expect(error).not.toBeNull();
  });

  it("clients RLS: cross-org rows are invisible; member CRUD works", async () => {
    const { data: bobSees } = await bob.from("clients").select("id").eq("id", clientA);
    expect(bobSees).toEqual([]);
    const { error: renameErr } = await alice
      .from("clients").update({ name: "Acme Retail Ltd" }).eq("id", clientA);
    expect(renameErr).toBeNull();
    // anon has zero direct table access (0013 default-privileges revoke).
    const { error: anonErr } = await anon.from("clients").select("id").limit(1);
    expect(anonErr).not.toBeNull();
  });

  it("duplicate client name in the same org is allowed (name uniqueness dropped by the scheduling pivot)", async () => {
    // clients_org_lower_name_uq (0017) was intentionally dropped in 0025: two
    // different bookers can legitimately share a display name. Uniqueness is
    // now keyed on (org_id, lower(email)) — see booking-rpc.integration.test's
    // "re-booking with the same email reuses the client row".
    const { error } = await alice.from("clients").insert({ org_id: orgId, name: "acme retail ltd" });
    expect(error).toBeNull();
  });

  it("update_org_branding: member writes land; non-member and foreign prefix raise", async () => {
    const { error: ok } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0F766E", p_logo_path: `${orgId}/logo-abc.png`,
    });
    expect(ok).toBeNull();
    const { data: org } = await admin
      .from("orgs").select("accent_color, logo_path").eq("id", orgId).single();
    expect(org!.accent_color).toBe("#0f766e"); // lower()ed
    expect(org!.logo_path).toBe(`${orgId}/logo-abc.png`);

    const { error: foreignOrg } = await bob.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#000000", p_logo_path: null,
    });
    expect(foreignOrg).not.toBeNull();

    const { error: foreignPath } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e", p_logo_path: `${bobOrgId}/logo-x.png`,
    });
    expect(foreignPath).not.toBeNull();

    const { error: badHex } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "teal", p_logo_path: null,
    });
    expect(badHex).not.toBeNull(); // dies at orgs_accent_color_check

    // orgs remains directly unwritable by authenticated (0004 unchanged).
    const { error: directWrite, count } = await alice
      .from("orgs").update({ accent_color: "#111111" }, { count: "exact" }).eq("id", orgId);
    expect(directWrite ?? count === 0).toBeTruthy();
  });

  it("update_org_branding: rejects a '..' logo path and leaves logo_path unchanged", async () => {
    const { data: before } = await admin
      .from("orgs").select("logo_path").eq("id", orgId).single();

    const { error } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e",
      p_logo_path: `${orgId}/../../../../etc/passwd`,
    });
    expect(error).not.toBeNull();

    const { data: after } = await admin
      .from("orgs").select("logo_path").eq("id", orgId).single();
    expect(after!.logo_path).toBe(before!.logo_path);
  });

  it("update_org_branding: enforces the 300-char logo path cap at the boundary", async () => {
    // Prefix is `${orgId}/` (37 chars for a uuid); pad to exactly 300 and
    // to 301 so the boundary itself (> 300, not >= 300) is under test.
    const prefix = `${orgId}/`;
    const at300 = prefix + "a".repeat(300 - prefix.length);
    const over300 = prefix + "a".repeat(301 - prefix.length);
    expect(at300).toHaveLength(300);
    expect(over300).toHaveLength(301);

    const { error: tooLong } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e", p_logo_path: over300,
    });
    expect(tooLong).not.toBeNull();

    const { error: atCap } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e", p_logo_path: at300,
    });
    expect(atCap).toBeNull();
    const { data: org } = await admin
      .from("orgs").select("logo_path").eq("id", orgId).single();
    expect(org!.logo_path).toBe(at300);
  });

  it("update_org_branding: a single-dot path segment is accepted (the '..' regex is not over-broad)", async () => {
    const singleDot = `${orgId}/./logo.png`;
    const { error } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e", p_logo_path: singleDot,
    });
    expect(error).toBeNull();
    const { data: org } = await admin
      .from("orgs").select("logo_path").eq("id", orgId).single();
    expect(org!.logo_path).toBe(singleDot);
  });

  it("deleting a client cascades its tokens and nulls its units", async () => {
    const { error: delErr } = await alice.from("clients").delete().eq("id", clientA);
    expect(delErr).toBeNull();
    const { data: tokRows } = await admin
      .from("access_tokens").select("id").eq("token_hash", tA.tokenHash);
    expect(tokRows).toEqual([]); // FK cascade, past grants/RLS
    const { data: u } = await admin.from("units").select("client_id").eq("id", unit1).single();
    expect(u!.client_id).toBeNull();
    const { data: gone } = await resolve(tA.token);
    expect(gone).toEqual([]);
  });
});
