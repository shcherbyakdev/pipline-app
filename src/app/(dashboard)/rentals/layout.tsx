import { notFound } from "next/navigation";
import { RENTALS_ENABLED } from "@/lib/flags";

/* Rentals are parked for the appointments-only MVP (see lib/flags.ts). The
   pages below stay intact; this layout just takes them off the map. */
export default function RentalsLayout({ children }: { children: React.ReactNode }) {
  if (!RENTALS_ENABLED) notFound();
  return children;
}
