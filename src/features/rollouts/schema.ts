import { z } from "zod";

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";

export const rolloutName = z.string().trim().min(1).max(80);
export const unitName = z.string().trim().min(1).max(120);
export const externalRef = z.string().trim().max(120);

export const createRolloutInput = z.object({ templateId: z.uuid(), name: rolloutName });
export const renameRolloutInput = z.object({ id: z.uuid(), name: rolloutName });
export const deleteRolloutInput = z.object({ id: z.uuid() });
export const addUnitInput = z.object({
  rolloutId: z.uuid(),
  name: unitName,
  externalRef: externalRef.optional(),
});
export const renameUnitInput = z.object({ id: z.uuid(), name: unitName });
export const deleteUnitInput = z.object({ id: z.uuid() });
