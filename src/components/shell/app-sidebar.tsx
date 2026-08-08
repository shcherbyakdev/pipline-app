import { SidebarBody } from "./sidebar-body";

export function AppSidebar({ org, userEmail }: { org: string; userEmail: string }) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 flex-col border-r md:flex">
      <SidebarBody org={org} userEmail={userEmail} />
    </aside>
  );
}
