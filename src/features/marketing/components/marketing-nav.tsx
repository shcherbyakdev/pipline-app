"use client";

import * as React from "react";
import Link from "next/link";
import { CTA, SITE } from "@/features/marketing/site";
import { hasAuthCookie } from "@/features/marketing/auth-cookie";
import { DEFAULT_AFTER_LOGIN } from "@/lib/auth/next-path";
import { BookloLogo } from "./booklo-mark";

/* The mark (in ink) and the wordmark on the left, two small pills on the
   right (interfacecraft.dev's nav): Log in and Get started for a visitor,
   Dashboard alone for someone signed in. */
const subscribeNoop = () => () => {};
const pill =
  "focus-visible:ring-ring inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-[background-color] duration-150 ease-strong outline-none focus-visible:ring-2";

export function MarketingNav() {
  /* Read from the Supabase cookie via useSyncExternalStore (the
     onboarding-form idiom: no subscription, the value never changes while
     mounted) so the page stays static; SSR and first paint show Log in. */
  const authed = React.useSyncExternalStore(
    subscribeNoop,
    () => hasAuthCookie(document.cookie),
    () => false,
  );
  return (
    <header>
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href={SITE.links.home} className="text-foreground focus-visible:ring-ring rounded-md text-[22px] outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background">
          <BookloLogo ink />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={authed ? DEFAULT_AFTER_LOGIN : SITE.links.login}
            className={`${pill} bg-secondary text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent`}
          >
            {authed ? CTA.dashboard : CTA.login}
          </Link>
          {authed ? null : (
            <Link
              href={SITE.links.signup}
              className={`${pill} bg-primary text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/85`}
            >
              {CTA.getStarted}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
