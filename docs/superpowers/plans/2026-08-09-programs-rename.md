# Programs Rename (Slice 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the domain noun `rollout` → `program` everywhere — tables, columns, indexes, constraints, policies, the RPC, schema TS, feature folder, routes, scripts, tests, and UI copy — with a single data-preserving migration.

**Architecture:** One hand-authored migration (`0009_programs_rename.sql`) does `ALTER … RENAME` on tables/columns/indexes/constraints/policies and recreates the three functions whose SQL bodies name the old tables (`create_rollout` → `create_program`, `check_unit_org`, `copy_stages_to_unit`). The Drizzle snapshot for 0009 is derived from 0008 by a mechanical string rename, so CI's drift gate (`drizzle-kit generate` must produce nothing) validates the whole thing. Code is renamed by an ordered, brand-guarded `sed` sweep plus `git mv` of folders.

**Tech Stack:** Drizzle ORM 0.45 / drizzle-kit, Supabase local stack (ports +30), Next.js 16 App Router, Vitest (+ integration config), macOS `sed -i ''`, `jq`, `psql`.

## Global Constraints

- **The brand `RolloutOS` / `rolloutos` survives** (app title, login copy, `demo@rolloutos.local`). Every bulk rename must guard it (see the sed chain in Task 1 Step 8).
- **Migrations are append-only.** Never edit `0000`–`0008` or their snapshots. Historical docs in `docs/superpowers/` are also never edited.
- **CI drift gate is the oracle:** `npx drizzle-kit generate` after the change must print "No schema changes" and leave `src/db/migrations` untouched (`git diff --exit-code src/db/migrations`).
- **Data-preserving:** the migration must be pure `RENAME`s + function recreation — no DROP TABLE, no data movement. Verified against a seeded database.
- Platform: macOS — `sed -i ''` (empty-string backup arg). Node 24 (`nvm use`).
- `npm run typecheck` already runs `next typegen` first — route-type errors after the folder rename resolve by running it, nothing extra.
- Local Supabase must be up (`npm run setup` if not): API :54351, Postgres :54352.
- Done when (from the spec): CI green; **zero occurrences of the old noun outside `src/db/migrations/` and `docs/`** (brand excluded).

## File Structure

```
Create:  src/db/migrations/0009_programs_rename.sql        (hand-written SQL)
Create:  src/db/migrations/meta/0009_snapshot.json         (derived from 0008 by sed + jq)
Modify:  src/db/migrations/meta/_journal.json              (append entry idx 9)
Rename:  src/db/schema/rollouts.ts → programs.ts           (content rewritten)
Modify:  src/db/schema/index.ts, src/db/schema/templates.ts (comment)
Rename:  src/features/rollouts/ → src/features/programs/
           create-rollout-dialog.tsx → create-program-dialog.tsx
           rollout-header.tsx → program-header.tsx
           rollout-list.tsx → program-list.tsx
Rename:  src/app/(dashboard)/rollouts/ → src/app/(dashboard)/programs/
Modify (sed sweep): everything `git grep -lI -i rollout -- src scripts` returns,
         excluding src/db/migrations — includes actions/queries/schema/tests,
         seed.ts, nav.ts, command-menu.tsx, auth/confirm, onboarding, orgs/actions
Modify:  README.md, src/features/README.md                 (Task 2)
```

**Prerequisite:** the spec branch `docs/client-flow-vision-spec` is docs-only. Either merge it first and branch from `main`, or stack `feat/programs-rename` on top of it. Steps below assume stacking (works either way).

---

### Task 1: The mechanical rename — DB migration + snapshot + full code sweep

One reviewable unit: the migration and the code that speaks to it cannot be split without a red intermediate state (the drift gate spans schema TS + snapshot).

**Files:** everything under **File Structure** above except the two READMEs.

