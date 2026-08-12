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

  it("redirects to /programs on success", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(
      signInWithPassword({}, form({ email: "a@b.com", password: "right-pass" })),
    ).rejects.toThrow("REDIRECT:/programs");
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

  it("updates and redirects to /programs on success", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    auth.updateUser.mockResolvedValue({ error: null });
    await expect(
      updatePassword({}, form({ password: "12345678", confirm: "12345678" })),
    ).rejects.toThrow("REDIRECT:/programs");
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "12345678" });
  });

  it("maps update failures to generic copy", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
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
