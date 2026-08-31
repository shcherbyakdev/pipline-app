import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

/* Admin shell, Linear-style: the viewport ground is the sidebar surface and
   the content lives in a rounded, hairline-bordered panel floating on it
   (gap top/right/bottom; the sidebar's own padding provides the left gap).
   The panel is viewport-height and scrolls internally — the header row stays
   put because it sits outside the scroll container, not because of sticky.
   Below md the panel goes full-bleed. Surfaces come from the soft-world
   tokens (globals.css): the ground is --sidebar, the panel --background. */
export function AppShell({
  org,
  userEmail,
  flags,
  mode,
  children,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  mode: OrgMode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-sidebar flex h-dvh w-full">
      <AppSidebar org={org} userEmail={userEmail} flags={flags} mode={mode} />
      <div className="flex min-w-0 flex-1 flex-col md:p-2 md:pl-0">
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-[12px] md:border md:shadow-(--shadow-card)">
          <TopBar org={org} userEmail={userEmail} flags={flags} mode={mode} />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
