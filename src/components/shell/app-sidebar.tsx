import type { Flags } from "@/lib/flags";
import { SidebarBody } from "./sidebar-body";

export function AppSidebar({ org, userEmail, flags }: { org: string; userEmail: string; flags: Flags }) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-[220px] shrink-0 flex-col border-r md:sticky md:top-0 md:flex md:h-screen">
      <SidebarBody org={org} userEmail={userEmail} flags={flags} />
    </aside>
  );
}
