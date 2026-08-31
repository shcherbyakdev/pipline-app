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
    <aside className="text-sidebar-foreground hidden w-[244px] shrink-0 flex-col md:flex">
      <SidebarBody org={org} userEmail={userEmail} flags={flags} mode={mode} />
    </aside>
  );
}
