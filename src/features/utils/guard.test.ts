// requireInternal: the allowlist AND a confirmed address. The allowlist
// parsing has its own tests (allowlist.test.ts); this is the gate's shape.
import { describe, it, expect, vi, beforeEach } from "vitest";

const envMock = vi.hoisted(() => ({ INTERNAL_EMAILS: "owner@example.com" as string | undefined }));
vi.mock("@/env", () => ({ env: envMock }));

const currentUser = vi.hoisted(() => ({
  value: { id: "u1", email: "owner@example.com", email_confirmed_at: "2026-08-01T00:00:00Z" } as {
    id: string; email?: string; email_confirmed_at?: string | null;
  },
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(async () => currentUser.value) }));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const { requireInternal } = await import("./guard");

beforeEach(() => {
  envMock.INTERNAL_EMAILS = "owner@example.com";
  currentUser.value = { id: "u1", email: "owner@example.com", email_confirmed_at: "2026-08-01T00:00:00Z" };
});

describe("requireInternal", () => {
  it("lets a confirmed, allowlisted user through", async () => {
    await expect(requireInternal()).resolves.toEqual({ user: expect.objectContaining({ email: "owner@example.com" }) });
  });

  it("404s an UNCONFIRMED address even when it is allowlisted", async () => {
    // Email confirmation is a per-project Supabase setting a dashboard can
    // flip; with it off, anyone could sign up as the owner's address. The
    // guard must not depend on it.
    currentUser.value.email_confirmed_at = null;
    await expect(requireInternal()).rejects.toThrow("NOT_FOUND");
    delete currentUser.value.email_confirmed_at;
    await expect(requireInternal()).rejects.toThrow("NOT_FOUND");
  });

  it("404s a confirmed address that is not on the allowlist, and everyone when it is unset", async () => {
    currentUser.value.email = "someone@example.com";
    await expect(requireInternal()).rejects.toThrow("NOT_FOUND");
    currentUser.value.email = "owner@example.com";
    envMock.INTERNAL_EMAILS = undefined;
    await expect(requireInternal()).rejects.toThrow("NOT_FOUND");
  });
});
