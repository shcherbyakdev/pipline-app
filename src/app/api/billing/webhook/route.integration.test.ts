import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try { loadEnvFile(".env.local"); } catch { /* CI */ }
process.env.BILLING_PROVIDER = "fake";
process.env.BILLING_FAKE_SECRET = "test-secret-0123456789abcdef";

const { POST } = await import("./route");
const { signFakeWebhook } = await import("@/lib/billing/fake");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const RUN = Date.now().toString(36);
let orgId: string;

// create_org is granted to `authenticated` only (0001_foundation_rls.sql) —
// the service-role client can't call it directly, so create the org through
// a signed-in user, same idiom as billing.integration.test.ts.
async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `bill_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

describe("POST /api/billing/webhook (fake provider)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("hook");
    const { data, error } = await owner.rpc("create_org", { p_name: "HookCo" });
    if (error) throw error;
    orgId = (data as { id: string }).id;
  });
  const body = () => JSON.stringify([{
    providerEventId: `hook-${RUN}`, occurredAt: new Date().toISOString(), orgId, type: "subscription_created",
    subscription: { providerCustomerId: "c", providerSubscriptionId: `s-${RUN}`, plan: "pro", interval: "month", seats: 1,
      status: "active", currentPeriodEnd: null, cancelAtPeriodEnd: false },
  }]);
  const post = (b: string, sig: string | null) => POST(new Request("http://x/api/billing/webhook", {
    method: "POST", body: b, headers: sig ? { "x-signature": sig } : {} }));

  it("401 on bad signature, 200 + row on good, replay skipped", async () => {
    expect((await post(body(), "bad")).status).toBe(401);
    const b = body();
    const ok = await post(b, signFakeWebhook(b, process.env.BILLING_FAKE_SECRET!));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ processed: 1, skipped: 0 });
    const row = await admin.from("org_subscriptions").select("plan").eq("org_id", orgId).single();
    expect(row.data?.plan).toBe("pro");
    const again = await post(b, signFakeWebhook(b, process.env.BILLING_FAKE_SECRET!));
    expect(await again.json()).toEqual({ processed: 0, skipped: 1 });
  });

  it("400 on malformed body", async () => {
    const res = await post("not json", signFakeWebhook("not json", process.env.BILLING_FAKE_SECRET!));
    expect(res.status).toBe(400);
  });
});
