// dismissWelcome at its seams: the cookie it writes (name, value, options)
// and that it writes nothing without an org. The jar is an in-memory map
// (auth/actions.test.ts idiom).
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({ NEXT_PUBLIC_APP_URL: "https://app.test" }));
vi.mock("@/env", () => ({ env: envMock }));

const ORG = { id: "0f2a6b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b", name: "Co", slug: "co" };
const session = vi.hoisted(() => ({ getCurrentOrg: vi.fn() }));
vi.mock("@/lib/auth/session", () => session);

type SetOpts = Record<string, unknown>;
const jar = vi.hoisted(() => new Map<string, { value: string; opts: SetOpts }>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)!.value } : undefined),
    set: (name: string, value: string, opts: SetOpts) => void jar.set(name, { value, opts }),
  }),
}));

import { dismissWelcome } from "./setup-actions";
import { SETUP_DISMISSED_COOKIE, SETUP_DISMISSED_MAX_AGE } from "./setup-checklist";

beforeEach(() => {
  jar.clear();
  session.getCurrentOrg.mockReset();
  envMock.NEXT_PUBLIC_APP_URL = "https://app.test";
});

describe("dismissWelcome", () => {
  it("stamps the org id in a long-lived httpOnly cookie", async () => {
    session.getCurrentOrg.mockResolvedValue(ORG);
    await dismissWelcome();
    const c = jar.get(SETUP_DISMISSED_COOKIE);
    expect(c?.value).toBe(ORG.id);
    expect(c?.opts).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: SETUP_DISMISSED_MAX_AGE });
  });
  it("is a plain cookie on http (local dev)", async () => {
    envMock.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    session.getCurrentOrg.mockResolvedValue(ORG);
    await dismissWelcome();
    expect(jar.get(SETUP_DISMISSED_COOKIE)?.opts.secure).toBe(false);
  });
  it("writes nothing without an org", async () => {
    session.getCurrentOrg.mockResolvedValue(null);
    await dismissWelcome();
    expect(jar.size).toBe(0);
  });
});
