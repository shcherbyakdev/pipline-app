# Stage Requirements — Slice 6 Design

**Date:** 2026-08-10
**Status:** Approved in brainstorm.
**Parent:** `2026-08-09-client-flow-vision-and-roadmap-design.md` (slice 6 of 7).
Slice 5b (CSV import) deliberately skipped for now — revisit before the
matrix needs 200 rows.

## Goal

Stages stop being toggles and start carrying data. A template stage gains
**requirements** (typed fields, checklists); creating a program snapshots
them; each unit's stage completes **by satisfying its requirements** —
with a staff override — instead of by hand. This is the primitive the
participant flow (slice 7), evidence (8), portal (9), chasing (10), and
recurrence (11) all build on.

## Decisions inherited from the vision spec (not revisited)

Typed nullable response columns + CHECK (type denormalized onto the
response); checklist = editor sugar expanded to per-item boolean
requirements at snapshot time; `photo` satisfied via evidence rows
(slice 8 — in the type CHECK now, absent from the editor);
`done_source ('requirements'|'override')`; requirements ride the existing
`create_program` snapshot; every new table: `org_id` + RLS-column indexes +
explicit GRANTs; RLS tested through the client SDK.

## Decisions made in this brainstorm

| Decision | Choice | Why |
|---|---|---|
| Fill-in surface | **Unit detail page** `/programs/[id]/units/[unitId]` | Deep-linkable (chasing/portal need these URLs), home of the stage-requirements form that `/p/[token]` reuses in slice 7 |
| Derivation runs | **In the database** (trigger on responses) | Slices 7/10 add more write paths; one truth. Continues the repo's trigger pattern (`done_at`, fan-out) |
| Zero-requirement stages | Keep today's manual toggle; recorded as `override` | Forced: vacuous derivation would mark them done at birth |
| Dot-click on requirement-bearing stages | Navigates to the unit page (`#stage-<id>`) | The dot stays at-a-glance truth; done is no longer a claim you can click into existence |
| Editor scope | Minimal: add (label/type/required), edit label, delete, up/down reorder; options/items as one-per-line textarea | YAGNI; drag-and-drop and validation rules are not v1 |

## Data model

```
template_stage_requirements            -- freely editable with the template
  id uuid PK, template_stage_id FK→template_stages (cascade),
  org_id FK→orgs (cascade),
  type text CHECK in ('text','number','boolean','date','choice','checklist','photo'),
  label text NOT NULL, required boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',   -- {options:[..]} choice, {items:[..]} checklist
  position integer NOT NULL,            -- per stage; ORDER BY position, id
  created_at timestamptz
  INDEX (template_stage_id), (org_id)

program_stage_requirements             -- frozen copy; written ONLY by create_program
  id uuid PK, program_stage_id FK→program_stages (cascade),
  program_id FK→programs (cascade),     -- denormalized for embeds
  org_id FK→orgs (cascade),
  type text CHECK ('text','number','boolean','date','choice','photo'),  -- checklist never survives expansion
  label text NOT NULL, required boolean NOT NULL,
  config jsonb NOT NULL DEFAULT '{}',   -- {options} for choice; {group} for expanded checklist items
  position integer NOT NULL, created_at timestamptz
  INDEX (program_stage_id), (program_id), (org_id)

unit_stage_responses                   -- one answer per (unit_stage × requirement)
  id uuid PK, unit_stage_id FK→unit_stages (cascade),
  program_stage_requirement_id FK→program_stage_requirements (cascade),
  unit_id FK→units (cascade), program_id FK→programs (cascade),  -- denormalized
  org_id FK→orgs (cascade),
  type text NOT NULL,                   -- copied from the requirement by trigger
  value_text text, value_number numeric, value_bool boolean, value_date date,
  answered_by_user_id uuid,             -- answered_by_participant_id arrives in slice 7
  created_at, updated_at timestamptz
  UNIQUE (unit_stage_id, program_stage_requirement_id)
  CHECK: exactly one value column non-null, matching `type`
         (text|choice→value_text, number→value_number, boolean→value_bool,
          date→value_date; photo→all null is NOT valid here — photo
          requirements get no response row until slice 8 wires evidence)
  INDEX (unit_stage_id), (program_stage_requirement_id), (unit_id),
        (program_id), (org_id), (value_date)   -- recurrence scans value_date

unit_stages + done_source text CHECK in ('requirements','override'), nullable
  -- no client grant; maintained by triggers only (the done_at pattern)
```

### Trust: the response row derives itself

Client input to an insert/upsert is only `(unit_stage_id,
program_stage_requirement_id, value)`. A `BEFORE INSERT OR UPDATE` trigger
(definer, the `check_unit_org` pattern):

1. loads the unit_stage and the requirement (RLS-exempt inside definer, so
   checks are explicit);
2. rejects unless `requirement.program_stage_id = unit_stage.program_stage_id`
   ("requirement not found" — cross-program/stage pairs impossible by
   construction);
3. fills `unit_id`, `program_id`, `org_id` from the unit_stage and `type`
   from the requirement — denormalized columns are never client-supplied.

### Derivation

`AFTER INSERT OR UPDATE OR DELETE` on `unit_stage_responses` (definer)
recomputes the parent unit_stage:

- satisfied(requirement) := a response row exists AND (type='boolean' →
  `value_bool = true`; otherwise the CHECK already guarantees a value).
- done := every `required` requirement of the stage is satisfied AND the
  stage has ≥1 required requirement.
