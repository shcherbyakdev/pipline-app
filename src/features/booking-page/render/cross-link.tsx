import { cn } from "@/lib/utils";
import type { Section } from "../schema";
import type { RenderContext } from "./context";

export type CrossLinkPlacement = "header" | "hero" | "booking";
export type CrossLinkHost = { sectionId: string; placement: CrossLinkPlacement };

/* Where a page's link to its sibling channel page goes (spec 2026-08-28
   §3.5): the top of the page when the top is a header or a cover, else just
   above the widget. Decided on the PUBLIC-visible list (publicSections —
   hidden and empty sections gone) so preview, thumbnails and the live page
   agree, exactly as pickersOnPage does. */
export function crossLinkHost(sections: Section[]): CrossLinkHost | null {
  const first = sections[0];
  if (first && (first.type === "header" || first.type === "hero")) return { sectionId: first.id, placement: first.type };
  const booking = sections.find((s) => s.type === "booking");
  return booking ? { sectionId: booking.id, placement: "booking" } : null;
}

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
