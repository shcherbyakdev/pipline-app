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

export {
  GENERIC_WRITE_ERROR,
  type ActionState as TemplateActionState,
} from "@/lib/actions";

// Requirement editing. `photo` is satisfied via evidence uploads (slice 8);
// `checklist` exists only template-side (create_program expands it).
export const requirementType = z.enum([
  "text", "number", "boolean", "date", "choice", "photo", "checklist",
]);
export const requirementLabel = z.string().trim().min(1).max(120);
const configLines = z.array(z.string().trim().min(1).max(120)).max(50);

export const addRequirementInput = z
  .object({
    templateStageId: z.uuid(),
    type: requirementType,
    label: requirementLabel,
    required: z.boolean(),
    options: configLines.min(2).optional(), // choice only
    items: configLines.min(1).optional(),   // checklist only
    recurLeadDays: z.number().int().min(1).max(3650).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "choice" && !v.options)
      ctx.addIssue({ code: "custom", message: "choice needs options" });
    if (v.type === "checklist" && !v.items)
      ctx.addIssue({ code: "custom", message: "checklist needs items" });
    if (v.type !== "choice" && v.options)
      ctx.addIssue({ code: "custom", message: "options only valid for choice" });
    if (v.type !== "checklist" && v.items)
      ctx.addIssue({ code: "custom", message: "items only valid for checklist" });
    if (v.recurLeadDays !== undefined && v.type !== "date")
      ctx.addIssue({ code: "custom", message: "recurLeadDays only valid for date" });
  });
export const renameRequirementInput = z.object({ id: z.uuid(), label: requirementLabel });
export const deleteRequirementInput = z.object({ id: z.uuid() });
export const reorderRequirementsInput = z
  .object({ templateStageId: z.uuid(), requirementIds: z.array(z.uuid()).min(1) })
  .refine((v) => new Set(v.requirementIds).size === v.requirementIds.length, {
    message: "requirementIds must be unique",
  });
