// actions.ts imports @/lib/supabase/admin, which imports @/env — env parses
// process.env eagerly at module load. Plain `npm run test` does not set the
// Supabase env vars (only the integration job does), so stub them here
// before any import runs (fake.test.ts / drain-isolation.test.ts
// precedent). A static `import ... from "./actions"` would be hoisted above
// these assignments (ES module semantics), so import it dynamically.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54351";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";

import { describe, it, expect, vi } from "vitest";

// Bypasses the allowlist/session machinery entirely — these tests are about
// the redirect URL an invalid submission produces, not about the guard
// (that's guard.ts/allowlist.test.ts's job).
vi.mock("./guard", () => ({
  requireInternal: vi.fn(async () => ({ user: { id: "u1", email: "owner@example.com" } })),
}));

// The real redirect() throws NEXT_REDIRECT; emulate the throw (auth/actions.test.ts
// idiom) so code after redirect never runs and the destination is assertable.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { grantPlanOverride, revokePlanOverride, setOrgFlag } = await import("./actions");

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

// A malformed `org` (not a UUID) must never round-trip into the redirect
// URL: readOrgAdminView's page feeds `?org=` straight to Postgres, and a
// non-UUID there crashes the page with a 500 instead of the 404 an unknown
// org gets. See page.tsx's matching `orgIdInput.safeParse` guard.

describe("grantPlanOverride: malformed org id on validation failure", () => {
  it("a non-UUID org falls back to the picker (no `org` param) rather than being echoed", async () => {
    await expect(
      grantPlanOverride(form({ org: "not-a-uuid", plan: "pro", expires: "", note: "" })),
    ).rejects.toThrow("REDIRECT:/utils/subscriptions?error=invalid");
  });

  it("a well-formed UUID with an otherwise-invalid field still redirects back to that org's panel", async () => {
    const org = "123e4567-e89b-12d3-a456-426614174000";
    await expect(
      grantPlanOverride(form({ org, plan: "bogus-plan", expires: "", note: "" })),
    ).rejects.toThrow(`REDIRECT:/utils/subscriptions?error=invalid&org=${org}`);
  });
});

describe("revokePlanOverride: malformed org id on validation failure", () => {
  it("a non-UUID org falls back to the picker (no `org` param) rather than being echoed", async () => {
    await expect(revokePlanOverride(form({ org: "abc" }))).rejects.toThrow(
      "REDIRECT:/utils/subscriptions?error=invalid",
    );
  });
});

describe("setOrgFlag: malformed org id on validation failure", () => {
  it("a non-UUID org falls back to the picker (no `org` param) rather than being echoed", async () => {
    await expect(
      setOrgFlag(form({ org: "not-a-uuid", flag: "billing", value: "on" })),
    ).rejects.toThrow("REDIRECT:/utils/flags?error=invalid");
  });

  it("a well-formed UUID with an otherwise-invalid field still redirects back to that org's panel", async () => {
    const org = "123e4567-e89b-12d3-a456-426614174000";
    await expect(
      setOrgFlag(form({ org, flag: "not-a-real-flag", value: "on" })),
    ).rejects.toThrow(`REDIRECT:/utils/flags?error=invalid&org=${org}`);
  });

  it("a well-formed UUID with an invalid value still redirects back to that org's panel", async () => {
    const org = "123e4567-e89b-12d3-a456-426614174000";
    await expect(
      setOrgFlag(form({ org, flag: "billing", value: "bogus-value" })),
    ).rejects.toThrow(`REDIRECT:/utils/flags?error=invalid&org=${org}`);
  });
});
