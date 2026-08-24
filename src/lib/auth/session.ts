import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/next-path";

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
  if (!user) {
    // The proxy stamps the request path so the login page can bring the
    // user back here (an expired session on /settings used to land on
    // /bookings). Missing header (a test, a direct render) → plain /login.
    const back = safeNextPath((await headers()).get("x-pathname"));
    redirect(back ? `/login?next=${encodeURIComponent(back)}` : "/login");
  }
  return user;
}

export type Org = {
  id: string;
  name: string;
  slug: string;
  offersAppointments: boolean;
  offersRentals: boolean;
};

export async function getCurrentOrg(): Promise<Org | null> {
  const supabase = await createClient();
  // RLS returns only orgs the caller belongs to; create_org (0052) refuses a
  // second one, so this is their org. Ordered all the same — a deterministic
  // pick is the floor should that ever change.
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name, slug, offers_appointments, offers_rentals")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    offersAppointments: data.offers_appointments,
    offersRentals: data.offers_rentals,
  };
}

export async function requireOrg(): Promise<{ user: User; org: Org }> {
  const user = await requireUser();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  return { user, org };
}
