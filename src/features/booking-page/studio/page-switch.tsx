import Link from "next/link";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { PageChannel } from "../channel";
import { SEGMENTED_NAV_CLASS, segmentedItemClass } from "@/components/ui/segmented";

const PAGES: ReadonlyArray<{ channel: PageChannel; label: string }> = [
  { channel: "appointments", label: APPOINTMENTS.page },
  { channel: "spaces", label: SPACES.page },
];

/* Which of the org's two pages the studio is editing (spec 2026-08-28
   §4.2). Links, not tabs: the server loads the other page's draft and the
   builder re-mounts, so usePageDraft never has to switch documents.
   Rendered only for an org that declares both channels. */
export function PageSwitch({ value }: { value: PageChannel }) {
  return (
    <nav aria-label="Which page" className={SEGMENTED_NAV_CLASS}>
      {PAGES.map((p) => (
        <Link
          key={p.channel}
          href={`/booking-page?page=${p.channel}`}
          aria-current={value === p.channel ? "page" : undefined}
          className={segmentedItemClass(value === p.channel)}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
