"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckIcon, ChevronDown } from "lucide-react";
import { viewSwitcherItems, type BookingsView } from "@/features/scheduling/bookings-views";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* Day · Week · Month — and Timeline where the org sells spaces — behind one
   "Week ▾" button, the calendar idiom (admin IA spec §2). A segmented row
   put every view on the toolbar at once; naming only the current one keeps
   the bar quiet and leaves room for the view to gain siblings.

   The items are still LINKS, so the view survives a refresh and can be
   shared, and each carries the scope ("show=…" — bookings-scope.ts); the
   timeline reads its spaces side and ignores people. */
export function ViewSwitcher({
  current,
  showTimeline,
  scopeQuery,
}: {
  current: BookingsView;
  showTimeline: boolean;
  scopeQuery?: string;
}) {
  const t = useTranslations("bookings");
  const items = viewSwitcherItems({ current, showTimeline, scopeQuery });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" aria-label={`${t("view.label")}: ${t(`view.${current}`)}`}>
            {t(`view.${current}`)}
            <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-40">
        {items.map((item) => (
          <DropdownMenuItem key={item.view} render={<Link href={item.href} />}>
            <CheckIcon className={cn("size-3.5", !item.current && "invisible")} aria-hidden />
            {t(`view.${item.view}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
