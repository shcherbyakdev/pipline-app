# Email + Password Auth with Reset Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email+password sign-in, a password signup page, and an email-based password reset flow alongside the existing magic-link auth.

**Architecture:** Extend the existing server-action auth pattern — new zod schemas and server actions in `src/features/auth/`, new pages in the `src/app/(auth)/` route group, reuse of the existing `/auth/confirm` token-hash route, and Supabase config/template changes. No browser Supabase client.

**Tech Stack:** Next.js 16.3 (App Router, server actions, `proxy.ts` convention), @supabase/ssr, zod, Vitest, local Supabase (Mailpit at `:54354`).

**Spec:** `docs/superpowers/specs/2026-08-12-password-auth-design.md`

## Global Constraints

- Branch: `feat/password-auth` off `main` (create via superpowers:using-git-worktrees at execution start).
- `npm run verify` (eslint + `next typegen && tsc --noEmit` + `vitest run`) must pass before every commit.
- Enumeration-safe copy, verbatim from the spec:
  - Login failure: `Invalid email or password.`
  - Signup success: `Check your email to confirm your account.`
  - Forgot-password result (always): `If an account exists for that address, you'll receive a password reset link.`
  - Expired/invalid confirm link (login page, `?error=auth`): `That link is invalid or has expired — request a new one.`
- Password policy: min 8 chars, no composition rules (NIST — length over complexity). **Sign-in validates presence only** so pre-policy 6-char passwords can still log in.
- Never return raw Supabase auth error messages to the UI.
- All new pages live in `src/app/(auth)/`; all actions in `src/features/auth/actions.ts` using the existing `(prev: AuthState, formData: FormData) => Promise<AuthState>` + `useActionState` pattern.
- Next.js 16: page `searchParams` is a `Promise` and must be awaited; route gating is per-page (`requireUser`), not in `proxy.ts` — do not touch `proxy.ts`.
- This repo's Next.js may differ from training data — check `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` and `forms.md` if any server-action behavior surprises you.
- After modifying code, run `graphify update .` (AGENTS/CLAUDE convention).

---

### Task 1: Auth schemas

**Files:**
- Modify: `src/features/auth/schema.ts`
- Test: `src/features/auth/schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 2):
  - `signInSchema: z.ZodObject` — `{ email: string; password: string /* min 1 */ }`
  - `signUpSchema: z.ZodObject` — `{ email: string; password: string /* min 8 */ }`
  - `newPasswordSchema` — `{ password: string /* min 8 */; confirm: string }` with cross-field match refinement (error on path `confirm`: `Passwords don't match.`)
  - Existing `emailSchema` and `AuthState` unchanged.

- [ ] **Step 1: Write the failing tests** — append to `src/features/auth/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emailSchema,
  signInSchema,
  signUpSchema,
  newPasswordSchema,
} from "./schema";

// (keep the existing emailSchema describe block as-is)

describe("signInSchema", () => {
  it("accepts a valid email with any non-empty password", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "short1" }).success,
    ).toBe(true);
  });
  it("rejects an empty password", () => {
    expect(
      signInSchema.safeParse({ email: "a@b.com", password: "" }).success,
    ).toBe(false);
  });
  it("rejects a malformed email", () => {
    expect(
      signInSchema.safeParse({ email: "nope", password: "whatever1" }).success,
    ).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.com", password: "1234567" }).success,
    ).toBe(false);
  });
  it("accepts passwords of 8+ characters", () => {
    expect(
      signUpSchema.safeParse({ email: "a@b.com", password: "12345678" })
        .success,
    ).toBe(true);
  });
});

describe("newPasswordSchema", () => {
  it("rejects a mismatched confirmation", () => {
    const result = newPasswordSchema.safeParse({
      password: "12345678",
      confirm: "12345679",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Passwords don't match.");
    }
  });
  it("rejects passwords shorter than 8 characters even when matching", () => {
    expect(
      newPasswordSchema.safeParse({ password: "1234567", confirm: "1234567" })
        .success,
    ).toBe(false);
  });
  it("accepts a matching 8+ character pair", () => {
    expect(
      newPasswordSchema.safeParse({ password: "12345678", confirm: "12345678" })
        .success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/auth/schema.test.ts`
Expected: FAIL — `signInSchema` (etc.) not exported.

- [ ] **Step 3: Implement the schemas** — replace `src/features/auth/schema.ts` with:

