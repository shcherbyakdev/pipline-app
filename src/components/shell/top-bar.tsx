"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanStatus } from "@/features/billing/queries";
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
  pendingRequests,
  planStatus,
}: {
  org: string;
  userEmail: string;
  flags: Flags;
  mode: OrgMode;
  // Only passed through: the mobile sheet renders the same SidebarBody.
  pendingRequests: number;
  // Only passed through as well: the plan tag lives in the sidebar's
  // workspace row (ruling 2026-09-01), which the mobile sheet also renders.
  planStatus: PlanStatus | null;
}) {
  const pathname = usePathname();
  const t = useTranslations("shell");
  const hit = titleForPath(pathname, navItemsFor(flags, mode));
  const title = "key" in hit ? t(`nav.${hit.key}`) : hit.text;
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4 md:px-6">
      <MobileNav org={org} userEmail={userEmail} flags={flags} mode={mode} pendingRequests={pendingRequests} planStatus={planStatus} />
      <h1 className="text-[13px] font-medium">{title}</h1>
    </header>
  );
}
