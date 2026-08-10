# Stage Requirements (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stages carry typed requirements; a unit's stage completes by satisfying them (derived in the DB) with a staff override; staff author requirements in the template editor and fill them in on a new unit detail page.

**Architecture:** Two migrations — `0010` (drizzle-generated: 3 tables + `unit_stages.done_source`) and `0011_requirements_rls` (hand-written: CHECKs, RLS, grants, the response trust trigger, the derivation trigger, extended `maintain_unit_stage_done_at`, `create_program` requirements copy with checklist expansion, `reorder_stage_requirements` RPC). Feature code follows the repo's existing optimistic-mutation and Server-Action conventions exactly.

**Tech Stack:** Drizzle ORM / drizzle-kit, Supabase (Postgres RLS + PostgREST via supabase-js), Next.js 16 App Router, Zod, Vitest (unit + integration configs), Tailwind v4 + existing shadcn primitives only (Input, Button, Badge, Textarea — **no new shadcn components**; choice/boolean inputs are styled native `<select>`/`<input type="checkbox">`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-10-stage-requirements-design.md`. Branch: `feat/stage-requirements` (already exists, spec committed).
- **Every new-table migration ships explicit GRANTs** (0004 convention; newer Supabase images drop default ACLs — this failed CI once on PR #8).
- **Index every column an RLS policy or FK references**; every domain row carries `org_id`.
- CHECK constraints live in the custom SQL migration, not the Drizzle schema (the 0008 precedent).
- Type CHECKs: `template_stage_requirements.type` ∈ text,number,boolean,date,choice,checklist,photo; `program_stage_requirements.type` ∈ text,number,boolean,date,choice,photo (checklist never survives expansion); `unit_stage_responses.type` ∈ text,number,boolean,date,choice.
- **Editor never offers `photo`** (slice 8); it exists only in the type CHECKs.
- Error discipline: client sees `GENERIC_WRITE_ERROR`; raw errors `console.error`-logged server-side only. Actions return `{ ok: true } | { ok: false; error }`.
- Optimistic-mutation convention per `src/features/README.md` (useOptimistic + events + keyed remount; no state-syncing effects — `react-hooks/set-state-in-effect` is enforced).
- `src/app/` stays thin: pages compose feature components only.
- CI drift gate: after migrations, `npm run db:generate` must produce nothing.
- Local stack must be up (`npm run setup`); integration tests: `npm run test:integration`. PostgREST returns Postgres `numeric` as a **string** — convert with `Number()` when reading `value_number`.
- macOS; commits end with the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.

## File Structure

```
Modify: src/db/schema/templates.ts        + templateStageRequirements
Modify: src/db/schema/programs.ts         + programStageRequirements, unitStageResponses, unitStages.doneSource
Create: src/db/migrations/0010_*.sql      (db:generate)
Create: src/db/migrations/0011_requirements_rls.sql   (--custom)
Modify: src/features/templates/schema.ts  + requirement inputs        (+ tests in schema.test.ts)
Modify: src/features/templates/queries.ts + requirements on Stage
Modify: src/features/templates/actions.ts + add/rename/delete/reorder requirement
Create: src/features/templates/components/requirement-list.tsx / requirement-row.tsx / add-requirement.tsx
Modify: src/features/templates/components/stage-list.tsx   (render RequirementList per stage)
Modify: src/features/programs/schema.ts   + saveResponse/clearResponse inputs (+ tests)
Modify: src/features/programs/queries.ts  + getUnit, ProgramStage.hasRequirements
Modify: src/features/programs/actions.ts  + saveResponse/clearResponse; setUnitStageStatus revalidates unit page
Create: src/features/programs/components/unit-stage-sections.tsx
Modify: src/features/programs/components/unit-list.tsx / unit-row.tsx / stage-dots.tsx
Create: src/app/(dashboard)/programs/[id]/units/[unitId]/page.tsx
Create: src/features/templates/requirements.rls.integration.test.ts
Create: src/features/programs/requirements.integration.test.ts
Modify: scripts/seed.ts                   + demo requirements
```

---

### Task 1: Drizzle schema + migration 0010

**Files:**
- Modify: `src/db/schema/templates.ts`
- Modify: `src/db/schema/programs.ts`
- Create: `src/db/migrations/0010_*.sql` (generated — additions only, so `db:generate` runs without interactive prompts)

**Interfaces:**
- Consumes: existing `templates`, `templateStages`, `programs`, `programStages`, `units`, `unitStages`, `orgs` tables.
- Produces: Drizzle exports **`templateStageRequirements`**, **`programStageRequirements`**, **`unitStageResponses`**; `unitStages.doneSource` column. SQL names: `template_stage_requirements`, `program_stage_requirements`, `unit_stage_responses`, `unit_stages.done_source`.

- [ ] **Step 1: Add `templateStageRequirements` to `src/db/schema/templates.ts`**

Extend the import line to include `boolean` and `jsonb`, then append:

```typescript
// Typed requirements a stage collects. Freely editable with the template;
// programs snapshot them (create_program), so edits never leak into runs.
// `type` CHECK and all policies/grants live in 0011 (custom SQL).
export const templateStageRequirements = pgTable(
  "template_stage_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateStageId: uuid("template_stage_id")
      .notNull()
      .references(() => templateStages.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'text'|'number'|'boolean'|'date'|'choice'|'checklist'|'photo'
    type: text("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    // {options: string[]} for choice, {items: string[]} for checklist, else {}
    config: jsonb("config").notNull().default({}),
    // Per stage, 0..n-1; gaps allowed (reorder RPC rewrites). ORDER BY position, id.
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("template_stage_requirements_template_stage_id_idx").on(t.templateStageId),
    index("template_stage_requirements_org_id_idx").on(t.orgId),
  ],
);
```

- [ ] **Step 2: Add the program-side tables and `done_source` to `src/db/schema/programs.ts`**

Extend imports with `boolean`, `jsonb`, `numeric`, `date`. Append after `programStages`:

```typescript
// The frozen requirement copy. Written only inside create_program (which
// also expands checklist requirements into per-item booleans); API roles
// hold select-only grants — the program_stages precedent.
export const programStageRequirements = pgTable(
  "program_stage_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    programStageId: uuid("program_stage_id")
      .notNull()
      .references(() => programStages.id, { onDelete: "cascade" }),
    // Denormalized for PostgREST embeds and per-program reads.
    programId: uuid("program_id")
      .notNull()
      .references(() => programs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    // 'text'|'number'|'boolean'|'date'|'choice'|'photo' — checklist expanded away
    type: text("type").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull(),
    // {options} for choice; {group: <checklist label>} for expanded items
    config: jsonb("config").notNull().default({}),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("program_stage_requirements_program_stage_id_idx").on(t.programStageId),
    index("program_stage_requirements_program_id_idx").on(t.programId),
    index("program_stage_requirements_org_id_idx").on(t.orgId),
  ],
);
```

Append after `unitStages`:

```typescript
// One answer per (unit_stage × requirement). Clients supply ONLY the id
// pair + one value column; a BEFORE trigger (0011) fills unit_id/
// program_id/org_id/type from the parent rows and validates the pair.
// The one-value-matching-type CHECK lives in 0011.
export const unitStageResponses = pgTable(
  "unit_stage_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("unit_stage_responses_stage_requirement_uq").on(
      t.unitStageId,
      t.programStageRequirementId,
    ),
    index("unit_stage_responses_unit_stage_id_idx").on(t.unitStageId),
    index("unit_stage_responses_requirement_id_idx").on(t.programStageRequirementId),
    index("unit_stage_responses_unit_id_idx").on(t.unitId),
    index("unit_stage_responses_program_id_idx").on(t.programId),
    index("unit_stage_responses_org_id_idx").on(t.orgId),
    // Recurrence (slice 11) scans expiry dates.
    index("unit_stage_responses_value_date_idx").on(t.valueDate),
  ],
);
```

In `unitStages`, after the `status` column add:

```typescript
    // 'requirements' (derived) | 'override' (staff said so) | null (pending).
    // No client grant — maintained only by 0011's triggers (the done_at pattern).
    doneSource: text("done_source"),
```

- [ ] **Step 3: Generate and inspect migration 0010**

```bash
npm run db:generate
git status --porcelain src/db/migrations
```

Expected: one new `0010_<name>.sql` + `meta/0010_snapshot.json` + journal update. Inspect the SQL: 3 `CREATE TABLE`, the FKs/indexes/unique from Step 1–2, and `ALTER TABLE "unit_stages" ADD COLUMN "done_source" text;`. No DROPs, no prompts.

- [ ] **Step 4: Apply and drift-check**

```bash
npm run db:migrate
npm run db:generate
```

Expected: applies cleanly; second generate prints "No schema changes, nothing to migrate".

- [ ] **Step 5: Commit**

```bash
git add src/db
git commit -m "feat(db): requirement tables + unit_stages.done_source (slice 6, 0010)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Zod schemas + unit tests (TDD)

**Files:**
- Modify: `src/features/templates/schema.ts`, Test: `src/features/templates/schema.test.ts`
- Modify: `src/features/programs/schema.ts`, Test: `src/features/programs/schema.test.ts`

