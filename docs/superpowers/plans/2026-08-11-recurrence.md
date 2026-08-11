# Recurrence (Slice 11) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A completed unit re-enters the pipeline when its certificate nears expiry — the stage re-arms (old answers archived), a chase starts automatically, and a lapsed unit shows red in console and portal.

**Architecture:** Expiry-driven. A `date` requirement with `recur_lead_days` set is the driver. A recur phase runs first inside the existing `POST /api/chase/drain` tick: a `service_role`-only RPC (`recur_due`) scans live date responses on done stages; a definer RPC (`recur_rearm`) atomically archives the round to a new `unit_stage_response_archive` table, deletes the live responses, flips the stage to pending, and stamps `unit_stages.due_at`; the drain then inserts a chase (`created_by` null = automatic) which the chase phase emails in the same tick. Due/lapsed states are *derived* from `due_at` at read time — no stored status.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres RLS + definer RPCs), Drizzle migrations, Zod, Vitest (unit + integration against the local stack). **No new dependencies, no new env vars.**

**Spec:** `docs/superpowers/specs/2026-08-11-recurrence-design.md` (read the Amendments section — it corrects four mechanisms).

## Global Constraints

- Grants convention: every new table needs explicit GRANTs; `service_role` holds **no** direct update grants on `unit_stages`/`unit_stage_responses` — all recur writes go through `security definer` RPCs granted to `service_role` only (spec §security; commit `9254bc4` lesson).
- Custom SQL (CHECKs, RLS, grants, triggers, RPCs) lives in ONE reviewable migration file, the 0011/0020 idiom. Schema columns/tables go through Drizzle codegen separately.
- Error discipline: client-facing actions return `GENERIC_WRITE_ERROR`; raw errors are logged server-side only. Tokens are never logged.
- The portal never carries a person's name; new portal fields are derived status only.
- Pure cores take injected `now` — no `Date.now()`/`new Date()` inside decision logic (cadence.ts discipline).
- All work on branch `feat/recurrence`. Verify commands: `npm run verify` (lint + typecheck + unit), `npm run test:integration` (needs local stack: `npm run setup`).
- `graphify update .` after each task's commit (repo convention).
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Pure recurrence core

**Files:**
- Create: `src/features/recurrence/core.ts`
- Test: `src/features/recurrence/core.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces (used by Tasks 4, 6, 7):
  - `rearmDue(valueDate: string, leadDays: number, now: Date): boolean`
  - `decideRearm(c: RearmCandidate, ctx: { now: Date }): RearmDecision` where `RearmCandidate = { unitStageId: string; valueDate: string; recurLeadDays: number }` and `RearmDecision = { kind: "rearm"; dueAt: Date } | { kind: "skip"; reason: "not_due" }`
  - `stageDueState(dueAt: string | null, status: "pending" | "done", now: Date): StageDueState` where `StageDueState = { kind: "none" } | { kind: "due"; dueAt: Date } | { kind: "lapsed"; days: number }`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/recurrence/core.test.ts
import { describe, it, expect } from "vitest";
import { rearmDue, decideRearm, stageDueState } from "./core";

// value_date is a calendar date (YYYY-MM-DD); the core parses it as UTC
// midnight. All fake clocks below are UTC instants.
const at = (iso: string) => new Date(iso);

describe("rearmDue", () => {
  it("is due exactly lead-days before expiry", () => {
    // expiry 2026-10-01, lead 30 → window opens 2026-09-01T00:00:00Z
    expect(rearmDue("2026-10-01", 30, at("2026-09-01T00:00:00Z"))).toBe(true);
  });
  it("is not due one ms before the window opens", () => {
    expect(rearmDue("2026-10-01", 30, at("2026-08-31T23:59:59.999Z"))).toBe(false);
  });
  it("stays due after the expiry has passed (lapse is still outstanding work)", () => {
    expect(rearmDue("2026-10-01", 30, at("2026-11-15T12:00:00Z"))).toBe(true);
  });
  it("handles a 1-day lead", () => {
    expect(rearmDue("2026-10-01", 1, at("2026-09-30T00:00:00Z"))).toBe(true);
    expect(rearmDue("2026-10-01", 1, at("2026-09-29T23:59:59Z"))).toBe(false);
  });
});

describe("decideRearm", () => {
  const candidate = { unitStageId: "us-1", valueDate: "2026-10-01", recurLeadDays: 30 };
  it("re-arms inside the window, dueAt = the certificate's expiry midnight UTC", () => {
    const d = decideRearm(candidate, { now: at("2026-09-15T08:00:00Z") });
    expect(d).toEqual({ kind: "rearm", dueAt: at("2026-10-01T00:00:00Z") });
  });
  it("skips outside the window", () => {
    const d = decideRearm(candidate, { now: at("2026-07-01T00:00:00Z") });
    expect(d).toEqual({ kind: "skip", reason: "not_due" });
  });
});

describe("stageDueState", () => {
  it("none when never re-armed (due_at null)", () => {
    expect(stageDueState(null, "pending", at("2026-10-01T00:00:00Z"))).toEqual({ kind: "none" });
  });
  it("none when the stage is done again (due_at may still be set)", () => {
    expect(stageDueState("2026-10-01T00:00:00Z", "done", at("2026-11-01T00:00:00Z"))).toEqual({ kind: "none" });
  });
  it("due before the expiry passes", () => {
    const s = stageDueState("2026-10-01T00:00:00Z", "pending", at("2026-09-20T00:00:00Z"));
    expect(s).toEqual({ kind: "due", dueAt: at("2026-10-01T00:00:00Z") });
  });
  it("lapsed with whole days elapsed after the expiry", () => {
    const s = stageDueState("2026-10-01T00:00:00Z", "pending", at("2026-10-04T12:00:00Z"));
    expect(s).toEqual({ kind: "lapsed", days: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/recurrence/core.test.ts`
Expected: FAIL — `Cannot find module './core'`

- [ ] **Step 3: Write the implementation**