- Writes `status` + `done_source = 'requirements'` (or `pending` +
  `done_source = NULL`). The existing `unit_stages_done_at` trigger keeps
  maintaining `done_at` — it fires on any status write.

Override: `maintain_unit_stage_done_at` is extended — when `status`
changes and the writer did **not** explicitly set `done_source` (only the
derivation function ever does), it sets `done_source := 'override'` on
done, `NULL` on pending. The existing column-scoped `status` grant and
`setUnitStageStatus` action survive untouched as the override/zero-req
path. An override holds until the next response change re-derives.

Clearing an answer = DELETE of the response row (the CHECK forbids
all-null); members hold select/insert/update/delete on responses.

### RLS & grants (0004/0006 conventions)

- All three tables: member `select` via `org_id in (select public.user_orgs())`.
- `template_stage_requirements`: member insert/update/delete (the
  `template_stages` precedent).
- `program_stage_requirements`: select-only for both API roles — RPC-only
  writes (the `program_stages` precedent).
- `unit_stage_responses`: member insert/update/delete; column-scoped so
  denormalized/type columns aren't client-writable — grant
  insert(unit_stage_id, program_stage_requirement_id, value_text,
  value_number, value_bool, value_date), update(value_text, value_number,
  value_bool, value_date, updated_at); triggers own the rest.
- Explicit GRANTs in the same migration as each table.

## Snapshot & checklist expansion

`create_program` gains one statement: copy the template's requirements per
stage. `checklist` rows expand — each `config.items[]` entry becomes one
`boolean` requirement (label `"<checklist label> · <item>"`, config
`{"group": "<checklist label>"}`, `required` inherited), positioned after
the checklist's own position, `0..n-1` re-numbered per stage. All other
types copy verbatim. Templates stay editable and deletable; programs stay
frozen.

## Surfaces

**Template editor** (`/templates/[id]`): new `requirement-list.tsx` under
each stage row, following the `stage-list.tsx` optimistic pattern. Add
form: label + type select + required switch; choice/checklist get a
one-per-line textarea for options/items. Edit label inline; delete;
up/down reorder rewriting `position` to 0..n-1 per stage — implemented the
same way template-stage reorder already is (mirror that code path exactly,
RPC or action, rather than inventing a second mechanism).

**Unit detail page** (`/programs/[id]/units/[unitId]`): server component
loading one unit with stages, requirements, responses, and status. Each
stage is a section (`id="stage-<programStageId>"`): status chip
(`done · requirements` / `done · override` / `pending n/m`), inputs per
requirement (Input for text/number/date, Switch for boolean, Select for
choice) saving per-field on commit via the optimistic pattern, and the
override affordance ("Mark done anyway" / "Reopen"). Non-uuid or invisible
`unitId`/`id` → `notFound()` (settles the deferred uuid-404 guard for this
route). Back link to the program.

**Matrix** (`/programs/[id]`): unit name links to the unit page. StageDots:
requirement-bearing stages navigate (`/programs/[id]/units/[unitId]#stage-<id>`);
zero-requirement stages keep the direct optimistic toggle. The page query
gains per-stage `hasRequirements` so the dot knows which behavior it has.

**New/changed files** (feature-sliced, `app/` stays thin):

```
src/features/templates/components/requirement-list.tsx   (new)
src/features/templates/{actions,queries,schema}.ts       (+requirement CRUD/reorder)
src/features/programs/components/unit-stage-section.tsx  (new — shared form, slice 7 reuses)
src/features/programs/components/unit-row.tsx            (link + dot behavior)
src/features/programs/{actions,queries,schema}.ts        (+responses, +getUnit)
src/app/(dashboard)/programs/[id]/units/[unitId]/page.tsx (new)
src/db/schema/{templates,programs}.ts                    (+3 tables, +done_source)
src/db/migrations/0010_*.sql, 0011_requirements_rls.sql  (generated + custom)
```

## Error handling

Actions keep the `{ ok, error }` + `GENERIC_WRITE_ERROR` + server-side
logging convention. Trigger raises surface as generic failures; the
optimistic UI reconciles on revalidation. Type-mismatched values are
rejected twice: Zod at the edge (typed per requirement) and the CHECK at
the floor.

## Testing

- **Unit (Vitest):** Zod schemas — per-type value validation, config
  shapes (choice ≥2 options, checklist ≥1 item, label 1–120 chars).
- **Integration (the layer this repo trusts):**
  - Snapshot: requirements copied; checklist expanded to booleans with
    group config; later template edits don't leak into the program.
  - `program_stage_requirements` immutable to API roles (write attempts fail).
  - Response trust trigger: cross-program requirement/unit_stage pair
    rejected; denormalized columns filled server-side.
  - CHECK: wrong-typed value rejected.
  - Derivation: answering all required → done + `done_source='requirements'`;
    boolean false ≠ satisfied; deleting a required response reopens;
    optional requirements don't block.
  - Override: status toggle without responses → `done_source='override'`;
    zero-requirement stage still toggles.
  - RLS: org isolation on all three tables (two-user test, the existing
    pattern).

## Out of scope (deliberately)

Photo requirements in the editor/UI (slice 8), participants and
`answered_by_participant_id` (7), evidence (8), CSV import (5b, skipped),
chasing (10), recurrence (11), drag-and-drop reorder, per-requirement
validation rules (min/max/regex), conditional requirements (never — the
no-branching constraint is the product).
