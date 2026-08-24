import { notFound, redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { getDashboardFlags } from "@/lib/flags/resolve";

/* Rentals need both gates: the per-org feature flag (kill switch — 404, the
   feature "doesn't exist") and the org mode (a choice — redirect, the org
   can flip it back in Settings). */
export default async function RentalsLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  if (!(await getDashboardFlags(org.id)).rentals) notFound();
  if (!org.offersRentals) redirect("/bookings");
  return children;
}
