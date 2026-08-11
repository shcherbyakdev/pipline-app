# CSV Import (Slice 5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import units into a program from a CSV (`name`, `external_ref`), idempotent on `(program_id, external_ref)`, 500 rows in < 10s, all-or-nothing.

**Architecture:** A pure Papa Parse helper validates in the browser; a preview server action pages existing refs for "N new, M updated"; the write is one `import_units(p_program_id, p_rows)` **SECURITY INVOKER** RPC whose `ON CONFLICT DO UPDATE` sets only `name` (PostgREST upsert would SET `program_id`/`org_id` too, which the 0008 column-scoped update grant correctly rejects). A new `UNIQUE (program_id, external_ref)` constraint is the idempotency anchor; NULLs stay distinct so manual units never collide.

**Tech Stack:** Next.js server actions, Supabase (RLS + column grants), Drizzle migrations, Papa Parse, zod v4, Vitest (+ serial integration suite against the local stack).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-11-csv-import-design.md` (incl. its Amendments section — the RPC write path and paginated preview are amendments).
- CSV columns: exactly `name` + `external_ref`; extra columns ignored; headers matched after trim + lowercase.
- Row rules: `name` 1–120 chars after trim; `external_ref` 1–120 chars after trim and **required**; no duplicate `external_ref` within a file; max **2,000** rows; empty files are errors.
- All-or-nothing: any invalid row → nothing written. Error messages carry spreadsheet row numbers (header = row 1, first data row = row 2).
- Uniqueness is per program and case-sensitive (`STORE-001` ≠ `store-001`).
- Re-import updates `name` only; stage progress, responses, assignments are untouched.
- Security: no new grants beyond `grant execute` on the RPC; the RPC is `security invoker` with `set search_path = ''`; revoke/grant follows the 0022 idiom (`revoke … from public, anon; grant … to authenticated`).
- No new env vars. Integration test files already run serially (`fileParallelism: false`) — keep new suites order-safe within the file anyway.
- Local stack must be running for integration tasks: `npm run setup`, migrations via `npm run db:migrate`.

---

### Task 1: Import input schemas (zod)

**Files:**
- Modify: `src/features/programs/schema.ts`
- Test: `src/features/programs/schema.test.ts`

**Interfaces:**
- Consumes: existing `unitName` (`z.string().trim().min(1).max(120)`) in the same file.
- Produces (used by Tasks 2, 5, 6):
  - `MAX_IMPORT_ROWS = 2000`
  - `importExternalRef: z.ZodString` — trimmed, 1–120, required
  - `importRow` — `z.object({ name: unitName, externalRef: importExternalRef })`, `type ImportRow = z.infer<typeof importRow>`
  - `previewUnitsImportInput` — `{ programId: uuid, refs: string[] (1..MAX) }`
  - `importUnitsInput` — `{ programId: uuid, rows: ImportRow[] (1..MAX) }`, refined to reject duplicate `externalRef`s

- [ ] **Step 1: Write the failing tests**

Append to `src/features/programs/schema.test.ts` (extend the import list at the top with `MAX_IMPORT_ROWS, importExternalRef, importRow, previewUnitsImportInput, importUnitsInput`):

```ts
describe("import schemas (slice 5b)", () => {
  const row = (ref: string) => ({ name: `Unit ${ref}`, externalRef: ref });

  it("importExternalRef trims, requires non-empty, caps at 120", () => {
    expect(importExternalRef.parse("  S-101  ")).toBe("S-101");
    expect(importExternalRef.safeParse("   ").success).toBe(false);
    expect(importExternalRef.safeParse("x".repeat(121)).success).toBe(false);
  });

  it("importRow parses and bounds name like unitName", () => {
    expect(importRow.safeParse(row("S-1")).success).toBe(true);
    expect(importRow.safeParse({ name: "  ", externalRef: "S-1" }).success).toBe(false);
    expect(importRow.safeParse({ name: "ok", externalRef: "" }).success).toBe(false);
  });

  it("importUnitsInput rejects empty, oversize, and duplicate refs", () => {
    expect(importUnitsInput.safeParse({ programId: UUID, rows: [row("A")] }).success).toBe(true);
    expect(importUnitsInput.safeParse({ programId: UUID, rows: [] }).success).toBe(false);
    expect(
      importUnitsInput.safeParse({ programId: UUID, rows: [row("A"), row("A")] }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row(`S-${i}`));
    expect(importUnitsInput.safeParse({ programId: UUID, rows: tooMany }).success).toBe(false);
  });

  it("previewUnitsImportInput bounds refs 1..MAX", () => {
    expect(previewUnitsImportInput.safeParse({ programId: UUID, refs: ["A"] }).success).toBe(true);
    expect(previewUnitsImportInput.safeParse({ programId: UUID, refs: [] }).success).toBe(false);
    expect(previewUnitsImportInput.safeParse({ programId: "nope", refs: ["A"] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/features/programs/schema.test.ts`
Expected: FAIL — `importExternalRef` etc. are not exported.

- [ ] **Step 3: Implement the schemas**

Append to `src/features/programs/schema.ts`:

```ts
// CSV import (slice 5b). Unlike the add-unit form's optional externalRef,
// an import row's ref is required — it is the idempotency key.
export const MAX_IMPORT_ROWS = 2000;
export const importExternalRef = z.string().trim().min(1).max(120);
export const importRow = z.object({ name: unitName, externalRef: importExternalRef });
export type ImportRow = z.infer<typeof importRow>;

export const previewUnitsImportInput = z.object({
  programId: z.uuid(),
  refs: z.array(importExternalRef).min(1).max(MAX_IMPORT_ROWS),
});

export const importUnitsInput = z
  .object({
    programId: z.uuid(),
    rows: z.array(importRow).min(1).max(MAX_IMPORT_ROWS),
  })
  // In-file duplicate refs would make the RPC's upsert hit the same row
  // twice ("cannot affect row a second time"); reject them up front.
  .refine((v) => new Set(v.rows.map((r) => r.externalRef)).size === v.rows.length, {
    message: "duplicate external_ref",
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/features/programs/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/programs/schema.ts src/features/programs/schema.test.ts
git commit -m "feat: zod input schemas for CSV unit import (slice 5b)"
```

---

### Task 2: Papa Parse helper `parseUnitsCsv`

**Files:**
- Create: `src/features/programs/csv.ts`
- Test: `src/features/programs/csv.test.ts`
- Modify: `package.json` (deps)

**Interfaces:**
- Consumes: `unitName`, `importExternalRef`, `MAX_IMPORT_ROWS`, `ImportRow` from Task 1.
- Produces (used by Task 6):
  - `type ParseCsvResult = { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] }`
  - `parseUnitsCsv(text: string): ParseCsvResult`

- [ ] **Step 1: Install dependencies**

```bash
npm install papaparse && npm install -D @types/papaparse
```

- [ ] **Step 2: Write the failing tests**

Create `src/features/programs/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseUnitsCsv } from "./csv";
import { MAX_IMPORT_ROWS } from "./schema";

const ok = (text: string) => {
  const result = parseUnitsCsv(text);
  if (!result.ok) throw new Error(`expected ok, got: ${result.errors.join("; ")}`);
  return result.rows;
};
const errorsOf = (text: string) => {
  const result = parseUnitsCsv(text);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("parseUnitsCsv", () => {
  it("parses the happy path and trims values", () => {
    expect(ok("name,external_ref\n  Store #1  ,  S-1  \nStore #2,S-2")).toEqual([
      { name: "Store #1", externalRef: "S-1" },
      { name: "Store #2", externalRef: "S-2" },
    ]);
  });

  it("matches headers case-insensitively and ignores extra columns", () => {
    expect(ok("Name,External_Ref,City\nA,S-1,Kyiv")).toEqual([{ name: "A", externalRef: "S-1" }]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(ok("\uFEFFname,external_ref\nA,S-1")).toHaveLength(1);
  });

  it("handles quoted commas", () => {
    expect(ok('name,external_ref\n"Store, North",S-1')[0].name).toBe("Store, North");
  });

  it("rejects files missing required headers", () => {
    expect(errorsOf("name,ref\nA,S-1")[0]).toMatch(/name.*external_ref|external_ref/);
  });

  it("rejects empty files and files with no data rows", () => {
    expect(errorsOf("").length).toBeGreaterThan(0);
    expect(errorsOf("name,external_ref\n").length).toBeGreaterThan(0);
  });

  it("reports blank name / blank ref with spreadsheet row numbers", () => {
    const errors = errorsOf("name,external_ref\nA,S-1\n,S-2\nC,");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Row 3: name/);
    expect(errors[1]).toMatch(/^Row 4: external_ref/);
  });

  it("reports over-length values", () => {
    const errors = errorsOf(`name,external_ref\n${"x".repeat(121)},S-1`);
    expect(errors[0]).toMatch(/^Row 2: name/);
  });

  it("reports in-file duplicate refs on every occurrence after the first", () => {
    const errors = errorsOf("name,external_ref\nA,S-1\nB,S-1\nC,S-1");
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Row 3: duplicate external_ref "S-1".*row 2/);
    expect(errors[1]).toMatch(/^Row 4: duplicate external_ref "S-1".*row 2/);
  });

  it("all-or-nothing: a single bad row yields errors, not rows", () => {
    expect(parseUnitsCsv("name,external_ref\nA,S-1\n,S-2").ok).toBe(false);
  });

  it(`caps at ${MAX_IMPORT_ROWS} rows`, () => {
    const body = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `U${i},S-${i}`).join("\n");
    expect(errorsOf(`name,external_ref\n${body}`)[0]).toMatch(/2000/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- src/features/programs/csv.test.ts`
Expected: FAIL — cannot resolve `./csv`.

- [ ] **Step 4: Implement `parseUnitsCsv`**

Create `src/features/programs/csv.ts`:

```ts
// Pure CSV → ImportRow[] validation for the import dialog (slice 5b).
// No DOM, no network — unit-testable in Node. The dialog imports this
// module dynamically so Papa Parse stays out of the main bundle.
import Papa from "papaparse";
import { unitName, importExternalRef, MAX_IMPORT_ROWS, type ImportRow } from "./schema";

export type ParseCsvResult = { ok: true; rows: ImportRow[] } | { ok: false; errors: string[] };

// Spreadsheet row numbers: header = row 1, first data row = row 2.
const rowNo = (dataIndex: number) => dataIndex + 2;

export function parseUnitsCsv(text: string): ParseCsvResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fields = parsed.meta.fields ?? [];
  if (!fields.includes("name") || !fields.includes("external_ref")) {
    return { ok: false, errors: ['The file needs "name" and "external_ref" columns.'] };
  }
  if (parsed.errors.length > 0) {
    return {
      ok: false,
      errors: parsed.errors.map((e) => `Row ${rowNo(e.row ?? 0)}: ${e.message}`),
    };
  }
  if (parsed.data.length === 0) {
    return { ok: false, errors: ["The file has no data rows."] };
  }
  if (parsed.data.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      errors: [`Too many rows (${parsed.data.length}); the limit is ${MAX_IMPORT_ROWS}.`],
    };
  }

  const errors: string[] = [];
  const rows: ImportRow[] = [];
  const firstSeenRow = new Map<string, number>();

  parsed.data.forEach((raw, i) => {
    const name = unitName.safeParse(raw.name ?? "");
    const ref = importExternalRef.safeParse(raw.external_ref ?? "");
    if (!name.success) errors.push(`Row ${rowNo(i)}: name must be 1–120 characters.`);
    if (!ref.success) errors.push(`Row ${rowNo(i)}: external_ref must be 1–120 characters.`);
    if (!name.success || !ref.success) return;

    const seenAt = firstSeenRow.get(ref.data);
    if (seenAt !== undefined) {
      errors.push(
        `Row ${rowNo(i)}: duplicate external_ref "${ref.data}" (first used on row ${seenAt}).`,
      );
      return;
    }
    firstSeenRow.set(ref.data, rowNo(i));
    rows.push({ name: name.data, externalRef: ref.data });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, rows };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/features/programs/csv.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/features/programs/csv.ts src/features/programs/csv.test.ts
git commit -m "feat: parseUnitsCsv — Papa Parse validation for unit import"
```

---

### Task 3: `UNIQUE (program_id, external_ref)` migration

**Files:**
- Modify: `src/db/schema/programs.ts` (units table, constraint list at ~line 112)
- Create (generated): `src/db/migrations/0023_*.sql` + meta snapshot/journal

**Interfaces:**
- Produces: constraint `units_program_external_ref_uq`, the `ON CONFLICT (program_id, external_ref)` target for Task 4. NULL refs stay distinct (Postgres default), so manually-added units never collide.

- [ ] **Step 1: Add the constraint to the Drizzle schema**

In `src/db/schema/programs.ts`, the `units` table's config array currently reads:

```ts
  (t) => [
    index("units_program_id_idx").on(t.programId),
    index("units_org_id_idx").on(t.orgId),
    index("units_assigned_participant_id_idx").on(t.assignedParticipantId),
    index("units_client_id_idx").on(t.clientId),
  ],
```

Add the unique constraint (and `unique` is already imported at the top of the file):

```ts
  (t) => [
    index("units_program_id_idx").on(t.programId),
    index("units_org_id_idx").on(t.orgId),
    index("units_assigned_participant_id_idx").on(t.assignedParticipantId),
    index("units_client_id_idx").on(t.clientId),
    // CSV import (slice 5b) upserts on this pair; NULL refs stay distinct,
    // so manually-added units without a ref never collide.
    unique("units_program_external_ref_uq").on(t.programId, t.externalRef),
  ],
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `src/db/migrations/0023_<name>.sql` containing exactly one statement:

```sql
ALTER TABLE "units" ADD CONSTRAINT "units_program_external_ref_uq" UNIQUE("program_id","external_ref");
```

Inspect the file — if drizzle generated anything else (drops, table rewrites), STOP and investigate before applying.

- [ ] **Step 3: Apply and verify**

Run: `npm run db:migrate`
Expected: applies cleanly. (If local dev data has in-program duplicate refs it fails — clean up with `npm run db:reset` and re-run.)

Run: `npm run test:integration`
Expected: existing suites still green (the constraint must not break current flows).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema/programs.ts src/db/migrations
git commit -m "feat: unique (program_id, external_ref) on units — import idempotency anchor"
```

---

### Task 4: `import_units` RPC (custom migration, TDD via integration tests)

**Files:**
- Create: `src/features/programs/import.integration.test.ts`
- Create (generated shell): `src/db/migrations/0024_import_units_security.sql` + journal entry

**Interfaces:**
- Consumes: constraint from Task 3; existing `create_org` / `create_program` RPCs and template tables (fixture setup).
- Produces (used by Task 5): RPC `import_units(p_program_id uuid, p_rows jsonb) returns jsonb` — `p_rows` is an array of `{name, external_ref}`; returns `{"inserted": n, "updated": m}`; raises on invisible program, invalid payload, or in-payload duplicates; `security invoker` so RLS + grants gate every row.

- [ ] **Step 1: Write the failing integration tests**

Create `src/features/programs/import.integration.test.ts`:

```ts
/**
 * import_units RPC proof (slice 5b): idempotent upsert on
 * (program_id, external_ref), invoker security (RLS + 0008 column grants
 * still gate), atomicity, and the 500-row/<10s roadmap criterion.
 * Requires the local Supabase stack (npm run setup). Mirrors the fixture
 * idiom of programs/rls.integration.test.ts; `it` blocks are
 * ORDER-DEPENDENT and must run sequentially in file order.
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

const rows = (refs: string[], name = (r: string) => `Unit ${r}`) =>
  refs.map((r) => ({ name: name(r), external_ref: r }));

describe("import_units", () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceOrgId: string;
  let programId: string;
  let secondProgramId: string;

  beforeAll(async () => {
    // Distinct tags: this file shares the serial integration process with
    // suites using "program_*" / other tags — same-millisecond collisions
    // on identical tags are real (see rls.integration.test.ts).
    alice = await signedInUser("import_alice");
    bob = await signedInUser("import_bob");
    const { data: orgA, error: e1 } = await alice.rpc("create_org", { p_name: "ImportCo" });
    if (e1) throw e1;
    aliceOrgId = (orgA as { id: string }).id;
    const { error: e2 } = await bob.rpc("create_org", { p_name: "OtherCo" });
    if (e2) throw e2;

    const { data: template, error: e3 } = await alice
      .from("templates")
      .insert({ org_id: aliceOrgId, name: "Import Fixture" })
      .select("id")
      .single();
    if (e3) throw e3;
    const templateId = (template as { id: string }).id;
    const { error: e4 } = await alice.from("template_stages").insert(
      ["S1", "S2"].map((name, position) => ({
        template_id: templateId,
        org_id: aliceOrgId,
        name,
        position,
      })),
    );
    if (e4) throw e4;

    const { data: p1, error: e5 } = await alice.rpc("create_program", {
      p_template_id: templateId,
      p_name: "Import P1",
    });
    if (e5) throw e5;
    programId = (p1 as { id: string }).id;
    const { data: p2, error: e6 } = await alice.rpc("create_program", {
      p_template_id: templateId,
      p_name: "Import P2",
    });
    if (e6) throw e6;
    secondProgramId = (p2 as { id: string }).id;
  });

  it("imports new units, returns counts, fans out unit_stages", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 3, updated: 0 });

    const { data: units } = await alice
      .from("units")
      .select("id, name, external_ref")
      .eq("program_id", programId);
    expect(units).toHaveLength(3);

    const { count } = await alice
      .from("unit_stages")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(6); // 3 units × 2 snapshot stages
  });

  it("re-importing the same rows is a counted no-op (idempotent)", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 0, updated: 3 });
    const { count } = await alice
      .from("units")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(3);
  });

  it("re-import updates a changed name and leaves progress untouched", async () => {
    // Mark one stage done first; the re-import must not reset it.
    const { data: unit } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "S-1")
      .single();
    const unitId = (unit as { id: string }).id;
    const { data: stage } = await alice
      .from("unit_stages")
      .select("id")
      .eq("unit_id", unitId)
      .limit(1)
      .single();
    const stageId = (stage as { id: string }).id;
    const { error: doneError } = await alice
      .from("unit_stages")
      .update({ status: "done" })
      .eq("id", stageId);
    expect(doneError).toBeNull();

    const { data, error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["S-1", "S-2", "S-3"], (r) => (r === "S-1" ? "Renamed S-1" : `Unit ${r}`)),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 0, updated: 3 });

    const { data: renamed } = await alice.from("units").select("name").eq("id", unitId).single();
    expect(renamed!.name).toBe("Renamed S-1");
    const { data: stageAfter } = await alice
      .from("unit_stages")
      .select("status")
      .eq("id", stageId)
      .single();
    expect(stageAfter!.status).toBe("done");
    const { count } = await alice
      .from("unit_stages")
      .select("id", { count: "exact", head: true })
      .eq("program_id", programId);
    expect(count).toBe(6); // no re-fan-out on update
  });

  it("a second program imports the same refs independently", async () => {
    const { data, error } = await alice.rpc("import_units", {
      p_program_id: secondProgramId,
      p_rows: rows(["S-1", "S-2"]),
    });
    expect(error).toBeNull();
    expect(data).toEqual({ inserted: 2, updated: 0 });
  });

  it("manual units without refs coexist (NULLs distinct under the constraint)", async () => {
    for (const name of ["Manual A", "Manual B"]) {
      const { error } = await alice
        .from("units")
        .insert({ program_id: programId, org_id: aliceOrgId, name });
      expect(error).toBeNull();
    }
  });

  it("duplicate refs within one payload are rejected atomically", async () => {
    const { error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: [...rows(["DUP-1"]), ...rows(["DUP-1"])],
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "DUP-1");
    expect(data).toHaveLength(0); // the valid first row rolled back too
  });

  it("rejects blank names / blank refs without writing", async () => {
    const { error } = await alice.rpc("import_units", {
      p_program_id: programId,
      p_rows: [{ name: "  ", external_ref: "BLANK-1" }],
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "BLANK-1");
    expect(data).toHaveLength(0);
  });

  it("a foreign member's import into the program fails", async () => {
    const { error } = await bob.rpc("import_units", {
      p_program_id: programId,
      p_rows: rows(["INTRUDER-1"]),
    });
    expect(error).not.toBeNull();
    const { data } = await alice
      .from("units")
      .select("id")
      .eq("program_id", programId)
      .eq("external_ref", "INTRUDER-1");
    expect(data).toHaveLength(0);
  });

  it(
    "imports 500 rows in under 10s with full fan-out (roadmap criterion)",
    async () => {
      const refs = Array.from({ length: 500 }, (_, i) => `PERF-${i}`);
      const started = performance.now();
      const { data, error } = await alice.rpc("import_units", {
        p_program_id: secondProgramId,
        p_rows: rows(refs),
      });
      const elapsed = performance.now() - started;
      expect(error).toBeNull();
      expect(data).toEqual({ inserted: 500, updated: 0 });
      expect(elapsed).toBeLessThan(10_000);

      const { count } = await alice
        .from("unit_stages")
        .select("id", { count: "exact", head: true })
        .eq("program_id", secondProgramId);
      expect(count).toBe(1004); // (500 + 2 earlier units) × 2 stages
    },
    15_000,
  );
});
```

- [ ] **Step 2: Run to verify the RPC is missing**

Run: `npm run test:integration -- src/features/programs/import.integration.test.ts`
Expected: FAIL — `import_units` does not exist (PGRST202 or similar) on the first `it`; later tests fail the same way.

- [ ] **Step 3: Create the custom migration**

Run: `npx drizzle-kit generate --custom --name=import_units_security`
Expected: empty `src/db/migrations/0024_import_units_security.sql` + journal entry.

Fill it with:

```sql
-- CSV import (slice 5b): one atomic upsert that PostgREST cannot express.
-- PostgREST's ON CONFLICT DO UPDATE sets EVERY payload column; the 0008
-- column-scoped update grant on units (name, external_ref) correctly
-- rejects program_id/org_id in that SET list. This function's DO UPDATE
-- sets only name — a write staff already hold.
--
-- SECURITY INVOKER on purpose: unlike the service-role recurrence RPCs
-- (0022), this runs as the calling member — RLS policies
-- (units_insert_member / units_update_member) and existing grants keep
-- gating every row; the function adds capability, not privilege.
create or replace function public.import_units(p_program_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_total int;
  v_inserted int;
  v_updated int;
begin
  -- RLS-filtered lookup: a foreign program is simply invisible.
  select org_id into v_org_id from public.programs where id = p_program_id;
  if v_org_id is null then
    raise exception 'program not found';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a jsonb array';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 2000 then
    raise exception 'rows must contain between 1 and 2000 items';
  end if;

  with rows as (
    select
      trim(r->>'name') as name,
      trim(r->>'external_ref') as external_ref
    from jsonb_array_elements(p_rows) as r
  ), valid as (
    select name, external_ref
    from rows
    where length(name) between 1 and 120
      and length(external_ref) between 1 and 120
  ), up as (
    insert into public.units (program_id, org_id, name, external_ref)
    select p_program_id, v_org_id, name, external_ref
    from valid
    on conflict (program_id, external_ref) do update
      set name = excluded.name
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted)
  into v_inserted, v_updated
  from up;

  -- All-or-nothing: rows filtered out by `valid` mean the file was bad;
  -- raising here rolls back the rows that did land.
  if v_inserted + v_updated <> v_total then
    raise exception 'invalid rows: names and external_refs must be 1-120 characters';
  end if;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- 0022 idiom: strip the world, grant the one intended caller.
revoke execute on function public.import_units(uuid, jsonb) from public, anon;
grant execute on function public.import_units(uuid, jsonb) to authenticated;
```

Notes for the implementer:
- `(xmax = 0)` is the standard "was this an insert" upsert probe; the `xid = integer` operator is built-in.
- Duplicate refs in `p_rows` are NOT pre-checked here: the upsert itself raises `cannot affect row a second time` and rolls back, which the test asserts. zod rejects them earlier with a nicer message.

- [ ] **Step 4: Apply and run the tests**

Run: `npm run db:migrate`
Expected: applies cleanly.

Run: `npm run test:integration -- src/features/programs/import.integration.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Run the full integration suite**

Run: `npm run test:integration`
Expected: PASS — no cross-suite fixture collisions.

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations src/features/programs/import.integration.test.ts
git commit -m "feat: import_units RPC — invoker-security idempotent unit upsert"
```

---

### Task 5: Server actions `previewUnitsImport` + `importUnits`

**Files:**
- Modify: `src/features/programs/actions.ts` (append after `deleteUnit`, ~line 132)

**Interfaces:**
- Consumes: `previewUnitsImportInput`, `importUnitsInput` (Task 1); RPC `import_units` (Task 4); existing `fail()`, `GENERIC_WRITE_ERROR`, `createClient`.
- Produces (used by Task 6):
  - `previewUnitsImport(input: unknown): Promise<{ ok: true; existingRefs: string[] } | { ok: false; error: string }>`
  - `importUnits(input: unknown): Promise<{ ok: true; inserted: number; updated: number } | { ok: false; error: string }>`

- [ ] **Step 1: Implement both actions**

Extend the import block at the top of `src/features/programs/actions.ts` with `previewUnitsImportInput, importUnitsInput`, then append:

```ts
export async function previewUnitsImport(
  input: unknown,
): Promise<{ ok: true; existingRefs: string[] } | { ok: false; error: string }> {
  const parsed = previewUnitsImportInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Parent lookup doubles as tenancy proof; RLS hides foreign programs.
  const { data: program } = await supabase
    .from("programs")
    .select("id")
    .eq("id", parsed.data.programId)
    .maybeSingle();
  if (!program) return fail("previewUnitsImport", "program not visible");

  // Filtering by up to 2000 refs via .in() would blow up the request URL,
  // so page through the program's refs (1000 = PostgREST's row cap) and
  // intersect here. Bounded: programs are a few thousand units at most.
  const existing = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("units")
      .select("external_ref")
      .eq("program_id", parsed.data.programId)
      .not("external_ref", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return fail("previewUnitsImport", error);
    for (const row of data) if (row.external_ref) existing.add(row.external_ref);
    if (data.length < PAGE) break;
  }
  return { ok: true, existingRefs: parsed.data.refs.filter((r) => existing.has(r)) };
}

export async function importUnits(
  input: unknown,
): Promise<{ ok: true; inserted: number; updated: number } | { ok: false; error: string }> {
  const parsed = importUnitsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const supabase = await createClient();

  // Tenancy, atomicity, and the upsert all live in the invoker RPC.
  const { data, error } = await supabase.rpc("import_units", {
    p_program_id: parsed.data.programId,
    p_rows: parsed.data.rows.map((r) => ({ name: r.name, external_ref: r.externalRef })),
  });
  if (error || !data) return fail("importUnits", error ?? "no result");

  revalidatePath("/programs");
  revalidatePath(`/programs/${parsed.data.programId}`);
  const counts = data as { inserted: number; updated: number };
  return { ok: true, inserted: counts.inserted, updated: counts.updated };
}
```

- [ ] **Step 2: Verify types and lint**

Run: `npm run lint && npm run typecheck`
Expected: clean. (No action-level test file — house style covers actions via the zod suite and the RPC integration suite.)

- [ ] **Step 3: Commit**

```bash
git add src/features/programs/actions.ts
git commit -m "feat: previewUnitsImport + importUnits server actions"
```

---

### Task 6: Import dialog + mount in UnitList

**Files:**
- Create: `src/features/programs/components/import-csv-dialog.tsx`
- Modify: `src/features/programs/components/unit-list.tsx` (header row, ~lines 86–94)

**Interfaces:**
- Consumes: `parseUnitsCsv` (Task 2, dynamically imported), `previewUnitsImport` / `importUnits` (Task 5), `ImportRow` (Task 1), shadcn `Dialog`/`Button`/`Input`/`Label`, `sonner` toast.
- Produces: `ImportCsvDialog({ programId }: { programId: string })`.

- [ ] **Step 1: Create the dialog**

Create `src/features/programs/components/import-csv-dialog.tsx`:

```tsx
"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { previewUnitsImport, importUnits } from "@/features/programs/actions";
import type { ImportRow } from "@/features/programs/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// The dialog is a small state machine; every stage renders from this one
// discriminated union so a stray click can't cross wires.
type Stage =
  | { step: "pick" }
  | { step: "checking" }
  | { step: "invalid"; errors: string[] }
  | { step: "ready"; rows: ImportRow[]; newCount: number; updateCount: number }
  | { step: "importing" };

export function ImportCsvDialog({ programId }: { programId: string }) {
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState<Stage>({ step: "pick" });

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setStage({ step: "pick" });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStage({ step: "checking" });
    // Dynamic import keeps Papa Parse out of the main bundle.
    const { parseUnitsCsv } = await import("@/features/programs/csv");
    const parsed = parseUnitsCsv(await file.text());
    if (!parsed.ok) {
      setStage({ step: "invalid", errors: parsed.errors });
      return;
    }
    const preview = await previewUnitsImport({
      programId,
      refs: parsed.rows.map((r) => r.externalRef),
    });
    if (!preview.ok) {
      setStage({ step: "invalid", errors: [preview.error] });
      return;
    }
    setStage({
      step: "ready",
      rows: parsed.rows,
      newCount: parsed.rows.length - preview.existingRefs.length,
      updateCount: preview.existingRefs.length,
    });
  };

  const onConfirm = async (rows: ImportRow[]) => {
    setStage({ step: "importing" });
    const result = await importUnits({ programId, rows });
    if (!result.ok) {
      toast.error(result.error);
      setStage({ step: "pick" });
      return;
    }
    toast.success(`Imported ${result.inserted} new, ${result.updated} updated.`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Upload className="size-4" /> Import CSV
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import units from CSV</DialogTitle>
        </DialogHeader>

        {stage.step === "pick" || stage.step === "checking" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-csv-file">
              CSV with &quot;name&quot; and &quot;external_ref&quot; columns
            </Label>
            <Input
              id="import-csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={stage.step === "checking"}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            {stage.step === "checking" ? (
              <p className="text-muted-foreground text-sm">Checking…</p>
            ) : null}
          </div>
        ) : null}

        {stage.step === "invalid" ? (
          <div className="flex flex-col gap-3">
            <ul className="text-destructive max-h-48 overflow-y-auto text-sm">
              {stage.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
            <p className="text-muted-foreground text-sm">
              Nothing was imported. Fix the file and try again.
            </p>
            <Button variant="outline" onClick={() => setStage({ step: "pick" })}>
              Pick another file
            </Button>
          </div>
        ) : null}

        {stage.step === "ready" || stage.step === "importing" ? (
          <div className="flex flex-col gap-4">
            {stage.step === "ready" ? (
              <p className="text-sm">
                {stage.rows.length} rows: <strong>{stage.newCount} new</strong>,{" "}
                <strong>{stage.updateCount} updated</strong>. Updates change unit names only;
                progress is untouched.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">Importing…</p>
            )}
            <div className="flex gap-2">
              <Button
                disabled={stage.step === "importing"}
                onClick={() => stage.step === "ready" && onConfirm(stage.rows)}
              >
                {stage.step === "importing" ? "Importing…" : "Import"}
              </Button>
              <Button
                variant="outline"
                disabled={stage.step === "importing"}
                onClick={() => setStage({ step: "pick" })}
              >
                Back
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount it in the UnitList header**

In `src/features/programs/components/unit-list.tsx`, add the import:

```ts
import { ImportCsvDialog } from "./import-csv-dialog";
```

and replace the header block:

```tsx
      <div className="flex items-baseline justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Units ({optimistic.length})</h2>
        {cells.length > 0 ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {doneCells} of {cells.length} stages done ·{" "}
            {Math.round((doneCells / cells.length) * 100)}%
          </p>
        ) : null}
      </div>
```

with:

```tsx
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm font-medium">Units ({optimistic.length})</h2>
        <div className="flex items-center gap-3">
          {cells.length > 0 ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {doneCells} of {cells.length} stages done ·{" "}
              {Math.round((doneCells / cells.length) * 100)}%
            </p>
          ) : null}
          <ImportCsvDialog programId={programId} />
        </div>
      </div>
```

(No optimistic units for imports: the action's `revalidatePath` re-renders server truth, and a 500-row optimistic splice would fight the keyed-remount convention.)

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run typecheck && npm run test`
Expected: clean and green.

Manual check (`npm run dev`, any program page): Import CSV button opens the dialog; a good file shows counts then imports with a toast and the list refreshes; a bad file lists row-numbered errors and writes nothing; re-importing the same file reports all-updated.

- [ ] **Step 4: Commit**

```bash
git add src/features/programs/components/import-csv-dialog.tsx src/features/programs/components/unit-list.tsx
git commit -m "feat: CSV import dialog with preview on the program page"
```

---

### Task 7: Full verification

**Files:** none new.

- [ ] **Step 1: Full local gate**

Run: `npm run verify && npm run test:integration`
Expected: lint, typecheck, unit, and integration all green.

- [ ] **Step 2: Update the knowledge graph**

Run: `graphify update .`

- [ ] **Step 3: Commit anything stragglers (e.g. AGENTS.md re-added by next dev)**

```bash
git status --short
```

If `AGENTS.md` shows modified, commit it with the branch rather than discarding (it re-creates itself; committing keeps the tree clean).
