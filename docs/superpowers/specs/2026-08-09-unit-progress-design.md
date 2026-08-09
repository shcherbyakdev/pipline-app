# Unit progress — Feature #4

**Date:** 2026-08-09
**Status:** Approved (auto mode), ready for planning
**Delivery:** feature branch `feat/unit-progress` → pull request (CI green required); no direct merge to main.

## Product context

A rollout currently shows a frozen stage list and a flat unit list — there is
no way to record where any unit actually stands. This slice adds the missing
core: per-unit-per-stage progress (`unit_stages`), the ability to mark a
unit's stage done/undone, and progress visibility on both the rollout detail
page and the rollout list. It was chosen over the roadmap's "CSV import" slice
because it completes the product loop (model → execute → see progress);
import only adds units faster and lands next.

Decisions made during brainstorm (auto mode — decided against the roadmap and
existing conventions, not with the user in the loop):

1. **Eager rows, not a completion log.** One `unit_stages` row per
   (unit × rollout stage), created by the system with `status = 'pending'`.
   A completion-log table (rows only when done) was rejected: Phase 2/3
   attach evidence and checklists to a unit-stage *before* it completes
   (before-photos), so the row must exist ahead of completion. A
   `units.current_stage_id` pointer was rejected: no per-stage state, forces
   linearity, and cannot back the matrix.
2. **Statuses are minimal:** `'pending' | 'done'` (text + CHECK, not an
   enum — swapping a CHECK is cheaper than enum surgery when
   `in_progress`/`blocked` arrive with the installer flow). `done_at` is
   trigger-maintained, never client-written.
3. **No linearity enforcement.** Any stage can be toggled in any order;
   "current stage" is derived (first pending). Real deployments complete
   stages out of order; the matrix treats cells independently. An "advance"
   affordance can layer on later without schema change.
4. **Fan-out via `AFTER INSERT` trigger on `units`** (SECURITY DEFINER).
   The rollouts spec rejected trigger-copy for `create_rollout` as implicit
   magic — but that copy had user-facing semantics (which template, what
   name). This copy is a pure derivation with zero user input: every new
   unit gets exactly its rollout's stages as pending rows. A trigger keeps
   `addUnit` a plain member insert (no API change) and gives next slice's
   CSV bulk insert fan-out for free. An `add_unit` RPC was rejected as a
   breaking change to the established member-writable units model.
5. **Rider: column-scope the `units` update grant** to
   `(name, external_ref)`. Nothing in the product moves a unit between
   rollouts or orgs, and a repointed `rollout_id` would orphan the fanned-out
   rows. Structural fix at the grant layer, same move as the rollouts
   `(name, updated_at)` scope.

## Data model

Drizzle schema (`src/db/schema/rollouts.ts` — same aggregate, exported from
the barrel), then `npm run db:generate`, then a hand-written custom migration
(RLS + grants + triggers + backfill) following the 0006 conventions.

```
unit_stages                                  -- one row per (unit × stage)
  id               uuid pk default gen_random_uuid()
  unit_id          uuid not null → units(id) on delete cascade
  rollout_stage_id uuid not null → rollout_stages(id) on delete cascade
  rollout_id       uuid not null → rollouts(id) on delete cascade   -- denormalized: embeds + counts
  org_id           uuid not null → orgs(id) on delete cascade
  status           text not null default 'pending'                  -- check (status in ('pending','done'))
  done_at          timestamptz                                      -- trigger-maintained from status transitions
  created_at       timestamptz not null default now()
  unique (unit_id, rollout_stage_id)
  indexes: unit_id, rollout_stage_id, rollout_id, org_id            -- org_id backs the RLS predicate
```

No `updated_at`: the only mutable column is `status`, and `done_at`/`created_at`
already bracket its lifecycle. If the CHECK cannot be expressed in the Drizzle
table definition cleanly, it moves to the custom migration — either layer is
authoritative-enough; the constraint must exist in the database.

## RLS, grants, triggers

All policies use the established predicate `org_id in (select public.user_orgs())`.

- **Policies:** `select` and `update` (using + with check) for `authenticated`
  members. **No insert or delete policy** — rows are system-managed.
- **Grants:** `select` + **column-scoped `update (status)`** for
  `authenticated` — `done_at`, FKs, and `org_id` are unreachable by any
  client. `service_role` gets `select` only (the rollout_stages precedent:
  the definer trigger and owner-run cascades are the only writers; nothing
  in the API writes this table directly).
- **Fan-out trigger:** `AFTER INSERT ON units`, function
  `public.copy_stages_to_unit()` — plpgsql, SECURITY DEFINER,
  `set search_path = ''` (definer because API roles hold no insert grant on
  `unit_stages`; same reasoning as `create_rollout`). Inserts one pending row
  per `rollout_stages` row of `new.rollout_id`, deriving `rollout_id` and
  `org_id` from `new` — every value comes from parent rows, so no
  org-consistency trigger is needed on `unit_stages` (consistency by
  construction). No user input flows through it; it raises nothing.
- **`done_at` trigger:** `BEFORE UPDATE OF status ON unit_stages`, invoker,
  sets `done_at := now()` on pending→done, `null` on done→pending, else
  leaves it. Clients cannot write `done_at` (no column grant) — the trigger
  is the only writer.
- **Rider:** `revoke update on public.units from authenticated;` then
  `grant update (name, external_ref) on public.units to authenticated;`.
  The existing `units_check_org` trigger stays (still guards insert, and
  service_role updates still pass through it).
- **Backfill:** insert pending rows for every existing (unit × stage) pair
  (`on conflict do nothing`) so pre-feature units (the seeded demo) are
  complete. Runs as migration owner; RLS/grants don't apply.
