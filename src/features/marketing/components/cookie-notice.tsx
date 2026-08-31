"use client";

import * as React from "react";
import Link from "next/link";
import { COOKIE_NOTICE } from "@/features/marketing/site";
import { marketingButton } from "./marketing-button";

const STORAGE_KEY = "booklo_cookie_notice";

/* Info-only cookie note on the marketing pages (not the app, not the embed:
   a banner inside customers' iframes would be ours, on their site). Only
   essential cookies exist, so there is no consent to collect; one Got it
   button remembers the dismissal in localStorage. Hidden on SSR and first
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
      className="animate-fade-up bg-card fixed right-4 bottom-4 left-4 z-40 flex flex-col gap-3 rounded-2xl p-4 shadow-[var(--shadow-card)] sm:left-auto sm:max-w-sm sm:flex-row sm:items-center"
    >
      <p className="text-foreground/80 text-sm">
        {COOKIE_NOTICE.text}{" "}
        <Link href="/privacy" className="text-foreground underline underline-offset-2">
          {COOKIE_NOTICE.policy}
        </Link>
      </p>
      <button type="button" onClick={dismiss} className={marketingButton("primary", "md", "self-end sm:self-auto")}>
        {COOKIE_NOTICE.dismiss}
      </button>
    </div>
  );
}
