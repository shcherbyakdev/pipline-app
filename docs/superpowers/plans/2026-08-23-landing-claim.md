# Landing Redesign + Claim-Your-Page Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A light, minimal landing page whose only call to action is "booklo.co/ your-name → Claim", flowing through signup into a one-step onboarding that creates the org with its handle and timezone, with the public page answering at the root (`/anna`).

**Architecture:** The handle domain (regex, reserved list, normaliser, suggestions) becomes one pure module mirrored by a SQL `reserved_handles()` function, with a parity test so the two can't drift. A public `is_handle_available` RPC backs a `checkHandle` server action used by both the landing claim bar and the onboarding form. The chosen handle rides from `/signup?handle=` to onboarding as Supabase user metadata. The `/book/[handle]` pages move to `/[handle]`; `/book/…` becomes a permanent redirect. The landing is rebuilt from the spec's component list on a light `.marketing` token block.

**Tech Stack:** Next.js 16.3 App Router (server components, server actions, `PageProps<>` typegen, `permanentRedirect`), React 19 (`useActionState`, `useTransition`), Supabase (RLS, `security definer` RPCs, `user_metadata`), Drizzle custom migrations, zod 4, Vitest (unit + serial integration against local Supabase), Tailwind 4 + shadcn tokens, lucide-react (marketing), Hugeicons (app).

**Spec:** `docs/superpowers/specs/2026-08-23-landing-claim-design.md`

## Global Constraints

- Handle rule everywhere: `^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$` (DB CHECK `orgs_handle_format_check`, `HANDLE_RE`). 3–50 characters.
- Reserved handles: the list in spec §4.1 — identical in `reserved_handles()` (SQL) and `RESERVED_HANDLES` (TS); a unit test reads the migration and asserts set equality.
- Marketing copy must not contain any `FORBIDDEN_COPY` word (`google`, `calendar sync`, `stripe`, `payment`); `site.test.ts` enforces it over every copy key.
- Landing components use design tokens only — never `dark:` utilities, never raw hex outside `globals.css` and the mockup's traffic lights.
- No third-party runtime assets on the landing (no external fonts, images, scripts). Switzer + Fragment Mono stay.
- Every new SQL function: `revoke all … from public, anon, authenticated, service_role;` then the narrowest `grant execute` (see `supabase-grants-convention`). `anon` gets exactly one thing: `is_handle_available(text)`.
- Migrations are idempotent (`create or replace`), numbered **0047**, created with `npx drizzle-kit generate --custom --name=handles` so `meta/_journal.json` and the snapshot are consistent.
- Only error copy clients see: `GENERIC_WRITE_ERROR` ("Couldn't save. Try again.") or the specific strings named in this plan. Raw errors go to `console.error`.
- Commands: `npm run verify` (lint + typecheck + unit), `npm run test:integration` (needs `supabase start` + `npm run db:migrate`; local ports are shifted +30, see memory), single file `npx vitest run <path>` / `npx vitest run --config vitest.integration.config.ts <path>`.
- Unit tests live in `*.test.ts` only (the unit config doesn't collect `.tsx`); component behaviour is verified in the final manual-QA task.
- Commit after every task. Never `git stash` (shared stash stack — see environment notes).

## Deviations from the spec (decided while planning, all cosmetic)

- Helpers live in a new `src/features/scheduling/handle.ts` (pure, own test) instead of inside `schema.ts`; `schema.ts` re-exports `HANDLE_RE` so existing importers (`rentals/schema.ts`) are untouched.
- `suggestHandle` is named `suggestHandles` (it returns an array).
- `bookingUrl(appUrl, handle, staffSlug?)` takes the app URL as a parameter (matches the existing `appUrl` prop convention and keeps the module env-free/testable) rather than reading `env` itself.
- `create_org_with_page` calls `public.create_org(p_name)` rather than copying its body — same transaction, no duplicated SQL.
- The `/book/[handle]` implementation **moves** to `/[handle]` (`git mv`) and `/book/…` becomes the redirect; re-exporting from a file that itself redirects isn't possible.
- `checkHandle` uses `createAnonServerClient()` (cookie-less) — it's a public check, nobody's session is needed.

---

## File map

| File | Responsibility |
|---|---|
| `src/features/scheduling/handle.ts` (+ `.test.ts`) | `HANDLE_RE`, `RESERVED_HANDLES`, `isReservedHandle`, `normalizeHandle`, `toDisplayName`, `suggestHandles` |
| `src/features/scheduling/schema.ts` | re-export `HANDLE_RE`; `schedulingSettingsInput` rejects reserved |
| `src/db/migrations/0047_handles.sql` | `reserved_handles()`, `is_handle_available()`, `update_org_scheduling` (reserved check), `create_org_with_page()` |
| `src/features/scheduling/handles.integration.test.ts` | RPC behaviour as anon/owner |
| `src/features/scheduling/handle-actions.ts` (+ `.test.ts`) | `checkHandle` server action |
| `src/features/scheduling/use-handle-check.ts` | debounced client hook over `checkHandle` |
| `src/lib/booking/url.ts` (+ `.test.ts`) | `bookingPath`, `bookingUrl`, `hostLabel`; `/book/` literal guard |
| `src/app/[handle]/{layout,page}.tsx`, `src/app/[handle]/[staffSlug]/page.tsx` | the public page (moved) |
| `src/app/book/[handle]/page.tsx`, `src/app/book/[handle]/[staffSlug]/page.tsx` | 308 redirects |
| `src/features/auth/schema.ts`, `actions.ts`, `src/app/(auth)/signup/*` | handle → `user_metadata.claimed_handle` |
| `src/features/orgs/schema.ts`, `actions.ts` | `createOrgWithPageSchema`, `createOrgWithPage` |
| `src/app/onboarding/page.tsx`, `onboarding-form.tsx` | one-step "Claim your page" |
| `src/features/scheduling/components/welcome-banner.tsx`, `src/app/(dashboard)/bookings/page.tsx` | post-onboarding banner |
| `src/app/globals.css` | light `.marketing` tokens, `--highlight`, keyframes |
| `src/features/marketing/site.ts` (+ `.test.ts`) | all landing/onboarding/welcome copy |
| `src/features/marketing/components/marketing-button.ts` | pill buttons |
| `.../marketing-nav.tsx` | nav + mobile dropdown |
| `.../claim-bar.tsx` | the input + Claim button + status line |
| `.../browser-frame.tsx` | `ScaledFrame` + browser chrome |
| `.../mocks/booking-page-mock.tsx` | static public-page mock |
| `.../hero.tsx`, `how-it-works.tsx`, `final-cta.tsx`, `src/app/(marketing)/page.tsx` | page composition |

---

### Task 1: Handle helpers (pure module)

**Files:**
- Create: `src/features/scheduling/handle.ts`
- Create: `src/features/scheduling/handle.test.ts`
- Modify: `src/features/scheduling/schema.ts:12` (HANDLE_RE definition → re-export) and `:65-74` (`schedulingSettingsInput`)
- Modify: `src/features/scheduling/schema.test.ts` (one new case)

**Interfaces:**
- Produces:
  - `HANDLE_RE: RegExp`, `HANDLE_MAX = 50`
  - `RESERVED_HANDLES: readonly string[]`
  - `isReservedHandle(h: string): boolean`
  - `normalizeHandle(raw: string): string` — lowercase, diacritics stripped, spaces/underscores → `-`, other chars dropped, runs of `-` collapsed, no leading `-`, ≤ 50. May end in `-` (typing in progress).
  - `toDisplayName(handle: string): string` — `anna-studio` → `Anna Studio`
  - `suggestHandles(handle: string): string[]` — up to 4 legal candidates in order `-studio`, `-booking`, `-2`, `-3`

- [ ] **Step 1: Write the failing tests**

`src/features/scheduling/handle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  HANDLE_RE,
  HANDLE_MAX,
  RESERVED_HANDLES,
  isReservedHandle,
  normalizeHandle,
  toDisplayName,
  suggestHandles,
} from "./handle";

describe("normalizeHandle", () => {
  it("lowercases and swaps spaces/underscores for dashes", () => {
    expect(normalizeHandle("Anna Studio")).toBe("anna-studio");
    expect(normalizeHandle("anna_studio")).toBe("anna-studio");
  });
  it("strips diacritics and anything outside [a-z0-9-]", () => {
    expect(normalizeHandle("Müller & Söhne!")).toBe("muller-sohne");
  });
  it("collapses dash runs and drops a leading dash, keeps a trailing one while typing", () => {
    expect(normalizeHandle("--anna--b")).toBe("anna-b");
    expect(normalizeHandle("anna-")).toBe("anna-");
  });
  it("caps at HANDLE_MAX", () => {
    expect(normalizeHandle("a".repeat(80))).toHaveLength(HANDLE_MAX);
  });
  it("output always satisfies HANDLE_RE once 3+ chars and not dash-terminated", () => {
    for (const raw of ["Anna", "anna b", "ANNA_B_C", "x y z"]) expect(HANDLE_RE.test(normalizeHandle(raw))).toBe(true);
  });
});

describe("toDisplayName", () => {
  it("title-cases dash-separated words", () => {
    expect(toDisplayName("anna-studio")).toBe("Anna Studio");
    expect(toDisplayName("anna")).toBe("Anna");
    expect(toDisplayName("")).toBe("");
  });
});

describe("suggestHandles", () => {
  it("offers suffixed candidates in order, all legal", () => {
    expect(suggestHandles("anna")).toEqual(["anna-studio", "anna-booking", "anna-2", "anna-3"]);
    for (const s of suggestHandles("anna")) expect(HANDLE_RE.test(s)).toBe(true);
  });
  it("trims the base so suffixed candidates stay within HANDLE_MAX", () => {
    const long = "a".repeat(HANDLE_MAX);
    for (const s of suggestHandles(long)) {
      expect(s.length).toBeLessThanOrEqual(HANDLE_MAX);
      expect(HANDLE_RE.test(s)).toBe(true);
    }
  });
  it("normalises its input first", () => {
    expect(suggestHandles("Anna-")[0]).toBe("anna-studio");
  });
});

describe("reserved handles", () => {
  it("includes every top-level app route and rejects them", () => {
    for (const h of ["login", "signup", "book", "bookings", "pricing", "api", "p", "utils"]) {
      expect(isReservedHandle(h), h).toBe(true);
    }
    expect(isReservedHandle("anna")).toBe(false);
  });
  it("every reserved word is itself a legal handle shape (otherwise the DB CHECK already rejects it)", () => {
    for (const h of RESERVED_HANDLES) expect(HANDLE_RE.test(h), h).toBe(true);
  });
  it("has no duplicates", () => {
    expect(new Set(RESERVED_HANDLES).size).toBe(RESERVED_HANDLES.length);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/scheduling/handle.test.ts`
Expected: FAIL — `Cannot find module './handle'`.

- [ ] **Step 3: Write the module**

`src/features/scheduling/handle.ts`:

```ts
// The booking-page handle: booklo.co/<handle>. One module for the rule, the
// reserved words and the helpers the landing claim bar, signup and onboarding
// share. The DB enforces the same rule (orgs_handle_format_check, 0026) and
// the same reserved list (reserved_handles(), 0047) — handle.test.ts asserts
// the two lists are identical.

export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
export const HANDLE_MAX = 50;

// Every top-level app route (a handle must never shadow one now that the
// public page answers at /<handle>), plus generic names nobody should own.
// Keep in sync with reserved_handles() in 0047_handles.sql.
export const RESERVED_HANDLES = [
  "api", "auth", "availability", "billing", "book", "booking", "booking-page", "bookings",
  "clients", "dev", "embed", "forgot-password", "login", "onboarding", "overview", "p", "portal",
  "pricing", "privacy", "programs", "rentals", "reset-password", "services", "settings", "signup",
  "team", "templates", "terms", "utils",
  "admin", "app", "www", "mail", "help", "support", "docs", "blog", "about", "contact", "status",
  "static", "assets", "public", "booklo", "me", "new", "home", "index", "sitemap", "robots",
  "favicon",
] as const;

const RESERVED = new Set<string>(RESERVED_HANDLES);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}

// Live-typing normaliser: the field only ever shows a legal prefix of a
// handle. A trailing dash is allowed mid-typing; HANDLE_RE rejects it on
// submit and the hint explains.
export function normalizeHandle(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, HANDLE_MAX);
}

export function toDisplayName(handle: string): string {
  return handle
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const SUFFIXES = ["-studio", "-booking", "-2", "-3"] as const;

export function suggestHandles(handle: string): string[] {
  const base = normalizeHandle(handle).replace(/-+$/, "");
  return SUFFIXES.map((s) => base.slice(0, HANDLE_MAX - s.length).replace(/-+$/, "") + s).filter((c) =>
    HANDLE_RE.test(c),
  );
}
```

- [ ] **Step 4: Re-export from `schema.ts` and reject reserved handles in settings**

In `src/features/scheduling/schema.ts` replace line 12 (`export const HANDLE_RE = …`) with:

```ts
import { HANDLE_RE, isReservedHandle } from "./handle";
export { HANDLE_RE };
```

(Place the `import` with the other imports at the top of the file; keep `export { HANDLE_RE };` where the const used to be.)

Replace the `handle:` field of `schedulingSettingsInput` with:

```ts
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .union([z.string().regex(HANDLE_RE), z.null()])
      // Reserved words would shadow an app route now that the public page
      // answers at /<handle>; 0047's update_org_scheduling rejects them too.
      .refine((h) => h === null || !isReservedHandle(h), { message: "reserved handle" }),
  ),
```

Append to `src/features/scheduling/schema.test.ts` inside the existing `describe("schedulingSettingsInput", …)` block (line 106):

```ts
  it("rejects a reserved handle", () => {
    expect(schedulingSettingsInput.safeParse({ handle: "login", timezone: "Europe/Warsaw" }).success).toBe(false);
    expect(schedulingSettingsInput.safeParse({ handle: "anna", timezone: "Europe/Warsaw" }).success).toBe(true);
  });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/scheduling/handle.test.ts src/features/scheduling/schema.test.ts src/features/rentals`
Expected: all PASS (rentals still resolves `HANDLE_RE` through the re-export).

- [ ] **Step 6: Commit**

```bash
git add src/features/scheduling/handle.ts src/features/scheduling/handle.test.ts src/features/scheduling/schema.ts src/features/scheduling/schema.test.ts
git commit -m "feat(handles): pure handle module — reserved list, normaliser, display name, suggestions"
```

---

### Task 2: Migration 0047 — reserved handles, public availability, create_org_with_page

**Files:**
- Create: `src/db/migrations/0047_handles.sql` (via `drizzle-kit generate --custom`), `meta/_journal.json` + `meta/0047_snapshot.json` (generated)
- Create: `src/features/scheduling/handles.integration.test.ts`
- Modify: `src/features/scheduling/handle.test.ts` (parity test)

**Interfaces:**
- Produces (SQL, all `security definer`, `set search_path = ''`):
  - `public.reserved_handles() returns text[]` — no grants (only called inside definer functions)
  - `public.is_handle_available(p_handle text) returns boolean` — granted to `anon, authenticated`
  - `public.update_org_scheduling(uuid, text, text)` — unchanged signature, now raises `reserved handle`
  - `public.create_org_with_page(p_name text, p_handle text, p_timezone text) returns public.orgs` — granted to `authenticated`; `23505` propagates on a taken handle

- [ ] **Step 1: Generate the empty custom migration**

Run: `npx drizzle-kit generate --custom --name=handles`
Expected: `src/db/migrations/0047_handles.sql` (empty), `meta/_journal.json` gains idx 47 with tag `0047_handles`, `meta/0047_snapshot.json` created. If the number is not 0047, stop — another migration landed on main; rebase first.

- [ ] **Step 2: Write the migration**

`src/db/migrations/0047_handles.sql`:

```sql
-- 0047 (Landing claim): the public page now answers at /<handle>, so a handle
-- must never shadow an app route; the landing checks availability before
-- signup; onboarding creates the org with its handle + timezone in one call.
-- Idempotent (create or replace; revoke-then-grant).

-- ---------- reserved words: mirror of RESERVED_HANDLES (features/scheduling/handle.ts)
create or replace function public.reserved_handles() returns text[]
language sql immutable set search_path = '' as $$
  select array[
    'api','auth','availability','billing','book','booking','booking-page','bookings',
    'clients','dev','embed','forgot-password','login','onboarding','overview','p','portal',
    'pricing','privacy','programs','rentals','reset-password','services','settings','signup',
    'team','templates','terms','utils',
    'admin','app','www','mail','help','support','docs','blog','about','contact','status',
    'static','assets','public','booklo','me','new','home','index','sitemap','robots',
    'favicon'
  ]::text[]
$$;
revoke all on function public.reserved_handles() from public, anon, authenticated, service_role;

-- ---------- public availability check (anon): format, reserved, taken
-- Handles are public URLs already, so "is this taken" leaks nothing new.
create or replace function public.is_handle_available(p_handle text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_handle is not null
     and p_handle ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'
     and not (p_handle = any (public.reserved_handles()))
     and not exists (select 1 from public.orgs o where o.handle = p_handle)
$$;
revoke all on function public.is_handle_available(text) from public, anon, authenticated, service_role;
grant execute on function public.is_handle_available(text) to anon, authenticated;

-- ---------- update_org_scheduling: 0026 body + the reserved check
create or replace function public.update_org_scheduling(
  p_org_id uuid,
  p_handle text,
  p_timezone text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = p_org_id;
end;
$$;
revoke all on function public.update_org_scheduling(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_org_scheduling(uuid, text, text)
  to authenticated;

-- ---------- create_org_with_page: create_org (0041) + handle + timezone, one transaction
-- A taken handle surfaces as 23505 (orgs_handle_unique) and rolls back the
-- org, member and staff rows create_org inserted.
create or replace function public.create_org_with_page(p_name text, p_handle text, p_timezone text)
returns public.orgs language plpgsql security definer set search_path = '' as $$
declare
  v_org public.orgs;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_handle is not null and p_handle !~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$' then
    raise exception 'not found';
  end if;
  if p_handle is not null and p_handle = any (public.reserved_handles()) then
    raise exception 'reserved handle';
  end if;
  if p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'not found';
  end if;
  v_org := public.create_org(p_name);
  update public.orgs
    set handle = p_handle, timezone = p_timezone
    where id = v_org.id
    returning * into v_org;
  return v_org;
end;
$$;
revoke all on function public.create_org_with_page(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_org_with_page(text, text, text) to authenticated;
```

- [ ] **Step 3: Add the parity test**

Append to `src/features/scheduling/handle.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("reserved list parity with 0047_handles.sql", () => {
  it("RESERVED_HANDLES equals the array in reserved_handles()", () => {
    const sql = readFileSync(join(process.cwd(), "src/db/migrations/0047_handles.sql"), "utf8");
    const block = /function public\.reserved_handles\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    expect(block, "reserved_handles() array not found").not.toBeNull();
    const inSql = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...RESERVED_HANDLES].sort());
  });
});
```

(Move the two `import`s to the top of the file with the others.)

- [ ] **Step 4: Run the parity test, apply the migration**

Run: `npx vitest run src/features/scheduling/handle.test.ts`
Expected: PASS.

Run: `supabase status` (stack must be up; else `supabase start`) then `npm run db:migrate`
Expected: `0047_handles` applied with no error.

- [ ] **Step 5: Write the integration test**

`src/features/scheduling/handles.integration.test.ts`:

```ts
/**
 * 0047: is_handle_available (anon), reserved handles, create_org_with_page.
 * Requires the local Supabase stack.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const STAMP = Date.now();
const TAKEN = `hnd-taken-${STAMP}`;
const FRESH = `hnd-fresh-${STAMP}`;

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `hnd_${tag}_${STAMP}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: e } = await client.auth.signInWithPassword({ email, password });
  if (e) throw e;
  return client;
}

