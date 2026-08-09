# Rollouts — Feature #3

**Date:** 2026-08-09
**Status:** Approved, ready for planning
**Delivery:** feature branch `feat/rollouts` → pull request (CI green required); no direct merge to main.

## Product context

A **rollout** is one execution of a template's workflow across many physical
**units** (stores, vehicles, sites). Creating a rollout **snapshots** the
template's stages (copy-on-use) — this is the promise that let Templates skip
versioning. This slice makes templates consequential: create a rollout from a
template, see its frozen stages, and manage a minimal unit list. Progress
tracking (`unit_stages`, the matrix) is Phase 2; CSV import is the next slice.

Decisions made during brainstorm:

1. **Snapshots are immutable.** A rollout's stage list is frozen at creation —
   no edit UI, no edit path in the database. Wrong stages? Fix the template,
   create a new rollout.
2. **Units are minimal:** `name` (required) + `external_ref` (optional — the
   customer's own store number / VIN / site code; CSV import will key on it).
3. **No status lifecycle.** Created → exists → hard-deletable (confirm dialog;
   cascade removes stages/units — no execution history exists yet to protect).
4. **Snapshot mechanics via RPC** (`create_rollout`, SECURITY INVOKER): one
   transaction — validate, insert rollout, copy stages, return row. App-side
   multi-insert (non-atomic) and trigger-copy (implicit magic) were rejected.
5. **env.ts rider included** (long-deferred chore, see §env).

## Data model

Drizzle schema (`src/db/schema/rollouts.ts`, exported from the barrel), then
`npm run db:generate`, then a hand-written custom migration (RLS + grants +
RPC), following `0003_templates_rls.sql` / `0004_table_grants.sql` conventions.

```
rollouts
  id          uuid pk default gen_random_uuid()
  org_id      uuid not null → orgs(id) on delete cascade
  template_id uuid → templates(id) on delete set null   -- provenance only; nullable
  name        text not null
  created_at  timestamptz not null default now()
  updated_at  timestamptz not null default now()        -- touched on rename only; no unit-touch trigger
  indexes: org_id, template_id

rollout_stages                                          -- the frozen copy
  id          uuid pk default gen_random_uuid()
  rollout_id  uuid not null → rollouts(id) on delete cascade
  org_id      uuid not null → orgs(id) on delete cascade
  name        text not null
  position    integer not null                          -- contiguous 0..n-1, written once by the RPC
  created_at  timestamptz not null default now()
  indexes: rollout_id, org_id

units
  id           uuid pk default gen_random_uuid()
  rollout_id   uuid not null → rollouts(id) on delete cascade
  org_id       uuid not null → orgs(id) on delete cascade
  name         text not null
  external_ref text                                     -- nullable; CSV import keys on it next slice
  created_at   timestamptz not null default now()
  indexes: rollout_id, org_id
```

`template_id` is decoration (list page shows "from Store Refresh"); the
snapshot carries all load-bearing data, so a deleted template leaves the
rollout fully intact with `template_id = null`.

## RLS, grants, immutability

All policies use the established predicate `org_id in (select public.user_orgs())`.

- **`rollouts`**: member CRUD — select/insert/update/delete policies + matching
  grants to `authenticated` (same shape as `templates`).
- **`units`**: member CRUD — same.
- **`rollout_stages`**: **select-only** policy AND **select-only grant** for
  `authenticated`. Immutability is enforced in the database, not the UI: no
  insert/update/delete path exists for API roles. Rows are written only inside
  the `create_rollout` RPC transaction and removed only by the rollout's
  cascade delete (runs as table owner, exempt from grants/RLS).
- `service_role` gets full CRUD grants on all three (bypassrls still requires
  grants — the 0004 lesson).
- A `BEFORE INSERT OR UPDATE OF rollout_id, org_id` validation trigger on
  `units` checks `units.org_id` matches its rollout's real `org_id` (same
  defense-in-depth as `check_template_stage_org` on template_stages).
  `rollout_stages` needs no such trigger — API roles cannot write it at all.

### RPC

`public.create_rollout(p_template_id uuid, p_name text) returns public.rollouts`
— plpgsql, SECURITY INVOKER, `set search_path = ''`:

1. Select the template under RLS; not visible → `raise exception 'template not found'`.
2. Count its stages; zero → `raise exception 'template has no stages'` (the
   create dialog also disables 0-stage templates, but the RPC guard is
   authoritative).
3. Insert the rollout (`org_id` from the template row, `template_id`
   provenance, trimmed name).
4. Copy `template_stages` ordered by `position, id` into `rollout_stages` with
   contiguous positions 0..n-1.
5. Return the rollout row.

**The RPC is SECURITY DEFINER, not invoker** — a correction to the approach
as originally presented. Step 4 inserts into `rollout_stages`, which
deliberately has zero write grants for API roles; an invoker RPC would be
denied by its own caller's privileges. Granting `authenticated` insert instead
would open a direct PostgREST write path into the "immutable" table — a member
could append stages to their own org's rollouts, breaking the guarantee. So
`create_rollout` follows the `create_org` precedent (the established pattern
for atomic multi-table writes RLS alone cannot express): SECURITY DEFINER,
`set search_path = ''`, an explicit `auth.uid()` null check, and — because
definer mode bypasses RLS — the template check written as an explicit
membership test (`template.org_id in (select public.user_orgs())`). Grant
execute to `authenticated`. `rollout_stages` keeps zero write grants, making
immutability absolute.

