import { z } from "zod";

export const startChaseInput = z.object({
  participantId: z.uuid(),
  programId: z.uuid(),
  unitId: z.uuid().optional(),
});

export { GENERIC_WRITE_ERROR, type ActionState } from "@/lib/actions";
