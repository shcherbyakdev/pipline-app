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
