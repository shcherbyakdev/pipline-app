/* The whole access model of /utils, in two pure functions. The gate is an
   email allowlist from env (spec §3.1): the owner sets INTERNAL_EMAILS per
   environment; unset means nobody. Compared against the signed-in user's
   Supabase Auth email (guard.ts documents what makes that address verified)
   — adequate for a solo-owner back office, and deliberately nothing more
   (no roles, no DB flag). */

export function parseInternalEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isInternalEmail(email: string | null | undefined, allow: Set<string>): boolean {
  if (!email) return false;
  const normalised = email.trim().toLowerCase();
  return normalised.length > 0 && allow.has(normalised);
}
