"use client";

import * as React from "react";
import Link from "next/link";
import { CTA, SITE } from "@/features/marketing/site";
import { hasAuthCookie } from "@/features/marketing/auth-cookie";
import { DEFAULT_AFTER_LOGIN } from "@/lib/auth/next-path";
import { BookloMark } from "./booklo-mark";

/* The mark on the left, one small pill on the right (interfacecraft.dev's
   nav): Log in for a visitor, Dashboard for someone signed in. Nothing
   else; the page is one hero and the claim bar is its action. */
const subscribeNoop = () => () => {};

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
        <Link href={SITE.links.home} className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background">
          <BookloMark className="size-8" />
          <span className="sr-only">{SITE.name}</span>
        </Link>
        <Link
          href={authed ? DEFAULT_AFTER_LOGIN : SITE.links.login}
          className="bg-secondary text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent focus-visible:ring-ring inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium transition-[background-color] duration-150 ease-strong outline-none focus-visible:ring-2"
        >
          {authed ? CTA.dashboard : CTA.login}
        </Link>
      </nav>
    </header>
  );
}
