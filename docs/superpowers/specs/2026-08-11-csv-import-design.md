# CSV Import — Slice 5b Design

**Date:** 2026-08-11
**Roadmap row:** `2026-08-09-client-flow-vision-and-roadmap-design.md`, slice 5b.
**Done when:** a 500-row import lands in < 10s and re-import is idempotent
on `units.external_ref`.

## Scope decision

This is the roadmap's demoted-to-utility slice: "needed so the matrix has
200 rows to show, nothing more." The import maps exactly two CSV columns —
`name` and `external_ref` — onto units in one program. Client and
participant linking stay manual console actions. The one durable artifact is
the uniqueness guarantee on `(program_id, external_ref)`, which is what
makes re-import (and any future sync) idempotent.

## Decisions (settled in brainstorm, 2026-08-11)

1. **Columns:** `name` + `external_ref` only. No client column, no
   participant column, no header-mapping UI.
2. **Re-import semantics:** upsert. An existing `external_ref` gets its
   name updated from the CSV; the CSV is the source of truth for the name.
   Stage progress, responses, evidence, client links are untouched.
3. **Error model:** all-or-nothing. The whole file validates first; any
   invalid row means nothing is written and errors are listed with CSV row
   numbers. Idempotency makes rerunning after a fix safe.
4. **UI:** dialog with a preview step. Parse in the browser, show
   "N new, M updated" (or the error list), write only on Confirm.
5. **Write path:** plain unique constraint + a single PostgREST upsert from
   a server action. An `import_units` RPC (the `create_program` precedent)
   was considered and rejected: one statement is already atomic, and the
   RPC's only advantages (exact server-side counts, room for join logic)
   don't pay for a custom-SQL migration in a utility slice.

## Data model — one constraint, no new tables

```
units: UNIQUE (program_id, external_ref)
```

Added in the Drizzle schema (`unique().on(programId, externalRef)`), shipped
as a regular generated migration — no custom SQL, and no new grants because
there is no new table. Postgres treats NULLs as distinct in unique
constraints, so manually-added units (null `external_ref`) never collide;
the slice-11 partial-index/upsert trap does not apply. Properties:

- Uniqueness is **per program** — two programs can both contain `STORE-001`.
- Matching is exact and case-sensitive: `STORE-001` ≠ `store-001`.
- If existing dev data contains in-program duplicate refs the migration
  fails loudly; fix the data and rerun. There is no production yet.

## Parse + validate — a pure helper

New dependencies: `papaparse` + `@types/papaparse` (the roadmap's named
parser; handles quoting, BOM, and newline variants that a hand-rolled
splitter would fumble).

`parseUnitsCsv(text)` lives in the programs feature as a pure function
(no DOM, unit-testable) and returns either `{ rows }` or `{ errors }`:

- Papa Parse with `header: true`; headers trimmed and lowercased. The file
  must contain `name` and `external_ref` columns; extra columns are
  ignored; missing headers are a file-level error.
- Per row: `name` 1–120 chars after trim (the existing `unitName` rule);
  `external_ref` 1–120 chars after trim and **required** — a row without a
  key cannot be imported idempotently.
- Duplicate `external_ref` within the file is an error on every occurrence
  after the first.
- Empty files (no data rows) and files over **2,000 rows** are file-level
  errors. The cap bounds the server-action payload; 500-row target files
  clear it comfortably.
- Errors carry CSV row numbers (header = row 1, first data row = row 2, the
  numbers a spreadsheet shows).

## Server actions — preview and write

Two actions in `src/features/programs/actions.ts`, both following the
`addUnit` idiom (zod parse → parent-program lookup for tenancy + `org_id` →
write → `revalidatePath` → `fail()`/`GENERIC_WRITE_ERROR` on error):

- `previewUnitsImport(programId, refs: string[])` — selects the program's
  existing `external_ref`s and returns the subset that already exist. The
  dialog derives "N new, M updated" from it.
- `importUnits(programId, rows: {name, externalRef}[])` — re-validates
  everything server-side with the same zod rules (client parsing is
  convenience, not trust; in-file duplicate refs would also make the upsert
  fail with "cannot affect row a second time"), then writes with **one**
  call:

  ```ts
  supabase.from("units").upsert(rows, { onConflict: "program_id,external_ref" })
  ```

  One HTTP request is one SQL statement, so the write is atomic —
  all-or-nothing holds at the database even if validation were bypassed.
  Payload rows carry `program_id`, `org_id`, `name`, `external_ref`; RLS
  applies as with any staff write. The existing `units` AFTER INSERT
  trigger (0008) fans out `unit_stages` for new units; updated units keep
  their existing stage rows — an ON CONFLICT update fires no INSERT
  trigger, and the update writes only the supplied columns.

The post-import summary reuses the preview's counts. A concurrent import
could skew them; that is cosmetic in a single-operator console and accepted.

## UI — one dialog on the program page

An "Import CSV" button beside the existing add-unit affordance opens a
dialog:

1. File picker (`.csv`). Papa Parse is dynamically imported so it stays out
   of the main bundle.
2. Parse + validate, then `previewUnitsImport`. Result: either a scrollable
   error list ("row 14: external_ref is blank") or "212 rows: 180 new,
   32 updated".
3. **Confirm** runs `importUnits`; success closes the dialog and
   `revalidatePath` refreshes the matrix. Failure shows the generic write
   error, and rerunning is safe.

No template download, no column mapper, no import history. The matrix
itself is the receipt.

## Testing

- **Unit (Vitest):** `parseUnitsCsv` — missing headers, header
  case/whitespace, BOM, quoted commas, blank name/ref, in-file duplicates,
  row cap, row-number accuracy. Zod input schemas in the existing
  `schema.test.ts` style.
- **Integration (serial, per the slice-11 convention):**
  - 500-row import completes in < 10s and fans out `unit_stages` for every
    new unit (the roadmap's success criterion, asserted).
  - Re-importing the same file changes nothing (idempotent).
  - Re-importing with one changed name updates that name and leaves stage
    status, responses, and `unit_stages` rows untouched.
  - A second program imports the same refs without conflict.
  - A program in another org is invisible → generic failure, nothing
    written.
  - Duplicate in-file refs are rejected server-side even when the client
    validator is bypassed.

## Out of scope (deliberate)

- Client / participant columns and any auto-creation from spreadsheet data.
- Header-mapping UI, template download, import history/audit.
- Matching pre-existing manual units by name (null-ref units are simply
  left alone; a duplicate-looking unit from a CSV is a new unit).
- Deleting units missing from a re-imported file (import is additive).
- Async/queued imports — at the 2,000-row cap a synchronous action is fine.

## New environment variables

None. No new secrets, no new infra.
