import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* Rentals are parked unless the org's `rentals` flag resolves true (lib/flags). */
export default async function RentalsLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).rentals) notFound();
  return children;
}
