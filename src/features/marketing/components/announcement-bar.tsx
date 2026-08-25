import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ANNOUNCEMENT, SITE } from "@/features/marketing/site";

/* Slim strip above the nav — both references open with one. It scrolls
   away; the nav under it is the sticky part. */
export function AnnouncementBar() {
  return (
    <div className="bg-tint">
      <div className="mx-auto flex min-h-10 w-full max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-5 py-2 text-[13px] sm:px-8">
        <span className="text-highlight font-mono text-[10px] tracking-[0.14em] uppercase">{ANNOUNCEMENT.label}</span>
        <span className="text-foreground/80">{ANNOUNCEMENT.text}</span>
        {/* The link is dropped on phones so the strip stays one line; the
            hero's claim bar is one thumb-scroll below. */}
        <Link
          href={SITE.links.signup}
          className="text-foreground hidden items-center gap-1 font-medium underline-offset-4 hover:underline sm:inline-flex"
        >
          {ANNOUNCEMENT.cta}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