```ts
// src/features/recurrence/core.ts
// The recurrence decisions, whole and pure (the cadence.ts discipline): no
// IO, no clock reads — callers inject `now`. value_date is a calendar date
// (YYYY-MM-DD); the core treats it as UTC midnight, matching how the
// migration stamps unit_stages.due_at (value_date::timestamptz on a UTC DB).

const DAY_MS = 86_400_000;

export type RearmCandidate = {
  unitStageId: string;
  valueDate: string; // 'YYYY-MM-DD' from unit_stage_responses.value_date
  recurLeadDays: number;
};

export function rearmDue(valueDate: string, leadDays: number, now: Date): boolean {
  const expiry = Date.parse(`${valueDate}T00:00:00Z`);
  return now.getTime() >= expiry - leadDays * DAY_MS;
}

export type RearmDecision =
  | { kind: "rearm"; dueAt: Date }
  | { kind: "skip"; reason: "not_due" };

export function decideRearm(c: RearmCandidate, ctx: { now: Date }): RearmDecision {
  if (!rearmDue(c.valueDate, c.recurLeadDays, ctx.now)) return { kind: "skip", reason: "not_due" };
  return { kind: "rearm", dueAt: new Date(`${c.valueDate}T00:00:00Z`) };
}

// Console/portal badge derivation from unit_stages.due_at. due_at is only
// ever stamped by recur_rearm; a stage that is done again shows nothing —
// lapse is a property of OUTSTANDING renewal work, not of history.
export type StageDueState =
  | { kind: "none" }
  | { kind: "due"; dueAt: Date }
  | { kind: "lapsed"; days: number };

export function stageDueState(
  dueAt: string | null,
  status: "pending" | "done",
  now: Date,
): StageDueState {
  if (!dueAt || status === "done") return { kind: "none" };
  const due = Date.parse(dueAt);
  if (now.getTime() < due) return { kind: "due", dueAt: new Date(due) };
  return { kind: "lapsed", days: Math.floor((now.getTime() - due) / DAY_MS) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/recurrence/core.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/recurrence/core.ts src/features/recurrence/core.test.ts
git commit -m "feat: pure recurrence core — rearmDue, decideRearm, stageDueState (slice 11)"
```

---

### Task 2: Schema columns + archive table (Drizzle → generated migration 0021)

**Files:**
- Modify: `src/db/schema/templates.ts` (templateStageRequirements)
- Modify: `src/db/schema/programs.ts` (programStageRequirements, unitStages, new table)
- Modify: `src/db/schema/chases.ts` (createdBy nullable)
- Modify: `src/db/schema/participants.ts` (accessTokens.createdBy nullable)
- Create (generated): `src/db/migrations/0021_*.sql` + meta snapshot

**Interfaces:**
- Produces (used by Tasks 3–7): columns `template_stage_requirements.recur_lead_days` (int null), `program_stage_requirements.recur_lead_days` (int null), `unit_stages.due_at` (timestamptz null), nullable `chases.created_by` and `access_tokens.created_by`, and table `unit_stage_response_archive` (exact columns below).

- [ ] **Step 1: Add `recurLeadDays` to `templateStageRequirements`** in `src/db/schema/templates.ts`, after the `config` column:

```ts
    // Recurrence driver (slice 11): non-null on a date requirement means
    // "re-arm the stage this many days before value_date". CHECKs (positive;
    // date-only) live in 0022. Copied by create_program like every column.
    recurLeadDays: integer("recur_lead_days"),
```

- [ ] **Step 2: Mirror the column on `programStageRequirements`** in `src/db/schema/programs.ts`, after its `config` column — same code and comment, minus the "Copied by" sentence.

- [ ] **Step 3: Add `dueAt` to `unitStages`** in `src/db/schema/programs.ts`, after `doneAt`:

```ts
    // Stamped ONLY by recur_rearm (slice 11) with the superseded driver's
    // value_date. Due/lapsed are derived from it at read time — no stored
    // status. No client grant; the definer RPC is the single writer.
    dueAt: timestamp("due_at", { withTimezone: true }),
```

- [ ] **Step 4: Add the archive table** at the end of `src/db/schema/programs.ts`:

```ts
// Previous rounds' answers, moved here verbatim by recur_rearm (slice 11).
// A separate table — NOT a flag column — so the live table keeps its
// (unit_stage, requirement) uniqueness and every PostgREST upsert path.
// Rows are history: member select only; the definer RPC is the only writer.
// One superseded_at value = one archived round.
export const unitStageResponseArchive = pgTable(
  "unit_stage_response_archive",
  {
    id: uuid("id").primaryKey(), // the archived response's original id
    unitStageId: uuid("unit_stage_id")
      .notNull()
      .references(() => unitStages.id, { onDelete: "cascade" }),
    programStageRequirementId: uuid("program_stage_requirement_id")
      .notNull()
      .references(() => programStageRequirements.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    valueText: text("value_text"),
    valueNumber: numeric("value_number"),
    valueBool: boolean("value_bool"),
    valueDate: date("value_date"),
    answeredByUserId: uuid("answered_by_user_id"),
    answeredByParticipantId: uuid("answered_by_participant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("usr_archive_unit_stage_id_idx").on(t.unitStageId),
    index("usr_archive_unit_id_idx").on(t.unitId),
    index("usr_archive_org_id_idx").on(t.orgId),
  ],
);
```

- [ ] **Step 5: Make the two `createdBy` columns nullable.** In `src/db/schema/chases.ts` change `createdBy: uuid("created_by").notNull(),` to:

```ts
    // null = started by recurrence (slice 11); the console renders it as
    // "automatic". mint_chase_token copies this into access_tokens.
    createdBy: uuid("created_by"),
```

In `src/db/schema/participants.ts` (accessTokens) change `createdBy: uuid("created_by").notNull(),` to:

```ts
    // null = minted for an automatic (recurrence-started) chase.
    createdBy: uuid("created_by"),
```

- [ ] **Step 6: Generate and inspect the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0021_<name>.sql` containing exactly: two `ADD COLUMN "recur_lead_days" integer`, one `ADD COLUMN "due_at" timestamp with time zone`, two `ALTER COLUMN "created_by" DROP NOT NULL`, and the `CREATE TABLE "unit_stage_response_archive"` with its three indexes and five FKs. Nothing else. If drizzle emits unrelated churn, stop and investigate before applying.

- [ ] **Step 7: Apply and typecheck**

Run: `npm run db:migrate && npm run typecheck`
Expected: migration applies cleanly; typecheck passes (no code reads the new columns yet).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema src/db/migrations
git commit -m "feat: recurrence schema — recur_lead_days, due_at, response archive, nullable created_by (slice 11)"
```

---

### Task 3: Security migration 0022 + SQL-surface integration tests

