# Foundation: Auth & Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a thin, tenant-safe foundation — Supabase magic-link auth, an org/tenant model, the reusable RLS pattern, and a guarded app shell — that every later feature builds on.

**Architecture:** Auth via Supabase (magic link, HttpOnly cookies through `@supabase/ssr`). Every domain row carries `org_id`; Row-Level Security is the enforcement boundary. Runtime data access in this feature goes through the **Supabase client (RLS-enforced)** — Drizzle is used only for schema + migrations here (its query power is introduced later, for the relational matrix). Multi-tenancy uses a `SECURITY DEFINER` helper `user_orgs()` queried live in policies (not JWT claims — the claim approach has an onboarding chicken-and-egg, documented below). Org creation is an atomic `create_org()` `SECURITY DEFINER` RPC.

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19 (`useActionState`), TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, Drizzle (migrations), Zod, Vitest, shadcn/ui.

## Global Constraints

- **Next.js 16** — Server Components default; the request-refresh convention is `src/proxy.ts` (not `middleware.ts`).
- **Auth guards use `supabase.auth.getUser()` — NEVER `getSession()` on the server.** `getSession()` reads the cookie unverified and is spoofable. This applies to the proxy, Server Components, and Server Actions.
- **`getClaims()`** may be used later for fast local claim reads, but not for security-critical guards (it doesn't catch server-side logout/revocation). Not used in this feature.
- **RLS non-negotiables:** every tenant table has RLS enabled; every column referenced by a policy is indexed; the `service_role` key is server-only and never reaches the client.
- **SECURITY DEFINER functions set `search_path = ''`** and schema-qualify every reference (`public.`, `auth.`) — prevents search-path hijacking.
- **Feature-sliced structure:** logic lives in `src/features/<name>/`; `src/app/` stays thin. Every Server Action validates input with a Zod schema before doing anything.
- **Unit tests are co-located** as `*.test.ts` next to source (deviation from the spec's `tests/unit` — chosen for locality). Playwright e2e is deferred to the installer-flow feature.

---

## Prerequisites (one-time, user action — gates verification)

These require a live Supabase project. Task 1 needs none of them; Tasks 2–5 need them for their verification steps (code can be written first).

- [ ] **P1. Create a Supabase project** at https://supabase.com/dashboard.
- [ ] **P2. Fill `.env.local`** (copy from `.env.example`):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Project Settings → API.
  - `SUPABASE_SERVICE_ROLE_KEY` — same page (server-only; used only by the verify script).
  - `DATABASE_URL` — Project Settings → Database → **Direct connection** string (port 5432), used by drizzle-kit for DDL.
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
- [ ] **P3. Configure the magic-link email + redirects** (Dashboard → Authentication):
  - **URL Configuration** → Site URL = `http://localhost:3000`; add `http://localhost:3000/auth/confirm` to Redirect URLs.
  - **Email Templates → Magic Link** → set the link body to exactly:
    ```
    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to RolloutOS</a>
    ```
- [ ] **P4. Confirm the Email provider is enabled** (Authentication → Providers → Email; on by default).

---

## Task 1: Vitest harness + input schemas (TDD)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test` script + devDeps)
- Create: `src/features/auth/schema.ts`
- Create: `src/features/auth/schema.test.ts`
- Create: `src/features/orgs/schema.ts`
- Create: `src/features/orgs/schema.test.ts`

**Interfaces:**
- Produces:
  - `emailSchema: ZodObject` → parses `{ email: string }`; `export type AuthState = { error?: string; sent?: boolean }`
  - `createOrgSchema: ZodObject` → parses `{ name: string }` (2–80 chars trimmed); `export type OrgState = { error?: string }`

- [ ] **Step 1: Install test deps**

```bash
npm install -D vitest vite-tsconfig-paths
```

- [ ] **Step 2: Add the test script**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write the failing schema tests**

`src/features/auth/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emailSchema } from "./schema";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
  it("rejects a malformed email", () => {
    expect(emailSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
```

`src/features/orgs/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createOrgSchema } from "./schema";

describe("createOrgSchema", () => {
  it("accepts a valid name", () => {
    expect(createOrgSchema.safeParse({ name: "Acme Signage" }).success).toBe(true);
  });
  it("rejects a name shorter than 2 chars", () => {
    expect(createOrgSchema.safeParse({ name: "A" }).success).toBe(false);
  });
  it("rejects a name longer than 80 chars", () => {
    expect(createOrgSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(createOrgSchema.safeParse({ name: "  Acme  " }).data?.name).toBe("Acme");
  });
});
```

- [ ] **Step 5: Run the tests — verify they FAIL**

Run: `npm test`
Expected: FAIL — cannot resolve `./schema` (modules not created yet).

- [ ] **Step 6: Implement the schemas**

`src/features/auth/schema.ts`:

```ts
import { z } from "zod";

export const emailSchema = z.object({
  email: z.string().email(),
});

export type AuthState = { error?: string; sent?: boolean };
```

`src/features/orgs/schema.ts`:

```ts
import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export type OrgState = { error?: string };
```

- [ ] **Step 7: Run the tests — verify they PASS**

Run: `npm test`
Expected: PASS (6 tests).

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/features/auth/schema.ts src/features/auth/schema.test.ts src/features/orgs/schema.ts src/features/orgs/schema.test.ts
git commit -m "test: add vitest harness and auth/org input schemas"
```

---

## Task 2: Migrations — tables, RLS, and `create_org` RPC

**Files:**
- Verify (no change expected): `src/db/schema/orgs.ts` (already defines `orgs`, `org_members` with indexes)
- Create (generated): `src/db/migrations/0000_*.sql` (tables)
- Create (custom): `src/db/migrations/0001_foundation_rls.sql` (RLS + functions)
- Create: `scripts/verify-foundation.ts` (RLS isolation check)

**Interfaces:**
- Produces (DB objects, consumed by later tasks via the Supabase client):
  - `public.orgs(id uuid, name text, slug text, created_at timestamptz)`
  - `public.org_members(id, org_id, user_id, role, created_at)`
  - `public.user_orgs() returns setof uuid` — org IDs of `auth.uid()`
  - `public.create_org(p_name text) returns public.orgs` — atomic org + owner membership for `auth.uid()`
  - RLS: authenticated users can `select` only their orgs/memberships; no direct insert/update/delete (creation only via `create_org`).

- [ ] **Step 1: Generate the table migration**

Run: `npm run db:generate`
Expected: a `src/db/migrations/0000_*.sql` creating `orgs` and `org_members` + indexes, plus a `meta/` journal.

- [ ] **Step 2: Create the custom RLS migration file**

Create `src/db/migrations/0001_foundation_rls.sql` with:

```sql
-- Helper: the org IDs the current user belongs to. SECURITY DEFINER so it can
-- read org_members regardless of RLS (avoids policy recursion). STABLE + empty
-- search_path for safety.
create or replace function public.user_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from public.org_members where user_id = auth.uid();
$$;

grant execute on function public.user_orgs() to authenticated;

-- Enable RLS on both tenant tables.
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

-- Members may read their own orgs / memberships. No insert/update/delete
-- policies: mutations happen only through create_org() below.
create policy "orgs_select_member" on public.orgs
  for select to authenticated
  using (id in (select public.user_orgs()));

create policy "org_members_select_member" on public.org_members
  for select to authenticated
  using (org_id in (select public.user_orgs()));

-- Atomic onboarding bootstrap: create an org and the caller's owner membership.
-- SECURITY DEFINER so it can insert despite the absence of insert policies.
create or replace function public.create_org(p_name text)
returns public.orgs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.orgs;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'org';
  end if;
  -- Guarantee uniqueness without a retry loop.
  v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  insert into public.orgs (name, slug)
  values (trim(p_name), v_slug)
  returning * into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  return v_org;
end;
$$;

grant execute on function public.create_org(text) to authenticated;
```

- [ ] **Step 3: Register the custom migration in Drizzle's journal**

Custom SQL files must be listed in `src/db/migrations/meta/_journal.json` so `db:migrate` applies them. Add an entry after the generated one:

```json
{ "idx": 1, "version": "7", "when": 0, "tag": "0001_foundation_rls", "breakpoints": true }
```

(Match `version`/format of the existing entry produced in Step 1; only `idx` and `tag` differ.)

- [ ] **Step 4: Apply migrations** *(needs Prerequisites P1–P2)*

Run: `npm run db:migrate`
Expected: both migrations apply with no error. Verify in the Supabase dashboard → Database → Tables that `orgs` and `org_members` exist with RLS enabled, and → Database → Functions that `user_orgs` and `create_org` exist.

- [ ] **Step 5: Write the RLS isolation verify script**

`scripts/verify-foundation.ts`:

```ts
/**
 * Proves tenant isolation through the RLS-enforced anon client.
 * Run: npx tsx scripts/verify-foundation.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *           SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

async function makeUser(email: string) {
  await admin.auth.admin.createUser({ email, password: "Password123!", email_confirm: true });
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "Password123!" });
  if (error) throw error;
  return c;
}

async function main() {
  const a = await makeUser(`a_${Date.now()}@example.com`);
  const b = await makeUser(`b_${Date.now()}@example.com`);

  const { data: orgA, error: e1 } = await a.rpc("create_org", { p_name: "Alpha" });
  if (e1) throw e1;
  await b.rpc("create_org", { p_name: "Beta" });

  // A sees exactly one org (Alpha); cannot see Beta.
  const { data: aOrgs } = await a.from("orgs").select("id, name");
  const seesOnlyAlpha = aOrgs?.length === 1 && aOrgs[0].name === "Alpha";

  // B cannot read A's org by id.
  const { data: bTriesA } = await b.from("orgs").select("id").eq("id", (orgA as { id: string }).id);
  const bBlocked = (bTriesA?.length ?? 0) === 0;

  console.log("A sees only its own org:", seesOnlyAlpha);
  console.log("B is blocked from A's org:", bBlocked);
  if (!seesOnlyAlpha || !bBlocked) {
    console.error("RLS ISOLATION FAILED");
    process.exit(1);
  }
  console.log("RLS isolation OK");
}

main();
```

- [ ] **Step 6: Run the verify script** *(needs Prerequisites P1–P3)*

Run: `set -a && source .env.local && set +a && npx tsx scripts/verify-foundation.ts`
Expected output:
```
A sees only its own org: true
B is blocked from A's org: true
RLS isolation OK
```

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations scripts/verify-foundation.ts
git commit -m "feat(db): orgs/org_members tables, RLS, and create_org RPC"
```

---

## Task 3: Auth login flow

**Files:**
- Create: `src/lib/auth/session.ts` (partial — user helpers)
- Create: `src/features/auth/actions.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/login/login-form.tsx`
- Create: `src/app/auth/confirm/route.ts`
- Add shadcn: `input`, `label`

**Interfaces:**
- Consumes: `emailSchema`, `AuthState` (Task 1); `createClient` from `@/lib/supabase/server`; `env` from `@/env`.
- Produces:
  - `getOptionalUser(): Promise<User | null>`, `requireUser(): Promise<User>` (redirects to `/login`)
  - `sendMagicLink(prev: AuthState, form: FormData): Promise<AuthState>` (Server Action)
  - `GET /auth/confirm` route — verifies the OTP and redirects to `?next` (default `/rollouts`)

- [ ] **Step 1: Add shadcn form primitives**

```bash
npx shadcn@latest add input label -y
```

- [ ] **Step 2: Create the user session helpers**

`src/lib/auth/session.ts`:

```ts
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Always validate against the Auth server with getUser() — never getSession().
export async function getOptionalUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 3: Create the auth Server Action**

`src/features/auth/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { env } from "@/env";
import { emailSchema, type AuthState } from "./schema";

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
```

- [ ] **Step 4: Create the confirm route handler**

`src/app/auth/confirm/route.ts`:

```ts
import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/rollouts";

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
```

- [ ] **Step 5: Create the login form (client)**

`src/app/(auth)/login/login-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { sendMagicLink } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function LoginForm() {
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
    </form>
  );
}
```

- [ ] **Step 6: Create the login page (server)**

`src/app/(auth)/login/page.tsx`:

```tsx
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Sign in to RolloutOS
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          We&apos;ll email you a magic link — no password needed.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `/login` and `/auth/confirm` appear in the route list.

- [ ] **Step 8: Manual verification** *(needs Prerequisites P1–P4)*

1. `npm run dev`, open `http://localhost:3000/login`.
2. Enter your email → "Send magic link" → confirmation message shows.
3. Open the email, click the link → you're redirected to `/rollouts` (which 404s or errors until Task 5 — that's expected; the point is the session is set).
4. Confirm a session cookie exists (DevTools → Application → Cookies → `sb-*`).

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth/session.ts src/features/auth/actions.ts "src/app/(auth)" src/app/auth src/components/ui/input.tsx src/components/ui/label.tsx
git commit -m "feat(auth): magic-link login, confirm route, session helpers"
```

---

## Task 4: Onboarding (create org)

**Files:**
- Modify: `src/lib/auth/session.ts` (add org helpers)
- Create: `src/features/orgs/actions.ts`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/onboarding/onboarding-form.tsx`

**Interfaces:**
- Consumes: `createOrgSchema`, `OrgState` (Task 1); `requireUser`, `getOptionalUser` (Task 3); `create_org` RPC (Task 2).
- Produces:
  - `type Org = { id: string; name: string; slug: string }`
  - `getCurrentOrg(): Promise<Org | null>` — the caller's org via RLS-filtered select
  - `requireOrg(): Promise<{ user: User; org: Org }>` — redirects to `/login` then `/onboarding`
  - `createOrg(prev: OrgState, form: FormData): Promise<OrgState>` (Server Action; redirects to `/rollouts` on success)

- [ ] **Step 1: Add org helpers to `session.ts`**

Append to `src/lib/auth/session.ts`:

```ts
export type Org = { id: string; name: string; slug: string };

export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = await createClient();
  // RLS returns only orgs the caller belongs to; the first is their org.
  const { data } = await supabase
    .from("orgs")
    .select("id, name, slug")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function requireOrg(): Promise<{ user: User; org: Org }> {
  const user = await requireUser();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  return { user, org };
}
```

- [ ] **Step 2: Create the createOrg Server Action**

`src/features/orgs/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrgSchema, type OrgState } from "./schema";

export async function createOrg(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const parsed = createOrgSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: "Organization name must be 2–80 characters." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("create_org", { p_name: parsed.data.name });
  if (error) return { error: error.message };

  redirect("/rollouts");
}
```

- [ ] **Step 3: Create the onboarding form (client)**

`src/app/onboarding/onboarding-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { createOrg } from "@/features/orgs/actions";
import type { OrgState } from "@/features/orgs/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: OrgState = {};

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrg, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Organization name</Label>
        <Input id="name" name="name" required placeholder="Acme Signage Co." />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm">{state.error}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Create the onboarding page (server, guarded)**

`src/app/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentOrg, requireUser } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  await requireUser();
  const org = await getCurrentOrg();
  if (org) redirect("/rollouts"); // already onboarded

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your organization
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          This is your workspace for rollouts, units, and your team.
        </p>
        <OnboardingForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `/onboarding` appears in the route list.

- [ ] **Step 6: Manual verification** *(needs Prerequisites; do Task 3 login first)*

1. Signed in but with no org, visiting `/onboarding` shows the form.
2. Submit a name → redirected to `/rollouts` (still bare until Task 5).
3. In Supabase → Table editor, confirm one `orgs` row and one `org_members` row (role `owner`, your `user_id`) were created.
4. Re-visit `/onboarding` → it redirects to `/rollouts` (already onboarded).

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/session.ts src/features/orgs/actions.ts src/app/onboarding
git commit -m "feat(orgs): onboarding flow with atomic org creation"
```

---

## Task 5: Guarded app shell + end-to-end verification

**Files:**
- Modify: `src/features/auth/actions.ts` (add `signOut`)
- Create: `src/app/(dashboard)/layout.tsx`
- Create: `src/app/(dashboard)/rollouts/page.tsx` (replaces the `.gitkeep`)

**Interfaces:**
- Consumes: `requireOrg` (Task 4); `signOut` (this task).
- Produces: `signOut(): Promise<void>` (Server Action; signs out + redirects to `/login`).

- [ ] **Step 1: Add the signOut action**

Append to `src/features/auth/actions.ts`:

```ts
import { redirect } from "next/navigation";

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

(Move the `redirect` import to the top with the other imports.)

- [ ] **Step 2: Create the guarded dashboard layout**

`src/app/(dashboard)/layout.tsx`:

```tsx
import { requireOrg } from "@/lib/auth/session";
import { signOut } from "@/features/auth/actions";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { org, user } = await requireOrg();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">{org.name}</span>
        <form action={signOut} className="flex items-center gap-3">
          <span className="text-muted-foreground text-sm">{user.email}</span>
          <button type="submit" className="text-sm underline">
            Sign out
          </button>
        </form>
      </header>
      <main className="flex flex-1 flex-col p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Create the rollouts stub page**

Delete `src/app/(dashboard)/rollouts/.gitkeep`, then create `src/app/(dashboard)/rollouts/page.tsx`:

```tsx
export default function RolloutsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-xl font-semibold">No rollouts yet</h1>
      <p className="text-muted-foreground">Your rollouts will appear here.</p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors; `/rollouts` is listed as a dynamic (ƒ) route.

- [ ] **Step 5: Full end-to-end manual verification** *(needs Prerequisites)*

Run `npm run dev`, then confirm each:
1. **Guard (no session):** open an incognito window → visit `/rollouts` → redirected to `/login`.
2. **Login:** send + click magic link → lands on `/onboarding` (new user, no org).
3. **Onboarding:** create an org → lands on `/rollouts`; header shows the org name + your email.
4. **Guard (session, has org):** visit `/onboarding` → redirected to `/rollouts`.
5. **Sign out:** click "Sign out" → redirected to `/login`; re-visiting `/rollouts` redirects to `/login`.

- [ ] **Step 6: Re-run the RLS isolation check** *(needs Prerequisites)*

Run: `set -a && source .env.local && set +a && npx tsx scripts/verify-foundation.ts`
Expected: `RLS isolation OK`.

- [ ] **Step 7: Run unit tests + commit**

```bash
npm test
git add src/features/auth/actions.ts "src/app/(dashboard)"
git commit -m "feat(app): guarded dashboard shell with sign-out"
```

---

## Self-Review

**Spec coverage** (against Feature #1 design in `docs/superpowers/specs/2026-08-07-rolloutos-mvp-design.md` + the brainstorm):
- Auth (magic link, login, confirm, sign out) → Tasks 3, 5. ✅
- Org/tenant model + onboarding → Tasks 2, 4. ✅
- RLS pattern (`user_orgs()` helper, indexed columns, service-role-only, `getUser` guards) → Tasks 2, 3. ✅
- Tenant-context helpers (`requireUser`/`getCurrentOrg`/`requireOrg`) → Tasks 3, 4. ✅
- Guarded authed shell + `/rollouts` stub → Task 5. ✅
- Route shape (public `/`, authed `(dashboard)`, `/onboarding`, login → `/rollouts`) → Tasks 3–5. ✅
- Explicitly OUT (invites, org switcher, roles beyond owner, billing, SMS) → not present. ✅

**Placeholder scan:** no TBD/TODO; every code step contains full source. ✅

**Type consistency:** `AuthState`/`OrgState`/`Org` defined once and reused; `sendMagicLink`/`createOrg`/`signOut`/`requireUser`/`requireOrg`/`getCurrentOrg`/`create_org`/`user_orgs` names consistent across tasks. ✅
