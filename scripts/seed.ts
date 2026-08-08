/**
 * Idempotent demo data for local development.
 * Run: npm run db:seed  (or npm run db:reset for a clean slate)
 *
 * Goes through the create_org RPC rather than inserting directly, so the org
 * and the caller's owner membership are created the same way onboarding does.
 */
import { loadEnvFile } from "node:process";
import { createClient } from "@supabase/supabase-js";

try {
  loadEnvFile(".env.local");
} catch {
  // Already-exported env (CI) is fine.
}

const DEMO_EMAIL = "demo@rolloutos.local";
const DEMO_PASSWORD = "Password123!";
const DEMO_ORG = "Demo Rollouts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("seed: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and");
  console.error("      SUPABASE_SERVICE_ROLE_KEY must be set. Run `npm run setup` first.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureDemoUser(): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  // Re-running the seed is expected; an existing user is not a failure.
  if (error && !/already been registered|already exists/i.test(error.message)) throw error;
}

async function main(): Promise<void> {
  await ensureDemoUser();

  const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInError) throw signInError;

  // RLS scopes this select to the demo user's own orgs.
  const { data: existing, error: selectError } = await client.from("orgs").select("id, name");
  if (selectError) throw selectError;

  if (existing && existing.length > 0) {
    console.log(`seed: ${DEMO_EMAIL} already owns "${existing[0].name}" — nothing to do`);
    return;
  }

  const { error: rpcError } = await client.rpc("create_org", { p_name: DEMO_ORG });
  if (rpcError) throw rpcError;

  console.log(`seed: created "${DEMO_ORG}"`);
  console.log(`seed: sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main().catch((error: unknown) => {
  console.error("seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
