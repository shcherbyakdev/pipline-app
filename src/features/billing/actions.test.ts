// startCheckout / openPortal at the seam with the provider: what the action
// asks the provider for (both URLs, the customer, the discount) and where it
// sends the member for each answer. Everything with I/O is mocked; the
// provider is a spy. Env is a mutable mock (dev/guard.test.ts idiom) so the
// Founder pair can be flipped per test.
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({
  NEXT_PUBLIC_APP_URL: "https://app.test",
  BILLING_PROVIDER: "stripe" as "fake" | "stripe",
  BILLING_FOUNDER_PROMO_CODE: undefined as string | undefined,
  BILLING_FOUNDER_CUTOFF: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: envMock }));

const ORG = { id: "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", name: "Co", slug: "co" };
vi.mock("@/lib/auth/session", () => ({
  requireOrg: vi.fn(async () => ({ user: { id: "u1", email: "member@example.com" }, org: ORG })),
}));
vi.mock("@/lib/flags/resolve", () => ({ getDashboardFlags: vi.fn(async () => ({ billing: true })) }));

// One row per table the actions read through the RLS client; each test sets
// what it needs. The chain mirrors what actions.ts calls, nothing more.
const tables = vi.hoisted(() => ({
  orgs: { created_at: "2026-01-01T00:00:00Z" } as Record<string, unknown> | null,
  org_subscriptions: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: keyof typeof tables) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: tables[table], error: null }) }),
      }),
    }),
  })),
}));

const queries = vi.hoisted(() => ({
  override: null as unknown,
  sub: null as unknown,
}));
vi.mock("@/lib/billing/queries", () => ({
  getPlanOverride: vi.fn(async () => queries.override),
  getRawOrgSubscription: vi.fn(async () => queries.sub),
}));

const provider = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  createPortalUrl: vi.fn(),
}));
vi.mock("@/lib/billing/provider", () => ({ selectBillingProvider: () => ({ name: "stripe", ...provider }) }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const { startCheckout, openPortal } = await import("./actions");

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  envMock.BILLING_PROVIDER = "stripe";
  envMock.BILLING_FOUNDER_PROMO_CODE = undefined;
  envMock.BILLING_FOUNDER_CUTOFF = undefined;
  tables.orgs = { created_at: "2026-01-01T00:00:00Z" };
  tables.org_subscriptions = null;
  queries.override = null;
  queries.sub = null;
  provider.createCheckout.mockReset().mockResolvedValue({ url: "https://checkout.test/cs_1", founderFallback: false });
  provider.createPortalUrl.mockReset().mockResolvedValue("https://portal.test/ps_1");
});

