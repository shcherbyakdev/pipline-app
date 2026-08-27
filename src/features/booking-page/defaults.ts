import { SPACES } from "@/features/orgs/vocab";
import type { PageDocument, Section, SectionType } from "./schema";

export const SECTION_META: Record<SectionType, { label: string; description: string }> = {
  header: { label: "Header", description: "Your logo, name and an optional tagline." },
  hero: { label: "Cover", description: "A big headline with an optional cover image." },
  about: { label: "About", description: "Who you are, with a photo." },
  services: { label: "Services", description: "What you offer, from your service list." },
  staff: { label: "Team", description: "Your bookable team members." },
  spaces: SPACES.section,
  gallery: { label: "Gallery", description: "A grid of photos." },
  testimonials: { label: "Testimonials", description: "Quotes from happy clients." },
  faq: { label: "FAQ", description: "Common questions, answered." },
  links: { label: "Links", description: "Instagram, WhatsApp, your website…" },
  location: { label: "Location", description: "Your address and a maps link." },
  booking: { label: "Booking", description: "The booking widget. Always on the page." },
};

/** What the palette offers. `booking` is seeded and can't be removed;
    `header` is seeded too but may be re-added after deletion. */
export const ADDABLE_TYPES: readonly SectionType[] = [
  "header", "hero", "about", "services", "staff", "spaces", "gallery", "testimonials", "faq", "links", "location",
];

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newSectionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function newSection(type: SectionType, id: string = newSectionId()): Section {
  const base = { id, hidden: false as const };
  switch (type) {
    case "header": return { ...base, type, tagline: "" };
    case "hero": return { ...base, type, headline: "", subheadline: "", align: "left", cta: "Book now" };
    case "about": return { ...base, type, title: "", body: "" };
    case "services": return { ...base, type, title: "Services", style: "list", showPrices: true, showDurations: true };
    case "staff": return { ...base, type, title: "Team" };
    case "spaces": return { ...base, type, title: "Spaces", style: "cards", showPrices: true, showStay: true, photos: [] };
    case "gallery": return { ...base, type, images: [], columns: 3 };
    case "testimonials": return { ...base, type, items: [{ quote: "", author: "" }] };
    case "faq": return { ...base, type, items: [{ q: "", a: "" }] };
    case "links": return { ...base, type, items: [{ label: "", url: "", icon: "instagram" }] };
    case "location": return { ...base, type, address: "", mapsUrl: "" };
    case "booking": return { ...base, type, title: "" };
  }
}

/** Today's page: header + widget. Stable ids so two fresh orgs produce equal documents. */
export const DEFAULT_PAGE: PageDocument = {
  version: 1,
  layout: "column",
  sections: [newSection("header", "header01"), newSection("booking", "booking1")],
};
