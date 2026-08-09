# Templates (stages-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Templates feature — org-scoped workflow templates with an ordered, editable stage list — behind full RLS, with the project's first optimistic-UI mutations and its first CI-enforced RLS integration test, delivered as a PR.

**Architecture:** Two relational tables (`templates`, `template_stages`) with member-writable RLS policies and one `security invoker` reorder RPC. Reads and writes go through the RLS-scoped Supabase server client (never the Drizzle runtime client, which bypasses RLS). A feature slice at `src/features/templates/` (schema/queries/actions/components) feeds two `(dashboard)` routes. Rollouts will later COPY stages (copy-on-use), so templates stay freely editable — no versioning.

**Tech Stack:** Next.js 16 (App Router, Server Actions, `useOptimistic`), Supabase (Postgres 17 + RLS), Drizzle Kit migrations, Zod 4, Vitest 4, sonner toasts, existing shadcn/ui components.

## Global Constraints

- Branch: `feat/templates`, created from `main`, in-place (no worktree — the Supabase stack is bound to this checkout). **Delivery is a PR; never merge or push to `main` directly.**
- Every domain row carries `org_id`; every RLS-referenced column is indexed; policies use `org_id in (select public.user_orgs())`.
- The Drizzle runtime client (`src/db/index.ts`) must NOT be used — it connects via `DATABASE_URL` and bypasses RLS. All runtime reads/writes use `createClient()` from `@/lib/supabase/server`.
- Server Action error discipline: clients get the exact string `"Couldn't save. Try again."`; the raw error goes to `console.error` server-side only. Raw `error.message` must never reach the client.
- No new npm dependencies. No drag-and-drop. No stage colors. No archive/versioning.
- `position` is app-managed; gaps are allowed; ordering is always `position, id`; the reorder RPC rewrites 0..n-1.
- Zod style: `z.uuid()` (Zod 4). All Server Action inputs are Zod-validated.
- Local Supabase ports: API 54351, DB 54352 (URL `postgresql://postgres:postgres@127.0.0.1:54352/postgres`), Studio 54353, Mailpit 54354.
- `npm run verify` must pass before every commit.

---

## File Structure

**Created:** `src/db/schema/templates.ts` · migration `src/db/migrations/0002_*.sql` (generated) · migration `src/db/migrations/0003_templates_rls.sql` (custom) · `src/features/templates/{schema.ts, schema.test.ts, queries.ts, actions.ts}` · `src/features/templates/components/{template-list.tsx, create-template-dialog.tsx, template-header.tsx, stage-list.tsx, stage-row.tsx, add-stage.tsx}` · `src/app/(dashboard)/templates/page.tsx` · `src/app/(dashboard)/templates/[id]/page.tsx` · `src/features/templates/rls.integration.test.ts` · `vitest.integration.config.ts`

**Modified:** `src/db/schema/index.ts` (barrel) · `src/components/command-menu.tsx` (Create template) · `src/features/README.md` (optimistic convention) · `vitest.config.ts` (exclude integration) · `package.json` (`test:integration`) · `.github/workflows/ci.yml` (db job runs integration tests) · `scripts/seed.ts` (demo template)

**Deleted:** `scripts/verify-foundation.ts` (superseded by the integration test)

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b feat/templates`

---

### Task 1: Schema, migrations, RLS, reorder RPC

**Files:**
- Create: `src/db/schema/templates.ts`
- Modify: `src/db/schema/index.ts`
- Create (generated): `src/db/migrations/0002_*.sql`
- Create (custom): `src/db/migrations/0003_templates_rls.sql`

**Interfaces:**
- Consumes: `orgs` table from `src/db/schema/orgs.ts`; `public.user_orgs()` from migration 0001.
- Produces: tables `public.templates`, `public.template_stages`; RPC `public.reorder_stages(p_template_id uuid, p_stage_ids uuid[])`. Later tasks rely on exact column names `id, org_id, name, description, created_at, updated_at` / `id, template_id, org_id, name, position, created_at`.

- [ ] **Step 1: Write the Drizzle schema**

Create `src/db/schema/templates.ts`:

```ts
import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { orgs } from "./orgs";

// Workflow templates. Rollouts will COPY a template's stages at creation
// (copy-on-use), so templates stay freely editable and hard-deletable.
export const templates = pgTable(
  "templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("templates_org_id_idx").on(t.orgId)],
);

export const templateStages = pgTable(
  "template_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    // Denormalized tenant key: every domain row carries org_id for RLS.
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // App-managed ordering. Gaps are allowed (deletes leave them; the
    // reorder RPC rewrites 0..n-1). Always read with ORDER BY position, id.
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("template_stages_template_id_idx").on(t.templateId),
    index("template_stages_org_id_idx").on(t.orgId),
  ],
);
```

- [ ] **Step 2:** In `src/db/schema/index.ts` add `export * from "./templates";` under the existing orgs export.

- [ ] **Step 3: Generate the table migration**

Run: `npm run db:generate`
Expected: one new `src/db/migrations/0002_<name>.sql` creating both tables + indexes + FKs, and updated `meta/`. Read the SQL and confirm it matches Step 1 (no color column, both `org_id` columns present).

- [ ] **Step 4: Create the custom RLS migration**

Run: `npx drizzle-kit generate --custom --name=templates_rls`
Then fill the generated `src/db/migrations/0003_templates_rls.sql` with exactly:

```sql
-- RLS: templates are ordinary member-writable rows (unlike orgs, which are
-- select-only + RPC). Any org member may manage the org's templates; roles
-- come later. Predicate matches 0001's convention.
alter table public.templates enable row level security;
alter table public.template_stages enable row level security;

