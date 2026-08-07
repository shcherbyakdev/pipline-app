import { z } from "zod";

export const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export type OrgState = { error?: string };
