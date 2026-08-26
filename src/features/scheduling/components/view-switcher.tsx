import Link from "next/link";
import { viewSwitcherItems, type BookingsView } from "@/features/scheduling/bookings-views";
import { cn } from "@/lib/utils";

/* Week · Timeline · List — a segmented row of links (staff-tabs.tsx idiom:
   navigation, not state, so the view survives a refresh and can be shared).
   Rendered by every branch of the Bookings page so the three words never
   drift again (admin IA spec §2). */
export function ViewSwitcher({
  current,
  showTimeline,
  scopeQuery,
}: {
  current: BookingsView;
  showTimeline: boolean;
  /** "show=…" from bookings-scope.ts — Week and List carry it, Timeline drops it. */
  scopeQuery?: string;
}) {
  const items = viewSwitcherItems({ current, showTimeline, scopeQuery });
  return (
    <nav
      aria-label="Bookings view"
      className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5"
    >
      {items.map((item) => (
        <Link
          key={item.view}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/50 flex h-7 shrink-0 items-center rounded-[6px] px-2.5 text-sm outline-none focus-visible:ring-2",
            item.current
              ? "bg-background text-foreground font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