**Interfaces:**
- Produces (templates): `requirementType` (z.enum — **no photo, includes checklist**), `addRequirementInput` (`{templateStageId, type, label, required, options?, items?}`), `renameRequirementInput` (`{id, label}`), `deleteRequirementInput` (`{id}`), `reorderRequirementsInput` (`{templateStageId, requirementIds}`).
- Produces (programs): `saveResponseInput` — discriminated union on `type` ∈ text|choice|number|boolean|date with typed `value`; `clearResponseInput` (`{unitStageId, requirementId}`). Task 4/5 actions parse exactly these.

- [ ] **Step 1: Write failing tests — append to `src/features/templates/schema.test.ts`**

Follow the file's existing describe style:

```typescript
import {
  addRequirementInput,
  renameRequirementInput,
  reorderRequirementsInput,
} from "./schema";

describe("addRequirementInput", () => {
  const base = { templateStageId: "550e8400-e29b-41d4-a716-446655440000" };

  it("accepts a plain text requirement", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "text", label: "Notes", required: true })
        .success,
    ).toBe(true);
  });

  it("rejects photo — not offered by the editor until slice 8", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "photo", label: "Photo", required: true })
        .success,
    ).toBe(false);
  });

  it("choice requires >=2 options and forbids items", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "choice", label: "Route", required: true })
        .success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "choice", label: "Route", required: true, options: ["Front"],
      }).success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "choice", label: "Route", required: true, options: ["Front", "Rear"],
      }).success,
    ).toBe(true);
  });

  it("checklist requires >=1 item; other types forbid options/items", () => {
    expect(
      addRequirementInput.safeParse({ ...base, type: "checklist", label: "Checks", required: true })
        .success,
    ).toBe(false);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "checklist", label: "Checks", required: true, items: ["Power on"],
      }).success,
    ).toBe(true);
    expect(
      addRequirementInput.safeParse({
        ...base, type: "text", label: "Notes", required: true, options: ["x", "y"],
      }).success,
    ).toBe(false);
  });

  it("label is trimmed and bounded at 120", () => {
    expect(
      renameRequirementInput.safeParse({ id: base.templateStageId, label: "  " }).success,
    ).toBe(false);
    expect(
      renameRequirementInput.safeParse({ id: base.templateStageId, label: "x".repeat(121) })
        .success,
    ).toBe(false);
  });

  it("reorder rejects duplicate ids", () => {
    expect(
      reorderRequirementsInput.safeParse({
        templateStageId: base.templateStageId,
        requirementIds: [base.templateStageId, base.templateStageId],
      }).success,
    ).toBe(false);
  });
});
```

And to `src/features/programs/schema.test.ts`:

```typescript
import { saveResponseInput } from "./schema";

describe("saveResponseInput", () => {
  const ids = {
    unitStageId: "550e8400-e29b-41d4-a716-446655440000",
    requirementId: "550e8400-e29b-41d4-a716-446655440001",
  };

  it("types the value per requirement type", () => {
    expect(saveResponseInput.safeParse({ ...ids, type: "text", value: "ok" }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "number", value: 3 }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "boolean", value: true }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "date", value: "2027-03-14" }).success).toBe(true);
    expect(saveResponseInput.safeParse({ ...ids, type: "number", value: "3" }).success).toBe(false);
    expect(saveResponseInput.safeParse({ ...ids, type: "date", value: "14/03/2027" }).success).toBe(false);
    expect(saveResponseInput.safeParse({ ...ids, type: "text", value: "  " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — the new exports don't exist yet.

- [ ] **Step 3: Implement — append to `src/features/templates/schema.ts`**

```typescript
// Requirement editing. `photo` is deliberately absent until slice 8 wires
// evidence; `checklist` exists only template-side (create_program expands it).
export const requirementType = z.enum([
  "text", "number", "boolean", "date", "choice", "checklist",
]);
export const requirementLabel = z.string().trim().min(1).max(120);
const configLines = z.array(z.string().trim().min(1).max(120)).max(50);

export const addRequirementInput = z
  .object({
    templateStageId: z.uuid(),
    type: requirementType,
    label: requirementLabel,
    required: z.boolean(),
    options: configLines.min(2).optional(), // choice only
    items: configLines.min(1).optional(),   // checklist only
  })
  .superRefine((v, ctx) => {
    if (v.type === "choice" && !v.options)
      ctx.addIssue({ code: "custom", message: "choice needs options" });
    if (v.type === "checklist" && !v.items)
      ctx.addIssue({ code: "custom", message: "checklist needs items" });
    if (v.type !== "choice" && v.options)
      ctx.addIssue({ code: "custom", message: "options only valid for choice" });
    if (v.type !== "checklist" && v.items)
      ctx.addIssue({ code: "custom", message: "items only valid for checklist" });
  });
export const renameRequirementInput = z.object({ id: z.uuid(), label: requirementLabel });
export const deleteRequirementInput = z.object({ id: z.uuid() });
export const reorderRequirementsInput = z
  .object({ templateStageId: z.uuid(), requirementIds: z.array(z.uuid()).min(1) })
  .refine((v) => new Set(v.requirementIds).size === v.requirementIds.length, {
    message: "requirementIds must be unique",
  });