create policy "templates_select_member" on public.templates
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "templates_insert_member" on public.templates
  for insert to authenticated
  with check (org_id in (select public.user_orgs()));
create policy "templates_update_member" on public.templates
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "templates_delete_member" on public.templates
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

create policy "template_stages_select_member" on public.template_stages
  for select to authenticated
  using (org_id in (select public.user_orgs()));
create policy "template_stages_insert_member" on public.template_stages
  for insert to authenticated
  with check (org_id in (select public.user_orgs()));
create policy "template_stages_update_member" on public.template_stages
  for update to authenticated
  using (org_id in (select public.user_orgs()))
  with check (org_id in (select public.user_orgs()));
create policy "template_stages_delete_member" on public.template_stages
  for delete to authenticated
  using (org_id in (select public.user_orgs()));

-- Freshness: stage changes touch the parent template's updated_at. Runs as
-- the acting user (RLS applies; members hold the update policy). During a
-- template's cascade delete the UPDATE matches 0 rows, which is fine.
create or replace function public.touch_template_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.templates
     set updated_at = now()
   where id = coalesce(new.template_id, old.template_id);
  return coalesce(new, old);
end;
$$;

create trigger template_stages_touch_parent
after insert or update or delete on public.template_stages
for each row execute function public.touch_template_updated_at();

-- Atomic reorder. SECURITY INVOKER (the default — stated for emphasis):
-- runs as the caller, fully under RLS, so a foreign template simply has no
-- visible rows and fails the count check. Rejects any id set that is not
-- exactly the template's stages (including duplicates).
create or replace function public.reorder_stages(p_template_id uuid, p_stage_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count
    from public.template_stages
   where template_id = p_template_id;

  if v_count = 0 then
    raise exception 'template not found';
  end if;

  if v_count <> coalesce(array_length(p_stage_ids, 1), 0)
     or v_count <> (select count(distinct s.id) from unnest(p_stage_ids) as s(id))
     or exists (
       select 1 from unnest(p_stage_ids) as s(id)
        where not exists (
          select 1 from public.template_stages ts
           where ts.id = s.id and ts.template_id = p_template_id))
  then
    raise exception 'stage ids do not match template';
  end if;

  update public.template_stages ts
     set position = u.ord - 1
    from unnest(p_stage_ids) with ordinality as u(id, ord)
   where ts.id = u.id;
end;
$$;

grant execute on function public.reorder_stages(uuid, uuid[]) to authenticated;
```

- [ ] **Step 5: Apply and smoke-test**

```bash
npm run db:reset
docker exec supabase_db_pipline-app psql -U postgres -c "\d public.template_stages"
docker exec supabase_db_pipline-app psql -U postgres -c "select polname from pg_policy where polrelid = 'public.templates'::regclass;"
```
Expected: reset applies 0000–0003 then seeds; table has `position integer`; four `templates_*_member` policies listed.

- [ ] **Step 6: Drift check** — `npm run db:generate` again.
Expected: "No schema changes, nothing to migrate". If it generates a file, the schema and migrations disagree — fix before committing.

- [ ] **Step 7:** `npm run verify`, then commit:

```bash
git add src/db/schema src/db/migrations
git commit -m "feat(templates): tables, RLS policies, touch trigger, reorder RPC"
```

---

### Task 2: Zod schemas (TDD)

**Files:**
- Create: `src/features/templates/schema.ts`
- Test: `src/features/templates/schema.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–5): `templateName`, `templateDescription`, `stageName`, `createTemplateInput`, `renameTemplateInput`, `deleteTemplateInput`, `addStageInput`, `renameStageInput`, `deleteStageInput`, `reorderStagesInput`, and `type TemplateActionState = { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/templates/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  templateName,
  stageName,
  createTemplateInput,
  reorderStagesInput,
} from "./schema";

const UUID_A = "6f1e2d3c-4b5a-4678-9abc-def012345678";
const UUID_B = "0a1b2c3d-4e5f-4671-8123-456789abcdef";

describe("templateName", () => {
  it("trims and accepts 1–80 chars", () => {
    expect(templateName.parse("  Store Refresh  ")).toBe("Store Refresh");
  });
  it("rejects empty after trim", () => {
    expect(templateName.safeParse("   ").success).toBe(false);
  });
  it("rejects 81 chars", () => {
    expect(templateName.safeParse("x".repeat(81)).success).toBe(false);
  });
});

describe("stageName", () => {
  it("rejects 61 chars, accepts 60", () => {
    expect(stageName.safeParse("x".repeat(61)).success).toBe(false);
    expect(stageName.safeParse("x".repeat(60)).success).toBe(true);
  });
});

describe("createTemplateInput", () => {
  it("description is optional", () => {
    expect(createTemplateInput.safeParse({ name: "A" }).success).toBe(true);
  });
});

describe("reorderStagesInput", () => {
  it("rejects a non-uuid templateId", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: "nope", stageIds: [UUID_A] }).success,
    ).toBe(false);
  });
  it("rejects an empty stageIds array", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: UUID_A, stageIds: [] }).success,
    ).toBe(false);
  });
  it("rejects duplicate stage ids", () => {
    expect(
      reorderStagesInput.safeParse({ templateId: UUID_A, stageIds: [UUID_B, UUID_B] }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/features/templates/schema.test.ts` — expect FAIL (cannot resolve `./schema`).

