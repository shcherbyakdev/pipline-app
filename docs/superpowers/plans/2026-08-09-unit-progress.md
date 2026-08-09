# Unit Progress (Feature #4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-unit-per-stage progress tracking: `unit_stages` rows fanned out by trigger, toggled done/pending by members, visible on the rollout detail page (stage dots) and list page (percent column).

**Architecture:** One `unit_stages` row per (unit × rollout stage), created by a SECURITY DEFINER `AFTER INSERT` trigger on `units` and backfilled for existing units. Clients hold `select` + column-scoped `update (status)` only; `done_at` is trigger-maintained. The feature extends the existing `src/features/rollouts/` slice (schema → actions → queries → components), following the established optimistic-mutation and RLS conventions.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase (Postgres RLS via `@supabase/ssr` clients), Drizzle ORM 0.45 / drizzle-kit 0.31 migrations, Zod 4, Vitest 4, Tailwind 4 + shadcn.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-unit-progress-design.md`. Branch: `feat/unit-progress` (already created; spec committed).
- RLS predicate everywhere: `org_id in (select public.user_orgs())`.
- Explicit per-table grants (0004 convention); definer functions use `set search_path = ''`.
- Server Actions: validate with Zod, return `{ ok: true } | { ok: false; error: GENERIC_WRITE_ERROR }`, log raw errors with `console.error("[rollouts] <context>:", error)`, revalidate BOTH `/rollouts` and `/rollouts/[id]`.
- Client copy for any failed write is `GENERIC_WRITE_ERROR` from `@/lib/actions` ("Couldn't save. Try again.").
- Optimistic mutations follow `src/features/README.md`: `useOptimistic` reducer + transition + `toast.error` on failure; never sync local state from props in an effect.
- Integration tests: order-dependent `it` blocks, `signedInUser` tags MUST be prefixed `progress_` (email-collision lesson), no error-message-text assertions, use the 0-rows-affected + owner-reread pattern where local/CI ACLs diverge.
- Local stack must be running: `npm run setup` (Supabase ports shifted +30; DB on 54352).
- Every commit message ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- After each task's commit, run `graphify update .` (project rule; AST-only, fast).

---

### Task 1: `unit_stages` Drizzle schema + generated migration

**Files:**
- Modify: `src/db/schema/rollouts.ts` (append table)
- Create (generated): `src/db/migrations/0007_*.sql`, `src/db/migrations/meta/0007_snapshot.json`, journal entry

**Interfaces:**
- Produces: `unitStages` export (Drizzle table) with columns `id, unitId, rolloutStageId, rolloutId, orgId, status, doneAt, createdAt`; DB table `public.unit_stages` with unique `(unit_id, rollout_stage_id)` and indexes on `unit_id`, `rollout_stage_id`, `rollout_id`, `org_id`.

- [ ] **Step 1: Append the table to `src/db/schema/rollouts.ts`**

Add `unique` to the existing `drizzle-orm/pg-core` import, then append:

```ts
// One row per (unit × stage) — fanned out by the units AFTER INSERT trigger
// (see 0008), backfilled for pre-feature units. Clients may update ONLY
// `status` (column-scoped grant); `done_at` is trigger-maintained.
export const unitStages = pgTable(
  "unit_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    rolloutStageId: uuid("rollout_stage_id")
      .notNull()
      .references(() => rolloutStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-rollout counts.
    rolloutId: uuid("rollout_id")
      .notNull()
      .references(() => rollouts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'pending' | 'done' — CHECK lives in 0008 (custom SQL keeps it and the
    // grants/policies in one reviewable place).
    status: text("status").notNull().default("pending"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("unit_stages_unit_stage_uq").on(t.unitId, t.rolloutStageId),
    index("unit_stages_unit_id_idx").on(t.unitId),
    index("unit_stages_rollout_stage_id_idx").on(t.rolloutStageId),
    index("unit_stages_rollout_id_idx").on(t.rolloutId),
    index("unit_stages_org_id_idx").on(t.orgId),
  ],
);
```

- [ ] **Step 2: Generate and inspect the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0007_<slug>.sql` containing `CREATE TABLE "unit_stages"` with the 4 FKs (all `ON DELETE cascade`), the unique constraint, and 4 `CREATE INDEX` statements. Open the file and confirm — drizzle-kit names are machine-generated, content is what matters.

- [ ] **Step 3: Apply it to the local stack**

Run: `npm run db:migrate`
Expected: exits 0. Then confirm idempotence: `npm run db:generate` again → "No schema changes, nothing to migrate" (no drift).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/rollouts.ts src/db/migrations
git commit -m "feat(db): unit_stages table — one row per unit × stage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: RLS integration tests (red) + custom migration 0008 (green)

The integration suite is the executable spec of the security layer; write it first, watch it fail against the bare table, then write the migration that makes it pass.

**Files:**
- Create: `src/features/rollouts/progress.rls.integration.test.ts`
- Create (via `drizzle-kit generate --custom`): `src/db/migrations/0008_unit_progress_rls.sql` + journal/snapshot entries

**Interfaces:**
- Consumes: `public.unit_stages` (Task 1), existing `create_org` / `create_rollout` RPCs, `public.user_orgs()`.
- Produces: policies `unit_stages_select_member` / `unit_stages_update_member`; grants (`select` + `update (status)` to authenticated, `select` to service_role); CHECK `unit_stages_status_check`; trigger `units_copy_stages` (function `public.copy_stages_to_unit`, SECURITY DEFINER); trigger `unit_stages_done_at` (function `public.maintain_unit_stage_done_at`, invoker); column-scoped units update grant `(name, external_ref)`; backfill of existing units.

- [ ] **Step 1: Write the failing integration suite**

Create `src/features/rollouts/progress.rls.integration.test.ts`:

```ts
/**
 * Fan-out + toggle + tenant-isolation proof for unit_stages, mirroring
 * rls.integration.test.ts. Requires the local Supabase stack (npm run setup).
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

describe("RLS unit_stages", () => {
  // ORDER-DEPENDENT it blocks (vitest default file order): the first test
  // creates the unit whose fan-out rows every later test consumes, and the
  // last test deletes that unit. Do not reorder or mark concurrent.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceRolloutId: string;
  let aliceUnitId: string;
  let stageIds: string[] = [];
  let firstUnitStageId: string;

  beforeAll(async () => {
    // "progress_" tags keep emails disjoint from the other integration
    // suites running in the same process (Date.now() collision lesson).
    alice = await signedInUser("progress_alice");
    bob = await signedInUser("progress_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ProgAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "ProgBeta" });
    if (e2) throw e2;

    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Progress Fixture" })
      .select("id")
      .single();
    if (e3) throw e3;
    const templateId = (template as { id: string }).id;

    const stages = ["S1", "S2"].map((name, position) => ({
      template_id: templateId,
      org_id: aliceOrgId,
      name,
      position,
    }));
    const { error: e4 } = await alice.from("template_stages").insert(stages);
    if (e4) throw e4;

    const { data: rollout, error: e5 } = await alice.rpc("create_rollout", {
      p_template_id: templateId,
      p_name: "Progress R1",
    });
    if (e5) throw e5;
    aliceRolloutId = (rollout as { id: string }).id;

    const { data: rolloutStages, error: e6 } = await alice
      .from("rollout_stages")
      .select("id")
      .eq("rollout_id", aliceRolloutId)
      .order("position");
    if (e6) throw e6;
    stageIds = (rolloutStages ?? []).map((s) => s.id);
  });

  it("inserting a unit fans out one pending row per stage", async () => {
    const { data: unit, error } = await alice
      .from("units")
      .insert({ rollout_id: aliceRolloutId, org_id: aliceOrgId, name: "U1" })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceUnitId = (unit as { id: string }).id;

    const { data: rows } = await alice
      .from("unit_stages")
      .select("id, rollout_stage_id, rollout_id, org_id, status, done_at")
      .eq("unit_id", aliceUnitId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows!.map((r) => r.rollout_stage_id))).toEqual(new Set(stageIds));
    for (const row of rows!) {
      expect(row.status).toBe("pending");
      expect(row.done_at).toBeNull();
      expect(row.rollout_id).toBe(aliceRolloutId);
      expect(row.org_id).toBe(aliceOrgId);
    }
    firstUnitStageId = rows!.find((r) => r.rollout_stage_id === stageIds[0])!.id;
  });

  it("owner toggles done and back; done_at follows", async () => {
    const { data: doneRow, error: doneError } = await alice
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", firstUnitStageId)
      .select("status, done_at")
      .single();
    expect(doneError).toBeNull();
    expect(doneRow!.status).toBe("done");
    expect(doneRow!.done_at).not.toBeNull();

    const { data: pendingRow, error: pendingError } = await alice
      .from("unit_stages")
      .update({ status: "pending" })
      .eq("id", firstUnitStageId)
      .select("status, done_at")
      .single();
    expect(pendingError).toBeNull();
    expect(pendingRow!.status).toBe("pending");
    expect(pendingRow!.done_at).toBeNull();
  });

  it("rejects a status outside the CHECK list", async () => {
    const { error } = await alice
      .from("unit_stages")
      .update({ status: "bogus" })
      .eq("id", firstUnitStageId);
    expect(error).not.toBeNull();
  });

  it("direct insert into unit_stages is denied even for one's own org", async () => {
    // System-managed rows: no insert policy locally, no insert grant in CI —
    // both are errors, so a plain error assertion is portable.
    const { error } = await alice.from("unit_stages").insert({
      unit_id: aliceUnitId,
      rollout_stage_id: stageIds[0],
      rollout_id: aliceRolloutId,
      org_id: aliceOrgId,
    });
    expect(error).not.toBeNull();
  });

  it("delete is denied (asserted by effect — local/CI ACLs diverge)", async () => {
    const { data: deleteData } = await alice
      .from("unit_stages")
      .delete()
      .eq("id", firstUnitStageId)
      .select();
    expect(deleteData ?? []).toHaveLength(0);

    const { data: stillThere } = await alice
      .from("unit_stages")
      .select("id")
      .eq("id", firstUnitStageId);
    expect(stillThere).toHaveLength(1);
  });

  it("foreign member sees nothing and cannot update", async () => {
    const { data: seen } = await bob
      .from("unit_stages")
      .select("id")
      .eq("rollout_id", aliceRolloutId);
    expect(seen).toHaveLength(0);

    const { data: updateData, error: updateError } = await bob
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", firstUnitStageId)
      .select();
    expect(updateError).toBeNull();
    expect(updateData).toHaveLength(0);

    const { data: check } = await alice
      .from("unit_stages")
      .select("status")
      .eq("id", firstUnitStageId)
      .single();
    expect(check!.status).toBe("pending");
  });

  it("deleting the unit cascades its unit_stages rows", async () => {
    const { error } = await alice.from("units").delete().eq("id", aliceUnitId);
    expect(error).toBeNull();

    const { data: rows } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", aliceUnitId);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration -- progress`
Expected: FAIL — fan-out test gets 0 rows (no trigger yet) and/or select errors (no grants/policies yet). The templates/rollouts suites must still pass (run without the filter to confirm nothing regressed: `npm run test:integration`).

- [ ] **Step 3: Create the custom migration**

Run: `npx drizzle-kit generate --custom --name=unit_progress_rls`
Expected: empty `src/db/migrations/0008_unit_progress_rls.sql` + journal entry. Fill it with:

```sql
-- Custom SQL migration file, put your code below! --

-- Unit progress security model:
--   * unit_stages rows are SYSTEM-MANAGED: created only by the units
--     AFTER INSERT fan-out trigger (SECURITY DEFINER — API roles hold no
--     insert grant), removed only by cascades. Members hold select + a
--     column-scoped update (status); done_at is trigger-maintained.
--   * rider: units update grant narrowed to (name, external_ref) so a
--     repointed rollout_id can never orphan fanned-out rows.
-- Grants are explicit per table (0004 convention).

alter table public.unit_stages enable row level security;

create policy "unit_stages_select_member" on public.unit_stages
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "unit_stages_update_member" on public.unit_stages
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));

grant select on table public.unit_stages to authenticated;
grant update (status) on table public.unit_stages to authenticated;
-- service_role: select only (the rollout_stages precedent — nothing in the
-- API writes this table; the definer trigger and cascades are the writers).
grant select on table public.unit_stages to service_role;

alter table public.unit_stages
  add constraint unit_stages_status_check check (status in ('pending', 'done'));

-- Rider: nothing in the product moves a unit between rollouts/orgs, and a
-- repointed rollout_id would orphan the fan-out. Close it at the grant layer
-- (same move as the rollouts (name, updated_at) scope). units_check_org
-- stays: it still guards insert and service_role updates.
revoke update on table public.units from authenticated;
grant update (name, external_ref) on table public.units to authenticated;

-- Fan-out: every new unit gets one pending row per stage of its rollout.
-- SECURITY DEFINER because API roles hold no insert grant on unit_stages
-- (the create_rollout reasoning). Pure derivation — no user input, no
-- raises; org/rollout consistency of NEW is already guaranteed by
-- units_check_org, so every derived row is consistent by construction.
create or replace function public.copy_stages_to_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.unit_stages (unit_id, rollout_stage_id, rollout_id, org_id)
  select new.id, rs.id, new.rollout_id, new.org_id
    from public.rollout_stages rs
   where rs.rollout_id = new.rollout_id;
  return new;
end;
$$;

create trigger units_copy_stages
after insert on public.units
for each row execute function public.copy_stages_to_unit();

-- done_at follows status transitions; clients cannot write it (no column
-- grant), so this trigger is its only writer. Runs as invoker — it only
-- shapes NEW.
create or replace function public.maintain_unit_stage_done_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status <> 'done' then
    new.done_at := now();
  elsif new.status <> 'done' then
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger unit_stages_done_at
before update of status on public.unit_stages
for each row execute function public.maintain_unit_stage_done_at();

-- Backfill pre-feature units (runs as migration owner; grants/RLS exempt).
insert into public.unit_stages (unit_id, rollout_stage_id, rollout_id, org_id)
select u.id, rs.id, u.rollout_id, u.org_id
  from public.units u
  join public.rollout_stages rs on rs.rollout_id = u.rollout_id
on conflict (unit_id, rollout_stage_id) do nothing;
```

- [ ] **Step 4: Apply and run the suite to verify it passes**

Run: `npm run db:migrate`, then `npm run test:integration`
Expected: exits 0; the new suite AND the existing templates/rollouts suites all pass (the units-grant rider must not break `renameUnit`-style updates — the rollouts suite covers unit renames via its hijack tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations src/features/rollouts/progress.rls.integration.test.ts
git commit -m "feat(db): unit_stages RLS, fan-out + done_at triggers, backfill

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Zod input schema

**Files:**
- Modify: `src/features/rollouts/schema.ts`
- Test: `src/features/rollouts/schema.test.ts`

**Interfaces:**
- Produces: `setUnitStageStatusInput` — `z.object({ id: z.uuid(), done: z.boolean() })`.

- [ ] **Step 1: Write the failing tests** — append to `schema.test.ts` (add `setUnitStageStatusInput` to the existing import):

```ts
describe("setUnitStageStatusInput", () => {
  it("happy path parses for both directions", () => {
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: true }).success).toBe(true);
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: false }).success).toBe(true);
  });
  it("rejects invalid uuid and non-boolean done", () => {
    expect(setUnitStageStatusInput.safeParse({ id: "nope", done: true }).success).toBe(false);
    expect(setUnitStageStatusInput.safeParse({ id: UUID, done: "yes" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- schema`
Expected: FAIL — `setUnitStageStatusInput` is not exported.

- [ ] **Step 3: Implement** — append to `schema.ts`:

```ts
export const setUnitStageStatusInput = z.object({ id: z.uuid(), done: z.boolean() });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- schema`
Expected: PASS (all suites in the file).

- [ ] **Step 5: Commit**

```bash
git add src/features/rollouts/schema.ts src/features/rollouts/schema.test.ts
git commit -m "feat(rollouts): setUnitStageStatus input schema

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Data layer — `setUnitStageStatus` action + `getRollout` cells

**Files:**
- Modify: `src/features/rollouts/actions.ts`
- Modify: `src/features/rollouts/queries.ts`

**Interfaces:**
- Consumes: `setUnitStageStatusInput` (Task 3), `unit_stages` table + grants (Tasks 1–2).
- Produces:
  - `setUnitStageStatus(input: unknown): Promise<ActionState>` — updates one row's status by id.
  - `type UnitStageCell = { unitStageId: string; stageId: string; done: boolean }`.
  - `Unit` gains `stages: UnitStageCell[]` (ordered by the rollout's stage positions).

- [ ] **Step 1: Add the action** — in `actions.ts`, add `setUnitStageStatusInput` to the `./schema` import and append:

```ts
export async function setUnitStageStatus(input: unknown): Promise<ActionState> {
  const parsed = setUnitStageStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_stages")
    .update({ status: parsed.data.done ? "done" : "pending" })
    .eq("id", parsed.data.id)
    .select("rollout_id")
    .maybeSingle();
  if (error || !data) return fail("setUnitStageStatus", error ?? "unit stage not visible");
  revalidatePath("/rollouts");
  revalidatePath(`/rollouts/${data.rollout_id}`);
  return { ok: true };
}
```

- [ ] **Step 2: Extend `getRollout`** — in `queries.ts`, add the types:

```ts
export type UnitStageCell = { unitStageId: string; stageId: string; done: boolean };
export type Unit = { id: string; name: string; externalRef: string | null; stages: UnitStageCell[] };
```

(replacing the old `Unit` type), change the `getRollout` select to:

```ts
"id, name, created_at, templates(name), rollout_stages(id, name, position), units(id, name, external_ref, created_at, unit_stages(id, rollout_stage_id, status))",
```

extend `RolloutDetailRow`'s `units` element type with
`unit_stages: { id: string; rollout_stage_id: string; status: string }[]`,
and build cells in stage order (order comes from the already-sorted stages
array, never from the embed):

```ts
  const stages = [...row.rollout_stages]
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    .map((s) => ({ id: s.id, name: s.name, position: s.position }));
  return {
    id: row.id,
    name: row.name,
    templateName: row.templates?.name ?? null,
    createdAt: row.created_at,
    stages,
    units: [...row.units]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((u) => {
        const byStage = new Map(u.unit_stages.map((us) => [us.rollout_stage_id, us]));
        return {
          id: u.id,
          name: u.name,
          externalRef: u.external_ref,
          stages: stages.flatMap((s) => {
            const us = byStage.get(s.id);
            return us ? [{ unitStageId: us.id, stageId: s.id, done: us.status === "done" }] : [];
          }),
        };
      }),
  };
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL in `unit-list.tsx` (`applyEvent`'s `add` case builds a `Unit` without `stages`) — that's Task 5's job. Confirm there are no OTHER errors (actions.ts and queries.ts themselves must be clean); if `unit-list.tsx` is somehow clean, still proceed.

- [ ] **Step 4: Commit** (red typecheck is expected mid-feature; CI only runs on the finished PR)

```bash
git add src/features/rollouts/actions.ts src/features/rollouts/queries.ts
git commit -m "feat(rollouts): setUnitStageStatus action + unit stage cells in getRollout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Detail-page UI — stage dots, reducer event, summary line

**Files:**
- Create: `src/features/rollouts/components/stage-dots.tsx`
- Modify: `src/features/rollouts/components/unit-row.tsx`
- Modify: `src/features/rollouts/components/unit-list.tsx`
- Modify: `src/app/(dashboard)/rollouts/[id]/page.tsx`

**Interfaces:**
- Consumes: `Unit` / `UnitStageCell` / `RolloutStage` (Task 4), `setUnitStageStatus` (Task 4).
- Produces: `StageDots({ stages, onToggle })` where `stages: { unitStageId: string; name: string; done: boolean }[]` and `onToggle: (unitStageId: string, done: boolean) => void`; `UnitList` prop `stages: RolloutStage[]`; `UnitRow` props gain `stageNames: Record<string, string>` and `onToggleStage`.

- [ ] **Step 1: Create `stage-dots.tsx`**

```tsx
"use client";

export function StageDots({
  stages,
  onToggle,
}: {
  stages: { unitStageId: string; name: string; done: boolean }[];
  onToggle: (unitStageId: string, done: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {stages.map((s) => {
        const label = s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`;
        return (
          <button
            key={s.unitStageId}
            type="button"
            aria-label={label}
            aria-pressed={s.done}
            title={label}
            onClick={() => onToggle(s.unitStageId, !s.done)}
            className={
              s.done
                ? "size-3.5 rounded-full bg-primary transition-colors"
                : "border-input size-3.5 rounded-full border bg-transparent transition-colors hover:border-primary"
            }
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Extend `unit-row.tsx`**

Add imports and props; render dots + fraction between the name input and the ref span. Full component after the change:

```tsx
"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import type { Unit } from "@/features/rollouts/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StageDots } from "./stage-dots";

export function UnitRow({
  unit,
  stageNames,
  onRename,
  onDelete,
  onToggleStage,
}: {
  unit: Unit;
  stageNames: Record<string, string>;
  onRename: (name: string) => void;
  onDelete: () => void;
  onToggleStage: (unitStageId: string, done: boolean) => void;
}) {
  // No effect syncing local state from `unit.name`: the call site
  // (unit-list.tsx) keys this component on `${unit.id}:${unit.name}`, so a
  // server-truth name change remounts this row instead of requiring a
  // `useEffect` state sync (react-hooks/set-state-in-effect).
  const [value, setValue] = React.useState(unit.name);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === unit.name) {
      setValue(unit.name);
      return;
    }
    onRename(next);
  };

  const doneCount = unit.stages.filter((s) => s.done).length;

  return (
    <li className="group flex items-center gap-2 rounded-md border px-2 py-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label={`Unit name: ${unit.name}`}
        className="border-transparent shadow-none focus-visible:border-input"
      />
      <StageDots
        stages={unit.stages.map((s) => ({
          unitStageId: s.unitStageId,
          name: stageNames[s.stageId] ?? "stage",
          done: s.done,
        }))}
        onToggle={onToggleStage}
      />
      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
        {doneCount}/{unit.stages.length}
      </span>
      {unit.externalRef !== null ? (
        <span className="text-muted-foreground shrink-0 font-mono text-xs">
          {unit.externalRef}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${unit.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
```

- [ ] **Step 3: Extend `unit-list.tsx`**

Full component after the change (new `stages` prop, `setStage` event, synthesized optimistic cells on add, summary line, wired `setUnitStageStatus`):

```tsx
"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { addUnit, renameUnit, deleteUnit, setUnitStageStatus } from "@/features/rollouts/actions";
import type { RolloutStage, Unit } from "@/features/rollouts/queries";
import { UnitRow } from "./unit-row";
import { AddUnit } from "./add-unit";

// Project convention (see features/README.md): useOptimistic over the
// server-provided array; every mutation applies optimistically inside a
// transition, calls the Server Action, and toasts on failure. The action's
// revalidatePath re-renders the server truth, which resets optimistic state.
type UnitEvent =
  | { type: "add"; id: string; name: string; externalRef?: string; stages: Unit["stages"] }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "setStage"; unitId: string; unitStageId: string; done: boolean };

function applyEvent(units: Unit[], event: UnitEvent): Unit[] {
  switch (event.type) {
    case "add":
      return [
        ...units,
        {
          id: event.id,
          name: event.name,
          externalRef: event.externalRef ?? null,
          stages: event.stages,
        },
      ];
    case "rename":
      return units.map((u) => (u.id === event.id ? { ...u, name: event.name } : u));
    case "delete":
      return units.filter((u) => u.id !== event.id);
    case "setStage":
      return units.map((u) =>
        u.id === event.unitId
          ? {
              ...u,
              stages: u.stages.map((s) =>
                s.unitStageId === event.unitStageId ? { ...s, done: event.done } : s,
              ),
            }
          : u,
      );
  }
}

export function UnitList({
  rolloutId,
  units,
  stages,
}: {
  rolloutId: string;
  units: Unit[];
  stages: RolloutStage[];
}) {
  const [optimistic, dispatch] = useOptimistic(units, applyEvent);
  const [, startTransition] = React.useTransition();

  const stageNames: Record<string, string> = Object.fromEntries(
    stages.map((s) => [s.id, s.name]),
  );

  const run = (event: UnitEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const cells = optimistic.flatMap((u) => u.stages);
  const doneCells = cells.filter((c) => c.done).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Units ({optimistic.length})</h2>
        {cells.length > 0 ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {doneCells} of {cells.length} stages done ·{" "}
            {Math.round((doneCells / cells.length) * 100)}%
          </p>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1">
        {optimistic.map((unit) => (
          <UnitRow
            // Keyed remount: when the server-truth name changes (a
            // successful rename re-renders with new server data), a fresh
            // key remounts UnitRow so its local input state re-derives from
            // `unit.name` — the sanctioned alternative to syncing local state
            // from props in an effect (react-hooks/set-state-in-effect).
            key={`${unit.id}:${unit.name}`}
            unit={unit}
            stageNames={stageNames}
            onRename={(name) =>
              run({ type: "rename", id: unit.id, name }, () =>
                renameUnit({ id: unit.id, name }),
              )
            }
            onDelete={() =>
              run({ type: "delete", id: unit.id }, () => deleteUnit({ id: unit.id }))
            }
            onToggleStage={(unitStageId, done) =>
              run({ type: "setStage", unitId: unit.id, unitStageId, done }, () =>
                setUnitStageStatus({ id: unitStageId, done }),
              )
            }
          />
        ))}
      </ol>
      {optimistic.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No units yet — add the people or things moving through this rollout.
        </p>
      ) : null}
      <AddUnit
        onAdd={(name, externalRef) =>
          run(
            {
              type: "add",
              id: crypto.randomUUID(),
              name,
              externalRef,
              // Synthesized pending cells so the optimistic row renders real
              // dots; server truth replaces the temp ids on revalidation. A
              // click on a temp id fails safe: generic error toast, then
              // reconciliation.
              stages: stages.map((s) => ({
                unitStageId: crypto.randomUUID(),
                stageId: s.id,
                done: false,
              })),
            },
            () => addUnit({ rolloutId, name, externalRef }),
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire the page** — in `src/app/(dashboard)/rollouts/[id]/page.tsx` change the `UnitList` usage to:

```tsx
<UnitList rolloutId={rollout.id} units={rollout.units} stages={rollout.stages} />
```

- [ ] **Step 5: Verify**

Run: `npm run verify`
Expected: PASS — lint, typecheck (the Task-4 red clears here), unit tests.

- [ ] **Step 6: Commit**

```bash
git add src/features/rollouts/components src/app/\(dashboard\)/rollouts/\[id\]/page.tsx
git commit -m "feat(rollouts): stage dots, per-unit fractions, progress summary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: List-page progress column

**Files:**
- Modify: `src/features/rollouts/queries.ts` (`listRollouts`)
- Modify: `src/features/rollouts/components/rollout-list.tsx`

**Interfaces:**
- Consumes: `unit_stages` embeds (Task 1–2).
- Produces: `RolloutListItem` gains `doneCount: number` and `totalCount: number` (`totalCount = stageCount × unitCount` — a fan-out invariant, no extra embed).

- [ ] **Step 1: Extend `listRollouts`** — change the select to use an aliased, filtered embedded count:

```ts
  const { data, error } = await supabase
    .from("rollouts")
    .select(
      "id, name, created_at, templates(name), rollout_stages(count), units(count), done:unit_stages(count)",
    )
    .eq("done.status", "done")
    .order("created_at", { ascending: false });
```

Extend `RolloutRow` with `done: { count: number }[]`, extend `RolloutListItem` with `doneCount: number; totalCount: number`, and map:

```ts
  return ((data ?? []) as unknown as RolloutRow[]).map((r) => {
    const stageCount = r.rollout_stages[0]?.count ?? 0;
    const unitCount = r.units[0]?.count ?? 0;
    return {
      id: r.id,
      name: r.name,
      templateName: r.templates?.name ?? null,
      stageCount,
      unitCount,
      doneCount: r.done[0]?.count ?? 0,
      // Fan-out invariant: every unit has exactly one row per stage.
      totalCount: stageCount * unitCount,
      createdAt: r.created_at,
    };
  });
```

- [ ] **Step 2: Add the column** — in `rollout-list.tsx` add a `Progress` header cell after `Units`:

```tsx
<th className="p-3 font-medium">Progress</th>
```

and the matching body cell after the units count cell:

```tsx
<td className="text-muted-foreground p-3 tabular-nums">
  {r.totalCount === 0 ? "—" : `${Math.round((r.doneCount / r.totalCount) * 100)}%`}
</td>
```

- [ ] **Step 3: Verify the wire shape against the live stack**

Run: `npm run verify` (expect PASS), then `npm run dev` and open `http://localhost:3000/rollouts` signed in as the seed user (`demo@rolloutos.dev` per `scripts/seed.ts` constants — check the file if sign-in fails).
Expected: the Progress column renders a percent for the demo rollout (0% until Task 7 seeds progress — the seeded rollout has 4 stages × 2 units, so `—` must NOT appear). If the `done:` aliased filter returns wrong counts (PostgREST quirk), fall back per spec: drop the alias/filter, embed `unit_stages(status)`, and count `status === "done"` app-side in the map — the return type is the contract, not the wire shape.

- [ ] **Step 4: Commit**

```bash
git add src/features/rollouts/queries.ts src/features/rollouts/components/rollout-list.tsx
git commit -m "feat(rollouts): progress percent column on the rollout list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Seed progress + full local verification

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: seeded rollout "Q3 Store Refresh", its units and stages (existing seed), `unit_stages` update grant (Task 2).

- [ ] **Step 1: Add the progress step** — after the `DEMO_UNITS` constant add:

```ts
const DEMO_PROGRESS: Array<{ unit: string; stages: string[] }> = [
  { unit: "Store #101 — Kraków", stages: ["Survey", "Install"] },
  { unit: "Store #102 — Gdańsk", stages: ["Survey"] },
];
```

After `ensureDemoRollout` add:

```ts
async function ensureDemoProgress(client: SupabaseClient, orgId: string): Promise<void> {
  const { data: rollout, error: rolloutError } = await client
    .from("rollouts")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", DEMO_ROLLOUT)
    .maybeSingle();
  if (rolloutError) throw rolloutError;
  if (!rollout) throw new Error(`seed: rollout "${DEMO_ROLLOUT}" not found`);

  const { data: stages, error: stagesError } = await client
    .from("rollout_stages")
    .select("id, name")
    .eq("rollout_id", rollout.id);
  if (stagesError) throw stagesError;
  const { data: units, error: unitsError } = await client
    .from("units")
    .select("id, name")
    .eq("rollout_id", rollout.id);
  if (unitsError) throw unitsError;

  // Idempotent: plain status updates converge on re-run; done_at is
  // trigger-maintained (done → done leaves it untouched).
  for (const target of DEMO_PROGRESS) {
    const unit = (units ?? []).find((u) => u.name === target.unit);
    if (!unit) continue;
    const stageIds = (stages ?? [])
      .filter((s) => target.stages.includes(s.name))
      .map((s) => s.id);
    if (stageIds.length === 0) continue;
    const { error } = await client
      .from("unit_stages")
      .update({ status: "done" })
      .eq("unit_id", unit.id)
      .in("rollout_stage_id", stageIds);
    if (error) throw error;
  }
  console.log("seed: demo progress applied");
}
```

and call it in `main()` directly after `await ensureDemoRollout(client, orgId);`:

```ts
  await ensureDemoProgress(client, orgId);
```

- [ ] **Step 2: Full reset proves migrations + backfill + triggers + seed end-to-end**

Run: `npm run db:reset`
Expected: exits 0, logs include `seed: demo progress applied`. Run `npm run db:seed` a second time — still exits 0 (idempotence).

- [ ] **Step 3: Full local verification**

Run: `npm run verify && npm run test:integration`
Expected: all green. Then manual smoke (`npm run dev`): detail page shows dots — Store #101 has 2 of 4 filled, Store #102 has 1 of 4; toggling persists across reload; list page shows 38% (3 of 8); adding a unit shows pending dots instantly.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat(seed): demo unit progress

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: PR

- [ ] **Step 1:** `graphify update .` (final), then push: `git push -u origin feat/unit-progress`
- [ ] **Step 2:** Open the PR:

```bash
gh pr create --title "feat: unit progress — Feature #4 (unit_stages + stage toggling)" --body "$(cat <<'EOF'
## Summary
- `unit_stages`: one row per (unit × stage), fanned out by a SECURITY DEFINER trigger on unit insert, backfilled for existing units
- members hold `select` + column-scoped `update (status)`; `done_at` is trigger-maintained; no client insert/delete path
- rider: `units` update grant narrowed to `(name, external_ref)`
- detail page: per-stage toggle dots, per-unit fractions, aggregate summary; list page: progress percent column
- seed: demo progress (Store #101 → Survey+Install, #102 → Survey)

Spec: `docs/superpowers/specs/2026-08-09-unit-progress-design.md`

## Test plan
- [ ] CI: lint, typecheck, test, build, db (migrations + RLS integration suites)
- [ ] `progress.rls.integration.test.ts`: fan-out, toggle + done_at, CHECK, insert/delete denial, cross-tenant, cascade

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Watch CI to green (`gh pr checks --watch`). Report; do NOT merge unless the user asks.
