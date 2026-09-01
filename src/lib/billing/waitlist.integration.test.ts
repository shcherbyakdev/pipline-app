/**
 * Premium waitlist against the real DB: RLS/grants on premium_waitlist
 * (0066) and the seam ranking (comp > provider row > waitlist). Requires the
 * local Supabase stack. utils.integration.test.ts idiom throughout.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

// Dynamic: queries.ts reaches @/env, which parses process.env eagerly.
const { getOrgSubscription, getWaitlistEntry } = await import("@/lib/billing/queries");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<{ client: SupabaseClient; email: string }> {
  const email = `waitlist_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { client, email };
}

let owner: SupabaseClient;
let ownerEmail: string;
let stranger: SupabaseClient;
let orgId: string;

describe("premium_waitlist: RLS + grants", () => {
  beforeAll(async () => {
    ({ client: owner, email: ownerEmail } = await signedInUser("owner"));
    ({ client: stranger } = await signedInUser("stranger"));
    const { data, error } = await owner.rpc("create_org", { p_name: "WaitlistCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
  });

  it("a stranger cannot sign the org up; a member cannot sign up as someone else", async () => {
    const theirs = await stranger.from("premium_waitlist").insert({ org_id: orgId, joined_by: "stranger@test" });
    expect(theirs.error).not.toBeNull();
    const forged = await owner.from("premium_waitlist").insert({ org_id: orgId, joined_by: "someone-else@test" });
    expect(forged.error).not.toBeNull();
    expect(await getWaitlistEntry(orgId, admin)).toBeNull();
  });

  it("a member joins their own org once; the second join is a no-op, not an error", async () => {
    const first = await owner.from("premium_waitlist").insert({ org_id: orgId, joined_by: ownerEmail });
    expect(first.error).toBeNull();
    const again = await owner
      .from("premium_waitlist")
      .upsert({ org_id: orgId, joined_by: ownerEmail }, { onConflict: "org_id", ignoreDuplicates: true });
    expect(again.error).toBeNull();
    const rows = await admin.from("premium_waitlist").select("org_id").eq("org_id", orgId);
    expect(rows.data).toHaveLength(1);
  });

  it("member reads own row; stranger and anon see nothing; member cannot leave (delete/update refused)", async () => {
    expect(await getWaitlistEntry(orgId, owner)).not.toBeNull();
    expect((await stranger.from("premium_waitlist").select("org_id").eq("org_id", orgId)).data ?? []).toHaveLength(0);
    expect((await anon.from("premium_waitlist").select("org_id")).error).not.toBeNull();
    const del = await owner.from("premium_waitlist").delete().eq("org_id", orgId);
    expect(del.error).not.toBeNull();
    const upd = await owner.from("premium_waitlist").update({ joined_by: "x@test" }).eq("org_id", orgId);
    expect(upd.error).not.toBeNull();
    expect(await getWaitlistEntry(orgId, admin)).not.toBeNull();
  });

  it("the seam: waitlist → Pro; a comp override outranks it; service_role removes it", async () => {
    const now = new Date();
    expect((await getOrgSubscription(orgId, owner, now))?.plan).toBe("pro");
    const comp = await admin.from("org_plan_overrides").insert({ org_id: orgId, plan: "team", granted_by: "owner@test" });
    if (comp.error) throw comp.error;
    expect((await getOrgSubscription(orgId, owner, now))?.plan).toBe("team");
    const gone = await admin.from("org_plan_overrides").delete().eq("org_id", orgId);
    if (gone.error) throw gone.error;
    const left = await admin.from("premium_waitlist").delete().eq("org_id", orgId);
    expect(left.error).toBeNull();
    expect(await getOrgSubscription(orgId, owner, now)).toBeNull();
  });

  it("the flag CHECK accepts premium_waitlist", async () => {
    const flag = await admin
      .from("org_feature_flags")
      .insert({ org_id: orgId, flag: "premium_waitlist", enabled: false, updated_by: "owner@test" });
    expect(flag.error).toBeNull();
  });
});