- [ ] **Step 3: Implement**

Create `src/features/templates/schema.ts`:

```ts
import { z } from "zod";

export const templateName = z.string().trim().min(1).max(80);
export const templateDescription = z.string().trim().max(500);
export const stageName = z.string().trim().min(1).max(60);

export const createTemplateInput = z.object({
  name: templateName,
  description: templateDescription.optional(),
});
export const renameTemplateInput = z.object({ id: z.uuid(), name: templateName });
export const deleteTemplateInput = z.object({ id: z.uuid() });
export const addStageInput = z.object({ templateId: z.uuid(), name: stageName });
export const renameStageInput = z.object({ id: z.uuid(), name: stageName });
export const deleteStageInput = z.object({ id: z.uuid() });
export const reorderStagesInput = z
  .object({ templateId: z.uuid(), stageIds: z.array(z.uuid()).min(1) })
  .refine((v) => new Set(v.stageIds).size === v.stageIds.length, {
    message: "stageIds must be unique",
  });

// Result shape every stage/template mutation returns to the client.
export type TemplateActionState = { ok: true } | { ok: false; error: string };

// Client-facing copy for any failed write. Raw errors are logged server-side.
export const GENERIC_WRITE_ERROR = "Couldn't save. Try again.";
```

- [ ] **Step 4:** Re-run the test file — expect 8 passing. Then `npm run verify`.

- [ ] **Step 5:** Commit: `git add src/features/templates && git commit -m "feat(templates): zod schemas"`

---

### Task 3: Queries and Server Actions

**Files:**
- Create: `src/features/templates/queries.ts`
- Create: `src/features/templates/actions.ts`

**Interfaces:**
- Consumes: Task 2's schemas; `createClient` from `@/lib/supabase/server`; RPC `reorder_stages`.
- Produces (consumed by Tasks 4–5):
  - `listTemplates(): Promise<TemplateListItem[]>` where `TemplateListItem = { id: string; name: string; description: string | null; stageCount: number; updatedAt: string }`
  - `getTemplate(id: string): Promise<TemplateDetail | null>` where `TemplateDetail = { id: string; name: string; description: string | null; updatedAt: string; stages: Stage[] }` and `Stage = { id: string; name: string; position: number }`
  - Actions: `createTemplate(prev: CreateTemplateState, formData: FormData): Promise<CreateTemplateState>` with `CreateTemplateState = { error?: string }` (redirects on success); `renameTemplate(input: unknown)`, `deleteTemplate(input: unknown)` (redirects), `addStage(input: unknown)`, `renameStage(input: unknown)`, `deleteStage(input: unknown)`, `reorderStages(input: unknown)` — all returning `Promise<TemplateActionState>`.

No unit tests here by design: these are thin I/O wrappers around the Supabase client; mocking it asserts the mock. Task 6's RLS integration test and Task 7's manual walkthrough exercise them against the real stack.

- [ ] **Step 1: Queries**

Create `src/features/templates/queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  stageCount: number;
  updatedAt: string;
};

export type Stage = { id: string; name: string; position: number };

export type TemplateDetail = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  stages: Stage[];
};

// RLS scopes every read to the caller's orgs — no explicit org filter needed.
export async function listTemplates(): Promise<TemplateListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, description, updated_at, template_stages(count)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    stageCount: t.template_stages[0]?.count ?? 0,
    updatedAt: t.updated_at,
  }));
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, description, updated_at, template_stages(id, name, position)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    updatedAt: data.updated_at,
    stages: [...data.template_stages].sort(
      (a, b) => a.position - b.position || a.id.localeCompare(b.id),
    ),
  };
}
```

- [ ] **Step 2: Actions**

