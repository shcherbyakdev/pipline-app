import { cn } from "@/lib/utils";

/* Landing-only button styles: pills, medium weight, flat fills. Built on
   plain classes rather than the app's `buttonVariants` so the landing can
   have its own shape without touching the app-wide button, while sharing the
   token palette. Press feedback is a 160ms scale to 0.97; hover colour is
   gated to real pointers. Shape rule for the landing: controls are pills,
   panels 40px, cards 24px, product fragments 12px. */

const base =
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,transform] duration-[160ms] ease-strong outline-none select-none active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const VARIANT = {
  /* Solid ink: the nav's action. */
  primary: "bg-primary text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-primary/85",
  /* Lavender ghost (the reference's secondary pill). */
  neutral: "bg-brand/10 text-brand-text [@media(hover:hover)_and_(pointer:fine)]:hover:bg-brand/15",
  /* Plain text link. */
  quiet: "text-muted-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground",
} as const;

const SIZE = {
  /* Nav. */
  md: "h-10 gap-2 px-4 text-[14px] sm:px-5",
  /* Standalone CTA. */
  lg: "h-12 gap-2.5 px-6 text-[16px]",
  /* Quiet links next to a button. */
  text: "h-10 gap-2 px-3 text-[14px]",
} as const;

export function marketingButton(variant: keyof typeof VARIANT, size: keyof typeof SIZE, className?: string) {
  return cn(base, VARIANT[variant], SIZE[size], className);
}
