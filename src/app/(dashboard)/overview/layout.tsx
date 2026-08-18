import { notFound } from "next/navigation";
import { OVERVIEW_ENABLED } from "@/lib/flags";

/* Overview is hidden while it is only four org-wide tiles (see lib/flags.ts).
   The page below stays intact; this layout just takes it off the map. */
export default function OverviewLayout({ children }: { children: React.ReactNode }) {
  if (!OVERVIEW_ENABLED) notFound();
  return children;
}
