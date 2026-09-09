"use client";

import * as React from "react";
import Link from "next/link";
import { COOKIE_NOTICE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";

const STORAGE_KEY = "booklo_cookie_notice";

/* Info-only cookie note on the marketing pages (not the app, not the embed:
   a banner inside customers' iframes would be ours, on their site). Only
   essential cookies exist, so there is no consent to collect; one Got it
   button remembers the dismissal in localStorage. A slim bar along the
   bottom, so it never sits on the product. Hidden on SSR and first
   paint (marketing-nav's useSyncExternalStore idiom), so dismissed visitors
   never see a flash. Storage blocked (private mode) reads as dismissed:
   hidden beats nagging forever. */
const subscribeNoop = () => () => {};
const readDismissed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true;
  }
};

export function CookieNotice() {
  const dismissed = React.useSyncExternalStore(subscribeNoop, readDismissed, () => true);
  const [closed, setClosed] = React.useState(false);

  const dismiss = () => {
    setClosed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* worst case it reappears next visit */
    }
  };

  if (dismissed || closed) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="animate-fade-up bg-card/95 border-border fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-sm"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-2.5 sm:px-8">
        <p className="text-foreground/80 text-[13px] leading-snug">
          {COOKIE_NOTICE.text}{" "}
          <Link
            href="/privacy"
            className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2"
          >
            {COOKIE_NOTICE.policy}
          </Link>
        </p>
        <button type="button" onClick={dismiss} className={marketingButton("primary", "md", "h-8 px-3.5 text-[13px]")}>
          {COOKIE_NOTICE.dismiss}
        </button>
      </div>
    </div>
  );
}