```

Append to `src/features/programs/schema.ts`:

```typescript
// Response writes. The discriminant is the requirement's type as rendered by
// the page; the DB re-derives and re-checks it (trust trigger + CHECK), so a
// lying client only manages to fail server-side.
const responseIds = { unitStageId: z.uuid(), requirementId: z.uuid() };
export const saveResponseInput = z.discriminatedUnion("type", [
  z.object({ ...responseIds, type: z.literal("text"), value: z.string().trim().min(1).max(2000) }),
  z.object({ ...responseIds, type: z.literal("choice"), value: z.string().trim().min(1).max(120) }),
  z.object({ ...responseIds, type: z.literal("number"), value: z.number().finite() }),
  z.object({ ...responseIds, type: z.literal("boolean"), value: z.boolean() }),
  z.object({
    ...responseIds,
    type: z.literal("date"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  }),
]);
export const clearResponseInput = z.object({ unitStageId: z.uuid(), requirementId: z.uuid() });
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/templates/schema.ts src/features/templates/schema.test.ts src/features/programs/schema.ts src/features/programs/schema.test.ts
git commit -m "feat(schemas): requirement + response inputs (slice 6)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Migration 0011 — RLS, grants, triggers, RPCs (integration-test-first)

**Files:**
- Test (create): `src/features/templates/requirements.rls.integration.test.ts`
- Test (create): `src/features/programs/requirements.integration.test.ts`
- Create: `src/db/migrations/0011_requirements_rls.sql`

**Interfaces:**
- Consumes: Task 1 tables; existing `create_program(p_template_id, p_name)`, `maintain_unit_stage_done_at()`, `user_orgs()`.
- Produces: DB behavior later tasks rely on — client inserts to `unit_stage_responses` carry ONLY `(unit_stage_id, program_stage_requirement_id, value_*)`; derivation maintains `unit_stages.status/done_source`; **`reorder_stage_requirements(p_template_stage_id uuid, p_requirement_ids uuid[])`** RPC; `create_program` copies + expands requirements.

- [ ] **Step 1: Write the template-side integration test**

Create `src/features/templates/requirements.rls.integration.test.ts`. Head matches the existing `rls.integration.test.ts` exactly (same imports, `loadEnvFile`, `admin`, `signedInUser`), then:

```typescript
describe("requirement RLS + reorder", () => {
  // ORDER-DEPENDENT like the sibling file: run sequentially, in file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let stageId: string;
  let reqIds: string[] = [];

  beforeAll(async () => {
    alice = await signedInUser("req_alice");
    bob = await signedInUser("req_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ReqAlpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "ReqBeta" });
    if (e2) throw e2;
    const { data: t } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Req Template" })
      .select("id")
      .single();
    const { data: s } = await alice
      .from("template_stages")
      .insert({ template_id: t!.id, org_id: aliceOrgId, name: "Inspect", position: 0 })
      .select("id")
      .single();
    stageId = s!.id;
  });

  it("a member creates requirements in their org", async () => {
    const rows = [
      { type: "text", label: "Notes", required: true, config: {}, position: 0 },
      { type: "date", label: "Valid until", required: false, config: {}, position: 1 },
    ].map((r) => ({ ...r, template_stage_id: stageId, org_id: aliceOrgId }));
    const { data, error } = await alice
      .from("template_stage_requirements")
      .insert(rows)
      .select("id");
    expect(error).toBeNull();
    reqIds = data!.map((r) => r.id);
  });

  it("the type CHECK rejects unknown types", async () => {
    const { error } = await alice.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: aliceOrgId,
      type: "video", label: "Nope", required: true, config: {}, position: 9,
    });
    expect(error).not.toBeNull();
  });

  it("a foreign member cannot read or write them", async () => {
    const { data: read } = await bob
      .from("template_stage_requirements")
      .select("id")
      .eq("template_stage_id", stageId);
    expect(read).toHaveLength(0);
    const { error: insertError } = await bob.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: aliceOrgId,
      type: "text", label: "Intrusion", required: true, config: {}, position: 5,
    });
    expect(insertError).not.toBeNull();
    const { data: upd } = await bob
      .from("template_stage_requirements")
      .update({ label: "Hijack" })
      .eq("id", reqIds[0])
      .select();
    expect(upd).toHaveLength(0);
  });

  it("org-mismatch insert is rejected by the guard trigger", async () => {
    // Bob supplies his own org_id but Alice's stage — the trigger compares
    // against the stage's true owner.
    const { data: bobOrg } = await bob.from("orgs").select("id").single();
    const { error } = await bob.from("template_stage_requirements").insert({
      template_stage_id: stageId, org_id: bobOrg!.id,
      type: "text", label: "Sneaky", required: true, config: {}, position: 5,
    });
    expect(error).not.toBeNull();
  });

  it("reorder works for the owner and rejects a foreign caller", async () => {
    const reversed = [...reqIds].reverse();
    const { error } = await alice.rpc("reorder_stage_requirements", {
      p_template_stage_id: stageId, p_requirement_ids: reversed,
    });
    expect(error).toBeNull();
    const { data: after } = await alice
      .from("template_stage_requirements")
      .select("id")
      .eq("template_stage_id", stageId)
      .order("position");
    expect(after!.map((r) => r.id)).toEqual(reversed);

    const { error: bobError } = await bob.rpc("reorder_stage_requirements", {
      p_template_stage_id: stageId, p_requirement_ids: reversed,
    });
    expect(bobError).not.toBeNull();
  });
});
```

- [ ] **Step 2: Write the program-side integration test**

Create `src/features/programs/requirements.integration.test.ts` — same harness head, then:

```typescript
type Req = { id: string; type: string; label: string; required: boolean; position: number; config: Record<string, unknown> };

describe("requirements: snapshot, trust, derivation, override", () => {
  // ORDER-DEPENDENT: sequential, file order.
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let orgId: string;
  let inspectStageId: string;   // program stage WITH requirements
  let signoffStageId: string;   // program stage WITHOUT requirements
  let inspectUnitStageId: string;
  let signoffUnitStageId: string;
  let reqs: Req[] = [];
  const byLabel = (label: string) => reqs.find((r) => r.label === label)!;

  beforeAll(async () => {
    alice = await signedInUser("der_alice");
    bob = await signedInUser("der_bob");
    const { data: org, error: e1 } = await alice.rpc("create_org", { p_name: "DerAlpha" });
    if (e1) throw e1;
    orgId = (org as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "DerBeta" });
    if (e2) throw e2;

    const { data: t } = await alice
      .from("templates").insert({ org_id: orgId, name: "Der Template" }).select("id").single();
    const { data: stages } = await alice
      .from("template_stages")
      .insert([
        { template_id: t!.id, org_id: orgId, name: "Inspect", position: 0 },
        { template_id: t!.id, org_id: orgId, name: "Sign-off", position: 1 },
      ])
      .select("id, name");
    const tplInspect = stages!.find((s) => s.name === "Inspect")!.id;
    const { error: reqError } = await alice.from("template_stage_requirements").insert([
      { template_stage_id: tplInspect, org_id: orgId, type: "text", label: "Notes", required: true, config: {}, position: 0 },
      { template_stage_id: tplInspect, org_id: orgId, type: "boolean", label: "Safe to operate", required: true, config: {}, position: 1 },
      { template_stage_id: tplInspect, org_id: orgId, type: "choice", label: "Route", required: true, config: { options: ["Front", "Rear"] }, position: 2 },
      { template_stage_id: tplInspect, org_id: orgId, type: "date", label: "Valid until", required: false, config: {}, position: 3 },
      { template_stage_id: tplInspect, org_id: orgId, type: "checklist", label: "Checks", required: true, config: { items: ["Power", "Clean"] }, position: 4 },
    ]);
    if (reqError) throw reqError;

    const { data: program, error: e3 } = await alice.rpc("create_program", {
      p_template_id: t!.id, p_name: "Der Program",
    });
    if (e3) throw e3;
    const programId = (program as { id: string }).id;

    const { data: pStages } = await alice
      .from("program_stages").select("id, name").eq("program_id", programId);
    inspectStageId = pStages!.find((s) => s.name === "Inspect")!.id;
    signoffStageId = pStages!.find((s) => s.name === "Sign-off")!.id;

    const { data: pReqs } = await alice
      .from("program_stage_requirements")
      .select("id, type, label, required, position, config")
      .eq("program_stage_id", inspectStageId)
      .order("position");
    reqs = pReqs as Req[];

    const { data: unit } = await alice
      .from("units")
      .insert({ program_id: programId, org_id: orgId, name: "Site 1" })
      .select("id, unit_stages(id, program_stage_id)")
      .single();
    inspectUnitStageId = unit!.unit_stages.find((us) => us.program_stage_id === inspectStageId)!.id;
    signoffUnitStageId = unit!.unit_stages.find((us) => us.program_stage_id === signoffStageId)!.id;
  });

  it("snapshot copies requirements and expands the checklist", () => {
    // 4 non-checklist + 2 expanded checklist items = 6, positions 0..5.
    expect(reqs).toHaveLength(6);
    expect(reqs.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(reqs.every((r) => r.type !== "checklist")).toBe(true);
    const power = byLabel("Checks · Power");
    const clean = byLabel("Checks · Clean");
    expect(power.type).toBe("boolean");
    expect(power.required).toBe(true);
    expect(power.config).toEqual({ group: "Checks" });
    expect(clean.type).toBe("boolean");
    expect(byLabel("Route").config).toEqual({ options: ["Front", "Rear"] });
  });

  it("later template edits do not leak into the program", async () => {
    // The template still has its 5 authored requirements; the program copy
    // stays at 6 expanded rows even after another template edit.
    const { data: t } = await alice.from("templates").select("id").eq("org_id", orgId).single();
    const { data: s } = await alice
      .from("template_stages").select("id").eq("template_id", t!.id).eq("name", "Inspect").single();
    await alice.from("template_stage_requirements").insert({
      template_stage_id: s!.id, org_id: orgId, type: "text", label: "Added later", required: true, config: {}, position: 9,
    });
    const { data: still } = await alice
      .from("program_stage_requirements").select("id").eq("program_stage_id", inspectStageId);
    expect(still).toHaveLength(6);
  });

  it("program_stage_requirements is immutable to API roles", async () => {
    const { error: insErr } = await alice.from("program_stage_requirements").insert({
      program_stage_id: inspectStageId, program_id: reqs[0].id, org_id: orgId,
      type: "text", label: "Sneak", required: true, config: {}, position: 99,
    });
    expect(insErr).not.toBeNull();
    const { error: updErr, data: updData } = await alice
      .from("program_stage_requirements")
      .update({ label: "Renamed" })
      .eq("id", reqs[0].id)
      .select();
    // Grant-level denial errors; policy-level denial returns 0 rows. Accept either.
    expect(updErr !== null || updData!.length === 0).toBe(true);
  });

  it("responses derive their denormalized columns and reject cross-stage pairs", async () => {
    const { data, error } = await alice
      .from("unit_stage_responses")
      .insert({
        unit_stage_id: inspectUnitStageId,
        program_stage_requirement_id: byLabel("Notes").id,
        value_text: "All fine",
      })
      .select("org_id, unit_id, program_id, type")
      .single();
    expect(error).toBeNull();
    expect(data!.org_id).toBe(orgId);
    expect(data!.type).toBe("text");

    // Same program, wrong stage: the sign-off unit_stage cannot answer an
    // Inspect requirement.
    const { error: crossErr } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: signoffUnitStageId,
      program_stage_requirement_id: byLabel("Route").id,
      value_text: "Front",
    });
    expect(crossErr).not.toBeNull();
  });

  it("the one-value CHECK rejects a wrong-typed value", async () => {
    const { error } = await alice.from("unit_stage_responses").insert({
      unit_stage_id: inspectUnitStageId,
      program_stage_requirement_id: byLabel("Route").id,
      value_number: 7, // choice wants value_text
    });
    expect(error).not.toBeNull();
  });

  it("derivation completes the stage only when all required are satisfied", async () => {
    const answer = (label: string, cols: Record<string, unknown>) =>
      alice.from("unit_stage_responses").upsert(
        {
          unit_stage_id: inspectUnitStageId,
          program_stage_requirement_id: byLabel(label).id,
          ...cols,
        },
        { onConflict: "unit_stage_id,program_stage_requirement_id" },
      );
    const stage = () =>
      alice.from("unit_stages").select("status, done_source").eq("id", inspectUnitStageId).single();

    // Notes answered in the previous test. Answer everything but leave one
    // checklist item false: still pending.
    expect((await answer("Route", { value_text: "Front" })).error).toBeNull();
    expect((await answer("Safe to operate", { value_bool: true })).error).toBeNull();
    expect((await answer("Checks · Power", { value_bool: true })).error).toBeNull();
    expect((await answer("Checks · Clean", { value_bool: false })).error).toBeNull();
    let s = (await stage()).data!;
    expect(s.status).toBe("pending"); // boolean false is not satisfied

    expect((await answer("Checks · Clean", { value_bool: true })).error).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("done");
    expect(s.done_source).toBe("requirements"); // optional date never blocked

    // Removing a required answer reopens.
    const { error: delErr } = await alice
      .from("unit_stage_responses")
      .delete()
      .eq("unit_stage_id", inspectUnitStageId)
      .eq("program_stage_requirement_id", byLabel("Route").id);
    expect(delErr).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("pending");
    expect(s.done_source).toBeNull();

    expect((await answer("Route", { value_text: "Rear" })).error).toBeNull();
    s = (await stage()).data!;
    expect(s.status).toBe("done");
  });

  it("a status write without responses is recorded as an override", async () => {
    const { error } = await alice
      .from("unit_stages").update({ status: "done" }).eq("id", signoffUnitStageId);
    expect(error).toBeNull();
    const { data } = await alice
      .from("unit_stages").select("status, done_source").eq("id", signoffUnitStageId).single();
    expect(data!.status).toBe("done");
    expect(data!.done_source).toBe("override");

    // Reopen clears the source.
    await alice.from("unit_stages").update({ status: "pending" }).eq("id", signoffUnitStageId);
    const { data: after } = await alice
      .from("unit_stages").select("done_source").eq("id", signoffUnitStageId).single();
    expect(after!.done_source).toBeNull();
  });

  it("clients cannot write done_source directly", async () => {
    const { error } = await alice
      .from("unit_stages")
      .update({ done_source: "requirements" })
      .eq("id", signoffUnitStageId);
    expect(error).not.toBeNull(); // no column grant
  });

  it("a foreign member sees and writes nothing", async () => {
    const { data } = await bob
      .from("unit_stage_responses").select("id").eq("unit_stage_id", inspectUnitStageId);
    expect(data).toHaveLength(0);
    const { error } = await bob.from("unit_stage_responses").insert({
      unit_stage_id: inspectUnitStageId,
      program_stage_requirement_id: byLabel("Notes").id,
      value_text: "intrusion",
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run both to verify failure**

Run: `npm run test:integration`
Expected: the two new files FAIL (missing policies/grants/trigger/RPC — e.g. permission denied / function does not exist). The three pre-existing files still PASS.

- [ ] **Step 4: Write `src/db/migrations/0011_requirements_rls.sql`**

```bash
npx drizzle-kit generate --custom --name=requirements_rls
```

Then replace the generated file's contents with:

```sql
-- Custom SQL migration file, put your code below! --

-- Requirements security model (slice 6):
--   * template_stage_requirements: ordinary member-writable rows
--     (the template_stages precedent) + org-guard trigger + touch trigger.
--   * program_stage_requirements: IMMUTABLE — select-only for both API
--     roles; written only inside create_program (program_stages precedent).
--   * unit_stage_responses: member-writable VALUES ONLY. Clients hold
--     column-scoped grants on the id pair + value columns; a definer
--     BEFORE trigger derives unit_id/program_id/org_id/type from the
--     parent rows and validates the (unit_stage, requirement) pair.
--   * unit_stages.status becomes DERIVED when requirements exist: an
--     AFTER trigger on responses recomputes it (done_source='requirements').
--     A bare status write (the existing staff toggle) is recorded as
--     done_source='override' by the extended maintain trigger.
-- Grants are explicit per table (0004 convention).

-- ---------- CHECKs (kept here with policies/grants, the 0008 pattern)
alter table public.template_stage_requirements
  add constraint template_stage_requirements_type_check
  check (type in ('text','number','boolean','date','choice','checklist','photo'));
alter table public.program_stage_requirements
  add constraint program_stage_requirements_type_check
  check (type in ('text','number','boolean','date','choice','photo'));
alter table public.unit_stage_responses
  add constraint unit_stage_responses_type_check
  check (type in ('text','number','boolean','date','choice'));
alter table public.unit_stage_responses
  add constraint unit_stage_responses_one_value_check
  check (
    (type in ('text','choice') and value_text is not null
      and value_number is null and value_bool is null and value_date is null)
    or (type = 'number' and value_number is not null
      and value_text is null and value_bool is null and value_date is null)
    or (type = 'boolean' and value_bool is not null
      and value_text is null and value_number is null and value_date is null)
    or (type = 'date' and value_date is not null
      and value_text is null and value_number is null and value_bool is null)
  );
alter table public.unit_stages
  add constraint unit_stages_done_source_check
  check (done_source in ('requirements','override'));

-- ---------- RLS
alter table public.template_stage_requirements enable row level security;
alter table public.program_stage_requirements enable row level security;
alter table public.unit_stage_responses enable row level security;

create policy "template_stage_requirements_select_member" on public.template_stage_requirements
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_insert_member" on public.template_stage_requirements
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_update_member" on public.template_stage_requirements
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "template_stage_requirements_delete_member" on public.template_stage_requirements
  for delete to authenticated using (org_id in (select public.user_orgs()));

create policy "program_stage_requirements_select_member" on public.program_stage_requirements
  for select to authenticated using (org_id in (select public.user_orgs()));

create policy "unit_stage_responses_select_member" on public.unit_stage_responses
  for select to authenticated using (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_insert_member" on public.unit_stage_responses
  for insert to authenticated with check (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_update_member" on public.unit_stage_responses
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "unit_stage_responses_delete_member" on public.unit_stage_responses
  for delete to authenticated using (org_id in (select public.user_orgs()));

-- ---------- Grants (explicit, 0004 convention)
grant select, insert, update, delete on table public.template_stage_requirements to authenticated;
grant select, insert, update, delete on table public.template_stage_requirements to service_role;
grant select on table public.program_stage_requirements to authenticated;
grant select on table public.program_stage_requirements to service_role;
-- Responses: the id pair appears in BOTH insert and update grants because
-- PostgREST upsert's conflict-UPDATE branch sets every supplied column;
-- repointing is still safe — the prepare trigger re-validates the pair and
-- the derive trigger recomputes BOTH affected unit_stages.
grant select, delete on table public.unit_stage_responses to authenticated;
grant insert (unit_stage_id, program_stage_requirement_id, value_text, value_number, value_bool, value_date)
  on table public.unit_stage_responses to authenticated;
grant update (unit_stage_id, program_stage_requirement_id, value_text, value_number, value_bool, value_date)
  on table public.unit_stage_responses to authenticated;
grant select on table public.unit_stage_responses to service_role;

-- ---------- template_stage_requirements guards (0003 patterns)
create or replace function public.check_template_stage_requirement_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_stage_org uuid;
begin
  select org_id into v_stage_org
    from public.template_stages
   where id = new.template_stage_id;
  if v_stage_org is null then
    raise exception 'stage not found';
  end if;
  if v_stage_org <> new.org_id then
    raise exception 'org mismatch';
  end if;
  return new;
end;
$$;

create trigger template_stage_requirements_check_org
before insert or update of template_stage_id, org_id on public.template_stage_requirements
for each row execute function public.check_template_stage_requirement_org();

-- Freshness: requirement edits touch the parent template's updated_at.
create or replace function public.touch_template_via_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.templates t
     set updated_at = now()
    from public.template_stages ts
   where ts.id = coalesce(new.template_stage_id, old.template_stage_id)
     and t.id = ts.template_id;
  return coalesce(new, old);
end;
$$;

create trigger template_stage_requirements_touch_parent
after insert or update or delete on public.template_stage_requirements
for each row execute function public.touch_template_via_stage();

-- ---------- reorder RPC (mirror of reorder_stages: invoker, strict id set)
create or replace function public.reorder_stage_requirements(p_template_stage_id uuid, p_requirement_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.template_stage_requirements
   where template_stage_id = p_template_stage_id;

  if v_count = 0 then
    raise exception 'stage not found';
  end if;

  if v_count <> coalesce(array_length(p_requirement_ids, 1), 0)
     or v_count <> (select count(distinct r.id) from unnest(p_requirement_ids) as r(id))
     or exists (
       select 1 from unnest(p_requirement_ids) as r(id)
        where not exists (
          select 1 from public.template_stage_requirements tr
           where tr.id = r.id and tr.template_stage_id = p_template_stage_id))
  then
    raise exception 'requirement ids do not match stage';
  end if;

  update public.template_stage_requirements tr
     set position = u.ord - 1
    from unnest(p_requirement_ids) with ordinality as u(id, ord)
   where tr.id = u.id;
end;
$$;

grant execute on function public.reorder_stage_requirements(uuid, uuid[]) to authenticated;

-- ---------- response trust trigger
-- SECURITY DEFINER so the parent lookups see the real rows; the INSERT/
-- UPDATE statement itself still runs as the caller, so RLS WITH CHECK on
-- the derived org_id is what enforces membership (a foreign unit_stage_id
-- derives a foreign org_id and the write dies at the policy).
create or replace function public.prepare_unit_stage_response()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_us record;
  v_req record;
begin
  select unit_id, program_stage_id, program_id, org_id into v_us
    from public.unit_stages where id = new.unit_stage_id;
  if v_us.unit_id is null then
    raise exception 'unit stage not found';
  end if;
  select program_stage_id, type into v_req
    from public.program_stage_requirements
   where id = new.program_stage_requirement_id;
  if v_req.program_stage_id is null or v_req.program_stage_id <> v_us.program_stage_id then
    raise exception 'requirement not found';
  end if;
  new.unit_id := v_us.unit_id;
  new.program_id := v_us.program_id;
  new.org_id := v_us.org_id;
  new.type := v_req.type;
  new.answered_by_user_id := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger unit_stage_responses_prepare
before insert or update on public.unit_stage_responses
for each row execute function public.prepare_unit_stage_response();

-- ---------- derivation
-- Recomputes a unit_stage from its responses. A stage derives ONLY when it
-- has >=1 required requirement — zero-requirement (and all-optional) stages
-- stay on the manual toggle, else they would be born 'done'.
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
                            and (r.type <> 'boolean' or resp.value_bool))
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

create or replace function public.derive_unit_stage_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.derive_unit_stage(coalesce(new.unit_stage_id, old.unit_stage_id));
  -- An upsert-repoint moves an answer between unit_stages: recompute the
  -- one it left as well.
  if tg_op = 'UPDATE' and old.unit_stage_id <> new.unit_stage_id then
    perform public.derive_unit_stage(old.unit_stage_id);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger unit_stage_responses_derive
after insert or update or delete on public.unit_stage_responses
for each row execute function public.derive_unit_stage_status();

-- ---------- done_source bookkeeping (extends the 0008 done_at trigger)
-- Only derive_unit_stage ever writes done_source explicitly; a status flip
-- arriving WITHOUT one is by definition a staff override. Clients hold no
-- done_source grant, so they cannot fake the 'requirements' provenance.
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
  if new.status is distinct from old.status
     and new.done_source is not distinct from old.done_source then
    new.done_source := case when new.status = 'done' then 'override' else null end;
  end if;
  return new;
end;
$$;
-- (trigger unit_stages_done_at from 0008 already calls this function on
-- BEFORE UPDATE OF status — no new trigger needed.)

-- ---------- create_program: copy + expand requirements
-- Body is 0009's create_program with one addition: the requirements insert.
-- The stage CTE maps template stages to their new program stages by the
-- shared re-numbered position.
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
  -- Requirements: verbatim copy, except checklists explode into one boolean
  -- per config item (label "<checklist> · <item>", config {group}), ordered
  -- by (source position, item order) and re-numbered 0..n-1 per stage.
  insert into public.program_stage_requirements
    (program_stage_id, program_id, org_id, type, label, required, config, position)
  select i.id, v_program.id, v_template.org_id, e.type, e.label, e.required, e.config,
         row_number() over (partition by i.id order by e.src_pos, e.item_ord, e.src_id) - 1
    from numbered n
    join inserted i on i.position = n.pos
    join lateral (
      select r.id as src_id, r.position as src_pos, 0::bigint as item_ord,
             r.type, r.label, r.required, r.config
        from public.template_stage_requirements r
       where r.template_stage_id = n.template_stage_id and r.type <> 'checklist'
      union all
      select r.id, r.position, it.ord, 'boolean',
             r.label || ' · ' || it.item, r.required,
             jsonb_build_object('group', r.label)
        from public.template_stage_requirements r
        cross join lateral jsonb_array_elements_text(r.config->'items')
                   with ordinality as it(item, ord)
       where r.template_stage_id = n.template_stage_id and r.type = 'checklist'
    ) e on true;

  return v_program;
end;
$$;
```

- [ ] **Step 5: Migrate and re-run integration tests**

```bash
npm run db:migrate
npm run test:integration
```

Expected: all five integration files PASS. Then `npm run db:generate` → "No schema changes".

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations src/features/templates/requirements.rls.integration.test.ts src/features/programs/requirements.integration.test.ts
git commit -m "feat(db): requirements RLS/grants, trust + derivation triggers, snapshot expansion (0011)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Template requirement editor

**Files:**
- Modify: `src/features/templates/queries.ts` (Stage gains requirements)
- Modify: `src/features/templates/actions.ts` (4 new actions)
- Create: `src/features/templates/components/requirement-list.tsx`, `requirement-row.tsx`, `add-requirement.tsx`
- Modify: `src/features/templates/components/stage-list.tsx`

**Interfaces:**
- Consumes: Task 2 inputs; Task 3 RPC `reorder_stage_requirements`; table `template_stage_requirements`.
- Produces: `Requirement` type `{ id; type; label; required; config: { options?: string[]; items?: string[] }; position }`; `Stage` gains `requirements: Requirement[]`; actions `addRequirement`, `renameRequirement`, `deleteRequirement`, `reorderRequirements` (all `(input: unknown) => Promise<TemplateActionState>`).

- [ ] **Step 1: Extend `getTemplate` in `src/features/templates/queries.ts`**

```typescript
export type Requirement = {
  id: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "checklist" | "photo";
  label: string;
  required: boolean;
  config: { options?: string[]; items?: string[] };
  position: number;
};

export type Stage = { id: string; name: string; position: number; requirements: Requirement[] };
```

In `getTemplate`, change the select to embed requirements and sort them:

```typescript
    .select(
      "id, name, description, updated_at, template_stages(id, name, position, template_stage_requirements(id, type, label, required, config, position))",
    )
```

and map:

```typescript
    stages: [...data.template_stages]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((s) => ({
        id: s.id,
        name: s.name,
        position: s.position,
        requirements: [...s.template_stage_requirements].sort(
          (a, b) => a.position - b.position || a.id.localeCompare(b.id),
        ) as Requirement[],
      })),
```

(`listTemplates` is untouched.)

- [ ] **Step 2: Add the four actions to `src/features/templates/actions.ts`**

Import the new inputs from `./schema`, then append (mirrors `addStage`/`renameStage`/`deleteStage`/`reorderStages` exactly):

```typescript
export async function addRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = addRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as the tenancy/org_id source; RLS hides foreign rows.
  const { data: stage } = await supabase
    .from("template_stages")
    .select("id, org_id, template_id, template_stage_requirements(position)")
    .eq("id", parsed.data.templateStageId)
    .maybeSingle();
  if (!stage) return fail("addRequirement", "stage not visible");

  const nextPosition =
    stage.template_stage_requirements.reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const config =
    parsed.data.type === "choice"
      ? { options: parsed.data.options }
      : parsed.data.type === "checklist"
        ? { items: parsed.data.items }
        : {};

  const { error } = await supabase.from("template_stage_requirements").insert({
    template_stage_id: stage.id,
    org_id: stage.org_id,
    type: parsed.data.type,
    label: parsed.data.label,
    required: parsed.data.required,
    config,
    position: nextPosition,
  });
  if (error) return fail("addRequirement", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${stage.template_id}`);
  return { ok: true };
}

export async function renameRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = renameRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_stage_requirements")
    .update({ label: parsed.data.label })
    .eq("id", parsed.data.id)
    .select("template_stage_id, template_stages(template_id)")
    .maybeSingle();
  if (error || !data) return fail("renameRequirement", error ?? "requirement not visible");
  revalidatePath("/templates");
  revalidatePath(`/templates/${(data.template_stages as { template_id: string }).template_id}`);
  return { ok: true };
}

export async function deleteRequirement(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteRequirementInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Plain delete — position gaps are harmless under ORDER BY position, id.
  const { data, error } = await supabase
    .from("template_stage_requirements")
    .delete()
    .eq("id", parsed.data.id)
    .select("template_stage_id, template_stages(template_id)")
    .maybeSingle();
  if (error || !data) return fail("deleteRequirement", error ?? "requirement not visible");
  revalidatePath("/templates");
  revalidatePath(`/templates/${(data.template_stages as { template_id: string }).template_id}`);
  return { ok: true };
}

export async function reorderRequirements(input: unknown): Promise<TemplateActionState> {
  const parsed = reorderRequirementsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_stage_requirements", {
    p_template_stage_id: parsed.data.templateStageId,
    p_requirement_ids: parsed.data.requirementIds,
  });
  if (error) return fail("reorderRequirements", error);
  const { data: stage } = await supabase
    .from("template_stages")
    .select("template_id")
    .eq("id", parsed.data.templateStageId)
    .maybeSingle();
  revalidatePath("/templates");
  if (stage) revalidatePath(`/templates/${stage.template_id}`);
  return { ok: true };
}
```

- [ ] **Step 3: Create `src/features/templates/components/requirement-row.tsx`**

```tsx
"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Requirement } from "@/features/templates/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RequirementRow({
  requirement,
  isFirst,
  isLast,
  moveDisabled,
  onRename,
  onDelete,
  onMove,
}: {
  requirement: Requirement;
  isFirst: boolean;
  isLast: boolean;
  moveDisabled: boolean;
  onRename: (label: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  // Keyed remount at the call site re-derives this on server-truth change
  // (react-hooks/set-state-in-effect convention).
  const [value, setValue] = React.useState(requirement.label);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === requirement.label) {
      setValue(requirement.label);
      return;
    }
    onRename(next);
  };

  const detail =
    requirement.type === "choice"
      ? (requirement.config.options ?? []).join(" / ")
      : requirement.type === "checklist"
        ? `${(requirement.config.items ?? []).length} items`
        : null;

  return (
    <li className="group flex items-center gap-1 rounded-md border border-dashed px-2 py-0.5">
      <div className="flex flex-col">
        <Button
          variant="ghost" size="icon" className="size-5"
          aria-label={`Move ${requirement.label} up`}
          disabled={isFirst || moveDisabled} onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-3" />
        </Button>
        <Button
          variant="ghost" size="icon" className="size-5"
          aria-label={`Move ${requirement.label} down`}
          disabled={isLast || moveDisabled} onClick={() => onMove(1)}
        >
          <ChevronDown className="size-3" />
        </Button>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={120}
        aria-label={`Requirement label: ${requirement.label}`}
        className="h-7 border-transparent text-sm shadow-none focus-visible:border-input"
      />
      <Badge variant="secondary" className="shrink-0 font-mono text-[10px]">
        {requirement.type}
      </Badge>
      {requirement.required ? null : (
        <span className="text-muted-foreground shrink-0 text-[10px]">optional</span>
      )}
      {detail ? (
        <span className="text-muted-foreground max-w-32 shrink-0 truncate text-[10px]" title={detail}>
          {detail}
        </span>
      ) : null}
      <Button
        variant="ghost" size="icon"
        className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${requirement.label}`} onClick={onDelete}
      >
        <Trash2 className="size-3" />
      </Button>
    </li>
  );
}
```

- [ ] **Step 4: Create `src/features/templates/components/add-requirement.tsx`**

```tsx
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { Requirement } from "@/features/templates/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const TYPES = ["text", "number", "boolean", "date", "choice", "checklist"] as const;
export type EditorType = (typeof TYPES)[number];

export function AddRequirement({
  onAdd,
}: {
  onAdd: (r: {
    type: EditorType;
    label: string;
    required: boolean;
    options?: string[];
    items?: string[];
    config: Requirement["config"];
  }) => void;
}) {
  const [label, setLabel] = React.useState("");
  const [type, setType] = React.useState<EditorType>("text");
  const [required, setRequired] = React.useState(true);
  const [lines, setLines] = React.useState("");

  const needsLines = type === "choice" || type === "checklist";
  const parsedLines = lines.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const linesValid = !needsLines || parsedLines.length >= (type === "choice" ? 2 : 1);
  const valid = label.trim() !== "" && linesValid;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onAdd({
      type,
      label: label.trim(),
      required,
      options: type === "choice" ? parsedLines : undefined,
      items: type === "checklist" ? parsedLines : undefined,
      config:
        type === "choice"
          ? { options: parsedLines }
          : type === "checklist"
            ? { items: parsedLines }
            : {},
    });
    setLabel("");
    setLines("");
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 pl-7">
      <div className="flex items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a requirement…"
          maxLength={120}
          aria-label="New requirement label"
          className="h-7 text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EditorType)}
          aria-label="Requirement type"
          className="border-input bg-transparent h-7 shrink-0 rounded-md border px-2 text-xs"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <label className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            aria-label="Required"
          />
          required
        </label>
        <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      {needsLines ? (
        <Textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          placeholder={type === "choice" ? "One option per line (min 2)" : "One checklist item per line"}
          aria-label={type === "choice" ? "Choice options" : "Checklist items"}
          rows={3}
          className="text-sm"
        />
      ) : null}
    </form>
  );
}
```

- [ ] **Step 5: Create `src/features/templates/components/requirement-list.tsx`**

```tsx
"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import {
  addRequirement,
  renameRequirement,
  deleteRequirement,
  reorderRequirements,
} from "@/features/templates/actions";
import type { Requirement } from "@/features/templates/queries";
import { RequirementRow } from "./requirement-row";
import { AddRequirement } from "./add-requirement";

