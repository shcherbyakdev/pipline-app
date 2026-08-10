import { z } from "zod";

export const participantName = z.string().trim().min(1).max(120);
export const createParticipantInput = z.object({
  name: participantName,
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().min(5).max(30).optional(),
  // Where the creation happened, so the action can revalidate the page the
  // caller is actually looking at (a program detail page) — not just /programs.
  programId: z.uuid().optional(),
});
export const assignUnitInput = z.object({
  unitId: z.uuid(),
  participantId: z.uuid().nullable(),
});
export const issueLinkInput = z.object({
  participantId: z.uuid(),
  programId: z.uuid(),
  unitId: z.uuid().optional(),
  expiresDays: z.number().int().min(1).max(365).default(30),
});
export const revokeLinkInput = z.object({ id: z.uuid() });

// Participant flow inputs (used by flow-actions in Task 7): the token rides
// along; the value union mirrors saveResponseInput exactly.
const flowIds = { token: z.string().min(20).max(200), unitId: z.uuid(), requirementId: z.uuid() };
export const participantSaveResponseInput = z.discriminatedUnion("type", [
  z.object({ ...flowIds, type: z.literal("text"), value: z.string().trim().min(1).max(2000) }),
  z.object({ ...flowIds, type: z.literal("choice"), value: z.string().trim().min(1).max(120) }),
  z.object({ ...flowIds, type: z.literal("number"), value: z.number().finite() }),
  z.object({ ...flowIds, type: z.literal("boolean"), value: z.boolean() }),
  z.object({
    ...flowIds,
    type: z.literal("date"),
    value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  }),
]);
export const participantClearResponseInput = z.object(flowIds);

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