## Feature slice — `src/features/rollouts/`

- `schema.ts` — Zod 4 (`z.uuid()`): `rolloutName` (trim 1–80), `unitName`
  (trim 1–120), `externalRef` (trim 0–120), inputs:
  `createRolloutInput { templateId, name }`, `renameRolloutInput { id, name }`,
  `deleteRolloutInput { id }`, `addUnitInput { rolloutId, name, externalRef? }`,
  `renameUnitInput { id, name }`, `deleteUnitInput { id }`. The action-state
  shape and generic error copy now have two consumers, so they move to a
  shared home: new `src/lib/actions.ts` exporting `type ActionState =
  { ok: true } | { ok: false; error: string }` and `GENERIC_WRITE_ERROR`;
  `features/templates/schema.ts` switches to re-exporting from it (no
  behaviour change, existing imports keep working).
- `queries.ts` — RLS-scoped Supabase server client:
  - `listRollouts()` → `{ id, name, templateName: string | null, stageCount,
    unitCount, createdAt }[]` (embedded `templates(name)`,
    `rollout_stages(count)`, `units(count)`), ordered `created_at desc`.
  - `getRollout(id)` → `{ id, name, templateName, createdAt, stages: { id,
    name, position }[], units: { id, name, externalRef }[] }` or `null`
    (stages ordered by position; units by `created_at, id`).
- `actions.ts` — Server Actions, established error discipline (generic client
  copy, raw errors `console.error`-logged): `createRollout(prev, formData)`
  (useActionState form; calls the RPC; redirects to the new detail page),
  `renameRollout`, `deleteRollout` (redirects to `/rollouts`), `addUnit`,
  `renameUnit`, `deleteUnit` — object-input actions returning the action-state
  shape. Every mutation revalidates BOTH `/rollouts` and the detail path (the
  Templates lesson, applied from the start).
- `components/` — `rollout-list.tsx` (table + empty state),
  `create-rollout-dialog.tsx` (URL-state open via `useSearchParams` — the
  Templates fix pattern, not the buggy mount-seed; template `<select>` from
  server-passed options, 0-stage templates disabled with a hint),
  `rollout-header.tsx` (inline rename + delete confirm),
  `stage-strip.tsx` (read-only ordered chips — server component),
  `unit-list.tsx` (client; `useOptimistic` + keyed-remount per the documented
  convention; add form with name + optional ref, inline rename, delete).

## Routes & shell

- `src/app/(dashboard)/rollouts/page.tsx` — replaces the static stub: list +
  Create dialog (`?new=1`), template options fetched server-side via
  `features/templates/queries.listTemplates()` (sanctioned cross-feature read).
- `src/app/(dashboard)/rollouts/[id]/page.tsx` — `getRollout` → `notFound()`
  on null; header + stage strip + units section.
- Command palette: add "Create rollout" → `/rollouts?new=1` (closes the last
  major app-shell deferred item).

## env.ts rider

- Tighten `NEXT_PUBLIC_SUPABASE_URL` (`.url()`, required) and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`.min(1)`, required).
  `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL` stay optional (server-only,
  script-consumed).
- Route `src/lib/supabase/server.ts`, `src/lib/supabase/client.ts`, and
  `src/lib/supabase/middleware.ts` through `@/env` instead of raw
  `process.env` (the middleware's silent skip-if-unconfigured branch is
  removed — a missing key now fails loudly at boot, which is the point).
- Scripts (`seed.ts`, preflight, verify-*) keep their own env handling — out
  of scope.

## Tests

- **Unit (CI `test` job):** `schema.test.ts` — bounds, trimming, uuid
  rejection, optional `externalRef`, plus happy-path parses (the Task-2
  lesson: never only-negative assertions).
- **Integration (existing CI lane):** `src/features/rollouts/rls.integration.test.ts`:
  - Cross-tenant: foreign member sees no rollouts/units; cannot insert a unit
    into a foreign rollout; update/delete denial on rollouts + units using the
    0-rows-affected + owner-reread pattern.
  - RPC: rejects a foreign template ('template not found'); rejects a 0-stage
    template ('template has no stages'); creates rollout + stages atomically
    for the owner.
  - **Immutability:** authenticated update/delete/insert on `rollout_stages`
    fails (permission denied — assert error non-null, no message-text
    assertions).
  - **Snapshot semantics:** copied stage names/order match the template at
    creation; editing the template afterwards does NOT change the rollout;
    deleting the template leaves the rollout intact with `template_id` null.
- **Seed:** demo org gains rollout "Q3 Store Refresh" created from the "Store
  Refresh" template via the RPC, plus 2 units ("Store #101 — Kraków",
  ref "S-101"; "Store #102 — Gdańsk", ref "S-102"), idempotent.

## Out of scope

CSV import, `unit_stages` / progress tracking, the matrix, statuses, waves,
snapshot editing, unit address/notes, pagination.

## Verification

- `npm run verify` and `npm run test:integration` green locally.
- Manual: create rollout from demo template → stages match frozen; rename;
  add/rename/delete units; edit the template → rollout unchanged; delete the
  template → rollout survives, list shows no template name; foreign id → 404.
- `npm run db:generate` no drift; `npm run db:reset` clean.
- PR from `feat/rollouts`; all CI checks green before merge.
