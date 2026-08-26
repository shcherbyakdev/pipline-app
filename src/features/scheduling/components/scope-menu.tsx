"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ScopeGroup, ScopeItem } from "@/features/scheduling/bookings-scope";

/* Show: All bookings ▾ — what the Bookings page is looking at. One scope
   grouped by kind (Acuity's "All calendars", Fresha's "Team"), replacing
   the people-only chip row: no kind toggle beside a person filter, so no
   impossible "Anna + Spaces". Writes `?show=` — navigation, not component
   state, so the lens survives a refresh, a week arrow and a share.

   `router.replace`, not `push`: narrowing the calendar is a view setting,
   not a place in history — Back should leave the page, not walk through
   every scope the provider tried. The page renders this only when the org
   has something to choose (bookings-scope.ts scopeItems). */
export function ScopeMenu({
  groups,
  value,
  label,
}: {
  groups: ScopeGroup[];
  /** The current scope's radio value ("all" for everything). */
  value: string;
  /** What the trigger reads — scopeLabel; a legacy "2 people" has no item. */
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = groups.flatMap((g) => g.items).find((i) => i.value === value);

  const go = React.useCallback(
    (next: string) => {
      const qs = new URLSearchParams(searchParams);
      // Everything else on the URL (`week`, `view`) is someone else's
      // setting; the pre-selector `staff=` is superseded by `show=`.
      qs.delete("staff");
      if (next === "all") qs.delete("show");
      else qs.set("show", next);
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname);
    },
    [pathname, router, searchParams],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <span className="text-muted-foreground font-normal">Show</span>
            <Mark item={current} />
            {label}
            <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => go(String(v))}>
          {groups.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 ? <DropdownMenuSeparator /> : null}
              <DropdownMenuGroup>
                {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
                {group.items.map((item) => (
                  <DropdownMenuRadioItem key={item.value} value={item.value}>
                    <Mark item={item} />
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuGroup>
            </React.Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* A person's colour dot or a space's house — the marks the week grid's
   cards already use, so the menu and the calendar read alike. */
function Mark({ item }: { item: ScopeItem | undefined }) {
  if (item?.color) {
    return <span aria-hidden style={{ background: item.color }} className="size-2 shrink-0 rounded-full" />;
  }
  if (item?.space) {
    return <HugeiconsIcon icon={House01Icon} size={14} className="shrink-0" aria-hidden />;
  }
  return null;
}