**Files:**
- Create: `src/db/migrations/0022_recurrence_security.sql` (via `npx drizzle-kit generate --custom --name=recurrence_security`)
- Test: `src/features/recurrence/recurrence.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's columns/table.
- Produces (used by Task 4):
  - `recur_due(p_today date, p_limit int) returns table (unit_stage_id uuid, unit_id uuid, program_id uuid, org_id uuid, value_date date, recur_lead_days int, assigned_participant_id uuid, participant_email text)` — `service_role` execute only.
  - `recur_rearm(p_unit_stage_id uuid) returns boolean` — `service_role` execute only; true = claimed and re-armed, false = nothing to do / lost the race.
  - `create_program` now copies `recur_lead_days` into the snapshot.

- [ ] **Step 1: Write the failing integration test**

Follow the harness idiom of `src/features/chasing/drain.integration.test.ts` verbatim: `loadEnvFile(".env.local")` in try/catch, `admin` client from `SUPABASE_SERVICE_ROLE_KEY`, `signedInUser(tag)` helper, org via `create_org`, program via template + `create_program`. All assertions scoped to this file's own ids (other integration files share the stack).

```ts
// src/features/recurrence/recurrence.integration.test.ts
/**
 * Recurrence SQL surface (slice 11, task 3): CHECKs, snapshot copy, the
 * recur_due scan, recur_rearm atomicity, and archive RLS/grants — against
 * the local stack. Requires `npm run setup`.
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

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

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

const dateFromToday = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

describe("recurrence: SQL surface", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient; // foreign org
  let orgId: string;
  let templateStageId: string;
  let programId: string;
  let participantId: string;
  let unitId: string;
  let unitStageId: string; // the done stage carrying the near-expiry driver
  let requirementId: string; // program-side driver requirement

  beforeAll(async () => {
    alice = await signedInUser("recur_alice");
    bob = await signedInUser("recur_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "RecurOrg" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    await bob.rpc("create_org", { p_name: "RecurForeignOrg" });

    const { data: template } = await alice
      .from("templates").insert({ org_id: orgId, name: "Recur Template" }).select("id").single();
    const { data: stage } = await alice
      .from("template_stages")
      .insert({ template_id: template!.id, org_id: orgId, name: "Certify", position: 0 })
      .select("id").single();
    templateStageId = stage!.id;
    // THE driver: a required date requirement with a 30-day lead.
    await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "date", label: "Certificate expiry", required: true,
      config: {}, position: 0, recur_lead_days: 30,
    });

    const { data: program, error: e2 } = await alice.rpc("create_program", {
      p_template_id: template!.id, p_name: "Recur Program",
    });
    if (e2) throw e2;
    programId = (program as { id: string }).id;

    const { data: req } = await alice
      .from("program_stage_requirements")
      .select("id, recur_lead_days").eq("program_id", programId).single();
    requirementId = req!.id;

    const { data: participant } = await alice
      .from("participants")
      .insert({ org_id: orgId, name: "Dana", email: `dana_${Date.now()}@example.com` })
      .select("id").single();
    participantId = participant!.id;

    const { data: unit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 1", assigned_participant_id: participantId })
      .select("id").single();
    unitId = unit!.id;

    const { data: us } = await alice
      .from("unit_stages").select("id").eq("unit_id", unitId).single();
    unitStageId = us!.id;

    // Expiry 10 days out with a 30-day lead → inside the window NOW; the
    // response insert also derives the stage to 'done'.
    const { error: e3 } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(10),
    });
    if (e3) throw e3;
    const { data: check } = await alice
      .from("unit_stages").select("status").eq("id", unitStageId).single();
    expect(check!.status).toBe("done");
  });

  it("CHECK rejects recur_lead_days on a non-date requirement", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "text", label: "Notes", required: false, config: {}, position: 1,
      recur_lead_days: 30,
    });
    expect(error).not.toBeNull();
  });

  it("CHECK rejects a non-positive lead", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: templateStageId, org_id: orgId,
      type: "date", label: "Bad lead", required: false, config: {}, position: 2,
      recur_lead_days: 0,
    });
    expect(error).not.toBeNull();
  });

  it("create_program copied recur_lead_days into the snapshot", async () => {
    const { data } = await alice
      .from("program_stage_requirements")
      .select("recur_lead_days").eq("id", requirementId).single();
    expect(data!.recur_lead_days).toBe(30);
  });

  it("recur_due surfaces the done stage inside its window, with scope + participant email", async () => {
    const { data, error } = await admin.rpc("recur_due", { p_today: today(), p_limit: 100 });
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>).find((r) => r.unit_stage_id === unitStageId);
    expect(row).toBeDefined();
    expect(row!.unit_id).toBe(unitId);
    expect(row!.org_id).toBe(orgId);
    expect(row!.recur_lead_days).toBe(30);
    expect(row!.assigned_participant_id).toBe(participantId);
    expect(typeof row!.participant_email).toBe("string");
  });

  it("recur_due ignores a stage whose window has not opened", async () => {
    // Second unit, expiry 60 days out (lead 30) → due only from day 30.
    const { data: unit2 } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 2" })
      .select("id").single();
    const { data: us2 } = await alice
      .from("unit_stages").select("id").eq("unit_id", unit2!.id).single();
    await alice.from("unit_stage_responses").insert({
      unit_stage_id: us2!.id,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(60),
    });
    const { data } = await admin.rpc("recur_due", { p_today: today(), p_limit: 100 });
    expect((data as Array<Record<string, unknown>>).some((r) => r.unit_stage_id === us2!.id)).toBe(false);
  });

  it("neither RPC is callable by authenticated or anon", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const client of [alice, anon]) {
      const { error: e1 } = await client.rpc("recur_due", { p_today: today(), p_limit: 1 });
      expect(e1).not.toBeNull();
      const { error: e2 } = await client.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
      expect(e2).not.toBeNull();
    }
  });

  it("recur_rearm archives the round, clears live rows, flips the stage, stamps due_at — atomically", async () => {
    const expiry = dateFromToday(10);
    const { data: claimed, error } = await admin.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
    expect(error).toBeNull();
    expect(claimed).toBe(true);

    const { data: us } = await admin
      .from("unit_stages").select("status, done_source, done_at, due_at").eq("id", unitStageId).single();
    expect(us!.status).toBe("pending");
    expect(us!.done_source).toBeNull();
    expect(us!.done_at).toBeNull();
    expect(us!.due_at).not.toBeNull();
    expect((us!.due_at as string).slice(0, 10)).toBe(expiry);

    const { data: live } = await admin
      .from("unit_stage_responses").select("id").eq("unit_stage_id", unitStageId);
    expect(live).toHaveLength(0);

    const { data: archived } = await admin
      .from("unit_stage_response_archive")
      .select("id, value_date, superseded_at").eq("unit_stage_id", unitStageId);
    expect(archived).toHaveLength(1);
    expect(archived![0].value_date).toBe(expiry);
    expect(archived![0].superseded_at).not.toBeNull();
  });

  it("recur_rearm returns false when there is nothing to re-arm (idempotent)", async () => {
    const { data: again } = await admin.rpc("recur_rearm", { p_unit_stage_id: unitStageId });
    expect(again).toBe(false);
  });

  it("a fresh response inserts cleanly after re-arm (upsert path unbroken) and re-derives done", async () => {
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId,
      value_date: dateFromToday(365),
    });
    expect(error).toBeNull();
    const { data: us } = await alice
      .from("unit_stages").select("status").eq("id", unitStageId).single();
    expect(us!.status).toBe("done");
  });

  it("archive: member reads own org, foreign org sees nothing, nobody client-writes", async () => {
    const { data: mine, error: e1 } = await alice
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageId);
    expect(e1).toBeNull();
    expect(mine!.length).toBeGreaterThan(0);

    const { data: foreign } = await bob
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageId);
    expect(foreign).toHaveLength(0);

    const { error: insErr } = await alice.from("unit_stage_response_archive").insert({
      id: crypto.randomUUID(), unit_stage_id: unitStageId,
      program_stage_requirement_id: requirementId, unit_id: unitId,
      program_id: programId, org_id: orgId, type: "date",
      value_date: today(), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), superseded_at: new Date().toISOString(),
    });
    expect(insErr).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/features/recurrence/recurrence.integration.test.ts`
Expected: FAIL — CHECK tests find no constraint (inserts succeed), `recur_due`/`recur_rearm` do not exist.

- [ ] **Step 3: Create the custom migration**

Run: `npx drizzle-kit generate --custom --name=recurrence_security`
Then fill `src/db/migrations/0022_recurrence_security.sql`:

```sql
-- Custom SQL migration file, put your code below! --

-- Recurrence security model (slice 11):
--   * recur_lead_days CHECKs on both requirement tables (positive, date-only).
--   * unit_stage_response_archive: history — member select ONLY; the definer
--     RPC below is the single writer. anon gets nothing (0013 sweep).
--   * recur_due / recur_rearm: security definer, service_role-execute-only —
--     service_role deliberately holds no direct update grants on unit_stages/
--     unit_stage_responses (the 9254bc4 lesson), so one narrow RPC per verb
--     beats opening column grants on two tables.
--   * create_program: recreated with recur_lead_days joining the snapshot copy.

-- ---------- CHECKs (kept with policies/grants, the 0008 pattern)
alter table public.template_stage_requirements
  add constraint template_stage_requirements_recur_lead_days_check
  check (recur_lead_days is null or (recur_lead_days > 0 and type = 'date'));
alter table public.program_stage_requirements
  add constraint program_stage_requirements_recur_lead_days_check
  check (recur_lead_days is null or (recur_lead_days > 0 and type = 'date'));

-- ---------- archive RLS + grants
alter table public.unit_stage_response_archive enable row level security;

create policy "unit_stage_response_archive_select_member" on public.unit_stage_response_archive
  for select to authenticated using (org_id in (select public.user_orgs()));
-- no insert/update/delete policies: history is written only by recur_rearm
-- (definer, owner postgres) and dies with its unit via FK cascade.

grant select on table public.unit_stage_response_archive to authenticated;
grant select on table public.unit_stage_response_archive to service_role;
revoke insert, update, delete, truncate on table public.unit_stage_response_archive
  from authenticated, service_role;

-- ---------- due-scan RPC. p_today injected so tests can time-travel; the
-- drain passes its own `now`. distinct on (us.id) + min expiry: a stage with
-- several drivers re-arms once, on the earliest date.
create or replace function public.recur_due(p_today date, p_limit int)
returns table (
  unit_stage_id uuid,
  unit_id uuid,
  program_id uuid,
  org_id uuid,
  value_date date,
  recur_lead_days int,
  assigned_participant_id uuid,
  participant_email text
)
language sql
security definer
set search_path = ''
as $$
  select distinct on (us.id)
         us.id, us.unit_id, us.program_id, us.org_id,
         r.value_date, q.recur_lead_days,
         u.assigned_participant_id, p.email
    from public.unit_stage_responses r
    join public.program_stage_requirements q
      on q.id = r.program_stage_requirement_id
     and q.recur_lead_days is not null
    join public.unit_stages us
      on us.id = r.unit_stage_id
     and us.status = 'done'
    join public.units u on u.id = us.unit_id
    left join public.participants p on p.id = u.assigned_participant_id
   where r.type = 'date'
     and r.value_date is not null
     and r.value_date - q.recur_lead_days <= p_today
   order by us.id, r.value_date asc
   limit p_limit;
$$;

revoke execute on function public.recur_due(date, int) from public, anon, authenticated;
grant execute on function public.recur_due(date, int) to service_role;

-- ---------- re-arm RPC: claim + archive + clear + stamp, atomically.
-- The status='done' guard is the claim: a concurrent tick matches zero rows
-- and returns false. Deleting the live rows fires 0015's derive trigger
-- (recomputes 'pending' — already set) and detaches evidence
-- (response_id → null): the previous round's photos survive as history,
-- the new round starts blank.
create or replace function public.recur_rearm(p_unit_stage_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due date;
begin
  -- Earliest driver expiry, computed BEFORE the delete removes the rows.
  select min(r.value_date) into v_due
    from public.unit_stage_responses r
    join public.program_stage_requirements q
      on q.id = r.program_stage_requirement_id
     and q.recur_lead_days is not null
   where r.unit_stage_id = p_unit_stage_id
     and r.type = 'date'
     and r.value_date is not null;
  if v_due is null then return false; end if;

  update public.unit_stages
     set status = 'pending', done_source = null, done_at = null,
         due_at = v_due::timestamptz
   where id = p_unit_stage_id and status = 'done';
  if not found then return false; end if;

  insert into public.unit_stage_response_archive
    (id, unit_stage_id, program_stage_requirement_id, unit_id, program_id,
     org_id, type, value_text, value_number, value_bool, value_date,
     answered_by_user_id, answered_by_participant_id, created_at,
     updated_at, superseded_at)
  select id, unit_stage_id, program_stage_requirement_id, unit_id,
         program_id, org_id, type, value_text, value_number, value_bool,
         value_date, answered_by_user_id, answered_by_participant_id,
         created_at, updated_at, now()
    from public.unit_stage_responses
   where unit_stage_id = p_unit_stage_id;

  delete from public.unit_stage_responses where unit_stage_id = p_unit_stage_id;
  return true;
end;
$$;

revoke execute on function public.recur_rearm(uuid) from public, anon, authenticated;
grant execute on function public.recur_rearm(uuid) to service_role;

-- ---------- create_program learns recur_lead_days
-- Recreated VERBATIM from 0011 with recur_lead_days added to the snapshot
-- copy (checklist-expanded booleans get null — they are never drivers).
create or replace function public.create_program(p_template_id uuid, p_name text)
returns public.programs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template public.templates;
  v_program public.programs;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_template from public.templates where id = p_template_id;
  if v_template.id is null
     or v_template.org_id not in (select public.user_orgs()) then
    raise exception 'template not found';
  end if;

  v_name := trim(p_name);
  if v_name is null or v_name = '' or char_length(v_name) > 80 then
    raise exception 'invalid name';
  end if;

  if not exists (select 1 from public.template_stages where template_id = v_template.id) then
    raise exception 'template has no stages';
  end if;

  insert into public.programs (org_id, template_id, name)
  values (v_template.org_id, v_template.id, v_name)
  returning * into v_program;

  with numbered as (
    select ts.id as template_stage_id, ts.name,
           row_number() over (order by ts.position, ts.id) - 1 as pos
      from public.template_stages ts
     where ts.template_id = v_template.id
  ), inserted as (
    insert into public.program_stages (program_id, org_id, name, position)
    select v_program.id, v_template.org_id, n.name, n.pos
      from numbered n
    returning id, position
  )
  insert into public.program_stage_requirements
    (program_stage_id, program_id, org_id, type, label, required, config, position, recur_lead_days)
  select i.id, v_program.id, v_template.org_id, e.type, e.label, e.required, e.config,
         row_number() over (partition by i.id order by e.src_pos, e.item_ord, e.src_id) - 1,
         e.recur_lead_days
    from numbered n
    join inserted i on i.position = n.pos
    join lateral (
      select r.id as src_id, r.position as src_pos, 0::bigint as item_ord,
             r.type, r.label, r.required, r.config, r.recur_lead_days
        from public.template_stage_requirements r
       where r.template_stage_id = n.template_stage_id and r.type <> 'checklist'
      union all
      select r.id, r.position, it.ord, 'boolean',
             r.label || ' · ' || it.item, r.required,
             jsonb_build_object('group', r.label), null::int
        from public.template_stage_requirements r
        cross join lateral jsonb_array_elements_text(r.config->'items')
                   with ordinality as it(item, ord)
       where r.template_stage_id = n.template_stage_id and r.type = 'checklist'
    ) e on true;

  return v_program;
end;
$$;
```

- [ ] **Step 4: Apply and run the tests**

Run: `npm run db:migrate && npm run test:integration -- src/features/recurrence/recurrence.integration.test.ts`
Expected: migration applies; all tests PASS.

- [ ] **Step 5: Run the full integration suite** (the create_program replacement touches every slice-6+ test)

Run: `npm run test:integration`
Expected: PASS across the board.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations src/features/recurrence/recurrence.integration.test.ts
git commit -m "feat: recurrence SQL surface — recur_due/recur_rearm RPCs, archive RLS, snapshot copy (slice 11)"
```

---

### Task 4: Drain recur phase + auto-chase

**Files:**
- Create: `src/features/recurrence/drain.ts`
- Modify: `src/features/chasing/drain.ts` (call the phase first; extend `DrainSummary`)
- Test: `src/features/recurrence/recur-drain.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's `decideRearm`; Task 3's RPCs; chasing's existing `runDrain(deps)` and `EmailTransport`.
- Produces: `runRecurPhase(db: SupabaseClient, now: Date): Promise<RecurSummary>` with `RecurSummary = { rearmed: number; chasesStarted: number; recurSkipped: number; recurFailed: number }`; `DrainSummary` becomes `{ sent; completed; skipped; failed } & RecurSummary` (route and script pass it through unchanged).

- [ ] **Step 1: Write the failing integration test**

Same harness as Task 3's test (copy the imports, `admin`, `signedInUser`, `dateFromToday` helpers, and the dynamic `const { runDrain } = await import("@/features/chasing/drain")` idiom from `drain.integration.test.ts` — the dynamic import keeps `@/env` evaluation after `loadEnvFile`). Include the `fakeTransport()` helper from that file verbatim.

Setup (beforeAll): org → template with one required date requirement, `recur_lead_days: 30` → program → participant **with email** → `unitA` assigned to the participant → response `value_date = dateFromToday(10)` (stage derives done). Also `unitB` with a second no-email participant assigned and the same near response, and `unitC` unassigned with the same near response.

```ts
describe("recurrence: drain phase end to end", () => {
  it("one tick: re-arms, starts an automatic chase, and sends email #0", async () => {
    const { sent, transport } = fakeTransport();
    const summary = await runDrain({ db: admin, transport });
    expect(summary.rearmed).toBeGreaterThanOrEqual(1);

    // Stage re-armed with due_at stamped.
    const { data: us } = await admin
      .from("unit_stages").select("status, due_at").eq("id", unitStageA).single();
    expect(us!.status).toBe("pending");
    expect(us!.due_at).not.toBeNull();

    // Round archived.
    const { data: archived } = await admin
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageA);
    expect(archived).toHaveLength(1);

    // Automatic chase for the exact scope, created_by null.
    const { data: chase } = await admin
      .from("chases")
      .select("id, created_by, sends_done")
      .eq("participant_id", participantA).eq("program_id", programId).eq("unit_id", unitA)
      .single();
    expect(chase!.created_by).toBeNull();
    // Same tick delivered send #0 (chase phase runs after the recur phase).
    expect(chase!.sends_done).toBe(1);
    expect(sent.some((m) => m.idempotencyKey === `chase/${chase!.id}/send/0`)).toBe(true);
  });

  it("no participant email / no assignment: re-arms without a chase, not an error", async () => {
    for (const [unit, stage] of [[unitB, unitStageB], [unitC, unitStageC]] as const) {
      const { data: us } = await admin
        .from("unit_stages").select("status, due_at").eq("id", stage).single();
      expect(us!.status).toBe("pending");
      expect(us!.due_at).not.toBeNull();
      const { data: chases } = await admin
        .from("chases").select("id").eq("unit_id", unit);
      expect(chases).toHaveLength(0);
    }
  });

  it("second tick: nothing new to re-arm, no duplicate chase", async () => {
    const { transport } = fakeTransport();
    await runDrain({ db: admin, transport });
    const { data: archived } = await admin
      .from("unit_stage_response_archive").select("id").eq("unit_stage_id", unitStageA);
    expect(archived).toHaveLength(1); // still one round
    const { data: chases } = await admin
      .from("chases").select("id").eq("unit_id", unitA);
    expect(chases).toHaveLength(1);
  });

  it("a done stage with a far-future expiry is untouched", async () => {
    const { data: us } = await admin
      .from("unit_stages").select("status, due_at").eq("id", unitStageFar).single();
    expect(us!.status).toBe("done");
    expect(us!.due_at).toBeNull();
  });
});
```

(`unitStageFar` = one more unit whose response is `dateFromToday(300)`. Capture all ids in `beforeAll`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- src/features/recurrence/recur-drain.integration.test.ts`
Expected: FAIL — `summary.rearmed` is undefined (no recur phase yet).

- [ ] **Step 3: Implement the phase**

```ts
// src/features/recurrence/drain.ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideRearm } from "./core";

export type RecurSummary = {
  rearmed: number;
  chasesStarted: number;
  recurSkipped: number;
  recurFailed: number;
};

const RECUR_BATCH_LIMIT = 25; // bounded tick; leftovers are still due next tick

type DueStage = {
  unit_stage_id: string;
  unit_id: string;
  program_id: string;
  org_id: string;
  value_date: string;
  recur_lead_days: number;
  assigned_participant_id: string | null;
  participant_email: string | null;
};

// Phase 1 of the drain tick: re-arm due stages, then start their chases so
// phase 2 (the chase due-scan) emails send #0 in the SAME tick.
export async function runRecurPhase(db: SupabaseClient, now: Date): Promise<RecurSummary> {
  const summary: RecurSummary = { rearmed: 0, chasesStarted: 0, recurSkipped: 0, recurFailed: 0 };
  const { data, error } = await db.rpc("recur_due", {
    p_today: now.toISOString().slice(0, 10),
    p_limit: RECUR_BATCH_LIMIT,
  });
  if (error) throw error;

  for (const row of (data ?? []) as DueStage[]) {
    try {
      // Pure gate: cheap, fake-clock-tested re-check of what SQL selected.
      const decision = decideRearm(
        { unitStageId: row.unit_stage_id, valueDate: row.value_date, recurLeadDays: row.recur_lead_days },
        { now },
      );
      if (decision.kind === "skip") {
        summary.recurSkipped++;
        continue;
      }

      const { data: claimed, error: rearmErr } = await db.rpc("recur_rearm", {
        p_unit_stage_id: row.unit_stage_id,
      });
      if (rearmErr) throw rearmErr;
      if (!claimed) {
        summary.recurSkipped++; // lost the race, or the stage moved meanwhile
        continue;
      }
      summary.rearmed++;

      // Auto-chase only when there is someone to email; otherwise the stage
      // just sits outstanding in the console — by design, not an error.
      if (!row.assigned_participant_id || !row.participant_email) continue;
      const { error: chaseErr } = await db.from("chases").insert({
        org_id: row.org_id,
        participant_id: row.assigned_participant_id,
        program_id: row.program_id,
        unit_id: row.unit_id,
        next_send_at: now.toISOString(),
        created_by: null, // null = automatic (recurrence)
      });
      if (chaseErr) {
        if (chaseErr.code === "23505") continue; // existing live chase for the scope wins
        throw chaseErr;
      }
      summary.chasesStarted++;
    } catch (rowErr) {
      // Per-stage isolation: one bad row never stops the batch (drain.ts idiom).
      console.error(
        "[recurrence] rearm failed:",
        row.unit_stage_id,
        rowErr instanceof Error ? rowErr.message : rowErr,
      );
      summary.recurFailed++;
    }
  }
  return summary;
}
```

- [ ] **Step 4: Wire it into the chase drain**

In `src/features/chasing/drain.ts`:

```ts
// imports gain:
import { runRecurPhase, type RecurSummary } from "@/features/recurrence/drain";

// the summary type becomes:
export type DrainSummary = {
  sent: number; completed: number; skipped: number; failed: number;
} & RecurSummary;
```

At the top of `runDrain`, immediately after `const now = deps.now ?? new Date();`, replace the summary initialization with:

```ts
  // Recur phase FIRST: a freshly re-armed unit's chase is inserted with
  // next_send_at = now, so the due-scan below emails send #0 this same tick.
  const recur = await runRecurPhase(db, now);
  const summary: DrainSummary = { ...recur, sent: 0, completed: 0, skipped: 0, failed: 0 };
```

`src/app/api/chase/drain/route.ts` and `scripts/chase-drain.ts` need no changes — they pass the summary through.

- [ ] **Step 5: Run the new test, then both drain suites**

Run: `npm run test:integration -- src/features/recurrence/recur-drain.integration.test.ts`
Expected: PASS.
Run: `npm run test:integration -- src/features/chasing/drain.integration.test.ts`
Expected: PASS (the recur phase is a no-op for orgs with no drivers — proves non-interference).

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS.

```bash
git add src/features/recurrence/drain.ts src/features/chasing/drain.ts src/features/recurrence/recur-drain.integration.test.ts
git commit -m "feat: drain recur phase — re-arm due stages, auto-start chases (slice 11)"
```

---

### Task 5: Requirement editor — "re-arm N days before" on date requirements

**Files:**
- Modify: `src/features/templates/schema.ts` (input schema)
- Modify: `src/features/templates/actions.ts` (`addRequirement` insert)
- Modify: `src/features/templates/queries.ts` (`Requirement` type + select)
- Modify: `src/features/templates/components/add-requirement.tsx` (lead input)
- Modify: `src/features/templates/components/requirement-list.tsx` (thread the field)
- Modify: `src/features/templates/components/requirement-row.tsx` (display)
- Test: `src/features/templates/schema.test.ts` (create — the chasing `schema.test.ts` precedent)

**Interfaces:**
- Consumes: Task 2's `recur_lead_days` column; Task 3's CHECK (DB backstop).
- Produces: `Requirement` gains `recurLeadDays: number | null`; `addRequirementInput` accepts optional `recurLeadDays` (date type only).

- [ ] **Step 1: Write the failing schema test**

```ts
// src/features/templates/schema.test.ts
import { describe, it, expect } from "vitest";
import { addRequirementInput } from "./schema";

const base = {
  templateStageId: "5b4b2c9a-9d3a-4d3e-8f6a-1a2b3c4d5e6f",
  label: "Certificate expiry",
  required: true,
};

describe("addRequirementInput recurLeadDays", () => {
  it("accepts a positive lead on a date requirement", () => {
    const r = addRequirementInput.safeParse({ ...base, type: "date", recurLeadDays: 30 });
    expect(r.success).toBe(true);
  });
  it("rejects a lead on a non-date requirement", () => {
    const r = addRequirementInput.safeParse({ ...base, type: "text", recurLeadDays: 30 });
    expect(r.success).toBe(false);
  });
  it("rejects zero, negative, and fractional leads", () => {
    for (const bad of [0, -5, 1.5]) {
      const r = addRequirementInput.safeParse({ ...base, type: "date", recurLeadDays: bad });
      expect(r.success).toBe(false);
    }
  });
  it("stays optional", () => {
    const r = addRequirementInput.safeParse({ ...base, type: "date" });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/templates/schema.test.ts`
Expected: FAIL — unknown key is stripped, so "rejects a lead on a non-date requirement" fails.

- [ ] **Step 3: Extend the zod schema.** In `src/features/templates/schema.ts`, inside `addRequirementInput`'s object add `recurLeadDays: z.number().int().min(1).max(3650).optional(),` after `items`, and in the `superRefine` add:

```ts
    if (v.recurLeadDays !== undefined && v.type !== "date")
      ctx.addIssue({ code: "custom", message: "recurLeadDays only valid for date" });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/templates/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread it through action, query, and components.**

`actions.ts` — in `addRequirement`'s insert object add:

```ts
    recur_lead_days: parsed.data.recurLeadDays ?? null,
```

`queries.ts` — `Requirement` gains `recurLeadDays: number | null;`. In `getTemplate` add `recur_lead_days` to the embedded select string, and replace the `as Requirement[]` cast with an explicit map (the snake-case column needs renaming):

```ts
        requirements: [...s.template_stage_requirements]
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((r) => ({
            id: r.id,
            type: r.type as Requirement["type"],
            label: r.label,
            required: r.required,
            config: (r.config ?? {}) as Requirement["config"],
            position: r.position,
            recurLeadDays: r.recur_lead_days,
          })),
```

`add-requirement.tsx` — add state `const [leadDays, setLeadDays] = React.useState("");` and `const parsedLead = leadDays.trim() === "" ? undefined : Number(leadDays);` The `onAdd` prop type gains `recurLeadDays?: number`. In `submit`, pass `recurLeadDays: type === "date" ? parsedLead : undefined,` and reset `setLeadDays("")`. Below the type `<select>`, render when `type === "date"`:

```tsx
        {type === "date" ? (
          <Input
            type="number"
            min={1}
            value={leadDays}
            onChange={(e) => setLeadDays(e.target.value)}
            placeholder="re-arm days"
            aria-label="Re-arm this many days before the date (blank = never)"
            className="h-7 w-28 shrink-0 text-xs"
          />
        ) : null}
```

Guard validity: `const leadValid = type !== "date" || leadDays.trim() === "" || (Number.isInteger(parsedLead) && parsedLead! >= 1);` and fold into `valid`.

`requirement-list.tsx` — thread the new field: the `onAdd` destructure gains `recurLeadDays`; the optimistic `requirement` object gains `recurLeadDays: recurLeadDays ?? null,`; the action call gains `recurLeadDays`.

`requirement-row.tsx` — extend the `detail` derivation so a driver shows its cadence:

```ts
  const detail =
    requirement.type === "choice"
      ? (requirement.config.options ?? []).join(" / ")
      : requirement.type === "checklist"
        ? `${(requirement.config.items ?? []).length} items`
        : requirement.type === "date" && requirement.recurLeadDays !== null
          ? `re-arms ${requirement.recurLeadDays}d before`
          : null;
```

- [ ] **Step 6: Verify and commit**

Run: `npm run verify`
Expected: PASS (lint, typecheck — call sites all updated — unit tests).

```bash
git add src/features/templates
git commit -m "feat: recurrence lead-days input on date requirements (slice 11)"
```

---

### Task 6: Console unit page — due/lapsed badges, expiry line, previous rounds

**Files:**
- Modify: `src/features/programs/queries.ts` (`getUnit` + types)
- Modify: `src/features/programs/components/unit-stage-sections.tsx`

**Interfaces:**
- Consumes: Task 1's `stageDueState`; Task 2's `due_at` column + archive table; `SectionRequirement`/`StageSection` from `queries.ts`.
- Produces: `StageSection` gains `dueAt: string | null` and `previousRounds: PreviousRound[]`; `SectionRequirement` gains `recurLeadDays: number | null`; `PreviousRound = { supersededAt: string; items: { label: string; value: string }[] }`.

- [ ] **Step 1: Extend the read model.** In `src/features/programs/queries.ts`:

Add to the exported types:

```ts
export type PreviousRound = {
  supersededAt: string;
  items: { label: string; value: string }[];
};
```

`SectionRequirement` gains `recurLeadDays: number | null;`; `StageSection` gains `dueAt: string | null;` and `previousRounds: PreviousRound[];`.

In `getUnit`: the unit select string becomes `"id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_source, due_at)"`; the requirements select adds `recur_lead_days`; and the `Promise.all` gains a fifth query:

```ts
    supabase
      .from("unit_stage_response_archive")
      .select("unit_stage_id, program_stage_requirement_id, type, value_text, value_number, value_bool, value_date, superseded_at")
      .eq("unit_id", unitId),
```

(destructure as `{ data: archived, error: e5 }` and extend the error throw.) After `responseByReq`, group the archive per stage per round — reuse the existing `valueOf` shape for display strings:

```ts
  type ArchiveRow = NonNullable<typeof archived>[number];
  const displayValue = (r: ArchiveRow): string =>
    r.type === "boolean"
      ? r.value_bool ? "Yes" : "No"
      : r.type === "number"
        ? String(r.value_number ?? "—")
        : r.type === "photo"
          ? "photo"
          : String(r.value_date ?? r.value_text ?? "—");
  const reqLabel = new Map((reqs ?? []).map((r) => [r.id, r.label]));
  // stage → superseded_at → items. Rounds render newest first.
  const roundsByStage = new Map<string, Map<string, { label: string; value: string }[]>>();
  for (const a of archived ?? []) {
    const rounds = roundsByStage.get(a.unit_stage_id) ?? new Map();
    const items = rounds.get(a.superseded_at) ?? [];
    items.push({ label: reqLabel.get(a.program_stage_requirement_id) ?? "—", value: displayValue(a) });
    rounds.set(a.superseded_at, items);
    roundsByStage.set(a.unit_stage_id, rounds);
  }
```

In the returned `stages` mapping, each section gains:

```ts
          dueAt: (us as { due_at?: string | null }).due_at ?? null,
          previousRounds: [...(roundsByStage.get(us.id) ?? new Map())]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([supersededAt, items]) => ({ supersededAt, items })),
```

and each requirement gains `recurLeadDays: r.recur_lead_days,`.

- [ ] **Step 2: Render the states.** In `unit-stage-sections.tsx`:

Imports gain `import { stageDueState } from "@/features/recurrence/core";` and add the portal's date formatter near the top:

```ts
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));
```

Inside the section map, before the return, derive:

```ts
        const due = stageDueState(s.dueAt, s.status, new Date());
        const driver = s.requirements.find(
          (r) => r.type === "date" && r.recurLeadDays !== null && typeof r.value === "string",
        );
```

In the header row, after the existing status `<Badge>`, add:

```tsx
              {due.kind === "due" ? (
                <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600">
                  renewal due by {formatDate(s.dueAt!)}
                </Badge>
              ) : due.kind === "lapsed" ? (
                <Badge variant="outline" className="border-red-500 text-[10px] text-red-600">
                  lapsed {due.days}d
                </Badge>
              ) : s.status === "done" && driver ? (
                <span className="text-muted-foreground text-[10px]">
                  expires {formatDate(String(driver.value))}
                </span>
              ) : null}
```

At the bottom of the section (after the requirements block), add the read-only history:

```tsx
            {s.previousRounds.length > 0 ? (
              <details className="text-muted-foreground text-xs">
                <summary className="cursor-pointer select-none">
                  previous rounds ({s.previousRounds.length})
                </summary>
                <div className="mt-1.5 flex flex-col gap-2">
                  {s.previousRounds.map((round) => (
                    <div key={round.supersededAt} className="rounded-md border border-dashed p-2">
                      <p className="mb-1 text-[10px]">archived {formatDate(round.supersededAt)}</p>
                      <dl className="flex flex-col gap-0.5">
                        {round.items.map((item, i) => (
                          <div key={i} className="flex items-baseline justify-between gap-2">
                            <dt className="min-w-0 truncate">{item.label}</dt>
                            <dd className="shrink-0 font-medium">{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
```

- [ ] **Step 3: Verify**

Run: `npm run verify`
Expected: PASS. (`stageDueState` is pure and already unit-tested; this task is read-model plumbing + JSX, covered by typecheck and the Task 4 integration data path.)

- [ ] **Step 4: Commit**

```bash
git add src/features/programs
git commit -m "feat: console unit page — due/lapsed badges, expiry line, archived rounds (slice 11)"
```

---

### Task 7: Portal — due/lapsed markers

**Files:**
- Modify: `src/lib/tokens/portal.ts` (both readers + types)
- Modify: `src/app/portal/[token]/page.tsx` (home list marker)
- Modify: `src/app/portal/[token]/units/[unitId]/page.tsx` (stage badge)

**Interfaces:**
- Consumes: Task 1's `stageDueState`; Task 2's `due_at`.
- Produces: `PortalStage` gains `dueAt: string | null`; `PortalUnitSummary` gains `lapsed: boolean`. No name-bearing field is added — the portal type rule stands.

- [ ] **Step 1: Extend the readers.** In `src/lib/tokens/portal.ts`:

- `getPortalUnits`: unit select embed becomes `unit_stages(status, done_at, due_at)`; `PortalUnitSummary` gains `lapsed: boolean;`; in the summary construction add:

```ts
      lapsed: u.unit_stages.some(
        (s) => s.status !== "done" && s.due_at !== null && new Date(s.due_at) < new Date(),
      ),
```

- `getPortalUnitDetail`: unit select embed becomes `unit_stages(id, program_stage_id, status, done_at, due_at)`; `PortalStage` gains `dueAt: string | null;`; the stage mapping gains `dueAt: (us.due_at as string | null) ?? null,`.

- [ ] **Step 2: Home list marker.** In `src/app/portal/[token]/page.tsx`, before the existing progress `<Badge>` inside the unit row, add:

```tsx
                      {u.lapsed ? (
                        <Badge variant="outline" className="shrink-0 border-red-500 text-[10px] text-red-600">
                          lapsed
                        </Badge>
                      ) : null}
```

- [ ] **Step 3: Unit page stage badge.** In `src/app/portal/[token]/units/[unitId]/page.tsx`, import `stageDueState` from `@/features/recurrence/core` and replace the pending-branch badge (`awaiting`) with:

```tsx
              ) : (() => {
                const due = stageDueState(s.dueAt, s.status, new Date());
                return due.kind === "lapsed" ? (
                  <Badge variant="outline" className="ml-auto shrink-0 border-red-500 text-[10px] text-red-600">
                    lapsed
                  </Badge>
                ) : due.kind === "due" ? (
                  <Badge variant="outline" className="ml-auto shrink-0 border-amber-500 text-[10px] text-amber-600">
                    renewal due by {formatDate(s.dueAt!)}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                    awaiting
                  </Badge>
                );
              })()}
```

The portal rule is untouched: pending stages still render no items; the marker carries a date, never a person.

- [ ] **Step 4: Verify and commit**

Run: `npm run verify && npm run test:integration -- src/features/clients`
Expected: PASS (portal integration tests confirm no regression; the readers only added derived fields).

```bash
git add src/lib/tokens/portal.ts "src/app/portal"
git commit -m "feat: portal due/lapsed markers from unit_stages.due_at (slice 11)"
```

---

### Task 8: Full verification + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-recurrence-design.md` (only if implementation diverged — record it in Amendments)

- [ ] **Step 1: Full local gate**

Run: `npm run verify && npm run test:integration`
Expected: everything PASS. Fix anything red before proceeding (systematic-debugging, not patch-and-pray).

- [ ] **Step 2: The demo scene by hand** (evidence for the PR description)

Run: `npm run dev`, then: create a template with a date requirement (lead 30), create a program + unit, assign a participant with an email, fill the expiry date ~10 days out (stage flips done), run `npm run chase:drain`, and confirm: stage re-opened with the amber badge, previous round visible, a chase in the panel, email #0 in Mailpit (:54354), portal shows "renewal due". Then set the date into the past via a second round to observe "lapsed" in console + portal.

- [ ] **Step 3: Update the graph**

Run: `graphify update .`

- [ ] **Step 4: Commit any doc deltas and push**

```bash
git add docs
git commit -m "docs: recurrence spec amendments from implementation (slice 11)" # only if amended
git push -u origin feat/recurrence
```

Then open the PR (`gh pr create`) titled `feat: recurrence — slice 11 (expiry-driven re-arm, auto-chase, lapse)`, body summarizing: the four capabilities, the archive mechanism, RPC surface, and the manual demo evidence. CI must be green before review.

---

## Plan self-review (already applied)

1. **Spec coverage:** driver config → Tasks 2/3/5; scan/re-arm/atomicity → Tasks 3/4; auto-chase + same-tick email → Task 4; console surfaces (badges, expiry line, archived rounds, automatic chase visible) → Task 6 (chase panel needs no change — it never showed a creator); portal markers → Task 7; done-when asserted → Task 4 test + Task 8 manual scene. The spec's "editing recur_lead_days on snapshots" stays out of scope — no task touches program-side requirement writes.
2. **Type consistency:** `RecurSummary` field names match between Tasks 4's drain.ts and the extended `DrainSummary`; `stageDueState(dueAt, status, now)` signature identical across Tasks 1/6/7; `recurLeadDays: number | null` on both `Requirement` (templates) and `SectionRequirement` (programs); RPC names/args match between 0022 SQL and both callers.
3. **Known accepted risks:** `recur_due`'s scan has no dedicated index (the slice-6 `value_date` index + small tables carry v1; noted for post-v1). `p_limit` starvation is impossible — re-armed stages leave the scan, so leftovers surface next tick.
