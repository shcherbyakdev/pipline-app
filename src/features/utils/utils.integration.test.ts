/**
 * Internal utils tables against the real DB: RLS/grants on
 * org_plan_overrides + org_feature_flags, and the comp seam
 * (getOrgSubscription honouring an unexpired override). Requires the local
 * Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

// Dynamic, not static: queries.ts reaches @/env, which parses process.env
// eagerly at module load. A static import would resolve (and fail) before
// the loadEnvFile() call above ever runs.
const { getOrgSubscription, getRawOrgSubscription, getPlanOverride } = await import("@/lib/billing/queries");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `utils_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

let owner: SupabaseClient;
let stranger: SupabaseClient;
let orgId: string;

describe("utils tables: RLS + grants", () => {
  beforeAll(async () => {
    owner = await signedInUser("owner");
    stranger = await signedInUser("stranger");
    const { data, error } = await owner.rpc("create_org", { p_name: "UtilsCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
    const ovr = await admin.from("org_plan_overrides").insert({ org_id: orgId, plan: "pro", granted_by: "owner@test" });
    if (ovr.error) throw ovr.error;
    const flag = await admin.from("org_feature_flags").insert({ org_id: orgId, flag: "billing", enabled: true, updated_by: "owner@test" });
    if (flag.error) throw flag.error;
  });

  it("member selects own rows; stranger and anon see nothing", async () => {
    const mine = await owner.from("org_plan_overrides").select("plan").eq("org_id", orgId);
    expect(mine.error).toBeNull();
    expect(mine.data).toHaveLength(1);
    const myFlags = await owner.from("org_feature_flags").select("flag").eq("org_id", orgId);
    expect(myFlags.data).toHaveLength(1);
    expect((await stranger.from("org_plan_overrides").select("plan").eq("org_id", orgId)).data ?? []).toHaveLength(0);
    expect((await stranger.from("org_feature_flags").select("flag").eq("org_id", orgId)).data ?? []).toHaveLength(0);
    expect((await anon.from("org_plan_overrides").select("plan")).error).not.toBeNull();
    expect((await anon.from("org_feature_flags").select("flag")).error).not.toBeNull();
  });

  it("member sees plan/expires_at of its own comp, never the note or who granted it", async () => {
    // 0046 replaces 0045's table-wide grant with a column-level one: a member
    // may know THAT the org is comped and until when — /billing says so — but
    // the note is the owner's internal reason and granted_by names a staffer.
    const visible = await owner.from("org_plan_overrides").select("plan, expires_at").eq("org_id", orgId);
    expect(visible.error).toBeNull();
    expect(visible.data).toHaveLength(1);
    expect((await owner.from("org_plan_overrides").select("note").eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("org_plan_overrides").select("granted_by").eq("org_id", orgId)).error).not.toBeNull();
  });

  it("member reads flag + enabled of its own org's flags, never who set them (NEEDS 0052)", async () => {
    // 0052 column-scopes the authenticated SELECT on org_feature_flags to
    // (org_id, flag, enabled), the 0046 treatment for org_plan_overrides:
    // `updated_by` names a staffer, and nothing a member renders needs it.
    // Until 0052 is applied the first assertion fails (the grant is still
    // table-wide) — that is the migration this test is written against.
    const visible = await owner.from("org_feature_flags").select("flag, enabled").eq("org_id", orgId);
    expect(visible.error).toBeNull();
    expect(visible.data).toEqual([{ flag: "billing", enabled: true }]);
    const hidden = await owner.from("org_feature_flags").select("updated_by").eq("org_id", orgId);
    expect(hidden.error?.code).toBe("42501");
  });

  it("member cannot insert/update/delete either table", async () => {
    // A member handing itself Team, or switching billing on for itself, is
    // exactly the hole these tables must not have.
    expect((await owner.from("org_plan_overrides").update({ plan: "team" }).eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("org_plan_overrides").delete().eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("org_feature_flags").insert({ org_id: orgId, flag: "rentals", enabled: true, updated_by: "me" })).error).not.toBeNull();
    expect((await owner.from("org_feature_flags").update({ enabled: false }).eq("org_id", orgId)).error).not.toBeNull();
    expect((await owner.from("org_feature_flags").delete().eq("org_id", orgId)).error).not.toBeNull();
  });

  it("CHECKs reject an unknown plan and an unknown flag", async () => {
    expect((await admin.from("org_plan_overrides").update({ plan: "gold" }).eq("org_id", orgId)).error).not.toBeNull();
    expect((await admin.from("org_feature_flags").insert({ org_id: orgId, flag: "unicorns", enabled: true, updated_by: "x" })).error).not.toBeNull();
  });

  it("service role upserts a flag row in place (composite PK)", async () => {
    const up = await admin
      .from("org_feature_flags")
      .upsert({ org_id: orgId, flag: "billing", enabled: false, updated_by: "owner@test" }, { onConflict: "org_id,flag" });
    expect(up.error).toBeNull();
    const { data } = await admin.from("org_feature_flags").select("enabled").eq("org_id", orgId).eq("flag", "billing");
    expect(data).toEqual([{ enabled: false }]);
  });
});

describe("comp seam: getOrgSubscription", () => {
  const now = new Date("2026-08-18T12:00:00Z");
  it("an unexpired override wins over the provider row; the raw read still shows the provider row", async () => {
    const ins = await admin.from("org_subscriptions").insert({
      org_id: orgId, plan: "pro", status: "expired", billing_interval: "month", seats: 1,
      provider: "fake", provider_customer_id: `cus_utils_${orgId}`, provider_subscription_id: `sub_utils_${orgId}`,
      provider_updated_at: "2000-01-01T00:00:00Z",
    });
    if (ins.error) throw ins.error;
    const set = await admin.from("org_plan_overrides").upsert({ org_id: orgId, plan: "team", expires_at: null, granted_by: "owner@test" });
    if (set.error) throw set.error;
    expect((await getOrgSubscription(orgId, admin, now))?.plan).toBe("team");
    expect((await getRawOrgSubscription(orgId, admin))?.status).toBe("expired");
    expect((await getPlanOverride(orgId, admin))?.plan).toBe("team");
  });
  it("an expired override is ignored and the provider row is what counts", async () => {
    const set = await admin.from("org_plan_overrides").update({ expires_at: "2020-01-01T00:00:00Z" }).eq("org_id", orgId);
    if (set.error) throw set.error;
    const row = await getOrgSubscription(orgId, admin, now);
    expect(row?.plan).toBe("pro");
    expect(row?.status).toBe("expired");
  });
  it("revoked (deleted) → provider row only", async () => {
    const del = await admin.from("org_plan_overrides").delete().eq("org_id", orgId);
    if (del.error) throw del.error;
    expect(await getPlanOverride(orgId, admin)).toBeNull();
    expect((await getOrgSubscription(orgId, admin, now))?.status).toBe("expired");
  });
});
