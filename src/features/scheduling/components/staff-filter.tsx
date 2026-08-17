"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { StaffRow } from "@/features/scheduling/staff-queries";
import { cn } from "@/lib/utils";

/* Whose appointments is the calendar showing? A multi-select chip row that
   writes `?staff=a,b` — navigation, not component state, so the lens survives
   a refresh, a week arrow, and a share.

   `router.replace`, not `push`: narrowing the calendar is a view setting, not
   a place in history — Back should leave the page, not walk through every
   chip the provider tried.

   Solo rule: with one active member there is nothing to filter, so this
   renders nothing at all and the calendar is identical to the pre-team one.
   Guarded here as well as at the call site so no caller can show a one-chip
   filter. */
export function StaffFilter({ staff, selected }: { staff: StaffRow[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // "All" is the absence of the param, so it also covers "every member ticked"
  // — the two mean the same week and must not look different.
  const all = selected.length >= staff.length;

  const go = React.useCallback(
    (ids: string[]) => {
      const next = new URLSearchParams(searchParams);
      // Everything else on the URL (`week`, `view`) is someone else's setting.
      if (ids.length === 0 || ids.length >= staff.length) next.delete("staff");
      else next.set("staff", ids.join(","));
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [pathname, router, searchParams, staff.length],
  );

  if (staff.length < 2) return null;

  const toggle = (id: string) => {
    // From "All", a click means "just this person" — the common case is
    // narrowing to one, not un-ticking one of many.
    if (all) return go([id]);
    if (selected.includes(id)) return go(selected.filter((s) => s !== id));
    return go([...selected, id]);
  };

  return (
    <div
      role="group"
      aria-label="Filter by team member"
      className="border-border bg-muted/40 flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border p-0.5"
    >
      <button
        type="button"
        aria-pressed={all}
        onClick={() => go([])}
        className={cn(
          "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
          all
            ? "bg-background text-foreground font-medium shadow-xs"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        All
      </button>
      {staff.map((person) => {
        const on = !all && selected.includes(person.id);
        return (
          <button
            key={person.id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(person.id)}
            className={cn(
              "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
              on
                ? "bg-background text-foreground font-medium shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              aria-hidden
              style={{ background: person.color }}
              className="size-2 shrink-0 rounded-full"
            />
            {person.name}
          </button>
        );
      })}
    </div>
  );
}
