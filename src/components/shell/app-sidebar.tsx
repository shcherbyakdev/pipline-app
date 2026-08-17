import { SidebarBody } from "./sidebar-body";

export function AppSidebar({ org, userEmail }: { org: string; userEmail: string }) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground hidden w-[220px] shrink-0 flex-col border-r md:sticky md:top-0 md:flex md:h-screen">
      <SidebarBody org={org} userEmail={userEmail} />
    </aside>
  );
}
