import Link from "next/link";
import { cn } from "@/lib/utils";
import type { StaffRow } from "@/features/scheduling/staff-queries";

/* Who am I editing? A segmented row of links — navigation, not state, so the
   selected person survives a refresh and can be shared as a URL.

   Solo rule: with one active member there is nothing to choose, so the caller
   renders nothing at all and the page looks exactly as it did before the team
   slice. Guarded here too, so no caller can accidentally show a one-tab
   switcher. */
export function StaffTabs({
  staff,
  current,
  hrefFor,
}: {
  staff: StaffRow[];
  current: string;
  hrefFor: (id: string) => string;
}) {
  if (staff.length < 2) return null;
  return (
    <nav
      aria-label="Team member"
      className="border-border bg-muted/40 flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border p-0.5"
    >
      {staff.map((person) => {
        const active = person.id === current;
        return (
          <Link
            key={person.id}
            href={hrefFor(person.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
              active
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
          </Link>
        );
      })}
    </nav>
  );
}
