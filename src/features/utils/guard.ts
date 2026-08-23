import "server-only";
import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { env } from "@/env";
import { requireUser } from "@/lib/auth/session";
import { isInternalEmail, parseInternalEmails } from "./allowlist";

/* The one gate in front of every /utils page and every features/utils server
   action (spec §3.1). Unlike features/billing/dev/guard.ts there is NO
   NODE_ENV or provider check: this is the back office that has to work on
   prod. requireUser() redirects to /login when signed out (right for a
   browser hop); everyone signed in but not on the allowlist gets notFound()
   — an internal route does not confirm it exists. Server actions must call
   this too: a POST endpoint is reachable without ever loading the page.

   The identity compared against the allowlist is the signed-in user's
   Supabase Auth email, and only a CONFIRMED one counts: supabase/config.toml
   enables email confirmations (`[auth.email] enable_confirmations`) and
   double-confirms email changes (`double_confirm_changes`), but that is a
   per-project setting a hosted dashboard can flip — and with it off, anyone
   could sign up as an allowlisted address and walk in. `email_confirmed_at`
   is checked here so the back office does not depend on it. */
export async function requireInternal(): Promise<{ user: User }> {
  const user = await requireUser();
  if (!user.email_confirmed_at) notFound();
  if (!isInternalEmail(user.email, parseInternalEmails(env.INTERNAL_EMAILS))) notFound();
  return { user };
}