**Interfaces:**
- Consumes: existing tables `rollouts`, `rollout_stages`, `units`, `unit_stages`; RPC `create_rollout(uuid, text)`; functions `check_unit_org()`, `copy_stages_to_unit()` (0006, 0008).
- Produces: tables `programs`, `program_stages` (columns `program_id`, `program_stage_id` on `units`/`unit_stages`); RPC **`create_program(p_template_id uuid, p_name text) returns public.programs`**; Drizzle exports **`programs`, `programStages`, `units`, `unitStages`** from `@/db/schema`; routes `/programs`, `/programs/[id]`. Slice 5b (CSV import) and slice 6 build on these names.

- [ ] **Step 1: Branch and baseline**

```bash
git checkout docs/client-flow-vision-spec && git checkout -b feat/programs-rename
npm run db:reset
PSQL='psql postgresql://postgres:postgres@127.0.0.1:54352/postgres -t -A -c'
$PSQL "select (select count(*) from rollouts) || ',' || (select count(*) from rollout_stages) || ',' || (select count(*) from units) || ',' || (select count(*) from unit_stages)"
```

Expected: `db:reset` succeeds (seed prints the demo rollout). **Record the four counts** — they are the data-preservation fixture (e.g. `1,4,3,12`; exact numbers depend on the seed).

- [ ] **Step 2: Write `src/db/migrations/0009_programs_rename.sql`**

Exactly this content (no `--> statement-breakpoint` lines — like 0006/0008 it runs as one transactional script):

```sql
-- Custom SQL migration file, put your code below! --

-- Slice 5a: rollout → program. Pure renames (data-preserving) plus
-- recreation of the three functions whose SQL text names the old tables.
-- Policies, grants, and trigger column lists survive renames (they bind by
-- OID/attnum); function BODIES are text and do not — hence the recreates.
-- Safe as a single release: deploys are disabled, app is local-only.

-- Tables
ALTER TABLE "rollouts" RENAME TO "programs";
ALTER TABLE "rollout_stages" RENAME TO "program_stages";

-- Columns
ALTER TABLE "program_stages" RENAME COLUMN "rollout_id" TO "program_id";
ALTER TABLE "units" RENAME COLUMN "rollout_id" TO "program_id";
ALTER TABLE "unit_stages" RENAME COLUMN "rollout_stage_id" TO "program_stage_id";
ALTER TABLE "unit_stages" RENAME COLUMN "rollout_id" TO "program_id";

-- Constraints (pkeys, then FKs) — names must match what drizzle-kit would
-- generate for the new schema, or the drift gate fails.
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_pkey" TO "programs_pkey";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_pkey" TO "program_stages_pkey";
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_org_id_orgs_id_fk" TO "programs_org_id_orgs_id_fk";
ALTER TABLE "programs" RENAME CONSTRAINT "rollouts_template_id_templates_id_fk" TO "programs_template_id_templates_id_fk";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_rollout_id_rollouts_id_fk" TO "program_stages_program_id_programs_id_fk";
ALTER TABLE "program_stages" RENAME CONSTRAINT "rollout_stages_org_id_orgs_id_fk" TO "program_stages_org_id_orgs_id_fk";
ALTER TABLE "units" RENAME CONSTRAINT "units_rollout_id_rollouts_id_fk" TO "units_program_id_programs_id_fk";
ALTER TABLE "unit_stages" RENAME CONSTRAINT "unit_stages_rollout_stage_id_rollout_stages_id_fk" TO "unit_stages_program_stage_id_program_stages_id_fk";
ALTER TABLE "unit_stages" RENAME CONSTRAINT "unit_stages_rollout_id_rollouts_id_fk" TO "unit_stages_program_id_programs_id_fk";
-- unit_stages_unit_stage_uq is noun-free and keeps its name.

-- Indexes
ALTER INDEX "rollouts_org_id_idx" RENAME TO "programs_org_id_idx";
ALTER INDEX "rollouts_template_id_idx" RENAME TO "programs_template_id_idx";
ALTER INDEX "rollout_stages_rollout_id_idx" RENAME TO "program_stages_program_id_idx";
ALTER INDEX "rollout_stages_org_id_idx" RENAME TO "program_stages_org_id_idx";
ALTER INDEX "units_rollout_id_idx" RENAME TO "units_program_id_idx";
ALTER INDEX "unit_stages_rollout_stage_id_idx" RENAME TO "unit_stages_program_stage_id_idx";
ALTER INDEX "unit_stages_rollout_id_idx" RENAME TO "unit_stages_program_id_idx";

-- Policies (cosmetic rename; expressions bind by attnum and survive)
ALTER POLICY "rollouts_select_member" ON "programs" RENAME TO "programs_select_member";
ALTER POLICY "rollouts_update_member" ON "programs" RENAME TO "programs_update_member";
ALTER POLICY "rollouts_delete_member" ON "programs" RENAME TO "programs_delete_member";
ALTER POLICY "rollout_stages_select_member" ON "program_stages" RENAME TO "program_stages_select_member";

-- check_unit_org: body referenced public.rollouts / new.rollout_id.
-- Same trigger (units_check_org) keeps firing it; only the body changes.
create or replace function public.check_unit_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program_org uuid;
begin
  select org_id into v_program_org
    from public.programs
   where id = new.program_id;
  if v_program_org is null then
    raise exception 'program not found';
  end if;
  if v_program_org <> new.org_id then
    raise exception 'org mismatch';
  end if;
  return new;
end;
$$;

-- copy_stages_to_unit: body referenced rollout_stages / rollout_id.
create or replace function public.copy_stages_to_unit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.unit_stages (unit_id, program_stage_id, program_id, org_id)
  select new.id, ps.id, new.program_id, new.org_id
    from public.program_stages ps
   where ps.program_id = new.program_id;
  return new;
end;
$$;

-- The RPC changes NAME, so drop-and-create (grants die with the drop).
-- Body is 0006's create_rollout with the nouns renamed; checks unchanged.
DROP FUNCTION public.create_rollout(uuid, text);

create function public.create_program(p_template_id uuid, p_name text)
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

  insert into public.program_stages (program_id, org_id, name, position)
  select v_program.id, v_template.org_id, ts.name,
         row_number() over (order by ts.position, ts.id) - 1
    from public.template_stages ts
   where ts.template_id = v_template.id;

  return v_program;
end;
$$;

grant execute on function public.create_program(uuid, text) to authenticated;
```

