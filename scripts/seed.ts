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

// Refuse to run against anything but a local Supabase instance. This script
// creates a fixed, publicly-documented, admin-capable login
// (demo@rolloutos.local / Password123!) — safe on a throwaway local DB,
// a liability against a real project. Parse with `new URL` and compare the
// resolved `hostname`, not a substring match, so a URL crafted like
// "https://evil.com/?x=127.0.0.1" cannot slip through.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function assertLocalSupabaseUrl(rawUrl: string): void {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    console.error(`seed: NEXT_PUBLIC_SUPABASE_URL is not a valid URL: "${rawUrl}"`);
    process.exit(1);
  }

  if (LOOPBACK_HOSTS.has(hostname)) return;

  if (process.env.ALLOW_REMOTE_SEED === "1") {
    console.warn(`seed: WARNING — seeding a NON-LOCAL Supabase project at host "${hostname}".`);
    console.warn(`seed: this creates the known-password account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
    console.warn("seed: on that project. Proceeding because ALLOW_REMOTE_SEED=1.");
    return;
  }

  console.error(`seed: refusing to seed non-local host "${hostname}".`);
  console.error(`seed: this script creates a publicly-documented account`);
  console.error(`seed: (${DEMO_EMAIL} / ${DEMO_PASSWORD}) — safe for a local Supabase, a`);
  console.error("seed: liability against a remote or staging project.");
  console.error("seed: only loopback hosts (127.0.0.1, localhost, [::1]) are allowed.");
  console.error("seed: to seed a remote project on purpose, set ALLOW_REMOTE_SEED=1.");
  process.exit(1);
}

assertLocalSupabaseUrl(url);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureDemoUser(): Promise<void> {
  const { error } = await admin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (!error) return;
  // Re-running the seed is expected; an existing user is not a failure.
  // Prefer the stable typed error code from @supabase/auth-js; fall back to
  // matching the message text for older/edge responses that omit it.
  const isExistingUser =
    error.code === "email_exists" || /already been registered|already exists/i.test(error.message);
  if (!isExistingUser) throw error;
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
