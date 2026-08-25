import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import { House01Icon } from "@hugeicons/core-free-icons";
import { SPACES } from "@/features/orgs/vocab";
import {
  ownerHref,
  type Owner,
  type PersonLike,
  type SpaceLike,
} from "@/features/scheduling/availability-owner";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "./staff-tabs";

/* Whose hours am I editing? StaffTabs' segmented-link idiom with two
   clusters — People (colour dot) then Spaces (house icon) — separated by a
   hairline (admin IA spec §3, ruling 4: team members and hourly spaces are
   one kind of owner). Navigation, not state, so the choice survives a
   refresh and can be shared as a URL.

   Solo rule, extended: fewer than two owners in total means nothing to
   choose, so render nothing — a one-person team or a single hourly space
   sees the page exactly as before. */
export function OwnerTabs({
  people,
  spaces,
  current,
}: {
  people: readonly PersonLike[];
  spaces: readonly SpaceLike[];
  current: Owner;
}) {
  if (people.length + spaces.length < 2) return null;
  const isCurrent = (kind: Owner["kind"], id: string) => current.kind === kind && current.id === id;
  return (
    <nav aria-label="Whose hours" className={SEGMENTED_NAV_CLASS}>
      {people.length > 0 ? (
        <span role="group" aria-label="People" className="flex items-center gap-0.5">
          {people.map((p) => {
            const active = isCurrent("staff", p.id);
            return (
              <Link
                key={p.id}
                href={ownerHref({ kind: "staff", id: p.id })}
                aria-current={active ? "page" : undefined}
                className={segmentedItemClass(active)}
              >
                <span aria-hidden style={{ background: p.color }} className="size-2 shrink-0 rounded-full" />
                {p.name}
              </Link>
            );
          })}
        </span>
      ) : null}
      {people.length > 0 && spaces.length > 0 ? (
        <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" />
      ) : null}
      {spaces.length > 0 ? (
        <span role="group" aria-label={SPACES.nav} className="flex items-center gap-0.5">
          {spaces.map((s) => {
            const active = isCurrent("space", s.id);
            return (
              <Link
                key={s.id}
                href={ownerHref({ kind: "space", id: s.id })}
                aria-current={active ? "page" : undefined}
                className={segmentedItemClass(active)}
              >
                <HugeiconsIcon icon={House01Icon} size={12} className="shrink-0" aria-hidden />
                {s.name}
              </Link>
            );
          })}
        </span>
      ) : null}
    </nav>
  );
}
