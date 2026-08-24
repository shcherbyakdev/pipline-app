import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";

/* Channel guard (H1): an org that doesn't sell appointments has no Availability
   page. Redirect to /bookings (NOT /overview — that 404s while the overview
   flag is off) rather than 404 so flipping the flag in Settings is safe. */
export default async function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  if (!org.offersAppointments) redirect("/bookings");
  return children;
}
