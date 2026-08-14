import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// Solo-provider assumption (spec actor model): the org's oldest member IS
// the provider. Best-effort — notification callers treat null as "skip",
// never as an error.
export async function getProviderEmail(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const { data: user, error: userError } = await admin.auth.admin.getUserById(data.user_id);
  if (userError) return null;
  return user.user?.email ?? null;
}