```ts
import { z } from "zod";

export const emailSchema = z.object({
  email: z.string().email(),
});

// Sign-in validates presence only — the signup policy must not lock out
// accounts created before the 8-char minimum.
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Signup + reset enforce the policy: length over composition rules (NIST).
// Mirrors minimum_password_length = 8 in supabase/config.toml.
export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match.",
    path: ["confirm"],
  });

export type AuthState = { error?: string; sent?: boolean };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/auth/schema.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add src/features/auth/schema.ts src/features/auth/schema.test.ts
git commit -m "feat(auth): schemas for password sign-in, signup, and reset"
```

---

### Task 2: Password auth server actions

**Files:**
- Modify: `src/features/auth/actions.ts`
- Create: `src/features/auth/actions.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas; `createClient` from `@/lib/supabase/server`; `env.NEXT_PUBLIC_APP_URL`.
- Produces (used by Tasks 3–6): server actions, all `(prev: AuthState, formData: FormData) => Promise<AuthState>`:
  - `signInWithPassword` — reads form fields `email`, `password`; redirects to `/programs` on success.
  - `signUp` — reads `email`, `password`; returns `{ sent: true }`.
  - `requestPasswordReset` — reads `email`; always returns `{ sent: true }` after validation.
  - `updatePassword` — reads `password`, `confirm`; redirects to `/login` when unauthenticated, `/programs` on success.
  - Existing `sendMagicLink`, `signOut` unchanged.

- [ ] **Step 1: Write the failing tests** — create `src/features/auth/actions.test.ts`:

```ts
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
    auth.resetPasswordForEmail.mockResolvedValue({
      error: { message: "User not found" },
    });
    const state = await requestPasswordReset({}, form({ email: "a@b.com" }));
    expect(state).toEqual({ sent: true });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/auth/actions.test.ts`
Expected: FAIL — `signInWithPassword` (etc.) not exported from `./actions`.

- [ ] **Step 3: Implement the actions** — replace `src/features/auth/actions.ts` with:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/env";
import {
  emailSchema,
  signInSchema,
  signUpSchema,
  newPasswordSchema,
  type AuthState,
} from "./schema";

export async function sendMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });

  if (error) return { error: error.message };
  return { sent: true };
}

export async function signInWithPassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Generic on purpose: raw Supabase messages distinguish unknown accounts
  // from unconfirmed ones, which leaks account existence.
  if (error) return { error: "Invalid email or password." };
  redirect("/programs");
}

export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Enter a valid email and password.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm` },
  });

  if (error) return { error: "Could not create your account. Try again." };
  // Existing emails get an obfuscated user (no error) from Supabase when
  // confirmations are on, so this copy never reveals account existence.
  return { sent: true };
}

export async function requestPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  // The recovery template hardcodes next=/reset-password; redirectTo only
  // feeds {{ .RedirectTo }}, kept for hosted-template parity.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm?next=/reset-password`,
  });

  // Always report success — errors here would reveal account existence.
  return { sent: true };
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Enter a valid password.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: "Could not update your password. Request a new reset link." };
  }
  redirect("/programs");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/auth/actions.test.ts`
Expected: PASS (all four describe blocks).

- [ ] **Step 5: Verify and commit**

```bash
npm run verify
git add src/features/auth/actions.ts src/features/auth/actions.test.ts
git commit -m "feat(auth): password sign-in, signup, reset, and update actions"
```

---

### Task 3: Login page rework (password primary, magic link secondary)

**Files:**
- Modify: `src/app/(auth)/login/login-form.tsx`
- Modify: `src/app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: `signInWithPassword`, `sendMagicLink` from `@/features/auth/actions`.
- Produces: `/login` renders the password form by default with a client-side toggle to the magic-link form; shows the expired-link message for `?error=auth`; links to `/signup` and `/forgot-password`.

- [ ] **Step 1: Rewrite the form component** — replace `src/app/(auth)/login/login-form.tsx` with:

