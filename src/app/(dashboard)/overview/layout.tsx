import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* Overview is hidden unless the org's `overview` flag resolves true (lib/flags).
   The page below stays intact; this layout just takes it off the map. */
export default async function OverviewLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).overview) notFound();
  return children;
}
