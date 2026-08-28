import Link from "next/link";
import { APPOINTMENTS, SPACES } from "@/features/orgs/vocab";
import type { PageChannel } from "../channel";
import { cn } from "@/lib/utils";

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
    <nav aria-label="Which page" className="border-border bg-muted/40 flex w-fit items-center gap-0.5 rounded-lg border p-0.5">
      {PAGES.map((p) => (
        <Link
          key={p.channel}
          href={`/booking-page?page=${p.channel}`}
          aria-current={value === p.channel ? "page" : undefined}
          className={cn(
            "focus-visible:ring-ring/50 flex h-7 items-center rounded-[6px] px-3 text-sm outline-none focus-visible:ring-2",
            value === p.channel ? "bg-background text-foreground font-medium shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
