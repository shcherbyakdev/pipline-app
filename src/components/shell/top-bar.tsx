"use client";

import { usePathname } from "next/navigation";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { MobileNav } from "./mobile-nav";
import { navItemsFor, titleForPath } from "./nav";

/* Panel header row, Linear-style: hairline underneath, the view title at
   13px/500 on the left (pages no longer render their own <h1>). It sits above
   the panel's scroll container, so it needs no sticky/backdrop. */
export function TopBar({
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
  const pathname = usePathname();
  const title = titleForPath(pathname, navItemsFor(flags, mode));
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4 md:px-6">
      <MobileNav org={org} userEmail={userEmail} flags={flags} mode={mode} />
      <h1 className="text-[13px] font-medium">{title}</h1>
    </header>
  );
}
