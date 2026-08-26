"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, CheckIcon } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  scopeItemChecked,
  scopeValue,
  toggleScopeItem,
  type PersonLike,
  type Scope,
  type ScopeGroup,
  type ScopeItem,
  type SpaceLike,
} from "@/features/scheduling/bookings-scope";

/* Show: All bookings ▾ — what the Bookings page is looking at. One scope
   grouped by kind (Acuity's "All calendars", Fresha's "Team"), replacing
   the people-only chip row, and it multi-selects: tick any mix of people
   and spaces, the menu stays open (Base UI checkbox items), the week
   behind it updates live. "All bookings" is the one plain item — it resets
   and closes. Writes `?show=` — navigation, not component state, so the
   lens survives a refresh, a week arrow and a share.

   `router.replace`, not `push`: narrowing the calendar is a view setting,
   not a place in history — Back should leave the page, not walk through
   every tick the provider made. The page renders this only when the org
   has something to choose (bookings-scope.ts scopeItems). */
export function ScopeMenu({
  groups,
  scope,
  people,
  spaces,
  label,
}: {
  groups: ScopeGroup[];
  scope: Scope;
  people: PersonLike[];
  spaces: SpaceLike[];
  /** What the trigger reads — scopeLabel. */
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const items = groups.flatMap((g) => g.items);
  // One named thing ticked ⇒ its mark on the trigger; a group or several ⇒ none.
  const ticked = items.filter((i) => i.kind !== "all" && scopeItemChecked(scope, i));
  const mark = ticked.length === 1 ? ticked[0] : undefined;

  const go = React.useCallback(
    (next: Scope) => {
      const qs = new URLSearchParams(searchParams);
      // Everything else on the URL (`week`, `view`) is someone else's
      // setting; the pre-selector `staff=` is superseded by `show=`.
      qs.delete("staff");
      const value = scopeValue(next, people, spaces);
      if (value) qs.set("show", value);
      else qs.delete("show");
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname);
    },
    [pathname, router, searchParams, people, spaces],
  );
  const toggle = (item: ScopeItem) => go(toggleScopeItem(scope, item, people, spaces));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <span className="text-muted-foreground font-normal">Show</span>
            <Mark item={mark} />
            {label}
            <ChevronDown className="text-muted-foreground" data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {groups.map((group, gi) => (
          <React.Fragment key={group.label ?? gi}>
            {gi > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              {group.label ? <DropdownMenuLabel>{group.label}</DropdownMenuLabel> : null}
              {group.items.map((item) =>
                item.kind === "all" ? (
                  <DropdownMenuItem key={item.key} onClick={() => toggle(item)} className="pr-8">
                    {item.label}
                    {scope.kind === "all" ? (
                      <CheckIcon className="pointer-events-none absolute right-2" aria-hidden />
                    ) : null}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuCheckboxItem
                    key={item.key}
                    checked={scopeItemChecked(scope, item)}
                    onCheckedChange={() => toggle(item)}
                  >
                    <Mark item={item} />
                    {item.label}
                  </DropdownMenuCheckboxItem>
                ),
              )}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
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