async function available(handle: string | null): Promise<boolean> {
  const { data, error } = await anon.rpc("is_handle_available", { p_handle: handle });
  if (error) throw error;
  return data as boolean;
}

describe("is_handle_available (anon)", () => {
  beforeAll(async () => {
    const owner = await signedInUser("taken");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Taken Co" });
    if (error) throw error;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: (org as { id: string }).id,
      p_handle: TAKEN,
      p_timezone: "Europe/Warsaw",
    });
    if (e2) throw e2;
  });

  it("is true for a free, well-formed handle", async () => {
    expect(await available(FRESH)).toBe(true);
  });
  it("is false for a taken handle", async () => {
    expect(await available(TAKEN)).toBe(false);
  });
  it("is false for reserved words", async () => {
    expect(await available("login")).toBe(false);
    expect(await available("booking-page")).toBe(false);
  });
  it("is false for malformed input and null", async () => {
    expect(await available("Ab")).toBe(false);
    expect(await available("-anna")).toBe(false);
    expect(await available("a".repeat(51))).toBe(false);
    expect(await available(null)).toBe(false);
  });
});

describe("update_org_scheduling rejects reserved handles", () => {
  it("raises for a reserved word", async () => {
    const owner = await signedInUser("reserved");
    const { data: org, error } = await owner.rpc("create_org", { p_name: "Reserved Co" });
    if (error) throw error;
    const { error: e2 } = await owner.rpc("update_org_scheduling", {
      p_org_id: (org as { id: string }).id,
      p_handle: "pricing",
      p_timezone: "Europe/Warsaw",
    });
    expect(e2?.message).toMatch(/reserved handle/);
  });
});

