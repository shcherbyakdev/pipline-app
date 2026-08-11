import { z } from "zod";

export const clientName = z.string().trim().min(1).max(120);
export const createClientInput = z.object({
  name: clientName,
  // Where the creation happened (unit-row inline create), so the action can
  // revalidate the program page the caller is looking at.
  programId: z.uuid().optional(),
});
export const renameClientInput = z.object({ id: z.uuid(), name: clientName });
export const deleteClientInput = z.object({ id: z.uuid() });
export const assignClientInput = z.object({
  unitId: z.uuid(),
  clientId: z.uuid().nullable(),
});
// Long-lived by design (~12 months, spec); rotation = mint new, revoke old.
export const issuePortalLinkInput = z.object({
  clientId: z.uuid(),
  expiresDays: z.number().int().min(1).max(730).default(365),
});
export const revokePortalLinkInput = z.object({ id: z.uuid() });

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
