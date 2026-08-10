# Participants + /p/[token] (Slice 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** External participants open a hashed, scoped link on their phone and fill in outstanding requirements — no account — while staff assign units, issue, list, and revoke links from the program page.

**Architecture:** Two migrations — `0012` (drizzle-generated: `participants`, `access_tokens`, `units.assigned_participant_id`, `unit_stage_responses.answered_by_participant_id`) and `0013_participant_tokens` (hand-written: RLS/grants/CHECKs, the `access_tokens` org-guard trigger, the unit-assignment org-guard trigger, `resolve_participant_token` as the sole validity authority, anon-callable `submit_participant_response`/`clear_participant_response`, attribution symmetry in the slice-6 prepare trigger). TypeScript side: `lib/tokens` chokepoint (mint, rate limit, resolve-via-RPC, scoped reads through a new server-only admin client), console actions/UI in a new `features/participants` slice, and the `/p/[token]` mobile flow reusing the extracted requirement field.

**Tech Stack:** Drizzle / drizzle-kit, Supabase (PostgREST RPC as `anon`, pgcrypto `extensions.digest`), Next.js 16 App Router, node:crypto, Zod, Vitest unit + integration.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-10-participant-links-design.md`. Branch `feat/participant-links` (exists; spec committed at 31f5a27).
- **Spec amendment (correctness, approved in planning):** the write RPCs take **`p_unit_id`** — a program-scoped token spans several units, so a requirement id alone is ambiguous. Signatures below are authoritative.
- **The security boundary is 256-bit token entropy**, not rate limiting — the RPCs are reachable directly via PostgREST with the anon key. Never shorten tokens; never log them.
- Hashing must agree byte-for-byte between TS and SQL: TS `createHash("sha256").update(token, "utf8").digest("hex")` ≡ SQL `encode(extensions.digest(convert_to(p_token,'utf8'),'sha256'),'hex')` (pgcrypto is in the `extensions` schema; `search_path=''` requires the qualified name).
- **Every new-table migration ships explicit GRANTs** (0004 convention); RLS predicates use `org_id in (select public.user_orgs())`; index every FK + org_id.
- RPC lockdown discipline (the 0011 precedent): `revoke all ... from public` then grant exactly — `resolve_participant_token` → anon only; `submit`/`clear` → anon only.
- 404-shaped errors from RPCs: uniform `'not found'`-style messages that never confirm existence; console actions keep `{ ok, error: GENERIC_WRITE_ERROR }` + server-side logging.
- `units` UPDATE grant is currently column-scoped to `(name, external_ref)` (0008); 0013 additively grants `update (assigned_participant_id)` and guards it with an org-consistency trigger.
- `SUPABASE_SERVICE_ROLE_KEY` is optional in `env.ts` — `lib/supabase/admin.ts` throws a descriptive error when absent. Never import it from client code (`import "server-only"`).
- Headers on `/p/:path*` and `/portal/:path*`: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` via `next.config.ts` `headers()`.
- CI drift gate: `npm run db:generate` after migrations → "No schema changes". Local stack must be up. macOS `sed -i ''` if needed. Commits end with the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.

## File Structure

```
Modify: src/db/schema/programs.ts        + units.assignedParticipantId, unitStageResponses.answeredByParticipantId
Create: src/db/schema/participants.ts    participants, accessTokens (+ index.ts export)
Create: src/db/migrations/0012_*.sql     (generated) / 0013_participant_tokens.sql (custom)
Create: src/lib/tokens/mint.ts           generateParticipantToken()  (+ mint.test.ts)
Create: src/lib/tokens/rate-limit.ts     SlidingWindowLimiter        (+ rate-limit.test.ts)
Create: src/lib/tokens/index.ts          resolveParticipantToken, getParticipantUnits, getParticipantUnitDetail, buildParticipantUrl
Create: src/lib/supabase/admin.ts        server-only service-role client
Create: src/lib/supabase/anon-server.ts  server-side anon client (RPC caller)
Modify: next.config.ts                   headers()
Create: src/features/participants/schema.ts (+ schema.test.ts)
Create: src/features/participants/actions.ts      console: createParticipant, assignUnit, issueLink, revokeLink
Create: src/features/participants/flow-actions.ts participant: submitResponse, clearResponse (token → RPC)
Create: src/features/participants/queries.ts      listParticipants, listProgramLinks
Create: src/features/participants/components/assign-participant.tsx, links-panel.tsx,
        participant-stage-sections.tsx
Create: src/features/participants/tokens.integration.test.ts   (the security suite)
Create: src/features/programs/components/requirement-field.tsx (extracted; unit-stage-sections imports it)
Modify: src/features/programs/queries.ts          getProgram units gain assignedParticipantId
Modify: src/features/programs/components/unit-row.tsx / unit-list.tsx   (Assign control)
Modify: src/app/(dashboard)/programs/[id]/page.tsx                     (links panel + participants data)
Create: src/app/p/[token]/page.tsx, src/app/p/[token]/units/[unitId]/page.tsx, src/app/p/layout.tsx
Modify: scripts/seed.ts                   demo participant + assignment + printed link
```

---

### Task 1: Drizzle schema + migration 0012

**Files:**
- Create: `src/db/schema/participants.ts`
- Modify: `src/db/schema/programs.ts`, `src/db/schema/index.ts`
- Create: `src/db/migrations/0012_*.sql` (generated — additive only, no prompts)

**Interfaces:**
- Produces: Drizzle exports **`participants`**, **`accessTokens`**; `units.assignedParticipantId`; `unitStageResponses.answeredByParticipantId`. SQL names: `participants`, `access_tokens` (`token_hash` unique), `units.assigned_participant_id`, `unit_stage_responses.answered_by_participant_id`.

- [ ] **Step 1: Create `src/db/schema/participants.ts`**

```typescript
import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { programs, units } from "./programs";

// External people — installers, engineers, site contacts. NEVER auth users:
// the product must never force accounts on external collaborators.
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("participants_org_id_idx").on(t.orgId)],
);

// Scoped signed links. The raw token is NEVER stored — only its sha256 hex.
// kind CHECK, the participant-scope CHECK, RLS, grants, and the org-guard
// trigger all live in 0013 (custom SQL keeps them in one reviewable place).
export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    // 'participant' | 'portal' (portal arrives in slice 9)
    kind: text("kind").notNull(),
    participantId: uuid("participant_id").references(() => participants.id, {
      onDelete: "cascade",
    }),
    programId: uuid("program_id").references(() => programs.id, { onDelete: "cascade" }),
    // null ⇒ every unit currently assigned to the participant
    unitId: uuid("unit_id").references(() => units.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("access_tokens_token_hash_uq").on(t.tokenHash),
    index("access_tokens_org_id_idx").on(t.orgId),
    index("access_tokens_participant_id_idx").on(t.participantId),
    index("access_tokens_program_id_idx").on(t.programId),
    index("access_tokens_unit_id_idx").on(t.unitId),
  ],
);
```

- [ ] **Step 2: Extend `src/db/schema/programs.ts`**

`units` gains (after `externalRef`):

```typescript
    // v1 assignment model: unit-level, one participant. Set-null keeps the
    // unit when a participant is deleted. Guard trigger in 0013 pins the
    // participant to the unit's org.
    assignedParticipantId: uuid("assigned_participant_id"),
```

and the units table's index list gains `index("units_assigned_participant_id_idx").on(t.assignedParticipantId)`. (A plain column, NOT `.references()` — participants.ts already imports from programs.ts, and a back-reference would create a module cycle; the FK is added in 0013 SQL instead.)

`unitStageResponses` gains (after `answeredByUserId`):

```typescript
    // Set ONLY inside the participant RPCs (no client column grant on any
    // role); the prepare trigger nulls it on staff writes (attribution
    // symmetry — the audit trail never shows both).
    answeredByParticipantId: uuid("answered_by_participant_id"),
```

In `src/db/schema/index.ts` add `export * from "./participants";` and update the header comment's aggregate list to include `participants`, `accessTokens`.

- [ ] **Step 3: Generate, inspect, apply, drift-check**

```bash
npm run db:generate
npm run db:migrate
npm run db:generate
```

