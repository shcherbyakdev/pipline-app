import * as React from "react";
import { cn } from "@/lib/utils";
import { SITE } from "@/features/marketing/site";

/* The Booklo mark (2026-09-09): one soft blob, the periwinkle gradient
   running light to brand across it. The silhouette is the user's chosen
   shape; the reference's yellow-to-cyan and its noise overlay were dropped
   so the mark sits in the product's own palette and renders crisp at 24px.
   Sized by `className` (defaults to the parent's font-size). */
export const MARK_PATH =
  "M159.603 4.119c20.424 5.543 26.833 22.173 25.137 37.14-1.681 14.832-17.516 28.046-40.735 27.19 6.323.493 26.219 7.822 30.262 25.472 4.19 18.293-5.181 29.59-16.758 35.477-18.166 9.237-38.227 9.211-55.509 8.102 10.621 5.911 25.831 16.991 27.753 34.027 1.923 17.037-12.568 33.26-41.894 27.163-29.326-6.098-84.992-31.19-70.174-74.281 5.942-17.279 25.406-23.795 36.658-26.054 4.87-.977 19.376-3.326 39.8-3.326-24.487-2.356-62.526-14.412-64.413-41.575C25.956-.87 123.06-5.8 159.603 4.12z";

export function BookloMark({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={cn("size-[1em] shrink-0", className)}>
      <defs>
        <linearGradient id={id} x1="38" y1="14.5" x2="119" y2="181.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#b9b0ff" />
          <stop offset="1" stopColor="#6975e2" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d={MARK_PATH} />
    </svg>
  );
}

/* Booklo wordmark: just the word, lowercase, in Outfit Semibold tracked
   tight. Sized by the parent's font-size so it works from the nav to the
   footer. */
export function BookloWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display inline-block leading-none font-semibold tracking-[-0.04em]", className)}>
      <span className="sr-only">{SITE.name}</span>
      <span aria-hidden="true">booklo</span>
    </span>
  );
}

/* Mark beside wordmark, on one baseline. */
export function BookloLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.32em]", className)}>
      <BookloMark className="size-[1.1em]" />
      <BookloWordmark />
    </span>
  );
}
