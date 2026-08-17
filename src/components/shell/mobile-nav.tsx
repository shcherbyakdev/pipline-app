"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { SidebarBody } from "./sidebar-body";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export function MobileNav({ org, userEmail }: { org: string; userEmail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="text-muted-foreground hover:text-foreground -ml-1 flex size-8 items-center justify-center rounded-md md:hidden"
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-sidebar text-sidebar-foreground flex w-[260px] flex-col p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarBody org={org} userEmail={userEmail} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
