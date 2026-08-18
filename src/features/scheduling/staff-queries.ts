import { createClient } from "@/lib/supabase/server";

// Admin-side reads for the Team page (RLS client — the org scope comes from
// the policies, not a WHERE clause). The public/anon surface has its own,
// narrower loaders in `@/lib/booking/public` (PublicStaff): `email` and
// `active` must never leave the authenticated side.
export type StaffRow = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  color: string;
  active: boolean;
  sortOrder: number;
  serviceIds: string[];
};

const STAFF_COLS = "id, name, slug, email, color, active, sort_order";

/** Everyone, active first-class and deactivated alike — the Team page shows
    both (there is no delete). `serviceIds` comes from one extra select, not a
    per-row join, so the list stays two queries at any team size. */
export async function listStaff(): Promise<StaffRow[]> {
  const supabase = await createClient();
  const [staffRes, linkRes] = await Promise.all([
    supabase.from("staff").select(STAFF_COLS).order("sort_order").order("name"),
    supabase.from("service_staff").select("service_id, staff_id"),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (linkRes.error) throw linkRes.error;

  const byStaff = new Map<string, string[]>();
  for (const row of linkRes.data ?? []) {
    const ids = byStaff.get(row.staff_id);
    if (ids) ids.push(row.service_id);
    else byStaff.set(row.staff_id, [row.service_id]);
  }

  return (staffRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    email: s.email,
    color: s.color,
    active: s.active,
    sortOrder: s.sort_order,
    serviceIds: byStaff.get(s.id) ?? [],
  }));
}

export async function listActiveStaff(): Promise<StaffRow[]> {
  return (await listStaff()).filter((s) => s.active);
}

/** The default staff for admin surfaces that need exactly one (availability
    editor, calendar). Ordered like `create_staff`'s schedule-source pick
    (sort_order, created_at) so "the first person" means the same thing in the
    app and in the database. */
export async function firstActiveStaffId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("active", true)
    .order("sort_order")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}
