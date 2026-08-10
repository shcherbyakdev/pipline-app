import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";

// Anon-key client with NO cookie/session handling: the caller is nobody.
// Used for the token RPCs, where the token itself is the credential.
export function createAnonServerClient() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
