# Photo Evidence (Slice 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A photo from a phone lands in the unit's record with checksum + attribution: participant-flow upload to Supabase Storage, an `evidence` metadata table that satisfies photo requirements through the existing derivation, and read-only console display.

**Architecture:** Server-relay upload — the phone POSTs FormData to a Next server action, which resolves the token via `lib/tokens`, sha256s the bytes, uploads via the service-role admin client to a fully private bucket (zero storage policies), then records the row through a new anon-callable SECURITY DEFINER RPC (`record_photo_evidence`) whose path-prefix check pins writes to the token's own `org/program/unit/` folder. Photo satisfaction = an all-null `unit_stage_responses` row (CHECK relaxed for `type='photo'`) + ≥1 `evidence` row via `response_id`; a new trigger on `evidence` re-derives the stage.

**Tech Stack:** Next 16.3.0 (App Router, server actions), Supabase (Postgres RLS + Storage), Drizzle migrations, supabase-js v2, Zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-10-photo-evidence-design.md` (approved). Branch: `feat/photo-evidence` (already exists, spec committed).

## Global Constraints

- Every new table: `org_id`, index every RLS-referenced column, **explicit GRANTs in the same migration** (0004/0011 convention).
- 0013 already revoked anon's default privileges on all current AND future tables — `evidence` gets no anon access automatically; tests still assert 42501.
- 404 discipline: RPC scope/validation failures `raise exception 'not found'` (surfaces as P0001); actions return `GENERIC_WRITE_ERROR`; **tokens are NEVER logged**.
- The security boundary is 256-bit token entropy; the TS rate limiter is hygiene only.
- `service_role` stays server-only; `evidence` rows are written ONLY inside definer RPCs.
- Photo caps: 15MB (`15728640` bytes), mime allowlist `image/jpeg, image/png, image/webp, image/heic, image/heif`. Original bytes stored untouched (EXIF preserved) — never re-encode.
- Next 16.3.0 differs from training data — consult `node_modules/next/dist/docs/` before deviating. Verified for this plan: `experimental.serverActions.bodySizeLimit` in `next.config.ts` (docs: `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`).
- Run `npm run verify` (lint + typecheck + unit tests) before each commit; integration tests need the local stack (`npm run setup` once).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## File Structure

```
src/db/schema/evidence.ts                              NEW  drizzle table
src/db/schema/index.ts                                 MOD  barrel export
src/db/migrations/0014_*.sql                           GEN  drizzle-kit generate
src/db/migrations/0015_evidence_security.sql           NEW  bucket, CHECKs, RLS,
                                                            grants, RPCs, triggers
