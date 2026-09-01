import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanStatus } from "@/features/billing/queries";
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
  pendingRequests,
  planStatus,
  children,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  mode: OrgMode;
  /** Live booking requests, for the badge on the Overview row (0 when the
      overview flag is off — the layout doesn't even count them then). */
  pendingRequests: number;
  /** The plan tag and the waitlist card; null while limits are not enforced
      (the layout reads nothing then, and the shell shows nothing). */
  planStatus: PlanStatus | null;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-sidebar flex h-dvh w-full">
      <AppSidebar org={org} userEmail={userEmail} flags={flags} mode={mode} pendingRequests={pendingRequests} planStatus={planStatus} />
      <div className="flex min-w-0 flex-1 flex-col md:p-2 md:pl-0">
        <div className="bg-background flex min-h-0 flex-1 flex-col overflow-hidden md:rounded-[12px] md:border md:shadow-(--shadow-card)">
          <TopBar org={org} userEmail={userEmail} flags={flags} mode={mode} pendingRequests={pendingRequests} planStatus={planStatus} />
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