// Same optimistic convention as stage-list.tsx, scoped to one stage's
// requirements. See stage-list.tsx for why only moves need isPending.
type RequirementEvent =
  | { type: "add"; requirement: Requirement }
  | { type: "rename"; id: string; label: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 };

function applyEvent(reqs: Requirement[], event: RequirementEvent): Requirement[] {
  switch (event.type) {
    case "add":
      return [...reqs, event.requirement];
    case "rename":
      return reqs.map((r) => (r.id === event.id ? { ...r, label: event.label } : r));
    case "delete":
      return reqs.filter((r) => r.id !== event.id);
    case "move": {
      const index = reqs.findIndex((r) => r.id === event.id);
      const target = index + event.direction;
      if (index < 0 || target < 0 || target >= reqs.length) return reqs;
      const next = [...reqs];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((r, i) => ({ ...r, position: i }));
    }
  }
}

export function RequirementList({
  templateStageId,
  requirements,
}: {
  templateStageId: string;
  requirements: Requirement[];
}) {
  const [optimistic, dispatch] = useOptimistic(requirements, applyEvent);
  const [isPending, startTransition] = React.useTransition();

  const run = (event: RequirementEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const onMove = (id: string, direction: -1 | 1) => {
    const moved = applyEvent(optimistic, { type: "move", id, direction });
    run({ type: "move", id, direction }, () =>
      reorderRequirements({ templateStageId, requirementIds: moved.map((r) => r.id) }),
    );
  };

  return (
    <div className="flex flex-col gap-1.5 pt-1.5">
      <ol className="flex flex-col gap-1 pl-7">
        {optimistic.map((r, index) => (
          <RequirementRow
            key={`${r.id}:${r.label}`}
            requirement={r}
            isFirst={index === 0}
            isLast={index === optimistic.length - 1}
            moveDisabled={isPending}
            onRename={(label) =>
              run({ type: "rename", id: r.id, label }, () =>
                renameRequirement({ id: r.id, label }),
              )
            }
            onDelete={() => run({ type: "delete", id: r.id }, () => deleteRequirement({ id: r.id }))}
            onMove={(direction) => onMove(r.id, direction)}
          />
        ))}
      </ol>
      <AddRequirement
        onAdd={({ type, label, required, options, items, config }) =>
          run(
            {
              type: "add",
              requirement: {
                id: crypto.randomUUID(),
                type,
                label,
                required,
                config,
                position: optimistic.reduce((max, r) => Math.max(max, r.position), -1) + 1,
              },
            },
            () => addRequirement({ templateStageId, type, label, required, options, items }),
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 6: Render it per stage in `stage-list.tsx`**

Import `RequirementList`. In the render, wrap each `StageRow` so the requirements sit under it (the `<ol>` items become a row + its requirements):

```tsx
        {optimistic.map((stage, index) => (
          <li key={`${stage.id}:${stage.name}`} className="flex flex-col">
            <StageRow
              stage={stage}
              ...same props as today (isFirst/isLast/moveDisabled/onRename/onDelete/onMove)
            />
            <RequirementList templateStageId={stage.id} requirements={stage.requirements} />
          </li>
        ))}
```

`StageRow`'s own root element changes from `<li>` to `<div>` (it now nests inside the new `<li>`) — update `stage-row.tsx`'s root tag accordingly. The keyed remount moves to the new `<li>`.

- [ ] **Step 7: Verify**

```bash
npm run verify
```

Expected: PASS (lint, typecheck, unit tests). Then a quick manual check: `npm run dev`, open `/templates`, open the demo template, add a `choice` requirement with two options, rename it, reorder, delete — every mutation applies instantly and survives refresh.

- [ ] **Step 8: Commit**

```bash
git add src/features/templates
git commit -m "feat(templates): requirement editor — add/rename/delete/reorder per stage

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Unit detail page — fill-in + override

**Files:**
- Modify: `src/features/programs/queries.ts` (+`getUnit`)
- Modify: `src/features/programs/actions.ts` (+`saveResponse`, `clearResponse`; extend `setUnitStageStatus` revalidation)
- Create: `src/features/programs/components/unit-stage-sections.tsx`
- Create: `src/app/(dashboard)/programs/[id]/units/[unitId]/page.tsx`

**Interfaces:**
- Consumes: Task 2 `saveResponseInput`/`clearResponseInput`; Task 3 DB behavior; existing `setUnitStageStatus`.
- Produces: `getUnit(programId: string, unitId: string): Promise<UnitDetail | null>` with `UnitDetail = { id; name; externalRef; programId; programName; stages: StageSection[] }`, `StageSection = { unitStageId; programStageId; name; position; status: "pending" | "done"; doneSource: "requirements" | "override" | null; requirements: SectionRequirement[] }`, `SectionRequirement = { id; type: "text"|"number"|"boolean"|"date"|"choice"|"photo"; label; required; config: { options?: string[]; group?: string }; value: string | number | boolean | null }`. Actions `saveResponse(input)`, `clearResponse(input)` → `ActionState`.

- [ ] **Step 1: Add `getUnit` to `src/features/programs/queries.ts`**

```typescript
export type SectionRequirement = {
  id: string;
  type: "text" | "number" | "boolean" | "date" | "choice" | "photo";
  label: string;
  required: boolean;
  config: { options?: string[]; group?: string };
  // The stored answer, normalized: string (text/choice/date), number, boolean, or null.
  value: string | number | boolean | null;
};

export type StageSection = {
  unitStageId: string;
  programStageId: string;
  name: string;
  position: number;
  status: "pending" | "done";
  doneSource: "requirements" | "override" | null;
  requirements: SectionRequirement[];
};

export type UnitDetail = {
  id: string;
  name: string;
  externalRef: string | null;
  programId: string;
  programName: string;
  stages: StageSection[];
};

export async function getUnit(programId: string, unitId: string): Promise<UnitDetail | null> {
  const supabase = await createClient();
  const { data: unit, error } = await supabase
    .from("units")
    .select(
      "id, name, external_ref, program_id, programs(name), unit_stages(id, program_stage_id, status, done_source)",
    )
    .eq("id", unitId)
    .eq("program_id", programId)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return null;

  const [{ data: stages, error: e1 }, { data: reqs, error: e2 }, { data: resps, error: e3 }] =
    await Promise.all([
      supabase.from("program_stages").select("id, name, position").eq("program_id", programId),
      supabase
        .from("program_stage_requirements")
        .select("id, program_stage_id, type, label, required, config, position")
        .eq("program_id", programId),
      supabase
        .from("unit_stage_responses")
        .select("program_stage_requirement_id, type, value_text, value_number, value_bool, value_date")
        .eq("unit_id", unitId),
    ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;

  type RespRow = NonNullable<typeof resps>[number];
  // PostgREST serializes numeric as a string — normalize here, once.
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
    externalRef: unit.external_ref,
    programId: unit.program_id,
    programName: (unit.programs as { name: string } | null)?.name ?? "Program",
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
              type: r.type as SectionRequirement["type"],
              label: r.label,
              required: r.required,
              config: (r.config ?? {}) as SectionRequirement["config"],
              value: responseByReq.get(r.id) ?? null,
            })),
        }];
      }),
  };
}
```

- [ ] **Step 2: Add response actions to `src/features/programs/actions.ts`**

Import `saveResponseInput`, `clearResponseInput` from `./schema`, then append:

```typescript
export async function saveResponse(input: unknown): Promise<ActionState> {
  const parsed = saveResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const d = parsed.data;
  const values = {
    value_text: d.type === "text" || d.type === "choice" ? d.value : null,
    value_number: d.type === "number" ? d.value : null,
    value_bool: d.type === "boolean" ? d.value : null,
    value_date: d.type === "date" ? d.value : null,
  };
  const supabase = await createClient();
  // The trust trigger derives org/unit/program/type and validates the pair;
  // the conflict target is the (unit_stage, requirement) uniqueness.
  const { data, error } = await supabase
    .from("unit_stage_responses")
    .upsert(
      {
        unit_stage_id: d.unitStageId,
        program_stage_requirement_id: d.requirementId,
        ...values,
      },
      { onConflict: "unit_stage_id,program_stage_requirement_id" },
    )
    .select("program_id, unit_id")
    .maybeSingle();
  if (error || !data) return fail("saveResponse", error ?? "response not visible");
  revalidatePath(`/programs/${data.program_id}`);
  revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
  return { ok: true };
}

