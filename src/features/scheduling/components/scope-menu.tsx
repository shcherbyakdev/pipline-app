"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  scopeItemChecked,
  scopeLabel,
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
   behind it updates live. "All bookings" is the one item that closes — it
   resets. Writes `?show=` — navigation, not component state, so the lens
   survives a refresh, a week arrow and a share.

   The ticks are optimistic (useOptimistic over the server's `scope`): a
   tick shows at once and the next tick builds on it, so two quick ticks
   are two ticks, not the second replacing the first while the first's
   navigation is still in flight. When the navigation commits, the
   server's scope takes over again — same value, by construction.

   `router.replace`, not `push`: narrowing the calendar is a view setting,
   not a place in history — Back should leave the page, not walk through
   every tick the provider made; `scroll: false` for the same reason. The
   page renders this only when the org has something to choose
   (bookings-scope.ts scopeItems). */
export function ScopeMenu({
  groups,
  scope,
  people,
  spaces,
}: {
  groups: ScopeGroup[];
  scope: Scope;
  people: PersonLike[];
  spaces: SpaceLike[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [shown, setShown] = React.useOptimistic(scope);
  const [, startTransition] = React.useTransition();
  const items = groups.flatMap((g) => g.items);
  const label = scopeLabel(shown, people, spaces);
  // One named thing ticked ⇒ its mark on the trigger; a group or several ⇒ none.
  const ticked = items.filter((i) => i.kind !== "all" && scopeItemChecked(shown, i));
  const mark = ticked.length === 1 ? ticked[0] : undefined;

  const toggle = (item: ScopeItem) => {
    const next = toggleScopeItem(shown, item, people, spaces);
    const qs = new URLSearchParams(searchParams);
    // Everything else on the URL (`week`, `view`) is someone else's
    // setting; the pre-selector `staff=` is superseded by `show=`.
    qs.delete("staff");
    const value = scopeValue(next, people, spaces);
    if (value) qs.set("show", value);
    else qs.delete("show");
    const s = qs.toString();
    startTransition(() => {
      setShown(next);
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    });
  };

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
              {group.items.map((item) => (
                <DropdownMenuCheckboxItem
                  key={item.key}
                  checked={scopeItemChecked(shown, item)}
                  onCheckedChange={() => toggle(item)}
                  // "All bookings" is the reset: it always ends checked, and
                  // it is the one tick that closes the menu.
                  closeOnClick={item.kind === "all"}
                >
                  <Mark item={item} />
                  {item.label}
                </DropdownMenuCheckboxItem>
              ))}
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
