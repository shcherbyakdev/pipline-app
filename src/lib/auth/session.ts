import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Always validate against the Auth server with getUser() — never getSession().
export async function getOptionalUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  return user;
}

export type Org = { id: string; name: string; slug: string };

export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = await createClient();
  // RLS returns only orgs the caller belongs to; the first is their org.
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, slug")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function requireOrg(): Promise<{ user: User; org: Org }> {
  const user = await requireUser();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  return { user, org };
}
