import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE } from "@/features/marketing/site";

export function MarketingNav() {
  return (
    <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href={SITE.links.home} className="text-lg font-semibold tracking-tight">
          {SITE.name}
        </Link>
        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-muted-foreground hover:text-foreground text-sm transition-colors">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Link href={SITE.links.login} className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
            Log in
          </Link>
          <Link href={SITE.links.signup} className={cn(buttonVariants({ size: "lg" }), "px-4")}>
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