- [ ] **Step 3: Derive the 0009 snapshot from 0008**

The snapshot records only the *end state*; the four SQL-name terms are the only strings that change. Order matters (longest first):

```bash
cd src/db/migrations/meta
cp 0008_snapshot.json 0009_snapshot.json
sed -i '' \
  -e 's/rollout_stage_id/program_stage_id/g' \
  -e 's/rollout_stages/program_stages/g' \
  -e 's/rollout_id/program_id/g' \
  -e 's/rollouts/programs/g' \
  0009_snapshot.json
NEW_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
PREV_ID=$(jq -r '.id' 0008_snapshot.json)
jq --arg id "$NEW_ID" --arg prev "$PREV_ID" '.id = $id | .prevId = $prev' 0009_snapshot.json > s.tmp && mv s.tmp 0009_snapshot.json
grep -c rollout 0009_snapshot.json
cd ../../../..
```

Expected: final `grep -c` prints `0`.

- [ ] **Step 4: Register 0009 in the journal**

```bash
J=src/db/migrations/meta/_journal.json
jq --argjson when "$(($(date +%s) * 1000))" \
  '.entries += [{"idx": 9, "version": "7", "when": $when, "tag": "0009_programs_rename", "breakpoints": true}]' \
  "$J" > j.tmp && mv j.tmp "$J"
jq -r '.entries[-1].tag' "$J"
```

Expected: `0009_programs_rename`.

- [ ] **Step 5: Apply the migration to the seeded database**

```bash
npm run db:migrate
```

