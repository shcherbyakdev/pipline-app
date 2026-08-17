import Link from "next/link";
import { CTA, NAV_LINKS, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { BookloWordmark } from "./booklo-mark";

export function MarketingNav() {
  return (
    // No hairline under the nav (throxy-style): it sits on the page ground and
    // only the blur separates it from content once the page scrolls.
    <header className="bg-background/80 sticky top-0 z-40 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6">
        <Link href={SITE.links.home} className="text-[22px]">
          <BookloWordmark />
        </Link>
        <div className="flex items-center gap-8">
          <ul className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-foreground/80 hover:text-foreground text-sm transition-colors">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-5">
            <Link href={SITE.links.login} className="text-foreground/80 hover:text-foreground hidden text-sm transition-colors sm:inline">
              {CTA.login}
            </Link>
            <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
              {CTA.getStarted}
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