src/lib/storage/photo.ts                               NEW  pure helpers (client-safe)
src/lib/storage/photo.test.ts                          NEW  unit tests
src/lib/storage/evidence.ts                            NEW  server-only storage ops
src/features/participants/schema.ts                    MOD  +upload/remove Zod inputs
src/features/participants/schema.test.ts               MOD  +input unit tests
src/features/participants/flow-actions.ts              MOD  +uploadPhoto, +removePhoto
src/features/participants/evidence.integration.test.ts NEW  SQL-surface tests
src/features/programs/queries.ts                       MOD  EvidencePhoto, photos in getUnit
src/lib/tokens/index.ts                                MOD  photos in getParticipantUnitDetail
src/features/programs/components/requirement-field.tsx MOD  photo renderer
src/features/programs/components/unit-stage-sections.tsx     MOD  photo in derive/chips
src/features/participants/components/participant-stage-sections.tsx MOD  photo wiring
src/features/templates/schema.ts                       MOD  requirementType += photo
src/features/templates/components/add-requirement.tsx  MOD  TYPES += photo
next.config.ts                                         MOD  bodySizeLimit
```

---

### Task 1: `evidence` table + the security migration

**Files:**
- Create: `src/db/schema/evidence.ts`
- Modify: `src/db/schema/index.ts`
- Generate: `src/db/migrations/0014_*.sql` (via `npm run db:generate`)
- Create: `src/db/migrations/0015_evidence_security.sql` (via `npx drizzle-kit generate --custom --name=evidence_security`)

**Interfaces:**
- Consumes: existing tables/functions from 0011/0013 (`participant_scope_unit_stage`, `resolve_participant_token`, `derive_unit_stage`, `prepare_unit_stage_response`, `unit_stage_responses` CHECKs).
- Produces: table `public.evidence`; bucket `evidence`; RPCs `record_photo_evidence(p_token text, p_unit_id uuid, p_requirement_id uuid, p_path text, p_filename text, p_mime text, p_size_bytes bigint, p_checksum_sha256 text) → uuid` and `delete_photo_evidence(p_token text, p_evidence_id uuid) → text`, both EXECUTE-granted to **anon only**; photo-aware `derive_unit_stage`; photo guards in `submit_participant_response` / `clear_participant_response`; relaxed `unit_stage_responses` CHECKs.

- [ ] **Step 1: Write the drizzle table**

`src/db/schema/evidence.ts`:

```ts
import { pgTable, uuid, text, timestamp, bigint, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { units, unitStages, unitStageResponses } from "./programs";
import { participants } from "./participants";

// Metadata only — the row is the compliance record; bytes live in the
// private `evidence` storage bucket at `path`. Rows are written ONLY by the
// definer RPCs in 0015 (no client insert/update/delete on either API role),
// so unlike access_tokens no org-guard trigger is needed: the RPC derives
// org/unit/stage from the resolved token scope, never from the caller.
export const evidence = pgTable(
  "evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    unitStageId: uuid("unit_stage_id")
      .notNull()
      .references(() => unitStages.id, { onDelete: "cascade" }),
    // Nullable by design: evidence survives its response (the audit trail);
    // photo satisfaction requires BOTH the response row and the link.
    responseId: uuid("response_id").references(() => unitStageResponses.id, {
      onDelete: "set null",
    }),
    // 'supabase' in v1; BYO providers post-v1. CHECK lives in 0015.
    provider: text("provider").notNull().default("supabase"),
    path: text("path").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    uploadedByParticipantId: uuid("uploaded_by_participant_id").references(
      () => participants.id,
      { onDelete: "set null" },
    ),
    // Staff upload path is post-v1; the column exists from day one (spec).
    uploadedByUserId: uuid("uploaded_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("evidence_org_id_idx").on(t.orgId),
    index("evidence_unit_id_idx").on(t.unitId),
    index("evidence_unit_stage_id_idx").on(t.unitStageId),
    index("evidence_response_id_idx").on(t.responseId),
  ],
);
```

- [ ] **Step 2: Export from the barrel**

In `src/db/schema/index.ts` add the export and update the inventory comment:

```ts
// Barrel for all Drizzle table definitions. One file per aggregate.
// As the domain grows, add: clients, portal-specific tables.
// Current: orgs, templates, programs, unitStages, requirements, participants, accessTokens, evidence.
export * from "./orgs";
export * from "./templates";
export * from "./programs";
export * from "./participants";
export * from "./evidence";
```

- [ ] **Step 3: Generate the schema migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0014_<random-name>.sql` containing `CREATE TABLE "evidence"`, its four indexes, and FKs. Inspect it — it must NOT touch any other table.

- [ ] **Step 4: Create the custom security migration**

Run: `npx drizzle-kit generate --custom --name=evidence_security`
Then fill `src/db/migrations/0015_evidence_security.sql` with exactly:

```sql
-- Custom SQL migration file, put your code below! --

-- Photo evidence security model (slice 8):
--   * evidence: metadata only — the row is the compliance record. Member
--     SELECT via org; NO client writes on either API role. Rows are written
--     ONLY inside the definer RPCs below; service_role gets select for the
--     token-scoped flow reads (lib/tokens).
--   * Bucket `evidence` is private with ZERO storage policies: every object
--     read/write goes through the server-only service-role client.
--   * record/delete_photo_evidence are anon-callable, token-keyed (the 0013
--     discipline). The path-prefix check pins a caller inside its own
--     org/program/unit folder — without it a valid token could point `path`
--     at another org's object and have its console sign a foreign URL.
--   * unit_stage_responses: type/one-value CHECKs relaxed so type='photo'
--     with all-null values is the (only) valid all-null shape — the wiring
--     0011 explicitly deferred to slice 8.
--   * derive_unit_stage: photo joins the derivation; satisfied := response
--     row exists AND >=1 evidence row via response_id. A new AFTER trigger
--     on evidence re-derives (insert/delete only — evidence is immutable).

-- ---------- Bucket (private; caps enforced at the storage floor too)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 15728640,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- ---------- CHECKs
alter table public.evidence
  add constraint evidence_provider_check check (provider in ('supabase'));

alter table public.unit_stage_responses
  drop constraint unit_stage_responses_type_check;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_type_check
  check (type in ('text','number','boolean','date','choice','photo'));

alter table public.unit_stage_responses
  drop constraint unit_stage_responses_one_value_check;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_one_value_check
  check (
    (type in ('text','choice') and value_text is not null and value_text <> ''
      and value_number is null and value_bool is null and value_date is null)
    or (type = 'number' and value_number is not null
      and value_text is null and value_bool is null and value_date is null)
    or (type = 'boolean' and value_bool is not null
      and value_text is null and value_number is null and value_date is null)
    or (type = 'date' and value_date is not null
      and value_text is null and value_number is null and value_bool is null)
    -- photo: the response row is the "answered" anchor; the VALUES live in
    -- the evidence table. The only legal all-null shape.
    or (type = 'photo' and value_text is null and value_number is null
      and value_bool is null and value_date is null)
  );

-- ---------- RLS & grants
alter table public.evidence enable row level security;

create policy "evidence_select_member" on public.evidence
  for select to authenticated using (org_id in (select public.user_orgs()));

grant select on table public.evidence to authenticated;
-- lib/tokens reads evidence for the participant flow via the admin client.
grant select on table public.evidence to service_role;
-- (0013's default-privileges revoke already keeps anon at zero here.)

-- ---------- derivation learns photo
-- Recreated VERBATIM from 0011 minus the photo exclusion: photo now counts,
-- and is satisfied when its response row has >=1 linked evidence row.
create or replace function public.derive_unit_stage(p_unit_stage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required int;
  v_satisfied int;
  v_done boolean;
begin
  select count(*) filter (where r.required),
         count(*) filter (where r.required and resp.id is not null
                            and (r.type <> 'boolean' or resp.value_bool)
                            and (r.type <> 'photo' or exists (
                              select 1 from public.evidence e
                               where e.response_id = resp.id)))
    into v_required, v_satisfied
    from public.unit_stages us
    join public.program_stage_requirements r on r.program_stage_id = us.program_stage_id
    left join public.unit_stage_responses resp
      on resp.program_stage_requirement_id = r.id and resp.unit_stage_id = us.id
   where us.id = p_unit_stage_id;

  if v_required is null or v_required = 0 then
    return; -- no required requirements: manual stage, leave it alone
  end if;

  v_done := v_satisfied = v_required;
  update public.unit_stages
     set status = case when v_done then 'done' else 'pending' end,
         done_source = case when v_done then 'requirements' else null end
   where id = p_unit_stage_id
     and (status is distinct from case when v_done then 'done' else 'pending' end
          or done_source is distinct from case when v_done then 'requirements' else null end);
end;
$$;

-- Same lockdown as 0011: definer + exposed schema would otherwise be a free
-- anon-key write to any unit_stage. Trigger-owner calls are unaffected.
revoke execute on function public.derive_unit_stage(uuid) from public, anon, authenticated, service_role;

-- ---------- evidence re-derives its stage (insert/delete; rows immutable)
create or replace function public.derive_unit_stage_from_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.derive_unit_stage(coalesce(new.unit_stage_id, old.unit_stage_id));
  return coalesce(new, old);
end;
$$;

create trigger evidence_derive
after insert or delete on public.evidence
for each row execute function public.derive_unit_stage_from_evidence();

-- ---------- record: token-keyed evidence write (anon-callable)
create or replace function public.record_photo_evidence(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  p_path text, p_filename text, p_mime text,
  p_size_bytes bigint, p_checksum_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
  v_us record;
  v_prefix text;
  v_response_id uuid;
  v_evidence_id uuid;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  if v_type <> 'photo' then
    raise exception 'not found';
  end if;

  -- Photos mirror "editable until done": a done stage locks its evidence.
  select us.org_id, us.program_id, us.status into v_us
    from public.unit_stages us where us.id = v_unit_stage_id;
  if v_us.status is distinct from 'pending' then
    raise exception 'not found';
  end if;

  -- Anon-facing metadata caps (the submit_participant_response precedent):
  -- uniform 'not found', no diagnostic detail. The storage bucket enforces
  -- size/mime on the bytes; these caps keep the METADATA row honest too.
  if p_filename is null or char_length(p_filename) < 1 or char_length(p_filename) > 200
     or p_mime not in ('image/jpeg','image/png','image/webp','image/heic','image/heif')
     or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 15728640
     or p_checksum_sha256 is null or p_checksum_sha256 !~ '^[0-9a-f]{64}$'
     or p_path is null or char_length(p_path) > 300 then
    raise exception 'not found';
  end if;

  -- THE cross-tenant lock: the prefix comes from the RESOLVED scope, never
  -- the caller. A direct PostgREST caller can only write inside its own
  -- unit's folder; worst case it fabricates a row pointing at a nonexistent
  -- object there — its own garbage, nobody else's photo.
  v_prefix := v_us.org_id::text || '/' || v_us.program_id::text || '/' || p_unit_id::text || '/';
  if left(p_path, char_length(v_prefix)) is distinct from v_prefix then
    raise exception 'not found';
  end if;

  -- The all-null photo response is the "answered" anchor (one per
  -- unit_stage × requirement). The 0011 prepare trigger fills type/denorms;
  -- the relaxed one-value CHECK admits the photo shape.
  insert into public.unit_stage_responses
    (unit_stage_id, program_stage_requirement_id, answered_by_participant_id)
  values (v_unit_stage_id, p_requirement_id, v_participant_id)
  on conflict (unit_stage_id, program_stage_requirement_id) do update
    set answered_by_participant_id = excluded.answered_by_participant_id
  returning id into v_response_id;

  insert into public.evidence
    (org_id, unit_id, unit_stage_id, response_id, provider, path, filename,
     mime, size_bytes, checksum_sha256, uploaded_by_participant_id)
  values
    (v_us.org_id, p_unit_id, v_unit_stage_id, v_response_id, 'supabase',
     p_path, p_filename, p_mime, p_size_bytes, p_checksum_sha256, v_participant_id)
  returning id into v_evidence_id;

  return v_evidence_id;
end;
$$;

revoke all on function public.record_photo_evidence(text, uuid, uuid, text, text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.record_photo_evidence(text, uuid, uuid, text, text, text, bigint, text) to anon;

-- ---------- delete: pending-only, returns the path for object cleanup
create or replace function public.delete_photo_evidence(p_token text, p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_ev public.evidence;
begin
  select * into v_scope from public.resolve_participant_token(p_token);
  if v_scope.status is null or v_scope.status <> 'ok' then
    raise exception 'not found';
  end if;
  -- Scope is LIVE (assignment now), stage must still be pending.
  select e.* into v_ev
    from public.evidence e
    join public.units u on u.id = e.unit_id
    join public.unit_stages us on us.id = e.unit_stage_id
   where e.id = p_evidence_id
     and e.org_id = v_scope.org_id
     and u.program_id = v_scope.program_id
     and u.assigned_participant_id = v_scope.participant_id
     and (v_scope.unit_id is null or u.id = v_scope.unit_id)
     and us.status = 'pending';
  if v_ev.id is null then
    raise exception 'not found';
  end if;

  delete from public.evidence where id = v_ev.id;
  -- Last photo out deletes the anchor: the requirement reads "unanswered"
  -- again and no ghost attribution survives.
  if v_ev.response_id is not null and not exists (
      select 1 from public.evidence e2 where e2.response_id = v_ev.response_id) then
    delete from public.unit_stage_responses where id = v_ev.response_id;
  end if;
  return v_ev.path;
end;
$$;

revoke all on function public.delete_photo_evidence(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_photo_evidence(text, uuid) to anon;

-- ---------- photo guards on the slice-7 RPCs
-- Photos have their own lifecycle (the RPCs above); the scalar write/clear
-- paths must not create a value-bearing photo row or delete a response that
-- anchors evidence. Both recreated VERBATIM from 0013 plus the guard.
create or replace function public.submit_participant_response(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  p_value_text text, p_value_number numeric, p_value_bool boolean, p_value_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);

  -- Photo requirements are answered via record_photo_evidence, never here.
  if v_type = 'photo' then
    raise exception 'not found';
  end if;

  -- Anon-facing write: cap text length before it reaches the table (matches
  -- the Zod cap on the authenticated staff path). Uniform 'not found' per
  -- the 404 discipline used throughout this migration — an oversized
  -- payload gets no more diagnostic detail than a bad token or a
  -- stale scope. char_length(null) is null, so this is a no-op for the
  -- non-text requirement types.
  if char_length(p_value_text) > 2000 then
    raise exception 'not found';
  end if;

  -- Type-aware validation for 'choice'. The one-value CHECK (0011) proves a
  -- choice answer is a non-empty string; it cannot know the option list, so
  -- without this an anon caller could store arbitrary prose in a dropdown
  -- field. Mirrors the client-side Zod contract: max 120 chars, and the value
  -- must be one of config->'options'. A null p_value_text fails the
  -- membership test (null ? null is null → no row), so this fails closed.
  if v_type = 'choice' then
    if char_length(p_value_text) > 120 then
      raise exception 'not found';
    end if;
    perform 1
      from public.program_stage_requirements r
     where r.id = p_requirement_id
       and (r.config -> 'options') ? p_value_text;
    if not found then
      raise exception 'not found';
    end if;
  end if;

  insert into public.unit_stage_responses
    (unit_stage_id, program_stage_requirement_id,
     value_text, value_number, value_bool, value_date, answered_by_participant_id)
  values
    (v_unit_stage_id, p_requirement_id,
     p_value_text, p_value_number, p_value_bool, p_value_date, v_participant_id)
  on conflict (unit_stage_id, program_stage_requirement_id) do update
    set value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_bool = excluded.value_bool,
        value_date = excluded.value_date,
        answered_by_participant_id = excluded.answered_by_participant_id;
  -- The prepare trigger derives type/denorms (unit_id/program_id/org_id/
  -- type) from the parent rows; it does not validate the value columns.
  -- unit_stage_responses_one_value_check (0011, relaxed above) is what
  -- actually enforces a single, correctly-typed, non-empty value — a null,
  -- wrong-type, or empty-string submission dies at that CHECK, not here.
  -- The derive trigger then recomputes the stage. All three fire unchanged.
end;
$$;

revoke all on function public.submit_participant_response(text, uuid, uuid, text, numeric, boolean, date) from public, anon, authenticated, service_role;
grant execute on function public.submit_participant_response(text, uuid, uuid, text, numeric, boolean, date) to anon;

create or replace function public.clear_participant_response(
  p_token text, p_unit_id uuid, p_requirement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_stage_id uuid;
  v_participant_id uuid;
  v_type text;
begin
  select o_unit_stage_id, o_participant_id, o_type
    into v_unit_stage_id, v_participant_id, v_type
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  -- Photo responses anchor evidence rows; they die only via
  -- delete_photo_evidence (last photo out), never via clear.
  if v_type = 'photo' then
    raise exception 'not found';
  end if;
  delete from public.unit_stage_responses
   where unit_stage_id = v_unit_stage_id
     and program_stage_requirement_id = p_requirement_id;
end;
$$;

revoke all on function public.clear_participant_response(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_participant_response(text, uuid, uuid) to anon;
```

- [ ] **Step 5: Apply and verify clean-room**

Run: `npm run db:reset` (requires the local stack: `npm run setup` first if not running)
Expected: reset + all migrations through 0015 apply without error, seed succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/evidence.ts src/db/schema/index.ts src/db/migrations/
git commit -m "feat: evidence table, bucket, photo RPCs + derivation (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Integration tests for the SQL surface

**Files:**
- Create: `src/features/participants/evidence.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's RPCs and table, plus the existing fixtures pattern from `src/features/participants/tokens.integration.test.ts` (signedInUser, mint, create_org/create_program RPCs).
- Produces: nothing (test-only).

- [ ] **Step 1: Write the test file**

Model on `tokens.integration.test.ts` (same env loading, `signedInUser`, `mint` helpers — copy them; the files are independent). Full file:

```ts
/**
 * Photo evidence SQL surface (slice 8): record/delete_photo_evidence,
 * path-prefix + metadata caps, photo-aware derivation, photo guards on the
 * slice-7 RPCs, relaxed one-value CHECK, RLS/grants.
 * Requires the local Supabase stack (npm run setup).
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

async function signedInUser(tag: string): Promise<SupabaseClient> {
  const email = `rls_${tag}_${Date.now()}@example.com`;
  const password = "Password123!";
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return client;
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

function mint(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

const CHECKSUM = "ab".repeat(32); // 64 hex chars

describe("photo evidence: record, delete, derivation, guards", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let programId: string;
  let stageId: string;
  let photoReqId: string; // required photo
  let boolReqId: string; // required boolean
  let textReqId: string; // OPTIONAL text (guard/reject fixture)
  let unit1: string; // assigned to P1
  let unit2: string; // assigned to P2
  let unit3: string; // assigned to NOBODY
  let p1: string;
  let p2: string;
  let t1: { token: string; tokenHash: string }; // program-scoped, P1
  let t2: { token: string; tokenHash: string }; // unit2-scoped, P2
  let evidenceA: string; // first photo id on unit1
  let pathA: string;
  let pathB: string;

  const record = (
    token: string,
    unitId: string,
    reqId: string,
    path: string,
    overrides: Record<string, unknown> = {},
  ) =>
    anon.rpc("record_photo_evidence", {
      p_token: token,
      p_unit_id: unitId,
      p_requirement_id: reqId,
      p_path: path,
      p_filename: "site.jpg",
      p_mime: "image/jpeg",
      p_size_bytes: 12345,
      p_checksum_sha256: CHECKSUM,
      ...overrides,
    });
  const del = (token: string, evidenceId: string) =>
    anon.rpc("delete_photo_evidence", { p_token: token, p_evidence_id: evidenceId });
  const submit = (token: string, unitId: string, reqId: string, cols: Record<string, unknown>) =>
    anon.rpc("submit_participant_response", {
      p_token: token,
      p_unit_id: unitId,
      p_requirement_id: reqId,
      p_value_text: null,
      p_value_number: null,
      p_value_bool: null,
      p_value_date: null,
      ...cols,
    });
  const stage = async () =>
    (
      await alice
        .from("unit_stages")
        .select("status, done_source")
        .eq("unit_id", unit1)
        .eq("program_stage_id", stageId)
        .single()
    ).data!;

  beforeAll(async () => {
    alice = await signedInUser("ev_alice");
    bob = await signedInUser("ev_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "EvAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "EvBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: orgId, name: "Ev Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    await alice.from("template_stage_requirements").insert([
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "photo",
        label: "Site photo",
        required: true,
        config: {},
        position: 0,
      },
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "boolean",
        label: "Safe",
        required: true,
        config: {},
        position: 1,
      },
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "text",
        label: "Notes",
        required: false,
        config: {},
        position: 2,
      },
      // Optional photo: must never block derivation (spec test list).
      {
        template_stage_id: s!.id,
        org_id: orgId,
        type: "photo",
        label: "Extra photo",
        required: false,
        config: {},
        position: 3,
      },
    ]);
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id,
      p_name: "Ev Program",
    });
    if (e3) throw e3;
    programId = (program as { id: string }).id;
    const { data: pStages } = await alice
      .from("program_stages")
      .select("id")
      .eq("program_id", programId);
    stageId = pStages![0].id;
    const { data: reqs } = await alice
      .from("program_stage_requirements")
      .select("id, label")
      .eq("program_id", programId);
    photoReqId = reqs!.find((r) => r.label === "Site photo")!.id;
    boolReqId = reqs!.find((r) => r.label === "Safe")!.id;
    textReqId = reqs!.find((r) => r.label === "Notes")!.id;

    const { data: parts } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "P One" },
        { org_id: orgId, name: "P Two" },
      ])
      .select("id, name");
    p1 = parts!.find((p) => p.name === "P One")!.id;
    p2 = parts!.find((p) => p.name === "P Two")!.id;

    const mkUnit = async (name: string, assigned: string | null) =>
      (
        await alice
          .from("units")
          .insert({ program_id: programId, org_id: orgId, name, assigned_participant_id: assigned })
          .select("id")
          .single()
      ).data!.id as string;
    unit1 = await mkUnit("Unit 1", p1);
    unit2 = await mkUnit("Unit 2", p2);
    unit3 = await mkUnit("Unit 3", null);

    t1 = mint();
    t2 = mint();
    const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { data: me } = await alice.auth.getUser();
    const { error: mintError } = await alice.from("access_tokens").insert([
      {
        org_id: orgId,
        token_hash: t1.tokenHash,
        kind: "participant",
        participant_id: p1,
        program_id: programId,
        expires_at: in30d,
        created_by: me!.user!.id,
      },
      {
        org_id: orgId,
        token_hash: t2.tokenHash,
        kind: "participant",
        participant_id: p2,
        program_id: programId,
        unit_id: unit2,
        expires_at: in30d,
        created_by: me!.user!.id,
      },
    ]);
    if (mintError) throw mintError;
    pathA = `${orgId}/${programId}/${unit1}/photo-a.jpg`;
    pathB = `${orgId}/${programId}/${unit1}/photo-b.jpg`;
  });

  it("records evidence with attribution and the all-null photo response", async () => {
    const { data, error } = await record(t1.token, unit1, photoReqId, pathA);
    expect(error).toBeNull();
    evidenceA = data as string;
    expect(evidenceA).toBeTruthy();

    const { data: ev } = await alice
      .from("evidence")
      .select(
        "path, filename, mime, size_bytes, checksum_sha256, response_id, uploaded_by_participant_id, uploaded_by_user_id, provider",
      )
      .eq("id", evidenceA)
      .single();
    expect(ev!.path).toBe(pathA);
    expect(ev!.checksum_sha256).toBe(CHECKSUM);
    expect(ev!.provider).toBe("supabase");
    expect(ev!.uploaded_by_participant_id).toBe(p1);
    expect(ev!.uploaded_by_user_id).toBeNull();
    expect(ev!.response_id).not.toBeNull();

    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("type, value_text, value_number, value_bool, value_date, answered_by_participant_id")
      .eq("id", ev!.response_id!)
      .single();
    expect(resp!.type).toBe("photo");
    expect(resp!.value_text).toBeNull();
    expect(resp!.value_number).toBeNull();
    expect(resp!.value_bool).toBeNull();
    expect(resp!.value_date).toBeNull();
    expect(resp!.answered_by_participant_id).toBe(p1);

    // Photo satisfied, but the required boolean isn't: still pending.
    expect((await stage()).status).toBe("pending");
  });

  it("a second photo reuses the response anchor", async () => {
    const { error } = await record(t1.token, unit1, photoReqId, pathB);
    expect(error).toBeNull();
    const { data: evs } = await alice
      .from("evidence")
      .select("id, response_id")
      .eq("unit_id", unit1);
    expect(evs).toHaveLength(2);
    expect(new Set(evs!.map((e) => e.response_id)).size).toBe(1);
    const { count } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(count).toBe(1);
  });

  it("rejects non-photo requirements, foreign paths, and bad metadata", async () => {
    const cases = [
      record(t1.token, unit1, boolReqId, pathA), // wrong type
      record(t1.token, unit1, textReqId, pathA), // wrong type (optional text)
      record(t1.token, unit1, photoReqId, `${orgId}/${programId}/${unit2}/x.jpg`), // foreign prefix
      record(t1.token, unit1, photoReqId, `evil/${unit1}/x.jpg`), // junk prefix
      record(t1.token, unit1, photoReqId, pathA, { p_mime: "application/pdf" }),
      record(t1.token, unit1, photoReqId, pathA, { p_size_bytes: 0 }),
      record(t1.token, unit1, photoReqId, pathA, { p_size_bytes: 15728641 }),
      record(t1.token, unit1, photoReqId, pathA, { p_checksum_sha256: "zz" }),
      record(t1.token, unit1, photoReqId, pathA, { p_filename: "x".repeat(201) }),
    ];
    for (const c of cases) {
      const { error } = await c;
      expect(error?.code).toBe("P0001");
    }
  });

  it("the core scope test: tokens cannot record or delete outside their scope", async () => {
    const { error: cross } = await record(
      t1.token,
      unit2,
      photoReqId,
      `${orgId}/${programId}/${unit2}/x.jpg`,
    );
    expect(cross?.code).toBe("P0001");
    const { error: cross2 } = await record(t2.token, unit1, photoReqId, pathA);
    expect(cross2?.code).toBe("P0001");
    const { error: unassigned } = await record(
      t1.token,
      unit3,
      photoReqId,
      `${orgId}/${programId}/${unit3}/x.jpg`,
    );
    expect(unassigned?.code).toBe("P0001");
    // Foreign delete: P2's token vs P1's evidence.
    const { error: crossDel } = await del(t2.token, evidenceA);
    expect(crossDel?.code).toBe("P0001");
  });

  it("submit and clear reject photo requirements (their own lifecycle)", async () => {
    const { error: eSubmit } = await submit(t1.token, unit1, photoReqId, {
      p_value_text: "not a photo",
    });
    expect(eSubmit?.code).toBe("P0001");
    const { error: eClear } = await anon.rpc("clear_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: photoReqId,
    });
    expect(eClear?.code).toBe("P0001");
  });

  it("photo counts in derivation; done locks record and delete", async () => {
    const { error } = await submit(t1.token, unit1, boolReqId, { p_value_bool: true });
    expect(error).toBeNull();
    // "Extra photo" (optional, zero uploads) must not block: done proves it.
    const s = await stage();
    expect(s.status).toBe("done");
    expect(s.done_source).toBe("requirements");

    const { error: locked } = await record(
      t1.token,
      unit1,
      photoReqId,
      `${orgId}/${programId}/${unit1}/late.jpg`,
    );
    expect(locked?.code).toBe("P0001");
    const { error: lockedDel } = await del(t1.token, evidenceA);
    expect(lockedDel?.code).toBe("P0001");
  });

  it("deleting the last photo removes the anchor and reopens the stage", async () => {
    // Reopen first (clear the boolean via its own lifecycle).
    const { error: eClear } = await anon.rpc("clear_participant_response", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: boolReqId,
    });
    expect(eClear).toBeNull();
    expect((await stage()).status).toBe("pending");

    const { data: evs } = await alice
      .from("evidence")
      .select("id, path")
      .eq("unit_id", unit1)
      .order("created_at", { ascending: true });
    const [first, second] = evs!;

    // Non-last delete: anchor survives, returns the path.
    const { data: returnedPath, error: e1 } = await del(t1.token, second.id);
    expect(e1).toBeNull();
    expect(returnedPath).toBe(second.path);
    const { count: respCount } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(respCount).toBe(1);

    // Last delete: anchor goes too.
    const { error: e2 } = await del(t1.token, first.id);
    expect(e2).toBeNull();
    const { count: respCount2 } = await alice
      .from("unit_stage_responses")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1)
      .eq("program_stage_requirement_id", photoReqId);
    expect(respCount2).toBe(0);
    const { count: evCount } = await alice
      .from("evidence")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unit1);
    expect(evCount).toBe(0);
  });

  it("scalar all-null is still rejected by the one-value CHECK", async () => {
    const { data: us } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", unit1)
      .eq("program_stage_id", stageId)
      .single();
    // Only the id pair — prepare fills type='text'; the CHECK must refuse.
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: us!.id,
      program_stage_requirement_id: textReqId,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514"); // check_violation
  });

  it("RLS and grants: evidence is read-only for members, invisible cross-org, dead to anon", async () => {
    // Re-create one row so there is something to (not) see.
    const { error: eRec } = await record(t1.token, unit1, photoReqId, pathA);
    expect(eRec).toBeNull();

    const { data: mine } = await alice.from("evidence").select("id");
    expect(mine!.length).toBeGreaterThan(0);

    const { data: theirs, error: eBob } = await bob.from("evidence").select("id");
    expect(eBob).toBeNull();
    expect(theirs).toHaveLength(0); // RLS, not an error

    const { error: eAnon } = await anon.from("evidence").select("id");
    expect(eAnon).not.toBeNull();
    expect(eAnon!.code).toBe("42501"); // no grant at all

    const { error: eInsert } = await alice.from("evidence").insert({
      org_id: orgId,
      unit_id: unit1,
      unit_stage_id: (
        await alice
          .from("unit_stages")
          .select("id")
          .eq("unit_id", unit1)
          .eq("program_stage_id", stageId)
          .single()
      ).data!.id,
      path: `${orgId}/${programId}/${unit1}/forged.jpg`,
      filename: "forged.jpg",
      mime: "image/jpeg",
      size_bytes: 1,
      checksum_sha256: CHECKSUM,
    });
    expect(eInsert?.code).toBe("42501"); // members hold no insert grant

    const { error: eDelete } = await alice.from("evidence").delete().eq("unit_id", unit1);
    expect(eDelete?.code).toBe("42501"); // ...and no delete grant either

    const { error: eAuthRpc } = await alice.rpc("record_photo_evidence", {
      p_token: t1.token,
      p_unit_id: unit1,
      p_requirement_id: photoReqId,
      p_path: pathA,
      p_filename: "site.jpg",
      p_mime: "image/jpeg",
      p_size_bytes: 1,
      p_checksum_sha256: CHECKSUM,
    });
    expect(eAuthRpc?.code).toBe("42501"); // anon-only EXECUTE

    const { error: eAuthDel } = await alice.rpc("delete_photo_evidence", {
      p_token: t1.token,
      p_evidence_id: evidenceA,
    });
    expect(eAuthDel?.code).toBe("42501");
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:integration -- evidence.integration`
Expected: all tests PASS. If a P0001 assertion sees a different code, read the actual error — it usually means a grant or guard landed wrong in 0015; fix the migration, `npm run db:reset`, re-run.

- [ ] **Step 3: Run the whole integration suite (no regressions in slice 6/7 tests)**

Run: `npm run test:integration`
Expected: PASS — especially `tokens.integration.test.ts` (the recreated submit/clear functions must behave identically for scalar types).

- [ ] **Step 4: Commit**

```bash
git add src/features/participants/evidence.integration.test.ts
git commit -m "test: photo evidence SQL surface (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Storage helpers + body-size config

**Files:**
- Create: `src/lib/storage/photo.ts` (pure, client-safe)
- Create: `src/lib/storage/photo.test.ts`
- Create: `src/lib/storage/evidence.ts` (server-only)
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `createAdminClient()` from `@/lib/supabase/admin`.
- Produces (photo.ts): `PHOTO_MIME_EXTENSIONS: Record<string,string>`, `PHOTO_MAX_BYTES: number`, `isAllowedPhotoType(mime: string): boolean`, `evidencePathFor(orgId: string, programId: string, unitId: string, objectId: string, mime: string): string | null`.
- Produces (evidence.ts): `EVIDENCE_BUCKET = "evidence"`, `uploadEvidenceObject(path: string, bytes: ArrayBuffer, contentType: string): Promise<boolean>`, `deleteEvidenceObject(path: string): Promise<void>`, `signEvidencePaths(paths: string[]): Promise<Map<string, string>>`.

- [ ] **Step 1: Write the failing unit tests**

`src/lib/storage/photo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PHOTO_MAX_BYTES,
  isAllowedPhotoType,
  evidencePathFor,
} from "./photo";

describe("photo helpers", () => {
  it("accepts the allowlist, rejects everything else", () => {
    for (const m of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) {
      expect(isAllowedPhotoType(m)).toBe(true);
    }
    expect(isAllowedPhotoType("application/pdf")).toBe(false);
    expect(isAllowedPhotoType("image/svg+xml")).toBe(false); // scriptable — never
    expect(isAllowedPhotoType("")).toBe(false);
  });

  it("caps at exactly 15MB", () => {
    expect(PHOTO_MAX_BYTES).toBe(15728640);
  });

  it("builds org/program/unit-prefixed paths with the mime's extension", () => {
    expect(evidencePathFor("org", "prog", "unit", "obj", "image/jpeg")).toBe(
      "org/prog/unit/obj.jpg",
    );
    expect(evidencePathFor("org", "prog", "unit", "obj", "image/heic")).toBe(
      "org/prog/unit/obj.heic",
    );
    expect(evidencePathFor("org", "prog", "unit", "obj", "text/html")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- photo`
Expected: FAIL — module `./photo` not found.

- [ ] **Step 3: Implement photo.ts**

```ts
// Pure photo-upload constants and helpers — safe to import from client
// components (the participant flow pre-checks files before any bytes move).
// SVG is deliberately absent: scriptable images never enter the bucket.
export const PHOTO_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export const PHOTO_MAX_BYTES = 15 * 1024 * 1024; // mirrors the bucket + RPC caps

export function isAllowedPhotoType(mime: string): boolean {
  return Object.hasOwn(PHOTO_MIME_EXTENSIONS, mime);
}

export function evidencePathFor(
  orgId: string,
  programId: string,
  unitId: string,
  objectId: string,
  mime: string,
): string | null {
  const ext = PHOTO_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${orgId}/${programId}/${unitId}/${objectId}.${ext}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- photo`
Expected: PASS.

- [ ] **Step 5: Implement the server-only storage module**

`src/lib/storage/evidence.ts`:

```ts
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Object I/O for the private `evidence` bucket (ZERO storage policies — the
// service-role client is the only way in). This module signs and moves
// bytes; it NEVER authorizes: callers pass paths that already came out of
// an RLS-scoped select or a token-scoped read (the admin.ts contract).
export const EVIDENCE_BUCKET = "evidence";
const SIGNED_URL_TTL_SECONDS = 600;

export async function uploadEvidenceObject(
  path: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) {
    console.error("[storage] upload failed:", error.message);
    return false;
  }
  return true;
}

// Best-effort: a failed object delete leaves an orphan (accepted v1 wart —
// the metadata row, already gone by now, is the record). Never throws.
export async function deleteEvidenceObject(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(EVIDENCE_BUCKET).remove([path]);
  if (error) console.error("[storage] orphaned object, delete failed:", error.message);
}

export async function signEvidencePaths(paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    // Degrade to filename tiles rather than failing the page.
    console.error("[storage] sign failed:", error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  }
  return map;
}
```

- [ ] **Step 6: Raise the server-action body limit**

In `next.config.ts`, add to the config object (verified against `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` — the option lives under `experimental` in 16.3.0):

```ts
const nextConfig: NextConfig = {
  experimental: {
    // Photo uploads relay through a server action; 15MB cap + multipart
    // overhead (the docs' 10–20KB rule of thumb) needs headroom over the
    // 1MB default.
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    // ... (existing headers unchanged)
```

- [ ] **Step 7: Verify + commit**

Run: `npm run verify`
Expected: lint, typecheck, unit tests PASS.

```bash
git add src/lib/storage/ next.config.ts
git commit -m "feat: evidence storage helpers + 16mb action body limit (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Upload/remove server actions

**Files:**
- Modify: `src/features/participants/schema.ts`
- Modify: `src/features/participants/schema.test.ts` (add cases; file exists)
- Modify: `src/features/participants/flow-actions.ts`

**Interfaces:**
- Consumes: `resolveParticipantToken(token, clientKey)` + `clientKeyFrom(headers)` from `@/lib/tokens`; `evidencePathFor`, `isAllowedPhotoType`, `PHOTO_MAX_BYTES` from `@/lib/storage/photo`; `uploadEvidenceObject`, `deleteEvidenceObject` from `@/lib/storage/evidence`; RPCs from Task 1.
- Produces: `uploadPhoto(formData: FormData): Promise<ActionState>` and `removePhoto(input: unknown): Promise<ActionState>` — Task 6's components call exactly these.

- [ ] **Step 1: Write the failing Zod tests**

Append to `src/features/participants/schema.test.ts` (match the file's existing describe/it style):

```ts
import { uploadPhotoInput, removePhotoInput } from "./schema"; // add to existing imports

describe("uploadPhotoInput / removePhotoInput", () => {
  const ids = {
    token: "x".repeat(40),
    unitId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
  };
  it("accepts well-formed upload metadata", () => {
    expect(
      uploadPhotoInput.safeParse({
        ...ids,
        requirementId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
      }).success,
    ).toBe(true);
  });
  it("rejects short tokens and non-uuid ids", () => {
    expect(
      uploadPhotoInput.safeParse({ ...ids, token: "short", requirementId: ids.unitId }).success,
    ).toBe(false);
    expect(
      uploadPhotoInput.safeParse({ ...ids, requirementId: "nope" }).success,
    ).toBe(false);
  });
  it("removePhotoInput requires token, unitId, evidenceId", () => {
    expect(
      removePhotoInput.safeParse({ ...ids, evidenceId: ids.unitId }).success,
    ).toBe(true);
    expect(removePhotoInput.safeParse({ ...ids }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- participants/schema`
Expected: FAIL — `uploadPhotoInput` not exported.

- [ ] **Step 3: Add the inputs**

Append to `src/features/participants/schema.ts` (after `participantClearResponseInput`; it reuses the existing `flowIds`):

```ts
// Photo evidence (slice 8). The file itself arrives as FormData and is
// validated imperatively in the action (size/mime caps from lib/storage/
// photo) — Zod sees only the ids.
export const uploadPhotoInput = z.object(flowIds);
export const removePhotoInput = z.object({
  token: flowIds.token,
  unitId: z.uuid(), // for revalidation of the unit page
  evidenceId: z.uuid(),
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- participants/schema`
Expected: PASS.

- [ ] **Step 5: Add the actions**

Append to `src/features/participants/flow-actions.ts`. New imports at the top of the file:

```ts
import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { resolveParticipantToken, clientKeyFrom } from "@/lib/tokens";
import { evidencePathFor, isAllowedPhotoType, PHOTO_MAX_BYTES } from "@/lib/storage/photo";
import { uploadEvidenceObject, deleteEvidenceObject } from "@/lib/storage/evidence";
import { uploadPhotoInput, removePhotoInput } from "./schema";
```

Then the two actions:

```ts
// Server-relay upload: resolve the token FIRST (the path prefix comes from
// the resolved scope), hash the exact bytes we store, upload, then let the
// RPC re-check scope and record the row. Object-before-row ordering means a
// failed RPC leaves at worst an invisible orphan object (compensated
// below) — never a row pointing at nothing.
export async function uploadPhoto(formData: FormData): Promise<ActionState> {
  const parsed = uploadPhotoInput.safeParse({
    token: formData.get("token"),
    unitId: formData.get("unitId"),
    requirementId: formData.get("requirementId"),
  });
  const file = formData.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (file.size === 0 || file.size > PHOTO_MAX_BYTES || !isAllowedPhotoType(file.type)) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  const d = parsed.data;

  const resolved = await resolveParticipantToken(d.token, clientKeyFrom(await headers()));
  if (resolved.status !== "ok") return { ok: false, error: GENERIC_WRITE_ERROR };
  const scope = resolved.scope;

  const bytes = await file.arrayBuffer();
  const checksum = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const path = evidencePathFor(scope.orgId, scope.programId, d.unitId, randomUUID(), file.type);
  if (!path) return { ok: false, error: GENERIC_WRITE_ERROR };

  if (!(await uploadEvidenceObject(path, bytes, file.type))) {
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }

  const anon = createAnonServerClient();
  const { error } = await anon.rpc("record_photo_evidence", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
    p_path: path,
    p_filename: file.name.slice(0, 200) || "photo",
    p_mime: file.type,
    p_size_bytes: file.size,
    p_checksum_sha256: checksum,
  });
  if (error) {
    console.error("[participants] uploadPhoto:", error.code ?? "rpc error");
    await deleteEvidenceObject(path); // compensate the orphan
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

// Row first (the RPC is the authority and returns the path), object second;
// a failed object delete is a logged, accepted orphan.
export async function removePhoto(input: unknown): Promise<ActionState> {
  const parsed = removePhotoInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("delete_photo_evidence", {
    p_token: d.token,
    p_evidence_id: d.evidenceId,
  });
  if (error) {
    console.error("[participants] removePhoto:", error.code ?? "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  if (typeof data === "string" && data.length > 0) await deleteEvidenceObject(data);
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}
```

- [ ] **Step 6: Verify + commit**

Run: `npm run verify`
Expected: PASS (the actions compile; their SQL floor is already integration-tested).

```bash
git add src/features/participants/schema.ts src/features/participants/schema.test.ts src/features/participants/flow-actions.ts
git commit -m "feat: participant photo upload/remove actions (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Photos in the read models

**Files:**
- Modify: `src/features/programs/queries.ts` (types + `getUnit`)
- Modify: `src/lib/tokens/index.ts` (`getParticipantUnitDetail`)

**Interfaces:**
- Consumes: `signEvidencePaths` from `@/lib/storage/evidence`.
- Produces: `export type EvidencePhoto = { id: string; filename: string; sizeBytes: number; createdAt: string; uploadedBy: string | null; url: string | null }` in `programs/queries.ts`; `SectionRequirement` gains `photos: EvidencePhoto[]` (empty for scalar types). Task 6 renders exactly these fields.

- [ ] **Step 1: Extend the types**

In `src/features/programs/queries.ts`, above `SectionRequirement`:

```ts
export type EvidencePhoto = {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string | null; // participant name, when known
  url: string | null; // short-lived signed URL; null → filename tile
};
```

and add to `SectionRequirement`:

```ts
  // Photo requirements only; [] for scalar types.
  photos: EvidencePhoto[];
```

- [ ] **Step 2: Fill photos in `getUnit`**

Add the import: `import { signEvidencePaths } from "@/lib/storage/evidence";`

In the `Promise.all`, change the responses select to include the row id (the evidence→requirement mapping runs through it):

```ts
      supabase
        .from("unit_stage_responses")
        .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId),
```

and append a fourth query to the same `Promise.all` (destructure as `{ data: ev, error: e4 }`, extend the error check to `if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;`):

```ts
      supabase
        .from("evidence")
        .select("id, response_id, path, filename, size_bytes, created_at, participants(name)")
        .eq("unit_id", unitId),
```

After `responseByReq`, build the photo map (RLS proved org scope; signing is display-only):

```ts
  const respIdToReq = new Map((resps ?? []).map((r) => [r.id, r.program_stage_requirement_id]));
  const photoRows = [...(ev ?? [])].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
  const signed = await signEvidencePaths(photoRows.map((e) => e.path));
  const photosByReq = new Map<string, EvidencePhoto[]>();
  for (const e of photoRows) {
    const reqId = e.response_id ? respIdToReq.get(e.response_id) : undefined;
    if (!reqId) continue; // detached evidence: kept in the table, not shown per-requirement
    const list = photosByReq.get(reqId) ?? [];
    list.push({
      id: e.id,
      filename: e.filename,
      sizeBytes: e.size_bytes,
      createdAt: e.created_at,
      uploadedBy: (e.participants as unknown as { name: string } | null)?.name ?? null,
      url: signed.get(e.path) ?? null,
    });
    photosByReq.set(reqId, list);
  }
```

and in the requirement mapping add:

```ts
              photos: photosByReq.get(r.id) ?? [],
```

- [ ] **Step 3: Same treatment in `getParticipantUnitDetail`**

In `src/lib/tokens/index.ts`: add `import { signEvidencePaths } from "@/lib/storage/evidence";` and `EvidencePhoto` to the type import from `@/features/programs/queries`.

Change the responses select to include `id`:

```ts
      db
        .from("unit_stage_responses")
        .select("id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId)
        .eq("org_id", scope.orgId),
```

Append the evidence query to the same `Promise.all` (service-role read → carries its own org filter, per the comment already in this function):

```ts
      db
        .from("evidence")
        .select("id, response_id, path, filename, size_bytes, created_at, participants(name)")
        .eq("unit_id", unitId)
        .eq("org_id", scope.orgId),
```

Destructure as `{ data: ev, error: e4 }`, extend the throw, then insert the same `respIdToReq` / `photoRows` / `signed` / `photosByReq` block as Step 2 (verbatim — same variable names), and add `photos: photosByReq.get(r.id) ?? []` to the requirement mapping.

- [ ] **Step 4: Typecheck + commit**

Run: `npm run verify`
Expected: PASS. The compiler will flag any `SectionRequirement` construction site missing `photos` — fix by adding `photos: []` ONLY if a third site exists that genuinely has no evidence (there should be none; both constructors were updated above).

```bash
git add src/features/programs/queries.ts src/lib/tokens/index.ts
git commit -m "feat: photos in unit read models with signed URLs (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: UI — photo renderer, flow wiring, console display, editor type

**Files:**
- Modify: `src/features/programs/components/requirement-field.tsx`
- Modify: `src/features/programs/components/unit-stage-sections.tsx`
- Modify: `src/features/participants/components/participant-stage-sections.tsx`
- Modify: `src/features/templates/schema.ts`
- Modify: `src/features/templates/components/add-requirement.tsx`

**Interfaces:**
- Consumes: `SectionRequirement.photos` (Task 5), `uploadPhoto`/`removePhoto` (Task 4), `isAllowedPhotoType`/`PHOTO_MAX_BYTES` (Task 3).
- Produces: `RequirementField` gains optional props `onUploadPhoto?: (file: File) => void` and `onRemovePhoto?: (evidenceId: string) => void` — omitted = display-only (console).

- [ ] **Step 1: The shared photo renderer**

In `requirement-field.tsx`: add `Plus` to the lucide import; extend the props:

```ts
export function RequirementField({
  requirement,
  onSave,
  onClear,
  onUploadPhoto,
  onRemovePhoto,
}: {
  requirement: SectionRequirement;
  onSave: (value: string | number | boolean) => void;
  onClear: () => void;
  // Photo controls: pass both from the participant flow while the stage is
  // pending; omit both for the read-only console display.
  onUploadPhoto?: (file: File) => void;
  onRemovePhoto?: (evidenceId: string) => void;
}) {
```

Replace the `r.type === "photo" ? (...)` branch (currently the "later release" span) with:

```tsx
      ) : r.type === "photo" ? (
        <div className="flex flex-wrap items-center gap-2">
          {r.photos.map((p) => {
            const meta = [
              p.filename,
              `${Math.max(1, Math.round(p.sizeBytes / 1024))} KB`,
              p.uploadedBy ?? undefined,
              p.createdAt ? new Date(p.createdAt).toLocaleString() : undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <span key={p.id} className="relative inline-flex">
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer" title={meta}>
                    {/* Short-lived signed URLs: next/image's optimizer and
                        remotePatterns add nothing for a private bucket. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.filename}
                      className="h-16 w-16 rounded-md border object-cover"
                    />
                  </a>
                ) : (
                  <span
                    title={meta}
                    className="bg-muted text-muted-foreground inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border p-1 text-center text-[10px] break-all"
                  >
                    {p.filename}
                  </span>
                )}
                {onRemovePhoto ? (
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute -top-2 -right-2 size-5 rounded-full"
                    aria-label={`Remove ${p.filename}`}
                    onClick={() => onRemovePhoto(p.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                ) : null}
              </span>
            );
          })}
          {onUploadPhoto ? (
            <label className="border-input text-muted-foreground hover:bg-accent inline-flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[10px]">
              <Plus className="size-4" />
              Add photo
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUploadPhoto(f);
                  e.target.value = ""; // same file can be re-picked after a failure
                }}
              />
            </label>
          ) : r.photos.length === 0 ? (
            <span className="text-muted-foreground text-xs">Awaiting photo</span>
          ) : null}
        </div>
      ) : (
```

The trailing clear button's condition `r.value !== null && r.type !== "photo"` already excludes photos — leave it.

- [ ] **Step 2: Console sections — photo joins the chip math (display-only)**

In `unit-stage-sections.tsx`, three mechanical changes:

(a) `derive()` — photos count now:

```ts
function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required);
  if (required.length === 0) return section; // manual stage — leave as-is
  const satisfied = required.every((r) =>
    r.type === "photo"
      ? r.photos.length > 0
      : r.type === "boolean"
        ? r.value === true
        : r.value !== null && r.value !== "",
  );
  return satisfied
    ? { ...section, status: "done", doneSource: "requirements" }
    : { ...section, status: "pending", doneSource: null };
}
```

(b) the chip counters in the render (drop the photo exclusion, same satisfied test):

```ts
        const required = s.requirements.filter((r) => r.required);
        const satisfied = required.filter((r) =>
          r.type === "photo"
            ? r.photos.length > 0
            : r.type === "boolean"
              ? r.value === true
              : r.value !== null && r.value !== "",
        ).length;
```

(c) the `RequirementField` key gains the photo count so evidence changes remount:

```tsx
                    key={`${r.id}:${String(r.value)}:${r.photos.length}`}
```

No `onUploadPhoto`/`onRemovePhoto` props are passed here — console stays display-only.

- [ ] **Step 3: Participant sections — wiring + optimistic events**

In `participant-stage-sections.tsx`:

(a) imports:

```ts
import { submitResponse, clearResponse, uploadPhoto, removePhoto } from "@/features/participants/flow-actions";
import { isAllowedPhotoType, PHOTO_MAX_BYTES } from "@/lib/storage/photo";
```

(b) events + reducer (full replacement of `SectionEvent`, `derive`, `applyEvent`):

```ts
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string }
  | { type: "addPhoto"; unitStageId: string; requirementId: string; filename: string }
  | { type: "removePhoto"; unitStageId: string; requirementId: string; evidenceId: string };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required);
  if (required.length === 0) return section;
  const satisfied = required.every((r) =>
    r.type === "photo"
      ? r.photos.length > 0
      : r.type === "boolean"
        ? r.value === true
        : r.value !== null && r.value !== "",
  );
  return satisfied
    ? { ...section, status: "done", doneSource: "requirements" }
    : { ...section, status: "pending", doneSource: null };
}

function applyEvent(sections: StageSection[], event: SectionEvent): StageSection[] {
  return sections.map((s) => {
    if (s.unitStageId !== event.unitStageId) return s;
    switch (event.type) {
      case "setValue":
      case "clear": {
        const value = event.type === "setValue" ? event.value : null;
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId ? { ...r, value } : r,
          ),
        });
      }
      case "addPhoto":
        // Placeholder tile (no URL yet); revalidation replaces it with truth.
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId
              ? {
                  ...r,
                  photos: [
                    ...r.photos,
                    {
                      id: `optimistic-${r.photos.length}`,
                      filename: event.filename,
                      sizeBytes: 0,
                      createdAt: "",
                      uploadedBy: null,
                      url: null,
                    },
                  ],
                }
              : r,
          ),
        });
      case "removePhoto":
        return derive({
          ...s,
          requirements: s.requirements.map((r) =>
            r.id === event.requirementId
              ? { ...r, photos: r.photos.filter((p) => p.id !== event.evidenceId) }
              : r,
          ),
        });
    }
  });
}
```

(c) the chip counters in the render, same change as the console twin:

```ts
        const required = s.requirements.filter((r) => r.required);
        const satisfied = required.filter((r) =>
          r.type === "photo"
            ? r.photos.length > 0
            : r.type === "boolean"
              ? r.value === true
              : r.value !== null && r.value !== "",
        ).length;
```

(d) the `RequirementField` call site — new key + the two photo callbacks:

```tsx
                  <RequirementField
                    key={`${r.id}:${String(r.value)}:${r.photos.length}`}
                    requirement={r}
                    onSave={(value) =>
                      run(
                        { type: "setValue", unitStageId: s.unitStageId, requirementId: r.id, value },
                        () =>
                          submitResponse({
                            token,
                            unitId,
                            requirementId: r.id,
                            type: r.type as Exclude<SectionRequirement["type"], "photo">,
                            value,
                          }),
                      )
                    }
                    onClear={() =>
                      run({ type: "clear", unitStageId: s.unitStageId, requirementId: r.id }, () =>
                        clearResponse({ token, unitId, requirementId: r.id }),
                      )
                    }
                    onUploadPhoto={(file) => {
                      // Pre-check before any bytes move; the server and the
                      // bucket both re-check.
                      if (!isAllowedPhotoType(file.type) || file.size > PHOTO_MAX_BYTES) {
                        toast.error("Photos must be JPEG, PNG, WebP, or HEIC and under 15MB.");
                        return;
                      }
                      const fd = new FormData();
                      fd.set("token", token);
                      fd.set("unitId", unitId);
                      fd.set("requirementId", r.id);
                      fd.set("file", file);
                      run(
                        { type: "addPhoto", unitStageId: s.unitStageId, requirementId: r.id, filename: file.name },
                        () => uploadPhoto(fd),
                      );
                    }}
                    onRemovePhoto={(evidenceId) =>
                      run(
                        { type: "removePhoto", unitStageId: s.unitStageId, requirementId: r.id, evidenceId },
                        () => removePhoto({ token, unitId, evidenceId }),
                      )
                    }
                  />
```

(`onSave`/`onClear` bodies stay exactly as they are today.) Done stages still collapse to the summary line before any fields render, so photo controls disappear once the stage derives done — the pending-only rule the RPCs also enforce.

- [ ] **Step 4: The editor learns photo**

`src/features/templates/schema.ts` — extend the enum and rewrite the comment:

```ts
// Requirement editing. `photo` is satisfied via evidence uploads (slice 8);
// `checklist` exists only template-side (create_program expands it).
export const requirementType = z.enum([
  "text", "number", "boolean", "date", "choice", "photo", "checklist",
]);
```

`add-requirement.tsx` — one line:

```ts
const TYPES = ["text", "number", "boolean", "date", "choice", "photo", "checklist"] as const;
```

(`photo` needs no options/items; the existing `needsLines` logic already ignores it, and the `superRefine` rejects stray config.)

- [ ] **Step 5: Verify + commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/programs/components/ src/features/participants/components/ src/features/templates/
git commit -m "feat: photo upload flow UI, console display, editor type (slice 8)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification, manual demo, PR

**Files:** none new (fixes only if verification finds problems).

- [ ] **Step 1: Full suites**

Run: `npm run verify && npm run test:integration`
Expected: everything PASS.

- [ ] **Step 2: Manual demo walk (the spec's manual test)**

Run: `npm run dev`, then in a browser:
1. `/templates` → open a template → add a **photo** requirement ("Site photo", required) to a stage.
2. Create a program from it, add a unit, create a participant, assign, issue a link (Links panel).
3. Open the link (ideally with devtools mobile emulation) → the unit → **Add photo** → pick an image. Expect: thumbnail appears, stage chip counts it; when it's the last required requirement, the stage flips done and collapses.
4. Remove the photo while pending (the × control) → stage reopens.
5. Console unit page: thumbnails display with tooltip metadata (filename · KB · uploader · time); click opens the full-size image; a photo requirement with no uploads reads "Awaiting photo"; no upload control exists.
6. Confirm in Supabase Studio (`npm run supabase:status` for the URL): `evidence` row has checksum + `uploaded_by_participant_id`; the object lives under `org/program/unit/` in the `evidence` bucket.

- [ ] **Step 3: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/photo-evidence
gh pr create --title "feat: photo evidence — slice 8 (evidence, storage upload, console display)" --body "$(cat <<'EOF'
## Summary
- `evidence` table (metadata-only; checksum + attribution) + private `evidence` bucket (zero storage policies; 15MB/image-mime caps at the floor)
- Anon-callable definer RPCs `record_photo_evidence` / `delete_photo_evidence` — token-keyed, path-prefix-pinned to the resolved org/program/unit
- `unit_stage_responses` CHECK relaxed: all-null is legal only for `type='photo'`; derivation now counts photo requirements (satisfied = response anchor + ≥1 evidence)
- Participant flow: server-relay upload (sha256 server-side, original bytes, EXIF preserved), remove-while-pending; console displays read-only with signed URLs
- Template editor gains the `photo` type

Spec: `docs/superpowers/specs/2026-08-10-photo-evidence-design.md`

## Test plan
- [ ] CI green (unit + integration)
- [ ] `evidence.integration.test.ts`: record/delete lifecycle, path-prefix + metadata caps, scope tests (unit A ↛ unit B over HTTP), photo guards on slice-7 RPCs, relaxed CHECK, RLS/grants
- [ ] Manual demo walk (phone flow → console) per plan Task 7

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes (spec → plan coverage)

- Evidence table incl. `provider`/`uploaded_by_user_id` day-one columns → Task 1. CHECK relaxation → Task 1/tested Task 2. Derivation + evidence trigger → Task 1/tested Task 2. RPCs + guards + path prefix → Task 1/tested Task 2. Bucket + caps → Task 1; caps re-checked client (Task 6), action (Task 4), RPC (Task 1). Upload action ordering + compensation → Task 4. Signed URL reads both surfaces → Tasks 3/5. Participant UI + delete-while-pending + done-collapse → Task 6. Console display-only + "Awaiting photo" + tooltip metadata → Task 6. Editor type → Task 6. `bodySizeLimit` (verified against local Next 16.3.0 docs) → Task 3. Storage-GC wart → documented in spec; `deleteEvidenceObject` logs orphans (Task 3). Matrix untouched — `unit_stages.status` remains the source (no change needed, by design).