- Cascade note: `unit_stages` rows die with their unit, their stage, their
  rollout, or their org — two overlapping cascade paths (via units and via
  rollout_stages) are fine in Postgres.

## Feature slice — `src/features/rollouts/` (extended)

Progress lives in the rollouts aggregate: the UI is entirely on the rollout
detail/list pages, and units components already live here. No new slice.

- `schema.ts` — add `setUnitStageStatusInput = { id: z.uuid(), done: z.boolean() }`.
- `actions.ts` — add `setUnitStageStatus(input)`: parse → update
  `unit_stages.status` (`'done'`/`'pending'`) by id via the RLS-scoped
  client, `.select("rollout_id").maybeSingle()` — null data ⇒ generic
  failure (foreign/nonexistent row is invisible, indistinguishable — the
  established pattern); revalidate `/rollouts` + the detail path. Error
  discipline unchanged (generic copy, raw error logged).
- `queries.ts` —
  - `getRollout(id)`: units embed gains
    `unit_stages(id, rollout_stage_id, status)`; each returned unit gains
    `stages: { unitStageId, stageId, done }[]` ordered by the rollout's
    stage positions (order derived app-side from the already-sorted stages
    array, not trusted from the embed).
  - `listRollouts()`: gains `doneCount` / `totalCount` via aliased embedded
    counts — `total:unit_stages(count), done:unit_stages(count)` with an
    aliased filter `.eq("done.status", "done")`. If aliased-filtered counts
    misbehave in the deployed PostgREST, fall back to embedding
    `unit_stages(status)` and counting app-side (list sizes are MVP-small);
    the return type is the contract, not the wire shape.
- `components/` —
  - `stage-dots.tsx` (client): a row of small round toggle buttons, one per
    stage in position order; filled = done; `aria-label` and `title` name
    the stage and the action ("Mark Install done" / "…not done"); disabled
    prop for pending transitions is unnecessary — optimistic state flips
    instantly and server truth reconciles.
  - `unit-row.tsx`: renders `StageDots` between the name input and the
    ref/delete controls, plus a `k/n` fraction (`tabular-nums`).
  - `unit-list.tsx`: reducer gains
    `{ type: "setStage"; unitId; unitStageId; done }`; a summary line above
    the list shows aggregate progress ("12 of 24 stages done · 50%") derived
    from optimistic state. `Unit` prop type carries `stages` through.
    Stage *names* come from the rollout's stages prop (`UnitList` already
    sits next to `StageStrip` on the page — pass `stages` down and zip by
    `stageId`).
  - `rollout-list.tsx`: new "Progress" column — `done/total` as a percent
    (`—` when a rollout has no units).
- No changes to `stage-strip.tsx`, dialogs, or templates.

## Routes & shell

No new routes. `/rollouts` and `/rollouts/[id]` render the extended
components; `getRollout`/`listRollouts` remain the only data paths. No
command-palette additions.

## Seed

`ensureDemoRollout` gains a progress step (or a sibling
`ensureDemoProgress`): mark "Store #101 — Kraków" done for Survey + Install,
"Store #102 — Gdańsk" done for Survey — via `unit_stages` status updates as
the signed-in demo user (exercises the real grant path). Idempotent: plain
status updates keyed on unit/stage lookups by name; re-runs converge to the
same state. Fan-out itself needs no seeding — the trigger populates rows when
`ensureDemoRollout` inserts units (and the migration backfills stacks that
seeded before this feature).

## Tests

- **Unit (CI `test` job):** `schema.test.ts` — `setUnitStageStatusInput`
  happy path, uuid rejection, non-boolean rejection.
- **Integration:** `src/features/rollouts/progress.rls.integration.test.ts`
  (own file, `signedInUser` tags `progress_alice`/`progress_bob` — the
  email-collision lesson). Fixture: org + template (2 stages) + rollout via
  RPC + one unit. Cases:
  - **Fan-out:** inserting a unit creates exactly one pending row per stage,
    `done_at` null, correct `rollout_id`/`org_id`.
  - **Toggle:** owner sets done → status `'done'`, `done_at` non-null; back
    to pending → `done_at` null again.
  - **CHECK:** updating status to a non-listed value errors (constraint —
    portable across local/CI).
  - **System-managed structure:** authenticated `insert` into `unit_stages`
    errors (no policy locally, no grant in CI — both error); `delete`
    asserted by effect (0 rows returned + owner re-read intact — the
    local/CI grant-divergence pattern from the rollout_stages suite).
  - **Cross-tenant:** foreign member sees zero rows; foreign update matches
    0 rows and owner re-read shows the value unchanged.
  - **Cascade:** deleting the unit removes its `unit_stages` rows.
  - Column-grant scoping (`done_at`, FK repoint) is deliberately untested:
    the local dev image's legacy default ACLs make column-grant denials
    non-portable (the 0004 lesson) — the CI `db` job is the authority.
- **Seed/CI:** the CI `db` job already runs migrations + seed + integration
  lanes; the backfill is exercised by `db:reset` + seed re-run locally.

## Out of scope

The virtualized progress matrix page, `in_progress`/`blocked` statuses,
checklists, evidence/uploads, linearity enforcement ("advance" semantics),
bulk operations, CSV import, unit detail page, external installer flow,
notifications, pagination.

## Verification

- `npm run verify` and `npm run test:integration` green locally.
- Manual: add a unit → dots appear pending; toggle dots → fractions and the
  summary line update; reload → state persists; list page shows the percent;
  second org sees nothing (existing RLS suites still green).
- `npm run db:generate` no drift; `npm run db:reset` clean (backfill +
  triggers replay).
- PR from `feat/unit-progress`; all CI checks green before merge.