Expected: applies `0009_programs_rename` without error. (This is the data-preservation test: it runs against Step 1's seeded DB, not an empty one.)

- [ ] **Step 6: Verify — counts preserved, objects renamed, old RPC gone**

```bash
$PSQL "select (select count(*) from programs) || ',' || (select count(*) from program_stages) || ',' || (select count(*) from units) || ',' || (select count(*) from unit_stages)"
$PSQL "select proname from pg_proc where proname in ('create_rollout','create_program')"
$PSQL "select polname from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('programs','program_stages') order by polname"
```

Expected: counts **identical to Step 1**; only `create_program`; policies `program_stages_select_member, programs_delete_member, programs_select_member, programs_update_member`.

- [ ] **Step 7: Rewrite the Drizzle schema**

```bash
git mv src/db/schema/rollouts.ts src/db/schema/programs.ts
```

Replace `src/db/schema/programs.ts` content entirely with:

```typescript
import { pgTable, uuid, text, integer, timestamp, index, unique } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { templates } from "./templates";

// One execution of a template's workflow across many units. Creating a
// program SNAPSHOTS the template's stages (copy-on-use); the snapshot is
// immutable and the template link is provenance only.
export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // Provenance only — the snapshot carries all load-bearing data, so a
    // deleted template leaves the program intact with template_id null.
    templateId: uuid("template_id").references(() => templates.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // Set app-side by renameProgram; list ordering uses created_at.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("programs_org_id_idx").on(t.orgId), index("programs_template_id_idx").on(t.templateId)],
);

// The frozen copy. Written only inside the create_program RPC; API roles
// hold select-only grants, so no client write path exists at any layer.
export const programStages = pgTable(
  "program_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(), // contiguous 0..n-1, written once by the RPC
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("program_stages_program_id_idx").on(t.programId),
    index("program_stages_org_id_idx").on(t.orgId),
  ],
);

export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The customer's own identifier (store number, VIN, site code); CSV
    // import will key on it next slice.
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("units_program_id_idx").on(t.programId), index("units_org_id_idx").on(t.orgId)],
);

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
    programStageId: uuid("program_stage_id")
      .notNull()
      .references(() => programStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-program counts.
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
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
    unique("unit_stages_unit_stage_uq").on(t.unitId, t.programStageId),
    index("unit_stages_unit_id_idx").on(t.unitId),
    index("unit_stages_program_stage_id_idx").on(t.programStageId),
    index("unit_stages_program_id_idx").on(t.programId),
    index("unit_stages_org_id_idx").on(t.orgId),
  ],
);
```

In `src/db/schema/index.ts`, change the barrel line `export * from "./rollouts";` to `export * from "./programs";` (leave other exports alone).

- [ ] **Step 8: Rename folders/files, then run the brand-guarded sed sweep**

```bash
git mv src/features/rollouts src/features/programs
git mv src/features/programs/components/create-rollout-dialog.tsx src/features/programs/components/create-program-dialog.tsx
git mv src/features/programs/components/rollout-header.tsx src/features/programs/components/program-header.tsx
git mv src/features/programs/components/rollout-list.tsx src/features/programs/components/program-list.tsx
git mv "src/app/(dashboard)/rollouts" "src/app/(dashboard)/programs"

git grep -lI -i 'rollout' -- src scripts ':(exclude)src/db/migrations' ':(exclude)src/db/schema/programs.ts' \
| while read -r f; do
  sed -i '' \
    -e 's/RolloutOS/__KEEPBRAND__/g' \
    -e 's/rolloutos/__keepbrand__/g' \
    -e 's/rolloutStageId/programStageId/g' \
    -e 's/RolloutStage/ProgramStage/g' \
    -e 's/rollout_stage_id/program_stage_id/g' \
    -e 's/rollout_stages/program_stages/g' \
    -e 's/rolloutStages/programStages/g' \
    -e 's/rollout_id/program_id/g' \
    -e 's/rolloutId/programId/g' \
    -e 's/ROLLOUT/PROGRAM/g' \
    -e 's/rollouts/programs/g' \
    -e 's/Rollouts/Programs/g' \
    -e 's/rollout/program/g' \
    -e 's/Rollout/Program/g' \
    -e 's/__KEEPBRAND__/RolloutOS/g' \
    -e 's/__keepbrand__/rolloutos/g' \
    "$f"
done
```

This sweep intentionally covers **everything**: Drizzle imports, `supabase.rpc("create_program")`, `.from("programs")` / `.eq("program_id", …)` strings, Zod schemas + tests, `scripts/seed.ts` (`DEMO_ROLLOUT` → `DEMO_PROGRAM`; `demo@rolloutos.local` survives via the guard), `nav.ts`, `command-menu.tsx`, `revalidatePath`/`redirect` strings, `auth/confirm`'s `"/programs"` default, `PageProps<"/programs/[id]">`, component symbols (`ProgramList`, `CreateProgramDialog`, `ProgramHeader`), and UI copy inside those files.

Verify the sweep converged and the brand survived:

```bash
git grep -nI -i 'rollout' -- src scripts ':(exclude)src/db/migrations' | grep -vi 'rolloutos'
git grep -c 'RolloutOS' -- src | head -5
```

Expected: first command prints **nothing**; second still finds the brand (layout title, login copy).

- [ ] **Step 9: Typecheck, lint, unit tests**

```bash
npm run verify
```

Expected: PASS (`typecheck` regenerates Next route types first, which fixes `PageProps<"/programs/[id]">`). If lint flags a stale import path, it's a missed file — re-run the Step 8 grep to find it.

- [ ] **Step 10: The drift gate (mirrors CI exactly)**

```bash
npm run db:generate
git status --porcelain src/db/migrations
```

Expected: drizzle-kit prints **"No schema changes, nothing to migrate"** (exact wording may vary; the load-bearing check is that `git status` shows only our three intended paths: `0009_programs_rename.sql`, `meta/0009_snapshot.json`, `meta/_journal.json` — no `0010_*` appeared). If a `0010_*` was generated, the snapshot diverged from the schema TS: delete `0010_*`, diff its SQL to find the mismatched name, fix `0009_snapshot.json` or `programs.ts`, repeat.

- [ ] **Step 11: Integration tests + full reset cycle**

```bash
npm run test:integration
npm run db:reset
npm run build
```

Expected: all integration tests pass (they now call `rpc("create_program")` and query `programs`/`program_stages` — RLS and immutability semantics unchanged). `db:reset` proves the whole chain — empty DB → 0000–0009 → seed via `create_program` — works. Build succeeds with the `/programs` routes.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: rename rollouts → programs (slice 5a)

One data-preserving migration (renames + function-body recreation:
create_rollout → create_program, check_unit_org, copy_stages_to_unit),
snapshot derived from 0008 so the CI drift gate validates it, and a
brand-guarded sweep across schema, features, routes, scripts, and tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Docs, README, and the zero-occurrence gate

**Files:**
- Modify: `README.md`, `src/features/README.md`

**Interfaces:**
- Consumes: the renamed code from Task 1.
- Produces: the spec's "done when" for 5a — zero old-noun occurrences outside migrations/history, brand intact.

- [ ] **Step 1: Sweep the two READMEs with the same guarded sed**

```bash
for f in README.md src/features/README.md; do
  sed -i '' \
    -e 's/RolloutOS/__KEEPBRAND__/g' -e 's/rolloutos/__keepbrand__/g' \
    -e 's/rollout_stage_id/program_stage_id/g' -e 's/rollout_stages/program_stages/g' \
    -e 's/rollout_id/program_id/g' -e 's/rollouts/programs/g' -e 's/Rollouts/Programs/g' \
    -e 's/rollout/program/g' -e 's/Rollout/Program/g' \
    -e 's/__KEEPBRAND__/RolloutOS/g' -e 's/__keepbrand__/rolloutos/g' \
    "$f"
done
```

- [ ] **Step 2: Reposition the README's framing by hand**

In `README.md`, replace the (now sed-mangled) opening paragraph under `# RolloutOS` with:

```markdown
B2B SaaS for businesses that run one repeatable process across many similar
subjects — client sites, stores, vehicles, cases. One **program** holds many
**units**, each moving independently through the same **stage** lifecycle,
with a branded no-login flow for the people who do the work.
```

And at the bottom, update the design pointer line to:

```markdown
Design & scope: `docs/superpowers/specs/2026-08-09-client-flow-vision-and-roadmap-design.md`
(stack details: `docs/superpowers/specs/2026-08-07-rolloutos-mvp-design.md`).
```

Read both READMEs top to bottom once — fix any sentence the mechanical sweep made awkward (e.g. capitalization at sentence start).

- [ ] **Step 3: The final gate**

```bash
grep -rnIiE 'rollout' src scripts README.md supabase package.json 2>/dev/null \
  | grep -v 'src/db/migrations/' | grep -vi 'rolloutos'
npm run verify
```

Expected: grep prints **nothing**; verify passes.

- [ ] **Step 4: Update the knowledge graph and commit**

```bash
graphify update .
git add -A
git commit -m "docs: speak program, not rollout — README repositioning + noun gate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: PR and CI

**Files:** none (process only).

**Interfaces:**
- Consumes: the two commits above.
- Produces: a merged slice 5a; slice 5b (CSV import) branches from the result.

- [ ] **Step 1: Push and open the PR**

If the spec branch was merged to main first, rebase: `git rebase main`. Then:

```bash
git push -u origin feat/programs-rename
gh pr create --title "feat: programs rename — slice 5a (rollouts → programs)" --body "## Summary
- Renames the core noun \`rollout\` → \`program\` per the 2026-08-09 vision spec (slice 5a): tables, columns, indexes, constraints, policies, RPC (\`create_rollout\` → \`create_program\`), schema TS, feature folder, \`/programs\` routes, scripts, tests, and copy.
- One data-preserving migration (\`0009_programs_rename.sql\`); snapshot derived from 0008 so the drift gate validates end-state equivalence.
- Brand \`RolloutOS\` intentionally unchanged.

## Why now
Deploys are disabled and the app is local-only — the last moment a rename needs no two-release compatibility dance.

## Test plan
- [x] Migration applied to a seeded DB: row counts identical before/after
- [x] \`npm run verify\` + \`npm run test:integration\` + \`npm run build\`
- [x] Drift gate: \`drizzle-kit generate\` produces nothing
- [x] Noun gate: zero \`rollout\` occurrences outside \`src/db/migrations/\` and \`docs/\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Watch CI to green**

```bash
gh pr checks --watch
```

Expected: the single `ci` status passes (lint, typecheck, tests, build, migrate-from-empty + drift check, RLS integration tests). If the drift step fails in CI but passed locally, the snapshot wasn't committed — check `git ls-files src/db/migrations/meta`.

---

## Self-review notes (run against the spec)

- **Spec coverage:** 5a's "done when" = CI green + zero old-noun occurrences outside migrations → Task 3 Step 2 and Task 2 Step 3. Data preservation (implicit in "rename," explicit in spec's local-only rationale) → Task 1 Steps 1/5/6.
- **Type consistency:** exports `programs`/`programStages`/`units`/`unitStages`; camel fields `programId`/`programStageId`; RPC `create_program(p_template_id, p_name)` — used identically in the migration SQL, schema TS, and the sed chain (which maps every casing variant).
- **Known-safe survivors:** trigger names `units_check_org`/`units_copy_stages`/`unit_stages_done_at`, function names `check_unit_org`/`copy_stages_to_unit`/`maintain_unit_stage_done_at`, constraint `unit_stages_unit_stage_uq` — all noun-free; bodies that referenced old nouns are recreated in 0009.
