"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { CTA, NAV_LINKS, SITE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";
import { BookloWordmark } from "./booklo-mark";

/* Logo left, links centre (md+), Log in + Get started right, hamburger below
   md with a blurred dropdown (spec §3.3). The dropdown closes on link click
   and on Escape. */
export function MarketingNav() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="animate-fade-down relative z-20">
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-4 sm:px-8 sm:py-5 lg:px-10"
      >
        <Link href={SITE.links.home} className="text-foreground text-[20px] sm:text-[22px]">
          <BookloWordmark />
        </Link>

        <ul className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} className="text-foreground/75 hover:text-foreground text-[13px] transition-colors">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3">
          <Link href={SITE.links.login} className={marketingButton("quiet", "text", "hidden sm:inline-flex")}>
            {CTA.login}
          </Link>
          <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
            {CTA.getStarted}
          </Link>
          <button
            type="button"
            className="text-foreground hover:bg-accent inline-flex size-9 items-center justify-center rounded-full md:hidden"
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
          className="animate-fade-up bg-card/80 ring-border absolute top-full right-4 left-4 rounded-2xl px-5 py-3 shadow-lg ring-1 backdrop-blur-xl md:hidden"
        >
          <ul>
            {[...NAV_LINKS, { label: CTA.login, href: SITE.links.login }].map((l) => (
              <li key={l.href} className="border-border border-b last:border-b-0">
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="text-foreground/80 hover:text-foreground block py-3 text-[15px]"
                >
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
