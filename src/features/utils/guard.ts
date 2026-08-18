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
   this too: a POST endpoint is reachable without ever loading the page. */
export async function requireInternal(): Promise<{ user: User }> {
  const user = await requireUser();
  if (!isInternalEmail(user.email, parseInternalEmails(env.INTERNAL_EMAILS))) notFound();
  return { user };
}
