import { cn } from "@/lib/utils";

/* Landing-only button styles: pills. Built on plain classes rather than the
   app's `buttonVariants` so the landing can have its own shape without
   touching the app-wide button, while sharing the token palette. */

const base =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const VARIANT = {
  /* Solid ink. */
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  /* Outlined. */
  neutral: "text-foreground ring-1 ring-input ring-inset hover:bg-accent",
  /* Plain text link. */
  quiet: "text-foreground/70 hover:text-foreground",
} as const;

const SIZE = {
  /* Nav chip. */
  md: "h-10 gap-2 px-4 text-sm sm:px-5",
  /* Standalone CTA. */
  lg: "h-12 gap-2 px-6 text-[15px]",
  /* Quiet links next to a button. */
  text: "h-10 gap-2 px-3 text-sm",
} as const;

export function marketingButton(variant: keyof typeof VARIANT, size: keyof typeof SIZE, className?: string) {
  return cn(base, VARIANT[variant], SIZE[size], className);
}
