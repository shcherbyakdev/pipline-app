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