export async function clearResponse(input: unknown): Promise<ActionState> {
  const parsed = clearResponseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_stage_responses")
    .delete()
    .eq("unit_stage_id", parsed.data.unitStageId)
    .eq("program_stage_requirement_id", parsed.data.requirementId)
    .select("program_id, unit_id")
    .maybeSingle();
  if (error) return fail("clearResponse", error);
  // Deleting an absent response is a no-op success (idempotent clear).
  if (data) {
    revalidatePath(`/programs/${data.program_id}`);
    revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
  }
  return { ok: true };
}
```

In `setUnitStageStatus`, change `.select("program_id")` to `.select("program_id, unit_id")` and add after the existing revalidations:

```typescript
  revalidatePath(`/programs/${data.program_id}/units/${data.unit_id}`);
```

- [ ] **Step 3: Create `src/features/programs/components/unit-stage-sections.tsx`**

```tsx
"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { saveResponse, clearResponse, setUnitStageStatus } from "@/features/programs/actions";
import type { SectionRequirement, StageSection } from "@/features/programs/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Optimistic convention (features/README.md), with a twist: the reducer
// mirrors the DB derivation rule so the status chip flips without waiting
// for the round-trip. The server remains the truth on revalidation.
type SectionEvent =
  | { type: "setValue"; unitStageId: string; requirementId: string; value: string | number | boolean }
  | { type: "clear"; unitStageId: string; requirementId: string }
  | { type: "override"; unitStageId: string; done: boolean };

