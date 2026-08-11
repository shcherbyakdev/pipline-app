# Clients + Portal (Slice 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `clients` + `units.client_id`, org branding (accent + logo), and the read-only client-scoped `/portal/[token]` surface — the spec is `docs/superpowers/specs/2026-08-10-clients-portal-design.md`.

**Architecture:** A second dedicated anon-callable SECURITY DEFINER resolver (`resolve_portal_token`) beside the participant one, each filtering its own `kind`. Portal reads run on the admin client through the `lib/tokens` chokepoint (split into `participant.ts`/`portal.ts` behind the existing barrel). Branding lives on `orgs` (written only via a definer RPC), logos in a public `branding` bucket with zero storage policies. Console gets `/clients`, `/clients/[id]` (owning the portal-links panel), a per-unit client picker, and `/settings`.

**Tech Stack:** Next 16 (App Router, server actions, typed `PageProps`), Supabase (Postgres RLS + definer RPCs + Storage), Drizzle migrations, Zod 4, Vitest (unit + integration against the local stack).

## Global Constraints

Every task inherits these; they are spec/convention rules, not suggestions.

- **Branch:** work on `feat/clients-portal` (already cut from main; spec committed as `7b14cd5`).
- **Local stack required** for migrations + integration tests: `npm run setup` (ports shifted +30; see memory). Run `npm run db:migrate` after every migration task.
- Every new table: `org_id` column, **index every column an RLS policy references**, **explicit GRANTs in the same migration** (newer CI images ship no default ACLs — PR #8 lesson).
- 0013's `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM anon` is in force: new tables are born anon-free; do NOT add anon grants beyond `EXECUTE` on the two anon RPCs.
- **Tokens are never logged** — not even at error level. Uniform "not found" on the anon surface: scope mismatch → 404/empty, never 403.
- **No person's name may enter any portal type.** Portal queries never join `participants`; `PortalItem`/`PortalPhoto`/`PortalStage` have no field that can carry a name.
- **Done expands; pending is a name plus "awaiting".** Pending stages carry `items: []` — enforced in the reader, asserted in tests.
- Portal token scope CHECK: `kind='portal'` ⇒ `client_id` set, `participant_id`/`program_id`/`unit_id` all null. Participant CHECK tightened with `client_id IS NULL`.
- Logos: PNG/JPEG/WebP only (**no SVG**), 1 MB cap, path `org_id/logo-<sha256>.<ext>` in the public `branding` bucket; accent colour stored as lowercase `#rrggbb` (column CHECK).
- Deleting a client cascades its tokens and nulls its units — deliberate, precedented (participants), spelled out in the delete confirm copy.
- SQL functions: `SECURITY DEFINER` + `SET search_path = ''`, schema-qualified references, `REVOKE ALL ... FROM public, anon, authenticated, service_role` then grant exactly one role (0013 idiom).
- After code changes in a task: `npm run verify` must pass (lint + typecheck + unit tests). Integration tasks also run their file via `npm run test:integration -- <path>`.
- After the final task, run `graphify update .` (project rule).

## File Structure

```
src/db/schema/clients.ts                      NEW    clients table
src/db/schema/orgs.ts                         MOD    + accentColor, logoPath
src/db/schema/programs.ts                     MOD    units + clientId (+ index)
src/db/schema/participants.ts                 MOD    accessTokens + clientId (+ index)
src/db/schema/index.ts                        MOD    + clients export
src/db/migrations/0017_*.sql                  GEN    drizzle-generated DDL
src/db/migrations/0018_clients_portal_security.sql  NEW  bucket, CHECKs, RLS,
                                                     grants, guards, RPCs
src/lib/tokens/index.ts                       MOD    becomes a barrel
src/lib/tokens/participant.ts                 NEW    moved VERBATIM from index.ts
src/lib/tokens/portal.ts                      NEW    portal resolver + readers
src/lib/tokens/rate-limit.ts                  MOD    + shared limiter instance + clientKeyFrom
src/lib/tokens/mint.ts                        MOD    generateParticipantToken → generateAccessToken
src/lib/storage/branding.ts                   NEW    bucket const, public URL, upload/delete, caps
src/lib/org-branding.ts                       NEW    getOrgBranding(orgId) admin read
src/components/branded-header.tsx             NEW    shared /p + /portal header
src/features/clients/schema.ts                NEW    Zod inputs
src/features/clients/schema.test.ts           NEW
src/features/clients/actions.ts               NEW    CRUD + assign + portal links
src/features/clients/queries.ts               NEW    RLS-scoped console reads
src/features/clients/components/create-client-dialog.tsx   NEW
src/features/clients/components/client-header.tsx           NEW
src/features/clients/components/portal-links-panel.tsx      NEW
src/features/clients/components/assign-client.tsx           NEW
src/features/clients/portal-tokens.integration.test.ts      NEW  SQL surface
src/features/clients/portal-readers.integration.test.ts     NEW  reader functions
src/features/orgs/schema.ts                   MOD    + accent input
src/features/orgs/actions.ts                  MOD    + updateAccent/uploadLogo/removeLogo
src/features/orgs/queries.ts                  NEW    getBrandingSettings
src/features/orgs/components/branding-form.tsx NEW
src/features/orgs/schema.test.ts              MOD    + accent cases
src/lib/storage/branding.test.ts              NEW
src/app/(dashboard)/clients/page.tsx          NEW
src/app/(dashboard)/clients/[id]/page.tsx     NEW
src/app/(dashboard)/settings/page.tsx         NEW
src/app/portal/layout.tsx                     NEW
src/app/portal/[token]/page.tsx               NEW    home
src/app/portal/[token]/units/[unitId]/page.tsx NEW   unit detail
src/app/p/[token]/page.tsx                    MOD    BrandedHeader
src/app/p/[token]/units/[unitId]/page.tsx     MOD    BrandedHeader
src/components/shell/nav.ts                   MOD    + Clients, + Settings
src/components/command-menu.tsx               MOD    + Clients nav / create
src/features/programs/queries.ts              MOD    Unit + clientId
src/features/programs/components/unit-list.tsx MOD   thread clients
src/features/programs/components/unit-row.tsx  MOD   + AssignClient
src/app/(dashboard)/programs/[id]/page.tsx    MOD    fetch client options
src/features/participants/actions.ts          MOD    generateAccessToken rename
scripts/seed.ts                               MOD    demo client + portal link
```

---

### Task 1: Drizzle schema + generated migration

**Files:**
- Create: `src/db/schema/clients.ts`
- Modify: `src/db/schema/orgs.ts`, `src/db/schema/programs.ts` (units), `src/db/schema/participants.ts` (accessTokens), `src/db/schema/index.ts`
- Generated: `src/db/migrations/0017_<codename>.sql` (drizzle names it)

**Interfaces:**
- Consumes: existing `orgs`, `programs`/`units`, `accessTokens` tables.
- Produces: `clients` table export; `units.client_id`, `access_tokens.client_id`, `orgs.accent_color`, `orgs.logo_path` columns. CHECKs/RLS/grants/triggers deliberately deferred to Task 2 (repo convention: security surface lives in custom SQL).

No import cycles: `clients.ts` imports only `orgs`; `programs.ts` and `participants.ts` may import `clients.ts` (unlike the 0013 participant FKs, no deferral needed).

- [ ] **Step 1: Create `src/db/schema/clients.ts`**

```ts
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orgs } from "./orgs";

// The customer's customer — scopes the read-only portal. RLS (member CRUD),
// grants, and the org-guard trigger live in 0018 (custom SQL keeps the
// security surface in one reviewable place, the 0013 idiom).
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("clients_org_id_idx").on(t.orgId),
    // A duplicate "Acme Retail Ltd" is a typo, not a case.
    uniqueIndex("clients_org_lower_name_uq").on(t.orgId, sql`lower(${t.name})`),
  ],
);
```

- [ ] **Step 2: Add branding columns to `src/db/schema/orgs.ts`**

In the `orgs` table, after `slug`:

```ts
  // Portal/participant-surface branding. Written ONLY via the
  // update_org_branding definer RPC (orgs stays select-only for
  // authenticated — 0004). Hex CHECK lives in 0018.
  accentColor: text("accent_color"),
  logoPath: text("logo_path"),
```

- [ ] **Step 3: Add `units.clientId` in `src/db/schema/programs.ts`**

Add `import { clients } from "./clients";` at the top. In `units`, after `assignedParticipantId`:

```ts
    // The customer's customer this unit belongs to; scopes the portal.
    // Set-null keeps the unit (and its history) when a client is deleted.
    // Guard trigger in 0018 pins the client to the unit's org.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
```

And in the units index list add:

```ts
    index("units_client_id_idx").on(t.clientId),
```

- [ ] **Step 4: Add `accessTokens.clientId` in `src/db/schema/participants.ts`**

Add `import { clients } from "./clients";` at the top. In `accessTokens`, after `participantId`:

```ts
    // Portal tokens only (kind='portal'); CHECK in 0018 keeps the two kinds'
    // scope columns mutually exclusive. Cascade: when the client goes, its
    // link history goes with it (the participants precedent).
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
```

And in the index list add:

```ts
    index("access_tokens_client_id_idx").on(t.clientId),
```

- [ ] **Step 5: Export from the barrel `src/db/schema/index.ts`**

Add `export * from "./clients";` and update the header comment's table list.

- [ ] **Step 6: Generate + inspect + apply**

Run: `npm run db:generate`
Expected: one new `src/db/migrations/0017_*.sql` creating `clients`, adding the four columns, FKs, and the three indexes (including the `lower(name)` unique index). Inspect it — no policies/grants should appear (drizzle doesn't emit them; they come in Task 2).

Run: `npm run db:migrate`
Expected: applies cleanly against the local stack.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run verify`
Expected: PASS (schema-only change; no behavior yet).

```bash
git add src/db/schema src/db/migrations
git commit -m "feat: clients table + client_id/branding columns (slice 9)"
```

---

### Task 2: Custom migration — security surface + RPCs

**Files:**
- Create: `src/db/migrations/0018_clients_portal_security.sql` (via `npx drizzle-kit generate --custom --name=clients_portal_security`)

**Interfaces:**
- Consumes: Task 1's tables/columns; 0013's `check_access_token_org`, `user_orgs()`, pgcrypto in schema `extensions`.
- Produces: `branding` bucket; `resolve_portal_token(p_token text) → (status, org_id, org_name, client_id, client_name)` (anon EXECUTE); `update_org_branding(p_org_id uuid, p_accent_color text, p_logo_path text)` (authenticated EXECUTE, full-state semantics); clients RLS + grants; `GRANT UPDATE (client_id) ON units`; guards.

- [ ] **Step 1: Scaffold the custom migration**

Run: `npx drizzle-kit generate --custom --name=clients_portal_security`
Expected: empty `src/db/migrations/0018_clients_portal_security.sql` + journal entry.

- [ ] **Step 2: Write the migration**

```sql
-- Custom SQL migration file, put your code below! --

-- Clients + portal security model (slice 9):
--   * clients: ordinary member-CRUD rows (participants pattern, 0013).
--   * Portal tokens are CLIENT-scoped only; the CHECK below makes narrower
--     portal scopes unrepresentable. Participant CHECK tightened
--     symmetrically (client_id must be null there).
--   * resolve_portal_token is a SECOND dedicated resolver — deliberately
--     not a generalised one. Each resolver filters its own kind, so
--     cross-kind confusion is structurally impossible.
--   * NO write RPCs exist for portal tokens: read-only is not a UI
--     property; there is no SQL a portal token can reach that writes.
--   * orgs branding is written ONLY via update_org_branding (orgs keeps its
--     select-only grant from 0004).
--   * Deleting a client cascades its tokens (FK-level, past grants/RLS —
--     the participants precedent; 0013's "no delete policy" guards direct
--     member deletes, not lifecycle cascades) and nulls its units.

-- ---------- Branding bucket (PUBLIC read: logos are not secrets, and
-- public read means no signing on every portal load. Zero storage
-- policies — writes only via the server-only admin client, the slice-8
-- bucket-authority precedent. Caps enforced at the storage floor too.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- CHECKs
alter table public.orgs
  add constraint orgs_accent_color_check
  check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$');

alter table public.access_tokens
  add constraint access_tokens_portal_scope_check
  check (kind <> 'portal' or (client_id is not null
    and participant_id is null and program_id is null and unit_id is null));

-- Tightened: a participant token must not carry a client_id. Safe drop +
-- re-add — client_id is brand new, every existing row has it null.
alter table public.access_tokens
  drop constraint access_tokens_participant_scope_check;
alter table public.access_tokens
  add constraint access_tokens_participant_scope_check
  check (kind <> 'participant'
    or (participant_id is not null and program_id is not null and client_id is null));

-- ---------- RLS + grants: clients (participants pattern, 0013)
alter table public.clients enable row level security;

create policy "clients_select_member" on public.clients
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "clients_insert_member" on public.clients
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "clients_update_member" on public.clients
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "clients_delete_member" on public.clients
  for delete to authenticated using (org_id in (select public.user_orgs()));

-- 0004 convention; blanket-ACL revoke first (0011 lesson).
revoke insert, update, delete on table public.clients from authenticated;
grant select, insert, update, delete on table public.clients to authenticated;
grant select, insert, update, delete on table public.clients to service_role;
-- (0013's default-privileges revoke already keeps anon at zero here.)

-- units: additive column grant for client assignment (0008 scoped the
-- update grant per-column; 0013 added assigned_participant_id the same way).
grant update (client_id) on table public.units to authenticated;

-- ---------- Guard: a unit's client must belong to the unit's org.
-- SECURITY INVOKER (check_template_stage_org precedent): foreign clients
-- are RLS-invisible and read as 'not found' rather than leaking existence.
-- Fires on UPDATE OF client_id, so ON DELETE SET NULL passes through
-- (null skips the check).
create or replace function public.check_unit_client()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.client_id is not null then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger units_check_client
before insert or update of client_id, org_id on public.units
for each row execute function public.check_unit_client();

-- ---------- Guard: token scope org-consistency, portal branch added.
-- Recreated VERBATIM from 0013 plus the kind='portal' block.
create or replace function public.check_access_token_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_unit record;
begin
  if new.kind = 'participant' then
    select org_id into v_org from public.participants where id = new.participant_id;
    if v_org is null then raise exception 'participant not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;

    select org_id into v_org from public.programs where id = new.program_id;
    if v_org is null then raise exception 'program not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;

    if new.unit_id is not null then
      select org_id, program_id into v_unit from public.units where id = new.unit_id;
      if v_unit.org_id is null then raise exception 'unit not found'; end if;
      if v_unit.org_id <> new.org_id or v_unit.program_id <> new.program_id then
        raise exception 'org mismatch';
      end if;
    end if;
  end if;

  if new.kind = 'portal' then
    select org_id into v_org from public.clients where id = new.client_id;
    if v_org is null then raise exception 'client not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;

  return new;
end;
$$;

-- ---------- The portal validity authority (0013 resolver skeleton:
-- length guard, sha256 via extensions.digest, kind filter, throttled
-- last_used_at for revocation hygiene, uniform empty result).
create or replace function public.resolve_portal_token(p_token text)
returns table(
  status text, org_id uuid, org_name text,
  client_id uuid, client_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_tok public.access_tokens;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    return;
  end if;
  v_hash := encode(extensions.digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex');
  select * into v_tok
    from public.access_tokens t
   where t.token_hash = v_hash and t.kind = 'portal';
  if v_tok.id is null then
    return;
  end if;
  if v_tok.last_used_at is null or v_tok.last_used_at < now() - interval '60 seconds' then
    update public.access_tokens set last_used_at = now() where id = v_tok.id;
  end if;
  return query
    select case
             when v_tok.revoked_at is not null then 'revoked'
             when v_tok.expires_at < now() then 'expired'
             else 'ok'
           end,
           v_tok.org_id, o.name, v_tok.client_id, c.name
      from public.orgs o, public.clients c
     where o.id = v_tok.org_id and c.id = v_tok.client_id;
end;
$$;

revoke all on function public.resolve_portal_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_portal_token(text) to anon;

-- ---------- Branding writes. orgs stays select-only for authenticated;
-- this RPC is the only write path. FULL-STATE semantics: callers pass the
-- complete desired branding every call (the settings form always holds
-- both values). The prefix check pins logo_path inside the caller's own
-- org folder (record_photo_evidence precedent — defence in depth even
-- though the server action derives the path itself).
create or replace function public.update_org_branding(
  p_org_id uuid, p_accent_color text, p_logo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or p_org_id not in (select public.user_orgs()) then
    raise exception 'not found';
  end if;
  if p_logo_path is not null and p_logo_path not like p_org_id::text || '/%' then
    raise exception 'not found';
  end if;
  -- lower(): defence in depth ahead of the column CHECK (Zod already
  -- normalises); a malformed value still dies at the CHECK.
  update public.orgs
     set accent_color = lower(p_accent_color),
         logo_path = p_logo_path
   where id = p_org_id;
end;
$$;

revoke all on function public.update_org_branding(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_org_branding(uuid, text, text) to authenticated;
```

- [ ] **Step 3: Apply**

Run: `npm run db:migrate`
Expected: applies cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations
git commit -m "feat: portal token + branding security surface (slice 9)"
```

---

### Task 3: SQL-surface integration tests

**Files:**
- Create: `src/features/clients/portal-tokens.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's RPCs/CHECKs/policies; the `tokens.integration.test.ts` harness idiom (admin client, `signedInUser`, local `mint()`).
- Produces: the executable contract later tasks rely on. Nothing importable.

- [ ] **Step 1: Write the tests**

```ts
/**
 * Portal token security core (slice 9): resolve_portal_token, portal/
 * participant scope CHECKs, org guards, client lifecycle cascades, clients
 * RLS, update_org_branding. Requires the local stack (npm run setup).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { loadEnvFile } from "node:process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

try {
  loadEnvFile(".env.local");
} catch {
  // CI exports env directly.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

function mint(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

type PortalRow = {
  status: "ok" | "expired" | "revoked";
  org_id: string;
  org_name: string;
  client_id: string;
  client_name: string;
};

describe("portal tokens: resolve, scope CHECKs, guards, cascade, branding", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceId: string;
  let orgId: string;
  let bobOrgId: string;
  let programId: string;
  let unit1: string;
  let clientA: string; // Acme — unit1 belongs to it
  let clientB: string; // Bridgewater — no units
  let bobClient: string;
  let tA: { token: string; tokenHash: string };

  const resolve = async (token: string) => anon.rpc("resolve_portal_token", { p_token: token });

  beforeAll(async () => {
    alice = await signedInUser("portal_alice");
    bob = await signedInUser("portal_bob");
    const { data: me } = await alice.auth.getUser();
    aliceId = me.user!.id;
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "PortalAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { data: bOrg, error: e2 } = await bob.rpc("create_org", { p_name: "PortalBeta" });
    if (e2) throw e2;
    bobOrgId = (bOrg as { id: string }).id;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "Portal Template" }).select("id").single();
    await alice.from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 });
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "Portal Program",
    });
    if (e3) throw e3;
    programId = (program as { id: string }).id;
    const { data: u } = await alice
      .from("units").insert({ program_id: programId, org_id: orgId, name: "Site 1" })
      .select("id").single();
    unit1 = u!.id;

    const { data: cA } = await alice
      .from("clients").insert({ org_id: orgId, name: "Acme Retail" }).select("id").single();
    clientA = cA!.id;
    const { data: cB } = await alice
      .from("clients").insert({ org_id: orgId, name: "Bridgewater" }).select("id").single();
    clientB = cB!.id;
    const { data: cBob } = await bob
      .from("clients").insert({ org_id: bobOrgId, name: "BetaCorp" }).select("id").single();
    bobClient = cBob!.id;

    const { error: assignErr } = await alice
      .from("units").update({ client_id: clientA }).eq("id", unit1);
    if (assignErr) throw assignErr;

    tA = mint();
    const { error: mintErr } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tA.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    if (mintErr) throw mintErr;
  });

  it("resolves a live portal token with org + client identity", async () => {
    const { data, error } = await resolve(tA.token);
    expect(error).toBeNull();
    const row = (data as PortalRow[])[0];
    expect(row.status).toBe("ok");
    expect(row.org_name).toBe("PortalAlpha");
    expect(row.client_id).toBe(clientA);
    expect(row.client_name).toBe("Acme Retail");
  });

  it("updates last_used_at on resolve (revocation hygiene)", async () => {
    const { data } = await admin
      .from("access_tokens").select("last_used_at").eq("token_hash", tA.tokenHash).single();
    expect(data!.last_used_at).not.toBeNull();
  });

  it("unknown token resolves to empty (uniform not-found)", async () => {
    const { data, error } = await resolve(mint().token);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("kind isolation: a portal token is invisible to the participant resolver, and vice versa", async () => {
    const { data: viaParticipant } = await anon.rpc("resolve_participant_token", { p_token: tA.token });
    expect(viaParticipant).toEqual([]);

    // Mint a participant token and check the portal resolver ignores it.
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "Iso Engineer" }).select("id").single();
    const tP = mint();
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tP.tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).toBeNull();
    const { data: viaPortal } = await resolve(tP.token);
    expect(viaPortal).toEqual([]);
  });

  it("expired and revoked report their status, not not-found", async () => {
    const tExp = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tExp.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() - 1000).toISOString(), created_by: aliceId,
    });
    const { data: exp } = await resolve(tExp.token);
    expect((exp as PortalRow[])[0].status).toBe("expired");

    const tRev = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tRev.tokenHash, kind: "portal", client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    await alice.from("access_tokens")
      .update({ revoked_at: new Date().toISOString() }).eq("token_hash", tRev.tokenHash);
    const { data: rev } = await resolve(tRev.token);
    expect((rev as PortalRow[])[0].status).toBe("revoked");
  });

  it("portal scope CHECK: client required; participant/program/unit must be null", async () => {
    const noClient = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(noClient.error).not.toBeNull();

    const withProgram = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal", client_id: clientA,
      program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(withProgram.error).not.toBeNull();
  });

  it("participant scope CHECK (tightened): a participant token cannot carry a client_id", async () => {
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "Check Engineer" }).select("id").single();
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId, client_id: clientA,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).not.toBeNull();
  });

  it("org guard: minting a portal token for a foreign client fails", async () => {
    const { error } = await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: mint().tokenHash, kind: "portal", client_id: bobClient,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    expect(error).not.toBeNull(); // RLS-invisible foreign client → 'client not found'
  });

  it("org guard: assigning a foreign client to a unit fails", async () => {
    const { error } = await alice.from("units").update({ client_id: bobClient }).eq("id", unit1);
    expect(error).not.toBeNull();
  });

  it("clients RLS: cross-org rows are invisible; member CRUD works", async () => {
    const { data: bobSees } = await bob.from("clients").select("id").eq("id", clientA);
    expect(bobSees).toEqual([]);
    const { error: renameErr } = await alice
      .from("clients").update({ name: "Acme Retail Ltd" }).eq("id", clientA);
    expect(renameErr).toBeNull();
    // anon has zero direct table access (0013 default-privileges revoke).
    const { error: anonErr } = await anon.from("clients").select("id").limit(1);
    expect(anonErr).not.toBeNull();
  });

  it("duplicate client name in the same org is rejected case-insensitively", async () => {
    const { error } = await alice.from("clients").insert({ org_id: orgId, name: "acme retail ltd" });
    expect(error).not.toBeNull(); // clients_org_lower_name_uq
  });

  it("update_org_branding: member writes land; non-member and foreign prefix raise", async () => {
    const { error: ok } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0F766E", p_logo_path: `${orgId}/logo-abc.png`,
    });
    expect(ok).toBeNull();
    const { data: org } = await admin
      .from("orgs").select("accent_color, logo_path").eq("id", orgId).single();
    expect(org!.accent_color).toBe("#0f766e"); // lower()ed
    expect(org!.logo_path).toBe(`${orgId}/logo-abc.png`);

    const { error: foreignOrg } = await bob.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#000000", p_logo_path: null,
    });
    expect(foreignOrg).not.toBeNull();

    const { error: foreignPath } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "#0f766e", p_logo_path: `${bobOrgId}/logo-x.png`,
    });
    expect(foreignPath).not.toBeNull();

    const { error: badHex } = await alice.rpc("update_org_branding", {
      p_org_id: orgId, p_accent_color: "teal", p_logo_path: null,
    });
    expect(badHex).not.toBeNull(); // dies at orgs_accent_color_check

    // orgs remains directly unwritable by authenticated (0004 unchanged).
    const { error: directWrite, count } = await alice
      .from("orgs").update({ accent_color: "#111111" }, { count: "exact" }).eq("id", orgId);
    expect(directWrite ?? count === 0).toBeTruthy();
  });

  it("deleting a client cascades its tokens and nulls its units", async () => {
    const { error: delErr } = await alice.from("clients").delete().eq("id", clientA);
    expect(delErr).toBeNull();
    const { data: tokRows } = await admin
      .from("access_tokens").select("id").eq("token_hash", tA.tokenHash);
    expect(tokRows).toEqual([]); // FK cascade, past grants/RLS
    const { data: u } = await admin.from("units").select("client_id").eq("id", unit1).single();
    expect(u!.client_id).toBeNull();
    const { data: gone } = await resolve(tA.token);
    expect(gone).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm run test:integration -- src/features/clients/portal-tokens.integration.test.ts`
Expected: PASS. If a test fails, fix migration 0018 (then `npm run db:reset` + re-run) — do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add src/features/clients/portal-tokens.integration.test.ts
git commit -m "test: portal token SQL surface (slice 9)"
```

---

### Task 4: `lib/tokens` split + `generateAccessToken` rename

**Files:**
- Create: `src/lib/tokens/participant.ts` (moved VERBATIM from `index.ts`)
- Modify: `src/lib/tokens/index.ts` (becomes a barrel), `src/lib/tokens/rate-limit.ts`, `src/lib/tokens/mint.ts`, `src/lib/tokens/mint.test.ts`, `src/features/participants/actions.ts`, `scripts/seed.ts`

**Interfaces:**
- Consumes: current `index.ts` contents (238 lines).
- Produces: `tokenLimiter` + `clientKeyFrom` from `./rate-limit`; `generateAccessToken(): { token, tokenHash }` from `./mint`; unchanged public barrel — every existing `from "@/lib/tokens"` import keeps compiling.

- [ ] **Step 1: Add the shared limiter + `clientKeyFrom` to `src/lib/tokens/rate-limit.ts`**

Append at the end of the file:

```ts
// DoS hygiene only — the boundary is token entropy (see mint.ts), never
// this counter. ONE instance shared by the participant and portal
// resolvers: both surfaces draw from the same 120/min noise floor. Sized
// generously because every flow action revalidates the page, which
// re-resolves the token; x-forwarded-for is client-settable anyway.
export const tokenLimiter = new SlidingWindowLimiter(120, 60_000);

// All token pages derive the limiter bucket the same way; keep it in one
// place so surfaces can never drift. An IP when the proxy sets one, else
// "server".
export function clientKeyFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "server";
}
```

- [ ] **Step 2: Create `src/lib/tokens/participant.ts`**

Move everything from the current `index.ts` except the `generateParticipantToken`/`hashToken` re-export, the limiter block, and `clientKeyFrom` — i.e. `TokenScope`, `ResolveResult`, `resolveParticipantToken`, `unitFilter`, `getParticipantUnits`, `ParticipantUnitDetail`, `getParticipantUnitDetail`, `buildParticipantUrl` — VERBATIM, with the imports it needs:

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import type { EvidencePhoto, StageSection } from "@/features/programs/queries";
import { signEvidencePaths } from "@/lib/storage/evidence";
import { tokenLimiter } from "./rate-limit";
```

Inside `resolveParticipantToken`, replace the old module-level `limiter.allow(...)` call with `tokenLimiter.allow(...)` — everything else is untouched.

- [ ] **Step 3: Rewrite `src/lib/tokens/index.ts` as the barrel**

```ts
// Barrel for THE chokepoint: lib/tokens is the only module that hands a raw
// token to the database. participant.ts and portal.ts each own one surface;
// mint.ts owns entropy; rate-limit.ts owns the shared noise floor.
export { generateAccessToken, hashToken } from "./mint";
export { clientKeyFrom } from "./rate-limit";
export * from "./participant";
```

(Task 5 adds `export * from "./portal";` when that file exists.)

- [ ] **Step 4: Rename the generator in `src/lib/tokens/mint.ts`**

Rename `generateParticipantToken` → `generateAccessToken` and update its comment: the boundary line now reads "This IS the security boundary for /p and /portal — the RPCs are anon-callable, so guessing must be physically infeasible."

- [ ] **Step 5: Update every call site**

- `src/lib/tokens/mint.test.ts`: replace every occurrence of `generateParticipantToken` with `generateAccessToken`.
- `src/features/participants/actions.ts`: change the import to `import { generateAccessToken, buildParticipantUrl } from "@/lib/tokens";` and the call in `issueLink` to `generateAccessToken()`.
- `scripts/seed.ts`: change the import to `import { generateAccessToken } from "../src/lib/tokens/mint";` and the call in `ensureDemoParticipant` to `generateAccessToken()`.

Run: `grep -rn "generateParticipantToken" src scripts`
Expected: no matches.

- [ ] **Step 6: Verify + integration smoke + commit**

Run: `npm run verify && npm run test:integration -- src/features/participants/readers.integration.test.ts`
Expected: PASS — the split is behavior-neutral.

```bash
git add src/lib/tokens src/features/participants/actions.ts scripts/seed.ts
git commit -m "refactor: split lib/tokens by surface; kind-agnostic generateAccessToken"
```

---

### Task 5: Portal chokepoint + readers + branding read helper

**Files:**
- Create: `src/lib/tokens/portal.ts`, `src/lib/storage/branding.ts` (bucket const + public URL; Task 9 extends it), `src/lib/org-branding.ts`
- Modify: `src/lib/tokens/index.ts` (add portal export)
- Test: `src/features/clients/portal-readers.integration.test.ts`

**Interfaces:**
- Consumes: `resolve_portal_token` RPC (Task 2), `tokenLimiter` (Task 4), `signEvidencePaths` (existing).
- Produces (later tasks import these exact names from `@/lib/tokens` / `@/lib/org-branding` / `@/lib/storage/branding`):
  - `type PortalScope = { orgId: string; orgName: string; clientId: string; clientName: string }`
  - `type ResolvePortalResult = { status: "not_found" } | { status: "rate_limited" } | { status: "expired" | "revoked"; orgName: string } | { status: "ok"; scope: PortalScope }`
  - `resolvePortalToken(token: string, clientKey: string): Promise<ResolvePortalResult>`
  - `type PortalUnitSummary = { id: string; name: string; externalRef: string | null; done: number; total: number; lastActivity: string | null }`
  - `type PortalProgramGroup = { programId: string; programName: string; units: PortalUnitSummary[] }`
  - `getPortalUnits(scope: PortalScope): Promise<PortalProgramGroup[]>`
  - `type PortalPhoto = { id: string; filename: string; createdAt: string; url: string | null }`
  - `type PortalItem = { id: string; label: string; type: "text" | "number" | "boolean" | "date" | "choice" | "photo"; value: string | number | boolean | null; photos: PortalPhoto[] }`
  - `type PortalStage = { id: string; name: string; position: number; status: "pending" | "done"; doneAt: string | null; items: PortalItem[] }`
  - `type PortalUnitDetail = { id: string; name: string; externalRef: string | null; programName: string; stages: PortalStage[] }`
  - `getPortalUnitDetail(scope: PortalScope, unitId: string): Promise<PortalUnitDetail | null>`
  - `buildPortalUrl(token: string): string`
  - `BRANDING_BUCKET = "branding"`, `publicLogoUrl(path: string): string`
  - `type OrgBranding = { accentColor: string | null; logoUrl: string | null }`, `getOrgBranding(orgId: string): Promise<OrgBranding>`

- [ ] **Step 1: Create `src/lib/storage/branding.ts`**

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Object I/O for the PUBLIC `branding` bucket (ZERO storage policies —
// writes only through the service-role client; reads are public URLs, so
// no signing on every portal load). Logos are not secrets. Task 9 adds
// upload/delete + validation caps to this module.
export const BRANDING_BUCKET = "branding";

export function publicLogoUrl(path: string): string {
  const admin = createAdminClient();
  return admin.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl;
}
```

- [ ] **Step 2: Create `src/lib/org-branding.ts`**

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicLogoUrl } from "@/lib/storage/branding";

export type OrgBranding = { accentColor: string | null; logoUrl: string | null };

// Branding rides OUTSIDE the token RPCs on purpose: growing a RETURNS
// TABLE signature forces drop + recreate + re-grant of a battle-tested
// resolver for two display columns, and would put branding on the
// anon-reachable SQL surface. Both /p and /portal call this instead.
// Fails soft: an unbranded header beats a dead page.
export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orgs")
    .select("accent_color, logo_path")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[branding] read failed:", error.message);
    return { accentColor: null, logoUrl: null };
  }
  return {
    accentColor: data.accent_color,
    logoUrl: data.logo_path ? publicLogoUrl(data.logo_path) : null,
  };
}
```

- [ ] **Step 3: Create `src/lib/tokens/portal.ts`**

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import { signEvidencePaths } from "@/lib/storage/evidence";
import { tokenLimiter } from "./rate-limit";

export type PortalScope = {
  orgId: string;
  orgName: string;
  clientId: string;
  clientName: string;
};

export type ResolvePortalResult =
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "expired" | "revoked"; orgName: string }
  | { status: "ok"; scope: PortalScope };

// The portal side of THE chokepoint (see participant.ts for the twin).
// Tokens are NEVER logged — not even at error level.
export async function resolvePortalToken(
  token: string,
  clientKey: string,
): Promise<ResolvePortalResult> {
  if (!tokenLimiter.allow(`${clientKey}:${token.slice(0, 8)}`)) return { status: "rate_limited" };
  if (token.length < 20 || token.length > 200) return { status: "not_found" };

  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_portal_token", { p_token: token });
  if (error) {
    console.error("[tokens] portal resolve failed:", error.code ?? error.message); // no token in logs
    return { status: "not_found" };
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { status: "not_found" };
  if (row.status === "expired" || row.status === "revoked") {
    return { status: row.status, orgName: row.org_name as string };
  }
  // Fail closed: only an explicit "ok" opens the scope.
  if (row.status !== "ok") return { status: "not_found" };
  return {
    status: "ok",
    scope: {
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      clientId: row.client_id as string,
      clientName: row.client_name as string,
    },
  };
}

export type PortalUnitSummary = {
  id: string;
  name: string;
  externalRef: string | null;
  done: number;
  total: number;
  lastActivity: string | null;
};
export type PortalProgramGroup = {
  programId: string;
  programName: string;
  units: PortalUnitSummary[];
};

// Home read model. Admin client bypasses RLS entirely — EVERY query below
// carries its own explicit org_id AND client_id filters (slice-8 rule:
// never rely on an earlier check for tenancy). Units with client_id null
// do not exist as far as any portal token is concerned.
export async function getPortalUnits(scope: PortalScope): Promise<PortalProgramGroup[]> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(status, done_at)")
    .eq("org_id", scope.orgId)
    .eq("client_id", scope.clientId);
  if (error) throw error;
  const units = data ?? [];
  if (units.length === 0) return [];

  // Last activity = greatest(max(stage done_at), max(response updated_at)):
  // done_at alone misses in-progress work; updated_at alone misses overrides.
  const { data: resps, error: e2 } = await db
    .from("unit_stage_responses")
    .select("unit_id, updated_at")
    .eq("org_id", scope.orgId)
    .in("unit_id", units.map((u) => u.id));
  if (e2) throw e2;
  const respMax = new Map<string, string>();
  for (const r of resps ?? []) {
    const prev = respMax.get(r.unit_id);
    if (!prev || r.updated_at > prev) respMax.set(r.unit_id, r.updated_at);
  }

  const groups = new Map<string, PortalProgramGroup>();
  for (const u of units) {
    const doneAts = u.unit_stages
      .map((s) => s.done_at)
      .filter((d): d is string => d !== null);
    const candidates = [...doneAts, ...(respMax.has(u.id) ? [respMax.get(u.id)!] : [])];
    const summary: PortalUnitSummary = {
      id: u.id,
      name: u.name,
      externalRef: u.external_ref as string | null,
      done: u.unit_stages.filter((s) => s.status === "done").length,
      total: u.unit_stages.length,
      lastActivity: candidates.length ? candidates.sort().at(-1)! : null,
    };
    const programName = (u.programs as unknown as { name: string } | null)?.name ?? "—";
    const group = groups.get(u.program_id) ?? {
      programId: u.program_id,
      programName,
      units: [],
    };
    group.units.push(summary);
    groups.set(u.program_id, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, units: g.units.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.programName.localeCompare(b.programName) || a.programId.localeCompare(b.programId));
}

// NO field in these types can carry a person's name — attribution is
// excluded at the TYPE level (spec §portal read model). The queries below
// never join participants or user tables.
export type PortalPhoto = { id: string; filename: string; createdAt: string; url: string | null };
export type PortalItem = {
  id: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "photo";
  value: string | number | boolean | null;
  photos: PortalPhoto[];
};
export type PortalStage = {
  id: string;
  name: string;
  position: number;
  status: "pending" | "done";
  doneAt: string | null;
  items: PortalItem[];
};
export type PortalUnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  programName: string;
  stages: PortalStage[];
};

// THE portal rule: a done stage expands (its answered requirements, typed
// values, photo thumbnails); a pending stage is a name plus "awaiting" —
// items stays []. The client never sees the org's internal checklist
// before it is satisfied.
export async function getPortalUnitDetail(
  scope: PortalScope,
  unitId: string,
): Promise<PortalUnitDetail | null> {
  const db = createAdminClient();
  const { data: unit, error } = await db
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_at)")
    .eq("id", unitId)
    .eq("org_id", scope.orgId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null; // cross-client / cross-org reads as nonexistent

  const programId = unit.program_id;
  const [
    { data: stages, error: e1 },
    { data: reqs, error: e2 },
    { data: resps, error: e3 },
    { data: ev, error: e4 },
  ] = await Promise.all([
    db.from("program_stages").select("id, name, position")
      .eq("program_id", programId).eq("org_id", scope.orgId),
    db.from("program_stage_requirements").select("id, program_stage_id, type, label, position")
      .eq("program_id", programId).eq("org_id", scope.orgId),
    db.from("unit_stage_responses")
      .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
      .eq("unit_id", unitId).eq("org_id", scope.orgId),
    // Deliberately NO participants(name) embed — see the type-level rule above.
    db.from("evidence").select("id, response_id, path, filename, created_at")
      .eq("unit_id", unitId).eq("org_id", scope.orgId),
  ]);
  if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;

  type RespRow = NonNullable<typeof resps>[number];
  const valueOf = (r: RespRow): string | number | boolean | null =>
    r.type === "number"
      ? r.value_number === null ? null : Number(r.value_number)
      : r.type === "boolean"
        ? r.value_bool
        : r.type === "date"
          ? r.value_date
          : r.value_text;
  const responseByReq = new Map((resps ?? []).map((r) => [r.program_stage_requirement_id, r]));
  const respIdToReq = new Map((resps ?? []).map((r) => [r.id, r.program_stage_requirement_id]));

  const photoRows = [...(ev ?? [])].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const signed = await signEvidencePaths(photoRows.map((e) => e.path));
  const photosByReq = new Map<string, PortalPhoto[]>();
  for (const e of photoRows) {
    const reqId = e.response_id ? respIdToReq.get(e.response_id) : undefined;
    if (!reqId) continue;
    const list = photosByReq.get(reqId) ?? [];
    list.push({ id: e.id, filename: e.filename, createdAt: e.created_at, url: signed.get(e.path) ?? null });
    photosByReq.set(reqId, list);
  }

  const usByStage = new Map(unit.unit_stages.map((us) => [us.program_stage_id, us]));
  return {
    id: unit.id,
    name: unit.name,
    externalRef: unit.external_ref as string | null,
    programName: (unit.programs as unknown as { name: string } | null)?.name ?? "—",
    stages: [...(stages ?? [])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap((s) => {
        const us = usByStage.get(s.id);
        if (!us) return [];
        const status = us.status as "pending" | "done";
        const items: PortalItem[] =
          status !== "done"
            ? [] // pending stages carry NOTHING — the portal rule
            : (reqs ?? [])
                .filter((r) => r.program_stage_id === s.id)
                .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
                .flatMap((r) => {
                  const resp = responseByReq.get(r.id);
                  const photos = photosByReq.get(r.id) ?? [];
                  // Only ANSWERED requirements render (an optional,
                  // unanswered one has nothing to show).
                  if (!resp && photos.length === 0) return [];
                  return [{
                    id: r.id,
                    label: r.label,
                    type: r.type as PortalItem["type"],
                    value: resp ? valueOf(resp) : null,
                    photos,
                  }];
                });
        return [{
          id: s.id,
          name: s.name,
          position: s.position,
          status,
          doneAt: (us.done_at as string | null) ?? null,
          items,
        }];
      }),
  };
}

export function buildPortalUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/portal/${token}`;
}
```

- [ ] **Step 4: Add to the barrel**

In `src/lib/tokens/index.ts` add `export * from "./portal";`.

- [ ] **Step 5: Write the reader integration tests**

`src/features/clients/portal-readers.integration.test.ts` — same harness prologue as Task 3 (loadEnvFile, url/anonKey/serviceKey, `admin`, `signedInUser`, `mint()` — copy them; files must stand alone). Then:

```ts
import { resolvePortalToken, getPortalUnits, getPortalUnitDetail } from "@/lib/tokens";
import type { PortalScope } from "@/lib/tokens";

describe("portal readers: scope, grouping, the done-expands rule, no names", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let aliceId: string;
  let orgId: string;
  let programId: string;
  let stageId: string;
  let textReqId: string;
  let unitA: string; // client Acme
  let unitB: string; // client Bridge
  let unitNone: string; // no client
  let acme: string;
  let bridge: string;
  let scopeA: PortalScope;

  beforeAll(async () => {
    alice = await signedInUser("preaders_alice");
    const { data: me } = await alice.auth.getUser();
    aliceId = me.user!.id;
    const { data: org } = await alice.rpc("create_org", { p_name: "ReadersOrg" });
    orgId = (org as { id: string }).id;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "R Template" }).select("id").single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id").single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: s!.id, org_id: orgId, type: "text", label: "Notes",
      required: true, config: {}, position: 0,
    });
    const { data: program } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "R Program",
    });
    programId = (program as { id: string }).id;
    const { data: pStages } = await alice
      .from("program_stages").select("id").eq("program_id", programId);
    stageId = pStages![0].id;
    const { data: reqs } = await alice
      .from("program_stage_requirements").select("id").eq("program_id", programId);
    textReqId = reqs![0].id;

    const { data: cA } = await alice
      .from("clients").insert({ org_id: orgId, name: "Acme" }).select("id").single();
    acme = cA!.id;
    const { data: cB } = await alice
      .from("clients").insert({ org_id: orgId, name: "Bridge" }).select("id").single();
    bridge = cB!.id;

    const insertUnit = async (name: string, clientId: string | null) => {
      const { data: u } = await alice
        .from("units")
        .insert({ program_id: programId, org_id: orgId, name, client_id: clientId })
        .select("id").single();
      return u!.id;
    };
    unitA = await insertUnit("Site A", acme);
    unitB = await insertUnit("Site B", bridge);
    unitNone = await insertUnit("Site None", null);

    const tA = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tA.tokenHash, kind: "portal", client_id: acme,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    const resolved = await resolvePortalToken(tA.token, "test");
    if (resolved.status !== "ok") throw new Error(`resolve failed: ${resolved.status}`);
    scopeA = resolved.scope;
  });

  it("resolves through the chokepoint with client identity", () => {
    expect(scopeA.clientName).toBe("Acme");
    expect(scopeA.orgName).toBe("ReadersOrg");
  });

  it("unknown token → not_found through the chokepoint", async () => {
    const r = await resolvePortalToken(mint().token, "test");
    expect(r.status).toBe("not_found");
  });

  it("home lists ONLY the token's client's units, grouped by program", async () => {
    const groups = await getPortalUnits(scopeA);
    expect(groups).toHaveLength(1);
    expect(groups[0].programName).toBe("R Program");
    expect(groups[0].units.map((u) => u.name)).toEqual(["Site A"]);
    expect(groups[0].units[0].lastActivity).toBeNull(); // nothing happened yet
  });

  it("detail: cross-client and unclaimed units read as nonexistent", async () => {
    expect(await getPortalUnitDetail(scopeA, unitB)).toBeNull();
    expect(await getPortalUnitDetail(scopeA, unitNone)).toBeNull();
  });

  it("pending stages carry a name and NOTHING else", async () => {
    const detail = await getPortalUnitDetail(scopeA, unitA);
    expect(detail).not.toBeNull();
    expect(detail!.stages).toHaveLength(1);
    expect(detail!.stages[0].status).toBe("pending");
    expect(detail!.stages[0].items).toEqual([]); // the portal rule
  });

  it("a done stage expands with answers, and lastActivity moves — with no names anywhere", async () => {
    // Answer via the PARTICIPANT surface so attribution gets set — the
    // strongest no-leak setup: the response row genuinely carries a
    // participant id, and the portal read model must still show no name.
    const { data: p } = await alice
      .from("participants").insert({ org_id: orgId, name: "LEAKYNAME" }).select("id").single();
    await alice.from("units").update({ assigned_participant_id: p!.id }).eq("id", unitA);
    const tP = mint();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: tP.tokenHash, kind: "participant",
      participant_id: p!.id, program_id: programId,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_by: aliceId,
    });
    const { error: submitErr } = await anon.rpc("submit_participant_response", {
      p_token: tP.token, p_unit_id: unitA, p_requirement_id: textReqId,
      p_value_text: "All clear", p_value_number: null, p_value_bool: null, p_value_date: null,
    });
    expect(submitErr).toBeNull();

    const detail = await getPortalUnitDetail(scopeA, unitA);
    expect(detail!.stages[0].status).toBe("done"); // derive trigger fired
    expect(detail!.stages[0].doneAt).not.toBeNull();
    expect(detail!.stages[0].items).toEqual([
      expect.objectContaining({ label: "Notes", type: "text", value: "All clear" }),
    ]);
    // Attribution is excluded at the type level — prove it end to end.
    expect(JSON.stringify(detail)).not.toContain("LEAKYNAME");

    const groups = await getPortalUnits(scopeA);
    expect(groups[0].units[0].done).toBe(1);
    expect(groups[0].units[0].lastActivity).not.toBeNull();
    expect(JSON.stringify(groups)).not.toContain("LEAKYNAME");
  });
});
```

- [ ] **Step 6: Run + commit**

Run: `npm run verify && npm run test:integration -- src/features/clients/portal-readers.integration.test.ts`
Expected: PASS.

```bash
git add src/lib/tokens src/lib/storage/branding.ts src/lib/org-branding.ts src/features/clients/portal-readers.integration.test.ts
git commit -m "feat: portal chokepoint + read models + branding read helper (slice 9)"
```

---

### Task 6: Clients feature backend (Zod + actions + queries)

**Files:**
- Create: `src/features/clients/schema.ts`, `src/features/clients/actions.ts`, `src/features/clients/queries.ts`
- Test: `src/features/clients/schema.test.ts`

**Interfaces:**
- Consumes: `generateAccessToken`, `buildPortalUrl` from `@/lib/tokens` (Tasks 4–5); `GENERIC_WRITE_ERROR`/`ActionState` from `@/lib/actions`.
- Produces (console UI imports these exact names):
  - actions: `createClient(input): Promise<{ok:true;id:string}|{ok:false;error:string}>`, `renameClient(input): Promise<ActionState>`, `deleteClient(input): Promise<ActionState|never>` (redirects on success), `assignClient(input): Promise<ActionState>`, `issuePortalLink(input): Promise<{ok:true;url:string}|{ok:false;error:string}>`, `revokePortalLink(input): Promise<ActionState>`
  - queries: `listClients(): Promise<ClientListItem[]>` with `ClientListItem = { id; name; unitCount; liveLinkCount }`; `listClientOptions(): Promise<ClientOption[]>` with `ClientOption = { id; name }`; `getClient(id): Promise<{id;name}|null>`; `listClientUnits(clientId): Promise<ClientUnitRow[]>` with `ClientUnitRow = { unitId; unitName; externalRef; programId; programName; done; total }`; `listClientLinks(clientId): Promise<ClientLink[]>` with `ClientLink = { id; createdAt; expiresAt; revokedAt; lastUsedAt; status: "active"|"expired"|"revoked" }`

- [ ] **Step 1: Write the failing schema tests**

`src/features/clients/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createClientInput,
  renameClientInput,
  assignClientInput,
  issuePortalLinkInput,
} from "./schema";

describe("clients schemas", () => {
  it("trims and bounds client names", () => {
    expect(createClientInput.parse({ name: "  Acme  " }).name).toBe("Acme");
    expect(createClientInput.safeParse({ name: "" }).success).toBe(false);
    expect(createClientInput.safeParse({ name: "x".repeat(121) }).success).toBe(false);
  });

  it("rename requires a uuid id", () => {
    expect(renameClientInput.safeParse({ id: "nope", name: "A" }).success).toBe(false);
  });

  it("assign accepts null to unassign", () => {
    const parsed = assignClientInput.parse({
      unitId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      clientId: null,
    });
    expect(parsed.clientId).toBeNull();
  });

  it("portal links default to 12 months and cap at 730 days", () => {
    const parsed = issuePortalLinkInput.parse({ clientId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" });
    expect(parsed.expiresDays).toBe(365);
    expect(
      issuePortalLinkInput.safeParse({
        clientId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
        expiresDays: 999,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/clients/schema.test.ts`
Expected: FAIL — `./schema` does not exist.

- [ ] **Step 3: Write `src/features/clients/schema.ts`**

```ts
import { z } from "zod";

export const clientName = z.string().trim().min(1).max(120);
export const createClientInput = z.object({
  name: clientName,
  // Where the creation happened (unit-row inline create), so the action can
  // revalidate the program page the caller is looking at.
  programId: z.uuid().optional(),
});
export const renameClientInput = z.object({ id: z.uuid(), name: clientName });
export const deleteClientInput = z.object({ id: z.uuid() });
export const assignClientInput = z.object({
  unitId: z.uuid(),
  clientId: z.uuid().nullable(),
});
// Long-lived by design (~12 months, spec); rotation = mint new, revoke old.
export const issuePortalLinkInput = z.object({
  clientId: z.uuid(),
  expiresDays: z.number().int().min(1).max(730).default(365),
});
export const revokePortalLinkInput = z.object({ id: z.uuid() });

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/features/clients/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/features/clients/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createSupabase } from "@/lib/supabase/server";
import { generateAccessToken, buildPortalUrl } from "@/lib/tokens";
import {
  createClientInput,
  renameClientInput,
  deleteClientInput,
  assignClientInput,
  issuePortalLinkInput,
  revokePortalLinkInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[clients] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createSupabase();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createClient(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = createClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return fail("createClient", "no org");
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .insert({ org_id: orgId, name: parsed.data.name })
    .select("id")
    .single();
  if (error || !data) return fail("createClient", error);
  revalidatePath("/clients");
  if (parsed.data.programId) revalidatePath(`/programs/${parsed.data.programId}`);
  return { ok: true, id: data.id };
}

export async function renameClient(input: unknown): Promise<ActionState> {
  const parsed = renameClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("renameClient", error ?? "client not visible");
  revalidatePath("/clients");
  revalidatePath(`/clients/${parsed.data.id}`);
  return { ok: true };
}

// Cascade is deliberate (spec): portal tokens die with the client; units
// keep their history and lose only the grouping (set null). The confirm
// dialog spells this out.
export async function deleteClient(input: unknown): Promise<ActionState> {
  const parsed = deleteClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail("deleteClient", error ?? "client not visible");
  revalidatePath("/clients");
  revalidatePath("/programs", "layout"); // unit rows show client pickers
  redirect("/clients");
}

export async function assignClient(input: unknown): Promise<ActionState> {
  const parsed = assignClientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("units")
    .update({ client_id: parsed.data.clientId })
    .eq("id", parsed.data.unitId)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("assignClient", error ?? "unit not visible");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath("/clients");
  return { ok: true };
}

export async function issuePortalLink(
  input: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = issuePortalLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  // Parent lookup doubles as tenancy + org source (RLS hides foreign rows);
  // the DB guard trigger re-validates the scope tuple.
  const { data: client } = await supabase
    .from("clients")
    .select("id, org_id")
    .eq("id", parsed.data.clientId)
    .maybeSingle();
  if (!client) return fail("issuePortalLink", "client not visible");

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return fail("issuePortalLink", "no user");

  const { token, tokenHash } = generateAccessToken();
  const expiresAt = new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString();
  const { error } = await supabase.from("access_tokens").insert({
    org_id: client.org_id,
    token_hash: tokenHash,
    kind: "portal",
    client_id: client.id,
    expires_at: expiresAt,
    created_by: me.user.id,
  });
  if (error) return fail("issuePortalLink", error);
  revalidatePath(`/clients/${client.id}`);
  // The raw token exists ONLY in this return value — shown once, never stored.
  return { ok: true, url: buildPortalUrl(token) };
}

export async function revokePortalLink(input: unknown): Promise<ActionState> {
  const parsed = revokePortalLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("client_id")
    .maybeSingle();
  if (error || !data) return fail("revokePortalLink", error ?? "link not visible");
  revalidatePath(`/clients/${data.client_id}`);
  return { ok: true };
}
```

- [ ] **Step 6: Write `src/features/clients/queries.ts`**

```ts
import { createClient as createSupabase } from "@/lib/supabase/server";

export type ClientListItem = {
  id: string;
  name: string;
  unitCount: number;
  liveLinkCount: number;
};
export type ClientOption = { id: string; name: string };
export type ClientUnitRow = {
  unitId: string;
  unitName: string;
  externalRef: string | null;
  programId: string;
  programName: string;
  done: number;
  total: number;
};
export type ClientLink = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "expired" | "revoked";
};

// RLS scopes every read to the caller's orgs.

export async function listClients(): Promise<ClientListItem[]> {
  const supabase = await createSupabase();
  // Three small selects aggregated in JS: embedded counts can't express
  // "live links only" (revoked_at null AND unexpired), and client counts
  // stay small at v1 scale.
  const [{ data: clients, error: e1 }, { data: units, error: e2 }, { data: links, error: e3 }] =
    await Promise.all([
      supabase.from("clients").select("id, name").order("name"),
      supabase.from("units").select("client_id").not("client_id", "is", null),
      supabase.from("access_tokens").select("client_id, revoked_at, expires_at").eq("kind", "portal"),
    ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
  const unitCounts = new Map<string, number>();
  for (const u of units ?? []) {
    unitCounts.set(u.client_id!, (unitCounts.get(u.client_id!) ?? 0) + 1);
  }
  const now = Date.now();
  const liveCounts = new Map<string, number>();
  for (const l of links ?? []) {
    if (l.client_id && !l.revoked_at && Date.parse(l.expires_at) > now) {
      liveCounts.set(l.client_id, (liveCounts.get(l.client_id) ?? 0) + 1);
    }
  }
  return (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    unitCount: unitCounts.get(c.id) ?? 0,
    liveLinkCount: liveCounts.get(c.id) ?? 0,
  }));
}

export async function listClientOptions(): Promise<ClientOption[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase.from("clients").select("id, name").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getClient(id: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("clients").select("id, name").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listClientUnits(clientId: string): Promise<ClientUnitRow[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("units")
    .select("id, name, external_ref, program_id, programs(name), unit_stages(status)")
    .eq("client_id", clientId);
  if (error) throw error;
  type Row = {
    id: string;
    name: string;
    external_ref: string | null;
    program_id: string;
    programs: { name: string } | null;
    unit_stages: { status: string }[];
  };
  return ((data ?? []) as unknown as Row[])
    .map((u) => ({
      unitId: u.id,
      unitName: u.name,
      externalRef: u.external_ref,
      programId: u.program_id,
      programName: u.programs?.name ?? "—",
      done: u.unit_stages.filter((s) => s.status === "done").length,
      total: u.unit_stages.length,
    }))
    .sort(
      (a, b) =>
        a.programName.localeCompare(b.programName) ||
        a.unitName.localeCompare(b.unitName) ||
        a.unitId.localeCompare(b.unitId),
    );
}

export async function listClientLinks(clientId: string): Promise<ClientLink[]> {
  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from("access_tokens")
    .select("id, created_at, expires_at, revoked_at, last_used_at")
    .eq("client_id", clientId)
    .eq("kind", "portal")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const now = Date.now();
  return (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    status: r.revoked_at ? "revoked" : Date.parse(r.expires_at) < now ? "expired" : "active",
  }));
}
```

- [ ] **Step 7: Verify + commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/clients
git commit -m "feat: clients schemas, actions, queries (slice 9)"
```

---

### Task 7: Console — /clients pages, nav, command palette

**Files:**
- Create: `src/app/(dashboard)/clients/page.tsx`, `src/app/(dashboard)/clients/[id]/page.tsx`, `src/features/clients/components/create-client-dialog.tsx`, `src/features/clients/components/client-header.tsx`, `src/features/clients/components/portal-links-panel.tsx`
- Modify: `src/components/shell/nav.ts`, `src/components/command-menu.tsx`

**Interfaces:**
- Consumes: Task 6's actions/queries (exact names above); ui primitives (`Dialog`, `Button`, `Input`, `Badge`, `Label`); the `?new=1` palette convention.
- Produces: routes `/clients`, `/clients/[id]`.

- [ ] **Step 1: Nav + command palette**

`src/components/shell/nav.ts`:

```ts
import { LayoutGrid, FileStack, Building2 } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/programs", label: "Programs", icon: LayoutGrid },
  { href: "/templates", label: "Templates", icon: FileStack },
  { href: "/clients", label: "Clients", icon: Building2 },
] as const;
```

`src/components/command-menu.tsx`: add `Building2` to the lucide import; in the Navigate group after Templates:

```tsx
          <CommandItem onSelect={() => go("/clients")}>
            <Building2 className="size-4" /> Clients
          </CommandItem>
```

and in the Actions group:

```tsx
          <CommandItem onSelect={() => go("/clients?new=1")}>
            <Plus className="size-4" /> Create client
          </CommandItem>
```

- [ ] **Step 2: Create dialog `src/features/clients/components/create-client-dialog.tsx`**

```tsx
"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/features/clients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateClientDialog() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlOpen = searchParams.get("new") === "1";
  const [manuallyOpened, setManuallyOpened] = React.useState(false);
  const open = urlOpen || manuallyOpened;
  const [pending, startTransition] = React.useTransition();

  const onOpenChange = (next: boolean) => {
    setManuallyOpened(next);
    if (!next && urlOpen) router.replace("/clients");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    if (typeof name !== "string" || name.trim() === "") return;
    startTransition(async () => {
      const result = await createClient({ name });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      router.push(`/clients/${result.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New client
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="client-name">Name</Label>
            <Input id="client-name" name="name" required maxLength={120} autoFocus />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create client"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: List page `src/app/(dashboard)/clients/page.tsx`**

```tsx
import Link from "next/link";
import { listClients } from "@/features/clients/queries";
import { CreateClientDialog } from "@/features/clients/components/create-client-dialog";
import { Badge } from "@/components/ui/badge";

export default async function ClientsPage() {
  const clients = await listClients();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Clients</h1>
        <CreateClientDialog />
      </div>
      {clients.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No clients yet — a client groups units across programs and gets a read-only portal link.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {clients.map((c) => (
            <li key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
              >
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                  {c.unitCount} {c.unitCount === 1 ? "unit" : "units"}
                </span>
                {c.liveLinkCount > 0 ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    {c.liveLinkCount} live {c.liveLinkCount === 1 ? "link" : "links"}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Client header `src/features/clients/components/client-header.tsx`** (ProgramHeader pattern; delete copy spells out the cascade)

```tsx
"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { renameClient, deleteClient } from "@/features/clients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ClientHeader({ id, name }: { id: string; name: string }) {
  const [value, setValue] = React.useState(name);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const commitRename = () => {
    const next = value.trim();
    if (next === "" || next === name) {
      setValue(name);
      return;
    }
    startTransition(async () => {
      const result = await renameClient({ id, name: next });
      if (!result.ok) {
        setValue(name);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label="Client name"
        className="border-transparent text-lg font-semibold shadow-none focus-visible:border-input"
      />
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Delete client">
              <Trash2 className="size-4" />
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this client?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Portal links are deleted; units keep their history but lose the client grouping.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteClient({ id });
                  // On success the action redirects; only failures return.
                  if (result && !result.ok) toast.error(result.error);
                })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 5: Portal links panel `src/features/clients/components/portal-links-panel.tsx`** (LinksPanel pattern, client-scoped)

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Link2Off } from "lucide-react";
import { issuePortalLink, revokePortalLink } from "@/features/clients/actions";
import type { ClientLink } from "@/features/clients/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Deterministic across server/client: fixed locale + UTC (links-panel
// precedent — toLocaleDateString varies by runtime and breaks hydration).
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

// Issue + list + revoke. The raw URL exists only in issuePortalLink's
// return value — rendered once here, never fetchable again. Rotation =
// issue a new link, then revoke the old one.
export function PortalLinksPanel({ clientId, links }: { clientId: string; links: ClientLink[] }) {
  const [freshUrl, setFreshUrl] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const issue = () =>
    startTransition(async () => {
      const result = await issuePortalLink({ clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFreshUrl(result.url);
    });

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — select the link text and copy manually.");
    }
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokePortalLink({ id });
      if (!result.ok) toast.error(result.error ?? "Couldn't revoke. Try again.");
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Portal links</h2>
        <Button size="sm" variant="secondary" disabled={isPending} onClick={issue}>
          Issue link
        </Button>
      </div>
      {freshUrl ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-2">
          <Input readOnly value={freshUrl} className="h-7 font-mono text-xs" aria-label="New link (shown once)" />
          <Button size="sm" variant="ghost" onClick={() => copy(freshUrl)} aria-label="Copy link">
            <Copy className="size-3.5" />
          </Button>
          <p className="text-muted-foreground shrink-0 text-[10px]">Shown once — copy it now.</p>
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <Badge variant={l.status === "active" ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                {l.status}
              </Badge>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                issued {formatDate(l.createdAt)}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                exp {formatDate(l.expiresAt)}
              </span>
              {l.lastUsedAt ? (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  used {formatDate(l.lastUsedAt)}
                </span>
              ) : null}
              {l.status === "active" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-auto size-6"
                  aria-label="Revoke portal link"
                  onClick={() => revoke(l.id)}
                >
                  <Link2Off className="size-3" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No links yet — issue one to give this client a read-only view of their units.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Detail page `src/app/(dashboard)/clients/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient, listClientUnits, listClientLinks } from "@/features/clients/queries";
import { ClientHeader } from "@/features/clients/components/client-header";
import { PortalLinksPanel } from "@/features/clients/components/portal-links-panel";

export default async function ClientDetailPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const [client, units, links] = await Promise.all([
    getClient(id),
    listClientUnits(id),
    listClientLinks(id),
  ]);
  // RLS returns nothing for foreign orgs' clients — the 404 we want.
  if (!client) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <ClientHeader id={client.id} name={client.name} />
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">
          Units ({units.length})
        </h2>
        {units.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No units yet — assign this client on a unit row in a program.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {units.map((u) => (
              <li key={u.unitId}>
                <Link
                  href={`/programs/${u.programId}/units/${u.unitId}`}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent/50"
                >
                  <span className="min-w-0 truncate">{u.unitName}</span>
                  {u.externalRef ? (
                    <span className="text-muted-foreground shrink-0 font-mono text-xs">{u.externalRef}</span>
                  ) : null}
                  <span className="text-muted-foreground ml-auto shrink-0 truncate text-xs">{u.programName}</span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                    {u.done}/{u.total}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <PortalLinksPanel clientId={client.id} links={links} />
    </div>
  );
}
```

- [ ] **Step 7: Verify + commit**

Run: `npm run verify`
Expected: PASS (typegen picks up the new routes).

```bash
git add src/app/\(dashboard\)/clients src/features/clients/components src/components/shell/nav.ts src/components/command-menu.tsx
git commit -m "feat: /clients console pages, nav, palette entries (slice 9)"
```

---

### Task 8: Client picker on unit rows

**Files:**
- Create: `src/features/clients/components/assign-client.tsx`
- Modify: `src/features/programs/queries.ts` (`Unit` + `getProgram`), `src/features/programs/components/unit-list.tsx`, `src/features/programs/components/unit-row.tsx`, `src/app/(dashboard)/programs/[id]/page.tsx`

**Interfaces:**
- Consumes: `assignClient`, `createClient` (Task 6 actions), `ClientOption`/`listClientOptions` (Task 6 queries).
- Produces: `Unit.clientId: string | null`; `UnitRow`/`UnitList` accept `clients: ClientOption[]`.

- [ ] **Step 1: Extend the read model**

In `src/features/programs/queries.ts`:
- `Unit` type gains `clientId: string | null;` (after `assignedParticipantId`).
- In `getProgram`, add `client_id` to the units select string (next to `assigned_participant_id`) and `clientId: u.client_id as string | null,` to the unit mapping (mirroring how `assignedParticipantId` is mapped).

- [ ] **Step 2: Create `src/features/clients/components/assign-client.tsx`** (AssignParticipant pattern)

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { assignClient, createClient } from "@/features/clients/actions";
import type { ClientOption } from "@/features/clients/queries";

const NEW_SENTINEL = "__new__";

// Compact per-row control. Optimistic value; server truth reconciles via
// revalidatePath. Inline "New…" prompts for a name (window.prompt keeps v1
// minimal — the assign-participant precedent).
export function AssignClient({
  unitId,
  unitName,
  programId,
  clients,
  value,
}: {
  unitId: string;
  unitName: string;
  programId: string;
  clients: ClientOption[];
  value: string | null;
}) {
  const [optimistic, setOptimistic] = React.useState(value);
  const [, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    if (next === NEW_SENTINEL) {
      const name = window.prompt("New client name")?.trim();
      if (!name) return;
      startTransition(async () => {
        const created = await createClient({ name, programId });
        if (!created.ok) {
          toast.error(created.error);
          return;
        }
        setOptimistic(created.id);
        const assigned = await assignClient({ unitId, clientId: created.id });
        if (!assigned.ok) {
          setOptimistic(value);
          toast.error("Client created, but assigning failed. Pick them from the list.");
        }
      });
      return;
    }
    const clientId = next === "" ? null : next;
    setOptimistic(clientId);
    startTransition(async () => {
      const result = await assignClient({ unitId, clientId });
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't save. Try again.");
        // A failed action doesn't revalidate — the control reverts itself.
        setOptimistic(value);
      }
    });
  };

  return (
    <select
      value={optimistic ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Assign client for ${unitName}`}
      className="border-input text-muted-foreground h-7 max-w-36 shrink-0 truncate rounded-md border bg-transparent px-1.5 text-xs"
    >
      <option value="">No client</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
      <option value={NEW_SENTINEL}>+ New client…</option>
    </select>
  );
}
```

- [ ] **Step 3: Thread through `unit-row.tsx`**

In `src/features/programs/components/unit-row.tsx`: import `AssignClient` and `ClientOption`; add `clients: ClientOption[];` to the props type and destructuring; render directly after `<AssignParticipant … />`:

```tsx
      <AssignClient
        unitId={unit.id}
        unitName={unit.name}
        programId={programId}
        clients={clients}
        value={unit.clientId}
      />
```

- [ ] **Step 4: Thread through `unit-list.tsx`**

In `src/features/programs/components/unit-list.tsx`:
- import `ClientOption`; add `clients: ClientOption[];` to props and pass `clients={clients}` to `UnitRow`.
- the `"add"` branch of `applyEvent` gains `clientId: null,` next to `assignedParticipantId: null,`.
- extend the keyed-remount key so a server-truth client change re-seeds the control:

```tsx
            key={`${unit.id}:${unit.name}:${unit.assignedParticipantId ?? ""}:${unit.clientId ?? ""}`}
```

- [ ] **Step 5: Fetch options on the program page**

In `src/app/(dashboard)/programs/[id]/page.tsx`: import `listClientOptions` from `@/features/clients/queries`, add it to the `Promise.all` (fourth element, `clients`), and pass `clients={clients}` to `<UnitList …>`.

- [ ] **Step 6: Verify + commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/clients/components/assign-client.tsx src/features/programs src/app/\(dashboard\)/programs/\[id\]/page.tsx
git commit -m "feat: per-unit client picker (slice 9)"
```

---

### Task 9: Branding — storage helpers, org actions, /settings, BrandedHeader

**Files:**
- Create: `src/components/branded-header.tsx`, `src/features/orgs/queries.ts`, `src/features/orgs/components/branding-form.tsx`, `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/lib/storage/branding.ts` (extend), `src/features/orgs/schema.ts`, `src/features/orgs/actions.ts`, `src/components/shell/nav.ts`
- Test: `src/lib/storage/branding.test.ts`, `src/features/orgs/schema.test.ts` (extend)

**Interfaces:**
- Consumes: `update_org_branding` RPC (Task 2), `BRANDING_BUCKET`/`publicLogoUrl` (Task 5).
- Produces:
  - `LOGO_MIME_EXTENSIONS: Record<string,string>` (jpeg/png/webp), `LOGO_MAX_BYTES = 1_048_576`, `isAllowedLogoType(mime): boolean`, `logoPathFor(orgId, checksum, mime): string | null`, `uploadBrandingObject(path, bytes, contentType): Promise<boolean>`, `deleteBrandingObject(path): Promise<void>`
  - `accentColorInput` Zod value (nullable, normalises to lowercase)
  - actions: `updateAccent(input): Promise<ActionState>`, `uploadLogo(formData): Promise<ActionState>`, `removeLogo(): Promise<ActionState>`
  - `getBrandingSettings(): Promise<{ orgId; orgName; accentColor; logoPath; logoUrl } | null>`
  - `BrandedHeader({ orgName, accentColor, logoUrl, subtitle? })` — server-compatible presentational component (Tasks 10–11 render it).

- [ ] **Step 1: Write the failing storage tests**

`src/lib/storage/branding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAllowedLogoType, logoPathFor, LOGO_MAX_BYTES } from "./branding";

describe("branding storage helpers", () => {
  it("allows png/jpeg/webp and rejects svg (scriptable on a public bucket)", () => {
    expect(isAllowedLogoType("image/png")).toBe(true);
    expect(isAllowedLogoType("image/jpeg")).toBe(true);
    expect(isAllowedLogoType("image/webp")).toBe(true);
    expect(isAllowedLogoType("image/svg+xml")).toBe(false);
    expect(isAllowedLogoType("image/heic")).toBe(false);
  });

  it("builds org-prefixed content-hashed paths; null for disallowed mime", () => {
    expect(logoPathFor("org-1", "abc123", "image/png")).toBe("org-1/logo-abc123.png");
    expect(logoPathFor("org-1", "abc123", "image/svg+xml")).toBeNull();
  });

  it("caps at 1 MB", () => {
    expect(LOGO_MAX_BYTES).toBe(1_048_576);
  });
});
```

Run: `npm test -- src/lib/storage/branding.test.ts`
Expected: FAIL — helpers not exported yet.

- [ ] **Step 2: Extend `src/lib/storage/branding.ts`**

Append (evidence.ts/photo.ts idioms):

```ts
// Logo caps. SVG is deliberately absent: a scriptable format on a
// directly-navigable public URL never enters the bucket (spec decision).
export const LOGO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const LOGO_MAX_BYTES = 1_048_576; // mirrors the bucket cap

export function isAllowedLogoType(mime: string): boolean {
  return Object.hasOwn(LOGO_MIME_EXTENSIONS, mime);
}

// Content-hashed name: replacement busts caches for free; the org_id
// prefix is what update_org_branding's prefix check pins.
export function logoPathFor(orgId: string, checksum: string, mime: string): string | null {
  const ext = LOGO_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${orgId}/logo-${checksum}.${ext}`;
}

// upsert: same bytes → same path, so re-uploading an identical logo is a
// no-op rather than an error.
export async function uploadBrandingObject(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(BRANDING_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error("[storage] logo upload failed:", error.message);
    return false;
  }
  return true;
}

// Best-effort: a failed delete leaves an orphan (accepted wart — the
// evidence.ts precedent). Never throws.
export async function deleteBrandingObject(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BRANDING_BUCKET).remove([path]);
  if (error) console.error("[storage] orphaned logo, delete failed:", error.message);
}
```

Run: `npm test -- src/lib/storage/branding.test.ts`
Expected: PASS.

- [ ] **Step 3: Zod + tests in `src/features/orgs/`**

In `src/features/orgs/schema.ts` append:

```ts
// Normalised to lowercase — the orgs_accent_color_check CHECK expects it.
export const accentColorInput = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb")
  .transform((v) => v.toLowerCase())
  .nullable();
export const updateAccentInput = z.object({ accentColor: accentColorInput });
```

(If the file doesn't import `z` yet at top-level scope in a way these can use, it already does — `createOrgSchema` is Zod.)

In `src/features/orgs/schema.test.ts` append a describe block:

```ts
describe("accent colour input", () => {
  it("normalises to lowercase and accepts null", () => {
    expect(updateAccentInput.parse({ accentColor: "#0F766E" }).accentColor).toBe("#0f766e");
    expect(updateAccentInput.parse({ accentColor: null }).accentColor).toBeNull();
  });
  it("rejects non-hex", () => {
    expect(updateAccentInput.safeParse({ accentColor: "teal" }).success).toBe(false);
    expect(updateAccentInput.safeParse({ accentColor: "#fff" }).success).toBe(false);
  });
});
```

(Add `updateAccentInput` to that file's imports.)

Run: `npm test -- src/features/orgs/schema.test.ts`
Expected: PASS.

- [ ] **Step 4: Queries `src/features/orgs/queries.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { publicLogoUrl } from "@/lib/storage/branding";

export type BrandingSettings = {
  orgId: string;
  orgName: string;
  accentColor: string | null;
  logoPath: string | null;
  logoUrl: string | null;
};

// RLS-scoped; single-org assumption matches the currentOrgId convention.
export async function getBrandingSettings(): Promise<BrandingSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, accent_color, logo_path")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    orgId: data.id,
    orgName: data.name,
    accentColor: data.accent_color,
    logoPath: data.logo_path,
    logoUrl: data.logo_path ? publicLogoUrl(data.logo_path) : null,
  };
}
```

- [ ] **Step 5: Actions in `src/features/orgs/actions.ts`**

Append (the file keeps `createOrg`; add imports for `revalidatePath`, `createHash` from `node:crypto`, the branding helpers, the new schema, and `GENERIC_WRITE_ERROR`/`ActionState` from `@/lib/actions`):

```ts
type OrgBrandingRow = { id: string; accent_color: string | null; logo_path: string | null };

async function currentOrgBranding(): Promise<OrgBrandingRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orgs")
    .select("id, accent_color, logo_path")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

function brandingFail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[orgs] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

// update_org_branding has FULL-STATE semantics: every call passes both
// values, so each action threads the current value of the field it is NOT
// changing.
export async function updateAccent(input: unknown): Promise<ActionState> {
  const parsed = updateAccentInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const org = await currentOrgBranding();
  if (!org) return brandingFail("updateAccent", "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: parsed.data.accentColor,
    p_logo_path: org.logo_path,
  });
  if (error) return brandingFail("updateAccent", error);
  revalidatePath("/settings");
  return { ok: true };
}

export async function uploadLogo(formData: FormData): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: GENERIC_WRITE_ERROR };
  if (file.size === 0 || file.size > LOGO_MAX_BYTES || !isAllowedLogoType(file.type)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const org = await currentOrgBranding();
  if (!org) return brandingFail("uploadLogo", "no org");

  const bytes = await file.arrayBuffer();
  // Re-check the buffered bytes, not just the File's reported size
  // (slice-8 photo precedent).
  if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = logoPathFor(org.id, checksum, file.type);
  if (!path) return { ok: false, error: GENERIC_WRITE_ERROR };

  if (!(await uploadBrandingObject(path, bytes, file.type))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: org.accent_color,
    p_logo_path: path,
  });
  if (error) {
    // Only compensate on a DEFINITE rejection (non-empty error.code); a
    // transport failure is indeterminate and must leave the object — the
    // slice-8 asymmetric-compensation lesson.
    if (error.code) await deleteBrandingObject(path);
    return brandingFail("uploadLogo", error);
  }
  // DB update landed: the old object (different content hash) is now
  // unreferenced — delete it best-effort.
  if (org.logo_path && org.logo_path !== path) await deleteBrandingObject(org.logo_path);
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeLogo(): Promise<ActionState> {
  const org = await currentOrgBranding();
  if (!org) return brandingFail("removeLogo", "no org");
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_org_branding", {
    p_org_id: org.id,
    p_accent_color: org.accent_color,
    p_logo_path: null,
  });
  if (error) return brandingFail("removeLogo", error);
  if (org.logo_path) await deleteBrandingObject(org.logo_path);
  revalidatePath("/settings");
  return { ok: true };
}
```

- [ ] **Step 6: `src/components/branded-header.tsx`**

```tsx
/* Shared header for the two token surfaces (/p and /portal). Pure and
   server-compatible; branding comes from getOrgBranding at the call site.
   The accent is a CHECK-validated #rrggbb hex, safe for inline style. */
export function BrandedHeader({
  orgName,
  accentColor,
  logoUrl,
  subtitle,
}: {
  orgName: string;
  accentColor: string | null;
  logoUrl: string | null;
  subtitle?: string;
}) {
  return (
    <div
      className="flex flex-col gap-2 border-b-2 pb-3"
      style={accentColor ? { borderBottomColor: accentColor } : undefined}
    >
      <div className="flex items-center gap-2">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external
          // Supabase public URL; next/image needs remotePatterns config for
          // marginal gain on a tiny logo.
          <img src={logoUrl} alt={`${orgName} logo`} className="h-6 w-auto max-w-32 object-contain" />
        ) : null}
        <span className="text-sm font-semibold">{orgName}</span>
      </div>
      {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
    </div>
  );
}
```

- [ ] **Step 7: Branding form `src/features/orgs/components/branding-form.tsx`**

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { updateAccent, uploadLogo, removeLogo } from "@/features/orgs/actions";
import type { BrandingSettings } from "@/features/orgs/queries";
import { LOGO_MAX_BYTES, isAllowedLogoType } from "@/lib/storage/branding";
import { BrandedHeader } from "@/components/branded-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BrandingForm({ settings }: { settings: BrandingSettings }) {
  const [accent, setAccent] = React.useState(settings.accentColor ?? "");
  const [pending, startTransition] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const saveAccent = () => {
    const value = accent.trim();
    if (value !== "" && !HEX_RE.test(value)) {
      toast.error("Accent must be a #rrggbb hex colour.");
      return;
    }
    startTransition(async () => {
      const result = await updateAccent({ accentColor: value === "" ? null : value });
      if (!result.ok) toast.error(result.error);
      else toast.success("Accent saved");
    });
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Pre-check before any bytes move (participant-flow precedent); the
    // server re-validates against the buffered bytes.
    if (!isAllowedLogoType(file.type)) {
      toast.error("PNG, JPEG or WebP only.");
      e.target.value = "";
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error("Logo must be 1 MB or less.");
      e.target.value = "";
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadLogo(formData);
      if (!result.ok) toast.error(result.error);
      else toast.success("Logo updated");
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const remove = () =>
    startTransition(async () => {
      const result = await removeLogo();
      if (!result.ok) toast.error(result.error);
    });

  const previewAccent = HEX_RE.test(accent.trim()) ? accent.trim().toLowerCase() : settings.accentColor;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-logo">Logo</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={fileRef}
            id="branding-logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onFile}
            disabled={pending}
            className="max-w-72"
          />
          {settings.logoUrl ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">PNG, JPEG or WebP · max 1 MB.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-accent">Accent colour</Label>
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-6 shrink-0 rounded border"
            style={previewAccent ? { backgroundColor: previewAccent } : undefined}
          />
          <Input
            id="branding-accent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
            onBlur={saveAccent}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="#0f766e"
            maxLength={7}
            className="max-w-32 font-mono"
          />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Preview</p>
        <div className="rounded-lg border p-4">
          <BrandedHeader
            orgName={settings.orgName}
            accentColor={previewAccent}
            logoUrl={settings.logoUrl}
            subtitle="How the participant flow and client portal header will look"
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Settings page + nav**

`src/app/(dashboard)/settings/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getBrandingSettings } from "@/features/orgs/queries";
import { BrandingForm } from "@/features/orgs/components/branding-form";

export default async function SettingsPage() {
  const settings = await getBrandingSettings();
  if (!settings) notFound();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="flex flex-col gap-3">
        <h2 className="text-muted-foreground text-sm font-medium">Branding</h2>
        <BrandingForm settings={settings} />
      </div>
    </div>
  );
}
```

`src/components/shell/nav.ts` — append to `NAV_ITEMS` (add `Settings2` to the lucide import):

```ts
  { href: "/settings", label: "Settings", icon: Settings2 },
```

- [ ] **Step 9: Verify + commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/lib/storage/branding.ts src/lib/storage/branding.test.ts src/features/orgs src/components/branded-header.tsx src/app/\(dashboard\)/settings src/components/shell/nav.ts
git commit -m "feat: org branding — storage, RPC actions, /settings, BrandedHeader (slice 9)"
```

---

### Task 10: Apply BrandedHeader to /p

**Files:**
- Modify: `src/app/p/[token]/page.tsx`, `src/app/p/[token]/units/[unitId]/page.tsx`

**Interfaces:**
- Consumes: `BrandedHeader` (Task 9), `getOrgBranding` (Task 5).

- [ ] **Step 1: Entry page**

In `src/app/p/[token]/page.tsx`, add imports:

```tsx
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
```

After the `if (scope.unitId) redirect(...)` line, fetch both in parallel:

```tsx
  const [units, branding] = await Promise.all([
    getParticipantUnits(scope),
    getOrgBranding(scope.orgId),
  ]);
```

(remove the old `const units = await getParticipantUnits(scope);`) and replace the existing `<header>…</header>` block with:

```tsx
      <BrandedHeader
        orgName={scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
        subtitle={scope.programName}
      />
      <h1 className="text-lg font-semibold">Hi {scope.participantName}</h1>
```

- [ ] **Step 2: Unit page**

In `src/app/p/[token]/units/[unitId]/page.tsx`, same imports; fetch branding alongside the detail:

```tsx
  const [unit, branding] = await Promise.all([
    getParticipantUnitDetail(resolved.scope, unitId),
    getOrgBranding(resolved.scope.orgId),
  ]);
```

and at the top of the returned `<main>`, before the existing `<header>`, insert:

```tsx
      <BrandedHeader
        orgName={resolved.scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
      />
```

(keep the existing header block — back-link/program line and unit title — unchanged below it, but delete its now-duplicated `{resolved.scope.orgName} · {resolved.scope.programName}` paragraph in the `unitId`-pinned branch and leave the back-link branch as is).

- [ ] **Step 3: Verify + commit**

Run: `npm run verify && npm run test:integration -- src/features/participants/readers.integration.test.ts`
Expected: PASS.

```bash
git add src/app/p
git commit -m "feat: branded header on the participant flow (slice 9)"
```

---

### Task 11: Portal pages

**Files:**
- Create: `src/app/portal/layout.tsx`, `src/app/portal/[token]/page.tsx`, `src/app/portal/[token]/units/[unitId]/page.tsx`

**Interfaces:**
- Consumes: `resolvePortalToken`, `getPortalUnits`, `getPortalUnitDetail`, `clientKeyFrom` from `@/lib/tokens`; `getOrgBranding`; `BrandedHeader`; `Badge`.
- Produces: the `/portal/[token]` surface. (Headers for `/portal/:path*` already ship in `next.config.ts`; `updateSession` never redirects, so no proxy change.)

- [ ] **Step 1: `src/app/portal/layout.tsx`**

```tsx
// Read-only client surface: wider than /p (office viewers, tables of
// sites), same bare chrome — the link is the only way in.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4">{children}</div>;
}
```

- [ ] **Step 2: Home `src/app/portal/[token]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { resolvePortalToken, getPortalUnits, clientKeyFrom } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { Badge } from "@/components/ui/badge";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default async function PortalEntryPage({ params }: PageProps<"/portal/[token]">) {
  const { token } = await params;
  const h = await headers();
  const resolved = await resolvePortalToken(token, clientKeyFrom(h));

  if (resolved.status === "not_found") notFound();
  if (resolved.status === "rate_limited") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">Too many requests</h1>
        <p className="text-muted-foreground text-sm">Too many requests — wait a minute and reload.</p>
      </main>
    );
  }
  // `!== "ok"` so TS narrows the remaining union (the /p precedent).
  if (resolved.status !== "ok") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">
          This link has {resolved.status === "revoked" ? "been revoked" : "expired"}
        </h1>
        <p className="text-muted-foreground text-sm">Ask {resolved.orgName} to send you a new one.</p>
      </main>
    );
  }

  const { scope } = resolved;
  const [groups, branding] = await Promise.all([
    getPortalUnits(scope),
    getOrgBranding(scope.orgId),
  ]);

  return (
    <main className="flex flex-col gap-6">
      <BrandedHeader
        orgName={scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
        subtitle={scope.clientName}
      />
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here yet — check back soon.</p>
      ) : (
        groups.map((g) => {
          const done = g.units.filter((u) => u.done === u.total && u.total > 0).length;
          return (
            <section key={g.programId} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{g.programName}</h2>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {done} of {g.units.length} done
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {g.units.map((u) => (
                  <li key={u.id}>
                    <Link
                      href={`/portal/${token}/units/${u.id}`}
                      className="flex items-center gap-2 rounded-lg border p-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{u.name}</span>
                        {u.externalRef ? (
                          <span className="text-muted-foreground font-mono text-xs">{u.externalRef}</span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                        {u.lastActivity ? formatDate(u.lastActivity) : "no activity yet"}
                      </span>
                      <Badge
                        variant={u.done === u.total && u.total > 0 ? "secondary" : "outline"}
                        className="shrink-0 text-[10px]"
                      >
                        {u.done === u.total && u.total > 0 ? "complete" : `${u.done}/${u.total} stages`}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </main>
  );
}
```

- [ ] **Step 3: Unit detail `src/app/portal/[token]/units/[unitId]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolvePortalToken, getPortalUnitDetail, clientKeyFrom } from "@/lib/tokens";
import type { PortalItem } from "@/lib/tokens";
import { getOrgBranding } from "@/lib/org-branding";
import { BrandedHeader } from "@/components/branded-header";
import { Badge } from "@/components/ui/badge";

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

// Typed values → display strings. Dates pass through formatDate; booleans
// read as Yes/No; photo items render tiles instead of a value line.
function formatValue(item: PortalItem): string {
  if (item.value === null) return "—";
  if (item.type === "boolean") return item.value ? "Yes" : "No";
  if (item.type === "date") return formatDate(String(item.value));
  return String(item.value);
}

export default async function PortalUnitPage({ params }: PageProps<"/portal/[token]/units/[unitId]">) {
  const { token, unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const h = await headers();
  const resolved = await resolvePortalToken(token, clientKeyFrom(h));
  if (resolved.status === "not_found") notFound();
  if (resolved.status === "rate_limited") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">Too many requests</h1>
        <p className="text-muted-foreground text-sm">Too many requests — wait a minute and reload.</p>
      </main>
    );
  }
  if (resolved.status !== "ok") {
    return (
      <main className="pt-16 text-center">
        <Link href={`/portal/${token}`} className="text-sm underline">This link is no longer active</Link>
      </main>
    );
  }

  const [unit, branding] = await Promise.all([
    getPortalUnitDetail(resolved.scope, unitId),
    getOrgBranding(resolved.scope.orgId),
  ]);
  if (!unit) notFound(); // out of scope reads as nonexistent

  return (
    <main className="flex flex-col gap-4">
      <BrandedHeader
        orgName={resolved.scope.orgName}
        accentColor={branding.accentColor}
        logoUrl={branding.logoUrl}
      />
      <header className="flex flex-col gap-0.5">
        <Link href={`/portal/${token}`} className="text-muted-foreground w-fit text-xs hover:underline">
          ← All sites
        </Link>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">{unit.programName}</p>
      </header>
      <ol className="flex flex-col gap-3">
        {unit.stages.map((s) => (
          <li key={s.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{s.name}</span>
              {s.status === "done" ? (
                <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                  done{s.doneAt ? ` · ${formatDate(s.doneAt)}` : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                  awaiting
                </Badge>
              )}
            </div>
            {/* THE portal rule: pending stages render nothing below the name. */}
            {s.items.length > 0 ? (
              <dl className="mt-2 flex flex-col gap-1.5">
                {s.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <dt className="text-muted-foreground min-w-0 truncate">{item.label}</dt>
                      {item.type !== "photo" ? (
                        <dd className="shrink-0 font-medium">{formatValue(item)}</dd>
                      ) : null}
                    </div>
                    {item.photos.length > 0 ? (
                      <dd className="flex flex-wrap gap-2">
                        {item.photos.map((p) =>
                          p.url ? (
                            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Supabase URL
                            <img
                              key={p.id}
                              src={p.url}
                              alt={p.filename}
                              className="h-20 w-20 rounded-md border object-cover"
                            />
                          ) : (
                            <span
                              key={p.id}
                              className="text-muted-foreground flex h-20 w-20 items-center justify-center rounded-md border p-1 text-center text-[10px]"
                            >
                              {p.filename}
                            </span>
                          ),
                        )}
                      </dd>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run verify`
Expected: PASS (typegen picks up the portal routes).

```bash
git add src/app/portal
git commit -m "feat: read-only client portal pages (slice 9)"
```

---

### Task 12: Seed, graph, full verification

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: everything above; `generateAccessToken` (Task 4 name).

- [ ] **Step 1: Seed a demo client + portal link**

In `scripts/seed.ts` add after `DEMO_PARTICIPANT`:

```ts
const DEMO_CLIENT = "Acme Retail Ltd";
```

Add this function after `ensureDemoParticipant` (same idioms: idempotent, active-link short-circuit, link printed once):

```ts
async function ensureDemoClient(client: SupabaseClient, orgId: string): Promise<void> {
  const { data: program } = await client
    .from("programs").select("id").eq("org_id", orgId).eq("name", DEMO_PROGRAM).maybeSingle();
  if (!program) throw new Error(`seed: program "${DEMO_PROGRAM}" not found`);

  let { data: demoClient } = await client
    .from("clients").select("id").eq("org_id", orgId).eq("name", DEMO_CLIENT).maybeSingle();
  if (!demoClient) {
    const { data: created, error } = await client
      .from("clients").insert({ org_id: orgId, name: DEMO_CLIENT }).select("id").single();
    if (error) throw error;
    demoClient = created;
    console.log(`seed: created client "${DEMO_CLIENT}"`);
  }

  const { error: assignError } = await client
    .from("units").update({ client_id: demoClient!.id }).eq("program_id", program.id);
  if (assignError) throw assignError;

  const { data: existing } = await client
    .from("access_tokens")
    .select("id")
    .eq("client_id", demoClient!.id)
    .eq("kind", "portal")
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if ((existing ?? []).length > 0) {
    console.log("seed: an active portal link already exists (revoke it to re-issue)");
    return;
  }

  const { token, tokenHash } = generateAccessToken();
  const { data: me } = await client.auth.getUser();
  const { error: mintError } = await client.from("access_tokens").insert({
    org_id: orgId,
    token_hash: tokenHash,
    kind: "portal",
    client_id: demoClient!.id,
    expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    created_by: me!.user!.id,
  });
  if (mintError) throw mintError;
  console.log(`seed: portal link (shown once) → http://localhost:3000/portal/${token}`);
}
```

And in `main()`, after `await ensureDemoParticipant(client, orgId);` add:

```ts
  await ensureDemoClient(client, orgId);
```

- [ ] **Step 2: Run the seed**

Run: `npm run db:seed`
Expected: creates the client, assigns both demo units, prints a `/portal/...` link. Open it in a browser if the dev server is up — home shows "Q3 Store Refresh" with two sites; Store #101's Survey stage expands with its two answers.

- [ ] **Step 3: Full verification**

Run: `npm run verify && npm run test:integration`
Expected: ALL suites pass (existing 184 + the two new files).

Run: `graphify update .`
Expected: graph refreshed (project rule).

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts
git commit -m "chore: seed demo client + portal link (slice 9)"
```

---

## Plan self-review (already applied)

- **Spec coverage:** data model → Tasks 1–2; token surface + `lib/tokens` split → Tasks 2/4/5; portal read model rules (done-expands, no-names, last-activity `greatest`) → Task 5 (+ tests); branding (bucket, RPC, full-state semantics, no-SVG, compensation) → Tasks 2/9; console (`/clients`, detail + links panel, picker, nav, palette, `/settings`) → Tasks 6–9; portal pages + `/p` branding → Tasks 10–11; kind isolation / lifecycle / RLS / guard tests → Tasks 3/5; seed + demo scene → Task 12. The spec's "no proxy change needed" is a non-task by design.
- **Type consistency:** `generateAccessToken` (4, 6, 12); `PortalScope`/`PortalProgramGroup`/`PortalUnitDetail`/`PortalItem` (5 → 11); `ClientOption`/`assignClient` (6 → 8); `BrandingSettings`/`BrandedHeader` (9 → 10–11); `tokenLimiter`/`clientKeyFrom` (4 → 5).
- **Placeholder scan:** every code step carries real code; the two "modify existing select" steps (Task 8 Step 1) name the exact columns and mapping lines.
