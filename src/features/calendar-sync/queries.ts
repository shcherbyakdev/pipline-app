import "server-only";

import { requireOrg } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleConfigured, listConnections, type Connection } from "./connections";

export type IntegrationsPageData = {
  orgId: string;
  configured: boolean;
  connections: Connection[];
  /** Active people, for "This calendar belongs to". */
  staff: { id: string; name: string }[];
  offersAppointments: boolean;
};

/** Everything /integrations shows. The connection rows come through the
    admin client (the table has no member grant) with the safe columns
    only; the org was resolved by requireOrg first. */
export async function getIntegrationsPage(): Promise<IntegrationsPageData> {
  const { org } = await requireOrg();
  const admin = createAdminClient();
  const [connections, staff] = await Promise.all([
    googleConfigured() ? listConnections(org.id, admin) : Promise.resolve([]),
    admin.from("staff").select("id, name").eq("org_id", org.id).eq("active", true).order("sort_order").order("created_at"),
  ]);
  if (staff.error) throw staff.error;
  return {
    orgId: org.id,
    configured: googleConfigured(),
    connections,
    staff: staff.data ?? [],
    offersAppointments: org.offersAppointments,
  };
}