Expected: one `0012_*.sql` with 2 CREATE TABLE + 2 ADD COLUMN + FKs/indexes (units FK to participants appears only if drizzle infers it — it must NOT, since we declared a plain column; verify no cycle errors), then clean apply, then "No schema changes". Add the two FKs `units.assigned_participant_id → participants(id) ON DELETE SET NULL` and `unit_stage_responses.answered_by_participant_id → participants(id) ON DELETE SET NULL` manually at the TOP of 0013 in Task 2 (they are not in 0012 precisely because of the module-cycle constraint).

- [ ] **Step 4: Commit**

```bash
git add src/db
git commit -m "feat(db): participants + access_tokens tables, assignment and attribution columns (0012)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Migration 0013 — RLS, guards, token RPCs (integration-test-first)

**Files:**
- Test (create): `src/features/participants/tokens.integration.test.ts`
- Create: `src/db/migrations/0013_participant_tokens.sql` (via `npx drizzle-kit generate --custom --name=participant_tokens`)

**Interfaces:**
- Consumes: Task 1 tables; slice-6 objects (`prepare_unit_stage_response`, derivation, `create_program`).
- Produces: **`resolve_participant_token(p_token text)`** → `(status, org_name, org_id, participant_id, participant_name, program_id, program_name, unit_id)`; **`submit_participant_response(p_token text, p_unit_id uuid, p_requirement_id uuid, p_value_text text, p_value_number numeric, p_value_bool boolean, p_value_date date)`**; **`clear_participant_response(p_token text, p_unit_id uuid, p_requirement_id uuid)`**. All anon-executable only. Guard triggers `access_tokens_check_org`, `units_check_assigned_participant`.

- [ ] **Step 1: Write the integration test file**

Create `src/features/participants/tokens.integration.test.ts`. Same harness head as `src/features/templates/rls.integration.test.ts` (loadEnvFile, env constants, `admin`, `signedInUser`). Then:

```typescript
import { createHash, randomBytes } from "node:crypto";

const anon = createClient(url, anonKey, { auth: { persistSession: false } });

function mint(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: createHash("sha256").update(token, "utf8").digest("hex") };
}

type Resolved = {
  status: "ok" | "expired" | "revoked";
  org_name: string;
  participant_id: string;
  program_id: string;
  unit_id: string | null;
};

