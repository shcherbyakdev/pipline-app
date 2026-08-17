import { cn } from "@/lib/utils";

/* Landing-only button styles (throxy-style: rectangular, small radius, arrow
   leading the label on the big CTA). Built on plain classes rather than the
   app's `buttonVariants` so the landing can have its own shape without
   touching the app-wide button, while sharing the token palette. */

const base =
  "inline-flex shrink-0 items-center rounded-[4px] font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50";

const VARIANT = {
  /* Solid accent — the yellow. */
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  /* Solid neutral — throxy's dark nav button, translated to a light chip on our dark ground. */
  neutral: "bg-foreground text-background hover:bg-foreground/90",
  /* Plain text link with the arrow. */
  quiet: "text-foreground/85 hover:text-foreground",
} as const;

const SIZE = {
  /* Nav-height chip. */
  md: "h-10 gap-2 px-4 text-sm",
  /* Hero / final CTA: tall and wide, arrow left, label centred in the rest. */
  lg: "h-14 min-w-72 justify-between gap-6 px-6 text-base sm:min-w-80",
  /* Quiet links sit next to a large button and match its height. */
  text: "h-14 gap-2 px-2 text-base",
} as const;

export function marketingButton(variant: keyof typeof VARIANT, size: keyof typeof SIZE, className?: string) {
  return cn(base, VARIANT[variant], SIZE[size], className);
}
