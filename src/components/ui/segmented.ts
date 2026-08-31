import { cn } from "@/lib/utils";

/* The soft world's segmented switch (the landing hero's pill switch, sized
   for Operate surfaces): a grey pill track, the chosen item lifted onto a
   white card with a hairline and the small layered shadow. One idiom for
   links (view switcher, owner tabs), radios (layout toggle) and tabs
   (studio) — callers add nothing but sizes. */
export const SEGMENTED_NAV_CLASS =
  "bg-secondary flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full p-0.5";

export function segmentedItemClass(active: boolean, className?: string): string {
  return cn(
    "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3 text-[13px] font-medium transition-colors duration-150 ease-strong outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    active
      ? "border-border bg-card text-foreground shadow-(--shadow-lift)"
      : "text-muted-foreground hover:text-foreground",
    className,
  );
}