describe("participant tokens: mint, resolve, scope, attribution", () => {
  // ORDER-DEPENDENT: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let programId: string;
  let stageId: string;            // the single program stage
  let textReqId: string;
  let boolReqId: string;
  let unit1: string;              // assigned to P1
  let unit2: string;              // assigned to P2
  let p1: string;
  let p2: string;
  let t1: { token: string; tokenHash: string }; // program-scoped, P1
  let t2: { token: string; tokenHash: string }; // unit2-scoped, P2

  const resolve = async (token: string) =>
    anon.rpc("resolve_participant_token", { p_token: token });
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

  beforeAll(async () => {
    alice = await signedInUser("tok_alice");
    bob = await signedInUser("tok_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "TokAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "TokBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "Tok Template" }).select("id").single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 })
      .select("id").single();
    await alice.from("template_stage_requirements").insert([
      { template_stage_id: s!.id, org_id: orgId, type: "text", label: "Notes", required: true, config: {}, position: 0 },
      { template_stage_id: s!.id, org_id: orgId, type: "boolean", label: "Safe", required: true, config: {}, position: 1 },
    ]);
    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "Tok Program",
    });
    if (e3) throw e3;
    programId = (program as { id: string }).id;
    const { data: pStages } = await alice
      .from("program_stages").select("id").eq("program_id", programId);
    stageId = pStages![0].id;
    const { data: reqs } = await alice
      .from("program_stage_requirements")
      .select("id, label").eq("program_id", programId);
    textReqId = reqs!.find((r) => r.label === "Notes")!.id;
    boolReqId = reqs!.find((r) => r.label === "Safe")!.id;

    const { data: parts } = await alice
      .from("participants")
      .insert([
        { org_id: orgId, name: "P One", email: "p1@example.com" },
        { org_id: orgId, name: "P Two" },
      ])
      .select("id, name");
    p1 = parts!.find((p) => p.name === "P One")!.id;
    p2 = parts!.find((p) => p.name === "P Two")!.id;

    const { data: u1 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit 1", assigned_participant_id: p1 })
      .select("id").single();
    unit1 = u1!.id;
    const { data: u2 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Unit 2", assigned_participant_id: p2 })
      .select("id").single();
    unit2 = u2!.id;

    t1 = mint();
    t2 = mint();
    const in30d = new Date(Date.now() + 30 * 86400_000).toISOString();
    const { data: me } = await alice.auth.getUser();
    const { error: mintError } = await alice.from("access_tokens").insert([
      { org_id: orgId, token_hash: t1.tokenHash, kind: "participant", participant_id: p1, program_id: programId, expires_at: in30d, created_by: me!.user!.id },
      { org_id: orgId, token_hash: t2.tokenHash, kind: "participant", participant_id: p2, program_id: programId, unit_id: unit2, expires_at: in30d, created_by: me!.user!.id },
    ]);
    if (mintError) throw mintError;
  });

  it("resolves a valid token with names; unknown returns zero rows", async () => {
    const { data, error } = await resolve(t1.token);
    expect(error).toBeNull();
    const rows = data as Resolved[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].org_name).toBe("TokAlpha");
    expect(rows[0].participant_id).toBe(p1);
    expect(rows[0].unit_id).toBeNull();

    const { data: none } = await resolve(mint().token);
    expect(none).toHaveLength(0);
  });

  it("touches last_used_at on resolve", async () => {
    const { data } = await alice
      .from("access_tokens").select("last_used_at").eq("token_hash", t1.tokenHash).single();
    expect(data!.last_used_at).not.toBeNull();
  });

  it("reports expired and revoked distinctly", async () => {
    const old = mint();
    const { data: me } = await alice.auth.getUser();
    await alice.from("access_tokens").insert({
      org_id: orgId, token_hash: old.tokenHash, kind: "participant",
      participant_id: p1, program_id: programId,
      expires_at: new Date(Date.now() - 60_000).toISOString(), created_by: me!.user!.id,
    });
    const { data: exp } = await resolve(old.token);
    expect((exp as Resolved[])[0].status).toBe("expired");
    expect((exp as Resolved[])[0].org_name).toBe("TokAlpha");
  });

  it("cross-org mint is rejected by the guard trigger", async () => {
    const { data: bobOrg } = await bob.from("orgs").select("id").single();
    const { data: me } = await bob.auth.getUser();
    // Bob binds his own org_id to Alice's program/participant.
    const { error } = await bob.from("access_tokens").insert({
      org_id: bobOrg!.id, token_hash: mint().tokenHash, kind: "participant",
      participant_id: p1, program_id: programId,
      expires_at: new Date(Date.now() + 86400_000).toISOString(), created_by: me!.user!.id,
    });
    expect(error).not.toBeNull();
  });

  it("cross-org unit assignment is rejected by the guard trigger", async () => {
    // Bob creates his own unit fixture, then tries to assign Alice's participant.
    const { data: bt } = await bob.from("templates").insert({
      org_id: (await bob.from("orgs").select("id").single()).data!.id, name: "B T",
    }).select("id, org_id").single();
    await bob.from("template_stages").insert({ template_id: bt!.id, org_id: bt!.org_id, name: "S", position: 0 });
    const { data: bp } = await bob.rpc("create_program", { p_template_id: bt!.id, p_name: "B P" });
    const { error } = await bob.from("units").insert({
      program_id: (bp as { id: string }).id, org_id: bt!.org_id, name: "B U",
      assigned_participant_id: p1,
    });
    expect(error).not.toBeNull();
  });

  it("submit writes with participant attribution and drives derivation", async () => {
    const { error: e1 } = await submit(t1.token, unit1, textReqId, { p_value_text: "All good" });
    expect(e1).toBeNull();
    const { error: e2 } = await submit(t1.token, unit1, boolReqId, { p_value_bool: true });
    expect(e2).toBeNull();

    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1).eq("program_stage_requirement_id", textReqId).single();
    expect(resp!.answered_by_participant_id).toBe(p1);
    expect(resp!.answered_by_user_id).toBeNull();

    const { data: us } = await alice
      .from("unit_stages").select("status, done_source")
      .eq("unit_id", unit1).eq("program_stage_id", stageId).single();
    expect(us!.status).toBe("done");
    expect(us!.done_source).toBe("requirements");
  });

  it("the core scope test: a token cannot touch a unit outside its scope", async () => {
    // P1's program-scoped token vs unit2 (assigned to P2)
    const { error: cross } = await submit(t1.token, unit2, textReqId, { p_value_text: "x" });
    expect(cross).not.toBeNull();
    // P2's unit2-scoped token vs unit1
    const { error: cross2 } = await submit(t2.token, unit1, textReqId, { p_value_text: "x" });
    expect(cross2).not.toBeNull();
  });

  it("reassignment kills scope", async () => {
    await alice.from("units").update({ assigned_participant_id: null }).eq("id", unit2);
    const { error } = await submit(t2.token, unit2, textReqId, { p_value_text: "x" });
    expect(error).not.toBeNull();
    await alice.from("units").update({ assigned_participant_id: p2 }).eq("id", unit2);
  });

  it("staff re-answer flips attribution (symmetry)", async () => {
    const { error } = await alice.from("unit_stage_responses").upsert(
      {
        unit_stage_id: (await alice.from("unit_stages").select("id")
          .eq("unit_id", unit1).eq("program_stage_id", stageId).single()).data!.id,
        program_stage_requirement_id: textReqId,
        value_text: "Staff correction",
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    );
    expect(error).toBeNull();
    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1).eq("program_stage_requirement_id", textReqId).single();
    expect(resp!.answered_by_user_id).not.toBeNull();
    expect(resp!.answered_by_participant_id).toBeNull();
  });

  it("participant re-answer flips it back", async () => {
    const { error } = await submit(t1.token, unit1, textReqId, { p_value_text: "Participant again" });
    expect(error).toBeNull();
    const { data: resp } = await alice
      .from("unit_stage_responses")
      .select("answered_by_participant_id, answered_by_user_id")
      .eq("unit_id", unit1).eq("program_stage_requirement_id", textReqId).single();
    expect(resp!.answered_by_participant_id).toBe(p1);
    expect(resp!.answered_by_user_id).toBeNull();
  });

  it("clear removes the response and reopens the stage", async () => {
    const { error } = await anon.rpc("clear_participant_response", {
      p_token: t1.token, p_unit_id: unit1, p_requirement_id: boolReqId,
    });
    expect(error).toBeNull();
    const { data: us } = await alice
      .from("unit_stages").select("status").eq("unit_id", unit1).eq("program_stage_id", stageId).single();
    expect(us!.status).toBe("pending");
  });

  it("a revoked token stops working mid-session", async () => {
    await alice.from("access_tokens").update({ revoked_at: new Date().toISOString() })
      .eq("token_hash", t2.tokenHash);
    const { data: r } = await resolve(t2.token);
    expect((r as Resolved[])[0].status).toBe("revoked");
    const { error } = await submit(t2.token, unit2, textReqId, { p_value_text: "x" });
    expect(error).not.toBeNull();
  });

  it("authenticated cannot execute the write RPCs; staff cannot set participant attribution; anon has no table access", async () => {
    const { error: e1 } = await alice.rpc("submit_participant_response", {
      p_token: t1.token, p_unit_id: unit1, p_requirement_id: textReqId,
      p_value_text: "hijack", p_value_number: null, p_value_bool: null, p_value_date: null,
    });
    expect(e1).not.toBeNull();

    const { error: e2 } = await alice.from("unit_stage_responses").upsert(
      {
        unit_stage_id: (await alice.from("unit_stages").select("id")
          .eq("unit_id", unit1).eq("program_stage_id", stageId).single()).data!.id,
        program_stage_requirement_id: textReqId,
        value_text: "x",
        answered_by_participant_id: p1,
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    );
    expect(e2).not.toBeNull(); // no column grant

    const { data: leak, error: e3 } = await anon.from("access_tokens").select("id");
    expect(e3 !== null || (leak ?? []).length === 0).toBe(true);
    const { data: leak2, error: e4 } = await anon.from("unit_stage_responses").select("id");
    expect(e4 !== null || (leak2 ?? []).length === 0).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:integration`
Expected: the new file FAILS (functions/policies missing); the five pre-existing files still pass.

- [ ] **Step 3: Write `0013_participant_tokens.sql`**

```bash
npx drizzle-kit generate --custom --name=participant_tokens
```

Replace its contents with:

```sql
-- Custom SQL migration file, put your code below! --

-- Participant links security model (slice 7):
--   * participants: ordinary member-writable rows (templates pattern).
--   * access_tokens: member select/insert; the ONLY member mutation is
--     revoke (column-scoped update on revoked_at). token_hash is sha256 —
--     a leaked database leaks no usable links. Guard trigger closes the
--     cross-org mint hole (RLS only proves the MINTER's membership; the
--     FKs point anywhere).
--   * The security boundary for /p is 256-bit token ENTROPY. The RPCs are
--     deliberately anon-callable: the DB trusts the token, not the caller.
--   * resolve_participant_token is the ONLY validity logic in the system.

-- ---------- FKs deferred from 0012 (module-cycle constraint in schema TS)
alter table public.units
  add constraint units_assigned_participant_id_participants_id_fk
  foreign key (assigned_participant_id) references public.participants(id)
  on delete set null;
alter table public.unit_stage_responses
  add constraint unit_stage_responses_answered_by_participant_id_fk
  foreign key (answered_by_participant_id) references public.participants(id)
  on delete set null;

-- ---------- CHECKs
alter table public.access_tokens
  add constraint access_tokens_kind_check check (kind in ('participant','portal'));
alter table public.access_tokens
  add constraint access_tokens_participant_scope_check
  check (kind <> 'participant' or (participant_id is not null and program_id is not null));

-- ---------- RLS
alter table public.participants enable row level security;
alter table public.access_tokens enable row level security;

create policy "participants_select_member" on public.participants
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "participants_insert_member" on public.participants
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "participants_update_member" on public.participants
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "participants_delete_member" on public.participants
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "access_tokens_select_member" on public.access_tokens
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "access_tokens_insert_member" on public.access_tokens
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "access_tokens_update_member" on public.access_tokens
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
-- no delete policy: token history is the audit trail.

-- ---------- Grants (0004 convention; blanket-ACL revokes per the 0011 lesson)
revoke insert, update, delete on table public.participants from authenticated;
grant select, insert, update, delete on table public.participants to authenticated;
grant select, insert, update, delete on table public.participants to service_role;

revoke insert, update, delete on table public.access_tokens from authenticated;
grant select, insert on table public.access_tokens to authenticated;
grant update (revoked_at) on table public.access_tokens to authenticated;
grant select on table public.access_tokens to service_role;

-- units: additive column grant for assignment (0008 scoped it to name/external_ref)
grant update (assigned_participant_id) on table public.units to authenticated;

-- ---------- Guard: token scope must be internally consistent with its org.
-- SECURITY INVOKER: foreign rows are RLS-invisible, so they read as
-- 'not found' rather than leaking existence (check_template_stage_org
-- precedent).
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
  return new;
end;
$$;

create trigger access_tokens_check_org
before insert or update on public.access_tokens
for each row execute function public.check_access_token_org();

-- ---------- Guard: an assigned participant must belong to the unit's org.
create or replace function public.check_unit_assigned_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.assigned_participant_id is not null then
    select org_id into v_org from public.participants where id = new.assigned_participant_id;
    if v_org is null then raise exception 'participant not found'; end if;
    if v_org <> new.org_id then raise exception 'org mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger units_check_assigned_participant
before insert or update of assigned_participant_id, org_id on public.units
for each row execute function public.check_unit_assigned_participant();

-- ---------- The sole validity authority.
create or replace function public.resolve_participant_token(p_token text)
returns table(
  status text, org_name text, org_id uuid,
  participant_id uuid, participant_name text,
  program_id uuid, program_name text, unit_id uuid
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
   where t.token_hash = v_hash and t.kind = 'participant';
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
           o.name, v_tok.org_id, v_tok.participant_id, p.name,
           v_tok.program_id, pr.name, v_tok.unit_id
      from public.orgs o, public.participants p, public.programs pr
     where o.id = v_tok.org_id and p.id = v_tok.participant_id
       and pr.id = v_tok.program_id;
end;
$$;

revoke all on function public.resolve_participant_token(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_participant_token(text) to anon;

-- ---------- Locate a unit_stage inside a token's LIVE scope, or raise.
-- Not exposed: internal helper for the two write RPCs.
create or replace function public.participant_scope_unit_stage(
  p_token text, p_unit_id uuid, p_requirement_id uuid,
  out o_unit_stage_id uuid, out o_participant_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope record;
  v_req public.program_stage_requirements;
begin
  select * into v_scope from public.resolve_participant_token(p_token);
  if v_scope.status is null or v_scope.status <> 'ok' then
    raise exception 'not found';
  end if;
  select * into v_req
    from public.program_stage_requirements r
   where r.id = p_requirement_id and r.program_id = v_scope.program_id;
  if v_req.id is null then
    raise exception 'not found';
  end if;
  -- Scope is LIVE: assignment is checked now, not at mint time.
  perform 1 from public.units u
    where u.id = p_unit_id
      and u.program_id = v_scope.program_id
      and u.assigned_participant_id = v_scope.participant_id
      and (v_scope.unit_id is null or u.id = v_scope.unit_id);
  if not found then
    raise exception 'not found';
  end if;
  select us.id into o_unit_stage_id
    from public.unit_stages us
   where us.unit_id = p_unit_id and us.program_stage_id = v_req.program_stage_id;
  if o_unit_stage_id is null then
    raise exception 'not found';
  end if;
  o_participant_id := v_scope.participant_id;
end;
$$;

revoke all on function public.participant_scope_unit_stage(text, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------- Participant writes. The DB trusts the token, not the caller.
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
begin
  select o_unit_stage_id, o_participant_id
    into v_unit_stage_id, v_participant_id
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);

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
  -- The slice-6 prepare trigger validates/derives the rest; the derive
  -- trigger recomputes the stage. Both fire unchanged.
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
begin
  select o_unit_stage_id, o_participant_id
    into v_unit_stage_id, v_participant_id
    from public.participant_scope_unit_stage(p_token, p_unit_id, p_requirement_id);
  delete from public.unit_stage_responses
   where unit_stage_id = v_unit_stage_id
     and program_stage_requirement_id = p_requirement_id;
end;
$$;

revoke all on function public.clear_participant_response(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.clear_participant_response(text, uuid, uuid) to anon;

-- ---------- Attribution symmetry (amends the slice-6 prepare trigger).
-- Read the CURRENT body of prepare_unit_stage_response from 0011 before
-- editing: recreate it VERBATIM plus exactly this attribution block —
-- staff writes (auth.uid() present) claim user attribution and null the
-- participant; token-path writes (auth.uid() null under anon) keep the
-- RPC-supplied participant id and a null user id.
--   new.answered_by_user_id := auth.uid();
--   if auth.uid() is not null then
--     new.answered_by_participant_id := null;
--   end if;
-- If the current body does not yet set answered_by_user_id at all, ADD the
-- two statements above; if it already sets it, replace that line with the
-- block. Everything else in the function stays byte-identical.
```

(The final section is an instruction to the implementer inside the migration authoring step: the recreated `prepare_unit_stage_response` must be included in 0013 as a full `create or replace function` — copy the live body from 0011 and splice the attribution block in.)

- [ ] **Step 4: Apply and test to green**

```bash
npm run db:migrate
npm run test:integration
npm run db:generate
```

Expected: all six integration files pass; "No schema changes". If the attribution tests fail, inspect the recreated prepare trigger body first.

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations src/features/participants/tokens.integration.test.ts
git commit -m "feat(db): participant token RPCs, guard triggers, attribution symmetry (0013)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Token helpers + rate limiter (pure TS, TDD)

**Files:**
- Create: `src/lib/tokens/mint.ts`, Test: `src/lib/tokens/mint.test.ts`
- Create: `src/lib/tokens/rate-limit.ts`, Test: `src/lib/tokens/rate-limit.test.ts`

**Interfaces:**
- Produces: `generateParticipantToken(): { token: string; tokenHash: string }`; `class SlidingWindowLimiter { constructor(limit: number, windowMs: number); allow(key: string, now?: number): boolean }`.

- [ ] **Step 1: Write the failing tests**

`src/lib/tokens/mint.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateParticipantToken, hashToken } from "./mint";

describe("generateParticipantToken", () => {
  it("produces 32 bytes of base64url with a matching sha256 hex hash", () => {
    const { token, tokenHash } = generateParticipantToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url, no padding
    expect(tokenHash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
  });

  it("hashToken matches a known sha256 vector (must agree with SQL's digest)", () => {
    // sha256("abc") — the canonical test vector; SQL side:
    // encode(extensions.digest(convert_to('abc','utf8'),'sha256'),'hex')
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("two mints never collide", () => {
    expect(generateParticipantToken().token).not.toBe(generateParticipantToken().token);
  });
});
```

`src/lib/tokens/rate-limit.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SlidingWindowLimiter } from "./rate-limit";

describe("SlidingWindowLimiter", () => {
  it("allows up to the limit inside the window, then blocks", () => {
    const l = new SlidingWindowLimiter(3, 60_000);
    const t = 1_000_000;
    expect(l.allow("k", t)).toBe(true);
    expect(l.allow("k", t + 1)).toBe(true);
    expect(l.allow("k", t + 2)).toBe(true);
    expect(l.allow("k", t + 3)).toBe(false);
  });

  it("refills as the window slides", () => {
    const l = new SlidingWindowLimiter(2, 1_000);
    const t = 5_000;
    expect(l.allow("k", t)).toBe(true);
    expect(l.allow("k", t + 100)).toBe(true);
    expect(l.allow("k", t + 200)).toBe(false);
    expect(l.allow("k", t + 1_150)).toBe(true); // first hit aged out
  });

  it("keys are independent", () => {
    const l = new SlidingWindowLimiter(1, 60_000);
    expect(l.allow("a", 0)).toBe(true);
    expect(l.allow("b", 0)).toBe(true);
    expect(l.allow("a", 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/tokens/mint.ts`:

```typescript
import { createHash, randomBytes } from "node:crypto";

// 32 random bytes = 256 bits. This IS the security boundary for /p — the
// RPCs are anon-callable, so guessing must be physically infeasible.
// Never shorten. Hashing must agree with SQL:
//   encode(extensions.digest(convert_to(token,'utf8'),'sha256'),'hex')
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateParticipantToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
```

`src/lib/tokens/rate-limit.ts`:

```typescript
// In-memory sliding window. DoS/noise hygiene only — NOT the security
// boundary (that's token entropy); resets on redeploy, per-instance.
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length >= this.limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tokens
git commit -m "feat(tokens): mint + hash helpers and sliding-window limiter

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The chokepoint — clients, resolver, scoped readers, headers

**Files:**
- Create: `src/lib/supabase/admin.ts`, `src/lib/supabase/anon-server.ts`
- Create: `src/lib/tokens/index.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: Task 2 RPC `resolve_participant_token`; Task 3 helpers.
- Produces:
  - `resolveParticipantToken(token: string, clientKey: string): Promise<ResolveResult>` where `ResolveResult = { status: "not_found" } | { status: "expired" | "revoked"; orgName: string } | { status: "ok"; scope: TokenScope }` and `TokenScope = { orgId: string; orgName: string; participantId: string; participantName: string; programId: string; programName: string; unitId: string | null }`.
  - `getParticipantUnits(scope): Promise<{ id; name; externalRef; outstanding: number; total: number }[]>`
  - `getParticipantUnitDetail(scope, unitId): Promise<ParticipantUnitDetail | null>` with `ParticipantUnitDetail = { id; name; externalRef; stages: StageSection[] }` (reusing `StageSection` from `@/features/programs/queries`).
  - `buildParticipantUrl(token: string): string`.

- [ ] **Step 1: `src/lib/supabase/admin.ts`**

```typescript
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

// Service-role client. BYPASSES RLS — import only from modules that
// constrain every query by an explicitly resolved scope (lib/tokens).
// Never from a route handler or component directly.
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for token-scoped reads. Run `npm run setup`.",
    );
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 2: `src/lib/supabase/anon-server.ts`**

```typescript
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

// Anon-key client with NO cookie/session handling: the caller is nobody.
// Used for the token RPCs, where the token itself is the credential.
export function createAnonServerClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 3: `src/lib/tokens/index.ts`**

```typescript
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { env } from "@/env";
import type { StageSection } from "@/features/programs/queries";
import { SlidingWindowLimiter } from "./rate-limit";

export { generateParticipantToken, hashToken } from "./mint";

export type TokenScope = {
  orgId: string;
  orgName: string;
  participantId: string;
  participantName: string;
  programId: string;
  programName: string;
  unitId: string | null;
};

export type ResolveResult =
  | { status: "not_found" }
  | { status: "expired" | "revoked"; orgName: string }
  | { status: "ok"; scope: TokenScope };

// DoS hygiene only — the boundary is token entropy (see lib/tokens/mint.ts).
const limiter = new SlidingWindowLimiter(30, 60_000);

// THE chokepoint: the only code that hands a raw token to the database.
// clientKey groups rate-limit hits (an IP, or "server" when unknown).
// Tokens are NEVER logged — not even at error level.
export async function resolveParticipantToken(
  token: string,
  clientKey: string,
): Promise<ResolveResult> {
  if (!limiter.allow(`${clientKey}:${token.slice(0, 8)}`)) return { status: "not_found" };
  if (token.length < 20 || token.length > 200) return { status: "not_found" };

  const anon = createAnonServerClient();
  const { data, error } = await anon.rpc("resolve_participant_token", { p_token: token });
  if (error) {
    console.error("[tokens] resolve failed:", error.code ?? error.message); // no token in logs
    return { status: "not_found" };
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { status: "not_found" };
  if (row.status === "expired" || row.status === "revoked") {
    return { status: row.status, orgName: row.org_name as string };
  }
  return {
    status: "ok",
    scope: {
      orgId: row.org_id as string,
      orgName: row.org_name as string,
      participantId: row.participant_id as string,
      participantName: row.participant_name as string,
      programId: row.program_id as string,
      programName: row.program_name as string,
      unitId: (row.unit_id as string | null) ?? null,
    },
  };
}

// Scoped READS run on the admin client; every query filters by the resolved
// scope — org, program, live assignment, and the token's unit pin.
function unitFilter(scope: TokenScope) {
  return { programId: scope.programId, participantId: scope.participantId, unitId: scope.unitId };
}

export async function getParticipantUnits(scope: TokenScope) {
  const db = createAdminClient();
  const f = unitFilter(scope);
  let q = db
    .from("units")
    .select("id, name, external_ref, created_at, unit_stages(id, status)")
    .eq("program_id", f.programId)
    .eq("org_id", scope.orgId)
    .eq("assigned_participant_id", f.participantId);
  if (f.unitId) q = q.eq("id", f.unitId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((u) => ({
      id: u.id,
      name: u.name,
      externalRef: u.external_ref as string | null,
      outstanding: u.unit_stages.filter((s) => s.status !== "done").length,
      total: u.unit_stages.length,
    }));
}

export type ParticipantUnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  stages: StageSection[];
};

export async function getParticipantUnitDetail(
  scope: TokenScope,
  unitId: string,
): Promise<ParticipantUnitDetail | null> {
  const db = createAdminClient();
  const f = unitFilter(scope);
  if (f.unitId && f.unitId !== unitId) return null; // unit-pinned token
  const { data: unit, error } = await db
    .from("units")
    .select("id, name, external_ref, unit_stages(id, program_stage_id, status, done_source)")
    .eq("id", unitId)
    .eq("program_id", f.programId)
    .eq("org_id", scope.orgId)
    .eq("assigned_participant_id", f.participantId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null;

  const [{ data: stages, error: e1 }, { data: reqs, error: e2 }, { data: resps, error: e3 }] =
    await Promise.all([
      db.from("program_stages").select("id, name, position").eq("program_id", f.programId),
      db
        .from("program_stage_requirements")
        .select("id, program_stage_id, type, label, required, config, position")
        .eq("program_id", f.programId),
      db
        .from("unit_stage_responses")
        .select("program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId),
    ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;

  type RespRow = NonNullable<typeof resps>[number];
  const valueOf = (r: RespRow): string | number | boolean | null =>
    r.type === "number"
      ? r.value_number === null ? null : Number(r.value_number)
      : r.type === "boolean"
        ? r.value_bool
        : r.type === "date"
          ? r.value_date
          : r.value_text;
  const responseByReq = new Map((resps ?? []).map((r) => [r.program_stage_requirement_id, valueOf(r)]));
  const usByStage = new Map(unit.unit_stages.map((us) => [us.program_stage_id, us]));

  return {
    id: unit.id,
    name: unit.name,
    externalRef: unit.external_ref as string | null,
    stages: [...(stages ?? [])]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .flatMap((s) => {
        const us = usByStage.get(s.id);
        if (!us) return [];
        return [{
          unitStageId: us.id,
          programStageId: s.id,
          name: s.name,
          position: s.position,
          status: us.status as "pending" | "done",
          doneSource: us.done_source as StageSection["doneSource"],
          requirements: (reqs ?? [])
            .filter((r) => r.program_stage_id === s.id)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
            .map((r) => ({
              id: r.id,
              type: r.type as StageSection["requirements"][number]["type"],
              label: r.label,
              required: r.required,
              config: (r.config ?? {}) as StageSection["requirements"][number]["config"],
              value: responseByReq.get(r.id) ?? null,
            })),
        }];
      }),
  };
}

export function buildParticipantUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL}/p/${token}`;
}
```

- [ ] **Step 4: Headers in `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    // Token-in-URL surfaces: never leak via Referer, never index.
    const tokenSurface = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      { source: "/p/:path*", headers: tokenSurface },
      { source: "/portal/:path*", headers: tokenSurface },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Verify + commit**

```bash
npm run verify && npm run build
git add src/lib next.config.ts
git commit -m "feat(tokens): chokepoint resolver, scoped readers, admin/anon clients, token-surface headers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Console schemas + actions + queries

**Files:**
- Create: `src/features/participants/schema.ts`, Test: `src/features/participants/schema.test.ts`
- Create: `src/features/participants/actions.ts`, `src/features/participants/queries.ts`
- Modify: `src/features/programs/queries.ts` (getProgram units gain `assignedParticipantId`)

**Interfaces:**
- Consumes: Task 3 `generateParticipantToken`, Task 4 `buildParticipantUrl`.
- Produces: actions `createParticipant(input) → { ok, id?, error? }`, `assignUnit({unitId, participantId: string | null})`, `issueLink({participantId, programId, unitId?, expiresDays?}) → { ok, url?, error? }`, `revokeLink({id})`; queries `listParticipants(): { id; name; email; phone }[]`, `listProgramLinks(programId): ProgramLink[]` with `ProgramLink = { id; participantId; participantName; unitId: string | null; unitName: string | null; createdAt; expiresAt; revokedAt: string | null; lastUsedAt: string | null; status: "active" | "expired" | "revoked" }`; `Unit` (programs/queries) gains `assignedParticipantId: string | null`.

- [ ] **Step 1: Schemas + failing tests**

Append to a new `src/features/participants/schema.ts`:

```typescript
import { z } from "zod";

export const participantName = z.string().trim().min(1).max(120);
export const createParticipantInput = z.object({
  name: participantName,
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
});
export const assignUnitInput = z.object({
  unitId: z.uuid(),
  participantId: z.uuid().nullable(),
});
export const issueLinkInput = z.object({
  participantId: z.uuid(),
  programId: z.uuid(),
  unitId: z.uuid().optional(),
  expiresDays: z.number().int().min(1).max(365).default(30),
});
export const revokeLinkInput = z.object({ id: z.uuid() });

// Participant flow inputs (used by flow-actions in Task 7): the token rides
// along; the value union mirrors saveResponseInput exactly.
const flowIds = { token: z.string().min(20).max(200), unitId: z.uuid(), requirementId: z.uuid() };
export const participantSaveResponseInput = z.discriminatedUnion("type", [
  z.object({ ...flowIds, type: z.literal("text"), value: z.string().trim().min(1).max(2000) }),
  z.object({ ...flowIds, type: z.literal("choice"), value: z.string().trim().min(1).max(120) }),
  z.object({ ...flowIds, type: z.literal("number"), value: z.number().finite() }),
  z.object({ ...flowIds, type: z.literal("boolean"), value: z.boolean() }),
  z.object({
    ...flowIds,
    type: z.literal("date"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  }),
]);
export const participantClearResponseInput = z.object(flowIds);

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
```

Test `src/features/participants/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  createParticipantInput,
  issueLinkInput,
  participantSaveResponseInput,
} from "./schema";

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("participants schemas", () => {
  it("createParticipant trims and bounds the name, validates email", () => {
    expect(createParticipantInput.safeParse({ name: "  Alex  " }).success).toBe(true);
    expect(createParticipantInput.safeParse({ name: " " }).success).toBe(false);
    expect(createParticipantInput.safeParse({ name: "A", email: "not-an-email" }).success).toBe(false);
  });

  it("issueLink defaults expiry to 30 days and bounds it", () => {
    const parsed = issueLinkInput.parse({ participantId: uuid, programId: uuid });
    expect(parsed.expiresDays).toBe(30);
    expect(issueLinkInput.safeParse({ participantId: uuid, programId: uuid, expiresDays: 0 }).success).toBe(false);
    expect(issueLinkInput.safeParse({ participantId: uuid, programId: uuid, expiresDays: 366 }).success).toBe(false);
  });

  it("participantSaveResponseInput requires a plausible token and typed value", () => {
    const ids = { token: "x".repeat(43), unitId: uuid, requirementId: uuid };
    expect(participantSaveResponseInput.safeParse({ ...ids, type: "text", value: "ok" }).success).toBe(true);
    expect(participantSaveResponseInput.safeParse({ ...ids, token: "short", type: "text", value: "ok" }).success).toBe(false);
    expect(participantSaveResponseInput.safeParse({ ...ids, type: "number", value: "3" }).success).toBe(false);
  });
});
```

Run `npm test` → FAIL, implement (the schema file above IS the implementation), run → PASS.

- [ ] **Step 2: `src/features/participants/actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateParticipantToken, buildParticipantUrl } from "@/lib/tokens";
import {
  createParticipantInput,
  assignUnitInput,
  issueLinkInput,
  revokeLinkInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[participants] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createParticipant(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = createParticipantInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const orgId = await currentOrgId();
  if (!orgId) return fail("createParticipant", "no org");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("participants")
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return fail("createParticipant", error);
  revalidatePath("/programs");
  return { ok: true, id: data.id };
}

export async function assignUnit(input: unknown): Promise<ActionState> {
  const parsed = assignUnitInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .update({ assigned_participant_id: parsed.data.participantId })
    .eq("id", parsed.data.unitId)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("assignUnit", error ?? "unit not visible");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}

export async function issueLink(
  input: unknown,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = issueLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Parent lookup doubles as tenancy + org source (RLS hides foreign rows);
  // the DB guard trigger re-validates the whole scope tuple.
  const { data: program } = await supabase
    .from("programs")
    .select("id, org_id")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (!program) return fail("issueLink", "program not visible");

  const { data: me } = await supabase.auth.getUser();
  if (!me.user) return fail("issueLink", "no user");

  const { token, tokenHash } = generateParticipantToken();
  const expiresAt = new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString();
  const { error } = await supabase.from("access_tokens").insert({
    org_id: program.org_id,
    token_hash: tokenHash,
    kind: "participant",
    participant_id: parsed.data.participantId,
    program_id: program.id,
    unit_id: parsed.data.unitId ?? null,
    expires_at: expiresAt,
    created_by: me.user.id,
  });
  if (error) return fail("issueLink", error);
  revalidatePath(`/programs/${program.id}`);
  // The raw token exists ONLY in this return value — shown once, never stored.
  return { ok: true, url: buildParticipantUrl(token) };
}

export async function revokeLink(input: unknown): Promise<ActionState> {
  const parsed = revokeLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .select("program_id")
    .maybeSingle();
  if (error || !data) return fail("revokeLink", error ?? "link not visible");
  revalidatePath(`/programs/${data.program_id}`);
  return { ok: true };
}
```

- [ ] **Step 3: `src/features/participants/queries.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";

export type ParticipantListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

export type ProgramLink = {
  id: string;
  participantId: string;
  participantName: string;
  unitId: string | null;
  unitName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "expired" | "revoked";
};

// RLS scopes both reads to the caller's orgs.
export async function listParticipants(): Promise<ParticipantListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("participants")
    .select("id, name, email, phone")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listProgramLinks(programId: string): Promise<ProgramLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_tokens")
    .select(
      "id, participant_id, unit_id, created_at, expires_at, revoked_at, last_used_at, participants(name), units(name)",
    )
    .eq("program_id", programId)
    .eq("kind", "participant")
    .order("created_at", { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    participant_id: string;
    unit_id: string | null;
    created_at: string;
    expires_at: string;
    revoked_at: string | null;
    last_used_at: string | null;
    participants: { name: string } | null;
    units: { name: string } | null;
  };
  const now = Date.now();
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    participantId: r.participant_id,
    participantName: r.participants?.name ?? "—",
    unitId: r.unit_id,
    unitName: r.units?.name ?? null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
    status: r.revoked_at ? "revoked" : Date.parse(r.expires_at) < now ? "expired" : "active",
  }));
}
```

- [ ] **Step 4: `getProgram` exposes assignment**

In `src/features/programs/queries.ts`: `Unit` type gains `assignedParticipantId: string | null`; the `getProgram` units embed adds `assigned_participant_id`, and the unit mapping carries it through (`assignedParticipantId: u.assigned_participant_id`). Update the embedded row type accordingly.

- [ ] **Step 5: Verify + commit**

```bash
npm run verify
git add src/features/participants src/features/programs/queries.ts
git commit -m "feat(participants): console schemas, actions, queries; assignment exposed on getProgram

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Console UI — Assign control + Links panel

**Files:**
- Create: `src/features/participants/components/assign-participant.tsx`, `src/features/participants/components/links-panel.tsx`
- Modify: `src/features/programs/components/unit-row.tsx`, `unit-list.tsx`
- Modify: `src/app/(dashboard)/programs/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 5 actions/queries; `Unit.assignedParticipantId`.
- Produces: `<AssignParticipant unitId participants value onCreated />` (compact select + inline create); `<LinksPanel programId participants links />`.

- [ ] **Step 1: `assign-participant.tsx`**

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { assignUnit, createParticipant } from "@/features/participants/actions";
import type { ParticipantListItem } from "@/features/participants/queries";

const NEW_SENTINEL = "__new__";

// Compact per-row control. Optimistic value; server truth reconciles via
// revalidatePath. Inline "New…" prompts for a name (window.prompt keeps v1
// minimal — no dialog dependency in the hot row path).
export function AssignParticipant({
  unitId,
  unitName,
  participants,
  value,
}: {
  unitId: string;
  unitName: string;
  participants: ParticipantListItem[];
  value: string | null;
}) {
  const [optimistic, setOptimistic] = React.useState(value);
  const [, startTransition] = React.useTransition();

  const onChange = (next: string) => {
    if (next === NEW_SENTINEL) {
      const name = window.prompt("New participant name")?.trim();
      if (!name) return;
      startTransition(async () => {
        const created = await createParticipant({ name });
        if (!created.ok) {
          toast.error(created.error);
          return;
        }
        setOptimistic(created.id);
        const assigned = await assignUnit({ unitId, participantId: created.id });
        if (!assigned.ok) toast.error(assigned.error);
      });
      return;
    }
    const participantId = next === "" ? null : next;
    setOptimistic(participantId);
    startTransition(async () => {
      const result = await assignUnit({ unitId, participantId });
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });
  };

  return (
    <select
      value={optimistic ?? ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Assign participant for ${unitName}`}
      className="border-input text-muted-foreground h-7 max-w-36 shrink-0 truncate rounded-md border bg-transparent px-1.5 text-xs"
    >
      <option value="">Unassigned</option>
      {participants.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
      <option value={NEW_SENTINEL}>+ New participant…</option>
    </select>
  );
}
```

- [ ] **Step 2: `links-panel.tsx`**

```tsx
"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Link2Off } from "lucide-react";
import { issueLink, revokeLink } from "@/features/participants/actions";
import type { ParticipantListItem, ProgramLink } from "@/features/participants/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Issue + list + revoke. The raw URL exists only in issueLink's return
// value — rendered once here, never fetchable again.
export function LinksPanel({
  programId,
  participants,
  links,
}: {
  programId: string;
  participants: ParticipantListItem[];
  links: ProgramLink[];
}) {
  const [participantId, setParticipantId] = React.useState("");
  const [freshUrl, setFreshUrl] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  const issue = () => {
    if (!participantId) return;
    startTransition(async () => {
      const result = await issueLink({ participantId, programId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFreshUrl(result.url);
    });
  };

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  const revoke = (id: string) =>
    startTransition(async () => {
      const result = await revokeLink({ id });
      if (!result.ok) toast.error(result.error ?? "Couldn't revoke. Try again.");
    });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">Participant links</h2>
      <div className="flex items-center gap-2">
        <select
          value={participantId}
          onChange={(e) => setParticipantId(e.target.value)}
          aria-label="Participant to issue a link for"
          className="border-input h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="">Choose participant…</option>
          {participants.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={!participantId || isPending} onClick={issue}>
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
              <span className="truncate">{l.participantName}</span>
              <span className="text-muted-foreground truncate">
                {l.unitName ? `· ${l.unitName}` : "· whole program"}
              </span>
              <Badge
                variant={l.status === "active" ? "secondary" : "outline"}
                className="ml-auto shrink-0 text-[10px]"
              >
                {l.status}
              </Badge>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                exp {new Date(l.expiresAt).toLocaleDateString()}
              </span>
              {l.lastUsedAt ? (
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  used {new Date(l.lastUsedAt).toLocaleDateString()}
                </span>
              ) : null}
              {l.status === "active" ? (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Revoke link for ${l.participantName}`}
                  onClick={() => revoke(l.id)}
                >
                  <Link2Off className="size-3" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No links yet — issue one to a participant.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the program page and unit rows**

`src/app/(dashboard)/programs/[id]/page.tsx`: also fetch `listParticipants()` and `listProgramLinks(id)` (parallel with `getProgram`), pass `participants` into `UnitList`, and render `<LinksPanel programId={program.id} participants={participants} links={links} />` after the unit list.

`unit-list.tsx`: accept `participants: ParticipantListItem[]`, pass to each `UnitRow`.

`unit-row.tsx`: render `<AssignParticipant unitId={unit.id} unitName={unit.name} participants={participants} value={unit.assignedParticipantId} />` between the stage dots count and the externalRef span.

- [ ] **Step 4: Verify + commit**

```bash
npm run verify && npm run build
git add src/features "src/app/(dashboard)"
git commit -m "feat(participants): assign control on unit rows + links panel on the program page

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The /p flow — pages, sections, flow actions

**Files:**
- Create: `src/features/programs/components/requirement-field.tsx` (extract), Modify: `unit-stage-sections.tsx` (import it)
- Create: `src/features/participants/flow-actions.ts`
- Create: `src/features/participants/components/participant-stage-sections.tsx`
- Create: `src/app/p/layout.tsx`, `src/app/p/[token]/page.tsx`, `src/app/p/[token]/units/[unitId]/page.tsx`

**Interfaces:**
- Consumes: Task 4 resolver/readers; Task 5 flow inputs; Task 2 RPCs.
- Produces: server actions `submitResponse(input) → ActionState`, `clearResponse(input) → ActionState` (token-authenticated); the participant pages.

- [ ] **Step 1: Extract `RequirementField`**

Move the `RequirementField` function from `unit-stage-sections.tsx` into a new `src/features/programs/components/requirement-field.tsx` (same props: `{ requirement, onSave, onClear }`, same body, plus `"use client"` and its own imports: React, `Trash2`, `SectionRequirement` type, `Button`, `Input`). Export it; `unit-stage-sections.tsx` imports it and deletes its local copy. Zero behavior change — `npm run verify` proves it.

- [ ] **Step 2: `flow-actions.ts`**

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import {
  participantSaveResponseInput,
  participantClearResponseInput,
  GENERIC_WRITE_ERROR,
  type ActionState,
} from "./schema";

// Participant writes ride the anon-callable RPCs — the token is the
// credential and SQL is the authority. Failures are uniform: no message
// distinguishes "bad token" from "out of scope" (the 404 discipline).
// NEVER log the token.
export async function submitResponse(input: unknown): Promise<ActionState> {
  const parsed = participantSaveResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("submit_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
    p_value_text: d.type === "text" || d.type === "choice" ? d.value : null,
    p_value_number: d.type === "number" ? d.value : null,
    p_value_bool: d.type === "boolean" ? d.value : null,
    p_value_date: d.type === "date" ? d.value : null,
  });
  if (error) {
    console.error("[participants] submitResponse:", error.code ?? "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}

export async function clearResponse(input: unknown): Promise<ActionState> {
  const parsed = participantClearResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("clear_participant_response", {
    p_token: d.token,
    p_unit_id: d.unitId,
    p_requirement_id: d.requirementId,
  });
  if (error) {
    console.error("[participants] clearResponse:", error.code ?? "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  revalidatePath(`/p/${d.token}`);
  revalidatePath(`/p/${d.token}/units/${d.unitId}`);
  return { ok: true };
}
```

- [ ] **Step 3: `participant-stage-sections.tsx`**

```tsx
"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { submitResponse, clearResponse } from "@/features/participants/flow-actions";
import { RequirementField } from "@/features/programs/components/requirement-field";
import type { SectionRequirement, StageSection } from "@/features/programs/queries";
import { Badge } from "@/components/ui/badge";

// The participant twin of unit-stage-sections: same optimistic derive
// mirror, NO override control (staff-only — it's the audit line between
// 'requirements' and 'override'). Done stages collapse to a summary line.
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required && r.type !== "photo");
  if (required.length === 0) return section;
  const satisfied = required.every((r) =>
    r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
  );
  return satisfied
    ? { ...section, status: "done", doneSource: "requirements" }
    : { ...section, status: "pending", doneSource: null };
}

function applyEvent(sections: StageSection[], event: SectionEvent): StageSection[] {
  return sections.map((s) => {
    if (s.unitStageId !== event.unitStageId) return s;
    const value = event.type === "setValue" ? event.value : null;
    return derive({
      ...s,
      requirements: s.requirements.map((r) =>
        r.id === event.requirementId ? { ...r, value } : r,
      ),
    });
  });
}

export function ParticipantStageSections({
  token,
  unitId,
  sections,
}: {
  token: string;
  unitId: string;
  sections: StageSection[];
}) {
  const [optimistic, dispatch] = useOptimistic(sections, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: SectionEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  return (
    <div className="flex flex-col gap-4">
      {optimistic.map((s) => {
        const required = s.requirements.filter((r) => r.required && r.type !== "photo");
        const satisfied = required.filter((r) =>
          r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
        ).length;
        if (s.status === "done") {
          return (
            <section key={s.unitStageId} className="flex items-center gap-2 rounded-lg border px-4 py-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              <Badge variant="secondary" className="ml-auto text-[10px]">done</Badge>
            </section>
          );
        }
        return (
          <section key={s.unitStageId} className="flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              {required.length > 0 ? (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {satisfied}/{required.length}
                </Badge>
              ) : null}
            </div>
            {s.requirements.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing to fill in here.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {s.requirements.map((r: SectionRequirement) => (
                  <RequirementField
                    key={`${r.id}:${String(r.value)}`}
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
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: The pages**

`src/app/p/layout.tsx`:

```tsx
// Bare mobile-first chrome: no dashboard shell, no nav — the link is the
// only way in and the only identity.
export default function ParticipantLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">{children}</div>;
}
```

`src/app/p/[token]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { resolveParticipantToken, getParticipantUnits } from "@/lib/tokens";
import { Badge } from "@/components/ui/badge";

export default async function ParticipantEntryPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  const h = await headers();
  const clientKey = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "server";
  const resolved = await resolveParticipantToken(token, clientKey);

  if (resolved.status === "not_found") notFound();
  if (resolved.status === "expired" || resolved.status === "revoked") {
    return (
      <main className="flex flex-col gap-2 pt-16 text-center">
        <h1 className="text-lg font-semibold">This link has {resolved.status === "revoked" ? "been revoked" : "expired"}</h1>
        <p className="text-muted-foreground text-sm">
          Ask {resolved.orgName} to send you a new one.
        </p>
      </main>
    );
  }

  const { scope } = resolved;
  if (scope.unitId) redirect(`/p/${token}/units/${scope.unitId}`);

  const units = await getParticipantUnits(scope);
  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <p className="text-muted-foreground text-xs">{scope.orgName} · {scope.programName}</p>
        <h1 className="text-lg font-semibold">Hi {scope.participantName}</h1>
      </header>
      {units.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing assigned to you right now.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {units.map((u) => (
            <li key={u.id}>
              <Link
                href={`/p/${token}/units/${u.id}`}
                className="flex items-center gap-2 rounded-lg border p-3"
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{u.name}</span>
                  {u.externalRef ? (
                    <span className="text-muted-foreground font-mono text-xs">{u.externalRef}</span>
                  ) : null}
                </span>
                <Badge variant={u.outstanding === 0 ? "secondary" : "outline"} className="ml-auto text-[10px]">
                  {u.outstanding === 0 ? "all done" : `${u.outstanding} of ${u.total} open`}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`src/app/p/[token]/units/[unitId]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { resolveParticipantToken, getParticipantUnitDetail } from "@/lib/tokens";
import { ParticipantStageSections } from "@/features/participants/components/participant-stage-sections";

export default async function ParticipantUnitPage({
  params,
}: PageProps<"/p/[token]/units/[unitId]">) {
  const { token, unitId } = await params;
  if (!z.uuid().safeParse(unitId).success) notFound();

  const h = await headers();
  const clientKey = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "server";
  const resolved = await resolveParticipantToken(token, clientKey);
  // Expired/revoked mid-flow: bounce to the entry page, which renders the
  // renewal message. Unknown: 404.
  if (resolved.status === "not_found") notFound();
  if (resolved.status !== "ok") {
    return (
      <main className="pt-16 text-center">
        <Link href={`/p/${token}`} className="text-sm underline">This link is no longer active</Link>
      </main>
    );
  }

  const unit = await getParticipantUnitDetail(resolved.scope, unitId);
  if (!unit) notFound(); // out of scope reads as nonexistent

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        {resolved.scope.unitId === null ? (
          <Link href={`/p/${token}`} className="text-muted-foreground w-fit text-xs hover:underline">
            ← All units
          </Link>
        ) : (
          <p className="text-muted-foreground text-xs">
            {resolved.scope.orgName} · {resolved.scope.programName}
          </p>
        )}
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
      </header>
      <ParticipantStageSections token={token} unitId={unit.id} sections={unit.stages} />
    </main>
  );
}
```

- [ ] **Step 5: Verify + commit**

```bash
npm run verify && npm run build
git add src/features src/app/p
git commit -m "feat(participants): /p/[token] mobile flow — unit list, fill-in, renewal states

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Seed + full gates

**Files:**
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Seed a demo participant, assignment, and link**

After the `DEMO_PROGRESS` constant add `const DEMO_PARTICIPANT = "Alex Kowalski";`. Add a new step function after `ensureDemoProgress` and call it from `main()` last:

```typescript
async function ensureDemoParticipant(client: SupabaseClient, orgId: string): Promise<void> {
  const { data: program } = await client
    .from("programs").select("id").eq("org_id", orgId).eq("name", DEMO_PROGRAM).maybeSingle();
  if (!program) throw new Error(`seed: program "${DEMO_PROGRAM}" not found`);

  let { data: participant } = await client
    .from("participants").select("id").eq("org_id", orgId).eq("name", DEMO_PARTICIPANT).maybeSingle();
  if (!participant) {
    const { data: created, error } = await client
      .from("participants")
      .insert({ org_id: orgId, name: DEMO_PARTICIPANT, email: "alex@rolloutos.local" })
      .select("id").single();
    if (error) throw error;
    participant = created;
    console.log(`seed: created participant "${DEMO_PARTICIPANT}"`);
  }

  const { error: assignError } = await client
    .from("units")
    .update({ assigned_participant_id: participant!.id })
    .eq("program_id", program.id);
  if (assignError) throw assignError;

  const { data: existing } = await client
    .from("access_tokens")
    .select("id")
    .eq("participant_id", participant!.id)
    .eq("program_id", program.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if ((existing ?? []).length > 0) {
    console.log("seed: an active participant link already exists (revoke it to re-issue)");
    return;
  }

  const { token, tokenHash } = generateParticipantToken();
  const { data: me } = await client.auth.getUser();
  const { error: mintError } = await client.from("access_tokens").insert({
    org_id: orgId,
    token_hash: tokenHash,
    kind: "participant",
    participant_id: participant!.id,
    program_id: program.id,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    created_by: me!.user!.id,
  });
  if (mintError) throw mintError;
  console.log(`seed: participant link (shown once) → http://localhost:3000/p/${token}`);
}
```

Import at the top: `import { generateParticipantToken } from "../src/lib/tokens/mint";`.

- [ ] **Step 2: The gate battery**

```bash
npm run db:reset
npm run verify
npm run test:integration
npm run build
npm run db:generate
```

Expected: all green; seed prints the participant lines including the one-time link; "No schema changes".

- [ ] **Step 3: graphify + commit**

```bash
graphify update .
git add scripts/seed.ts
git commit -m "feat(seed): demo participant, assignments, and a printed one-time link

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: PR + CI

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/participant-links
gh pr create --title "feat: participants + /p/[token] — slice 7 (scoped links, no-login flow)" --body "## Summary
- External participants open a **hashed, scoped link** on their phone and fill in outstanding requirements — no account. Unit list → mobile fill-in; done stages collapse; no override control (staff-only).
- **The DB trusts the token, not the caller:** anon-callable SECURITY DEFINER RPCs (\`resolve_participant_token\` = the sole validity authority; \`submit\`/\`clear_participant_response\`) validate hash/expiry/revocation/LIVE assignment in SQL. 256-bit entropy is the security boundary; the TS rate limiter is DoS hygiene.
- **Guard triggers** close the cross-org mint hole on \`access_tokens\` and the cross-org assignment hole on \`units.assigned_participant_id\`.
- **Attribution symmetry:** \`answered_by_participant_id\` set only inside the RPCs; staff writes claim \`answered_by_user_id\` and null the participant (and vice versa).
- Console: assign-participant control on unit rows + links panel (issue shown-once URL, list, revoke) on the program page.
- \`lib/tokens\` chokepoint (mint/resolve/scoped reads), \`Referrer-Policy: no-referrer\` + noindex on \`/p\` and \`/portal\`.
- Spec + plan ship in this PR.

## Test plan
- [x] Integration (the security suite): resolve ok/expired/revoked/unknown; cross-org mint + assignment rejected; **core scope test** (token cannot touch out-of-scope units, both token shapes); reassignment kills scope; revoked mid-session; attribution flips both ways; authenticated cannot execute write RPCs; staff cannot set participant attribution; anon has zero table access; last_used_at
- [x] Unit: mint/hash (sha256 vector pinned to SQL's digest), rate-limiter window math, console + flow Zod schemas
- [x] \`npm run verify\` + \`npm run build\` + \`npm run db:reset\` from empty (drift clean); seed prints a working one-time demo link

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Watch CI**

```bash
gh pr checks --watch
```

Expected: all green. `db` job failure → suspect a missing GRANT or the pgcrypto schema qualification (`extensions.digest`).

---

## Self-review notes (checked against the spec)

- **Spec coverage:** data model → T1; guard trigger, sole validator, RPCs, attribution symmetry, RLS/grants → T2; entropy/rate-limit/no-log/headers → T3/T4; console scope choice → T5/T6; flow pages + renewal + 404 discipline → T7; seed/demo → T8. Spec's testing list maps onto T2's suite plus T3/T5 unit tests.
- **Spec amendment carried consistently:** `p_unit_id` appears in the RPC signatures (T2 SQL), the integration tests (T2), the flow inputs (T5 `participantSaveResponseInput`), and the flow actions (T7).
- **Type consistency:** `TokenScope`/`ResolveResult` (T4) consumed by T7 pages; `StageSection` reused from programs/queries in both T4 readers and T7 sections; `ParticipantListItem`/`ProgramLink` (T5) consumed by T6; `generateParticipantToken` (T3) consumed by T5 `issueLink` and T8 seed.
- **Known deliberate choices:** `window.prompt` for inline participant creation (v1 minimal; a dialog is post-v1 polish); `revalidatePath` on `/p/...` token paths is per-URL (fine — each token has its own path); the flow shows all requirements of pending stages (answered ones stay editable) per the approved design reading of "outstanding".
