import { cn } from "@/lib/utils";
import type { RenderContext } from "./context";

/* The sibling-channel link. A plain anchor in public (works before
   hydration); inert in preview like every other link on the page — the
   SectionFrame around it takes the click to select. Theme tokens only, no
   accent fill: it is a way out, not the call to action. */
export function CrossLink({ link, mode, className }: { link: RenderContext["crossLink"]; mode: RenderContext["mode"]; className?: string }) {
  if (!link) return null;
  const cls = cn("text-muted-foreground hover:text-foreground text-sm underline-offset-3 hover:underline", className);
  return mode === "public" ? (
    <a href={link.href} className={cls}>{link.label}</a>
  ) : (
    <span aria-disabled className={cn(cls, "cursor-default")}>{link.label}</span>
  );
}
