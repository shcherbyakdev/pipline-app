import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";

/* Channel guard (H1): an org that doesn't sell appointments has no Services
   page. Redirect to /bookings (NOT /overview — that 404s for an org opted
   out of the flag) rather than 404 so flipping the flag in Settings is safe. */
export default async function ServicesLayout({ children }: { children: React.ReactNode }) {
  const { org } = await requireOrg();
  if (!org.offersAppointments) redirect("/bookings");
  return children;
}
