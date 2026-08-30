"use client";

import { usePathname } from "next/navigation";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import { MobileNav } from "./mobile-nav";
import { navItemsFor, titleForPath } from "./nav";

/* Soft-world top bar: hairline underneath, the ground blurring through, the
   view title on the left (pages don't render their own <h1>). */
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
    <header className="bg-background/80 sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur-md md:px-6">
      <MobileNav org={org} userEmail={userEmail} flags={flags} mode={mode} />
      <h1 className="text-sm font-semibold tracking-[-0.01em]">{title}</h1>
    </header>
  );
}
