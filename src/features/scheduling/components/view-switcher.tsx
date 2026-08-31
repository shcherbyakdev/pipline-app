import Link from "next/link";
import { viewSwitcherItems, type BookingsView } from "@/features/scheduling/bookings-views";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

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
    <nav aria-label="Bookings view" className={SEGMENTED_NAV_CLASS}>
      {items.map((item) => (
        <Link
          key={item.view}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={segmentedItemClass(item.current)}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
