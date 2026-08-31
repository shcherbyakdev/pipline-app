"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { CTA, NAV_LINKS, SITE } from "@/features/marketing/site";
import { hasAuthCookie } from "@/features/marketing/auth-cookie";
import { DEFAULT_AFTER_LOGIN } from "@/lib/auth/next-path";
import { marketingButton } from "./marketing-button";
import { BookloWordmark } from "./booklo-mark";
import { cn } from "@/lib/utils";

/* Wordmark left, plain links beside it (md+), Log in as a grey pill and Get
   started as the ink pill on the right; a hamburger below md that opens a
   small card. Sticky so the primary CTA stays in reach while the page
   scrolls; the ground shows through at 80% with a light blur. The card
   closes on link click and on Escape. */
const subscribeNoop = () => () => {};

export function MarketingNav() {
  const [open, setOpen] = React.useState(false);
  const toggleRef = React.useRef<HTMLButtonElement>(null);

  /* Signed-in visitors get one Dashboard pill instead of Log in / Get
     started. Read from the Supabase cookie via useSyncExternalStore (the
     onboarding-form idiom: no subscription, the value never changes while
     mounted) so the page stays static; SSR and first paint show the
     signed-out pair for a beat. */
  const authed = React.useSyncExternalStore(
    subscribeNoop,
    () => hasAuthCookie(document.cookie),
    () => false,
  );

  /* While the dark band (the section marked data-nav-dark) sits under the
     bar, the header opts into the `.dark` token scope so its ground, links
     and pills invert. The observer's bottom margin shrinks the viewport to
     roughly the bar's own strip, so "intersecting" means "under the bar". */
  const [overDark, setOverDark] = React.useState(false);
  React.useEffect(() => {
    const target = document.querySelector("[data-nav-dark]");
    if (!target) return;
    const io = new IntersectionObserver(([e]) => setOverDark(e.isIntersecting), { rootMargin: "0px 0px -92% 0px" });
    io.observe(target);
    return () => io.disconnect();
  }, []);

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
    <header className={cn("bg-background/80 sticky top-0 z-30 backdrop-blur-md transition-[background-color] duration-300", overDark && "dark")}>
      <nav aria-label="Main" className="mx-auto flex h-[72px] w-full max-w-6xl items-center gap-8 px-5 sm:px-8 lg:gap-10">
        <Link
          href={SITE.links.home}
          className="text-foreground focus-visible:ring-ring rounded-sm text-[25px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
        >
          <BookloWordmark />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent focus-visible:ring-ring block rounded-full px-3 py-1.5 text-[15px] font-medium transition-[background-color] duration-150 ease-strong outline-none focus-visible:ring-2"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {authed ? (
            <Link href={DEFAULT_AFTER_LOGIN} className={marketingButton("primary", "md")}>
              {CTA.dashboard}
            </Link>
          ) : (
            <>
              <Link href={SITE.links.login} className={marketingButton("neutral", "md", "hidden sm:inline-flex")}>
                {CTA.login}
              </Link>
              <Link href={SITE.links.signup} className={marketingButton("primary", "md")}>
                {CTA.getStarted}
              </Link>
            </>
          )}
          <button
            ref={toggleRef}
            type="button"
            className="text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-full outline-none focus-visible:ring-2 md:hidden"
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
        <div id="mobile-nav" className="animate-fade-up bg-card absolute top-full right-4 left-4 mt-2 rounded-2xl p-2 shadow-[var(--shadow-card)] md:hidden">
          <ul>
            {[...NAV_LINKS, authed ? { label: CTA.dashboard, href: DEFAULT_AFTER_LOGIN } : { label: CTA.login, href: SITE.links.login }].map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="text-foreground hover:bg-accent block rounded-xl px-3 py-2.5 text-[15px] font-medium">
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
