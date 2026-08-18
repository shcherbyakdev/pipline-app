import type { Flags } from "@/lib/flags";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

/* Admin shell, Linear-style: a fixed-width sidebar with a hairline on its
   right, a hairline top bar carrying the view title, and content sitting flat
   on the page ground. Surfaces come from the `.dark` tokens (globals.css),
   which share the landing's Linear-dark palette. */
export function AppShell({
  org,
  userEmail,
  flags,
  children,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1">
      <AppSidebar org={org} userEmail={userEmail} flags={flags} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar org={org} userEmail={userEmail} flags={flags} />
        <main className="flex flex-1 flex-col p-6">{children}</main>
      </div>
    </div>
  );
}
