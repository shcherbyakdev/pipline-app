import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  getUser: vi.fn(),
  signInWithOtp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth })),
}));

// updatePassword spends the recovery-link proof cookie (next-path.ts);
// the jar is a plain in-memory map per test.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

// actions.ts imports @/env, which validates real env vars at module load.
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
}));

// The real redirect() throws NEXT_REDIRECT; emulate the throw so code
// after redirect never runs and tests can assert the destination.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

import {
  sendMagicLink,
  signInWithPassword,
  signUp,
  requestPasswordReset,
  updatePassword,
} from "./actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.clear();
});

describe("sendMagicLink", () => {
  it("maps Supabase errors to generic copy (no raw error messages)", async () => {
    auth.signInWithOtp.mockResolvedValue({
      error: { message: "rate limit exceeded" },
    });
    const state = await sendMagicLink({}, form({ email: "a@b.com" }));
    expect(state.error).toBe("Could not send the link. Try again shortly.");
  });
});

describe("signInWithPassword", () => {
  it("returns a validation error without calling Supabase on bad input", async () => {
    const state = await signInWithPassword({}, form({ email: "nope", password: "" }));
    expect(state.error).toBe("Enter a valid email and password.");
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("maps any auth failure to generic copy (no raw Supabase message)", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    const state = await signInWithPassword(
      {},
      form({ email: "a@b.com", password: "wrong-pass" }),
    );
    expect(state.error).toBe("Invalid email or password.");
  });

  it("redirects to /bookings on success", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      signInWithPassword({}, form({ email: "a@b.com", password: "right-pass" })),
    ).rejects.toThrow("REDIRECT:/bookings");
  });

  it("honours a same-site `next` and refuses anything else", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      signInWithPassword({}, form({ email: "a@b.com", password: "p", next: "/settings?tab=1" })),
    ).rejects.toThrow("REDIRECT:/settings?tab=1");
    for (const bad of ["//evil.com", "https://evil.com/x", "/login", "/\\evil.com"]) {
      await expect(
        signInWithPassword({}, form({ email: "a@b.com", password: "p", next: bad })),
      ).rejects.toThrow("REDIRECT:/bookings");
    }
  });
});

describe("signUp", () => {
  it("surfaces the password policy message on short passwords", async () => {
    const state = await signUp({}, form({ email: "a@b.com", password: "short" }));
    expect(state.error).toBe("Password must be at least 8 characters.");
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("returns sent and passes emailRedirectTo on success", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    const state = await signUp({}, form({ email: "a@b.com", password: "12345678" }));
    expect(state).toEqual({ sent: true });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "12345678",
      options: { emailRedirectTo: "http://localhost:3000/auth/confirm" },
    });
  });

  it("maps Supabase errors to generic copy", async () => {
    auth.signUp.mockResolvedValue({ error: { message: "boom" } });
    const state = await signUp({}, form({ email: "a@b.com", password: "12345678" }));
    expect(state.error).toBe("Could not create your account. Try again.");
  });

  it("stores a claimed handle as user metadata", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    await signUp({}, form({ email: "a@b.com", password: "longenough", handle: "anna" }));
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ data: { claimed_handle: "anna" } }),
      }),
    );
  });
  it("sends no metadata when no handle was claimed", async () => {
    auth.signUp.mockResolvedValue({ error: null });
    await signUp({}, form({ email: "a@b.com", password: "longenough" }));
    const call = auth.signUp.mock.calls[0][0];
    expect(call.options.data).toBeUndefined();
  });
});

describe("requestPasswordReset", () => {
  it("returns sent even when Supabase reports an error (anti-enumeration)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const state = await requestPasswordReset({}, form({ email: "a@b.com" }));
    expect(state).toEqual({ sent: true });
    consoleErrorSpy.mockRestore();
  });

  it("rejects an invalid email before calling Supabase", async () => {
    const state = await requestPasswordReset({}, form({ email: "nope" }));
    expect(state.error).toBe("Enter a valid email address.");
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});

describe("updatePassword", () => {
  it("redirects to /login when there is no session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(
      updatePassword({}, form({ password: "12345678", confirm: "12345678" })),
    ).rejects.toThrow("REDIRECT:/login");
  });

  it("returns the mismatch message when confirmation differs", async () => {
    const state = await updatePassword(
      {},
      form({ password: "12345678", confirm: "12345679" }),
    );
    expect(state.error).toBe("Passwords don't match.");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuses a session that did not come from a recovery link", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const state = await updatePassword({}, form({ password: "12345678", confirm: "12345678" }));
    expect(state.error).toMatch(/reset link has expired/);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("updates, spends the recovery proof and redirects to /bookings on success", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.updateUser.mockResolvedValue({ error: null });
    jar.set("booklo_recovery", "1");
    await expect(
      updatePassword({}, form({ password: "12345678", confirm: "12345678" })),
    ).rejects.toThrow("REDIRECT:/bookings");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(jar.has("booklo_recovery")).toBe(false);
  });

  it("maps update failures to generic copy", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    jar.set("booklo_recovery", "1");
    auth.updateUser.mockResolvedValue({ error: { message: "boom" } });
    const state = await updatePassword(
      {},
      form({ password: "12345678", confirm: "12345678" }),
    );
    expect(state.error).toBe(
      "Could not update your password. Request a new reset link.",
    );
  });
});

describe("signUp error codes", () => {
  it("names a rejected (leaked/common) password and the rate limit; everything else stays generic", async () => {
    auth.signUp.mockResolvedValueOnce({ error: { code: "weak_password", message: "x" } });
    expect((await signUp({}, form({ email: "a@b.com", password: "password1" }))).error).toMatch(/data breach/);
    auth.signUp.mockResolvedValueOnce({ error: { code: "over_request_rate_limit", message: "x" } });
    expect((await signUp({}, form({ email: "a@b.com", password: "password1" }))).error).toMatch(/Too many attempts/);
    auth.signUp.mockResolvedValueOnce({ error: { code: "user_already_exists", message: "x" } });
    expect((await signUp({}, form({ email: "a@b.com", password: "password1" }))).error).toBe(
      "Could not create your account. Try again.",
    );
  });
});
