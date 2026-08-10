import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

// Service-role client. BYPASSES RLS — import only from modules that
// constrain every query by an explicitly resolved scope (lib/tokens).
// Never from a route handler or component directly.
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for token-scoped reads. Run `npm run setup`.",
    );
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
