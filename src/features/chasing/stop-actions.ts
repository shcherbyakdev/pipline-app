"use server";

import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { z } from "zod";
import { GENERIC_WRITE_ERROR, type ActionState } from "./schema";

const stopChaseInput = z.object({ token: z.string().min(20).max(200) });

// Anon RPC, token as credential (the flow-actions trust model). Uniform
// result: the caller cannot distinguish bad token / no chase / already
// stopped. NEVER log the token.
export async function stopChase(input: unknown): Promise<ActionState> {
  const parsed = stopChaseInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_WRITE_ERROR };
  const anon = createAnonServerClient();
  const { error } = await anon.rpc("stop_chase", { p_token: parsed.data.token });
  if (error) {
    console.error("[chasing] stopChase:", error.code || error.message || "rpc error");
    return { ok: false, error: GENERIC_WRITE_ERROR };
  }
  return { ok: true };
}