Create `src/features/templates/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createTemplateInput,
  renameTemplateInput,
  deleteTemplateInput,
  addStageInput,
  renameStageInput,
  deleteStageInput,
  reorderStagesInput,
  GENERIC_WRITE_ERROR,
  type TemplateActionState,
} from "./schema";

export type CreateTemplateState = { error?: string };

// Error discipline: the client sees GENERIC_WRITE_ERROR; the raw failure is
// logged server-side only. Never return error.message to the client.
function fail(context: string, error: unknown): { ok: false; error: string } {
  console.error(`[templates] ${context}:`, error);
  return { ok: false, error: GENERIC_WRITE_ERROR };
}

async function currentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function createTemplate(
  _prev: CreateTemplateState,
  formData: FormData,
): Promise<CreateTemplateState> {
  const parsed = createTemplateInput.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });
  if (!parsed.success) return { error: "Name must be 1–80 characters." };

  const orgId = await currentOrgId();
  if (!orgId) redirect("/onboarding");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[templates] createTemplate:", error);
    return { error: GENERIC_WRITE_ERROR };
  }

  revalidatePath("/templates");
  redirect(`/templates/${data.id}`);
}

export async function renameTemplate(input: unknown): Promise<TemplateActionState> {
  const parsed = renameTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase
    .from("templates")
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return fail("renameTemplate", error);
  revalidatePath("/templates");
  revalidatePath(`/templates/${parsed.data.id}`);
  return { ok: true };
}

export async function deleteTemplate(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteTemplateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.from("templates").delete().eq("id", parsed.data.id);
  if (error) return fail("deleteTemplate", error);
  revalidatePath("/templates");
  redirect("/templates");
}

export async function addStage(input: unknown): Promise<TemplateActionState> {
  const parsed = addStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as the tenancy/org_id source; RLS hides foreign rows.
  const { data: template } = await supabase
    .from("templates")
    .select("id, org_id, template_stages(position)")
    .eq("id", parsed.data.templateId)
    .maybeSingle();
  if (!template) return fail("addStage", "template not visible");

  const nextPosition =
    template.template_stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;

  const { error } = await supabase.from("template_stages").insert({
    template_id: template.id,
    org_id: template.org_id,
    name: parsed.data.name,
    position: nextPosition,
  });
  if (error) return fail("addStage", error);
  revalidatePath(`/templates/${template.id}`);
  return { ok: true };
}

export async function renameStage(input: unknown): Promise<TemplateActionState> {
  const parsed = renameStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_stages")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("template_id")
    .maybeSingle();
  if (error || !data) return fail("renameStage", error ?? "stage not visible");
  revalidatePath(`/templates/${data.template_id}`);
  return { ok: true };
}

export async function deleteStage(input: unknown): Promise<TemplateActionState> {
  const parsed = deleteStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  // Plain delete — position gaps are harmless under ORDER BY position, id.
  const { data, error } = await supabase
    .from("template_stages")
    .delete()
    .eq("id", parsed.data.id)
    .select("template_id")
    .maybeSingle();
  if (error || !data) return fail("deleteStage", error ?? "stage not visible");
  revalidatePath(`/templates/${data.template_id}`);
  return { ok: true };
}

export async function reorderStages(input: unknown): Promise<TemplateActionState> {
  const parsed = reorderStagesInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_stages", {
    p_template_id: parsed.data.templateId,
    p_stage_ids: parsed.data.stageIds,
  });
  if (error) return fail("reorderStages", error);
  revalidatePath(`/templates/${parsed.data.templateId}`);
  return { ok: true };
}
```

- [ ] **Step 3:** `npm run verify` (typecheck is the gate here). Commit:
`git add src/features/templates && git commit -m "feat(templates): queries and server actions"`

---

### Task 4: List page, create dialog, palette command

**Files:**
- Create: `src/app/(dashboard)/templates/page.tsx`
- Create: `src/features/templates/components/template-list.tsx`
- Create: `src/features/templates/components/create-template-dialog.tsx`
- Modify: `src/components/command-menu.tsx`

**Interfaces:**
- Consumes: `listTemplates`, `TemplateListItem` (Task 3); `createTemplate`, `CreateTemplateState` (Task 3); existing `@/components/ui/{dialog,button,input,label,textarea}`.
- Produces: route `/templates` (accepts `?new=1` to open the create dialog).

- [ ] **Step 1: Page**

Create `src/app/(dashboard)/templates/page.tsx` (the `(dashboard)` layout already enforces `requireOrg()`; `PageProps` is the Next 16 generated global — do not import it):

```tsx
import { listTemplates } from "@/features/templates/queries";
import { TemplateList } from "@/features/templates/components/template-list";
import { CreateTemplateDialog } from "@/features/templates/components/create-template-dialog";

export default async function TemplatesPage({ searchParams }: PageProps<"/templates">) {
  const [templates, params] = await Promise.all([listTemplates(), searchParams]);
  const openCreate = params.new === "1";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Templates</h1>
        <CreateTemplateDialog defaultOpen={openCreate} />
      </div>
      <TemplateList templates={templates} />
    </div>
  );
}
```

- [ ] **Step 2: List component**

Create `src/features/templates/components/template-list.tsx` (server component — no interactivity):

