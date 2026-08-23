"use server";

import { headers } from "next/headers";
import { createAnonServerClient } from "@/lib/supabase/anon-server";
import { clientKeyFrom } from "@/lib/tokens";
import { handleCheckLimiter } from "@/lib/tokens/rate-limit";
import { HANDLE_RE, isReservedHandle, suggestHandles } from "./handle";

export type HandleCheck =
  | { status: "free" }
  | { status: "taken"; suggestion: string | null }
  | { status: "invalid" }
  | { status: "error" };

const MAX_SUGGESTION_LOOKUPS = 3;

// Public by design (the landing page calls it before anyone signs up): the
// anon client, no cookies, one indexed lookup per call. Handles are public
// URLs, so "taken" reveals nothing that /<handle> wouldn't. Per-client
// throttled all the same (audit 2026-08-24): unauthenticated + up to four
// definer RPCs per call made it a free namespace sweep / DB amplifier.
// `suggest: false` (the landing claim bar) skips the suggestion lookups —
// the bar only needs free/taken; onboarding is where a suggestion helps.
export async function checkHandle(
  input: unknown,
  opts: { suggest?: boolean } = {},
): Promise<HandleCheck> {
  if (typeof input !== "string" || !HANDLE_RE.test(input) || isReservedHandle(input)) {
    return { status: "invalid" };
  }
  if (!handleCheckLimiter.allow(clientKeyFrom(await headers()))) return { status: "error" };
  const supabase = createAnonServerClient();
  const free = await isFree(supabase, input);
  if (free === null) return { status: "error" };
  if (free) return { status: "free" };
  if (opts.suggest === false) return { status: "taken", suggestion: null };
  for (const candidate of suggestHandles(input).slice(0, MAX_SUGGESTION_LOOKUPS)) {
    if (await isFree(supabase, candidate)) return { status: "taken", suggestion: candidate };
  }
  return { status: "taken", suggestion: null };
}

async function isFree(
  supabase: ReturnType<typeof createAnonServerClient>,
  handle: string,
): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("is_handle_available", { p_handle: handle });
  if (error) {
    console.error("[handles] is_handle_available:", error.message);
    return null;
  }
  return data === true;
}
