import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RenderContext } from "./context";

/* The sibling-channel link. A plain anchor in public (works before
   hydration); inert in preview like every other link on the page — the
   SectionFrame around it takes the click to select. Theme tokens only, no
   accent fill: it is a way out, not the call to action. `button` is the
   cover's form — the outlined second button beside Book. */
export function CrossLink({
  link, mode, className, variant = "text",
}: {
  link: RenderContext["crossLink"]; mode: RenderContext["mode"]; className?: string; variant?: "text" | "button";
}) {
  if (!link) return null;
  const cls = variant === "button"
    ? cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-[var(--widget-radius)] px-4", className)
    : cn("text-muted-foreground hover:text-foreground text-sm underline-offset-3 hover:underline", className);
  return mode === "public" ? (
    <a href={link.href} className={cls}>{link.label}</a>
  ) : (
    <span aria-disabled className={cn(cls, "cursor-default")}>{link.label}</span>
  );
}
