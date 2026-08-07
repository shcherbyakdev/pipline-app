/**
 * Proves the data layer the onboarding UI depends on: a signed-in user with
 * no org sees getCurrentOrg() return null, and after calling the create_org
 * RPC the same query returns their new org — exactly the shape
 * `src/lib/auth/session.ts`'s `getCurrentOrg` relies on.
 * Run: npx tsx scripts/verify-onboarding.ts
 * Requires: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *           SUPABASE_SERVICE_ROLE_KEY in the environment (.env.local).
 */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env.local");
} catch {
  // Env may already be exported into the shell (e.g. `source .env.local`).
}

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !anonKey || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in environment.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function makeSignedInUser(email: string) {
  const password = "Password123!";
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
  return client;
}

async function main() {
  const email = `onboarding_${Date.now()}@example.com`;
  const client = await makeSignedInUser(email);

  // Step 3: before creating an org, getCurrentOrg's exact query returns null.
  const before = await client
    .from("orgs")
    .select("id, name, slug")
    .limit(1)
    .maybeSingle();
  if (before.error) {
    console.error("Pre-org select failed:", before.error.message);
    process.exit(1);
  }
  if (before.data !== null) {
    console.error("Expected no org before onboarding, got:", before.data);
    process.exit(1);
  }
  console.log("Pre-onboarding: getCurrentOrg() query returns null — OK");

  // Step 4: call the create_org RPC, same as the createOrg Server Action.
  const { error: rpcError } = await client.rpc("create_org", {
    p_name: "Acme Signage Co.",
  });
  if (rpcError) {
    console.error("create_org RPC failed:", rpcError.message);
    process.exit(1);
  }
  console.log("create_org RPC succeeded — OK");

  // Step 5: re-run the same select; expect exactly the new org.
  const after = await client
    .from("orgs")
    .select("id, name, slug")
    .limit(1)
    .maybeSingle();
  if (after.error) {
    console.error("Post-org select failed:", after.error.message);
    process.exit(1);
  }
  if (!after.data) {
    console.error("Expected an org after onboarding, got null.");
    process.exit(1);
  }
  const org = after.data as { id: string; name: string; slug: string };
  if (org.name !== "Acme Signage Co.") {
    console.error(`Expected org name "Acme Signage Co.", got "${org.name}".`);
    process.exit(1);
  }
  if (!org.id || !org.slug) {
    console.error("Expected non-empty id and slug, got:", org);
    process.exit(1);
  }
  console.log(
    `Post-onboarding: getCurrentOrg() returns { id: ${org.id}, name: "${org.name}", slug: "${org.slug}" } — OK`,
  );

  console.log("ONBOARDING OK");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
