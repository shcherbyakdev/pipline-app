/**
 * Internal utils tables against the real DB: RLS/grants on
 * org_plan_overrides + org_feature_flags. Requires the local Supabase stack.
 * (The comp seam test joins this file in Task 4.)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

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