describe("startCheckout", () => {
  it("asks for a session with distinct success and cancel URLs, then redirects to it", async () => {
    await expect(startCheckout(form({ plan: "team", interval: "year" }))).rejects.toThrow("REDIRECT:https://checkout.test/cs_1");
    expect(provider.createCheckout).toHaveBeenCalledTimes(1);
    const input = provider.createCheckout.mock.calls[0][0];
    expect(input).toMatchObject({ orgId: ORG.id, plan: "team", interval: "year", email: "member@example.com" });
    // `plan` rides on the success URL so /billing knows which plan to wait
    // for; the cancel URL carries NO success markers — "back" from checkout
    // must not poll for a purchase that never happened.
    expect(input.returnUrl).toBe("https://app.test/billing?checkout=success&plan=team");
    expect(input.cancelUrl).toBe("https://app.test/billing?checkout=cancelled");
    expect(input.discountCode).toBeUndefined();
    expect(input.providerCustomerId).toBeUndefined();
  });

  it("a refused Founder code → ?error=founder_ended, NOT the list-price session", async () => {
    // The member was shown the Founder price; sending them to a session at
    // list price would have them pay more than the page promised.
    provider.createCheckout.mockResolvedValue({ url: "https://checkout.test/cs_list", founderFallback: true });
    await expect(startCheckout(form({ plan: "pro", interval: "month" }))).rejects.toThrow("REDIRECT:/billing?error=founder_ended");
  });

  it("founder=skip leaves the discount out, so the retry after founder_ended cannot loop", async () => {
    envMock.BILLING_FOUNDER_PROMO_CODE = "promo_founder";
    envMock.BILLING_FOUNDER_CUTOFF = "2026-09-01"; // org created 2026-01-01 → eligible
    await expect(startCheckout(form({ plan: "pro", interval: "month" }))).rejects.toThrow("REDIRECT:https://checkout.test/cs_1");
    expect(provider.createCheckout.mock.calls[0][0].discountCode).toBe("promo_founder");
    await expect(startCheckout(form({ plan: "pro", interval: "month", founder: "skip" }))).rejects.toThrow("REDIRECT:https://checkout.test/cs_1");
    expect(provider.createCheckout.mock.calls[1][0].discountCode).toBeUndefined();
    // Anything but "skip" is a hand-crafted POST: refused as malformed.
    await expect(startCheckout(form({ plan: "pro", interval: "month", founder: "please" }))).rejects.toThrow("REDIRECT:/billing?error=checkout");
  });

  it("the Founder code is monthly Pro only", async () => {
    envMock.BILLING_FOUNDER_PROMO_CODE = "promo_founder";
    envMock.BILLING_FOUNDER_CUTOFF = "2026-09-01";
    await expect(startCheckout(form({ plan: "pro", interval: "year" }))).rejects.toThrow("REDIRECT:");
    await expect(startCheckout(form({ plan: "team", interval: "month" }))).rejects.toThrow("REDIRECT:");
    for (const call of provider.createCheckout.mock.calls) expect(call[0].discountCode).toBeUndefined();
  });

  it("a resubscribe hands over the provider customer — only when THIS provider minted it", async () => {
    queries.sub = { plan: "pro", status: "expired", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    tables.org_subscriptions = { provider_customer_id: "cus_stripe_1", provider: "stripe" };
    await expect(startCheckout(form({ plan: "pro", interval: "month" }))).rejects.toThrow("REDIRECT:https://checkout.test/cs_1");
    expect(provider.createCheckout.mock.calls[0][0].providerCustomerId).toBe("cus_stripe_1");
    // A row the fake emulator wrote on a database now pointed at Stripe:
    // Stripe has never seen that customer, so let it mint a new one.
    tables.org_subscriptions = { provider_customer_id: "cus_fake_org", provider: "fake" };
    await expect(startCheckout(form({ plan: "pro", interval: "month" }))).rejects.toThrow("REDIRECT:https://checkout.test/cs_1");
    expect(provider.createCheckout.mock.calls[1][0].providerCustomerId).toBeUndefined();
  });

  it("a provider failure lands on ?error=checkout, never a stack trace", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    provider.createCheckout.mockRejectedValue(new Error("boom"));
    await expect(startCheckout(form({ plan: "pro", interval: "month" }))).rejects.toThrow("REDIRECT:/billing?error=checkout");
    error.mockRestore();
  });

  it("an org already on a paid plan is sent to the portal instead", async () => {
    queries.sub = { plan: "pro", status: "active", interval: "month", seats: 1, currentPeriodEnd: null, cancelAtPeriodEnd: false };
    await expect(startCheckout(form({ plan: "team", interval: "month" }))).rejects.toThrow("REDIRECT:/billing?error=use_portal");
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
});

describe("openPortal", () => {
  it("opens the portal for the row's customer with /billing as the return", async () => {
    tables.org_subscriptions = { provider_customer_id: "cus_stripe_1", provider: "stripe" };
    await expect(openPortal()).rejects.toThrow("REDIRECT:https://portal.test/ps_1");
    expect(provider.createPortalUrl).toHaveBeenCalledWith("cus_stripe_1", "https://app.test/billing");
  });

  it("no row → ?error=portal", async () => {
    await expect(openPortal()).rejects.toThrow("REDIRECT:/billing?error=portal");
    expect(provider.createPortalUrl).not.toHaveBeenCalled();
  });

  it("a row another provider wrote → ?error=portal (mixed-env safety)", async () => {
    // The fake emulator's customer id on a database now pointed at Stripe
    // (or the reverse): this provider has never heard of it.
    tables.org_subscriptions = { provider_customer_id: "cus_fake_org", provider: "fake" };
    await expect(openPortal()).rejects.toThrow("REDIRECT:/billing?error=portal");
    expect(provider.createPortalUrl).not.toHaveBeenCalled();
    envMock.BILLING_PROVIDER = "fake";
    await expect(openPortal()).rejects.toThrow("REDIRECT:https://portal.test/ps_1");
  });
});
