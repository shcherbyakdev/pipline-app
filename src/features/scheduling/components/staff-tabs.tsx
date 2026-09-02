import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { StaffRow } from "@/features/scheduling/staff-queries";

/* The segmented idiom now lives in components/ui/segmented.ts (one look for
   every switcher in the app); re-exported here so existing importers keep
   working. */
export { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

/* Whose week am I looking at? A segmented row of links — navigation, not
   state, so the selected person survives a refresh and can be shared as a
   URL. Currently unused — kept only as the home of the segmented classes
   above; the Availability page has its own OwnerTabs (people AND hourly
   spaces).

   Solo rule: with one active member there is nothing to choose, so the caller
   renders nothing at all and the page looks exactly as it did before the team
   slice. Guarded here too, so no caller can accidentally show a one-tab
   switcher. */
export async function StaffTabs({
  staff,
  current,
  hrefFor,
}: {
  staff: StaffRow[];
  current: string;
  hrefFor: (id: string) => string;
}) {
  if (staff.length < 2) return null;
  const t = await getTranslations("bookings");
  return (
    <nav aria-label={t("teamMember")} className={SEGMENTED_NAV_CLASS}>
      {staff.map((person) => {
        const active = person.id === current;
        return (
          <Link
            key={person.id}
            href={hrefFor(person.id)}
            aria-current={active ? "page" : undefined}
            className={segmentedItemClass(active)}
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