```tsx
"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { sendMagicLink, signInWithPassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function LoginForm() {
  const [mode, setMode] = useState<"password" | "magic">("password");
  return mode === "password" ? (
    <PasswordForm onSwitch={() => setMode("magic")} />
  ) : (
    <MagicLinkForm onSwitch={() => setMode("password")} />
  );
}

function PasswordForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
        />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link
            href="/forgot-password"
            className="text-muted-foreground text-xs hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <button
        type="button"
        onClick={onSwitch}
        className="text-muted-foreground text-sm hover:underline"
      >
        Email me a magic link instead
      </button>
    </form>
  );
}

function MagicLinkForm({ onSwitch }: { onSwitch: () => void }) {
  const [state, action, pending] = useActionState(sendMagicLink, initial);

  if (state.sent) {
    return (
      <p className="text-sm">Check your email for a magic link to sign in.</p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send magic link"}
      </Button>
      <button
        type="button"
        onClick={onSwitch}
        className="text-muted-foreground text-sm hover:underline"
      >
        Sign in with a password instead
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Rewrite the page** — replace `src/app/(auth)/login/page.tsx` with:

```tsx
import Link from "next/link";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Sign in to RolloutOS
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          Use your email and password, or get a magic link.
        </p>
        {error === "auth" ? (
          <p className="text-destructive mb-4 text-sm">
            That link is invalid or has expired — request a new one.
          </p>
        ) : null}
        <LoginForm />
        <p className="text-muted-foreground mt-6 text-sm">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-foreground hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS. (`/signup` and `/forgot-password` links 404 until Tasks 4–5 — that's fine; they land in this branch before the PR.)

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev`, open `http://localhost:3000/login`.
Expected: password form with Forgot-password link; toggle swaps to magic-link form and back; `http://localhost:3000/login?error=auth` shows the expired-link message.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(auth)/login/login-form.tsx" "src/app/(auth)/login/page.tsx"
git commit -m "feat(auth): password-first login page with magic-link toggle"
```

---

### Task 4: Signup page

**Files:**
- Create: `src/app/(auth)/signup/page.tsx`
- Create: `src/app/(auth)/signup/signup-form.tsx`

**Interfaces:**
- Consumes: `signUp` from `@/features/auth/actions`.
- Produces: `/signup` — email + password form; success state always shows the check-your-email copy.

- [ ] **Step 1: Create the form** — `src/app/(auth)/signup/signup-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { signUp } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, initial);

  if (state.sent) {
    return <p className="text-sm">Check your email to confirm your account.</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create the page** — `src/app/(auth)/signup/page.tsx`:

```tsx
import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your RolloutOS account
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;ll confirm your email before signing in.
        </p>
        <SignupForm />
        <p className="text-muted-foreground mt-6 text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/signup"
git commit -m "feat(auth): signup page with email confirmation gate"
```

---

### Task 5: Forgot-password page

**Files:**
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/forgot-password/forgot-password-form.tsx`

**Interfaces:**
- Consumes: `requestPasswordReset` from `@/features/auth/actions`.
- Produces: `/forgot-password` — email form; success always shows the enumeration-safe copy.

- [ ] **Step 1: Create the form** — `src/app/(auth)/forgot-password/forgot-password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  if (state.sent) {
    return (
      <p className="text-sm">
        If an account exists for that address, you&apos;ll receive a password
        reset link.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create the page** — `src/app/(auth)/forgot-password/page.tsx`:

```tsx
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          We&apos;ll email you a link to set a new one.
        </p>
        <ForgotPasswordForm />
        <p className="text-muted-foreground mt-6 text-sm">
          <Link href="/login" className="text-foreground hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/forgot-password"
git commit -m "feat(auth): forgot-password page with enumeration-safe copy"
```

---

### Task 6: Reset-password page (authenticated)

**Files:**
- Create: `src/app/(auth)/reset-password/page.tsx`
- Create: `src/app/(auth)/reset-password/reset-password-form.tsx`

**Interfaces:**
- Consumes: `updatePassword` from `@/features/auth/actions`; `requireUser` from `@/lib/auth/session`.
- Produces: `/reset-password` — requires a session (recovery link creates one via `/auth/confirm`); unauthenticated visitors are redirected to `/login` by `requireUser`.

- [ ] **Step 1: Create the form** — `src/app/(auth)/reset-password/reset-password-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { updatePassword } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
        <p className="text-muted-foreground text-xs">At least 8 characters.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create the page** — `src/app/(auth)/reset-password/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage() {
  await requireUser();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;re signed in via your reset link — choose a new password.
        </p>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS. Also confirm manually that `http://localhost:3000/reset-password` while signed out redirects to `/login`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/reset-password"
git commit -m "feat(auth): reset-password page behind requireUser"
```

---

### Task 7: Supabase config and email templates

**Files:**
- Modify: `supabase/config.toml` (password length, confirmations, template wiring)
- Create: `supabase/templates/confirmation.html`
- Create: `supabase/templates/recovery.html`

**Interfaces:**
- Consumes: existing `/auth/confirm` route (verifies `token_hash` + `type`, honors same-origin `next`).
- Produces: signup-confirmation and recovery emails whose links flow through `/auth/confirm`; local auth policy min 8 chars + required email confirmation.

- [ ] **Step 1: Edit `supabase/config.toml`**

In `[auth]`, change:

```toml
minimum_password_length = 8
```

In `[auth.email]`, change:

```toml
enable_confirmations = true
```

After the existing `[auth.email.template.magic_link]` block, add:

```toml
# Signup confirmation → same /auth/confirm token_hash route; type=email
# matches the magic-link convention and current Supabase docs.
[auth.email.template.confirmation]
subject = "Confirm your RolloutOS account"
content_path = "./supabase/templates/confirmation.html"

# Password recovery → /auth/confirm verifies, then next= lands on the
# authenticated reset page.
[auth.email.template.recovery]
subject = "Reset your RolloutOS password"
content_path = "./supabase/templates/recovery.html"
```

- [ ] **Step 2: Create `supabase/templates/confirmation.html`**

```html
<h2>Confirm your RolloutOS account</h2>
<p>Click the link below to confirm your email address. It expires in 1 hour.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a>
</p>
```

- [ ] **Step 3: Create `supabase/templates/recovery.html`**

```html
<h2>Reset your RolloutOS password</h2>
<p>Click the link below to set a new password. It expires in 1 hour.</p>
<p>
  <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset your password</a>
</p>
```

- [ ] **Step 4: Restart local Supabase to apply config**

Run: `npm run supabase:stop && npm run supabase:start`
Expected: stack restarts cleanly (ports are shifted +30 in this project; Mailpit is at `http://localhost:54354`).

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/templates/confirmation.html supabase/templates/recovery.html
git commit -m "feat(auth): password policy 8+, signup confirmations, reset/confirm email templates"
```

---

### Task 8: End-to-end verification and PR

**Files:** none (verification + PR).

- [ ] **Step 1: Full local walkthrough via Mailpit** (`npm run dev`, Mailpit at `http://localhost:54354`)

1. **Signup:** `/signup` with a fresh email + 8-char password → "Check your email to confirm your account." → open Mailpit → "Confirm your RolloutOS account" → click link → lands on `/programs` (or `/onboarding` for a new org-less user).
2. **Password login:** sign out → `/login` → email + password → lands on `/programs`. Wrong password → "Invalid email or password."
3. **Magic link still works:** `/login` → toggle → send link → Mailpit → click → signed in.
4. **Reset:** sign out → `/login` → "Forgot password?" → submit email → enumeration-safe copy shown → Mailpit → "Reset your RolloutOS password" → click → `/reset-password` → mismatched pair shows "Passwords don't match." → matching 8+ pair → redirected to `/programs` → sign out → old password fails, new password works.
5. **Unknown email reset:** `/forgot-password` with an unregistered address → same success copy, no email in Mailpit.
6. **Expired/invalid link:** open a stale `token_hash` URL (e.g. re-click the used recovery link) → `/login?error=auth` shows "That link is invalid or has expired — request a new one."

- [ ] **Step 2: Full verify + graph update**

```bash
npm run verify
graphify update .
```

Expected: verify passes; graph refreshed.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/password-auth
gh pr create --title "feat: email/password auth + reset flow (alongside magic link)" --body "$(cat <<'EOF'
## Summary
- Password sign-in as the primary login path; magic link kept as a toggle
- /signup with required email confirmation (enumeration-safe copy)
- /forgot-password → recovery email → /reset-password (session-gated) flow
- Auth hardening: min password length 8, signup confirmations on, generic credential errors

Spec: docs/superpowers/specs/2026-08-12-password-auth-design.md

## Production follow-ups (dashboard, not config.toml)
- Enable leaked-password protection (HIBP) on the hosted project
- Mirror the confirmation/recovery templates + custom SMTP in the dashboard

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Final task** — use superpowers:finishing-a-development-branch to decide merge/next steps.
