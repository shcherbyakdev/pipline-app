import type { Section } from "../schema";

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
