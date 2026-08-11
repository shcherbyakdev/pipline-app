import { z } from "zod";

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

export const programName = z.string().trim().min(1).max(80);
export const unitName = z.string().trim().min(1).max(120);
export const externalRef = z.string().trim().max(120);

export const createProgramInput = z.object({ templateId: z.uuid(), name: programName });
export const renameProgramInput = z.object({ id: z.uuid(), name: programName });
export const deleteProgramInput = z.object({ id: z.uuid() });
export const addUnitInput = z.object({
  programId: z.uuid(),
  name: unitName,
  externalRef: externalRef.optional(),
});
export const renameUnitInput = z.object({ id: z.uuid(), name: unitName });
export const deleteUnitInput = z.object({ id: z.uuid() });
export const setUnitStageStatusInput = z.object({ id: z.uuid(), done: z.boolean() });

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