describe("create_org_with_page", () => {
  it("creates the org with handle + timezone and seeds the first staff row", async () => {
    const owner = await signedInUser("page");
    const handle = `hnd-page-${STAMP}`;
    const { data, error } = await owner.rpc("create_org_with_page", {
      p_name: "Anna Studio",
      p_handle: handle,
      p_timezone: "Europe/Berlin",
    });
    if (error) throw error;
    const org = data as { id: string; name: string; handle: string; timezone: string };
    expect(org.name).toBe("Anna Studio");
    expect(org.handle).toBe(handle);
    expect(org.timezone).toBe("Europe/Berlin");
    const { count } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("org_id", org.id);
    expect(count).toBe(1);
    expect(await available(handle)).toBe(false);
  });

  it("accepts a null handle (plain onboarding)", async () => {
    const owner = await signedInUser("nohandle");
    const { data, error } = await owner.rpc("create_org_with_page", {
      p_name: "No Handle Yet",
      p_handle: null,
      p_timezone: "UTC",
    });
    if (error) throw error;
    expect((data as { handle: string | null }).handle).toBeNull();
  });

  it("a taken handle fails with 23505 and leaves no org behind", async () => {
    const owner = await signedInUser("dupe");
    const { data: { user } } = await owner.auth.getUser();
    const { error } = await owner.rpc("create_org_with_page", {
      p_name: "Dupe Co",
      p_handle: TAKEN,
      p_timezone: "UTC",
    });
    expect(error?.code).toBe("23505");
    const { count } = await admin.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", user!.id);
    expect(count).toBe(0);
  });

  it("rejects reserved handles and bad timezones", async () => {
    const owner = await signedInUser("bad");
    const r1 = await owner.rpc("create_org_with_page", { p_name: "X Co", p_handle: "signup", p_timezone: "UTC" });
    expect(r1.error?.message).toMatch(/reserved handle/);
    const r2 = await owner.rpc("create_org_with_page", { p_name: "X Co", p_handle: null, p_timezone: "Mars/Olympus" });
    expect(r2.error?.message).toMatch(/not found/);
  });

  it("is not callable by anon", async () => {
    const { error } = await anon.rpc("create_org_with_page", { p_name: "Anon", p_handle: null, p_timezone: "UTC" });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run the integration test**

Run: `npx vitest run --config vitest.integration.config.ts src/features/scheduling/handles.integration.test.ts`
Expected: all PASS. (If `23505` isn't the code, check `error.code` in the failure output — PostgREST returns the SQLSTATE; `updateSchedulingSettings` already relies on this.)

- [ ] **Step 7: Run the full integration suite once (the re-created `update_org_scheduling` is used everywhere)**

Run: `npm run test:integration`
Expected: PASS, same count as before plus the new file.

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/0047_handles.sql src/db/migrations/meta src/features/scheduling/handles.integration.test.ts src/features/scheduling/handle.test.ts
git commit -m "feat(db): 0047 — reserved_handles, is_handle_available (anon), create_org_with_page"
```

---

### Task 3: `checkHandle` server action + `useHandleCheck` hook

**Files:**
- Create: `src/features/scheduling/handle-actions.ts`
- Create: `src/features/scheduling/handle-actions.test.ts`
- Create: `src/features/scheduling/use-handle-check.ts`

**Interfaces:**
- Produces:
  - `type HandleCheck = { status: "free" } | { status: "taken"; suggestion: string | null } | { status: "invalid" } | { status: "error" }`
  - `checkHandle(input: unknown): Promise<HandleCheck>` — server action, no session
  - `useHandleCheck(handle: string, opts?: { enabled?: boolean; delayMs?: number }): { result: HandleCheck | null; checking: boolean }` — debounced; `result` is `null` while the handle fails `HANDLE_RE`

- [ ] **Step 1: Write the failing test**

`src/features/scheduling/handle-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/anon-server", () => ({
  createAnonServerClient: () => ({ rpc }),
}));
vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
}));

import { checkHandle } from "./handle-actions";

beforeEach(() => {
  rpc.mockReset();
});

