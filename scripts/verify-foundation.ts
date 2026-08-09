/**
 * Proves tenant isolation through the RLS-enforced anon client.
 * Run: npx tsx scripts/verify-foundation.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *           SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).
 */
import { createClient } from "@supabase/supabase-js";
import { hostnameOf, isLoopbackHost } from "./lib/host-guard";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Refuse to run against anything but a local Supabase instance — this
// script creates confirmed users with a fixed, publicly-known password via
// the admin API. Safe on a throwaway local DB, a liability against a
// remote or staging project. Mirrors the guard in scripts/seed.ts.
const verifyHostname = hostnameOf(url);
if (verifyHostname === null || !isLoopbackHost(verifyHostname)) {
  console.error(`verify-foundation: refusing to run against non-local host "${verifyHostname ?? url}".`);
  console.error("verify-foundation: this script creates confirmed users with a fixed password.");
  console.error("verify-foundation: only loopback hosts (127.0.0.1, localhost, [::1]) are allowed.");
  process.exit(1);
}

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

async function makeUser(email: string) {
  await admin.auth.admin.createUser({ email, password: "Password123!", email_confirm: true });
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "Password123!" });
  if (error) throw error;
  return c;
}

async function main() {
  const a = await makeUser(`a_${Date.now()}@example.com`);
  const b = await makeUser(`b_${Date.now()}@example.com`);

  const { data: orgA, error: e1 } = await a.rpc("create_org", { p_name: "Alpha" });
  if (e1) throw e1;
  await b.rpc("create_org", { p_name: "Beta" });

  // A sees exactly one org (Alpha); cannot see Beta.
  const { data: aOrgs } = await a.from("orgs").select("id, name");
  const seesOnlyAlpha = aOrgs?.length === 1 && aOrgs[0].name === "Alpha";

  // B cannot read A's org by id.
  const { data: bTriesA } = await b.from("orgs").select("id").eq("id", (orgA as { id: string }).id);
  const bBlocked = (bTriesA?.length ?? 0) === 0;

  console.log("A sees only its own org:", seesOnlyAlpha);
  console.log("B is blocked from A's org:", bBlocked);
  if (!seesOnlyAlpha || !bBlocked) {
    console.error("RLS ISOLATION FAILED");
    process.exit(1);
  }
  console.log("RLS isolation OK");
}

main();