```tsx
import Link from "next/link";
import type { TemplateListItem } from "@/features/templates/queries";

export function TemplateList({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-10 text-center text-sm">
        No templates yet. Create one to define the stages your rollouts will run.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left">
            <th className="p-3 font-medium">Name</th>
            <th className="p-3 font-medium">Stages</th>
            <th className="p-3 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="hover:bg-muted/50 border-b last:border-0">
              <td className="p-3">
                <Link href={`/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                {t.description ? (
                  <p className="text-muted-foreground truncate text-xs">{t.description}</p>
                ) : null}
              </td>
              <td className="p-3 tabular-nums">{t.stageCount}</td>
              <td className="text-muted-foreground p-3">
                {new Date(t.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Create dialog**

Create `src/features/templates/components/create-template-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createTemplate, type CreateTemplateState } from "@/features/templates/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initial: CreateTemplateState = {};

export function CreateTemplateDialog({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [state, action, pending] = useActionState(createTemplate, initial);
  const router = useRouter();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Drop a stale ?new=1 so refresh/back doesn't reopen the dialog.
    if (!next) router.replace("/templates");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus className="size-4" /> New template
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" name="name" required maxLength={80} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-description">Description (optional)</Label>
            <Textarea id="template-description" name="description" maxLength={500} rows={3} />
          </div>
          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create template"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Note: `DialogTrigger` in this repo is Base UI-flavored shadcn. Check `src/components/ui/dialog.tsx` for the trigger composition API — if it uses `asChild` (Radix style) instead of `render`, use `<DialogTrigger asChild><Button …/></DialogTrigger>`. Match whatever `src/components/ui/sheet.tsx` consumers in the shell do.

- [ ] **Step 4: Palette command**

In `src/components/command-menu.tsx`: add `Plus` to the lucide import, and insert a new group between "Navigate" and "Preferences":

```tsx
<CommandGroup heading="Actions">
  <CommandItem onSelect={() => go("/templates?new=1")}>
    <Plus className="size-4" /> Create template
  </CommandItem>
</CommandGroup>
```

- [ ] **Step 5: Verify manually** — `npm run dev`; sign in as `demo@rolloutos.local` (magic link via Mailpit :54354). `/templates` shows the empty state; "New template" opens the dialog; ⌘K → "Create template" lands on `/templates` with the dialog open; creating "Test A" redirects to its (not yet built) detail URL — a 404 is EXPECTED until Task 5. Confirm the row appears on `/templates`.

- [ ] **Step 6:** `npm run verify`, then commit:
`git add src/app src/features/templates src/components/command-menu.tsx && git commit -m "feat(templates): list page, create dialog, palette command"`

---

### Task 5: Detail page, stage editor (optimistic convention), README

**Files:**
- Create: `src/app/(dashboard)/templates/[id]/page.tsx`
- Create: `src/features/templates/components/template-header.tsx`
- Create: `src/features/templates/components/stage-list.tsx`
- Create: `src/features/templates/components/stage-row.tsx`
- Create: `src/features/templates/components/add-stage.tsx`
- Modify: `src/features/README.md`

**Interfaces:**
- Consumes: `getTemplate`, `Stage`, `TemplateDetail` (Task 3); actions `renameTemplate`, `deleteTemplate`, `addStage`, `renameStage`, `deleteStage`, `reorderStages` (Task 3); `toast` from `sonner`.
- Produces: route `/templates/[id]`; the project's optimistic-UI reference implementation.

- [ ] **Step 1: Page**

Create `src/app/(dashboard)/templates/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getTemplate } from "@/features/templates/queries";
import { TemplateHeader } from "@/features/templates/components/template-header";
import { StageList } from "@/features/templates/components/stage-list";

export default async function TemplateDetailPage({ params }: PageProps<"/templates/[id]">) {
  const { id } = await params;
  const template = await getTemplate(id);
  // RLS returns nothing for foreign orgs' templates — indistinguishable from
  // a nonexistent id, which is exactly the 404 we want.
  if (!template) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <TemplateHeader id={template.id} name={template.name} description={template.description} />
      <StageList templateId={template.id} stages={template.stages} />
    </div>
  );
}
```

- [ ] **Step 2: Header (rename + delete)**

Create `src/features/templates/components/template-header.tsx`:

```tsx
"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { renameTemplate, deleteTemplate } from "@/features/templates/actions";
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