function derive(section: StageSection): StageSection {
  const required = section.requirements.filter((r) => r.required && r.type !== "photo");
  if (required.length === 0) return section; // manual stage — leave as-is
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
      case "override":
        return {
          ...s,
          status: event.done ? "done" : "pending",
          doneSource: event.done ? "override" : null,
        };
    }
  });
}

function RequirementField({
  requirement,
  onSave,
  onClear,
}: {
  requirement: SectionRequirement;
  onSave: (value: string | number | boolean) => void;
  onClear: () => void;
}) {
  const r = requirement;
  const inputId = `req-${r.id}`;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={inputId} className="w-56 shrink-0 truncate text-sm" title={r.label}>
        {r.label}
        {r.required ? null : <span className="text-muted-foreground"> (optional)</span>}
      </label>
      {r.type === "boolean" ? (
        <input
          id={inputId}
          type="checkbox"
          checked={r.value === true}
          onChange={(e) => onSave(e.target.checked)}
          className="size-4"
        />
      ) : r.type === "choice" ? (
        <select
          id={inputId}
          value={typeof r.value === "string" ? r.value : ""}
          onChange={(e) => e.target.value !== "" && onSave(e.target.value)}
          className="border-input bg-transparent h-8 rounded-md border px-2 text-sm"
        >
          <option value="" disabled>Choose…</option>
          {(r.config.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : r.type === "photo" ? (
        <span className="text-muted-foreground text-xs">photo evidence arrives in a later release</span>
      ) : (
        // text | number | date share the commit-on-blur Input. Keyed remount
        // (call site) re-derives defaultValue when the server truth changes.
        <Input
          id={inputId}
          type={r.type === "number" ? "number" : r.type === "date" ? "date" : "text"}
          step={r.type === "number" ? "any" : undefined}
          defaultValue={r.value === null ? "" : String(r.value)}
          onBlur={(e) => {
            const raw = e.target.value.trim();
            if (raw === "" || raw === String(r.value ?? "")) return;
            if (r.type === "number") {
              const n = Number(raw);
              if (!Number.isFinite(n)) return;
              onSave(n);
            } else {
              onSave(raw);
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-8 max-w-64 text-sm"
        />
      )}
      {r.value !== null && r.type !== "photo" ? (
        <Button
          variant="ghost" size="icon" className="size-6"
          aria-label={`Clear ${r.label}`} onClick={onClear}
        >
          <Trash2 className="size-3" />
        </Button>
      ) : null}
    </div>
  );
}

export function UnitStageSections({ sections }: { sections: StageSection[] }) {
  const [optimistic, dispatch] = useOptimistic(sections, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: SectionEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  return (
    <div className="flex flex-col gap-6">
      {optimistic.map((s) => {
        const required = s.requirements.filter((r) => r.required && r.type !== "photo");
        const satisfied = required.filter((r) =>
          r.type === "boolean" ? r.value === true : r.value !== null && r.value !== "",
        ).length;
        const isManual = required.length === 0;
        return (
          <section
            key={s.unitStageId}
            id={`stage-${s.programStageId}`}
            className="flex scroll-mt-20 flex-col gap-3 rounded-lg border p-4"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">{s.name}</h2>
              {s.status === "done" ? (
                <Badge variant="secondary" className="text-[10px]">
                  done · {s.doneSource === "override" ? "override" : "requirements"}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  {isManual ? "pending" : `pending · ${satisfied}/${required.length}`}
                </Badge>
              )}
              <div className="ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    run({ type: "override", unitStageId: s.unitStageId, done: s.status !== "done" }, () =>
                      setUnitStageStatus({ id: s.unitStageId, done: s.status !== "done" }),
                    )
                  }
                >
                  {s.status === "done" ? "Reopen" : isManual ? "Mark done" : "Mark done anyway"}
                </Button>
              </div>
            </div>
            {s.requirements.length === 0 ? (
              <p className="text-muted-foreground text-sm">No requirements — this stage is completed by hand.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {s.requirements.map((r) => (
                  <RequirementField
                    // Keyed remount on server-truth change (convention).
                    key={`${r.id}:${String(r.value)}`}
                    requirement={r}
                    onSave={(value) =>
                      run(
                        { type: "setValue", unitStageId: s.unitStageId, requirementId: r.id, value },
                        () =>
                          saveResponse({
                            unitStageId: s.unitStageId,
                            requirementId: r.id,
                            type: r.type as Exclude<SectionRequirement["type"], "photo">,
                            value,
                          }),
                      )
                    }
                    onClear={() =>
                      run({ type: "clear", unitStageId: s.unitStageId, requirementId: r.id }, () =>
                        clearResponse({ unitStageId: s.unitStageId, requirementId: r.id }),
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

- [ ] **Step 4: Create `src/app/(dashboard)/programs/[id]/units/[unitId]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getUnit } from "@/features/programs/queries";
import { UnitStageSections } from "@/features/programs/components/unit-stage-sections";

export default async function UnitDetailPage({
  params,
}: PageProps<"/programs/[id]/units/[unitId]">) {
  const { id, unitId } = await params;
  // uuid guard: a malformed id must 404, not crash the PostgREST query
  // (settles the deferred uuid-404 follow-up for this route).
  const uuid = z.uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(unitId).success) notFound();

  const unit = await getUnit(id, unitId);
  // RLS hides foreign rows — indistinguishable from a nonexistent id.
  if (!unit) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <Link
          href={`/programs/${unit.programId}`}
          className="text-muted-foreground w-fit text-xs hover:underline"
        >
          ← {unit.programName}
        </Link>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{unit.name}</h1>
          {unit.externalRef ? (
            <span className="text-muted-foreground font-mono text-xs">{unit.externalRef}</span>
          ) : null}
        </div>
      </div>
      <UnitStageSections sections={unit.stages} />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

```bash
npm run verify
```

Expected: PASS. Manual check (`npm run dev`, sign in as demo): open a program → a unit page by URL → fill a text field (blur saves, chip counts up), tick booleans until the stage flips to `done · requirements`, clear one (reopens), use "Mark done anyway" on a bare stage (`done · override`), hit a garbage URL `/programs/x/units/y` → 404.

- [ ] **Step 6: Commit**

```bash
git add src/features/programs "src/app/(dashboard)/programs"
git commit -m "feat(programs): unit detail page — requirement fill-in, derived status, override

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Matrix wiring — links + dot behavior

**Files:**
- Modify: `src/features/programs/queries.ts` (`ProgramStage` + `hasRequirements`)
- Modify: `src/features/programs/components/stage-dots.tsx`, `unit-row.tsx`, `unit-list.tsx`

**Interfaces:**
- Consumes: Task 5's unit page route.
- Produces: `ProgramStage` gains `hasRequirements: boolean`; `StageDots` stages prop gains `href: string | null` (null → toggle behavior).

- [ ] **Step 1: `getProgram` counts requirements per stage**

In `src/features/programs/queries.ts`, change the `getProgram` select's stage embed to:

```typescript
      "id, name, created_at, templates(name), program_stages(id, name, position, program_stage_requirements(count)), units(id, name, external_ref, created_at, unit_stages(id, program_stage_id, status))",
```

Extend the type and mapping:

```typescript
export type ProgramStage = { id: string; name: string; position: number; hasRequirements: boolean };
// in the row type:      program_stages: { id: string; name: string; position: number; program_stage_requirements: { count: number }[] }[];
// in the stage mapping: .map((s) => ({ id: s.id, name: s.name, position: s.position, hasRequirements: (s.program_stage_requirements[0]?.count ?? 0) > 0 }))
```

(`StageStrip` consumes `ProgramStage[]` — the added field is compatible.)

- [ ] **Step 2: `StageDots` navigates when a stage has requirements**

Replace `src/features/programs/components/stage-dots.tsx` with:

```tsx
"use client";

import Link from "next/link";

// A dot is a toggle only while its stage has no requirements. Requirement-
// bearing stages derive their status, so the dot becomes a link into the
// unit page's stage section instead of a claim you can click into existence.
export function StageDots({
  stages,
  onToggle,
}: {
  stages: { unitStageId: string; name: string; done: boolean; href: string | null }[];
  onToggle: (unitStageId: string, done: boolean) => void;
}) {
  const dotClass = (done: boolean) =>
    done
      ? "size-3.5 rounded-full bg-primary transition-colors"
      : "border-input size-3.5 rounded-full border bg-transparent transition-colors hover:border-primary";

  return (
    <div className="flex shrink-0 items-center gap-1">
      {stages.map((s) =>
        s.href !== null ? (
          <Link
            key={s.unitStageId}
            href={s.href}
            aria-label={`Open ${s.name}`}
            title={`Open ${s.name}`}
            className={`block ${dotClass(s.done)}`}
          />
        ) : (
          <button
            key={s.unitStageId}
            type="button"
            aria-label={s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`}
            aria-pressed={s.done}
            title={s.done ? `Mark ${s.name} not done` : `Mark ${s.name} done`}
            onClick={() => onToggle(s.unitStageId, !s.done)}
            className={dotClass(s.done)}
          />
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 3: `unit-row.tsx` — open link + hrefs for the dots**

The unit name stays a rename-in-place Input (spec adaptation: the spec's
"name links to the unit page" predates the rename input; an explicit open
affordance keeps both). Add to the imports: `import Link from "next/link";`
and `ArrowUpRight` from lucide. Add props `programId: string` and
`stageMeta: Record<string, { name: string; hasRequirements: boolean }>`
(replaces `stageNames`). Before the delete button, add:

```tsx
      <Button asChild variant="ghost" size="icon" className="size-7" aria-label={`Open ${unit.name}`}>
        <Link href={`/programs/${programId}/units/${unit.id}`}>
          <ArrowUpRight className="size-3.5" />
        </Link>
      </Button>
```

And build the dots' stages with hrefs:

```tsx
      <StageDots
        stages={unit.stages.map((s) => {
          const meta = stageMeta[s.stageId] ?? { name: "stage", hasRequirements: false };
          return {
            unitStageId: s.unitStageId,
            name: meta.name,
            done: s.done,
            href: meta.hasRequirements
              ? `/programs/${programId}/units/${unit.id}#stage-${s.stageId}`
              : null,
          };
        })}
        onToggle={onToggleStage}
      />
```

- [ ] **Step 4: `unit-list.tsx` — pass the new props**

Replace the `stageNames` construction with:

```tsx
  const stageMeta: Record<string, { name: string; hasRequirements: boolean }> =
    Object.fromEntries(stages.map((s) => [s.id, { name: s.name, hasRequirements: s.hasRequirements }]));
```

and pass `programId={programId}` and `stageMeta={stageMeta}` to each `UnitRow` (drop `stageNames`).

- [ ] **Step 5: Verify + commit**

```bash
npm run verify && npm run build
git add src/features/programs
git commit -m "feat(programs): matrix links into unit pages; dots toggle only manual stages

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Seed + full gates

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: demo template stages carry requirements so a fresh `db:reset` demos the whole slice.

- [ ] **Step 1: Seed demo requirements**

In `scripts/seed.ts`, after the `DEMO_STAGES` constant add:

```typescript
const DEMO_REQUIREMENTS: Record<
  string,
  Array<{ type: string; label: string; required: boolean; config?: Record<string, unknown> }>
> = {
  Survey: [
    { type: "date", label: "Survey date", required: true },
    { type: "choice", label: "Access route", required: true, config: { options: ["Front", "Rear"] } },
  ],
  Install: [
    { type: "number", label: "Fixtures installed", required: true },
    { type: "checklist", label: "Install checks", required: true, config: { items: ["Power connected", "Area cleaned"] } },
  ],
};
```

In `ensureDemoTemplate`, after the stages insert succeeds, add:

```typescript
  const { data: createdStages, error: stagesReadError } = await client
    .from("template_stages")
    .select("id, name")
    .eq("template_id", template.id);
  if (stagesReadError) throw stagesReadError;
  const requirementRows = (createdStages ?? []).flatMap((stage) =>
    (DEMO_REQUIREMENTS[stage.name] ?? []).map((r, position) => ({
      template_stage_id: stage.id,
      org_id: orgId,
      type: r.type,
      label: r.label,
      required: r.required,
      config: r.config ?? {},
      position,
    })),
  );
  if (requirementRows.length > 0) {
    const { error: reqError } = await client
      .from("template_stage_requirements")
      .insert(requirementRows);
    if (reqError) throw reqError;
    console.log(`seed: added ${requirementRows.length} requirements to "${DEMO_TEMPLATE}"`);
  }
```

(The function's existing early-return keeps this idempotent. `ensureDemoProgress`'s direct status updates now land as `done_source='override'` on the requirement-bearing stages — which is exactly what a staff toggle means, and demos the override chip.)

- [ ] **Step 2: The full gate battery**

```bash
npm run db:reset
npm run verify
npm run test:integration
npm run build
```

Expected: all green; seed prints the requirements line; drift stays clean (`npm run db:generate` → nothing).

- [ ] **Step 3: Update the graph and commit**

```bash
graphify update .
git add scripts/seed.ts
git commit -m "feat(seed): demo requirements on the Store Refresh template

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: PR + CI

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/stage-requirements
gh pr create --title "feat: stage requirements — slice 6 (typed requirements, derived completion, unit page)" --body "## Summary
- Stages carry typed **requirements** (text/number/boolean/date/choice/checklist) authored in the template editor; \`create_program\` snapshots them, expanding checklists into per-item booleans.
- \`unit_stages.status\` is now **derived in the DB** from responses (\`done_source='requirements'\`), with the existing staff toggle preserved as the **override** path (\`done_source='override'\`). Zero-requirement stages stay manual.
- New **unit detail page** \`/programs/[id]/units/[unitId]\` for fill-in (uuid-404 guarded); matrix dots navigate there for requirement-bearing stages and still toggle manual ones.
- Responses are written values-only: a definer trigger derives \`unit_id\`/\`program_id\`/\`org_id\`/\`type\` and validates the (unit_stage, requirement) pair; a CHECK enforces one correctly-typed value.
- Spec: \`docs/superpowers/specs/2026-08-10-stage-requirements-design.md\` (ships in this PR).

## Test plan
- [x] Unit: requirement/response Zod schemas
- [x] Integration: snapshot copy + checklist expansion; program-side immutability; trust trigger (cross-stage pair rejected, denorms server-filled); one-value CHECK; derivation (complete/reopen/boolean-false/optional-ignored); override provenance; \`done_source\` not client-writable; org isolation; reorder RPC
- [x] \`npm run verify\` + \`npm run test:integration\` + \`npm run build\` + \`npm run db:reset\` (drift clean)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Watch CI to green**

```bash
gh pr checks --watch
```

Expected: all checks pass. If only the `db` job fails, suspect a missing GRANT (the PR #8 failure mode) — read the job log for `permission denied for table`.

---

## Self-review notes (checked against the spec)

- **Spec coverage:** data model → Task 1; trust trigger, derivation, override, RPCs, RLS/grants/CHECKs → Task 3; editor → Task 4; unit page + uuid guard + response actions → Task 5; matrix behavior → Task 6; the spec's test list → Tasks 2–3. Out-of-scope list respected (no photo UI, no participants, no evidence).
- **Type consistency:** `reorder_stage_requirements(p_template_stage_id, p_requirement_ids)` matches between 0011, the action, and the integration test; `saveResponse`'s discriminated `type` matches `unit_stage_responses.type` CHECK values; `SectionRequirement.value` normalization matches the derivation rule mirrored in `unit-stage-sections.tsx`.
- **Known deliberate loosenesses (documented, not bugs):** a choice response isn't validated against `config.options` server-side (UI constrains it; hostile input harms only the caller's own org data); a stage with only optional requirements behaves as a manual stage (derivation requires ≥1 required requirement) — matches the spec's forced zero-requirement rule.
- **Spec adaptation:** the matrix's "unit name links to unit page" became an explicit open button — the name is a rename-in-place input; both affordances are kept.
