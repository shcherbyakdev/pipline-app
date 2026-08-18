import { describe, it, expect, beforeAll, vi } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// /api/billing/dev-checkout now demands a signed-in member of the org it is
// asked to upgrade (it writes a paid subscription with the admin client).
// Vitest has no Next request scope, so the real requireOrg would throw inside
// cookies() rather than answer — stub it, with a mutable org id so the same
// file can drive both the member path and the 403. (auth/actions.test.ts
// idiom: vi.hoisted holder + vi.mock factory.)
const session = vi.hoisted(() => ({ orgId: "" }));
vi.mock("@/lib/auth/session", () => ({
  requireOrg: async () => ({
    user: { id: "00000000-0000-0000-0000-000000000000", email: "dev@example.com" },
    org: { id: session.orgId, name: "HookCo", slug: "hookco" },
  }),
}));

try { loadEnvFile(".env.local"); } catch { /* CI */ }
process.env.BILLING_PROVIDER = "fake";
process.env.BILLING_FAKE_SECRET = "test-secret-0123456789abcdef";

const { POST } = await import("./route");
const { GET: devCheckoutGET } = await import("../dev-checkout/route");
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

describe("GET /api/billing/dev-checkout (fake provider)", () => {
  beforeAll(() => {
    session.orgId = orgId; // the caller is a member of the org being upgraded
  });

  it("403s when the signed-in member asks for someone else's org", async () => {
    session.orgId = "11111111-1111-1111-1111-111111111111";
    const res = await devCheckoutGET(new Request(
      `http://x/api/billing/dev-checkout?org=${orgId}&plan=team&interval=month&return=/billing`,
    ));
    expect(res.status).toBe(403);
    // ...and nothing was written for the org it did not own.
    const row = await admin.from("org_subscriptions").select("plan").eq("org_id", orgId).single();
    expect(row.data?.plan).toBe("pro");
    session.orgId = orgId;
  });

  it("redirects 303, resolving a relative `return` against the request instead of throwing", async () => {
    const res = await devCheckoutGET(new Request(
      `http://x/api/billing/dev-checkout?org=${orgId}&plan=pro&interval=month&return=/billing`,
    ));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/billing\?checkout=success$/);
  });

  it("does not duplicate checkout=success when `return` already carries it", async () => {
    const back = encodeURIComponent("http://x/billing?checkout=success");
    const res = await devCheckoutGET(new Request(
      `http://x/api/billing/dev-checkout?org=${orgId}&plan=pro&interval=month&return=${back}`,
    ));
    const location = res.headers.get("location")!;
    expect(location.match(/checkout=success/g)).toHaveLength(1);
  });
});
