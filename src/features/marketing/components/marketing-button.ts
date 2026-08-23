import { cn } from "@/lib/utils";

/* Landing-only button styles: pills (spec 2026-08-23-landing-claim). Built on
   plain classes rather than the app's `buttonVariants` so the landing can
   have its own shape without touching the app-wide button, while sharing the
   token palette. */

const base =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const VARIANT = {
  /* Solid near-black. */
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  /* Outlined. */
  neutral: "text-foreground ring-1 ring-border hover:bg-accent",
  /* Plain text link. */
  quiet: "text-foreground/75 hover:text-foreground",
} as const;

const SIZE = {
  /* Nav chip. */
  md: "h-9 gap-2 px-4 sm:px-5 text-[13px]",
  /* Standalone CTA. */
  lg: "h-11 gap-2 px-6 text-sm",
  /* Quiet links next to a button. */
  text: "h-9 gap-2 px-2 text-[13px]",
} as const;

export function marketingButton(variant: keyof typeof VARIANT, size: keyof typeof SIZE, className?: string) {
  return cn(base, VARIANT[variant], SIZE[size], className);
}
