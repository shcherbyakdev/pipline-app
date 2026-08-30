import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { SidebarBody } from "./sidebar-body";

export function AppSidebar({
  org,
  userEmail,
  flags,
  mode,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  mode: OrgMode;
}) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-[236px] shrink-0 flex-col border-r md:sticky md:top-0 md:flex md:h-screen">
      <SidebarBody org={org} userEmail={userEmail} flags={flags} mode={mode} />
    </aside>
  );
}
