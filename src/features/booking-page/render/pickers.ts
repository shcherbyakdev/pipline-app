import { publicSections, type EmptyContext } from "../doc-ops";
import type { PageDocument } from "../schema";

/* One picker per page. A Services / Spaces section that the public page
   shows IS the picker for its channel: the widget lists nothing for it and
   waits for a card (page-state.ts hands the pick over), so a visitor never
   sees the same catalogue twice in a row. Decided on the public-visible set
   (hidden and empty sections are dropped there), so the studio preview and
   the template thumbnails agree with the live page. */
export type Pickers = { services: boolean; spaces: boolean };

export function pickersOnPage(doc: PageDocument, ctx: EmptyContext): Pickers {
  const shown = publicSections(doc, ctx);
  return { services: shown.some((s) => s.type === "services"), spaces: shown.some((s) => s.type === "spaces") };
}

/** Where the cover's Book button goes: the first step of booking — the
    catalogue section when the page has one, else the widget itself. The
    ids are set by services.tsx / spaces.tsx / booking.tsx. */
export function bookHref(pickers: Pickers): "#services" | "#spaces" | "#book" {
  return pickers.services ? "#services" : pickers.spaces ? "#spaces" : "#book";
}
