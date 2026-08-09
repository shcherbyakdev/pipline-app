# Templates (stages-only) — Feature #2

**Date:** 2026-08-09
**Status:** Approved, ready for planning
**Delivery:** feature branch → pull request (CI green required); no direct merge to main.

## Product context

A **template** defines the repeatable workflow a rollout will run: an ordered
list of **stages** every unit moves through. This slice ships templates with
stages only. Typed fields and checklists (the rest of the MVP's "template
builder") are deliberately separate later slices — their consumers (unit
detail, installer flow) are two phases away. Rollouts, when built, will
**copy** a template's stages at creation time (copy-on-use), so templates stay
freely editable and deletable forever, and no versioning or archive machinery
is ever needed here.

Decisions made during brainstorm:

1. **Stages only** — no fields, no checklists, no color. Stage color was
   considered and dropped: the future progress matrix colors cells by *unit
   status* (existing status palette), not by stage identity.
2. **Freely editable + hard delete**, safe because of copy-on-use.
3. **List page + detail page** UI.
4. **Relational tables + RLS write policies + granular Server Actions**;
   reads via the RLS-scoped Supabase server client. The Drizzle runtime client
   (`src/db/index.ts`) stays unused — it bypasses RLS.

## Data model

Drizzle schema (`src/db/schema/templates.ts`, exported from the barrel), then
`npm run db:generate`, then a hand-written RLS migration (same split as the
foundation's `0001_foundation_rls.sql`).

```
templates
  id          uuid pk default gen_random_uuid()
  org_id      uuid not null → orgs(id) on delete cascade
  name        text not null
  description text
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()
  index: org_id                       -- every RLS-referenced column is indexed

template_stages
  id          uuid pk default gen_random_uuid()
  template_id uuid not null → templates(id) on delete cascade
  org_id      uuid not null → orgs(id) on delete cascade   -- denormalized: every domain row carries org_id
  name        text not null
  position    integer not null        -- app-managed ordering; gaps allowed (delete leaves them; reorder rewrites 0..n-1); no unique constraint
  created_at  timestamptz not null default now()
  indexes: template_id, org_id
```

A trigger on `template_stages` (insert/update/delete) sets the parent
template's `updated_at = now()`, so the list page shows freshness without app
code. Ordering reads use `order by position, id`.

## RLS & RPC (hand-written migration)

- `alter table … enable row level security` on both tables.
- Policies on **both** tables, all four operations, one predicate:
  `org_id in (select public.user_orgs())` (`using` for select/update/delete,
  `with check` for insert/update). Unlike `orgs` (select-only + RPC),
  templates are ordinary member-writable rows; roles/permissions are out of
  scope (any org member manages templates).
- RPC `public.reorder_stages(p_template_id uuid, p_stage_ids uuid[])` —
  **security invoker** (runs as the caller, fully under RLS; no definer
  privileges are needed because members may write). It raises unless
  `p_stage_ids` is exactly the set of the template's stage ids, then rewrites
  `position` to the array order in one transaction. `grant execute to
  authenticated`.

## Feature slice — `src/features/templates/`

- `schema.ts` — Zod, shared client/server: `templateName` (trimmed, 1–80),
  `templateDescription` (0–500), `stageName` (trimmed, 1–60), and input
  schemas: `createTemplateInput { name, description? }`,
  `renameTemplateInput { id, name }`, `deleteTemplateInput { id }`,
  `addStageInput { templateId, name }`, `renameStageInput { id, name }`,
  `deleteStageInput { id }`, `reorderStagesInput { templateId, stageIds:
  uuid[] (min 1) }`.
- `queries.ts` — Supabase server client (RLS-scoped):
  - `listTemplates()` → `{ id, name, description, stageCount, updatedAt }[]`
    (embedded `template_stages(count)`).
  - `getTemplate(id)` → `{ id, name, description, updatedAt, stages: { id,
    name, position }[] }` ordered by position, or `null` (RLS yields nothing
    for foreign ids → route calls `notFound()`).
- `actions.ts` — Server Actions, each: Zod-validate → Supabase server client
  write → `revalidatePath` → return `{ ok: true } | { ok: false, error }`.
  **Error discipline (new-code standard):** clients receive generic messages
  ("Couldn't save. Try again."); the raw error is `console.error`-logged
  server-side only. Actions: `createTemplate` (redirects to the new detail
  page), `renameTemplate`, `deleteTemplate` (redirects to `/templates`),
  `addStage` (position = current max+1), `renameStage`, `deleteStage` (plain
  delete — position gaps are harmless under `order by position, id`),
  `reorderStages` (calls the RPC, which rewrites positions 0..n-1).
- `components/` — `template-list.tsx` (table + empty state),
  `create-template-dialog.tsx` (name + optional description; opens when
  `?new=1`), `template-header.tsx` (inline rename + delete w/ confirm),
  `stage-list.tsx` (client; owns optimistic state), `stage-row.tsx` (inline
  rename, delete, up/down buttons — disabled at edges), `add-stage.tsx`
  (single input + submit, clears on success).

## Routes

- `src/app/(dashboard)/templates/page.tsx` — awaits `requireOrg()`, renders
  list. Fixes the nav 404 (deferred item).
- `src/app/(dashboard)/templates/[id]/page.tsx` — detail; `notFound()` when
  `getTemplate` returns null.
- Command palette: the existing "Templates" navigation entry now resolves; add
  **"Create template"** command → router push `/templates?new=1` (closes the
  deferred palette item).

## Optimistic-UI convention (established here)

`stage-list.tsx` demonstrates the project pattern, to be reused by all future
mutations: React 19 `useOptimistic` over the server-provided stage array;
mutations apply optimistically, invoke the Server Action, and on `ok: false`
toast the generic error (sonner) — the next server render restores truth via
`revalidatePath`. Reorder is up/down swap (keyboard-accessible); **no
drag-and-drop dependency** in this slice. Document the pattern in one short
paragraph appended to `src/features/README.md`.

## Tests

- **Unit (CI `test` job):** `schema.test.ts` — bounds, trimming, uuid
  rejection, `reorderStagesInput` shape.
- **Integration (new lane):** `src/features/templates/rls.integration.test.ts`
  — via admin API + anon clients (the `verify-foundation.ts` technique): two
  users/orgs; assert cross-tenant invisibility of orgs **and** templates,
  member CRUD on own templates, reorder RPC rejects a foreign template id.
  Wiring: vitest config **excludes** `*.integration.test.ts` from the default
  run; new `vitest.integration.config.ts` + script `test:integration`; the CI
  **`db` job** runs it after migrations (stack already up; needs env vars from
  `supabase status`). This promotes the RLS proof into CI and **deletes
  `scripts/verify-foundation.ts`** (superseded — closes that deferred item).
  `verify-auth.ts` / `verify-onboarding.ts` are untouched (out of scope).
- **Seed:** demo org gains a "Store Refresh" template with stages Survey →
  Install → QA → Sign-off, idempotent (skip when the template exists).

## Out of scope

Fields, checklists, rollouts, template duplication, roles beyond org
membership, drag-and-drop, stage colors, `env.ts` adoption/tightening (tracked
separately in memory).

## Verification

- `npm run verify` green; `npm run test:integration` green locally.
- Manual: create template → add/rename/reorder/delete stages → second demo
  user (fresh magic link) cannot see it; `/templates/<foreign-id>` → 404.
- Drift check: `npm run db:generate` after schema commit produces no diff.
- PR opened from the feature branch; all CI checks green on the PR before
  merge.