describe("checkHandle", () => {
  it("returns invalid without touching the DB for malformed or reserved input", async () => {
    expect(await checkHandle("Ab")).toEqual({ status: "invalid" });
    expect(await checkHandle("login")).toEqual({ status: "invalid" });
    expect(await checkHandle(42)).toEqual({ status: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns free when the RPC says so", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await checkHandle("anna")).toEqual({ status: "free" });
    expect(rpc).toHaveBeenCalledWith("is_handle_available", { p_handle: "anna" });
  });

  it("returns taken with the first free suggestion, at most three extra RPC calls", async () => {
    rpc
      .mockResolvedValueOnce({ data: false, error: null }) // anna
      .mockResolvedValueOnce({ data: false, error: null }) // anna-studio
      .mockResolvedValueOnce({ data: true, error: null }); // anna-booking
    expect(await checkHandle("anna")).toEqual({ status: "taken", suggestion: "anna-booking" });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("returns taken with no suggestion when every candidate is gone", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkHandle("anna")).toEqual({ status: "taken", suggestion: null });
    expect(rpc).toHaveBeenCalledTimes(4); // 1 + 3 candidates, never the 4th suffix
  });

  it("returns error (not taken) when the RPC fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await checkHandle("anna")).toEqual({ status: "error" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/scheduling/handle-actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the action**

`src/features/scheduling/handle-actions.ts`:

```ts
"use server";

import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { HANDLE_RE, isReservedHandle, suggestHandles } from "./handle";

export type HandleCheck =
  | { status: "free" }
  | { status: "taken"; suggestion: string | null }
  | { status: "invalid" }
  | { status: "error" };

const MAX_SUGGESTION_LOOKUPS = 3;

// Public by design (the landing page calls it before anyone signs up): the
// anon client, no cookies, one indexed lookup per call. Handles are public
// URLs, so "taken" reveals nothing that /<handle> wouldn't.
export async function checkHandle(input: unknown): Promise<HandleCheck> {
  if (typeof input !== "string" || !HANDLE_RE.test(input) || isReservedHandle(input)) {
    return { status: "invalid" };
  }
  const supabase = createAnonServerClient();
  const free = await isFree(supabase, input);
  if (free === null) return { status: "error" };
  if (free) return { status: "free" };
  for (const candidate of suggestHandles(input).slice(0, MAX_SUGGESTION_LOOKUPS)) {
    if (await isFree(supabase, candidate)) return { status: "taken", suggestion: candidate };
  }
  return { status: "taken", suggestion: null };
}

async function isFree(
  supabase: ReturnType<typeof createAnonServerClient>,
  handle: string,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("is_handle_available", { p_handle: handle });
  if (error) {
    console.error("[handles] is_handle_available:", error.message);
    return null;
  }
  return data === true;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/scheduling/handle-actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the hook**

`src/features/scheduling/use-handle-check.ts`:

```ts
"use client";

import * as React from "react";
import { HANDLE_RE } from "./handle";
import { checkHandle, type HandleCheck } from "./handle-actions";

// Debounced availability for a handle field. `result` is null while the
// value isn't a complete handle yet, so callers show the format hint instead
// of a stale verdict. Stale responses are dropped (cancelled flag).
export function useHandleCheck(
  handle: string,
  { enabled = true, delayMs = 400 }: { enabled?: boolean; delayMs?: number } = {},
): { result: HandleCheck | null; checking: boolean } {
  const [result, setResult] = React.useState<HandleCheck | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !HANDLE_RE.test(handle)) {
      setResult(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(async () => {
      const r = await checkHandle(handle);
      if (cancelled) return;
      setResult(r);
      setChecking(false);
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [handle, enabled, delayMs]);

  return { result, checking };
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add src/features/scheduling/handle-actions.ts src/features/scheduling/handle-actions.test.ts src/features/scheduling/use-handle-check.ts
git commit -m "feat(handles): checkHandle server action (anon RPC + suggestions) and useHandleCheck hook"
```

---

### Task 4: Root short links — `/[handle]`, `/book/…` redirects, URL helper

**Files:**
- Create: `src/lib/booking/url.ts`, `src/lib/booking/url.test.ts`
- Move: `src/app/book/layout.tsx` → `src/app/[handle]/layout.tsx`; `src/app/book/[handle]/page.tsx` → `src/app/[handle]/page.tsx`; `src/app/book/[handle]/[staffSlug]/page.tsx` → `src/app/[handle]/[staffSlug]/page.tsx`
- Create: `src/app/book/[handle]/page.tsx`, `src/app/book/[handle]/[staffSlug]/page.tsx` (redirects)
- Modify: `src/features/scheduling/components/scheduling-settings-form.tsx:55,80`, `src/features/orgs/components/booking-page-studio.tsx:70`, `src/features/scheduling/components/staff-list.tsx:39`, `src/features/utils/components/org-picker.tsx:40`

**Interfaces:**
- Produces:
  - `bookingPath(handle: string, staffSlug?: string): string` → `/anna` | `/anna/maria`
  - `bookingUrl(appUrl: string, handle: string, staffSlug?: string): string` → `https://booklo.co/anna`
  - `hostLabel(appUrl: string): string` → `booklo.co` | `localhost:3000`

- [ ] **Step 1: Write the failing tests (helper + literal guard)**

`src/lib/booking/url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { bookingPath, bookingUrl, hostLabel } from "./url";

describe("booking URLs", () => {
  it("builds root paths, with an optional staff segment", () => {
    expect(bookingPath("anna")).toBe("/anna");
    expect(bookingPath("anna", "maria")).toBe("/anna/maria");
  });
  it("joins the app URL without a double slash", () => {
    expect(bookingUrl("https://booklo.co", "anna")).toBe("https://booklo.co/anna");
    expect(bookingUrl("https://booklo.co/", "anna", "maria")).toBe("https://booklo.co/anna/maria");
  });
  it("hostLabel strips the scheme and trailing slash", () => {
    expect(hostLabel("https://booklo.co/")).toBe("booklo.co");
    expect(hostLabel("http://localhost:3000")).toBe("localhost:3000");
  });
});

// Source guard: nothing outside the legacy redirect folder builds a /book/
// URL by hand — the public page lives at /<handle> now.
describe("no stray /book/ literals", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }
  it("src/** (except src/app/book and tests) never quotes a /book/ path", () => {
    const root = join(process.cwd(), "src");
    const offenders = walk(root)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
      .filter((p) => !relative(root, p).startsWith("app/book/"))
      .filter((p) => /(["'`}])\/book\//.test(readFileSync(p, "utf8")))
      .map((p) => relative(process.cwd(), p));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/booking/url.test.ts`
Expected: FAIL — module not found (and, once it exists, the guard lists the four callers).

- [ ] **Step 3: Write the helper**

`src/lib/booking/url.ts`:

```ts
// The public booking page's address. Root-level since 0047 (/<handle>,
// /<handle>/<staffSlug>); /book/… only redirects. `appUrl` is passed in
// (NEXT_PUBLIC_APP_URL at the call site) so this module stays env-free.

export function bookingPath(handle: string, staffSlug?: string): string {
  return staffSlug ? `/${handle}/${staffSlug}` : `/${handle}`;
}

export function bookingUrl(appUrl: string, handle: string, staffSlug?: string): string {
  return `${appUrl.replace(/\/+$/, "")}${bookingPath(handle, staffSlug)}`;
}

// "https://booklo.co/" → "booklo.co": the prefix shown before a handle field.
export function hostLabel(appUrl: string): string {
  return appUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
```

- [ ] **Step 4: Move the public pages to the root**

```bash
mkdir -p "src/app/[handle]/[staffSlug]"
git mv src/app/book/layout.tsx "src/app/[handle]/layout.tsx"
git mv "src/app/book/[handle]/page.tsx" "src/app/[handle]/page.tsx"
git mv "src/app/book/[handle]/[staffSlug]/page.tsx" "src/app/[handle]/[staffSlug]/page.tsx"
```

In `src/app/[handle]/page.tsx` change `PageProps<"/book/[handle]">` → `PageProps<"/[handle]">`. In `src/app/[handle]/[staffSlug]/page.tsx` change `PageProps<"/book/[handle]/[staffSlug]">` → `PageProps<"/[handle]/[staffSlug]">` and the comment `Same shell as /book/[handle]` → `Same shell as /[handle]`. Rename the layout function to `PublicBookingLayout`.

- [ ] **Step 5: Write the redirects**

`src/app/book/[handle]/page.tsx`:

```tsx
import { notFound, permanentRedirect } from "next/navigation";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { bookingPath } from "@/lib/booking/url";

// Legacy address. The page moved to /<handle> (0047); links in old
// confirmation emails and embeds keep resolving through this 308.
export default async function LegacyBookPage({ params }: PageProps<"/book/[handle]">) {
  const { handle } = await params;
  if (!HANDLE_RE.test(handle)) notFound();
  permanentRedirect(bookingPath(handle));
}
```

`src/app/book/[handle]/[staffSlug]/page.tsx`:

```tsx
import { notFound, permanentRedirect } from "next/navigation";
import { HANDLE_RE } from "@/features/scheduling/handle";
import { STAFF_SLUG_RE } from "@/features/scheduling/staff-slug";
import { bookingPath } from "@/lib/booking/url";

export default async function LegacyStaffBookPage({ params }: PageProps<"/book/[handle]/[staffSlug]">) {
  const { handle, staffSlug } = await params;
  if (!HANDLE_RE.test(handle) || !STAFF_SLUG_RE.test(staffSlug)) notFound();
  permanentRedirect(bookingPath(handle, staffSlug));
}
```

- [ ] **Step 6: Update the four callers**

`scheduling-settings-form.tsx`:
- add `import { bookingUrl, hostLabel } from "@/lib/booking/url";`
- line 41 `const host = appUrl.replace(/^https?:\/\//, "");` → `const host = hostLabel(appUrl);`
- line 55 `navigator.clipboard.writeText(\`${appUrl}/book/${saved.handle}\`);` → `navigator.clipboard.writeText(bookingUrl(appUrl, saved.handle));`
- line 80 `{host}/book/` → `{host}/`

`booking-page-studio.tsx`:
- add `import { bookingPath, hostLabel } from "@/lib/booking/url";`
- `const host = appUrl.replace(/^https?:\/\//, "");` → `const host = hostLabel(appUrl);`
- `const url = \`${host}/book/${handle.trim() || "your-handle"}\`;` → `const url = \`${host}${bookingPath(handle.trim() || "your-handle")}\`;`

`staff-list.tsx`:
- add `import { bookingPath } from "@/lib/booking/url";`
- line 38 comment `/book/… URL 404s` → `booking URL 404s`
- line 39 → `const path = handle && staff.active ? bookingPath(handle, staff.slug) : null;`

`org-picker.tsx`:
- add `import { bookingPath } from "@/lib/booking/url";`
- `{org.handle ? \` · /book/${org.handle}\` : ""}` → `{org.handle ? \` · ${bookingPath(org.handle)}\` : ""}`

Then: `grep -rn '/book/' src workers scripts --include='*.ts' --include='*.tsx' | grep -v 'src/app/book/' | grep -v '\.test\.'` — expected: only comments, no quoted paths.

- [ ] **Step 7: Run tests, typecheck, and the dev server once**

Run: `npx vitest run src/lib/booking/url.test.ts && npm run typecheck`
Expected: PASS (guard finds no offenders); typecheck clean (`next typegen` produces `/[handle]` route types).

Run: `npm run dev` in the background, then `curl -sI http://localhost:3000/book/anything | head -3`
Expected: `HTTP/1.1 308 Permanent Redirect` with `location: /anything`. `curl -sI http://localhost:3000/login` → 200 (static route still wins). Stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/book "src/app/[handle]" src/lib/booking/url.ts src/lib/booking/url.test.ts src/features/scheduling/components/scheduling-settings-form.tsx src/features/orgs/components/booking-page-studio.tsx src/features/scheduling/components/staff-list.tsx src/features/utils/components/org-picker.tsx
git commit -m "feat(booking): public page at /<handle>; /book/… 308s; bookingUrl helper + literal guard"
```

---

### Task 5: Signup carries the handle

**Files:**
- Modify: `src/features/auth/schema.ts:16-19` (`signUpSchema`)
- Modify: `src/features/auth/schema.test.ts`
- Modify: `src/features/auth/actions.ts:49-72` (`signUp`)
- Modify: `src/features/auth/actions.test.ts`
- Modify: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/signup-form.tsx`

**Interfaces:**
- Consumes: `HANDLE_RE`, `isReservedHandle` (Task 1); `hostLabel` (Task 4)
- Produces: `signUpSchema` accepts optional `handle`; `signUp` stores `options.data.claimed_handle`; `SignupForm` takes `{ handle: string | null; host: string }`

- [ ] **Step 1: Write the failing tests**

Append to `src/features/auth/schema.test.ts`:

```ts
describe("signUpSchema handle", () => {
  const base = { email: "a@b.com", password: "longenough" };
  it("accepts a well-formed handle", () => {
    expect(signUpSchema.parse({ ...base, handle: "anna-studio" }).handle).toBe("anna-studio");
  });
  it("treats an empty string as absent", () => {
    expect(signUpSchema.parse({ ...base, handle: "" }).handle).toBeUndefined();
    expect(signUpSchema.parse(base).handle).toBeUndefined();
  });
  it("rejects malformed and reserved handles", () => {
    expect(signUpSchema.safeParse({ ...base, handle: "Ab" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, handle: "login" }).success).toBe(false);
  });
});
```

Append to `src/features/auth/actions.test.ts` inside the existing `describe("signUp", …)` block (line 84):

```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/auth`
Expected: the new cases FAIL (handle stripped / metadata missing).

- [ ] **Step 3: Schema + action**

`src/features/auth/schema.ts` — replace `signUpSchema`:

```ts
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";

// Signup + reset enforce the policy: length over composition rules (NIST).
// Mirrors minimum_password_length = 8 in supabase/config.toml.
// `handle` is the landing page's claim (spec 2026-08-23-landing-claim): it
// rides as user metadata and only pre-fills onboarding, which re-validates.
export const signUpSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .string()
      .regex(HANDLE_RE, "That page name isn't valid.")
      .refine((h) => !isReservedHandle(h), "That page name isn't available.")
      .optional(),
  ),
});
```

`src/features/auth/actions.ts` — `signUp` becomes:

```ts
export async function signUp(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    handle: formData.get("handle"),
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
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
      // Advisory only: onboarding pre-fills from it and re-checks availability.
      ...(parsed.data.handle ? { data: { claimed_handle: parsed.data.handle } } : {}),
    },
  });

  if (error) return { error: "Could not create your account. Try again." };
  // Existing emails get an obfuscated user (no error) from Supabase when
  // confirmations are on, so this copy never reveals account existence.
  return { sent: true };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/auth`
Expected: PASS.

- [ ] **Step 5: Page + form**

`src/app/(auth)/signup/page.tsx`:

```tsx
import Link from "next/link";
import { env } from "@/env";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import { hostLabel } from "@/lib/booking/url";
import { SignupForm } from "./signup-form";

// ?handle= comes from the landing claim bar. Anything malformed or reserved
// is dropped silently — the plain signup is the fallback, never an error.
export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { handle: raw } = await searchParams;
  const candidate = typeof raw === "string" ? raw : null;
  const handle = candidate && HANDLE_RE.test(candidate) && !isReservedHandle(candidate) ? candidate : null;
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">
          Create your Booklo account
        </h1>
        <p className="text-muted-foreground mb-6 text-sm">
          You&apos;ll confirm your email before signing in.
        </p>
        <SignupForm handle={handle} host={host} />
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

`src/app/(auth)/signup/signup-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { signUp } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AuthState = {};

export function SignupForm({ handle, host }: { handle: string | null; host: string }) {
  const [state, action, pending] = useActionState(signUp, initial);
  const claimed = handle ? `${host}/${handle}` : null;

  if (state.sent) {
    return (
      <p className="text-sm">
        {claimed
          ? `Check your email to confirm your account and claim ${claimed}.`
          : "Check your email to confirm your account."}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      {claimed ? (
        <p className="bg-muted text-muted-foreground rounded-lg px-3 py-2 font-mono text-xs">
          Claiming <span className="text-foreground">{claimed}</span>
        </p>
      ) : null}
      {handle ? <input type="hidden" name="handle" value={handle} /> : null}
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

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add src/features/auth src/app/\(auth\)/signup
git commit -m "feat(auth): /signup?handle= carries the claimed handle as user metadata"
```

---

### Task 6: One-step onboarding — "Claim your page"

**Files:**
- Modify: `src/features/orgs/schema.ts` (add `createOrgWithPageSchema`), `src/features/orgs/schema.test.ts`
- Modify: `src/features/orgs/actions.ts` (add `createOrgWithPage`)
- Modify: `src/app/onboarding/page.tsx`, `src/app/onboarding/onboarding-form.tsx`
- Modify: `src/features/marketing/site.ts` (add `ONBOARDING` copy) — see Task 8 for the rest of the copy; add just this block now

**Interfaces:**
- Consumes: `useHandleCheck` (Task 3), `normalizeHandle`, `toDisplayName`, `HANDLE_RE`, `isReservedHandle` (Task 1), `hostLabel` (Task 4), `create_org_with_page` (Task 2)
- Produces:
  - `createOrgWithPageSchema` → `{ name: string; handle: string | null; timezone: string }`
  - `createOrgWithPage(_prev: OrgState, formData: FormData): Promise<OrgState>` — redirects to `/bookings?welcome=1`
  - `ONBOARDING` copy object in `site.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `src/features/orgs/schema.test.ts`:

```ts
import { createOrgWithPageSchema } from "./schema";

describe("createOrgWithPageSchema", () => {
  it("accepts name + handle + timezone", () => {
    expect(createOrgWithPageSchema.parse({ name: "Anna Studio", handle: "anna-studio", timezone: "Europe/Warsaw" })).toEqual({
      name: "Anna Studio",
      handle: "anna-studio",
      timezone: "Europe/Warsaw",
    });
  });
  it("maps an empty handle to null", () => {
    expect(createOrgWithPageSchema.parse({ name: "Anna", handle: "", timezone: "UTC" }).handle).toBeNull();
  });
  it("rejects a malformed or reserved handle and a missing timezone", () => {
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "-x", timezone: "UTC" }).success).toBe(false);
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "signup", timezone: "UTC" }).success).toBe(false);
    expect(createOrgWithPageSchema.safeParse({ name: "Anna", handle: "anna", timezone: "" }).success).toBe(false);
  });
});
```

(Merge the import into the existing `import { … } from "./schema";` line.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/orgs/schema.test.ts`
Expected: FAIL — `createOrgWithPageSchema` not exported.

- [ ] **Step 3: Schema**

Add to `src/features/orgs/schema.ts` after `createOrgSchema`:

```ts
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";

// Onboarding (spec 2026-08-23-landing-claim): org + handle + timezone in one
// step. Handle is optional — "" (untouched field) → null, as in
// schedulingSettingsInput.
export const createOrgWithPageSchema = z.object({
  name: z.string().trim().min(2).max(80),
  handle: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z
      .union([z.string().regex(HANDLE_RE), z.null()])
      .refine((h) => h === null || !isReservedHandle(h), { message: "reserved handle" }),
  ),
  timezone: z.string().min(1).max(64),
});
```

- [ ] **Step 4: Run the schema test**

Run: `npx vitest run src/features/orgs/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Copy block in `site.ts`**

Add to `src/features/marketing/site.ts` (before `FORBIDDEN_COPY`):

```ts
/** Onboarding ("Claim your page") copy. Lives here with the rest of the
    funnel copy so site.test.ts guards it like everything else. */
export const ONBOARDING = {
  heading: "Claim your page",
  sub: "This is the address clients book you at. You can change it later.",
  nameLabel: "Your name or business",
  namePlaceholder: "Anna Studio",
  handleLabel: "Page address",
  handlePlaceholder: "your-name",
  handleHint: "3–50 characters: letters, numbers, dashes. Leave empty to choose later.",
  handleFree: (url: string) => `${url} is free`,
  handleTaken: (url: string) => `${url} is taken`,
  handleTakenSuggest: (suggestion: string) => `try ${suggestion}`,
  handleChecking: "Checking…",
  handleCheckFailed: "Couldn't check right now — you can still continue.",
  timezoneLabel: "Timezone",
  submit: "Claim my page",
  submitting: "Claiming…",
  justTaken: "That name was just taken — pick another.",
} as const;
```

- [ ] **Step 6: Action**

Add to `src/features/orgs/actions.ts` after `createOrg` (extend the schema import with `createOrgWithPageSchema`):

```ts
// One-step onboarding: org + handle + timezone via create_org_with_page (0047).
// A handle race surfaces as 23505 → specific copy, everything else generic.
export async function createOrgWithPage(
  _prev: OrgState,
  formData: FormData,
): Promise<OrgState> {
  const parsed = createOrgWithPageSchema.safeParse({
    name: formData.get("name"),
    handle: formData.get("handle"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { error: "Check the name (2–80 characters) and the page address." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("create_org_with_page", {
    p_name: parsed.data.name,
    p_handle: parsed.data.handle,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    if (error.code === "23505") return { error: ONBOARDING.justTaken };
    console.error("[orgs] create_org_with_page:", error.message);
    return { error: GENERIC_WRITE_ERROR };
  }
  redirect("/bookings?welcome=1");
}
```

Add `import { ONBOARDING } from "@/features/marketing/site";` to the file's imports.

- [ ] **Step 7: Page**

`src/app/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { env } from "@/env";
import { getCurrentOrg, requireUser } from "@/lib/auth/session";
import { HANDLE_RE, isReservedHandle } from "@/features/scheduling/handle";
import { ONBOARDING } from "@/features/marketing/site";
import { hostLabel } from "@/lib/booking/url";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const org = await getCurrentOrg();
  if (org) redirect("/bookings"); // already onboarded

  // The landing claim, if any (signUp stored it as metadata). Re-validated:
  // metadata is user-editable and the reserved list may have grown since.
  const raw = user.user_metadata?.claimed_handle;
  const claimed = typeof raw === "string" && HANDLE_RE.test(raw) && !isReservedHandle(raw) ? raw : null;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{ONBOARDING.heading}</h1>
        <p className="text-muted-foreground mb-6 text-sm">{ONBOARDING.sub}</p>
        <OnboardingForm initialHandle={claimed} host={hostLabel(env.NEXT_PUBLIC_APP_URL)} />
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Form**

`src/app/onboarding/onboarding-form.tsx`:

```tsx
"use client";

import * as React from "react";
import { useActionState } from "react";
import { createOrgWithPage } from "@/features/orgs/actions";
import type { OrgState } from "@/features/orgs/schema";
import { HANDLE_RE, normalizeHandle, toDisplayName } from "@/features/scheduling/handle";
import { useHandleCheck } from "@/features/scheduling/use-handle-check";
import { ONBOARDING } from "@/features/marketing/site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

const initial: OrgState = {};
const TIMEZONES = Intl.supportedValuesOf("timeZone");

export function OnboardingForm({ initialHandle, host }: { initialHandle: string | null; host: string }) {
  const [state, action, pending] = useActionState(createOrgWithPage, initial);
  const [name, setName] = React.useState(initialHandle ? toDisplayName(initialHandle) : "");
  const [handle, setHandle] = React.useState(initialHandle ?? "");
  // SSR renders UTC; the browser's zone replaces it after mount (no hydration mismatch).
  const [timezone, setTimezone] = React.useState("UTC");
  React.useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const { result, checking } = useHandleCheck(handle);
  const url = `${host}/${handle || ONBOARDING.handlePlaceholder}`;

  let status: React.ReactNode = ONBOARDING.handleHint;
  let tone = "text-muted-foreground";
  if (handle && !HANDLE_RE.test(handle)) {
    status = ONBOARDING.handleHint;
    tone = "text-destructive";
  } else if (checking) {
    status = ONBOARDING.handleChecking;
  } else if (result?.status === "free") {
    status = ONBOARDING.handleFree(url);
    tone = "text-foreground";
  } else if (result?.status === "taken") {
    status = (
      <>
        {ONBOARDING.handleTaken(url)}
        {result.suggestion ? (
          <>
            {" — "}
            <button type="button" className="underline" onClick={() => setHandle(result.suggestion!)}>
              {ONBOARDING.handleTakenSuggest(result.suggestion)}
            </button>
          </>
        ) : null}
      </>
    );
    tone = "text-destructive";
  } else if (result?.status === "invalid") {
    tone = "text-destructive";
  } else if (result?.status === "error") {
    status = ONBOARDING.handleCheckFailed;
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{ONBOARDING.nameLabel}</Label>
        <Input
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ONBOARDING.namePlaceholder}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="handle">{ONBOARDING.handleLabel}</Label>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText className="font-mono text-xs">{host}/</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            id="handle"
            name="handle"
            value={handle}
            onChange={(e) => setHandle(normalizeHandle(e.target.value))}
            placeholder={ONBOARDING.handlePlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="handle-status"
            className="font-mono text-xs"
          />
        </InputGroup>
        <p id="handle-status" aria-live="polite" className={`min-h-4 text-xs ${tone}`}>
          {status}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">{ONBOARDING.timezoneLabel}</Label>
        <select
          id="timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="border-input h-9 w-full rounded-lg border bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? ONBOARDING.submitting : ONBOARDING.submit}
      </Button>
    </form>
  );
}
```

- [ ] **Step 9: Typecheck, lint, unit tests; commit**

Run: `npm run verify`
Expected: clean. (The `site.test.ts` "never advertises" corpus doesn't include `ONBOARDING` yet — Task 8 adds it.)

```bash
git add src/features/orgs src/app/onboarding src/features/marketing/site.ts
git commit -m "feat(onboarding): one-step Claim your page — name, handle (live check), timezone → create_org_with_page"
```

---

### Task 7: Welcome banner on `/bookings`

**Files:**
- Create: `src/features/scheduling/components/welcome-banner.tsx`
- Modify: `src/app/(dashboard)/bookings/page.tsx` (searchParams + render)
- Modify: `src/features/marketing/site.ts` (add `WELCOME`)

**Interfaces:**
- Consumes: `getSchedulingSettings()` (already called on the page; returns `{ handle: string | null; timezone: string }`), `bookingUrl`, `hostLabel`
- Produces: `WelcomeBanner({ handle, appUrl })` client component; `WELCOME` copy

- [ ] **Step 1: Copy**

Add to `src/features/marketing/site.ts` after `ONBOARDING`:

```ts
/** First screen after onboarding (/bookings?welcome=1). */
export const WELCOME = {
  owned: (url: string) => `${url} is yours.`,
  sub: "Add your first service to go live.",
  addService: "Add a service",
  copyLink: "Copy link",
  copied: "Copied",
  noHandle: "Your workspace is ready.",
  noHandleSub: "Pick a page address and you're bookable.",
  setUpPage: "Set up your booking page",
  dismiss: "Dismiss",
} as const;
```

- [ ] **Step 2: Banner**

`src/features/scheduling/components/welcome-banner.tsx`:

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { WELCOME } from "@/features/marketing/site";
import { bookingUrl, hostLabel } from "@/lib/booking/url";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shown once, driven by ?welcome=1 (nothing persisted). The public page 404s
// until a service exists, so the promise is "yours", not "live".
export function WelcomeBanner({ handle, appUrl }: { handle: string | null; appUrl: string }) {
  const router = useRouter();
  const [copied, setCopied] = React.useState(false);
  const url = handle ? bookingUrl(appUrl, handle) : null;

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div role="status" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
      <div className="mr-auto">
        <p className="text-sm font-medium">
          {url ? WELCOME.owned(`${hostLabel(appUrl)}/${handle}`) : WELCOME.noHandle}
        </p>
        <p className="text-muted-foreground text-xs">{url ? WELCOME.sub : WELCOME.noHandleSub}</p>
      </div>
      {url ? (
        <>
          <Link href="/services" className={cn(buttonVariants({ size: "sm" }))}>
            {WELCOME.addService}
          </Link>
          <Button size="sm" variant="outline" onClick={copy}>
            <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
            {copied ? WELCOME.copied : WELCOME.copyLink}
          </Button>
        </>
      ) : (
        <Link href="/booking-page" className={cn(buttonVariants({ size: "sm" }))}>
          {WELCOME.setUpPage}
        </Link>
      )}
      <Button size="sm" variant="ghost" aria-label={WELCOME.dismiss} onClick={() => router.replace("/bookings")}>
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </Button>
    </div>
  );
}
```

(`Cancel01Icon`, `Copy01Icon`, `Tick02Icon` all exist in `@hugeicons/core-free-icons`; `outline` and `ghost` are defined in `src/components/ui/button.tsx`.)

- [ ] **Step 3: Wire it into the page**

In `src/app/(dashboard)/bookings/page.tsx`:

- extend the `searchParams` type: `searchParams: Promise<{ view?: string; week?: string; from?: string; staff?: string; welcome?: string }>;`
- add imports: `import { env } from "@/env";` and `import { WelcomeBanner } from "@/features/scheduling/components/welcome-banner";`
- right after `const { rentals: rentalsOn } = await getDashboardFlags(org.id);` add:

```ts
  const welcome =
    params.welcome === "1" ? <WelcomeBanner handle={settings?.handle ?? null} appUrl={env.NEXT_PUBLIC_APP_URL} /> : null;
```

- render `{welcome}` as the first child of the outer `<div>` in **all three** return branches (timeline, list, week) — immediately inside the opening `<div className="flex min-h-0 flex-1 flex-col gap-4">` / `<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">`.

- [ ] **Step 4: Typecheck, lint; commit**

Run: `npm run typecheck && npm run lint`
Expected: clean.

```bash
git add src/features/scheduling/components/welcome-banner.tsx "src/app/(dashboard)/bookings/page.tsx" src/features/marketing/site.ts
git commit -m "feat(bookings): one-time welcome banner after onboarding (?welcome=1)"
```

---

### Task 8: Light marketing tokens, keyframes, copy, pill buttons

**Files:**
- Modify: `src/app/globals.css` (`@theme inline` + `.marketing` block; keyframes)
- Modify: `src/features/marketing/site.ts` (copy), `src/features/marketing/site.test.ts`
- Modify: `src/features/marketing/components/marketing-button.ts`
- Delete: `src/features/marketing/components/hero-reveal.module.css`

**Interfaces:**
- Produces:
  - tokens: `.marketing` light palette; `--highlight` → `bg-highlight`, `text-highlight`, `ring-highlight`
  - classes: `.animate-fade-up`, `.animate-fade-down`, `.animate-hero-rise`
  - copy: `SITE.headline: readonly [string, string]`, `SITE.subheadline`, `CLAIM`, `FINAL_CTA`, trimmed `STEPS`, `SECTIONS.how.sub`
  - `marketingButton("primary" | "neutral" | "quiet", "md" | "lg" | "text")` now pill-shaped

- [ ] **Step 1: Update the copy tests first**

In `src/features/marketing/site.test.ts`:

- add `CLAIM, ONBOARDING, WELCOME, FINAL_CTA` to the import from `./site`.
- the "never advertises" corpus: replace `SITE.headline,` with `...SITE.headline,` and append before the `].join` :

```ts
      ...Object.values(CLAIM).map((v) => (typeof v === "function" ? v("x") : v)),
      ...Object.values(ONBOARDING).map((v) => (typeof v === "function" ? v("x") : v)),
      ...Object.values(WELCOME).map((v) => (typeof v === "function" ? v("x") : v)),
      FINAL_CTA.heading,
```

- replace the "headline is short" test with:

```ts
  it("headline is two short lines (≤ 4 words each)", () => {
    expect(SITE.headline).toHaveLength(2);
    for (const line of SITE.headline) expect(line.split(/\s+/).length).toBeLessThanOrEqual(4);
  });
```

- in "each section derives its id", remove the `"feature-grid.tsx": "features"` entry (the file stays but is no longer on the page; `SITE.anchors.features` is removed below).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/marketing/site.test.ts`
Expected: FAIL — `CLAIM`/`FINAL_CTA` undefined, headline not an array.

- [ ] **Step 3: Copy changes in `site.ts`**

Replace the `SITE` object:

```ts
export const SITE = {
  name: "Booklo",
  tagline: "Booking page & widget for solo providers",
  description:
    "Booklo gives freelancers and small businesses a hosted booking page and an embeddable widget. Clients book without an account; confirmations, reminders and rescheduling are handled for you.",
  // Two staggered lines; the last word of the second carries the highlight.
  headline: ["Your booking page.", "Claimed in a minute."],
  subheadline: "Clients pick a time, you both get the email. No accounts, no double bookings.",
  // Flag-conditional (lib/flags.ts): while billing is off there IS no paid
  // ladder to contrast a "Free plan" with, and /pricing 404s — so the note
  // says what is actually true today. Flipping the flag flips the copy.
  heroNote: BILLING_ON ? "Free plan · No credit card" : "Free during early access · No credit card",
  links: { home: "/", login: "/login", signup: "/signup", pricing: "/pricing" },
  anchors: { how: "#how-it-works", faq: "#faq" },
} as const;
```

Remove `eyebrow` (no longer rendered). Replace `SECTIONS.how.sub` with `"Three steps from your name to your first booking."`. Keep `SECTIONS.product`, `SECTIONS.embed` and `FEATURES` — `product-showcase.tsx`, `embed-showcase.tsx` and `feature-grid.tsx` still import them even though they leave the page (file removal is deferred, spec §9).

Replace `STEPS`:

```ts
export const STEPS: Step[] = [
  { number: "01", title: "Set your services and hours", body: "What you offer, how long it takes, when you're free." },
  { number: "02", title: "Share your link or embed the widget", body: "Every account gets a page at its own address. One line embeds it on your site." },
  { number: "03", title: "Clients book; you both get confirmations", body: "They see only real openings. Confirmations and reminders go out on their own." },
];
```

Add after `CTA`:

```ts
/** The claim bar (hero + final CTA). The status line is assembled from
    these: `taken(url)` + " — " + (`tryPrefix` + suggestion | `tryAnother`). */
export const CLAIM = {
  placeholder: "your-name",
  button: "Claim",
  hint: "3–50 characters: letters, numbers, dashes.",
  taken: (url: string) => `${url} is taken`,
  tryPrefix: "try ",
  tryAnother: "try another name",
  unavailable: "That name can't be used — try another.",
  checkFailed: "Couldn't check right now — you can still continue.",
} as const;

export const FINAL_CTA = { heading: "Claim your page." } as const;
```

Update `NAV_LINKS` (drop the Features anchor):

```ts
export const NAV_LINKS: NavLink[] = [
  { label: "How it works", href: SITE.anchors.how },
  ...(BILLING_ON ? [{ label: "Pricing", href: SITE.links.pricing }] : []),
  { label: "FAQ", href: SITE.anchors.faq },
];
```

- [ ] **Step 4: Run the copy tests**

Run: `npx vitest run src/features/marketing/site.test.ts`
Expected: PASS. (`hero.tsx`/`final-cta.tsx` now fail typecheck on `SITE.headline` — fixed in Task 12; `feature-grid.tsx` on `SITE.anchors.features` — fix now by replacing `anchorId(SITE.anchors.features)` with the literal `"features"` and dropping the unused imports, since the component is off the page.)

- [ ] **Step 5: Tokens + keyframes in `globals.css`**

In the `@theme inline` block add one line next to `--color-primary`:

```css
  --color-highlight: var(--highlight);
```

Replace the whole `.marketing { … }` block (and its leading comment) with:

```css
/* Marketing landing palette — light and minimal (spec 2026-08-23-landing-claim):
   off-white ground, near-black type, greys for secondary text, hairlines at
   low alpha. One accent, --highlight (indigo #4f46e5 — the same value
   create_org seeds as the first staff colour, so the landing and a fresh
   booking page agree). --primary is the near-black button. Applied on the
   (marketing) layout wrapper so these win over the app's `.dark` tokens on
   <html>. Landing components use tokens only — this block is the single
   place the landing's colours live. */
.marketing {
  color-scheme: light;
  --background: oklch(0.985 0 0); /* #fafafa */
  --foreground: oklch(0.17 0 0); /* #111111 */
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.17 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.17 0 0);
  --primary: oklch(0.17 0 0);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.96 0 0); /* #f4f4f5 */
  --secondary-foreground: oklch(0.17 0 0);
  --muted: oklch(0.96 0 0);
  /* gray-500 #6b7280: 4.6:1 on the ground — AA for body text. */
  --muted-foreground: oklch(0.551 0.023 264);
  --accent: oklch(0 0 0 / 4%);
  --accent-foreground: oklch(0.17 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0 0 0 / 8%);
  --input: oklch(0 0 0 / 12%);
  --ring: var(--highlight);
  /* Indigo #4f46e5. Headline highlight, focus rings, the mockup's selected
     day, the wash under the mockup — nothing else. */
  --highlight: oklch(0.511 0.262 276.966);
}

/* Landing motion (spec §3.8). Delays are arbitrary values on the element. */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(24px); filter: blur(6px); }
  to { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes fade-down {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes hero-rise {
  from { opacity: 0; transform: translateY(64px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.animate-fade-up { animation: fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both; }
.animate-fade-down { animation: fade-down 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
.animate-hero-rise { animation: hero-rise 1.1s cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) {
  .animate-fade-up, .animate-fade-down, .animate-hero-rise { animation: none; }
}
```

Delete `src/features/marketing/components/hero-reveal.module.css` (`git rm`). `hero.tsx` still imports it — it's rewritten in Task 12; until then `npm run typecheck` will fail on that import, which is expected and noted in this task's commit message.

- [ ] **Step 6: Pill buttons**

`src/features/marketing/components/marketing-button.ts` — replace `base`, `VARIANT`, `SIZE`:

```ts
/* Landing-only button styles: pills (spec 2026-08-23-landing-claim). Built on
   plain classes rather than the app's `buttonVariants` so the landing can
   have its own shape without touching the app-wide button, while sharing the
   token palette. */

const base =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const VARIANT = {
  /* Solid near-black. */
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  /* Outlined. */
  neutral: "text-foreground ring-1 ring-border hover:bg-accent",
  /* Plain text link. */
  quiet: "text-foreground/75 hover:text-foreground",
} as const;

const SIZE = {
  /* Nav chip. */
  md: "h-9 gap-2 px-4 sm:px-5 text-[13px]",
  /* Standalone CTA. */
  lg: "h-11 gap-2 px-6 text-sm",
  /* Quiet links next to a button. */
  text: "h-9 gap-2 px-2 text-[13px]",
} as const;
```

- [ ] **Step 7: Commit (typecheck knowingly red until Task 12)**

Run: `npx vitest run src/features/marketing`
Expected: PASS.

```bash
git add src/app/globals.css src/features/marketing/site.ts src/features/marketing/site.test.ts src/features/marketing/components/marketing-button.ts src/features/marketing/components/feature-grid.tsx
git rm -q src/features/marketing/components/hero-reveal.module.css
git commit -m "feat(landing): light .marketing tokens + --highlight, landing keyframes, claim copy, pill buttons (hero rewrite follows)"
```

---

### Task 9: Navbar with mobile dropdown

**Files:**
- Rewrite: `src/features/marketing/components/marketing-nav.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS`, `CTA`, `SITE` (Task 8), `marketingButton` (Task 8), `BookloWordmark`
- Produces: `MarketingNav()` client component

- [ ] **Step 1: Write the component**

```tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { CTA, NAV_LINKS, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { BookloWordmark } from "./booklo-mark";

/* Logo left, links centre (md+), Log in + Get started right, hamburger below
   md with a blurred dropdown (spec §3.3). The dropdown closes on link click
   and on Escape. */
export function MarketingNav() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="animate-fade-down relative z-20">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5 lg:px-10"
      >
        <Link href={SITE.links.home} className="text-foreground text-[20px] sm:text-[22px]">
          <BookloWordmark />
        </Link>

        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-foreground/75 hover:text-foreground text-[13px] transition-colors">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Link href={SITE.links.login} className={marketingButton("quiet", "text", "hidden sm:inline-flex")}>
            {CTA.login}
          </Link>
          <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
            {CTA.getStarted}
          </Link>
          <button
            type="button"
            className="text-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-full md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="mobile-nav"
          className="animate-fade-up bg-card/80 ring-border absolute top-full right-4 left-4 rounded-2xl px-5 py-3 shadow-lg ring-1 backdrop-blur-xl md:hidden"
        >
          <ul>
            {[...NAV_LINKS, { label: CTA.login, href: SITE.links.login }].map((l) => (
              <li key={l.href} className="border-border border-b last:border-b-0">
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="text-foreground/80 hover:text-foreground block py-3 text-[15px]"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
```

- [ ] **Step 2: Lint; commit**

Run: `npm run lint`
Expected: clean for this file.

```bash
git add src/features/marketing/components/marketing-nav.tsx
git commit -m "feat(landing): nav with mobile dropdown"
```

---

### Task 10: Claim bar

**Files:**
- Create: `src/features/marketing/components/claim-bar.tsx`

**Interfaces:**
- Consumes: `checkHandle` (Task 3), `normalizeHandle`, `HANDLE_RE`, `isReservedHandle` (Task 1), `CLAIM`, `SITE` (Task 8)
- Produces: `ClaimBar({ handle, onHandleChange, host, size?, autoFocus?, className? })` client component. Navigates to `/signup?handle=<h>` on success.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { checkHandle, type HandleCheck } from "@/features/scheduling/handle-actions";
import { HANDLE_RE, isReservedHandle, normalizeHandle } from "@/features/scheduling/handle";
import { CLAIM, SITE } from "@/features/marketing/site";
import { cn } from "@/lib/utils";

/* "booklo.co/ your-name [→]" (spec §3.5). Controlled: the hero owns the
   handle so the mockup can mirror it. Checks availability on submit only —
   a public page shouldn't hit the DB on every keystroke. */
export function ClaimBar({
  handle,
  onHandleChange,
  host,
  size = "lg",
  autoFocus = false,
  className,
}: {
  handle: string;
  onHandleChange: (next: string) => void;
  host: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const id = React.useId();
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<HandleCheck | null>(null);
  const url = `${host}/${handle}`;
  const complete = HANDLE_RE.test(handle) && !isReservedHandle(handle);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) {
      setResult({ status: "invalid" });
      return;
    }
    startTransition(async () => {
      const r = await checkHandle(handle);
      if (r.status === "free" || r.status === "error") {
        // A failed check never blocks the claim: onboarding re-checks.
        router.push(`${SITE.links.signup}?handle=${encodeURIComponent(handle)}`);
        if (r.status === "error") setResult(r);
        return;
      }
      setResult(r);
    });
  };

  let status: React.ReactNode = CLAIM.hint;
  let tone = "text-muted-foreground";
  if (result?.status === "invalid") {
    status = handle && isReservedHandle(handle) ? CLAIM.unavailable : CLAIM.hint;
    tone = "text-destructive";
  } else if (result?.status === "taken") {
    const suggestion = result.suggestion;
    status = (
      <>
        {CLAIM.taken(url)}
        {" — "}
        {suggestion ? (
          <>
            {CLAIM.tryPrefix}
            <button
              type="button"
              className="text-foreground underline underline-offset-2"
              onClick={() => {
                onHandleChange(suggestion);
                setResult(null);
              }}
            >
              {suggestion}
            </button>
          </>
        ) : (
          CLAIM.tryAnother
        )}
      </>
    );
    tone = "text-destructive";
  } else if (result?.status === "error") {
    status = CLAIM.checkFailed;
  }

  const tall = size === "lg";

  return (
    <form onSubmit={submit} className={cn("w-full", className)} noValidate>
      <div
        className={cn(
          "bg-card ring-border focus-within:ring-highlight flex items-center gap-2 rounded-full shadow-sm ring-1 focus-within:ring-2",
          tall ? "py-1.5 pr-1.5 pl-5" : "py-1 pr-1 pl-4",
        )}
      >
        <label htmlFor={id} className="text-foreground shrink-0 font-mono text-sm sm:text-base">
          {host}/
        </label>
        <input
          id={id}
          value={handle}
          onChange={(e) => {
            onHandleChange(normalizeHandle(e.target.value));
            setResult(null);
          }}
          placeholder={CLAIM.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          maxLength={50}
          autoFocus={autoFocus}
          aria-label="Your page name"
          aria-describedby={`${id}-status`}
          aria-invalid={result?.status === "invalid" || result?.status === "taken" || undefined}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none sm:text-base"
        />
        <button
          type="submit"
          disabled={pending || handle.length < 3}
          aria-label={CLAIM.button}
          className={cn(
            "bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 motion-reduce:transition-none",
            tall ? "size-9 sm:size-10" : "size-8",
          )}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="size-4 sm:size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
      <p id={`${id}-status`} aria-live="polite" className={cn("mt-2 min-h-5 text-sm", tone)}>
        {status}
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Lint; commit**

Run: `npm run lint`
Expected: clean for this file.

```bash
git add src/features/marketing/components/claim-bar.tsx
git commit -m "feat(landing): claim bar — normalised input, availability on submit, suggestion, → /signup?handle="
```

---

### Task 11: Browser frame (scaled) + booking-page mock

**Files:**
- Create: `src/features/marketing/components/browser-frame.tsx`
- Create: `src/features/marketing/components/mocks/booking-page-mock.tsx`

**Interfaces:**
- Consumes: `toDisplayName` (Task 1)
- Produces:
  - `ScaledFrame({ designWidth?: number; children; className? })` — renders children at `designWidth` px and scales to fit
  - `BrowserFrame({ url: string; children })` — chrome around children
  - `BookingPageMock({ handle: string })` — static page at 896px design width

- [ ] **Step 1: ScaledFrame + chrome**

`src/features/marketing/components/browser-frame.tsx`:

```tsx
"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Copy, Lock, PanelLeft, Plus, RotateCw, Share } from "lucide-react";
import { cn } from "@/lib/utils";

/* Renders children at a fixed design width and scales the whole block down
   to its container with transform: scale() (spec §3.6). The outer height is
   set from the inner's measured height × scale so layout below never
   overflows. SSR renders at scale 1; the first ResizeObserver tick corrects
   it (hidden by the hero-rise animation). */
export function ScaledFrame({
  designWidth = 896,
  children,
  className,
}: {
  designWidth?: number;
  children: React.ReactNode;
  className?: string;
}) {
  const outer = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [height, setHeight] = React.useState<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const s = Math.min(1, o.clientWidth / designWidth);
      setScale(s);
      setHeight(i.offsetHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [designWidth]);

  return (
    <div ref={outer} className={cn("w-full overflow-hidden", className)} style={{ height }}>
      <div ref={inner} style={{ width: designWidth, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/* Light browser chrome: traffic lights, nav icons, a URL pill, actions. */
export function BrowserFrame({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div className="bg-card ring-border overflow-hidden rounded-t-2xl text-left shadow-[0_-20px_80px_rgb(0_0_0/0.12)] ring-1">
      <div className="bg-secondary border-border flex items-center gap-3 border-b px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="text-foreground/30 flex items-center gap-2">
          <PanelLeft className="size-3.5" aria-hidden="true" />
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
        </div>
        <div className="bg-card text-foreground/60 mx-auto flex items-center gap-1.5 rounded-md px-6 py-1 font-mono text-[10px]">
          <Lock className="size-3" aria-hidden="true" />
          <span>{url}</span>
        </div>
        <div className="text-foreground/30 flex items-center gap-2">
          <RotateCw className="size-3.5" aria-hidden="true" />
          <Share className="size-3.5" aria-hidden="true" />
          <Plus className="size-3.5" aria-hidden="true" />
          <Copy className="size-3.5" aria-hidden="true" />
        </div>
      </div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Booking page mock**

`src/features/marketing/components/mocks/booking-page-mock.tsx`:

```tsx
import { toDisplayName } from "@/features/scheduling/handle";
import { cn } from "@/lib/utils";

/* What a client sees at booklo.co/<handle>: name, two services, a month grid
   with a few open days, a slot column. Static fixtures, 896px design width
   (scaled by ScaledFrame). The name follows the claim bar live. */

const SERVICES = [
  { name: "Consultation", duration: "30 min", selected: true },
  { name: "Follow-up", duration: "15 min", selected: false },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// 35 cells: null = previous/next month, number = day; open days are bookable.
const OPEN = new Set([3, 4, 5, 10, 11, 12, 17, 18, 19, 24, 25, 26]);
const SELECTED_DAY = 11;
const DAYS: (number | null)[] = [null, null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, null, null, null];
const SLOTS = ["9:00", "10:30", "13:00", "14:30", "16:00"];
const SELECTED_SLOT = "10:30";

export function BookingPageMock({ handle }: { handle: string }) {
  const name = toDisplayName(handle) || "Your Name";
  const initial = name[0]?.toUpperCase() ?? "Y";

  return (
    // The caption is the only thing assistive tech gets; the decorative
    // grid is hidden. `contents` keeps the two columns in the figure's grid.
    <figure className="bg-background grid grid-cols-[300px_1fr] gap-0">
      <figcaption className="sr-only">Preview of a Booklo booking page</figcaption>
      <div className="contents" aria-hidden="true">

      {/* left: identity + services */}
      <div className="border-border flex flex-col gap-6 border-r p-8">
        <div className="flex items-center gap-3">
          <div className="bg-highlight text-primary-foreground flex size-10 items-center justify-center rounded-full text-sm font-medium">
            {initial}
          </div>
          <div>
            <p className="text-foreground text-lg leading-tight font-medium">{name}</p>
            <p className="text-muted-foreground text-xs">Book a session</p>
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {SERVICES.map((s) => (
            <li
              key={s.name}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm ring-1",
                s.selected ? "bg-card ring-highlight" : "ring-border",
              )}
            >
              <span className="text-foreground">{s.name}</span>
              <span className="text-muted-foreground text-xs">{s.duration}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* right: month + slots */}
      <div className="grid grid-cols-[1fr_120px] gap-6 p-8">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-foreground text-sm font-medium">October</p>
            <div className="text-muted-foreground flex gap-2 text-xs">
              <span>‹</span>
              <span>›</span>
            </div>
          </div>
          <div className="text-muted-foreground mb-2 grid grid-cols-7 text-center text-[10px]">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {DAYS.map((d, i) => (
              <div
                key={i}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md text-xs",
                  d === null && "opacity-0",
                  d !== null && !OPEN.has(d) && "text-muted-foreground/60",
                  d !== null && OPEN.has(d) && d !== SELECTED_DAY && "bg-card text-foreground ring-border font-medium ring-1",
                  d === SELECTED_DAY && "bg-highlight text-primary-foreground font-medium",
                )}
              >
                {d ?? ""}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-[10px] tracking-wider uppercase">Wed {SELECTED_DAY}</p>
          {SLOTS.map((t) => (
            <div
              key={t}
              className={cn(
                "rounded-md px-3 py-2 text-center text-xs ring-1",
                t === SELECTED_SLOT ? "bg-highlight text-primary-foreground ring-highlight" : "bg-card text-foreground ring-border",
              )}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
      </div>
    </figure>
  );
}
```

- [ ] **Step 3: Lint; commit**

Run: `npm run lint`
Expected: clean for these files.

```bash
git add src/features/marketing/components/browser-frame.tsx src/features/marketing/components/mocks/booking-page-mock.tsx
git commit -m "feat(landing): ScaledFrame + browser chrome, booking-page mock that mirrors the typed handle"
```

---

### Task 12: Hero, sections, page composition

**Files:**
- Rewrite: `src/features/marketing/components/hero.tsx`, `how-it-works.tsx`, `final-cta.tsx`
- Modify: `src/features/marketing/components/faq.tsx` (token check only), `src/app/(marketing)/page.tsx`

**Interfaces:**
- Consumes: `ClaimBar` (Task 10), `ScaledFrame`/`BrowserFrame`/`BookingPageMock` (Task 11), `MarketingNav` (Task 9), `SITE`/`SECTIONS`/`STEPS`/`FINAL_CTA`/`anchorId` (Task 8), `hostLabel` (Task 4)
- Produces: `Hero({ host })`, `FinalCta({ host })`, `HowItWorks()`; `LandingPage` passes `host` from `env.NEXT_PUBLIC_APP_URL`

- [ ] **Step 1: Hero**

`src/features/marketing/components/hero.tsx`:

```tsx
"use client";

import * as React from "react";
import { SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";
import { BrowserFrame, ScaledFrame } from "./browser-frame";
import { BookingPageMock } from "./mocks/booking-page-mock";

/* Full-viewport hero (spec §3.4): two-line headline, claim bar, mockup that
   mirrors the typed handle. The hero owns the handle state. */
export function Hero({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  const [line1, line2] = SITE.headline;
  const words = line2.split(" ");
  const last = words.pop();

  return (
    <section
      aria-labelledby="hero-heading"
      className="bg-background relative flex min-h-[100svh] flex-col overflow-hidden"
    >
      <div className="flex-1 shrink-0 min-h-8 sm:min-h-12 lg:min-h-16" />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center px-5 text-center">
        <h1
          id="hero-heading"
          className="text-foreground text-[40px] leading-[1.05] font-normal tracking-tight min-[400px]:text-[44px] sm:text-6xl lg:text-7xl xl:text-[80px]"
        >
          <span className="sr-only">{`${line1} ${line2}`}</span>
          <span aria-hidden="true">
            <span className="animate-fade-up block">{line1}</span>
            <span className="animate-fade-up block [animation-delay:100ms]">
              {words.join(" ")}{" "}
              <span className="relative inline-block">
                <span className="bg-highlight/30 absolute inset-x-[-0.05em] inset-y-[0.12em] -skew-x-6 rounded-sm" aria-hidden="true" />
                <span className="relative">{last}</span>
              </span>
            </span>
          </span>
        </h1>

        <p className="animate-fade-up text-foreground/75 mt-4 max-w-md text-sm [animation-delay:220ms] sm:mt-5 sm:text-base lg:text-lg">
          {SITE.subheadline}
        </p>

        <ClaimBar
          handle={handle}
          onHandleChange={setHandle}
          host={host}
          size="lg"
          className="animate-fade-up mt-5 max-w-xl [animation-delay:340ms] sm:mt-6"
        />

        <p className="animate-fade-up text-muted-foreground text-sm [animation-delay:460ms]">{SITE.heroNote}</p>
      </div>

      <div className="flex-1 shrink-0 min-h-10 sm:min-h-12 lg:min-h-16" />

      {/* wash under the mockup */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[45%] bg-[radial-gradient(60%_80%_at_50%_100%,color-mix(in_oklch,var(--highlight)_12%,transparent),transparent)]"
      />

      <div className="animate-hero-rise relative z-[1] mx-auto -mb-10 w-[92%] max-w-4xl shrink-0 [animation-delay:620ms] sm:-mb-20 sm:w-[84%] lg:-mb-32 lg:w-[72%]">
        <ScaledFrame designWidth={896}>
          <BrowserFrame url={`${host}/${handle || "your-name"}`}>
            <BookingPageMock handle={handle} />
          </BrowserFrame>
        </ScaledFrame>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: How it works (three one-liners)**

`src/features/marketing/components/how-it-works.tsx`:

```tsx
import { anchorId, SECTIONS, SITE, STEPS } from "@/features/marketing/site";

export function HowItWorks() {
  return (
    <section id={anchorId(SITE.anchors.how)} aria-labelledby="how-heading" className="bg-background relative scroll-mt-20 pt-16 sm:pt-28 lg:pt-40">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:px-8 md:py-24">
        <h2 id="how-heading" className="text-foreground text-3xl font-normal tracking-tight md:text-4xl">
          {SECTIONS.how.heading}
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl">{SECTIONS.how.sub}</p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.number} className="border-border border-t pt-5">
              <span className="text-highlight font-mono text-sm tabular-nums">{s.number}</span>
              <h3 className="text-foreground mt-3 text-lg font-medium tracking-tight text-balance">{s.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

(The top padding absorbs the mockup's negative bottom margin from the hero.)

- [ ] **Step 3: Final CTA**

`src/features/marketing/components/final-cta.tsx`:

```tsx
"use client";

import * as React from "react";
import { FINAL_CTA, SITE } from "@/features/marketing/site";
import { ClaimBar } from "./claim-bar";

export function FinalCta({ host }: { host: string }) {
  const [handle, setHandle] = React.useState("");
  return (
    <section aria-labelledby="cta-heading" className="bg-secondary/60 border-border border-t">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-20 text-center sm:px-8 md:py-28">
        <h2 id="cta-heading" className="text-foreground text-3xl font-normal tracking-tight text-balance md:text-5xl">
          {FINAL_CTA.heading}
        </h2>
        <ClaimBar handle={handle} onHandleChange={setHandle} host={host} size="md" className="mt-8 max-w-lg" />
        <p className="text-muted-foreground mt-2 text-sm">{SITE.heroNote}</p>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: FAQ token pass**

In `faq.tsx`, change `className="scroll-mt-20 border-t"` → `className="border-border scroll-mt-20 border-t"` and the heading to `font-normal`. Nothing else — it already uses tokens.

- [ ] **Step 5: Page**

`src/app/(marketing)/page.tsx`:

```tsx
import { env } from "@/env";
import { hostLabel } from "@/lib/booking/url";
import { MarketingNav } from "@/features/marketing/components/marketing-nav";
import { MarketingFooter } from "@/features/marketing/components/marketing-footer";
import { Hero } from "@/features/marketing/components/hero";
import { HowItWorks } from "@/features/marketing/components/how-it-works";
import { Faq } from "@/features/marketing/components/faq";
import { FinalCta } from "@/features/marketing/components/final-cta";

export default function LandingPage() {
  const host = hostLabel(env.NEXT_PUBLIC_APP_URL);
  return (
    <>
      <MarketingNav />
      <main className="flex-1">
        <Hero host={host} />
        <HowItWorks />
        <Faq />
        <FinalCta host={host} />
      </main>
      <MarketingFooter />
    </>
  );
}
```

- [ ] **Step 6: Full verify**

Run: `npm run verify`
Expected: lint clean, typecheck clean (the `hero-reveal.module.css` import is gone; `SITE.headline` consumers updated), unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/marketing/components src/app/\(marketing\)/page.tsx src/features/marketing/site.ts
git commit -m "feat(landing): light minimal page — hero with claim bar + mirrored mockup, how it works, FAQ, final CTA"
```

---

### Task 13: Manual QA, graph update, notes

**Files:**
- Modify: `docs/superpowers/plans/2026-08-23-landing-claim.md` (QA findings), memory note

- [ ] **Step 1: Start the stack and the app**

Run: `supabase status` (start if needed), `npm run dev` in the background. Mailpit is at `http://localhost:54354` (local ports shifted +30).

- [ ] **Step 2: Landing, three widths, reduced motion**

With the Playwright MCP: navigate to `http://localhost:3000/`, resize to 375×812, 768×1024, 1280×800; screenshot each. Check: no horizontal scroll (`document.documentElement.scrollWidth === innerWidth`), headline two lines, claim bar ≤ `max-w-xl`, mockup scaled (its outer height equals the inner height × scale, no overflow into How it works beyond the intended overlap), nav links hidden < 768 and the hamburger opens/closes (Escape closes). Emulate `prefers-reduced-motion: reduce` and confirm everything is visible immediately.

- [ ] **Step 3: Claim → signup → confirm → onboarding → welcome**

1. Type `Anna Test` into the claim bar → field shows `anna-test`; the mockup URL bar reads `localhost:3000/anna-test` and the title `Anna Test`.
2. Submit → lands on `/signup?handle=anna-test` with "Claiming localhost:3000/anna-test".
3. Sign up with a fresh email; open Mailpit, click the confirmation link → `/auth/confirm` → `/bookings` → `requireOrg` → `/onboarding`.
4. Onboarding shows name `Anna Test`, handle `anna-test`, status "… is free", timezone = the browser's.
5. Submit → `/bookings?welcome=1` with the banner "localhost:3000/anna-test is yours." Copy link copies `http://localhost:3000/anna-test`. Dismiss → banner gone.
6. `curl -sI http://localhost:3000/anna-test` → 404 (no services yet). Add a service in `/services`; reload `/anna-test` → the booking page renders. `curl -sI http://localhost:3000/book/anna-test` → 308 to `/anna-test`.
7. Second browser context: claim `anna-test` again → "… is taken — try anna-test-studio"; click the suggestion → field updates.
8. Claim `login` → "That name can't be used".

- [ ] **Step 4: Record deviations, update the graph and memory**

Append a `## QA notes` section to this plan file with anything fixed during QA. Run `graphify update .`. Update `~/.claude/projects/…/memory/landing-claim-notes.md` status from "NOT built" to "built on feat/landing-claim; PR pending" with any deferred follow-ups.

- [ ] **Step 5: Commit and open the PR**

```bash
git add -A
git commit -m "docs: landing-claim QA notes"
gh pr create --title "feat(landing): light minimal landing + claim-your-page onboarding + root short links" --body "$(cat <<'EOF'
## Summary
- Light, minimal landing: centred two-line headline, `booklo.co/ your-name → Claim` bar, browser-chrome mockup of the public booking page that mirrors what you type; How it works → FAQ → final CTA.
- Claim flow: public `is_handle_available` RPC (0047) → `/signup?handle=` → `user_metadata.claimed_handle` → one-step onboarding (name / handle / timezone) via `create_org_with_page` → `/bookings?welcome=1`.
- Public page now at `/<handle>` (and `/<handle>/<staffSlug>`); `/book/…` 308s. Reserved-handle list mirrored DB ↔ TS with a parity test.

Spec: docs/superpowers/specs/2026-08-23-landing-claim-design.md

## Test plan
- [ ] `npm run verify`
- [ ] `npm run test:integration` (0047 functions)
- [ ] Manual: claim → signup → Mailpit confirm → onboarding pre-filled → welcome banner → `/<handle>` after first service; `/book/<handle>` redirects

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
