"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { CTA, NAV_LINKS, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { BookloWordmark } from "./booklo-mark";

/* Logo left, links centre (md+), Log in + Get started right, hamburger below
   md with a blurred dropdown. Sticky, so the primary CTA stays in reach while
   the page scrolls. The dropdown closes on link click and on Escape. */
export function MarketingNav() {
  const [open, setOpen] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="animate-fade-down bg-background/85 sticky top-0 z-30 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href={SITE.links.home} className="text-foreground text-[21px]">
          <BookloWordmark />
        </Link>

        <ul className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-foreground/70 hover:text-foreground text-sm transition-colors duration-200">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Link href={SITE.links.login} className={marketingButton("neutral", "md", "hidden sm:inline-flex")}>
            {CTA.login}
          </Link>
          <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
            {CTA.getStarted}
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="text-foreground hover:bg-accent inline-flex size-10 items-center justify-center rounded-full md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {open ? (
        <div
          id="mobile-nav"
          className="animate-fade-up bg-card/90 ring-border absolute top-full right-4 left-4 mt-1 rounded-2xl px-5 py-2 shadow-lg ring-1 backdrop-blur-xl md:hidden"
        >
          <ul>
            {[...NAV_LINKS, { label: CTA.login, href: SITE.links.login }].map((l) => (
              <li key={l.href} className="border-border border-b last:border-b-0">
                <a href={l.href} onClick={() => setOpen(false)} className="text-foreground/80 hover:text-foreground block py-3 text-[15px]">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}
