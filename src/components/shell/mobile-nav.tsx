"use client";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Menu01Icon } from "@hugeicons/core-free-icons";
import type { Flags } from "@/lib/flags";
import type { OrgMode } from "@/features/orgs/mode";
import type { PlanStatus } from "@/features/billing/queries";
import { SidebarBody } from "./sidebar-body";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNav({
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
  pendingRequests: number;
  planStatus: PlanStatus | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="text-muted-foreground hover:text-foreground -ml-1 flex size-8 items-center justify-center rounded-md md:hidden"
      >
        <HugeiconsIcon icon={Menu01Icon} size={20} />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar text-sidebar-foreground flex w-[260px] flex-col p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarBody
          org={org}
          userEmail={userEmail}
          flags={flags}
          mode={mode}
          pendingRequests={pendingRequests}
          planStatus={planStatus}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