export function TemplateHeader({
  id,
  name,
  description,
}: {
  id: string;
  name: string;
  description: string | null;
}) {
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
      const result = await renameTemplate({ id, name: next });
      if (!result.ok) {
        setValue(name);
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={80}
          aria-label="Template name"
          className="border-transparent text-lg font-semibold shadow-none focus-visible:border-input"
        />
        {description ? (
          <p className="text-muted-foreground px-3 text-sm">{description}</p>
        ) : null}
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger
          render={
            <Button variant="ghost" size="icon" aria-label="Delete template">
              <Trash2 className="size-4" />
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this template?</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Deletes the template and its stages. Rollouts are unaffected — they copy stages
            when created.
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
                  const result = await deleteTemplate({ id });
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

(Same `DialogTrigger` API note as Task 4 Step 3.)

- [ ] **Step 3: Stage list — the optimistic reference implementation**

Create `src/features/templates/components/stage-list.tsx`:

```tsx
"use client";

import * as React from "react";
import { useOptimistic } from "react";
import { toast } from "sonner";
import {
  addStage,
  renameStage,
  deleteStage,
  reorderStages,
} from "@/features/templates/actions";
import type { Stage } from "@/features/templates/queries";
import { StageRow } from "./stage-row";
import { AddStage } from "./add-stage";

// Project convention (see features/README.md): useOptimistic over the
// server-provided array; every mutation applies optimistically inside a
// transition, calls the Server Action, and toasts on failure. The action's
// revalidatePath re-renders the server truth, which resets optimistic state.
type StageEvent =
  | { type: "add"; id: string; name: string }
  | { type: "rename"; id: string; name: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; direction: -1 | 1 };

function applyEvent(stages: Stage[], event: StageEvent): Stage[] {
  switch (event.type) {
    case "add": {
      const position = stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      return [...stages, { id: event.id, name: event.name, position }];
    }
    case "rename":
      return stages.map((s) => (s.id === event.id ? { ...s, name: event.name } : s));
    case "delete":
      return stages.filter((s) => s.id !== event.id);
    case "move": {
      const index = stages.findIndex((s) => s.id === event.id);
      const target = index + event.direction;
      if (index < 0 || target < 0 || target >= stages.length) return stages;
      const next = [...stages];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, position: i }));
    }
  }
}

export function StageList({ templateId, stages }: { templateId: string; stages: Stage[] }) {
  const [optimistic, dispatch] = useOptimistic(stages, applyEvent);
  const [, startTransition] = React.useTransition();

  const run = (event: StageEvent, act: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      dispatch(event);
      const result = await act();
      if (!result.ok) toast.error(result.error ?? "Couldn't save. Try again.");
    });

  const onMove = (id: string, direction: -1 | 1) => {
    const moved = applyEvent(optimistic, { type: "move", id, direction });
    run({ type: "move", id, direction }, () =>
      reorderStages({ templateId, stageIds: moved.map((s) => s.id) }),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-medium">
        Stages ({optimistic.length})
      </h2>
      <ol className="flex flex-col gap-1">
        {optimistic.map((stage, index) => (
          <StageRow
            key={stage.id}
            stage={stage}
            isFirst={index === 0}
            isLast={index === optimistic.length - 1}
            onRename={(name) =>
              run({ type: "rename", id: stage.id, name }, () =>
                renameStage({ id: stage.id, name }),
              )
            }
            onDelete={() =>
              run({ type: "delete", id: stage.id }, () => deleteStage({ id: stage.id }))
            }
            onMove={(direction) => onMove(stage.id, direction)}
          />
        ))}
      </ol>
      {optimistic.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No stages yet — add the first step of this workflow.
        </p>
      ) : null}
      <AddStage
        onAdd={(name) =>
          run({ type: "add", id: crypto.randomUUID(), name }, () =>
            addStage({ templateId, name }),
          )
        }
      />
    </div>
  );
}
```

- [ ] **Step 4: Stage row + add form**

Create `src/features/templates/components/stage-row.tsx`:

```tsx
"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import type { Stage } from "@/features/templates/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function StageRow({
  stage,
  isFirst,
  isLast,
  onRename,
  onDelete,
  onMove,
}: {
  stage: Stage;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const [value, setValue] = React.useState(stage.name);
  React.useEffect(() => setValue(stage.name), [stage.name]);

  const commit = () => {
    const next = value.trim();
    if (next === "" || next === stage.name) {
      setValue(stage.name);
      return;
    }
    onRename(next);
  };

  return (
    <li className="group flex items-center gap-1 rounded-md border px-2 py-1">
      <div className="flex flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Move ${stage.name} up`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`Move ${stage.name} down`}
          disabled={isLast}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </div>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        maxLength={60}
        aria-label={`Stage name: ${stage.name}`}
        className="border-transparent shadow-none focus-visible:border-input"
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Delete ${stage.name}`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
```

React's `set-state-in-effect` lint rule: the `React.useEffect(() => setValue(stage.name), [stage.name])` sync is the flagged pattern. Use the key-reset idiom instead if lint complains: derive with `const [value, setValue] = React.useState(stage.name)` plus `key={stage.id + stage.name}` on `StageRow` at the call site — prefer whichever passes `npm run lint` cleanly WITHOUT eslint-disable comments.

Create `src/features/templates/components/add-stage.tsx`:

```tsx
"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddStage({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = React.useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (name === "") return;
    onAdd(name);
    setValue("");
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Add a stage…"
        maxLength={60}
        aria-label="New stage name"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={value.trim() === ""}>
        <Plus className="size-4" /> Add
      </Button>
    </form>
  );
}
```

- [ ] **Step 5: Document the convention**

Append to `src/features/README.md`:

```markdown
## Optimistic mutations (project convention)

Established in `templates/components/stage-list.tsx`. Client components own a
`useOptimistic(serverData, reducer)` pair; every mutation (1) dispatches the
optimistic event inside a transition, (2) awaits the Server Action, (3) on
`{ ok: false }` shows `toast.error` — the action's `revalidatePath` re-renders
server truth either way. Actions return `{ ok: true } | { ok: false; error }`
with the generic copy from `GENERIC_WRITE_ERROR`; raw errors are logged
server-side only.
```

- [ ] **Step 6: Manual verification** — with `npm run dev`: create a template, add 3 stages, rename one, reorder with the arrows (order survives refresh), delete one, rename the template (list page reflects it), delete the template (returns to `/templates`). `/templates/00000000-0000-4000-8000-000000000000` → 404.

- [ ] **Step 7:** `npm run verify`, commit:
`git add src/app src/features && git commit -m "feat(templates): detail page and optimistic stage editor"`

---

### Task 6: Integration-test lane + RLS proof

**Files:**
- Create: `vitest.integration.config.ts`
- Create: `src/features/templates/rls.integration.test.ts`
- Modify: `vitest.config.ts`, `package.json`, `.github/workflows/ci.yml`
- Delete: `scripts/verify-foundation.ts`

**Interfaces:**
- Consumes: local Supabase stack env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`); `create_org` RPC; Task 1's tables and RPC.
- Produces: `npm run test:integration`; CI `db` job runs it.

- [ ] **Step 1: Exclude integration tests from the unit lane**

`*.integration.test.ts` matches the existing `src/**/*.test.ts` include, so exclusion must be explicit. Replace `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Integration tests need the local Supabase stack; they run via
    // `npm run test:integration` (see vitest.integration.config.ts).
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
```

- [ ] **Step 2: Integration config**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Runs against the LOCAL Supabase stack (supabase start). Env comes from
// .env.local locally (loaded by the test file) or exported vars in CI.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

- [ ] **Step 3:** In `package.json` scripts, after `test:watch`, add:

```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 4: The RLS proof**

Create `src/features/templates/rls.integration.test.ts`:

```ts
/**
 * Tenant-isolation proof, promoted from scripts/verify-foundation.ts into a
 * real test. Requires the local Supabase stack (npm run setup). Creates two
 * throwaway users+orgs per run; a fresh stack (CI) or db:reset clears them.
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

describe("RLS tenant isolation", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let aliceTemplateId: string;

  beforeAll(async () => {
    alice = await signedInUser("alice");
    bob = await signedInUser("bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "Alpha" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "Beta" });
    if (e2) throw e2;
  });

  it("members see only their own orgs", async () => {
    const { data } = await bob.from("orgs").select("id");
    expect(data).toHaveLength(1);
    expect(data![0].id).not.toBe(aliceOrgId);
  });

  it("a member can create a template with stages in their org", async () => {
    const { data, error } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Store Refresh" })
      .select("id")
      .single();
    expect(error).toBeNull();
    aliceTemplateId = data!.id;

    const stages = ["Survey", "Install"].map((name, position) => ({
      template_id: aliceTemplateId,
      org_id: aliceOrgId,
      name,
      position,
    }));
    const { error: stageError } = await alice.from("template_stages").insert(stages);
    expect(stageError).toBeNull();
  });

  it("another org's member cannot see the template", async () => {
    const { data } = await bob.from("templates").select("id").eq("id", aliceTemplateId);
    expect(data).toHaveLength(0);
  });

  it("another org's member cannot insert into a foreign org", async () => {
    const { error } = await bob
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Intrusion" });
    expect(error).not.toBeNull();
  });

  it("reorder RPC rejects a foreign template", async () => {
    const { data: stageRows } = await alice
      .from("template_stages")
      .select("id")
      .eq("template_id", aliceTemplateId);
    const ids = stageRows!.map((s) => s.id);
    const { error } = await bob.rpc("reorder_stages", {
      p_template_id: aliceTemplateId,
      p_stage_ids: ids,
    });
    expect(error).not.toBeNull();
  });

  it("reorder RPC reorders for the owner", async () => {
    const { data: before } = await alice
      .from("template_stages")
      .select("id, name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    const reversed = [...before!].reverse().map((s) => s.id);
    const { error } = await alice.rpc("reorder_stages", {
      p_template_id: aliceTemplateId,
      p_stage_ids: reversed,
    });
    expect(error).toBeNull();
    const { data: after } = await alice
      .from("template_stages")
      .select("name")
      .eq("template_id", aliceTemplateId)
      .order("position");
    expect(after!.map((s) => s.name)).toEqual(before!.map((s) => s.name).reverse());
  });
});
```

- [ ] **Step 5:** Run `npm run test:integration` (stack must be up: `npm run setup` first). Expected: 6 passing. Also confirm the unit lane still excludes it: `npm run test` must NOT list `rls.integration.test.ts`.

- [ ] **Step 6: Wire into the CI db job**

In `.github/workflows/ci.yml`, in the `db` job after the "Check for schema/migration drift" step, add:

```yaml
      - name: RLS integration tests
        run: |
          set -a
          eval "$(supabase status -o env | grep -E '^[A-Z_]+=')"
          set +a
          export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
          export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
          export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
          npm run test:integration
```

Run `actionlint .github/workflows/ci.yml` — expect no output.

- [ ] **Step 7: Delete the superseded script**

```bash
git rm scripts/verify-foundation.ts
```

(`verify-auth.ts` / `verify-onboarding.ts` stay — out of scope.)

- [ ] **Step 8:** `npm run verify && npm run test:integration`, commit:
`git add -A && git commit -m "test(templates): RLS integration lane in CI db job; retire verify-foundation"`

---

### Task 7: Seed, final verification, PR

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: everything above; existing seed structure (demo user + "Demo Rollouts" org via `create_org`).

- [ ] **Step 1: Seed the demo template**

In `scripts/seed.ts`, the current flow signs in the demo user and either finds an existing org or creates one via `create_org`, then returns/logs. Restructure the tail of `main()` so BOTH paths end with an org id in hand, then ensure the template exists. Replace the early-return block ("already owns … nothing to do") and the create path with:

```ts
  let orgId: string;
  if (existing && existing.length > 0) {
    console.log(`seed: ${DEMO_EMAIL} already owns "${existing[0].name}"`);
    orgId = existing[0].id;
  } else {
    const { data: created, error: rpcError } = await client.rpc("create_org", {
      p_name: DEMO_ORG,
    });
    if (rpcError) throw rpcError;
    orgId = (created as { id: string }).id;
    console.log(`seed: created "${DEMO_ORG}"`);
  }

  await ensureDemoTemplate(client, orgId);
  console.log(`seed: sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
```

And add above `main()`:

```ts
const DEMO_TEMPLATE = "Store Refresh";
const DEMO_STAGES = ["Survey", "Install", "QA", "Sign-off"];

async function ensureDemoTemplate(
  client: ReturnType<typeof createClient>,
  orgId: string,
): Promise<void> {
  const { data: found, error: findError } = await client
    .from("templates")
    .select("id")
    .eq("name", DEMO_TEMPLATE)
    .maybeSingle();
  if (findError) throw findError;
  if (found) {
    console.log(`seed: template "${DEMO_TEMPLATE}" already exists — nothing to do`);
    return;
  }

  const { data: template, error: templateError } = await client
    .from("templates")
    .insert({ org_id: orgId, name: DEMO_TEMPLATE, description: "Demo workflow" })
    .select("id")
    .single();
  if (templateError) throw templateError;

  const { error: stagesError } = await client.from("template_stages").insert(
    DEMO_STAGES.map((name, position) => ({
      template_id: template.id,
      org_id: orgId,
      name,
      position,
    })),
  );
  if (stagesError) throw stagesError;
  console.log(`seed: created template "${DEMO_TEMPLATE}" with ${DEMO_STAGES.length} stages`);
}
```

Note: the existing `existing` select must include `id` — change it to `.select("id, name")` if it only selects `id, name` partially. Keep the loopback host guard and everything else untouched.

- [ ] **Step 2: Verify seeding** — `npm run db:reset` (expect template + 4 stages logged), then `npm run db:seed` again (expect "already exists — nothing to do", exit 0). In the app: `/templates` shows "Store Refresh · 4 stages".

- [ ] **Step 3: Full local gate**

```bash
npm run verify && npm run test:integration && npm run db:generate
git status --short   # clean; db:generate produced no drift
```

- [ ] **Step 4: Commit** — `git add scripts/seed.ts && git commit -m "feat(templates): seed demo Store Refresh template"`

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/templates
gh pr create --title "feat: templates (stages-only) — Feature #2" --body "$(cat <<'EOF'
## Summary
- Org-scoped workflow templates with an ordered, editable stage list (list + detail pages, ⌘K create command)
- Full RLS (member-writable policies on both tables) + atomic `reorder_stages` RPC (security invoker)
- Establishes the project optimistic-UI convention (`useOptimistic` + Server Actions, documented in features/README)
- New CI-enforced RLS integration-test lane in the `db` job; retires `scripts/verify-foundation.ts`
- Demo seed gains a "Store Refresh" template (4 stages)

Spec: docs/superpowers/specs/2026-08-09-templates-design.md

## Test plan
- [x] Unit: schemas (vitest, CI `test` job)
- [x] Integration: RLS isolation, cross-tenant invisibility, reorder RPC guards (CI `db` job)
- [x] Manual: create/rename/reorder/delete against local stack; foreign id → 404

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Watch CI on the PR** — `gh pr checks --watch` (or poll). All six checks (`lint`, `typecheck`, `test`, `build`, `db`, `ci`) must be green. **Do not merge** — report the PR URL and stop.

---

## Final verification checklist

- [ ] `npm run verify` green; `npm run test:integration` green locally
- [ ] `npm run db:generate` produces no drift after all schema commits
- [ ] Cold `npm run db:reset` → seeded org + template; app walkthrough works
- [ ] PR open with all CI checks green; `main` untouched
