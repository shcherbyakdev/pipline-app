import { publicSections, type EmptyContext } from "../doc-ops";
import { bookingChannel, type BookingChannel, type PageDocument } from "../schema";

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

/** The DOM id of a booking widget: the combined / appointments one keeps
    the historical `book` (deep links, the services cards' scroll target);
    the spaces widget gets its own. */
export function bookingAnchor(channel: BookingChannel): "book" | "book-spaces" {
  return channel === "spaces" ? "book-spaces" : "book";
}

/** Where the cover's Book button goes: the first step of booking — the
    catalogue section when the page has one, else the first visible widget.
    The ids are set by services.tsx / spaces.tsx / booking.tsx. */
export function bookHref(pickers: Pickers, doc: PageDocument): string {
  if (pickers.services) return "#services";
  if (pickers.spaces) return "#spaces";
  const first = doc.sections.find((s) => s.type === "booking" && !s.hidden);
  return "#" + bookingAnchor(first?.type === "booking" ? bookingChannel(first) : "all");
}
