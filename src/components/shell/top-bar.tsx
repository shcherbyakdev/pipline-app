"use client";

import { usePathname } from "next/navigation";
import { MobileNav } from "./mobile-nav";
import { titleForPath } from "./nav";

/* Linear top bar: hairline underneath, the view title at 13px/500 on the left
   (pages no longer render their own <h1>), controls on the right. */
export function TopBar({ org, userEmail }: { org: string; userEmail: string }) {
  const pathname = usePathname();
  const title = titleForPath(pathname);
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b px-4 md:px-6">
      <MobileNav org={org} userEmail={userEmail} />
      <h1 className="text-[13px] font-medium">{title}</h1>
    </header>
  );
}
