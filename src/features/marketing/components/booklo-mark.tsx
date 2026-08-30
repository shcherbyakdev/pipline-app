import { cn } from "@/lib/utils";
import { SITE } from "@/features/marketing/site";

/* Booklo wordmark: just the word, lowercase, in Outfit Semibold tracked
   tight. No symbol, no letter tricks (chosen 2026-08-28 from a six-face
   sheet). Sized by the parent's font-size so it works from the nav to the
   footer. */
export function BookloWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display inline-block leading-none font-semibold tracking-[-0.04em]", className)}>
      <span className="sr-only">{SITE.name}</span>
      <span aria-hidden="true">booklo</span>
    </span>
  );
}
