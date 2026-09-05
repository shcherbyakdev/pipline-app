/**
 * Notifications against the real DB (0075): push_subscriptions RLS/grants
 * (own rows only) and the two preference RPCs' validation. Requires the local
 * Supabase stack. waitlist.integration.test.ts idiom throughout.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI exports env directly */ }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function signedInUser(tag: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `notif_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return { client, id: data.user.id };
}

const sub = (suffix: string) => ({
  endpoint: `https://push.example.com/${Date.now()}/${suffix}`,
  p256dh: "BP-public-key",
  auth: "auth-secret",
  user_agent: "vitest",
});

let owner: SupabaseClient;
let ownerId: string;
let stranger: SupabaseClient;
let strangerId: string;
let orgId: string;

describe("push_subscriptions: RLS + grants", () => {
  beforeAll(async () => {
    ({ client: owner, id: ownerId } = await signedInUser("owner"));
    ({ client: stranger, id: strangerId } = await signedInUser("stranger"));
    const { data, error } = await owner.rpc("create_org", { p_name: "NotifCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
  });

  it("a member enables a device for their own org and reads it back", async () => {
    const { error } = await owner.from("push_subscriptions").insert({ ...sub("own"), user_id: ownerId, org_id: orgId });
    expect(error).toBeNull();
    const { data } = await owner.from("push_subscriptions").select("id, endpoint").eq("org_id", orgId);
    expect(data).toHaveLength(1);
  });

  it("a stranger can neither add a device to the org nor see the owner's", async () => {
    const forged = await stranger.from("push_subscriptions").insert({ ...sub("forged"), user_id: strangerId, org_id: orgId });
    expect(forged.error).not.toBeNull();
    const asOwner = await stranger.from("push_subscriptions").insert({ ...sub("as-owner"), user_id: ownerId, org_id: orgId });
    expect(asOwner.error).not.toBeNull();
    const { data } = await stranger.from("push_subscriptions").select("id").eq("org_id", orgId);
    expect(data).toEqual([]);
  });

  it("only the owner removes their device; the seam (service_role) sees every row", async () => {
    const { data: rows } = await admin.from("push_subscriptions").select("id").eq("org_id", orgId);
    expect(rows).toHaveLength(1);
    const theirs = await stranger.from("push_subscriptions").delete().eq("id", rows![0].id).select("id");
    expect(theirs.data).toEqual([]);
    const mine = await owner.from("push_subscriptions").delete().eq("id", rows![0].id).select("id");
    expect(mine.data).toHaveLength(1);
  });
});

describe("preference RPCs", () => {
  it("member prefs: rejects a foreign org, an unknown event and a non-boolean; accepts the full object; null resets", async () => {
    const good = { newBooking: { email: true, push: false }, newRequest: { email: true, push: true }, cancelled: { email: false, push: true }, rescheduled: { email: true, push: true } };
    expect((await stranger.rpc("update_member_notification_prefs", { p_org_id: orgId, p_prefs: good })).error).not.toBeNull();
    expect((await owner.rpc("update_member_notification_prefs", { p_org_id: orgId, p_prefs: { bogus: { email: true, push: true } } })).error).not.toBeNull();
    expect((await owner.rpc("update_member_notification_prefs", { p_org_id: orgId, p_prefs: { newBooking: { email: "yes", push: true } } })).error).not.toBeNull();
    expect((await owner.rpc("update_member_notification_prefs", { p_org_id: orgId, p_prefs: good })).error).toBeNull();
    const { data } = await owner.from("org_members").select("notification_prefs").eq("org_id", orgId).eq("user_id", ownerId).single();
    expect(data?.notification_prefs).toEqual(good);
    expect((await owner.rpc("update_member_notification_prefs", { p_org_id: orgId, p_prefs: null })).error).toBeNull();
    const { data: reset } = await owner.from("org_members").select("notification_prefs").eq("org_id", orgId).eq("user_id", ownerId).single();
    expect(reset?.notification_prefs).toBeNull();
  });

  it("org prefs: rejects a foreign org and a lead outside the set; accepts a valid one", async () => {
    const good = { reminder: { enabled: false, leadHours: 2 } };
    expect((await stranger.rpc("update_org_notification_prefs", { p_org_id: orgId, p_prefs: good })).error).not.toBeNull();
    expect((await owner.rpc("update_org_notification_prefs", { p_org_id: orgId, p_prefs: { reminder: { enabled: true, leadHours: 5 } } })).error).not.toBeNull();
    expect((await owner.rpc("update_org_notification_prefs", { p_org_id: orgId, p_prefs: { reminder: { enabled: "no", leadHours: 24 } } })).error).not.toBeNull();
    expect((await owner.rpc("update_org_notification_prefs", { p_org_id: orgId, p_prefs: good })).error).toBeNull();
    const { data } = await owner.from("orgs").select("notification_prefs").eq("id", orgId).single();
    expect(data?.notification_prefs).toEqual(good);
  });
});
